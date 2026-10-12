"""TTS 전에 사람이 승인한 대본 검수 기록을 확인한다."""

from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


REQUIRED_CHECKS = (
    "spelling_spacing_omissions",
    "terms_and_numbers",
    "narration_and_captions",
    "facts",
    "sources",
)


def _sha256(value: object) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def storyboard_digests(storyboard: dict) -> tuple[str, str]:
    """전체 Storyboard와 TTS 입력 내레이션의 독립 Digest를 반환한다."""
    narrations = [
        {"scene": scene["scene"], "narration": scene["narration"]}
        for scene in storyboard["scenes"]
    ]
    return _sha256(storyboard), _sha256(narrations)


def review_template(storyboard: dict) -> dict:
    storyboard_digest, narration_digest = storyboard_digests(storyboard)
    return {
        "status": "REVIEW_REQUIRED",
        "storyboard_sha256": storyboard_digest,
        "narration_sha256": narration_digest,
        "checks": {name: False for name in REQUIRED_CHECKS},
        "sources_reviewed": [],
        "reviewer": "",
        "notes": "",
    }


def validate_review(storyboard: dict, review: dict) -> list[str]:
    errors: list[str] = []
    storyboard_digest, narration_digest = storyboard_digests(storyboard)
    if review.get("status") != "PASS":
        errors.append("status가 PASS가 아닙니다")
    checks = review.get("checks", {})
    for name in REQUIRED_CHECKS:
        if checks.get(name) is not True:
            errors.append(f"검수 항목이 PASS가 아닙니다: {name}")
    if review.get("storyboard_sha256") != storyboard_digest:
        errors.append("현재 Storyboard와 승인 기록의 Digest가 다릅니다")
    if review.get("narration_sha256") != narration_digest:
        errors.append("현재 내레이션과 승인 기록의 Digest가 다릅니다")
    if not review.get("sources_reviewed"):
        errors.append("사실 검증에 사용한 출처 기록이 없습니다")
    if not str(review.get("reviewer", "")).strip():
        errors.append("검수자 기록이 없습니다")
    return errors


def require_pass(storyboard_path: Path, review_path: Path) -> None:
    storyboard = json.loads(storyboard_path.read_text(encoding="utf-8"))
    if not review_path.is_file():
        raise ValueError(f"대본 검수 기록이 없습니다: {review_path}")
    review = json.loads(review_path.read_text(encoding="utf-8"))
    errors = validate_review(storyboard, review)
    if errors:
        raise ValueError("대본 검수 승인이 유효하지 않습니다: " + "; ".join(errors))


def clear_tts_cache(audio_dir: Path, timings_path: Path) -> None:
    if audio_dir.is_dir():
        for cached in audio_dir.glob("scene-*.wav"):
            cached.unlink()
    timings_path.unlink(missing_ok=True)


def archive_invalidated(archive_root: Path, files: list[Path]) -> Path | None:
    """무효가 된 검수 기록·유료 음성을 삭제하지 않고 새 Archive 폴더로 옮긴다. 기존 Archive는 덮어쓰지 않는다."""
    existing = [path for path in files if path.is_file()]
    if not existing:
        return None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    archive_root.mkdir(parents=True, exist_ok=True)
    for serial in range(1000):
        target = archive_root / f"{stamp}-{serial:03d}"
        try:
            target.mkdir()
            break
        except FileExistsError:
            continue
    else:
        raise RuntimeError(f"Archive 폴더를 만들 수 없습니다: {archive_root}")
    for path in existing:
        shutil.move(str(path), str(target / path.name))
    return target
