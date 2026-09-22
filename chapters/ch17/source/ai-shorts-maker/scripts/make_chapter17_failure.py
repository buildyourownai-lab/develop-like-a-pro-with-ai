#!/usr/bin/env python3
"""Create the intentionally damaged Chapter 17 regression fixture."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "artifacts/science-roman-concrete/roman-final-sounddesign-v3.mp4"
OUTPUT = ROOT / "artifacts/chapter-17/failures/damaged-short.mp4"


def main() -> int:
    if not SOURCE.is_file():
        print(f"Missing source: {SOURCE}", file=sys.stderr)
        return 1
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(SOURCE),
        "-vf",
        "crop=540:960:270:480,scale=1080:1920,"
        "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,0,3)'",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(OUTPUT),
    ]
    result = subprocess.run(command, check=False)
    if result.returncode != 0:
        return result.returncode
    print(OUTPUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
