from __future__ import annotations

import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("chapter17", ROOT / "scripts/review_video.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)

POLICY = ROOT / "prototypes/youtube-shorts/chapter-17/review-policy.json"
NORMAL_VIDEO = ROOT / "artifacts/science-roman-concrete-kling-20261012/roman-concrete-kling-v2.mp4"
DAMAGED_VIDEO = ROOT / "artifacts/chapter-17-kling-20261012/failures/damaged-short.mp4"
NORMAL_VISUAL = ROOT / "artifacts/science-roman-concrete-kling-20261012/review/normal-visual-review.json"
DAMAGED_VISUAL = ROOT / "artifacts/chapter-17-kling-20261012/review/damaged-visual-review.json"

MEDIA_TOOLS = shutil.which("ffprobe") and shutil.which("ffmpeg")


def statuses(report: dict) -> dict[str, str]:
    return {item["name"]: item["status"] for item in report["checks"]}


@unittest.skipUnless(MEDIA_TOOLS, "ffmpeg and ffprobe are required")
class Chapter17ReviewTest(unittest.TestCase):
    def review(self, video: Path, visual_review: Path | None) -> dict:
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            return MODULE.review_video(
                video,
                POLICY,
                directory / "review.json",
                directory / "contact-sheet.png",
                visual_review,
            )

    @unittest.skipUnless(NORMAL_VIDEO.is_file(), "the chapter 16 video is required")
    def test_normal_video_is_upload_ready(self):
        report = self.review(NORMAL_VIDEO, NORMAL_VISUAL)
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["gate"], "UPLOAD READY")
        self.assertNotIn("FAIL", statuses(report).values())

    @unittest.skipUnless(DAMAGED_VIDEO.is_file(), "the damaged copy is required")
    def test_damaged_copy_is_not_ready(self):
        report = self.review(DAMAGED_VIDEO, DAMAGED_VISUAL)
        self.assertEqual(report["status"], "FAIL")
        self.assertEqual(report["gate"], "NOT READY")
        failed = [name for name, status in statuses(report).items() if status == "FAIL"]
        self.assertIn("audible_signal", failed)
        self.assertIn("unexpected_black_frames", failed)
        self.assertIn("ai_visual_review", failed)

    @unittest.skipUnless(NORMAL_VIDEO.is_file(), "the chapter 16 video is required")
    def test_visual_judgment_alone_closes_the_gate(self):
        with tempfile.TemporaryDirectory() as name:
            visual_review = Path(name) / "visual-review.json"
            payload = json.loads(NORMAL_VISUAL.read_text(encoding="utf-8"))
            payload["judgments"]["subtitles_present_and_readable"] = False
            visual_review.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            report = self.review(NORMAL_VIDEO, visual_review)
        self.assertEqual(report["gate"], "NOT READY")
        self.assertEqual(statuses(report)["ai_visual_review"], "FAIL")
        self.assertEqual(statuses(report)["duration"], "PASS")

    def test_missing_video_stops_before_probing(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            output = directory / "review.json"
            report = MODULE.review_video(
                directory / "no-such-video.mp4",
                POLICY,
                output,
                directory / "contact-sheet.png",
                NORMAL_VISUAL,
            )
            self.assertEqual(json.loads(output.read_text(encoding="utf-8"))["gate"], "NOT READY")
        self.assertEqual(report["checks"][0]["name"], "file_exists")
        self.assertEqual(len(report["checks"]), 1)


if __name__ == "__main__":
    unittest.main()
