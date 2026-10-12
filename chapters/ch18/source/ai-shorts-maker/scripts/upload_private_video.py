#!/usr/bin/env python3
"""Preview and upload one finished video for Chapter 18.

Every upload is inserted as private first. A request for a different
privacy is a second, separate API call that changes only that video's
status afterward, using its own OAuth token/scope. That status change is
not limited to the immediate run right after the insert: rerunning the same
command later with an explicit --privacy against an already-known video id
(receipt status_state=complete, or a compatible legacy private receipt)
performs the same same-ID status change instead of ALREADY UPLOADED,
provided the receipt still matches the plan and zero videos.insert calls
are ever made for it. Supplying the same --privacy the receipt already
confirms, or making no explicit request at all, still yields ALREADY
UPLOADED with no API call.

Exit codes: 0 complete, 1 not ready (validation/misuse), 2 reconciled as
no-video-found (tombstoned; permanently blocked from automatic
re-insertion, zero inserts, unless a separate future human runs
--authorize-new-attempt and a later separate normal --execute consumes it),
3 already uploaded, 4 auth failed before any insert, 5 insert done but
status change incomplete, 6 blocked (unresolved/tombstoned/malformed/
corrupt receipt, missing/duplicate/invalid authorization, plan/receipt
identity mismatch, or a reconciliation check failed), 7 authorized a new
attempt (control-plane only: zero inserts/updates; one-shot; only a later,
separate normal --execute may consume it).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PLAN = ROOT / "prototypes/youtube-shorts/chapter-18/upload-plan.json"
SECRET_DIR = ROOT / ".secrets/chapter-18"
CLIENT_SECRET = SECRET_DIR / "client_secret.json"
TOKEN_FILE = SECRET_DIR / "youtube-upload-token.json"
STATUS_TOKEN_FILE = SECRET_DIR / "youtube-status-token.json"
UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload"
STATUS_SCOPE = "https://www.googleapis.com/auth/youtube"
PRIVACY_CHOICES = ("private", "unlisted", "public")

# Receipt states. "state" tracks an insert attempt before its video id is
# known; "status_state" tracks a known-id receipt's requested-vs-actual
# privacy. STATE_TOMBSTONE is terminal: reached only via --reconcile-not-found,
# it permanently blocks this tool from inserting for this video hash again.
STATE_INSERT_PENDING = "insert-pending"
STATE_INSERT_AMBIGUOUS = "insert-ambiguous"
STATE_TOMBSTONE = "tombstone"
RECONCILABLE_STATES = (STATE_INSERT_PENDING, STATE_INSERT_AMBIGUOUS)
STATE_COMPLETE = "complete"
STATE_PUBLIC_INCOMPLETE = "public-incomplete"

# Reached only via --authorize-new-attempt, and only from STATE_TOMBSTONE. A
# human has separately confirmed (Studio check + --confirm-duplicate-risk)
# that a genuinely new attempt is authorized despite duplicate risk. Zero
# inserts happen at authorization time; only a later, separate normal
# --execute may consume it (see consume_authorized_new_attempt), and doing
# so immediately moves the receipt to STATE_INSERT_PENDING so the
# authorization can never be consumed twice.
STATE_AUTHORIZED_NEW_ATTEMPT = "authorized-new-attempt"

# How far a candidate video's publishedAt may fall outside the recorded
# insert attempt window and still count as "consistent with the attempt".
RECONCILE_TIME_TOLERANCE = timedelta(hours=24)

# Conservative attempt-id format for --authorize-new-attempt: 3-32 uppercase
# letters/digits, optionally followed by up to 4 more '-'-separated
# 1-32-character uppercase/digit segments. Deliberately rejects lowercase,
# whitespace, punctuation beyond '-', and long free-form text, so this
# field can never carry a secret or a pasted sentence.
ATTEMPT_ID_PATTERN = re.compile(r"^[A-Z0-9]{3,32}(-[A-Z0-9]{1,32}){0,4}$")


def validate_attempt_id(value: str) -> None:
    if not isinstance(value, str) or not ATTEMPT_ID_PATTERN.fullmatch(value):
        raise ValueError(
            "attempt id must be 3-32 uppercase letters/digits, optionally followed by "
            "up to 4 '-'-separated 1-32 character uppercase-letter/digit segments "
            "(e.g. REATTEMPT-20260914-01); no lowercase, whitespace, other punctuation, "
            "secrets, or free-form text"
        )


def receipt_file_for_video(video_sha256: str) -> Path:
    """One receipt file per video hash, so a retry finds the same record."""
    return SECRET_DIR / f"private-upload-receipt-{video_sha256[:12]}.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def blocked(message: str) -> int:
    print(f"BLOCKED: {message}", file=sys.stderr)
    return 6


def validate_plan_fields(plan: dict[str, Any]) -> None:
    """Checks shared by validate_plan (full) and validate_plan_metadata
    (control-plane, skips the two checks that need the media artifact)."""
    required = {
        "channel_handle", "channel_url", "video", "video_sha256", "qa_report",
        "title", "description", "tags", "category_id", "made_for_kids",
        "privacy", "notify_subscribers",
    }
    missing = sorted(required - plan.keys())
    if missing:
        raise ValueError(f"missing fields: {', '.join(missing)}")
    if plan["privacy"] not in PRIVACY_CHOICES:
        raise ValueError(f"privacy must be one of: {', '.join(sorted(PRIVACY_CHOICES))}")
    if not isinstance(plan["made_for_kids"], bool):
        raise ValueError("made_for_kids must be true or false")
    if not isinstance(plan["tags"], list) or not all(isinstance(tag, str) for tag in plan["tags"]):
        raise ValueError("tags must be a list of strings")
    if plan.get("channel_handle") == "@YOUR_CHANNEL_HANDLE":
        raise ValueError("set your own channel_handle before previewing or uploading")
    if not 1 <= len(plan["title"]) <= 100:
        raise ValueError("title must contain 1..100 characters")
    if len(plan["description"]) > 5000:
        raise ValueError("description exceeds 5000 characters")
    video_sha256 = plan["video_sha256"]
    if not isinstance(video_sha256, str) or len(video_sha256) != 64 or not all(
        c in "0123456789abcdef" for c in video_sha256.lower()
    ):
        raise ValueError("video_sha256 must be a 64-character hex string")
    if "contains_synthetic_media" in plan and not isinstance(plan["contains_synthetic_media"], bool):
        raise ValueError("contains_synthetic_media must be true or false")
    channel_handle = plan["channel_handle"]
    if not isinstance(channel_handle, str) or not channel_handle.startswith("@") or len(channel_handle) < 2:
        raise ValueError("channel_handle must be a non-empty '@handle'")


def validate_plan(plan: dict[str, Any]) -> tuple[Path, str]:
    validate_plan_fields(plan)
    video = resolve_path(plan["video"])
    if not video.is_file() or video.stat().st_size == 0:
        raise ValueError(f"video does not exist: {video}")
    actual_hash = sha256(video)
    if actual_hash != plan["video_sha256"]:
        raise ValueError(f"video SHA-256 mismatch: {actual_hash}")
    qa = read_json(resolve_path(plan["qa_report"]))
    if qa.get("status") != "PASS" or qa.get("gate") != "UPLOAD READY":
        raise ValueError("Chapter 17 report is not PASS / UPLOAD READY")
    if qa.get("video_sha256") != actual_hash:
        raise ValueError("Chapter 17 report video SHA-256 is missing or does not match this file")
    return video, actual_hash


def validate_plan_metadata(plan: dict[str, Any]) -> str:
    """Metadata-only validation for --handoff and both --reconcile-* recovery
    paths, so they stay usable after an insert attempt even if the MP4/QA
    files were later moved or deleted. Returns video_sha256, used only to
    locate the receipt; verify_receipt_matches_plan cross-checks it."""
    validate_plan_fields(plan)
    return plan["video_sha256"]


def verify_receipt_matches_plan(plan: dict[str, Any], receipt: dict[str, Any]) -> None:
    """A control/recovery operation (--handoff, --reconcile-*) must never
    act on a receipt whose identity was edited out from under it: raises
    ValueError on any mismatch against the plan's declared identity."""
    if receipt.get("video_sha256") != plan["video_sha256"]:
        raise ValueError("receipt video_sha256 does not match the plan")
    if receipt.get("channel_handle_expected") != plan["channel_handle"]:
        raise ValueError("receipt channel_handle_expected does not match the plan")
    if receipt.get("title") != plan["title"]:
        raise ValueError("receipt title does not match the plan")
    stored_synthetic = receipt.get("contains_synthetic_media")
    planned_synthetic = plan.get("contains_synthetic_media")
    if isinstance(stored_synthetic, bool) and isinstance(planned_synthetic, bool) and stored_synthetic != planned_synthetic:
        raise ValueError("receipt contains_synthetic_media does not match the plan")
    stored_made_for_kids = receipt.get("made_for_kids")
    if isinstance(stored_made_for_kids, bool) and stored_made_for_kids != plan["made_for_kids"]:
        raise ValueError("receipt made_for_kids does not match the plan")


def print_preview(plan: dict[str, Any], video: Path, actual_hash: str, privacy: str) -> None:
    print("CHAPTER 18 UPLOAD PREVIEW")
    print(f"channel: {plan['channel_handle']} ({plan['channel_url']})")
    print(f"video: {video}")
    print(f"size: {video.stat().st_size / 1_048_576:.1f} MiB")
    print(f"sha256: {actual_hash}")
    print(f"title: {plan['title']}")
    print(f"description:\n{plan['description']}")
    print(f"tags: {', '.join(plan['tags'])}")
    print(f"category_id: {plan['category_id']}")
    if "contains_synthetic_media" in plan:
        print(f"contains_synthetic_media: {plan['contains_synthetic_media']}")
    print(f"made_for_kids: {str(plan['made_for_kids']).lower()}")
    print(f"privacy: {privacy}")
    print("notify_subscribers: false")
    print(f"oauth_scope: {UPLOAD_SCOPE}")


def google_dependencies():
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
        from googleapiclient.errors import HttpError
        from googleapiclient.http import MediaFileUpload
    except ImportError as exc:
        raise RuntimeError("Google API libraries are not installed in this Python environment") from exc
    return Request, Credentials, InstalledAppFlow, build, HttpError, MediaFileUpload


def fsync_directory(directory: Path) -> None:
    """Best-effort: not every platform/filesystem can open a directory for
    fsync, so a failure here is not fatal."""
    try:
        dir_fd = os.open(directory, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(dir_fd)
    except OSError:
        pass
    finally:
        os.close(dir_fd)


def secure_write(path: Path, text: str) -> None:
    """Durable, atomic write: write+flush+fsync a same-directory temp file,
    chmod it, then os.replace it onto the target, so no reader ever sees a
    partially written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, path)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise
    fsync_directory(path.parent)


def authenticated_service(scope: str, token_file: Path):
    Request, Credentials, InstalledAppFlow, build, _, _ = google_dependencies()
    credentials = None
    if token_file.exists():
        credentials = Credentials.from_authorized_user_file(str(token_file), [scope])
    if credentials and credentials.expired and credentials.refresh_token:
        try:
            credentials.refresh(Request())
            secure_write(token_file, credentials.to_json())
        except Exception:
            # An OAuth app still in Testing has its refresh token revoked after a
            # week, so a saved token stops working with no warning. Ask for the
            # permission again instead of failing the upload.
            print("saved OAuth token no longer works; asking for permission again")
            credentials = None
    if not (credentials and credentials.valid):
        credentials = run_consent_flow(InstalledAppFlow, scope, token_file)
    return build("youtube", "v3", credentials=credentials, cache_discovery=False)


def authenticated_upload_service():
    return authenticated_service(UPLOAD_SCOPE, TOKEN_FILE)


def authenticated_status_service():
    return authenticated_service(STATUS_SCOPE, STATUS_TOKEN_FILE)


def run_consent_flow(InstalledAppFlow, scope: str, token_file: Path):
    if not CLIENT_SECRET.is_file():
        raise RuntimeError(f"OAuth desktop client is missing: {CLIENT_SECRET}")
    flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET), [scope])
    credentials = flow.run_local_server(
        port=0,
        authorization_prompt_message=(
            "In the browser, select the Google/Brand account that owns the channel.\n"
            f"Confirm that the requested permission is limited to: {scope}"
        ),
        success_message="OAuth complete. Return to the terminal for the result.",
    )
    secure_write(token_file, credentials.to_json())
    return credentials


def upload_video(service, plan: dict[str, Any], video: Path) -> str:
    """Insert the video as private. Every upload starts here, regardless of
    the privacy a person eventually asked for; a public/unlisted request is
    a separate status-change call against this same video id."""
    validate_plan(plan)  # Recheck after authentication, immediately before insertion.
    _, _, _, _, HttpError, MediaFileUpload = google_dependencies()
    body = {
        "snippet": {
            "title": plan["title"],
            "description": plan["description"],
            "tags": plan["tags"],
            "categoryId": str(plan["category_id"]),
        },
        "status": {
            "privacyStatus": "private",
            "selfDeclaredMadeForKids": plan["made_for_kids"],
        },
    }
    if isinstance(plan.get("contains_synthetic_media"), bool):
        body["status"]["containsSyntheticMedia"] = plan["contains_synthetic_media"]
    request = service.videos().insert(
        part="snippet,status",
        body=body,
        media_body=MediaFileUpload(str(video), chunksize=8 * 1024 * 1024, resumable=True),
        notifySubscribers=False,
    )
    response = None
    retries = 0
    while response is None:
        try:
            progress, response = request.next_chunk()
            if progress:
                print(f"upload progress: {int(progress.progress() * 100)}%")
        except HttpError as exc:
            status = getattr(exc.resp, "status", None)
            if status not in {429, 500, 502, 503, 504} or retries >= 5:
                raise
            retries += 1
            print(f"temporary YouTube API error {status}; retry {retries}/5")
            time.sleep(min(2 ** retries + random.random(), 30))
    video_id = response.get("id") if isinstance(response, dict) else None
    if not video_id:
        raise RuntimeError("YouTube API response did not contain a video id")
    return video_id


def build_receipt(plan: dict[str, Any], video_id: str, actual_hash: str, requested_privacy: str) -> dict[str, Any]:
    complete = requested_privacy == "private"
    return {
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "video_id": video_id,
        "channel_handle_expected": plan["channel_handle"],
        "video_sha256": actual_hash,
        "title": plan["title"],
        "requested_privacy": requested_privacy,
        "actual_privacy": "private",
        "made_for_kids": plan["made_for_kids"],
        "contains_synthetic_media": plan.get("contains_synthetic_media"),
        "status_state": STATE_COMPLETE if complete else STATE_PUBLIC_INCOMPLETE,
    }


def write_receipt(receipt_file: Path, receipt: dict[str, Any]) -> None:
    secure_write(receipt_file, json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")


def build_pending_receipt(plan: dict[str, Any], actual_hash: str, requested_privacy: str) -> dict[str, Any]:
    """Durable record written before the first insert call. Its presence is
    what stops a later run from inserting again when this run's outcome is
    never learned (crash, kill, network cut, ambiguous response)."""
    return {
        "state": STATE_INSERT_PENDING,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "channel_handle_expected": plan["channel_handle"],
        "video_sha256": actual_hash,
        "title": plan["title"],
        "requested_privacy": requested_privacy,
        "made_for_kids": plan["made_for_kids"],
        "contains_synthetic_media": plan.get("contains_synthetic_media"),
        "video_id": None,
    }


def mark_insert_ambiguous(pending: dict[str, Any], receipt_file: Path, exc: Exception) -> None:
    pending["state"] = STATE_INSERT_AMBIGUOUS
    pending["failed_at"] = datetime.now(timezone.utc).isoformat()
    pending["error"] = f"{type(exc).__name__}: {exc}"
    write_receipt(receipt_file, pending)


def is_legacy_complete_receipt(receipt: dict[str, Any]) -> bool:
    """Pre-two-step receipts have no state/status_state field. They only
    ever existed after a one-shot insert fully succeeded, so they always
    mean the video already exists on the channel."""
    return (
        "state" not in receipt
        and "status_state" not in receipt
        and bool(receipt.get("video_id"))
        and isinstance(receipt.get("privacy"), str)
    )


def print_reconcile_instructions(receipt_file: Path, plan_arg: Path, video_id_hint: str | None) -> None:
    """Print the only two safe recovery commands for a receipt whose insert
    attempt outcome is unresolved (state in RECONCILABLE_STATES). Never
    suggests hand-editing or deleting the receipt JSON."""
    print(f"receipt: {receipt_file}", file=sys.stderr)
    if video_id_hint:
        print(f"last known video_id: {video_id_hint}", file=sys.stderr)
    print(
        "Check YouTube Studio (https://studio.youtube.com) for a video matching this "
        "title around the recorded attempt time before doing anything else. Studio "
        "cannot show or compare the local SHA-256; only title/time/channel help here. "
        "Do not hand-edit the receipt JSON file.",
        file=sys.stderr,
    )
    print(
        "If Studio shows a matching video, note its real video ID and run:\n"
        f"  python3 scripts/upload_private_video.py --plan {plan_arg} --execute "
        "--reconcile-video-found <VIDEO_ID>\n"
        "This performs a read-only lookup of that ID and verifies channel identity, "
        "exact title, and upload time before changing anything. Any mismatch stays "
        "BLOCKED with zero inserts/updates.",
        file=sys.stderr,
    )
    print(
        "If Studio shows no matching video, run:\n"
        f"  python3 scripts/upload_private_video.py --plan {plan_arg} --execute "
        "--reconcile-not-found --confirm-studio-checked\n"
        "This performs zero inserts and permanently tombstones this video hash: no "
        "later run of this tool will ever insert for it again on its own. A "
        "genuinely new attempt requires a separate human authorization via "
        "--authorize-new-attempt (see COMMANDS.md); never delete the receipt by hand.",
        file=sys.stderr,
    )


def convert_legacy_to_status_receipt(receipt: dict[str, Any], requested_privacy: str) -> dict[str, Any]:
    """Promote a pre-two-step legacy receipt (single 'privacy' field, no
    state/status_state) into the modern known-id schema so the existing
    same-ID status path can drive it. Only called after verify_receipt_
    matches_plan has confirmed identity and the caller has confirmed
    receipt['privacy'] == 'private'."""
    converted = {
        "uploaded_at": receipt.get("uploaded_at", datetime.now(timezone.utc).isoformat()),
        "video_id": receipt["video_id"],
        "channel_handle_expected": receipt["channel_handle_expected"],
        "video_sha256": receipt["video_sha256"],
        "title": receipt["title"],
        "requested_privacy": requested_privacy,
        "actual_privacy": "private",
        "status_state": STATE_PUBLIC_INCOMPLETE,
    }
    if isinstance(receipt.get("made_for_kids"), bool):
        converted["made_for_kids"] = receipt["made_for_kids"]
    return converted


def retarget_receipt(receipt: dict[str, Any], requested_privacy: str) -> dict[str, Any]:
    """Point a known-id receipt at a new explicitly requested privacy while
    keeping its confirmed actual_privacy untouched until the status call
    that follows actually changes it. Used both to reopen a 'complete'
    receipt for a later explicit request and to retarget a still-pending
    'public-incomplete' one."""
    retargeted = dict(receipt)
    retargeted["requested_privacy"] = requested_privacy
    retargeted["status_state"] = STATE_PUBLIC_INCOMPLETE
    return retargeted


def handle_existing_receipt(
    receipt: dict[str, Any],
    receipt_file: Path,
    plan_arg: Path,
    plan: dict[str, Any],
    explicit_privacy: str | None,
) -> int:
    """explicit_privacy is args.privacy verbatim (None unless the operator
    typed --privacy on this exact invocation) — a plan's default privacy is
    never enough on its own to reopen an already-settled receipt."""
    if is_legacy_complete_receipt(receipt):
        actual_privacy = receipt.get("privacy")
        if explicit_privacy is None or explicit_privacy == actual_privacy or actual_privacy != "private":
            # Only a legacy receipt whose one-shot insert used "private" is a
            # known-safe starting point for a same-ID status change; any
            # other legacy privacy value (or no explicit request) is left
            # exactly as before.
            print(f"ALREADY UPLOADED: {receipt_file}", file=sys.stderr)
            return 3
        try:
            verify_receipt_matches_plan(plan, receipt)
        except ValueError as exc:
            return blocked(
                f"legacy receipt does not match the plan; refusing to change its "
                f"status: {exc}"
            )
        converted = convert_legacy_to_status_receipt(receipt, explicit_privacy)
        write_receipt(receipt_file, converted)
        return apply_status_change(converted, receipt_file)

    state = receipt.get("state")
    if state == STATE_TOMBSTONE:
        return blocked(
            f"{receipt_file} is tombstoned for this video hash. A human confirmed "
            "Studio showed no matching video for a prior insert attempt whose "
            "outcome was never learned; a plain rerun never re-inserts a tombstoned "
            "hash on its own. A genuinely new attempt requires a separate human "
            "authorization via --authorize-new-attempt (see COMMANDS.md)."
        )
    if state in RECONCILABLE_STATES:
        print("BLOCKED: a previous insert attempt has an unresolved outcome.", file=sys.stderr)
        print_reconcile_instructions(receipt_file, plan_arg, receipt.get("video_id"))
        return 6

    status_state = receipt.get("status_state")
    if status_state == STATE_COMPLETE:
        if not receipt.get("video_id"):
            return blocked(f"receipt is malformed or incomplete: {receipt_file}")
        actual_privacy = receipt.get("actual_privacy")
        if explicit_privacy is None or explicit_privacy == actual_privacy:
            print(f"ALREADY UPLOADED: {receipt_file}", file=sys.stderr)
            return 3
        try:
            verify_receipt_matches_plan(plan, receipt)
        except ValueError as exc:
            return blocked(
                f"receipt does not match the plan; refusing to change its status: {exc}"
            )
        retargeted = retarget_receipt(receipt, explicit_privacy)
        write_receipt(receipt_file, retargeted)
        return apply_status_change(retargeted, receipt_file)
    if status_state == STATE_PUBLIC_INCOMPLETE and receipt.get("video_id"):
        if explicit_privacy is not None and explicit_privacy != receipt.get("requested_privacy"):
            try:
                verify_receipt_matches_plan(plan, receipt)
            except ValueError as exc:
                return blocked(
                    f"cannot verify the receipt to change its pending target "
                    f"privacy: {exc}"
                )
            receipt = retarget_receipt(receipt, explicit_privacy)
            write_receipt(receipt_file, receipt)
        return apply_status_change(receipt, receipt_file)

    # Anything else is a malformed/unrecognized receipt: never insert again
    # and never call a status update without a known video id.
    return blocked(f"receipt is malformed or incomplete: {receipt_file}")


def resolve_own_channel_id(service) -> str | None:
    """Read-only lookup of the currently authenticated channel's id. Proves
    only "belongs to whichever account authenticated", not "is the channel a
    receipt expects" — see resolve_channel_id_for_handle for that."""
    response = service.channels().list(part="id", mine=True).execute()
    items = response.get("items") if isinstance(response, dict) else None
    if not items:
        return None
    return items[0].get("id")


def resolve_channel_id_for_handle(service, handle: str) -> str | None:
    """Read-only exact lookup (channels.list forHandle) of a receipt's
    expected channel id, independent of which account is authenticated.
    Combined with resolve_own_channel_id, this catches a wrong-but-valid
    Brand account that would otherwise pass a mine=true-only check."""
    response = service.channels().list(part="id", forHandle=handle).execute()
    items = response.get("items") if isinstance(response, dict) else None
    if not items:
        return None
    return items[0].get("id")


RECOVERABLE_RECEIPT_REQUIRED_FIELDS: dict[str, type] = {
    "channel_handle_expected": str,
    "video_sha256": str,
    "title": str,
    "requested_privacy": str,
    "made_for_kids": bool,
    "started_at": str,
}


def validate_recoverable_receipt_schema(receipt: dict[str, Any]) -> None:
    """Refuse to index into a pending/ambiguous receipt with a malformed but
    valid-JSON shape. Raises ValueError so the caller can return a clean
    BLOCKED result instead of an uncaught KeyError/TypeError."""
    for field, expected_type in RECOVERABLE_RECEIPT_REQUIRED_FIELDS.items():
        if field not in receipt:
            raise ValueError(f"missing field: {field}")
        value = receipt[field]
        if not isinstance(value, expected_type):
            raise ValueError(f"field {field!r} has the wrong type")
        if expected_type is str and not value:
            raise ValueError(f"field {field!r} must be a non-empty string")
    if receipt["requested_privacy"] not in PRIVACY_CHOICES:
        raise ValueError(
            f"requested_privacy must be one of: {', '.join(sorted(PRIVACY_CHOICES))}"
        )


def lookup_video_for_reconciliation(service, video_id: str) -> dict[str, Any] | None:
    """Read-only videos.list lookup used only to verify an operator-supplied
    video id during reconciliation. Never inserts or updates anything."""
    response = service.videos().list(part="snippet,status", id=video_id).execute()
    items = response.get("items") if isinstance(response, dict) else None
    if not items:
        return None
    return items[0]


def upload_time_is_plausible(receipt: dict[str, Any], published_at: str | None) -> bool:
    """publishedAt must fall within a fixed tolerance of started_at, not
    simply be "not too far in the future relative to now" — anchoring only
    the upper bound to now() would let a same-title video uploaded long
    after the attempt pass whenever reconciliation itself happens late."""
    started_raw = receipt.get("started_at") or receipt.get("uploaded_at")
    if not published_at or not started_raw:
        return False
    try:
        started = datetime.fromisoformat(started_raw)
        published = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    if started.tzinfo is None or published.tzinfo is None:
        return False
    return abs(published - started) <= RECONCILE_TIME_TOLERANCE


def reconcile_found(receipt: dict[str, Any], receipt_file: Path, video_id: str) -> int:
    """Verify an operator-supplied video id via read-only lookups (channel
    identity resolved independently of who is authenticated, exact title,
    plausible time, confirmed privacy/MFK) before turning a pending/
    ambiguous receipt into a known-id one. Never inserts; never updates
    status here (see module exit codes). Never guesses a missing field."""
    if receipt.get("state") not in RECONCILABLE_STATES:
        return blocked(
            "--reconcile-video-found only applies to a receipt with an unresolved "
            f"insert attempt ({' or '.join(RECONCILABLE_STATES)})."
        )

    try:
        validate_recoverable_receipt_schema(receipt)
    except ValueError as exc:
        return blocked(f"receipt is malformed or incomplete: {exc}")

    expected_handle = receipt["channel_handle_expected"]
    try:
        status_service = authenticated_status_service()
        expected_channel_id = resolve_channel_id_for_handle(status_service, expected_handle)
        own_channel_id = resolve_own_channel_id(status_service)
        video = lookup_video_for_reconciliation(status_service, video_id)
    except Exception as exc:
        return blocked(
            f"could not verify video id {video_id} via a read-only API lookup: "
            f"{type(exc).__name__}: {exc}"
        )

    if not expected_channel_id:
        return blocked(
            f"could not resolve the expected channel handle {expected_handle!r} via "
            "channels.list(forHandle=...)."
        )
    if not own_channel_id:
        return blocked("could not resolve the authenticated channel's own id.")
    if own_channel_id != expected_channel_id:
        return blocked(
            f"the authenticated channel {own_channel_id!r} is not the expected "
            f"channel {expected_handle!r} ({expected_channel_id!r}). Wrong account?"
        )
    if not video:
        return blocked(f"video id {video_id} was not found.")

    snippet = video.get("snippet", {}) if isinstance(video, dict) else {}
    status = video.get("status", {}) if isinstance(video, dict) else {}

    if snippet.get("channelId") != expected_channel_id:
        return blocked(
            f"video {video_id} belongs to channel {snippet.get('channelId')!r}, not "
            f"the expected channel {expected_handle!r} ({expected_channel_id!r})."
        )
    if snippet.get("title") != receipt["title"]:
        return blocked(
            f"video {video_id} title {snippet.get('title')!r} does not match the "
            f"recorded attempt {receipt['title']!r}."
        )
    if not upload_time_is_plausible(receipt, snippet.get("publishedAt")):
        return blocked(
            f"video {video_id} publishedAt {snippet.get('publishedAt')!r} is not "
            "consistent with the recorded attempt time."
        )

    actual_privacy = status.get("privacyStatus")
    if actual_privacy not in PRIVACY_CHOICES:
        return blocked(
            f"video {video_id} has no confirmed privacyStatus ({actual_privacy!r}); "
            "refusing to guess."
        )
    actual_made_for_kids = status.get("selfDeclaredMadeForKids")
    if not isinstance(actual_made_for_kids, bool):
        return blocked(
            f"video {video_id} has no confirmed selfDeclaredMadeForKids value; "
            "refusing to guess."
        )
    if actual_made_for_kids != receipt["made_for_kids"]:
        return blocked(
            f"video {video_id} selfDeclaredMadeForKids={actual_made_for_kids!r} does "
            f"not match the receipt's intended made_for_kids={receipt['made_for_kids']!r}."
        )

    requested_privacy = receipt["requested_privacy"]
    reconciled = {
        "uploaded_at": receipt.get("started_at", datetime.now(timezone.utc).isoformat()),
        "video_id": video_id,
        "channel_handle_expected": receipt["channel_handle_expected"],
        "video_sha256": receipt["video_sha256"],
        "title": receipt["title"],
        "requested_privacy": requested_privacy,
        "actual_privacy": actual_privacy,
        "made_for_kids": actual_made_for_kids,
        "status_state": STATE_COMPLETE if actual_privacy == requested_privacy else STATE_PUBLIC_INCOMPLETE,
        "reconciled_at": datetime.now(timezone.utc).isoformat(),
    }
    write_receipt(receipt_file, reconciled)
    print(f"RECONCILED: verified video {video_id} matches this receipt's attempt.")
    print(f"video_id: {video_id}")
    print(f"actual_privacy: {actual_privacy}")
    if reconciled["status_state"] == STATE_COMPLETE:
        print(f"UPLOAD COMPLETE ({requested_privacy})")
        return 0
    print(
        f"PUBLIC INCOMPLETE: requested {requested_privacy}, actual {actual_privacy}. "
        "Rerun the normal command (same --plan, --execute, no --reconcile-* flags) to "
        "retry only the status change; zero inserts will occur.",
        file=sys.stderr,
    )
    return 5


def reserve_archive_path(archive_dir: Path, base_name: str) -> Path:
    """Atomically claim a not-yet-existing archive filename so two archive
    calls (e.g. same-second timestamps) never silently overwrite each
    other's audit record."""
    archive_dir.mkdir(parents=True, exist_ok=True)
    suffix = 0
    while True:
        name = f"{base_name}.json" if suffix == 0 else f"{base_name}-{suffix}.json"
        candidate = archive_dir / name
        try:
            fd = os.open(candidate, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            suffix += 1
            continue
        os.close(fd)
        return candidate


def archive_receipt(receipt: dict[str, Any], receipt_file: Path, reason: str) -> Path:
    """Write a collision-safe audit copy of receipt with an explicit reason.
    Never touches the active receipt_file — the caller decides what happens
    to that. Every archive this tool ever writes (tombstoning, authorizing a
    new attempt, consuming that authorization) goes through here, so the
    archive directory alone is a durable history a human or a later
    --authorize-new-attempt run can scan (see attempt_id_already_used)."""
    archive_dir = receipt_file.parent / "archive"
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    archive_file = reserve_archive_path(archive_dir, f"{receipt_file.stem}-archived-{timestamp}")
    archived = dict(receipt)
    archived["archived_at"] = datetime.now(timezone.utc).isoformat()
    archived["archive_reason"] = reason
    write_receipt(archive_file, archived)
    return archive_file


def tombstone_receipt(receipt: dict[str, Any], receipt_file: Path) -> Path:
    """Archive the pre-tombstone receipt as audit history, then overwrite
    the active receipt with a permanent block for this video hash. Never
    unlinks the active file: an unconfirmed result is not permission to
    insert again, so the hash must stay blocked, not become insertable."""
    archive_file = archive_receipt(
        receipt,
        receipt_file,
        "reconcile-not-found: a human confirmed Studio showed no matching video for "
        "this insert attempt",
    )
    tombstone = {
        "state": STATE_TOMBSTONE,
        "tombstoned_at": datetime.now(timezone.utc).isoformat(),
        "channel_handle_expected": receipt.get("channel_handle_expected"),
        "video_sha256": receipt.get("video_sha256"),
        "title": receipt.get("title"),
        "requested_privacy": receipt.get("requested_privacy"),
        "made_for_kids": receipt.get("made_for_kids"),
        "video_id": None,
        "archived_attempt": str(archive_file),
    }
    write_receipt(receipt_file, tombstone)
    return archive_file


def reconcile_not_found(receipt: dict[str, Any], receipt_file: Path, confirmed: bool) -> int:
    """No-video-found path: requires an explicit human Studio check, then
    tombstones the receipt so this tool never inserts for this video hash
    again on its own. A genuinely new attempt requires a separate human
    authorization via --authorize-new-attempt; see authorize_new_attempt."""
    if receipt.get("state") not in RECONCILABLE_STATES:
        return blocked(
            "--reconcile-not-found only applies to a receipt with an unresolved "
            f"insert attempt ({' or '.join(RECONCILABLE_STATES)})."
        )
    if not confirmed:
        return blocked(
            "--reconcile-not-found requires --confirm-studio-checked as an explicit "
            "statement that a human checked YouTube Studio "
            "(https://studio.youtube.com) and found no matching video."
        )

    archive_file = tombstone_receipt(receipt, receipt_file)
    print(f"TOMBSTONED: {receipt_file}")
    print(f"archived prior attempt: {archive_file}")
    print("No insert was performed by this command.")
    print(
        "YouTube can take time to show a newly created video, so this confirmation "
        "is a snapshot, not a guarantee that no video exists. This video hash now "
        "stays permanently blocked from automatic re-insertion by this tool unless a "
        "human separately runs --authorize-new-attempt (see COMMANDS.md) and a later, "
        "separate normal --execute consumes it. If a video turns up later, resolve it "
        "in Studio directly — never delete anything here by hand.",
        file=sys.stderr,
    )
    return 2


class ArchiveScanError(Exception):
    """Raised when the archive directory for a video hash contains a
    candidate file the attempt-id uniqueness scan cannot trust (corrupt,
    unreadable, or not a JSON object)."""


def attempt_id_already_used(receipt_file: Path, attempt_id: str) -> bool:
    """An attempt id is one-shot for this video hash's whole history, not
    just its current tombstone: every authorization this tool ever writes
    eventually gets archived (either superseded by consumption, see
    consume_authorized_new_attempt, or never consumed), so scanning this
    hash's archive/ directory for a prior authorized_attempt_id is a
    complete durable check. Raises ArchiveScanError instead of skipping a
    candidate this scan cannot trust: the point of this check is to fail
    closed on any doubt about completeness, never to silently continue and
    report "not used" when the full history was not actually readable."""
    archive_dir = receipt_file.parent / "archive"
    if not archive_dir.is_dir():
        return False
    for candidate in archive_dir.glob(f"{receipt_file.stem}-archived-*.json"):
        try:
            archived = read_json(candidate)
        except (OSError, json.JSONDecodeError) as exc:
            raise ArchiveScanError(
                f"archive file {candidate} is corrupt or unreadable and cannot be "
                f"trusted for the attempt-id uniqueness scan: {type(exc).__name__}: {exc}"
            ) from exc
        if not isinstance(archived, dict):
            raise ArchiveScanError(
                f"archive file {candidate} does not contain a JSON object and cannot "
                "be trusted for the attempt-id uniqueness scan."
            )
        if archived.get("authorized_attempt_id") == attempt_id:
            return True
    return False


def authorize_new_attempt(receipt: dict[str, Any], receipt_file: Path, attempt_id: str) -> int:
    """Zero-insert, zero-update control-plane transition: a tombstoned
    receipt becomes an auditable authorized-new-attempt receipt recording a
    unique, format-validated, human-supplied attempt id. Only called after
    the caller (main) has already required --execute, validated the attempt
    id's format, required --confirm-duplicate-risk, and verified the
    receipt still matches the plan. Only a later, separate normal --execute
    may consume this — see consume_authorized_new_attempt — and doing so
    immediately moves the receipt out of this state, so the same
    authorization can never be consumed twice."""
    if receipt.get("state") != STATE_TOMBSTONE:
        return blocked(
            f"{receipt_file} is not tombstoned; --authorize-new-attempt only applies "
            "to a receipt whose prior insert attempt was reconciled as no-video-found."
        )
    try:
        already_used = attempt_id_already_used(receipt_file, attempt_id)
    except ArchiveScanError as exc:
        return blocked(
            f"could not confirm attempt id {attempt_id!r} is unused because the "
            f"archive history for this video hash cannot be trusted: {exc}"
        )
    if already_used:
        return blocked(
            f"attempt id {attempt_id!r} has already been used for this video hash. A "
            "genuinely new attempt requires a fresh attempt id that has never been "
            "used for it before."
        )
    archive_file = archive_receipt(
        receipt,
        receipt_file,
        "authorize-new-attempt: a human separately checked Studio, confirmed the "
        "duplicate risk, and authorized a genuinely new attempt",
    )
    authorized = {
        "state": STATE_AUTHORIZED_NEW_ATTEMPT,
        "authorized_attempt_id": attempt_id,
        "authorized_at": datetime.now(timezone.utc).isoformat(),
        "confirmed_duplicate_risk": True,
        "channel_handle_expected": receipt.get("channel_handle_expected"),
        "video_sha256": receipt.get("video_sha256"),
        "title": receipt.get("title"),
        "requested_privacy": receipt.get("requested_privacy"),
        "made_for_kids": receipt.get("made_for_kids"),
        "video_id": None,
        "prior_tombstoned_at": receipt.get("tombstoned_at"),
        "prior_archived_attempt": receipt.get("archived_attempt"),
        "archived_tombstone": str(archive_file),
    }
    write_receipt(receipt_file, authorized)
    print(f"AUTHORIZED NEW ATTEMPT: {receipt_file}")
    print(f"attempt_id: {attempt_id}")
    print(f"archived prior tombstone: {archive_file}")
    print("No insert or update was performed by this command.")
    print(
        "This authorization is one-shot and does not upload anything by itself. Only "
        "a later, separate normal run (--plan <same plan> --execute, no "
        "--authorize-new-attempt/--reconcile-*/--handoff) may consume it, and doing so "
        "performs exactly one private insert.",
        file=sys.stderr,
    )
    return 7


AUTHORIZED_NEW_ATTEMPT_LINEAGE_TIMESTAMP_FIELDS = ("prior_tombstoned_at",)
AUTHORIZED_NEW_ATTEMPT_LINEAGE_PATH_FIELDS = ("prior_archived_attempt", "archived_tombstone")


def _require_stored_timestamp(receipt: dict[str, Any], field: str) -> None:
    """A timestamp field is only trustworthy if it parses back into the same
    aware datetime shape every write_receipt call stores
    (datetime.now(timezone.utc).isoformat()); anything else (missing, empty,
    naive, or unparsable) must never silently pass as "present"."""
    value = receipt.get(field)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field} is missing or not a non-empty string")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{field} is not a valid ISO-8601 timestamp") from None
    if parsed.tzinfo is None:
        raise ValueError(f"{field} must include a timezone offset")


def validate_authorized_new_attempt_schema(receipt: dict[str, Any], plan: dict[str, Any]) -> None:
    """Every invariant a state=authorized-new-attempt receipt must satisfy
    before consume_authorized_new_attempt is allowed to touch OAuth, the
    YouTube API, or an insert. Raises ValueError describing exactly what
    failed; the caller turns that into a clean BLOCKED result with zero
    auth/insert/update and the receipt left on disk unchanged. A JSON-valid
    but incomplete, wrong-type, or wrong-value authorized receipt (however it
    got that way) must never be treated as consumable."""
    attempt_id = receipt.get("authorized_attempt_id")
    if not isinstance(attempt_id, str):
        raise ValueError("authorized_attempt_id is missing or not a string")
    validate_attempt_id(attempt_id)
    if receipt.get("confirmed_duplicate_risk") is not True:
        raise ValueError("confirmed_duplicate_risk is not exactly true")
    _require_stored_timestamp(receipt, "authorized_at")
    for field in AUTHORIZED_NEW_ATTEMPT_LINEAGE_TIMESTAMP_FIELDS:
        _require_stored_timestamp(receipt, field)
    for field in AUTHORIZED_NEW_ATTEMPT_LINEAGE_PATH_FIELDS:
        value = receipt.get(field)
        if not isinstance(value, str) or not value:
            raise ValueError(f"tombstone lineage field {field!r} is missing or not a non-empty string")
    verify_receipt_matches_plan(plan, receipt)


def consume_authorized_new_attempt(
    receipt: dict[str, Any],
    receipt_file: Path,
    plan: dict[str, Any],
    plan_arg: Path,
    video: Path,
    actual_hash: str,
    privacy: str,
) -> int:
    """One-shot consumption of a stored --authorize-new-attempt authorization,
    triggered only by a plain normal --execute (no control-plane flags) run
    against a receipt in STATE_AUTHORIZED_NEW_ATTEMPT. First runs
    validate_authorized_new_attempt_schema, which must pass before any
    OAuth/auth/API/insert activity: a JSON-valid but malformed authorized
    receipt is blocked here with zero calls and the receipt untouched. Only
    then does it mirror main()'s ordinary first-time insert path (auth
    first, then a durable pending receipt before the insert call, then the
    same ambiguous-on-exception handling), so a crash here is recovered the
    same way as any other insert attempt: via
    --reconcile-video-found/--reconcile-not-found, never by silently
    re-consuming this authorization."""
    try:
        validate_authorized_new_attempt_schema(receipt, plan)
    except ValueError as exc:
        return blocked(
            f"authorized-new-attempt receipt is malformed or does not match the plan; "
            f"refusing to consume it: {exc}"
        )
    try:
        service = authenticated_upload_service()
    except Exception as exc:
        print(f"UPLOAD FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 4

    archive_file = archive_receipt(
        receipt,
        receipt_file,
        "authorize-new-attempt consumed: this authorization is about to be spent on "
        "exactly one insert attempt",
    )
    pending = build_pending_receipt(plan, actual_hash, privacy)
    pending["consumed_attempt_id"] = receipt.get("authorized_attempt_id")
    pending["consumed_authorization_archive"] = str(archive_file)
    write_receipt(receipt_file, pending)
    try:
        video_id = upload_video(service, plan, video)
    except Exception as exc:
        mark_insert_ambiguous(pending, receipt_file, exc)
        print(f"INSERT OUTCOME UNKNOWN: {type(exc).__name__}: {exc}", file=sys.stderr)
        print("BLOCKED: reconcile the real YouTube state before retrying.", file=sys.stderr)
        print_reconcile_instructions(receipt_file, plan_arg, None)
        return 6

    new_receipt = build_receipt(plan, video_id, actual_hash, privacy)
    write_receipt(receipt_file, new_receipt)
    if privacy == "private":
        print("UPLOAD COMPLETE (private)")
        print(f"video_id: {video_id}")
        print(f"YouTube Studio: https://studio.youtube.com/video/{video_id}/edit")
        return 0
    return apply_status_change(new_receipt, receipt_file)


def receipt_is_handoff_ready(receipt: dict[str, Any]) -> bool:
    """Only a fully completed receipt (status_state == complete, or an
    equivalent legacy one-shot receipt) whose confirmed actual privacy is
    public or unlisted is safe to hand off: Chapter 19 needs a video an
    audience can reach and comment on, so a completed-but-private receipt is
    no more handoff-ready than a public-incomplete/pending/ambiguous/
    tombstoned/authorized-new-attempt one — none of them have anything the
    three-field whitelist can honestly present as a finished, commentable
    handoff."""
    if is_legacy_complete_receipt(receipt):
        return receipt.get("privacy") in ("public", "unlisted")
    if receipt.get("status_state") != STATE_COMPLETE or not receipt.get("video_id"):
        return False
    return receipt.get("actual_privacy") in ("public", "unlisted")


def handoff_block_reason(receipt: dict[str, Any]) -> str:
    """Distinguishes "completed but still private" (needs a later explicit
    same-ID public/unlisted transition first) from every other not-ready
    state, so the operator knows exactly what to do next."""
    if is_legacy_complete_receipt(receipt):
        if receipt.get("privacy") == "private":
            return (
                "this receipt is a completed private upload. Part 6 handoff needs a "
                "confirmed public or unlisted video. Run this same command again with "
                "an explicit --privacy public (or unlisted) against this same video "
                "ID first, then retry --handoff."
            )
        return "this receipt's status_state is not 'complete'."
    if receipt.get("status_state") == STATE_COMPLETE and receipt.get("actual_privacy") == "private":
        return (
            "this receipt is a completed private upload. Part 6 handoff needs a "
            "confirmed public or unlisted video. Run this same command again with an "
            "explicit --privacy public (or unlisted) against this same video ID "
            "first, then retry --handoff."
        )
    return (
        "this receipt's status_state is not 'complete', or its confirmed privacy is "
        "not public/unlisted; a public-incomplete, insert-pending, insert-ambiguous, "
        "tombstoned, or authorized-new-attempt receipt is not a completed publishing "
        "handoff."
    )


def print_handoff(receipt: dict[str, Any]) -> None:
    """Emit only the Part 6 handoff whitelist: video URL, video id, and the
    expected channel identity. No file path, hash, token, secret, or other
    receipt field is ever printed here."""
    video_id = receipt["video_id"]
    print(f"video_url: https://www.youtube.com/watch?v={video_id}")
    print(f"video_id: {video_id}")
    print(f"expected_channel_identity: {receipt['channel_handle_expected']}")


def resolve_made_for_kids(status_service, receipt: dict[str, Any], video_id: str) -> bool | None:
    """Return the made-for-kids boolean to send with a status update. Newer
    receipts store it directly. Older known-id receipts written before this
    field existed have no confirmed value on disk, so it is read from the
    platform instead of guessed; omitting it from an update can delete it
    (see videos.update docs), so a status change never proceeds without one."""
    stored = receipt.get("made_for_kids")
    if isinstance(stored, bool):
        return stored
    response = status_service.videos().list(part="status", id=video_id).execute()
    items = response.get("items") if isinstance(response, dict) else None
    if not items:
        return None
    value = items[0].get("status", {}).get("selfDeclaredMadeForKids")
    return value if isinstance(value, bool) else None


def read_actual_privacy(service, video_id: str) -> str | None:
    """Ask YouTube for the video's current privacy status directly, used to
    reconcile state when a status-change response is ambiguous."""
    response = service.videos().list(part="status", id=video_id).execute()
    items = response.get("items") if isinstance(response, dict) else None
    if not items:
        return None
    return items[0].get("status", {}).get("privacyStatus")


def change_video_status(service, video_id: str, privacy: str, made_for_kids: bool,
                        contains_synthetic_media: bool | None = None) -> dict[str, Any]:
    """Preserve platform status settings when changing the same video's privacy."""
    status = {"privacyStatus": privacy, "selfDeclaredMadeForKids": made_for_kids}
    if contains_synthetic_media is None:
        response = service.videos().list(part="status", id=video_id).execute()
        items = response.get("items", []) if isinstance(response, dict) else []
        if not isinstance(items, list) or not items:
            raise ValueError("Cannot read existing status before updating privacy")
        current = items[0].get("status", {})
        contains_synthetic_media = current.get("containsSyntheticMedia")
    if isinstance(contains_synthetic_media, bool):
        status["containsSyntheticMedia"] = contains_synthetic_media
    return service.videos().update(part="status", body={"id": video_id, "status": status}).execute()


def apply_status_change(receipt: dict[str, Any], receipt_file: Path) -> int:
    """Change the receipt's video to its requested privacy using the
    status-change token/scope. Performs zero inserts: it only ever touches
    the video id already recorded in the receipt."""
    video_id = receipt["video_id"]
    requested_privacy = receipt["requested_privacy"]
    try:
        status_service = authenticated_status_service()
        made_for_kids = resolve_made_for_kids(status_service, receipt, video_id)
        if made_for_kids is None:
            write_receipt(receipt_file, receipt)
            print(
                f"BLOCKED: could not confirm the made-for-kids setting for {video_id} "
                "before changing its status; a status update without "
                "selfDeclaredMadeForKids can delete that setting.",
                file=sys.stderr,
            )
            print(f"video_id: {video_id}", file=sys.stderr)
            return 6
        receipt["made_for_kids"] = made_for_kids
        synthetic = receipt.get("contains_synthetic_media")
        if isinstance(synthetic, bool):
            response = change_video_status(status_service, video_id, requested_privacy, made_for_kids, synthetic)
        else:
            response = change_video_status(status_service, video_id, requested_privacy, made_for_kids)
        reported_privacy = None
        if isinstance(response, dict):
            reported_privacy = response.get("status", {}).get("privacyStatus")
        if reported_privacy is None:
            # The update call returned something we can't read as a plain
            # confirmation. Reconcile with the platform before deciding
            # anything else, instead of assuming success or retrying blindly.
            reported_privacy = read_actual_privacy(status_service, video_id)
    except Exception as exc:
        # Covers both the update call and the reconciliation read: either way
        # the receipt already on disk (private, public-incomplete) stays the
        # durable, resumable record — never crash out of it uncaught.
        write_receipt(receipt_file, receipt)
        print(f"STATUS CHANGE FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        print(f"UPLOAD COMPLETE (private) / PUBLIC INCOMPLETE ({requested_privacy} not applied)")
        print(f"video_id: {video_id}")
        return 5

    receipt["actual_privacy"] = reported_privacy or receipt["actual_privacy"]
    if reported_privacy == requested_privacy:
        receipt["status_state"] = STATE_COMPLETE
        write_receipt(receipt_file, receipt)
        print(f"UPLOAD COMPLETE ({requested_privacy})")
        print(f"video_id: {video_id}")
        print(f"YouTube Studio: https://studio.youtube.com/video/{video_id}/edit")
        return 0

    receipt["status_state"] = STATE_PUBLIC_INCOMPLETE
    write_receipt(receipt_file, receipt)
    print(
        f"UPLOAD COMPLETE (private) / PUBLIC INCOMPLETE "
        f"(actual status: {receipt['actual_privacy']}, requested: {requested_privacy})",
        file=sys.stderr,
    )
    print(f"video_id: {video_id}")
    return 5


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, default=DEFAULT_PLAN)
    parser.add_argument("--execute", action="store_true")
    # The plan uploads as private unless a person asks for something else here.
    parser.add_argument("--privacy", choices=PRIVACY_CHOICES)
    parser.add_argument(
        "--handoff",
        action="store_true",
        help="Print only the Part 6 whitelist (video URL/id, expected channel) for a "
        "receipt whose status_state is 'complete' (or an equivalent pre-two-step "
        "receipt) AND whose confirmed actual privacy is public or unlisted. Blocks "
        "(exit 6, no output) for a completed-but-private receipt (needs a later "
        "explicit same-ID public/unlisted transition first), and for "
        "public-incomplete, insert-pending, insert-ambiguous, tombstoned, and "
        "authorized-new-attempt receipts. Emits no path, hash, token, secret, or "
        "receipt content.",
    )
    reconcile_group = parser.add_mutually_exclusive_group()
    reconcile_group.add_argument(
        "--reconcile-video-found",
        metavar="VIDEO_ID",
        help="Reconcile a receipt with an unresolved insert attempt (insert-pending "
        "or insert-ambiguous): verify VIDEO_ID via a read-only API lookup (channel, "
        "title, upload time) before transforming the receipt.",
    )
    reconcile_group.add_argument(
        "--reconcile-not-found",
        action="store_true",
        help="Reconcile a receipt with an unresolved insert attempt as having no "
        "matching video: archives it as an audit record and tombstones the active "
        "receipt so this video hash can never be re-inserted by this tool on its own. "
        "Requires --confirm-studio-checked.",
    )
    reconcile_group.add_argument(
        "--authorize-new-attempt",
        metavar="ATTEMPT_ID",
        help="Rare, explicit human control command: transition a tombstoned receipt "
        "into an auditable authorized-new-attempt state recording ATTEMPT_ID (a "
        "never-before-used, 3-32 uppercase-letter/digit id, optionally with up to 4 "
        "'-'-separated segments). Performs zero inserts/updates by itself. Requires "
        "--confirm-duplicate-risk. Only a later, separate normal --execute (no "
        "control-plane flags) may consume this authorization, and doing so performs "
        "exactly one private insert; see COMMANDS.md.",
    )
    parser.add_argument(
        "--confirm-studio-checked",
        action="store_true",
        help="Explicit human confirmation that YouTube Studio was checked. Required by "
        "--reconcile-not-found.",
    )
    parser.add_argument(
        "--confirm-duplicate-risk",
        action="store_true",
        help="Explicit human confirmation that Studio was checked separately and a "
        "genuinely new attempt is authorized despite duplicate-upload risk. Required "
        "by --authorize-new-attempt.",
    )
    args = parser.parse_args()
    control_plane = (
        args.handoff
        or bool(args.reconcile_video_found)
        or args.reconcile_not_found
        or bool(args.authorize_new_attempt)
    )

    try:
        plan = read_json(args.plan.resolve())
    except (OSError, json.JSONDecodeError) as exc:
        print(f"NOT READY: {exc}", file=sys.stderr)
        return 1

    if control_plane:
        # --handoff and both --reconcile-* modes are recovery operations that
        # must stay usable after the MP4/QA report have been moved or are no
        # longer available, so they validate plan metadata only and never
        # read or require the media artifact.
        try:
            actual_hash = validate_plan_metadata(plan)
        except ValueError as exc:
            print(f"NOT READY: {exc}", file=sys.stderr)
            return 1
    else:
        try:
            video, actual_hash = validate_plan(plan)
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            print(f"NOT READY: {exc}", file=sys.stderr)
            return 1

    if args.handoff:
        receipt_file = receipt_file_for_video(actual_hash)
        if not receipt_file.exists():
            print(f"NOT READY: no receipt found for handoff: {receipt_file}", file=sys.stderr)
            return 1
        try:
            receipt = read_json(receipt_file)
        except (OSError, json.JSONDecodeError) as exc:
            print("BLOCKED: receipt file is corrupt or unreadable.", file=sys.stderr)
            print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
            return 6
        try:
            verify_receipt_matches_plan(plan, receipt)
        except ValueError as exc:
            print(f"BLOCKED: receipt does not match the plan: {exc}", file=sys.stderr)
            return 6
        if not receipt_is_handoff_ready(receipt):
            print(f"BLOCKED: {handoff_block_reason(receipt)}", file=sys.stderr)
            return 6
        print_handoff(receipt)
        return 0

    if args.authorize_new_attempt:
        if not args.execute:
            print("NOT READY: --authorize-new-attempt requires --execute.", file=sys.stderr)
            return 1
        try:
            validate_attempt_id(args.authorize_new_attempt)
        except ValueError as exc:
            return blocked(f"invalid attempt id: {exc}")
        if not args.confirm_duplicate_risk:
            return blocked(
                "--authorize-new-attempt requires --confirm-duplicate-risk as an "
                "explicit statement that a human checked YouTube Studio separately "
                "and is authorizing a genuinely new attempt despite duplicate risk."
            )
        receipt_file = receipt_file_for_video(actual_hash)
        if not receipt_file.exists():
            print(f"NOT READY: no receipt to authorize: {receipt_file}", file=sys.stderr)
            return 1
        try:
            receipt = read_json(receipt_file)
        except (OSError, json.JSONDecodeError) as exc:
            print("BLOCKED: receipt file is corrupt or unreadable; cannot authorize.", file=sys.stderr)
            print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
            return 6
        try:
            verify_receipt_matches_plan(plan, receipt)
        except ValueError as exc:
            print(f"BLOCKED: receipt does not match the plan: {exc}", file=sys.stderr)
            return 6
        return authorize_new_attempt(receipt, receipt_file, args.authorize_new_attempt)

    if args.reconcile_video_found or args.reconcile_not_found:
        if not args.execute:
            print(
                "NOT READY: --reconcile-video-found/--reconcile-not-found require --execute.",
                file=sys.stderr,
            )
            return 1
        receipt_file = receipt_file_for_video(actual_hash)
        if not receipt_file.exists():
            print(f"NOT READY: no receipt to reconcile: {receipt_file}", file=sys.stderr)
            return 1
        try:
            receipt = read_json(receipt_file)
        except (OSError, json.JSONDecodeError) as exc:
            print("BLOCKED: receipt file is corrupt or unreadable; cannot reconcile.", file=sys.stderr)
            print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
            return 6
        try:
            verify_receipt_matches_plan(plan, receipt)
        except ValueError as exc:
            print(f"BLOCKED: receipt does not match the plan: {exc}", file=sys.stderr)
            return 6
        if args.reconcile_video_found:
            return reconcile_found(receipt, receipt_file, args.reconcile_video_found)
        return reconcile_not_found(receipt, receipt_file, args.confirm_studio_checked)

    privacy = args.privacy or plan["privacy"]
    print_preview(plan, video, actual_hash, privacy)
    if not args.execute:
        print("PREVIEW ONLY: add --execute to upload.")
        return 0
    # One insert per video file. A retried command finds the receipt and
    # either resumes the status change for that same video id, or — if the
    # last insert's outcome was never learned — blocks instead of inserting
    # again.
    receipt_file = receipt_file_for_video(actual_hash)
    if receipt_file.exists():
        try:
            receipt = read_json(receipt_file)
        except (OSError, json.JSONDecodeError) as exc:
            print(f"BLOCKED: receipt file is corrupt or unreadable: {receipt_file}", file=sys.stderr)
            print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
            print("Never inserting or updating against a receipt that cannot be trusted.", file=sys.stderr)
            return 6
        if receipt.get("state") == STATE_AUTHORIZED_NEW_ATTEMPT:
            # The tool's only path that ever inserts against a video hash
            # that was tombstoned: a plain, separate normal --execute
            # consuming a human's earlier --authorize-new-attempt.
            return consume_authorized_new_attempt(
                receipt, receipt_file, plan, args.plan, video, actual_hash, privacy
            )
        return handle_existing_receipt(receipt, receipt_file, args.plan, plan, args.privacy)

    # Auth failures here happen before any bytes reach videos.insert, so no
    # video can have been created yet; a plain failure (with no durable
    # record) is safe.
    try:
        service = authenticated_upload_service()
    except Exception as exc:
        print(f"UPLOAD FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 4

    # From here on an insert is about to start. Persist intent first so a
    # crash or an exception with an unknown server-side outcome can never be
    # mistaken for "nothing happened" by a later run.
    pending = build_pending_receipt(plan, actual_hash, privacy)
    write_receipt(receipt_file, pending)
    try:
        video_id = upload_video(service, plan, video)
    except Exception as exc:
        # The server may have created the video even though this call
        # failed to observe a clean result (network cut, timeout, missing
        # id in the response, ...). Never infer "no video was created".
        mark_insert_ambiguous(pending, receipt_file, exc)
        print(f"INSERT OUTCOME UNKNOWN: {type(exc).__name__}: {exc}", file=sys.stderr)
        print("BLOCKED: reconcile the real YouTube state before retrying.", file=sys.stderr)
        print_reconcile_instructions(receipt_file, args.plan, None)
        return 6

    # Persist the receipt immediately after the insert succeeds, before any
    # status-change attempt, so the video id/hash is never lost to a later
    # failure.
    receipt = build_receipt(plan, video_id, actual_hash, privacy)
    write_receipt(receipt_file, receipt)
    if privacy == "private":
        print("UPLOAD COMPLETE (private)")
        print(f"video_id: {video_id}")
        print(f"YouTube Studio: https://studio.youtube.com/video/{video_id}/edit")
        return 0
    return apply_status_change(receipt, receipt_file)


if __name__ == "__main__":
    sys.exit(main())
