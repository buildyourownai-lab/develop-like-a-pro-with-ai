import sys
import unittest
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from script_review import clear_tts_cache, review_template, storyboard_digests, validate_review


def board(text="검수할 문장입니다."):
    return {"title": "test", "scenes": [{"scene": 1, "narration": text}]}


def approved(storyboard):
    review = review_template(storyboard)
    review.update(status="PASS", reviewer="tester", sources_reviewed=["https://example.com"])
    review["checks"] = {name: True for name in review["checks"]}
    return review


class ScriptReviewTests(unittest.TestCase):
    def test_approved_current_storyboard_passes(self):
        self.assertEqual(validate_review(board(), approved(board())), [])


    def test_narration_edit_invalidates_approval(self):
        errors = validate_review(board("수정된 문장입니다."), approved(board()))
        self.assertTrue(any("내레이션" in error for error in errors))
        self.assertTrue(any("Storyboard" in error for error in errors))


    def test_every_review_dimension_and_source_are_required(self):
        review = approved(board())
        review["checks"]["terms_and_numbers"] = False
        review["sources_reviewed"] = []
        errors = validate_review(board(), review)
        self.assertTrue(any("terms_and_numbers" in error for error in errors))
        self.assertTrue(any("출처" in error for error in errors))


    def test_digest_is_stable_across_dictionary_key_order(self):
        first = board()
        second = {"scenes": first["scenes"], "title": first["title"]}
        self.assertEqual(storyboard_digests(first), storyboard_digests(second))

    def test_invalid_review_can_clear_stale_tts_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            audio_dir = root / "narration"
            audio_dir.mkdir()
            wav = audio_dir / "scene-01.wav"
            wav.write_bytes(b"stale")
            timings = root / "narration-timings.json"
            timings.write_text("{}", encoding="utf-8")
            clear_tts_cache(audio_dir, timings)
            self.assertFalse(wav.exists())
            self.assertFalse(timings.exists())


if __name__ == "__main__":
    unittest.main()
