from __future__ import annotations

import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from unittest.mock import MagicMock, patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("chapter18", ROOT / "scripts/upload_private_video.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class Chapter18TestCase(unittest.TestCase):
    """Shared plan/receipt builders for every Chapter 18 upload test below.
    Mocks only: no network, no OAuth, no reads of .secrets, no live YouTube
    API in any subclass."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.secret_patch = patch.object(MODULE, "SECRET_DIR", self.directory / ".secrets")
        self.secret_patch.start()
        self.addCleanup(self.secret_patch.stop)

    def make_plan(
        self,
        *,
        title: str = "Test video",
        made_for_kids: bool = False,
        privacy: str = "private",
        video_bytes: bytes = b"test-video",
        directory: Optional[Path] = None,
    ) -> dict:
        directory = directory or self.directory
        video = directory / "video.mp4"
        video.write_bytes(video_bytes)
        qa = directory / "qa.json"
        qa.write_text(json.dumps({"status": "PASS", "gate": "UPLOAD READY", "video_sha256": MODULE.sha256(video)}), encoding="utf-8")
        return {
            "channel_handle": "@everyoneisadeveloper",
            "channel_url": "https://www.youtube.com/@everyoneisadeveloper",
            "video": str(video),
            "video_sha256": MODULE.sha256(video),
            "qa_report": str(qa),
            "title": title,
            "description": "preview",
            "tags": ["test"],
            "category_id": "28",
            "made_for_kids": made_for_kids,
            "privacy": privacy,
            "notify_subscribers": False,
        }

    def write_plan(self, plan: dict, directory: Optional[Path] = None) -> Path:
        directory = directory or self.directory
        path = directory / "plan.json"
        path.write_text(json.dumps(plan), encoding="utf-8")
        return path

    def plan_path(self, *, directory: Optional[Path] = None, **overrides) -> Path:
        plan = self.make_plan(directory=directory, **overrides)
        return self.write_plan(plan, directory=directory)

    def receipt_file(self, plan_path: Path) -> Path:
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        return MODULE.receipt_file_for_video(plan["video_sha256"])

    def read_receipt(self, plan_path: Path) -> dict:
        return json.loads(self.receipt_file(plan_path).read_text(encoding="utf-8"))

    def run_main(self, plan_path: Path, *extra_args: str) -> int:
        argv = ["upload_private_video.py", "--plan", str(plan_path), "--execute", *extra_args]
        with patch("sys.argv", argv):
            return MODULE.main()

    def run_handoff(self, plan_path: Path) -> tuple[int, str]:
        argv = ["upload_private_video.py", "--plan", str(plan_path), "--handoff"]
        buffer = io.StringIO()
        with patch("sys.argv", argv), redirect_stdout(buffer):
            code = MODULE.main()
        return code, buffer.getvalue()


class Chapter18UploadTest(Chapter18TestCase):
    def test_valid_plan_returns_the_checked_video(self):
        plan = self.make_plan()
        video, digest = MODULE.validate_plan(plan)
        self.assertEqual(video, Path(plan["video"]))
        self.assertEqual(digest, plan["video_sha256"])

    def test_every_privacy_choice_is_accepted(self):
        for privacy in MODULE.PRIVACY_CHOICES:
            with self.subTest(privacy):
                plan = self.make_plan(privacy=privacy)
                MODULE.validate_plan(plan)

    def test_unknown_privacy_is_rejected(self):
        plan = self.make_plan()
        plan["privacy"] = "everyone"
        with self.assertRaisesRegex(ValueError, "privacy must be one of"):
            MODULE.validate_plan(plan)

    def test_one_receipt_file_per_video(self):
        plan = self.make_plan()
        _, digest = MODULE.validate_plan(plan)
        self.assertEqual(MODULE.receipt_file_for_video(digest), MODULE.receipt_file_for_video(digest))
        self.assertNotEqual(MODULE.receipt_file_for_video(digest), MODULE.receipt_file_for_video("0" * 64))

    def test_changed_video_is_rejected(self):
        plan = self.make_plan()
        Path(plan["video"]).write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            MODULE.validate_plan(plan)

    def test_failed_qa_is_rejected(self):
        plan = self.make_plan()
        Path(plan["qa_report"]).write_text(json.dumps({"status": "FAIL"}), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "not PASS"):
            MODULE.validate_plan(plan)


class Chapter18TwoStepPublishTest(Chapter18TestCase):
    """Covers the private-insert-then-separate-status-change publish flow."""

    def test_public_request_inserts_private_then_changes_status(self):
        plan_path = self.plan_path(privacy="public")
        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
             patch.object(MODULE, "upload_video", return_value="vid-1") as upload, \
             patch.object(MODULE, "authenticated_status_service", return_value=MagicMock()), \
             patch.object(MODULE, "change_video_status", return_value={"status": {"privacyStatus": "public"}}) as update:
            code = self.run_main(plan_path)
        self.assertEqual(code, 0)
        upload.assert_called_once()
        update.assert_called_once_with(update.call_args.args[0], "vid-1", "public", False)
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["status_state"], "complete")
        self.assertEqual(receipt["actual_privacy"], "public")
        self.assertEqual(receipt["requested_privacy"], "public")
        self.assertEqual(receipt["video_id"], "vid-1")
        self.assertEqual(receipt["made_for_kids"], False)

    def test_private_request_never_calls_status_service(self):
        plan_path = self.plan_path(privacy="private")
        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
             patch.object(MODULE, "upload_video", return_value="vid-2"), \
             patch.object(MODULE, "authenticated_status_service") as status_service:
            code = self.run_main(plan_path)
        self.assertEqual(code, 0)
        status_service.assert_not_called()
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["status_state"], "complete")
        self.assertEqual(receipt["actual_privacy"], "private")

    def test_update_failure_keeps_receipt_private_public_incomplete(self):
        plan_path = self.plan_path(privacy="public")
        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
             patch.object(MODULE, "upload_video", return_value="vid-3"), \
             patch.object(MODULE, "authenticated_status_service", return_value=MagicMock()), \
             patch.object(MODULE, "change_video_status", side_effect=RuntimeError("quota exceeded")):
            code = self.run_main(plan_path)
        self.assertEqual(code, 5)
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["status_state"], "public-incomplete")
        self.assertEqual(receipt["actual_privacy"], "private")
        self.assertEqual(receipt["video_id"], "vid-3")

    def test_retry_reuses_receipt_id_and_performs_zero_inserts(self):
        plan_path = self.plan_path(privacy="public")
        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
             patch.object(MODULE, "upload_video", return_value="vid-4") as upload, \
             patch.object(MODULE, "authenticated_status_service", return_value=MagicMock()), \
             patch.object(MODULE, "change_video_status", side_effect=RuntimeError("temporary")):
            first_code = self.run_main(plan_path)
        self.assertEqual(first_code, 5)
        self.assertEqual(upload.call_count, 1)

        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()) as upload_service, \
             patch.object(MODULE, "upload_video") as upload_retry, \
             patch.object(MODULE, "authenticated_status_service", return_value=MagicMock()), \
             patch.object(MODULE, "change_video_status", return_value={"status": {"privacyStatus": "public"}}) as update:
            second_code = self.run_main(plan_path)
        self.assertEqual(second_code, 0)
        upload_service.assert_not_called()
        upload_retry.assert_not_called()
        update.assert_called_once_with(update.call_args.args[0], "vid-4", "public", False)
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["status_state"], "complete")
        self.assertEqual(receipt["actual_privacy"], "public")

    def test_ambiguous_update_response_reconciles_before_success(self):
        plan_path = self.plan_path(privacy="unlisted")
        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
             patch.object(MODULE, "upload_video", return_value="vid-5"), \
             patch.object(MODULE, "authenticated_status_service", return_value=MagicMock()), \
             patch.object(MODULE, "change_video_status", return_value={}), \
             patch.object(MODULE, "read_actual_privacy", return_value="unlisted") as reconcile:
            code = self.run_main(plan_path)
        self.assertEqual(code, 0)
        reconcile.assert_called_once()
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["status_state"], "complete")
        self.assertEqual(receipt["actual_privacy"], "unlisted")

    def test_ambiguous_update_response_reconciles_to_incomplete_when_mismatched(self):
        plan_path = self.plan_path(privacy="public")
        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
             patch.object(MODULE, "upload_video", return_value="vid-6"), \
             patch.object(MODULE, "authenticated_status_service", return_value=MagicMock()), \
             patch.object(MODULE, "change_video_status", return_value={}), \
             patch.object(MODULE, "read_actual_privacy", return_value="private") as reconcile:
            code = self.run_main(plan_path)
        self.assertEqual(code, 5)
        reconcile.assert_called_once()
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["status_state"], "public-incomplete")
        self.assertEqual(receipt["actual_privacy"], "private")

    def test_completed_receipt_blocks_second_run_with_zero_calls(self):
        plan_path = self.plan_path(privacy="public")
        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
             patch.object(MODULE, "upload_video", return_value="vid-7"), \
             patch.object(MODULE, "authenticated_status_service", return_value=MagicMock()), \
             patch.object(MODULE, "change_video_status", return_value={"status": {"privacyStatus": "public"}}):
            first_code = self.run_main(plan_path)
        self.assertEqual(first_code, 0)

        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service") as status_service, \
             patch.object(MODULE, "change_video_status") as update:
            second_code = self.run_main(plan_path)
        self.assertEqual(second_code, 3)
        upload_service.assert_not_called()
        upload.assert_not_called()
        status_service.assert_not_called()
        update.assert_not_called()


class Chapter18LaterExplicitStatusChangeTest(Chapter18TestCase):
    """Covers reopening an already-known video id for a same-ID privacy
    status change on a later, separate invocation, distinct from the
    immediate private-then-status-change flow inside one --execute run.
    Every case here asserts zero videos.insert calls."""

    def complete_private_receipt(self, plan_path: Path, video_id: str = "vid-later-1") -> None:
        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
             patch.object(MODULE, "upload_video", return_value=video_id), \
             patch.object(MODULE, "authenticated_status_service") as status_service:
            code = self.run_main(plan_path)
        self.assertEqual(code, 0)
        status_service.assert_not_called()
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["status_state"], "complete")
        self.assertEqual(receipt["actual_privacy"], "private")

    def test_later_explicit_public_reopens_private_complete_receipt_zero_insert(self):
        plan_path = self.plan_path(privacy="private")
        self.complete_private_receipt(plan_path)

        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service", return_value=MagicMock()), \
             patch.object(
                 MODULE, "change_video_status", return_value={"status": {"privacyStatus": "public"}}
             ) as update:
            code = self.run_main(plan_path, "--privacy", "public")
        self.assertEqual(code, 0)
        upload_service.assert_not_called()
        upload.assert_not_called()
        update.assert_called_once_with(update.call_args.args[0], "vid-later-1", "public", False)
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["status_state"], "complete")
        self.assertEqual(receipt["actual_privacy"], "public")
        self.assertEqual(receipt["requested_privacy"], "public")

    def test_later_explicit_unlisted_reopens_private_complete_receipt_zero_insert(self):
        plan_path = self.plan_path(privacy="private")
        self.complete_private_receipt(plan_path)

        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service", return_value=MagicMock()), \
             patch.object(
                 MODULE, "change_video_status", return_value={"status": {"privacyStatus": "unlisted"}}
             ) as update:
            code = self.run_main(plan_path, "--privacy", "unlisted")
        self.assertEqual(code, 0)
        upload_service.assert_not_called()
        upload.assert_not_called()
        update.assert_called_once_with(update.call_args.args[0], "vid-later-1", "unlisted", False)
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["status_state"], "complete")
        self.assertEqual(receipt["actual_privacy"], "unlisted")

    def test_later_explicit_request_matching_confirmed_privacy_stays_already_uploaded(self):
        plan_path = self.plan_path(privacy="private")
        self.complete_private_receipt(plan_path)

        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service") as status_service, \
             patch.object(MODULE, "change_video_status") as update:
            code = self.run_main(plan_path, "--privacy", "private")
        self.assertEqual(code, 3)
        upload_service.assert_not_called()
        upload.assert_not_called()
        status_service.assert_not_called()
        update.assert_not_called()
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["status_state"], "complete")
        self.assertEqual(receipt["actual_privacy"], "private")

    def test_later_explicit_public_retry_after_update_failure_then_succeeds_zero_insert(self):
        plan_path = self.plan_path(privacy="private")
        self.complete_private_receipt(plan_path)

        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service", return_value=MagicMock()), \
             patch.object(MODULE, "change_video_status", side_effect=RuntimeError("quota exceeded")):
            first_code = self.run_main(plan_path, "--privacy", "public")
        self.assertEqual(first_code, 5)
        upload_service.assert_not_called()
        upload.assert_not_called()
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["status_state"], "public-incomplete")
        self.assertEqual(receipt["requested_privacy"], "public")
        self.assertEqual(receipt["actual_privacy"], "private")

        with patch.object(MODULE, "authenticated_upload_service") as upload_service_retry, \
             patch.object(MODULE, "upload_video") as upload_retry, \
             patch.object(MODULE, "authenticated_status_service", return_value=MagicMock()), \
             patch.object(
                 MODULE, "change_video_status", return_value={"status": {"privacyStatus": "public"}}
             ):
            second_code = self.run_main(plan_path)
        self.assertEqual(second_code, 0)
        upload_service_retry.assert_not_called()
        upload_retry.assert_not_called()
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["status_state"], "complete")
        self.assertEqual(receipt["actual_privacy"], "public")

    def test_identity_mismatch_blocks_explicit_status_change_zero_calls(self):
        plan_path = self.plan_path(privacy="private")
        self.complete_private_receipt(plan_path)
        receipt_file = self.receipt_file(plan_path)
        receipt = json.loads(receipt_file.read_text(encoding="utf-8"))
        receipt["title"] = "A different title now"
        MODULE.write_receipt(receipt_file, receipt)

        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service") as status_service, \
             patch.object(MODULE, "change_video_status") as update:
            code = self.run_main(plan_path, "--privacy", "public")
        self.assertEqual(code, 6)
        upload_service.assert_not_called()
        upload.assert_not_called()
        status_service.assert_not_called()
        update.assert_not_called()
        stored = json.loads(receipt_file.read_text(encoding="utf-8"))
        self.assertEqual(stored["title"], "A different title now")
        self.assertEqual(stored["status_state"], "complete")

    def test_explicit_new_target_while_public_incomplete_retargets_zero_insert(self):
        plan_path = self.plan_path(privacy="public")
        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
             patch.object(MODULE, "upload_video", return_value="vid-later-2"), \
             patch.object(MODULE, "authenticated_status_service", return_value=MagicMock()), \
             patch.object(MODULE, "change_video_status", side_effect=RuntimeError("temporary")):
            first_code = self.run_main(plan_path)
        self.assertEqual(first_code, 5)
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["requested_privacy"], "public")

        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service", return_value=MagicMock()), \
             patch.object(
                 MODULE, "change_video_status", return_value={"status": {"privacyStatus": "unlisted"}}
             ) as update:
            second_code = self.run_main(plan_path, "--privacy", "unlisted")
        self.assertEqual(second_code, 0)
        upload_service.assert_not_called()
        upload.assert_not_called()
        update.assert_called_once_with(update.call_args.args[0], "vid-later-2", "unlisted", False)
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["status_state"], "complete")
        self.assertEqual(receipt["requested_privacy"], "unlisted")
        self.assertEqual(receipt["actual_privacy"], "unlisted")

    def test_public_incomplete_retarget_blocked_on_identity_mismatch_zero_calls(self):
        plan_path = self.plan_path(privacy="public")
        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
             patch.object(MODULE, "upload_video", return_value="vid-later-3"), \
             patch.object(MODULE, "authenticated_status_service", return_value=MagicMock()), \
             patch.object(MODULE, "change_video_status", side_effect=RuntimeError("temporary")):
            first_code = self.run_main(plan_path)
        self.assertEqual(first_code, 5)
        receipt_file = self.receipt_file(plan_path)
        receipt = json.loads(receipt_file.read_text(encoding="utf-8"))
        receipt["channel_handle_expected"] = "@someone-else"
        MODULE.write_receipt(receipt_file, receipt)

        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service") as status_service, \
             patch.object(MODULE, "change_video_status") as update:
            code = self.run_main(plan_path, "--privacy", "unlisted")
        self.assertEqual(code, 6)
        upload_service.assert_not_called()
        upload.assert_not_called()
        status_service.assert_not_called()
        update.assert_not_called()
        stored = json.loads(receipt_file.read_text(encoding="utf-8"))
        self.assertEqual(stored["requested_privacy"], "public")
        self.assertEqual(stored["status_state"], "public-incomplete")

    def test_legacy_private_receipt_explicit_public_reopens_zero_insert(self):
        plan_path = self.plan_path(privacy="public")
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        legacy_receipt = {
            "uploaded_at": "2026-08-01T00:00:00+00:00",
            "video_id": "legacy-vid-later",
            "channel_handle_expected": plan["channel_handle"],
            "privacy": "private",
            "video_sha256": plan["video_sha256"],
            "title": plan["title"],
        }
        MODULE.write_receipt(self.receipt_file(plan_path), legacy_receipt)
        fake_status = FakeStatusService(
            list_items=[{"status": {"selfDeclaredMadeForKids": False, "privacyStatus": "private"}}],
            update_response={"status": {"privacyStatus": "public"}},
        )
        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service", return_value=fake_status):
            code = self.run_main(plan_path, "--privacy", "public")
        self.assertEqual(code, 0)
        upload_service.assert_not_called()
        upload.assert_not_called()
        call = fake_status.videos_resource.update_calls[0]
        self.assertEqual(
            call["body"],
            {"id": "legacy-vid-later", "status": {"privacyStatus": "public", "selfDeclaredMadeForKids": False}},
        )
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["status_state"], "complete")
        self.assertEqual(receipt["actual_privacy"], "public")
        self.assertEqual(receipt["requested_privacy"], "public")
        self.assertNotIn("privacy", receipt)

    def test_legacy_non_private_receipt_ignores_explicit_privacy_zero_calls(self):
        plan_path = self.plan_path(privacy="public")
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        legacy_receipt = {
            "uploaded_at": "2026-08-01T00:00:00+00:00",
            "video_id": "legacy-vid-public",
            "channel_handle_expected": plan["channel_handle"],
            "privacy": "public",
            "video_sha256": plan["video_sha256"],
            "title": plan["title"],
        }
        MODULE.write_receipt(self.receipt_file(plan_path), legacy_receipt)

        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service") as status_service, \
             patch.object(MODULE, "change_video_status") as update:
            code = self.run_main(plan_path, "--privacy", "unlisted")
        self.assertEqual(code, 3)
        upload_service.assert_not_called()
        upload.assert_not_called()
        status_service.assert_not_called()
        update.assert_not_called()

    def test_legacy_private_receipt_identity_mismatch_blocked_zero_calls(self):
        plan_path = self.plan_path(privacy="public")
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        legacy_receipt = {
            "uploaded_at": "2026-08-01T00:00:00+00:00",
            "video_id": "legacy-vid-mismatch",
            "channel_handle_expected": plan["channel_handle"],
            "privacy": "private",
            "video_sha256": plan["video_sha256"],
            "title": "A completely different title",
        }
        MODULE.write_receipt(self.receipt_file(plan_path), legacy_receipt)

        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service") as status_service, \
             patch.object(MODULE, "change_video_status") as update:
            code = self.run_main(plan_path, "--privacy", "public")
        self.assertEqual(code, 6)
        upload_service.assert_not_called()
        upload.assert_not_called()
        status_service.assert_not_called()
        update.assert_not_called()


class FakeInsertRequest:
    def __init__(self, response: dict):
        self._response = response

    def next_chunk(self):
        return None, self._response


class FakeVideosResource:
    def __init__(self, response: dict):
        self._response = response

    def insert(self, **_kwargs):
        return FakeInsertRequest(self._response)


class FakeService:
    """Stands in for the googleapiclient service object so upload_video's
    real chunked-upload logic can run without any network access."""

    def __init__(self, response: dict):
        self._response = response

    def videos(self):
        return FakeVideosResource(self._response)


class Chapter18PendingInsertTest(Chapter18TestCase):
    """Covers the durable pending/ambiguous record around videos.insert."""

    def test_pending_receipt_is_durable_before_insert_is_attempted(self):
        plan_path = self.plan_path()
        seen_state_during_insert = {}

        def fake_upload_video(_service, _plan, _video):
            seen_state_during_insert.update(self.read_receipt(plan_path))
            return "vid-pending-1"

        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
             patch.object(MODULE, "upload_video", side_effect=fake_upload_video):
            code = self.run_main(plan_path)
        self.assertEqual(code, 0)
        self.assertEqual(seen_state_during_insert["state"], "insert-pending")
        self.assertIsNone(seen_state_during_insert["video_id"])

    def test_insert_exception_leaves_ambiguous_receipt_and_blocks(self):
        plan_path = self.plan_path()
        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
             patch.object(MODULE, "upload_video", side_effect=RuntimeError("connection reset")):
            code = self.run_main(plan_path)
        self.assertEqual(code, 6)
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["state"], "insert-ambiguous")
        self.assertIsNone(receipt["video_id"])
        self.assertIn("connection reset", receipt["error"])

    def test_missing_id_response_is_treated_as_ambiguous_not_success(self):
        plan_path = self.plan_path()
        fake_service = FakeService({"status": "processed"})  # no "id" key
        fake_deps = (MagicMock(), MagicMock(), MagicMock(), MagicMock(), Exception, MagicMock())
        with patch.object(MODULE, "authenticated_upload_service", return_value=fake_service), \
             patch.object(MODULE, "google_dependencies", return_value=fake_deps):
            code = self.run_main(plan_path)
        self.assertEqual(code, 6)
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["state"], "insert-ambiguous")
        self.assertIsNone(receipt["video_id"])
        self.assertIn("video id", receipt["error"])

    def test_rerun_after_ambiguous_insert_blocks_without_reinserting(self):
        plan_path = self.plan_path()
        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
             patch.object(MODULE, "upload_video", side_effect=RuntimeError("timeout")):
            first_code = self.run_main(plan_path)
        self.assertEqual(first_code, 6)

        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload:
            second_code = self.run_main(plan_path)
        self.assertEqual(second_code, 6)
        upload_service.assert_not_called()
        upload.assert_not_called()
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["state"], "insert-ambiguous")

    def test_normal_success_transitions_pending_state_to_complete_receipt(self):
        plan_path = self.plan_path()
        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
             patch.object(MODULE, "upload_video", return_value="vid-pending-2"):
            code = self.run_main(plan_path)
        self.assertEqual(code, 0)
        receipt = self.read_receipt(plan_path)
        self.assertNotIn("state", receipt)
        self.assertEqual(receipt["status_state"], "complete")
        self.assertEqual(receipt["video_id"], "vid-pending-2")

    def test_legacy_receipt_blocks_reupload_with_zero_calls(self):
        plan_path = self.plan_path(privacy="public")
        legacy_receipt = {
            "uploaded_at": "2026-08-01T00:00:00+00:00",
            "video_id": "legacy-vid",
            "channel_handle_expected": "@everyoneisadeveloper",
            "privacy": "private",
            "video_sha256": json.loads(plan_path.read_text(encoding="utf-8"))["video_sha256"],
            "title": "Test video",
        }
        MODULE.write_receipt(self.receipt_file(plan_path), legacy_receipt)

        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service") as status_service, \
             patch.object(MODULE, "change_video_status") as update:
            code = self.run_main(plan_path)
        self.assertEqual(code, 3)
        upload_service.assert_not_called()
        upload.assert_not_called()
        status_service.assert_not_called()
        update.assert_not_called()

    def test_malformed_receipt_without_video_id_blocks_instead_of_inserting_or_updating(self):
        plan_path = self.plan_path(privacy="public")
        malformed_receipt = {"status_state": "public-incomplete"}  # no video_id at all
        MODULE.write_receipt(self.receipt_file(plan_path), malformed_receipt)

        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service") as status_service, \
             patch.object(MODULE, "change_video_status") as update:
            code = self.run_main(plan_path)
        self.assertEqual(code, 6)
        upload_service.assert_not_called()
        upload.assert_not_called()
        status_service.assert_not_called()
        update.assert_not_called()

    def test_zero_live_access_across_pending_success_and_ambiguous_paths(self):
        blocked = MagicMock(side_effect=AssertionError("must not touch the real Google API client"))
        first_plan_path = self.plan_path(directory=self._mkdir("first"))
        second_plan_path = self.plan_path(directory=self._mkdir("second"), video_bytes=b"test-video-2")

        with patch.object(MODULE, "google_dependencies", blocked):
            with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
                 patch.object(MODULE, "upload_video", return_value="vid-pending-3"):
                success_code = self.run_main(first_plan_path)
            self.assertEqual(success_code, 0)

            with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
                 patch.object(MODULE, "upload_video", side_effect=RuntimeError("dropped connection")):
                ambiguous_code = self.run_main(second_plan_path)
            self.assertEqual(ambiguous_code, 6)
        blocked.assert_not_called()

    def _mkdir(self, name: str) -> Path:
        directory = self.directory / name
        directory.mkdir()
        return directory


class FakeExecutable:
    def __init__(self, response: dict):
        self._response = response

    def execute(self):
        return self._response


class FakeVideosStatusResource:
    def __init__(self, list_items: Optional[list], update_response: Optional[dict]):
        self._list_items = [] if list_items is None else list_items
        self._update_response = {} if update_response is None else update_response
        self.update_calls: list[dict] = []
        self.list_calls: list[dict] = []

    def list(self, part=None, id=None):
        self.list_calls.append({"part": part, "id": id})
        return FakeExecutable({"items": self._list_items})

    def update(self, part=None, body=None):
        self.update_calls.append({"part": part, "body": body})
        return FakeExecutable(self._update_response)


class FakeChannelsResource:
    def __init__(self, own_channel_id: Optional[str], handle_to_id: Optional[dict] = None):
        self._own_channel_id = own_channel_id
        self._handle_to_id = {"@everyoneisadeveloper": "channel-own"} if handle_to_id is None else handle_to_id

    def list(self, part=None, mine=None, forHandle=None):
        if forHandle is not None:
            channel_id = self._handle_to_id.get(forHandle)
            items = [{"id": channel_id}] if channel_id else []
            return FakeExecutable({"items": items})
        items = [{"id": self._own_channel_id}] if self._own_channel_id else []
        return FakeExecutable({"items": items})


class FakeStatusService:
    """Stands in for the googleapiclient status-scope service. Records every
    videos().update() call so a test can inspect the real request body."""

    def __init__(
        self,
        own_channel_id: Optional[str] = "channel-own",
        list_items: Optional[list] = None,
        update_response: Optional[dict] = None,
        handle_to_id: Optional[dict] = None,
    ):
        self.videos_resource = FakeVideosStatusResource(list_items, update_response)
        self.channels_resource = FakeChannelsResource(own_channel_id, handle_to_id)

    def videos(self):
        return self.videos_resource

    def channels(self):
        return self.channels_resource


class Chapter18MadeForKidsTest(Chapter18TestCase):
    """Covers preserving selfDeclaredMadeForKids across videos.update(part=status)."""

    def test_new_receipt_status_update_body_includes_made_for_kids(self):
        plan_path = self.plan_path(made_for_kids=True, privacy="public")
        fake_status = FakeStatusService(list_items=[{"status": {"selfDeclaredMadeForKids": True}}], update_response={"status": {"privacyStatus": "public"}})
        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
             patch.object(MODULE, "upload_video", return_value="vid-mfk-1"), \
             patch.object(MODULE, "authenticated_status_service", return_value=fake_status):
            code = self.run_main(plan_path)
        self.assertEqual(code, 0)
        self.assertEqual(len(fake_status.videos_resource.update_calls), 1)
        call = fake_status.videos_resource.update_calls[0]
        self.assertEqual(call["part"], "status")
        self.assertEqual(
            call["body"],
            {"id": "vid-mfk-1", "status": {"privacyStatus": "public", "selfDeclaredMadeForKids": True}},
        )

    def test_legacy_known_id_receipt_reads_platform_value_and_preserves_it(self):
        plan_path = self.plan_path(made_for_kids=True, privacy="public")
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        legacy_receipt = {
            "uploaded_at": "2026-08-01T00:00:00+00:00",
            "video_id": "legacy-mfk-1",
            "channel_handle_expected": plan["channel_handle"],
            "video_sha256": plan["video_sha256"],
            "title": plan["title"],
            "requested_privacy": "public",
            "actual_privacy": "private",
            "status_state": "public-incomplete",
            # No "made_for_kids" key: simulates a receipt written before this field existed.
        }
        MODULE.write_receipt(self.receipt_file(plan_path), legacy_receipt)
        fake_status = FakeStatusService(
            list_items=[{"status": {"selfDeclaredMadeForKids": True, "privacyStatus": "private"}}],
            update_response={"status": {"privacyStatus": "public"}},
        )
        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service", return_value=fake_status):
            code = self.run_main(plan_path)
        self.assertEqual(code, 0)
        upload_service.assert_not_called()
        upload.assert_not_called()
        call = fake_status.videos_resource.update_calls[0]
        self.assertEqual(
            call["body"],
            {"id": "legacy-mfk-1", "status": {"privacyStatus": "public", "selfDeclaredMadeForKids": True}},
        )
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["made_for_kids"], True)

    def test_legacy_receipt_blocks_when_platform_value_cannot_be_confirmed(self):
        plan_path = self.plan_path(made_for_kids=True, privacy="public")
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        legacy_receipt = {
            "uploaded_at": "2026-08-01T00:00:00+00:00",
            "video_id": "legacy-mfk-2",
            "channel_handle_expected": plan["channel_handle"],
            "video_sha256": plan["video_sha256"],
            "title": plan["title"],
            "requested_privacy": "public",
            "actual_privacy": "private",
            "status_state": "public-incomplete",
        }
        MODULE.write_receipt(self.receipt_file(plan_path), legacy_receipt)
        fake_status = FakeStatusService(list_items=[])  # videos.list finds nothing to confirm
        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service", return_value=fake_status):
            code = self.run_main(plan_path)
        self.assertEqual(code, 6)
        upload_service.assert_not_called()
        upload.assert_not_called()
        self.assertEqual(fake_status.videos_resource.update_calls, [])
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["status_state"], "public-incomplete")
        self.assertNotIn("made_for_kids", receipt)


class Chapter18ReconciliationTest(Chapter18TestCase):
    """Covers --reconcile-video-found / --reconcile-not-found for a receipt
    with an unresolved insert attempt (insert-pending or insert-ambiguous)."""

    def write_recoverable_receipt(
        self,
        plan_path: Path,
        *,
        state: str = MODULE.STATE_INSERT_AMBIGUOUS,
        requested_privacy: str = "private",
        started_at: Optional[str] = None,
    ) -> dict:
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        started_at = started_at or datetime.now(timezone.utc).isoformat()
        receipt = {
            "state": state,
            "started_at": started_at,
            "channel_handle_expected": plan["channel_handle"],
            "video_sha256": plan["video_sha256"],
            "title": plan["title"],
            "requested_privacy": requested_privacy,
            "made_for_kids": plan["made_for_kids"],
            "video_id": None,
        }
        if state == MODULE.STATE_INSERT_AMBIGUOUS:
            receipt["failed_at"] = started_at
            receipt["error"] = "RuntimeError: connection reset"
        MODULE.write_receipt(self.receipt_file(plan_path), receipt)
        return receipt

    def matching_video_item(self, receipt: dict, own_channel_id: str = "channel-own") -> dict:
        return {
            "snippet": {
                "channelId": own_channel_id,
                "title": receipt["title"],
                "publishedAt": receipt["started_at"],
            },
            "status": {
                "privacyStatus": receipt["requested_privacy"],
                "selfDeclaredMadeForKids": receipt["made_for_kids"],
            },
        }

    def test_reconcile_found_verified_match_completes_for_pending_and_ambiguous(self):
        for state in (MODULE.STATE_INSERT_PENDING, MODULE.STATE_INSERT_AMBIGUOUS):
            with self.subTest(state):
                plan_path = self.plan_path()
                receipt = self.write_recoverable_receipt(plan_path, state=state, requested_privacy="private")
                item = self.matching_video_item(receipt)
                fake_status = FakeStatusService(own_channel_id="channel-own", list_items=[item])
                with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
                     patch.object(MODULE, "upload_video") as upload, \
                     patch.object(MODULE, "authenticated_status_service", return_value=fake_status):
                    code = self.run_main(plan_path, "--reconcile-video-found", f"vid-{state}")
                self.assertEqual(code, 0)
                upload_service.assert_not_called()
                upload.assert_not_called()
                self.assertEqual(fake_status.videos_resource.update_calls, [])
                updated = self.read_receipt(plan_path)
                self.assertEqual(updated["video_id"], f"vid-{state}")
                self.assertEqual(updated["status_state"], "complete")
                self.assertNotIn("state", updated)

    def test_reconcile_found_verified_match_stays_public_incomplete(self):
        plan_path = self.plan_path()
        receipt = self.write_recoverable_receipt(plan_path, requested_privacy="public")
        item = self.matching_video_item(receipt)
        item["status"]["privacyStatus"] = "private"  # not yet transitioned to the request
        fake_status = FakeStatusService(own_channel_id="channel-own", list_items=[item])
        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service", return_value=fake_status):
            code = self.run_main(plan_path, "--reconcile-video-found", "vid-found-2")
        self.assertEqual(code, 5)
        upload_service.assert_not_called()
        upload.assert_not_called()
        self.assertEqual(fake_status.videos_resource.update_calls, [])
        updated = self.read_receipt(plan_path)
        self.assertEqual(updated["video_id"], "vid-found-2")
        self.assertEqual(updated["status_state"], "public-incomplete")

    def test_reconcile_found_blocks_on_verification_mismatches(self):
        """Every read-only check reconcile_found performs must independently
        stay BLOCKED (zero inserts/updates, receipt untouched) when it fails,
        instead of falling through to a success path."""

        def drop_privacy_status(item):
            del item["status"]["privacyStatus"]

        def drop_made_for_kids(item):
            del item["status"]["selfDeclaredMadeForKids"]

        def flip_made_for_kids(item):
            item["status"]["selfDeclaredMadeForKids"] = not item["status"]["selfDeclaredMadeForKids"]

        scenarios = {
            "wrong_video_id": dict(list_items=[]),
            "wrong_channel": dict(mutate=lambda item: item["snippet"].update(channelId="someone-elses-channel")),
            # A wrong Brand account can still pass channels.list(mine=true)
            # and still own a video; it must not match the receipt's expected
            # channel resolved independently via channels.list(forHandle=...).
            "wrong_brand_account": dict(
                own_channel_id="wrong-brand-account",
                mutate=lambda item: item["snippet"].update(channelId="wrong-brand-account"),
            ),
            # The expected handle itself resolves to nothing: must block
            # rather than fall back to trusting whichever account authenticated.
            "unresolvable_expected_handle": dict(handle_to_id={}),
            "wrong_title": dict(mutate=lambda item: item["snippet"].update(title="A completely different title")),
            "implausible_time": dict(
                mutate=lambda item: item["snippet"].update(
                    publishedAt=(datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
                )
            ),
            # Anchoring the tolerance window only to now() would let a
            # same-title video uploaded long after the attempt pass whenever
            # reconciliation itself runs late; started_at must anchor both bounds.
            "late_reconciliation_same_title": dict(
                started_at=(datetime.now(timezone.utc) - timedelta(days=10)).isoformat(),
                published_at=datetime.now(timezone.utc).isoformat(),
            ),
            "missing_privacy_status": dict(mutate=drop_privacy_status),
            "missing_made_for_kids": dict(mutate=drop_made_for_kids),
            "mismatched_made_for_kids": dict(mutate=flip_made_for_kids),
        }
        for name, opts in scenarios.items():
            with self.subTest(name):
                plan_path = self.plan_path()
                own_channel_id = opts.get("own_channel_id", "channel-own")
                receipt = self.write_recoverable_receipt(plan_path, started_at=opts.get("started_at"))
                item = self.matching_video_item(receipt, own_channel_id=own_channel_id)
                if "published_at" in opts:
                    item["snippet"]["publishedAt"] = opts["published_at"]
                if "mutate" in opts:
                    opts["mutate"](item)
                fake_status = FakeStatusService(
                    own_channel_id=own_channel_id,
                    list_items=opts.get("list_items", [item]),
                    handle_to_id=opts.get("handle_to_id"),
                )
                with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
                     patch.object(MODULE, "upload_video") as upload, \
                     patch.object(MODULE, "authenticated_status_service", return_value=fake_status):
                    code = self.run_main(plan_path, "--reconcile-video-found", f"vid-{name}")
                self.assertEqual(code, 6, name)
                upload_service.assert_not_called()
                upload.assert_not_called()
                self.assertEqual(fake_status.videos_resource.update_calls, [])
                unchanged = self.read_receipt(plan_path)
                self.assertEqual(unchanged["state"], "insert-ambiguous", name)

    def test_reconcile_found_malformed_receipt_blocks_cleanly_without_keyerror(self):
        # Matches the plan on every field verify_receipt_matches_plan checks
        # (title/channel/hash/made_for_kids), so this isolates the internal
        # validate_recoverable_receipt_schema check inside reconcile_found
        # itself: "requested_privacy" is missing, which is malformed-but-
        # valid JSON that must not raise a bare KeyError.
        plan_path = self.plan_path()
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        malformed_receipt = {
            "state": "insert-ambiguous",
            "channel_handle_expected": plan["channel_handle"],
            "video_sha256": plan["video_sha256"],
            "title": plan["title"],
            # "requested_privacy" is missing: malformed-but-valid JSON.
            "made_for_kids": plan["made_for_kids"],
            "started_at": datetime.now(timezone.utc).isoformat(),
            "video_id": None,
        }
        MODULE.write_receipt(self.receipt_file(plan_path), malformed_receipt)
        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service") as status_service:
            code = self.run_main(plan_path, "--reconcile-video-found", "vid-malformed")
        self.assertEqual(code, 6)
        upload_service.assert_not_called()
        upload.assert_not_called()
        status_service.assert_not_called()
        unchanged = self.read_receipt(plan_path)
        self.assertNotIn("requested_privacy", unchanged)

    def test_reconcile_on_completed_receipt_is_blocked(self):
        plan_path = self.plan_path()
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        complete_receipt = {
            "video_id": "already-done",
            "channel_handle_expected": plan["channel_handle"],
            "video_sha256": plan["video_sha256"],
            "title": plan["title"],
            "requested_privacy": "private",
            "actual_privacy": "private",
            "made_for_kids": False,
            "status_state": "complete",
        }
        MODULE.write_receipt(self.receipt_file(plan_path), complete_receipt)
        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload:
            code = self.run_main(plan_path, "--reconcile-video-found", "vid-x")
        self.assertEqual(code, 6)
        upload_service.assert_not_called()
        upload.assert_not_called()

    def test_reconcile_not_found_requires_explicit_confirmation(self):
        plan_path = self.plan_path()
        self.write_recoverable_receipt(plan_path)
        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload:
            code = self.run_main(plan_path, "--reconcile-not-found")
        self.assertEqual(code, 6)
        upload_service.assert_not_called()
        upload.assert_not_called()
        # Not confirmed: receipt is untouched, nothing archived.
        self.assertTrue(self.receipt_file(plan_path).exists())
        unchanged = self.read_receipt(plan_path)
        self.assertEqual(unchanged["state"], "insert-ambiguous")

    def test_reconcile_not_found_tombstones_pending_and_ambiguous_with_zero_inserts(self):
        for state in (MODULE.STATE_INSERT_PENDING, MODULE.STATE_INSERT_AMBIGUOUS):
            with self.subTest(state):
                # Distinct video content per state so each gets its own
                # receipt/archive path instead of colliding on one hash.
                plan_path = self.plan_path(video_bytes=f"video-{state}".encode())
                self.write_recoverable_receipt(plan_path, state=state)
                with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
                     patch.object(MODULE, "upload_video") as upload:
                    code = self.run_main(plan_path, "--reconcile-not-found", "--confirm-studio-checked")
                self.assertEqual(code, 2)
                upload_service.assert_not_called()
                upload.assert_not_called()
                # The active receipt stays in place, tombstoned — never unlinked.
                self.assertTrue(self.receipt_file(plan_path).exists())
                tombstoned = self.read_receipt(plan_path)
                self.assertEqual(tombstoned["state"], "tombstone")
                self.assertIsNone(tombstoned["video_id"])
                archive_dir = self.receipt_file(plan_path).parent / "archive"
                archived_files = list(archive_dir.glob(f"{self.receipt_file(plan_path).stem}-archived-*.json"))
                self.assertEqual(len(archived_files), 1)
                archived = json.loads(archived_files[0].read_text(encoding="utf-8"))
                self.assertEqual(archived["state"], state)
                self.assertIn("archived_at", archived)

    def test_rerun_after_tombstone_never_inserts_again(self):
        plan_path = self.plan_path()
        self.write_recoverable_receipt(plan_path)
        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload:
            tombstone_code = self.run_main(plan_path, "--reconcile-not-found", "--confirm-studio-checked")
        self.assertEqual(tombstone_code, 2)

        # A later, separate normal run must still perform zero inserts: a
        # Studio snapshot is not permission to insert again, ever.
        with patch.object(MODULE, "authenticated_upload_service") as normal_upload_service, \
             patch.object(MODULE, "upload_video") as normal_upload:
            normal_code = self.run_main(plan_path)
        self.assertEqual(normal_code, 6)
        normal_upload_service.assert_not_called()
        normal_upload.assert_not_called()
        self.assertEqual(self.read_receipt(plan_path)["state"], "tombstone")

        # Reconciliation is not an unlock either: it stays blocked too, with
        # no CLI path in this tool to reverse a tombstone.
        with patch.object(MODULE, "authenticated_upload_service") as reconcile_upload_service, \
             patch.object(MODULE, "upload_video") as reconcile_upload:
            reconcile_code = self.run_main(plan_path, "--reconcile-not-found", "--confirm-studio-checked")
        self.assertEqual(reconcile_code, 6)
        reconcile_upload_service.assert_not_called()
        reconcile_upload.assert_not_called()

    def test_reconcile_flags_require_execute(self):
        plan_path = self.plan_path()
        self.write_recoverable_receipt(plan_path)
        argv = ["upload_private_video.py", "--plan", str(plan_path), "--reconcile-not-found", "--confirm-studio-checked"]
        with patch("sys.argv", argv), \
             patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload:
            code = MODULE.main()
        self.assertEqual(code, 1)
        upload_service.assert_not_called()
        upload.assert_not_called()
        self.assertTrue(self.receipt_file(plan_path).exists())

    def test_corrupt_receipt_json_blocks_cleanly_with_zero_inserts_on_every_entrypoint(self):
        for extra_args in ((), ("--reconcile-video-found", "vid-x"), ("--reconcile-not-found", "--confirm-studio-checked")):
            with self.subTest(extra_args):
                plan_path = self.plan_path()
                self.receipt_file(plan_path).parent.mkdir(parents=True, exist_ok=True)
                self.receipt_file(plan_path).write_text("{not valid json", encoding="utf-8")
                with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
                     patch.object(MODULE, "upload_video") as upload, \
                     patch.object(MODULE, "authenticated_status_service") as status_service, \
                     patch.object(MODULE, "change_video_status") as update:
                    code = self.run_main(plan_path, *extra_args)
                self.assertEqual(code, 6, extra_args)
                upload_service.assert_not_called()
                upload.assert_not_called()
                status_service.assert_not_called()
                update.assert_not_called()
                # Never crashes with a traceback and never touches the corrupt file.
                self.assertEqual(self.receipt_file(plan_path).read_text(encoding="utf-8"), "{not valid json")


class Chapter18AuthorizeNewAttemptTest(Chapter18TestCase):
    """Covers --authorize-new-attempt (zero-insert control-plane transition
    out of a tombstone) and its one-shot consumption by a later, separate
    normal --execute."""

    def tombstone(self, plan_path: Path, *, requested_privacy: str = "private") -> None:
        started_at = datetime.now(timezone.utc).isoformat()
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        receipt = {
            "state": MODULE.STATE_INSERT_AMBIGUOUS,
            "started_at": started_at,
            "failed_at": started_at,
            "error": "RuntimeError: connection reset",
            "channel_handle_expected": plan["channel_handle"],
            "video_sha256": plan["video_sha256"],
            "title": plan["title"],
            "requested_privacy": requested_privacy,
            "made_for_kids": plan["made_for_kids"],
            "video_id": None,
        }
        MODULE.write_receipt(self.receipt_file(plan_path), receipt)
        with patch.object(MODULE, "authenticated_upload_service"), \
             patch.object(MODULE, "upload_video"):
            code = self.run_main(plan_path, "--reconcile-not-found", "--confirm-studio-checked")
        self.assertEqual(code, 2)

    def authorize(self, plan_path: Path, attempt_id: str, *, confirm: bool = True) -> int:
        extra = ["--authorize-new-attempt", attempt_id]
        if confirm:
            extra.append("--confirm-duplicate-risk")
        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload:
            code = self.run_main(plan_path, *extra)
        upload_service.assert_not_called()
        upload.assert_not_called()
        return code

    def test_authorize_requires_execute(self):
        plan_path = self.plan_path()
        self.tombstone(plan_path)
        argv = [
            "upload_private_video.py", "--plan", str(plan_path),
            "--authorize-new-attempt", "REATTEMPT-1", "--confirm-duplicate-risk",
        ]
        with patch("sys.argv", argv), \
             patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload:
            code = MODULE.main()
        self.assertEqual(code, 1)
        upload_service.assert_not_called()
        upload.assert_not_called()
        self.assertEqual(self.read_receipt(plan_path)["state"], "tombstone")

    def test_authorize_requires_confirm_duplicate_risk(self):
        plan_path = self.plan_path()
        self.tombstone(plan_path)
        code = self.authorize(plan_path, "REATTEMPT-1", confirm=False)
        self.assertEqual(code, 6)
        self.assertEqual(self.read_receipt(plan_path)["state"], "tombstone")

    def test_authorize_rejects_invalid_attempt_id_formats(self):
        plan_path = self.plan_path()
        self.tombstone(plan_path)
        for bad_id in ("lowercase-id", "AB", "has a space", "toolong" * 10, "trailing-", "under_score"):
            with self.subTest(bad_id):
                code = self.authorize(plan_path, bad_id)
                self.assertEqual(code, 6, bad_id)
                self.assertEqual(self.read_receipt(plan_path)["state"], "tombstone", bad_id)

    def test_authorize_blocks_on_non_tombstoned_states(self):
        plan_path = self.plan_path()
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        non_tombstoned = {
            "insert-pending": {
                "state": "insert-pending",
                "started_at": "2026-09-01T00:00:00+00:00",
                "channel_handle_expected": plan["channel_handle"],
                "video_sha256": plan["video_sha256"],
                "title": plan["title"],
                "requested_privacy": "private",
                "made_for_kids": plan["made_for_kids"],
                "video_id": None,
            },
            "complete": {
                "uploaded_at": "2026-09-01T00:00:00+00:00",
                "video_id": "vid-x",
                "channel_handle_expected": plan["channel_handle"],
                "video_sha256": plan["video_sha256"],
                "title": plan["title"],
                "requested_privacy": "private",
                "actual_privacy": "private",
                "made_for_kids": plan["made_for_kids"],
                "status_state": "complete",
            },
        }
        for name, receipt in non_tombstoned.items():
            with self.subTest(name):
                MODULE.write_receipt(self.receipt_file(plan_path), receipt)
                code = self.authorize(plan_path, f"REATTEMPT-{name.upper()}")
                self.assertEqual(code, 6, name)
                self.assertNotEqual(self.read_receipt(plan_path).get("state"), "authorized-new-attempt", name)

    def test_authorize_blocks_on_plan_mismatch_zero_insert(self):
        plan_path = self.plan_path()
        self.tombstone(plan_path)
        receipt = self.read_receipt(plan_path)
        receipt["title"] = "A totally different recorded title"
        MODULE.write_receipt(self.receipt_file(plan_path), receipt)
        code = self.authorize(plan_path, "REATTEMPT-1")
        self.assertEqual(code, 6)
        self.assertEqual(self.read_receipt(plan_path)["state"], "tombstone")

    def test_authorize_success_zero_insert_and_records_lineage(self):
        plan_path = self.plan_path()
        self.tombstone(plan_path)
        code = self.authorize(plan_path, "REATTEMPT-2026-09-14")
        self.assertEqual(code, 7)
        authorized = self.read_receipt(plan_path)
        self.assertEqual(authorized["state"], "authorized-new-attempt")
        self.assertEqual(authorized["authorized_attempt_id"], "REATTEMPT-2026-09-14")
        self.assertTrue(authorized["confirmed_duplicate_risk"])
        self.assertIsNone(authorized["video_id"])
        self.assertIn("archived_tombstone", authorized)
        archived = json.loads(Path(authorized["archived_tombstone"]).read_text(encoding="utf-8"))
        self.assertEqual(archived["state"], "tombstone")

    def test_authorize_blocks_reused_attempt_id(self):
        plan_path = self.plan_path()
        self.tombstone(plan_path)
        first_code = self.authorize(plan_path, "REATTEMPT-DUP")
        self.assertEqual(first_code, 7)

        # Consume it, then get tombstoned again via a fresh failed attempt,
        # so the receipt is a tombstone again but the id has already been
        # spent once for this video hash.
        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
             patch.object(MODULE, "upload_video", side_effect=RuntimeError("dropped")):
            consume_code = self.run_main(plan_path)
        self.assertEqual(consume_code, 6)
        self.assertEqual(self.read_receipt(plan_path)["state"], "insert-ambiguous")
        with patch.object(MODULE, "authenticated_upload_service"), \
             patch.object(MODULE, "upload_video"):
            retomb_code = self.run_main(plan_path, "--reconcile-not-found", "--confirm-studio-checked")
        self.assertEqual(retomb_code, 2)

        reused_code = self.authorize(plan_path, "REATTEMPT-DUP")
        self.assertEqual(reused_code, 6)
        self.assertEqual(self.read_receipt(plan_path)["state"], "tombstone")

    def test_authorize_blocks_when_archive_history_cannot_be_trusted(self):
        # BLOCKER 2: a corrupt/unreadable archive candidate must never be
        # skipped and treated as "not used" — that would fail open and let
        # a duplicate attempt id through undetected.
        plan_path = self.plan_path()
        self.tombstone(plan_path)
        receipt_file = self.receipt_file(plan_path)
        archive_dir = receipt_file.parent / "archive"
        archive_dir.mkdir(parents=True, exist_ok=True)
        corrupt = archive_dir / f"{receipt_file.stem}-archived-brokenfile.json"
        corrupt.write_text("{not valid json", encoding="utf-8")
        receipt_before = self.read_receipt(plan_path)

        code = self.authorize(plan_path, "REATTEMPT-TRUST")

        self.assertEqual(code, 6)
        self.assertEqual(self.read_receipt(plan_path), receipt_before)

    def test_authorize_blocks_when_archive_candidate_is_not_a_json_object(self):
        plan_path = self.plan_path()
        self.tombstone(plan_path)
        receipt_file = self.receipt_file(plan_path)
        archive_dir = receipt_file.parent / "archive"
        archive_dir.mkdir(parents=True, exist_ok=True)
        not_an_object = archive_dir / f"{receipt_file.stem}-archived-listshaped.json"
        not_an_object.write_text("[1, 2, 3]", encoding="utf-8")
        receipt_before = self.read_receipt(plan_path)

        code = self.authorize(plan_path, "REATTEMPT-TRUST-2")

        self.assertEqual(code, 6)
        self.assertEqual(self.read_receipt(plan_path), receipt_before)

    def test_consume_performs_exactly_one_insert_and_completes(self):
        plan_path = self.plan_path()
        self.tombstone(plan_path)
        self.assertEqual(self.authorize(plan_path, "REATTEMPT-CONSUME"), 7)

        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()) as upload_service, \
             patch.object(MODULE, "upload_video", return_value="vid-consumed") as upload:
            code = self.run_main(plan_path)
        self.assertEqual(code, 0)
        upload_service.assert_called_once()
        upload.assert_called_once()
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["video_id"], "vid-consumed")
        self.assertEqual(receipt["status_state"], "complete")
        self.assertNotIn("state", receipt)

        # Rerunning again performs zero further inserts.
        with patch.object(MODULE, "authenticated_upload_service") as second_service, \
             patch.object(MODULE, "upload_video") as second_upload:
            rerun_code = self.run_main(plan_path)
        self.assertEqual(rerun_code, 3)
        second_service.assert_not_called()
        second_upload.assert_not_called()

    def test_consume_crash_after_consuming_leaves_ambiguous_and_blocks_rerun(self):
        plan_path = self.plan_path()
        self.tombstone(plan_path)
        self.assertEqual(self.authorize(plan_path, "REATTEMPT-CRASH"), 7)

        with patch.object(MODULE, "authenticated_upload_service", return_value=MagicMock()), \
             patch.object(MODULE, "upload_video", side_effect=RuntimeError("connection reset")):
            code = self.run_main(plan_path)
        self.assertEqual(code, 6)
        receipt = self.read_receipt(plan_path)
        self.assertEqual(receipt["state"], "insert-ambiguous")
        self.assertIsNone(receipt["video_id"])
        self.assertEqual(receipt["consumed_attempt_id"], "REATTEMPT-CRASH")

        # A bare rerun must never silently re-consume or re-insert.
        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload:
            rerun_code = self.run_main(plan_path)
        self.assertEqual(rerun_code, 6)
        upload_service.assert_not_called()
        upload.assert_not_called()
        self.assertEqual(self.read_receipt(plan_path)["state"], "insert-ambiguous")

    def test_consume_blocks_on_malformed_authorized_receipt(self):
        # BLOCKER 1: a JSON-valid but incomplete/wrong-type/wrong-value
        # authorized receipt must block consumption with zero auth/insert/
        # update, and the receipt on disk must stay exactly as it was.
        plan_path = self.plan_path()
        self.tombstone(plan_path)
        self.assertEqual(self.authorize(plan_path, "REATTEMPT-MALFORMED"), 7)
        baseline = self.read_receipt(plan_path)

        def missing_attempt_id(r):
            del r["authorized_attempt_id"]

        def invalid_attempt_id_format(r):
            r["authorized_attempt_id"] = "not a valid id!!"

        def duplicate_risk_false(r):
            r["confirmed_duplicate_risk"] = False

        def duplicate_risk_missing(r):
            del r["confirmed_duplicate_risk"]

        def duplicate_risk_truthy_not_bool(r):
            r["confirmed_duplicate_risk"] = "true"

        def authorized_at_missing(r):
            del r["authorized_at"]

        def authorized_at_empty(r):
            r["authorized_at"] = ""

        def authorized_at_naive(r):
            r["authorized_at"] = "2026-09-14T00:00:00"

        def authorized_at_garbage(r):
            r["authorized_at"] = "not-a-timestamp"

        def lineage_prior_tombstoned_at_missing(r):
            del r["prior_tombstoned_at"]

        def lineage_prior_tombstoned_at_naive(r):
            r["prior_tombstoned_at"] = "2026-09-14T00:00:00"

        def lineage_prior_archived_attempt_missing(r):
            del r["prior_archived_attempt"]

        def lineage_prior_archived_attempt_empty(r):
            r["prior_archived_attempt"] = ""

        def lineage_archived_tombstone_missing(r):
            del r["archived_tombstone"]

        def lineage_archived_tombstone_wrong_type(r):
            r["archived_tombstone"] = 12345

        def plan_identity_title_mismatch(r):
            r["title"] = "A totally different recorded title"

        mutations = {
            "missing_attempt_id": missing_attempt_id,
            "invalid_attempt_id_format": invalid_attempt_id_format,
            "duplicate_risk_false": duplicate_risk_false,
            "duplicate_risk_missing": duplicate_risk_missing,
            "duplicate_risk_truthy_not_bool": duplicate_risk_truthy_not_bool,
            "authorized_at_missing": authorized_at_missing,
            "authorized_at_empty": authorized_at_empty,
            "authorized_at_naive": authorized_at_naive,
            "authorized_at_garbage": authorized_at_garbage,
            "lineage_prior_tombstoned_at_missing": lineage_prior_tombstoned_at_missing,
            "lineage_prior_tombstoned_at_naive": lineage_prior_tombstoned_at_naive,
            "lineage_prior_archived_attempt_missing": lineage_prior_archived_attempt_missing,
            "lineage_prior_archived_attempt_empty": lineage_prior_archived_attempt_empty,
            "lineage_archived_tombstone_missing": lineage_archived_tombstone_missing,
            "lineage_archived_tombstone_wrong_type": lineage_archived_tombstone_wrong_type,
            "plan_identity_title_mismatch": plan_identity_title_mismatch,
        }
        for name, mutate in mutations.items():
            with self.subTest(name):
                receipt = dict(baseline)
                mutate(receipt)
                MODULE.write_receipt(self.receipt_file(plan_path), receipt)
                with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
                     patch.object(MODULE, "upload_video") as upload:
                    code = self.run_main(plan_path)
                self.assertEqual(code, 6, name)
                upload_service.assert_not_called()
                upload.assert_not_called()
                self.assertEqual(self.read_receipt(plan_path), receipt, name)

    def test_plain_tombstone_rerun_without_authorization_stays_zero_insert(self):
        plan_path = self.plan_path()
        self.tombstone(plan_path)
        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload:
            code = self.run_main(plan_path)
        self.assertEqual(code, 6)
        upload_service.assert_not_called()
        upload.assert_not_called()
        self.assertEqual(self.read_receipt(plan_path)["state"], "tombstone")

    def test_authorized_receipt_is_not_handoff_ready(self):
        plan_path = self.plan_path()
        self.tombstone(plan_path)
        self.assertEqual(self.authorize(plan_path, "REATTEMPT-HANDOFF"), 7)
        code, output = self.run_handoff(plan_path)
        self.assertEqual(code, 6)
        self.assertEqual(output, "")


class Chapter18HandoffTest(Chapter18TestCase):
    """Covers the Part 6 handoff whitelist output."""

    def test_handoff_emits_only_the_whitelist_for_a_completed_public_receipt(self):
        plan_path = self.plan_path()
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        receipt = {
            "uploaded_at": "2026-09-01T00:00:00+00:00",
            "video_id": "vid-handoff-1",
            "channel_handle_expected": plan["channel_handle"],
            "video_sha256": plan["video_sha256"],
            "title": plan["title"],
            "requested_privacy": "public",
            "actual_privacy": "public",
            "made_for_kids": False,
            "status_state": "complete",
        }
        MODULE.write_receipt(self.receipt_file(plan_path), receipt)
        code, output = self.run_handoff(plan_path)
        self.assertEqual(code, 0)
        lines = [line for line in output.splitlines() if line]
        self.assertEqual(
            lines,
            [
                "video_url: https://www.youtube.com/watch?v=vid-handoff-1",
                "video_id: vid-handoff-1",
                f"expected_channel_identity: {plan['channel_handle']}",
            ],
        )
        sensitive_substrings = [
            str(plan_path), str(self.directory), ".secrets", "sha256", plan["video_sha256"],
            "token", "Token", "receipt", "Receipt", str(self.receipt_file(plan_path)),
            "video.mp4", "qa.json",
        ]
        for needle in sensitive_substrings:
            self.assertNotIn(needle, output, f"handoff output leaked: {needle!r}")

    def test_handoff_blocked_for_every_non_complete_state(self):
        """A public-incomplete receipt is not a completed publishing handoff:
        the three-field whitelist cannot honestly explain that the requested
        privacy never took effect. pending/ambiguous/tombstone are equally
        unfinished and must block the same way."""
        plan_path = self.plan_path()
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        base = dict(
            channel_handle_expected=plan["channel_handle"],
            video_sha256=plan["video_sha256"],
            title=plan["title"],
            made_for_kids=False,
            requested_privacy="private",
        )
        receipts = {
            "public-incomplete": {
                **base,
                "uploaded_at": "2026-09-01T00:00:00+00:00",
                "video_id": "vid-handoff-2",
                "requested_privacy": "public",
                "actual_privacy": "private",
                "status_state": "public-incomplete",
            },
            "insert-pending": {
                **base,
                "state": "insert-pending",
                "started_at": "2026-09-01T00:00:00+00:00",
                "video_id": None,
            },
            "insert-ambiguous": {
                **base,
                "state": "insert-ambiguous",
                "started_at": "2026-09-01T00:00:00+00:00",
                "failed_at": "2026-09-01T00:00:01+00:00",
                "error": "RuntimeError: timeout",
                "video_id": None,
            },
            "tombstone": {
                **base,
                "state": "tombstone",
                "tombstoned_at": "2026-09-01T00:00:00+00:00",
                "video_id": None,
            },
            "authorized-new-attempt": {
                **base,
                "state": "authorized-new-attempt",
                "authorized_attempt_id": "REATTEMPT-1",
                "authorized_at": "2026-09-01T00:00:00+00:00",
                "confirmed_duplicate_risk": True,
                "video_id": None,
            },
            "complete-but-private": {
                **base,
                "uploaded_at": "2026-09-01T00:00:00+00:00",
                "video_id": "vid-handoff-private",
                "actual_privacy": "private",
                "status_state": "complete",
            },
        }
        for name, receipt in receipts.items():
            with self.subTest(name):
                MODULE.write_receipt(self.receipt_file(plan_path), receipt)
                code, output = self.run_handoff(plan_path)
                self.assertEqual(code, 6, name)
                self.assertEqual(output, "", name)

    def test_handoff_blocked_message_explains_private_needs_later_public_transition(self):
        """The completed-but-private case must give a distinct, actionable
        message rather than the generic not-complete explanation."""
        plan_path = self.plan_path()
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        receipt = {
            "uploaded_at": "2026-09-01T00:00:00+00:00",
            "video_id": "vid-handoff-private",
            "channel_handle_expected": plan["channel_handle"],
            "video_sha256": plan["video_sha256"],
            "title": plan["title"],
            "made_for_kids": False,
            "requested_privacy": "private",
            "actual_privacy": "private",
            "status_state": "complete",
        }
        MODULE.write_receipt(self.receipt_file(plan_path), receipt)
        argv = ["upload_private_video.py", "--plan", str(plan_path), "--handoff"]
        stderr = io.StringIO()
        with patch("sys.argv", argv), redirect_stdout(io.StringIO()), redirect_stderr(stderr):
            code = MODULE.main()
        self.assertEqual(code, 6)
        self.assertIn("--privacy public", stderr.getvalue())
        self.assertIn("completed private upload", stderr.getvalue())

    def test_handoff_emits_whitelist_for_completed_unlisted_receipt(self):
        plan_path = self.plan_path()
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        receipt = {
            "uploaded_at": "2026-09-01T00:00:00+00:00",
            "video_id": "vid-handoff-unlisted",
            "channel_handle_expected": plan["channel_handle"],
            "video_sha256": plan["video_sha256"],
            "title": plan["title"],
            "made_for_kids": False,
            "requested_privacy": "unlisted",
            "actual_privacy": "unlisted",
            "status_state": "complete",
        }
        MODULE.write_receipt(self.receipt_file(plan_path), receipt)
        code, output = self.run_handoff(plan_path)
        self.assertEqual(code, 0)
        self.assertIn("video_id: vid-handoff-unlisted", output)

    def test_handoff_blocked_for_legacy_private_receipt(self):
        plan_path = self.plan_path()
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        legacy_receipt = {
            "uploaded_at": "2026-09-01T00:00:00+00:00",
            "video_id": "vid-legacy-private",
            "channel_handle_expected": plan["channel_handle"],
            "video_sha256": plan["video_sha256"],
            "title": plan["title"],
            "privacy": "private",
        }
        MODULE.write_receipt(self.receipt_file(plan_path), legacy_receipt)
        code, output = self.run_handoff(plan_path)
        self.assertEqual(code, 6)
        self.assertEqual(output, "")

    def test_handoff_emits_whitelist_for_legacy_public_receipt(self):
        plan_path = self.plan_path()
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        legacy_receipt = {
            "uploaded_at": "2026-09-01T00:00:00+00:00",
            "video_id": "vid-legacy-public",
            "channel_handle_expected": plan["channel_handle"],
            "video_sha256": plan["video_sha256"],
            "title": plan["title"],
            "privacy": "public",
        }
        MODULE.write_receipt(self.receipt_file(plan_path), legacy_receipt)
        code, output = self.run_handoff(plan_path)
        self.assertEqual(code, 0)
        self.assertIn("video_id: vid-legacy-public", output)

    def test_handoff_blocked_when_no_receipt_exists(self):
        plan_path = self.plan_path()
        code, output = self.run_handoff(plan_path)
        self.assertEqual(code, 1)
        self.assertEqual(output, "")

    def test_handoff_blocked_on_corrupt_receipt_json(self):
        plan_path = self.plan_path()
        self.receipt_file(plan_path).parent.mkdir(parents=True, exist_ok=True)
        self.receipt_file(plan_path).write_text("{not valid json", encoding="utf-8")
        code, output = self.run_handoff(plan_path)
        self.assertEqual(code, 6)
        self.assertEqual(output, "")


class Chapter18AtomicWriteTest(Chapter18TestCase):
    """Covers the durable/atomic receipt write (secure_write) and the
    collision-safe archive filename reservation."""

    def test_write_receipt_sets_owner_only_permissions(self):
        target = self.directory / "sub" / "receipt.json"
        MODULE.write_receipt(target, {"a": 1})
        mode = target.stat().st_mode & 0o777
        self.assertEqual(mode, 0o600)

    def test_write_receipt_leaves_no_temp_file_behind(self):
        target = self.directory / "receipt.json"
        MODULE.write_receipt(target, {"a": 1})
        leftovers = [p for p in target.parent.iterdir() if p.name != target.name]
        self.assertEqual(leftovers, [])

    def test_write_receipt_is_readable_immediately_after_replace(self):
        target = self.directory / "receipt.json"
        MODULE.write_receipt(target, {"a": 1, "b": "two"})
        self.assertEqual(json.loads(target.read_text(encoding="utf-8")), {"a": 1, "b": "two"})

    def test_failed_replace_leaves_existing_target_untouched_and_no_partial_file(self):
        target = self.directory / "receipt.json"
        MODULE.write_receipt(target, {"first": True})
        original = target.read_text(encoding="utf-8")
        with patch("os.replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                MODULE.write_receipt(target, {"second": True})
        self.assertEqual(target.read_text(encoding="utf-8"), original)
        leftovers = [p for p in target.parent.iterdir() if p.name != target.name]
        self.assertEqual(leftovers, [])

    def test_archive_receipt_uses_collision_safe_naming(self):
        receipt_file = self.directory / "private-upload-receipt-abc.json"
        fixed_now = datetime(2026, 9, 14, 12, 0, 0, tzinfo=timezone.utc)
        MODULE.write_receipt(receipt_file, {"state": "insert-ambiguous", "n": 1})
        with patch.object(MODULE, "datetime") as mock_dt:
            mock_dt.now.return_value = fixed_now
            first = MODULE.archive_receipt({"state": "insert-ambiguous", "n": 1}, receipt_file, "test")
        MODULE.write_receipt(receipt_file, {"state": "insert-ambiguous", "n": 2})
        with patch.object(MODULE, "datetime") as mock_dt:
            mock_dt.now.return_value = fixed_now
            second = MODULE.archive_receipt({"state": "insert-ambiguous", "n": 2}, receipt_file, "test")
        self.assertNotEqual(first, second)
        self.assertTrue(first.exists())
        self.assertTrue(second.exists())
        self.assertEqual(json.loads(first.read_text(encoding="utf-8"))["n"], 1)
        self.assertEqual(json.loads(second.read_text(encoding="utf-8"))["n"], 2)
        # archive_receipt never touches the active receipt file itself.
        self.assertEqual(json.loads(receipt_file.read_text(encoding="utf-8"))["n"], 2)


class Chapter18ControlPlaneRecoveryTest(Chapter18TestCase):
    """Covers --handoff and both --reconcile-* modes staying usable after the
    MP4/QA report have been moved or are otherwise unavailable, and blocking
    on plan/receipt identity mismatches."""

    def plan_without_media(self) -> dict:
        # video/qa_report point at files that do not exist on disk: a
        # control-plane path (following a prior insert attempt that did use a
        # real file) must not need them. The normal preview/upload path
        # (validate_plan) still requires them.
        return {
            "channel_handle": "@everyoneisadeveloper",
            "channel_url": "https://www.youtube.com/@everyoneisadeveloper",
            "video": str(self.directory / "missing-video.mp4"),
            "video_sha256": "a" * 64,
            "qa_report": str(self.directory / "missing-qa.json"),
            "title": "Recovery test",
            "description": "preview",
            "tags": ["test"],
            "category_id": "28",
            "made_for_kids": False,
            "privacy": "private",
            "notify_subscribers": False,
        }

    def receipt_file_for(self, plan: dict) -> Path:
        return MODULE.receipt_file_for_video(plan["video_sha256"])

    def test_handoff_succeeds_when_mp4_and_qa_are_missing(self):
        plan = self.plan_without_media()
        plan_path = self.write_plan(plan)
        receipt = {
            "uploaded_at": "2026-09-01T00:00:00+00:00",
            "video_id": "vid-recovery-1",
            "channel_handle_expected": plan["channel_handle"],
            "video_sha256": plan["video_sha256"],
            "title": plan["title"],
            "requested_privacy": "public",
            "actual_privacy": "public",
            "made_for_kids": plan["made_for_kids"],
            "status_state": "complete",
        }
        MODULE.write_receipt(self.receipt_file_for(plan), receipt)
        code, output = self.run_handoff(plan_path)
        self.assertEqual(code, 0)
        self.assertIn("video_id: vid-recovery-1", output)

    def test_handoff_blocks_when_receipt_identity_mismatches_plan(self):
        plan = self.plan_without_media()
        plan_path = self.write_plan(plan)
        base_receipt = {
            "uploaded_at": "2026-09-01T00:00:00+00:00",
            "video_id": "vid-recovery-2",
            "channel_handle_expected": plan["channel_handle"],
            "video_sha256": plan["video_sha256"],
            "title": plan["title"],
            "requested_privacy": "private",
            "actual_privacy": "private",
            "made_for_kids": plan["made_for_kids"],
            "status_state": "complete",
        }
        mismatches = {
            "title": {"title": "A totally different recorded title"},
            "channel": {"channel_handle_expected": "@someone-else"},
            "made_for_kids": {"made_for_kids": True},
        }
        for name, overrides in mismatches.items():
            with self.subTest(name):
                MODULE.write_receipt(self.receipt_file_for(plan), {**base_receipt, **overrides})
                code, output = self.run_handoff(plan_path)
                self.assertEqual(code, 6, name)
                self.assertEqual(output, "", name)

    def test_reconcile_video_found_succeeds_when_mp4_and_qa_are_missing(self):
        plan = self.plan_without_media()
        plan_path = self.write_plan(plan)
        started_at = datetime.now(timezone.utc).isoformat()
        receipt = {
            "state": "insert-ambiguous",
            "started_at": started_at,
            "failed_at": started_at,
            "error": "RuntimeError: connection reset",
            "channel_handle_expected": plan["channel_handle"],
            "video_sha256": plan["video_sha256"],
            "title": plan["title"],
            "requested_privacy": "private",
            "made_for_kids": plan["made_for_kids"],
            "video_id": None,
        }
        MODULE.write_receipt(self.receipt_file_for(plan), receipt)
        item = {
            "snippet": {
                "channelId": "channel-own",
                "title": receipt["title"],
                "publishedAt": started_at,
            },
            "status": {"privacyStatus": "private", "selfDeclaredMadeForKids": False},
        }
        fake_status = FakeStatusService(own_channel_id="channel-own", list_items=[item])
        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service", return_value=fake_status):
            code = self.run_main(plan_path, "--reconcile-video-found", "vid-recovery-found")
        self.assertEqual(code, 0)
        upload_service.assert_not_called()
        upload.assert_not_called()

    def test_reconcile_not_found_tombstones_when_mp4_and_qa_are_missing(self):
        plan = self.plan_without_media()
        plan_path = self.write_plan(plan)
        started_at = datetime.now(timezone.utc).isoformat()
        receipt = {
            "state": "insert-ambiguous",
            "started_at": started_at,
            "failed_at": started_at,
            "error": "RuntimeError: connection reset",
            "channel_handle_expected": plan["channel_handle"],
            "video_sha256": plan["video_sha256"],
            "title": plan["title"],
            "requested_privacy": "private",
            "made_for_kids": plan["made_for_kids"],
            "video_id": None,
        }
        MODULE.write_receipt(self.receipt_file_for(plan), receipt)
        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload:
            code = self.run_main(plan_path, "--reconcile-not-found", "--confirm-studio-checked")
        self.assertEqual(code, 2)
        upload_service.assert_not_called()
        upload.assert_not_called()
        tombstoned = json.loads(self.receipt_file_for(plan).read_text(encoding="utf-8"))
        self.assertEqual(tombstoned["state"], "tombstone")

    def test_reconcile_blocks_when_receipt_mismatches_plan_even_without_media(self):
        plan = self.plan_without_media()
        plan_path = self.write_plan(plan)
        started_at = datetime.now(timezone.utc).isoformat()
        receipt = {
            "state": "insert-ambiguous",
            "started_at": started_at,
            "failed_at": started_at,
            "error": "RuntimeError: connection reset",
            "channel_handle_expected": plan["channel_handle"],
            "video_sha256": plan["video_sha256"],
            "title": "A recorded title that no longer matches the plan",
            "requested_privacy": "private",
            "made_for_kids": plan["made_for_kids"],
            "video_id": None,
        }
        MODULE.write_receipt(self.receipt_file_for(plan), receipt)
        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload, \
             patch.object(MODULE, "authenticated_status_service") as status_service:
            code = self.run_main(plan_path, "--reconcile-video-found", "vid-x")
        self.assertEqual(code, 6)
        upload_service.assert_not_called()
        upload.assert_not_called()
        status_service.assert_not_called()

    def test_normal_execute_still_requires_the_media_artifact(self):
        plan = self.plan_without_media()
        plan_path = self.write_plan(plan)
        with patch.object(MODULE, "authenticated_upload_service") as upload_service, \
             patch.object(MODULE, "upload_video") as upload:
            code = self.run_main(plan_path)
        self.assertEqual(code, 1)
        upload_service.assert_not_called()
        upload.assert_not_called()


if __name__ == "__main__":
    unittest.main()
