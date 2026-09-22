from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("part5_basic_maker", ROOT / "scripts/part5_basic_maker.py")
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class Part5BasicMakerTest(unittest.TestCase):
    def test_basic_request_uses_verified_defaults(self):
        result = MODULE.resolve_basic_maker_request(
            "새 주제로 영상 만들어줘.",
            {"topic": "달이 사라지면?"},
        )
        self.assertEqual(result["applied_conditions"]["target_duration_seconds"], 60)
        self.assertIn("music", result["defaulted"])
        self.assertFalse(result["management_evidence_recorded"])

    def test_partial_duration_and_voice_override(self):
        result = MODULE.resolve_basic_maker_request(
            "20초로 하고 Voice를 다르게 해줘.",
            {
                "topic": "달이 사라지면?",
                "target_duration_seconds": 20,
                "voice_direction": "좀 더 밝게",
            },
        )
        self.assertEqual(result["applied_conditions"]["target_duration_seconds"], 20)
        self.assertEqual(result["applied_conditions"]["voice_direction"], "좀 더 밝게")
        self.assertIn("subtitle_direction", result["defaulted"])

    def test_music_none_and_scenario_override(self):
        result = MODULE.resolve_basic_maker_request(
            "음악 없이 다른 시나리오로 만들어줘.",
            {
                "topic": "달이 사라지면?",
                "music": "none",
                "scenario": "결론부터 보여준 뒤 이유를 설명",
            },
        )
        self.assertEqual(result["applied_conditions"]["music"], "none")
        self.assertTrue(result["applied_conditions"]["scenario"].startswith("결론부터"))
        for management_field in ("content_id", "production_evidence", "youtube_video_id"):
            self.assertNotIn(management_field, result)

    def test_rejects_management_evidence_fields_in_part5(self):
        with self.assertRaisesRegex(ValueError, "unsupported maker conditions"):
            MODULE.resolve_basic_maker_request(
                "영상 만들어줘.",
                {"topic": "달", "content_id": "not-part5"},
            )


if __name__ == "__main__":
    unittest.main()
