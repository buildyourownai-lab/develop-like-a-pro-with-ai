import importlib.util
import json
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location(
    "make_roman_concrete_short", SCRIPTS / "make_roman_concrete_short.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class RomanScriptReviewGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.board = self.root / "storyboard.json"
        self.review = self.root / "script-review.json"
        self.audio = self.root / "source/audio"
        self.timings = self.audio / "timings.json"
        self.board.write_text(
            json.dumps(
                {"scenes": [{"scene": 1, "narration": "검수할 문장입니다."}]},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_tts_stops_before_secret_or_cache_without_pass_review(self):
        old_board, old_review = MODULE.BOARD, MODULE.REVIEW
        MODULE.BOARD, MODULE.REVIEW = self.board, self.review
        old_secret = MODULE.secret
        MODULE.secret = lambda: self.fail("검수 전에 Secret을 읽으면 안 됩니다")
        try:
            with self.assertRaisesRegex(ValueError, "검수 기록이 없습니다"):
                MODULE.tts()
        finally:
            MODULE.BOARD, MODULE.REVIEW = old_board, old_review
            MODULE.secret = old_secret

    def test_review_command_writes_current_digests_and_clears_audio_cache(self):
        self.audio.mkdir(parents=True)
        (self.audio / "scene-01.wav").write_bytes(b"old")
        self.timings.write_text("{}", encoding="utf-8")
        old_board, old_review, old_project, old_timings = (
            MODULE.BOARD,
            MODULE.REVIEW,
            MODULE.PROJECT,
            MODULE.TIMINGS,
        )
        MODULE.BOARD = self.board
        MODULE.REVIEW = self.review
        MODULE.PROJECT = self.root
        MODULE.TIMINGS = self.timings
        try:
            result = MODULE.make_review_template()
            review = json.loads(result.read_text(encoding="utf-8"))
            self.assertEqual(review["status"], "REVIEW_REQUIRED")
            self.assertFalse((self.audio / "scene-01.wav").exists())
            self.assertFalse(self.timings.exists())
        finally:
            MODULE.BOARD, MODULE.REVIEW, MODULE.PROJECT, MODULE.TIMINGS = (
                old_board,
                old_review,
                old_project,
                old_timings,
            )

    def test_voice_command_generates_audio_without_building_video(self):
        with mock.patch.object(MODULE, "tts", return_value=[1.234, 2.345]) as tts:
            with mock.patch.object(MODULE, "build") as build:
                self.assertEqual(MODULE.main(["script", "voice"]), 0)
        tts.assert_called_once_with()
        build.assert_not_called()


if __name__ == "__main__":
    unittest.main()
