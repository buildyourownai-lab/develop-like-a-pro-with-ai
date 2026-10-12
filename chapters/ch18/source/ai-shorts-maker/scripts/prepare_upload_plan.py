#!/usr/bin/env python3
"""Prepare a local upload preview plan from a selected file and its QA report.

No authentication, network calls, uploads or visibility changes.
"""
import argparse
import json
from pathlib import Path
from upload_private_video import DEFAULT_PLAN, sha256, validate_plan


def prepare_plan(video: Path, qa_report: Path, channel_handle: str,
                 metadata: Path = DEFAULT_PLAN) -> dict:
    plan = json.loads(metadata.read_text(encoding="utf-8"))
    plan.update(video=str(video.resolve()), video_sha256=sha256(video),
                qa_report=str(qa_report.resolve()), channel_handle=channel_handle,
                channel_url=f"https://www.youtube.com/{channel_handle}")
    validate_plan(plan)
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--qa-report", type=Path, required=True)
    parser.add_argument("--channel-handle", required=True)
    parser.add_argument("--metadata", type=Path, default=DEFAULT_PLAN)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        plan = prepare_plan(args.video, args.qa_report, args.channel_handle, args.metadata)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        # Never replace an author's existing plan silently.
        with args.output.open("x", encoding="utf-8") as handle:
            json.dump(plan, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        parser.exit(1, f"NOT READY: {exc}\n")
    print(f"PREPARED ONLY: {args.output}; no upload performed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
