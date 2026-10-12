import re
import unittest
from pathlib import Path


SKILL = (
    Path(__file__).resolve().parents[1]
    / ".claude/skills/youtube-shorts-production/SKILL.md"
)


class YoutubeShortsSkillContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SKILL.read_text(encoding="utf-8")

    def test_registered_name_and_scope_are_exact(self):
        self.assertRegex(self.text, r"(?m)^name: youtube-shorts-production$")
        self.assertIn("video-upload-review", self.text)
        self.assertIn("youtube-publisher", self.text)
        self.assertIn("제작은 MP4", self.text)

    def test_approval_phases_are_in_the_required_order(self):
        ordered = [
            "소재 후보 3개와 비교표",
            "원 논문·연구기관 해설 조사와 50초대 시나리오",
            "장면별 화면·내레이션·자막·이미지 설명·움직임 설명",
            "Kling의 현재 요금제·권리·모델·크레딧 조건과 사용 예산",
            "기준 이미지 계획과 예상 크레딧",
            "기준 이미지 비교 화면",
            "영상 후보 계획과 예상 크레딧",
            "영상 후보 비교와 장면별 선택안",
            "현재 대본 검사와 음성·음악·효과음",
            "자막과 영상 조립 결과",
        ]
        positions = [self.text.index(item) for item in ordered]
        self.assertEqual(positions, sorted(positions))

    def test_cost_script_and_upload_gates_are_explicit(self):
        required = [
            "크레딧 사용 전 사람 승인을 받는다",
            "자동 추가 결제",
            "script-review.json",
            "SHA-256",
            "Secret을 읽거나 TTS API를 호출하지 않는다",
            "python3 scripts/make_roman_concrete_short.py voice",
            "장면 1·3·4·5·6에 장면마다 Kling 클립 하나씩",
            "장면 2·7은 승인한 기준 이미지의\n  느린 확대",
            "native_audio_approved",
            "조립은 성공 대신 중단 메시지를 낸다",
            "roman-concrete-kling-v2.mp4",
            "science-roman-concrete-kling-20261012",
            "자동으로 PASS가 되지 않는다",
            "Pulsar — The Grey Room / Density & Time",
            "import-voice",
            "삭제하지 않고\n  `archive/`로 옮긴다",
            "native_audio_rights_basis",
            "덮어쓰기 없이 게시한다",
            "YouTube 업로드·공개 상태 변경",
        ]
        for phrase in required:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.text)

    def test_no_other_video_service_is_part_of_the_workflow(self):
        for name in ("Vidu", "Hailuo", "PixVerse"):
            with self.subTest(name=name):
                self.assertNotIn(name, self.text)
        self.assertNotIn("Kling+Hailuo", self.text)


if __name__ == "__main__":
    unittest.main()
