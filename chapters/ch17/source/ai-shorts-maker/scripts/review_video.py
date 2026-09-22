#!/usr/bin/env python3
"""Chapter 17 upload-readiness gate for a vertical YouTube Short."""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_POLICY = ROOT / "prototypes/youtube-shorts/chapter-17/review-policy.json"


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, text=True, capture_output=True, check=False)


def probe(path: Path) -> dict[str, Any]:
    result = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,size:stream=index,codec_type,codec_name,width,height,"
            "r_frame_rate,sample_rate,channels",
            "-of",
            "json",
            str(path),
        ]
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "ffprobe failed")
    return json.loads(result.stdout)


def check(name: str, passed: bool, actual: Any, expected: str) -> dict[str, Any]:
    return {"name": name, "status": "PASS" if passed else "FAIL", "actual": actual, "expected": expected}


def detect_black(path: Path, minimum_seconds: float) -> tuple[list[dict[str, float]], str]:
    result = run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(path),
            "-vf",
            f"blackdetect=d={minimum_seconds}:pix_th=0.10:pic_th=0.98",
            "-an",
            "-f",
            "null",
            "-",
        ]
    )
    combined = result.stdout + "\n" + result.stderr
    segments = []
    pattern = re.compile(
        r"black_start:(?P<start>[0-9.]+)\s+black_end:(?P<end>[0-9.]+)\s+black_duration:(?P<duration>[0-9.]+)"
    )
    for match in pattern.finditer(combined):
        segments.append({key: float(value) for key, value in match.groupdict().items()})
    return segments, combined


def audio_mean_volume(path: Path) -> float | None:
    result = run(
        [
            "ffmpeg",
            "-hide_banner",
            "-nostats",
            "-i",
            str(path),
            "-vn",
            "-af",
            "volumedetect",
            "-f",
            "null",
            "-",
        ]
    )
    match = re.search(r"mean_volume:\s*(-?(?:inf|[0-9.]+))\s*dB", result.stderr)
    if not match or match.group(1) == "-inf":
        return None
    return float(match.group(1))


def make_contact_sheet(path: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    result = run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-reinit_filter",
            "0",
            "-i",
            str(path),
            "-vf",
            "fps=1/5,scale=540:960:force_original_aspect_ratio=decrease,"
            "pad=540:960:(ow-iw)/2:(oh-ih)/2:black,"
            "tile=4x3:nb_frames=12:padding=16:margin=16",
            "-frames:v",
            "1",
            str(output),
        ]
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "contact sheet generation failed")


def load_visual_review(path: Path | None) -> tuple[dict[str, Any] | None, str | None]:
    if path is None:
        return None, "AI visual review file was not supplied"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, f"Could not read AI visual review: {exc}"
    return payload, None


def review_video(
    video: Path,
    policy_path: Path,
    output: Path,
    contact_sheet: Path,
    visual_review_path: Path | None,
) -> dict[str, Any]:
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    checks: list[dict[str, Any]] = []

    exists = video.is_file() and video.stat().st_size > 0
    checks.append(check("file_exists", exists, str(video), "non-empty file"))
    if not exists:
        report = {
            "video": str(video),
            "status": "FAIL",
            "gate": "NOT READY",
            "checks": checks,
            "contact_sheet": None,
        }
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return report

    try:
        metadata = probe(video)
    except RuntimeError as exc:
        checks.append(check("media_probe", False, str(exc), "ffprobe reads the container"))
        report = {"video": str(video), "status": "FAIL", "gate": "NOT READY", "checks": checks}
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return report

    streams = metadata.get("streams", [])
    videos = [stream for stream in streams if stream.get("codec_type") == "video"]
    audios = [stream for stream in streams if stream.get("codec_type") == "audio"]
    video_stream = videos[0] if videos else {}
    audio_stream = audios[0] if audios else {}
    duration = float(metadata.get("format", {}).get("duration", 0))
    width = int(video_stream.get("width", 0))
    height = int(video_stream.get("height", 0))

    checks.extend(
        [
            check(
                "duration",
                policy["duration_seconds"]["min"] <= duration <= policy["duration_seconds"]["max"],
                round(duration, 3),
                f'{policy["duration_seconds"]["min"]}..{policy["duration_seconds"]["max"]} seconds',
            ),
            check("video_stream", len(videos) == 1, len(videos), "exactly 1 video stream"),
            check("audio_stream", len(audios) == 1, len(audios), "exactly 1 audio stream"),
            check(
                "resolution",
                width == policy["width"] and height == policy["height"],
                f"{width}x{height}",
                f'{policy["width"]}x{policy["height"]}',
            ),
            check(
                "portrait_ratio",
                height > width and math.isclose(width / height, 9 / 16, rel_tol=0.001),
                round(width / height, 4) if height else None,
                "9:16 portrait",
            ),
            check(
                "video_codec",
                video_stream.get("codec_name") == policy["video_codec"],
                video_stream.get("codec_name"),
                policy["video_codec"],
            ),
            check(
                "audio_codec",
                audio_stream.get("codec_name") == policy["audio_codec"],
                audio_stream.get("codec_name"),
                policy["audio_codec"],
            ),
        ]
    )

    decode = run(["ffmpeg", "-v", "error", "-i", str(video), "-f", "null", "-"])
    checks.append(
        check(
            "full_decode",
            decode.returncode == 0 and not decode.stderr.strip(),
            decode.stderr.strip() or "no decode error",
            "whole file decodes without errors",
        )
    )

    mean_volume = audio_mean_volume(video) if audios else None
    checks.append(
        check(
            "audible_signal",
            mean_volume is not None and mean_volume >= policy["audio_mean_volume_min_db"],
            {"mean_volume_db": mean_volume},
            f'mean volume at least {policy["audio_mean_volume_min_db"]} dB',
        )
    )

    black_segments, _ = detect_black(video, policy["black_frame_min_seconds"])
    checks.append(
        check(
            "unexpected_black_frames",
            not black_segments,
            black_segments,
            f'no black segment lasting {policy["black_frame_min_seconds"]} seconds or more',
        )
    )

    try:
        make_contact_sheet(video, contact_sheet)
        checks.append(check("contact_sheet", True, str(contact_sheet), "generated for AI visual review"))
    except RuntimeError as exc:
        checks.append(check("contact_sheet", False, str(exc), "generated for AI visual review"))

    visual_review, visual_error = load_visual_review(visual_review_path)
    if visual_error:
        checks.append(check("ai_visual_review", False, visual_error, "all required visual judgments are true"))
    else:
        required = policy["required_visual_judgments"]
        judgments = visual_review.get("judgments", {})
        missing = [name for name in required if not isinstance(judgments.get(name), bool)]
        failed = [name for name in required if judgments.get(name) is False]
        passed = not missing and not failed
        checks.append(
            check(
                "ai_visual_review",
                passed,
                {"reviewer": visual_review.get("reviewer"), "missing": missing, "failed": failed},
                "all required visual judgments are true",
            )
        )

    status = "PASS" if all(item["status"] == "PASS" for item in checks) else "FAIL"
    report = {
        "video": str(video),
        "policy": str(policy_path),
        "status": status,
        "gate": "UPLOAD READY" if status == "PASS" else "NOT READY",
        "checks": checks,
        "contact_sheet": str(contact_sheet),
        "boundary": "UPLOAD READY is a pre-upload QA result, not permission to publish.",
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY)
    parser.add_argument("--visual-review", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--contact-sheet", type=Path, required=True)
    args = parser.parse_args()

    report = review_video(
        args.video.resolve(),
        args.policy.resolve(),
        args.output.resolve(),
        args.contact_sheet.resolve(),
        args.visual_review.resolve() if args.visual_review else None,
    )
    print(f'{report["gate"]}: {args.video}')
    for item in report["checks"]:
        print(f'- {item["status"]}: {item["name"]}')
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
