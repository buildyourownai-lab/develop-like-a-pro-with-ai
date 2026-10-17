"""Kling 단일 제작본 계약: 대본 일치, 선택 클립·권리 기록 Gate, 소리 처리."""
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location(
    "make_roman_concrete_short_kling", SCRIPTS / "make_roman_concrete_short.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)

from script_review import review_template  # noqa: E402

PROTOTYPE = ROOT / "prototypes/youtube-shorts/chapter-16"
BOARD = json.loads((PROTOTYPE / "storyboard.json").read_text(encoding="utf-8"))
MANUSCRIPT = next(
    (p / "book/23-chapter-16.md" for p in ROOT.parents if (p / "book/23-chapter-16.md").is_file()),
    None,
)
FFMPEG = shutil.which("ffmpeg")


def manuscript_scenario(lines: list[str]) -> str:
    start = next(i for i, line in enumerate(lines) if "다음 시나리오를 작성했습니다" in line)
    block = []
    for line in lines[start + 1:]:
        if line.startswith(">"):
            block.append(line[1:].strip())
        elif block:
            break
    return " ".join(block)


@unittest.skipUnless(MANUSCRIPT, "book/23-chapter-16.md is required")
class ManuscriptAlignmentTests(unittest.TestCase):
    def setUp(self):
        self.lines = MANUSCRIPT.read_text(encoding="utf-8").splitlines()

    def test_all_seven_narrations_match_the_approved_scenario_exactly(self):
        self.assertEqual(len(BOARD["scenes"]), 7)
        joined = " ".join(scene["narration"] for scene in BOARD["scenes"])
        self.assertEqual(joined, manuscript_scenario(self.lines))

    def test_captions_match_the_scene_table(self):
        start = next(i for i, line in enumerate(self.lines) if line.startswith("| 장면 | 화면 | 움직임 | 자막 |"))
        rows = [line for line in self.lines[start + 2:start + 9] if re.match(r"\| [1-7] \|", line)]
        self.assertEqual(len(rows), 7)
        for row, scene in zip(rows, BOARD["scenes"]):
            self.assertEqual(row.split("|")[-2].strip(), " · ".join(scene["captions"]))


class StoryboardTests(unittest.TestCase):
    def test_final_conclusion_is_resilience_not_strength_vs_resilience(self):
        last = BOARD["scenes"][-1]
        self.assertEqual(last["captions"], ["단단함 + 회복력"])
        self.assertIn("스스로 틈을 메우는 성질", last["narration"])




# ---------------------------------------------------------------------------
# 아래 Fixture는 테스트 전용 합성 미디어와 시험용 기록이다. 제품 자산·권리 증빙이 아니다.

def _has_drawtext() -> bool:
    try:
        MODULE.require_drawtext()
        MODULE.font_file()
        return True
    except SystemExit:
        return False


needs_ffmpeg = unittest.skipUnless(FFMPEG, "ffmpeg is required")
needs_drawtext = unittest.skipUnless(FFMPEG and _has_drawtext(), "ffmpeg with drawtext and a Korean font is required")


class FixtureProject(unittest.TestCase):
    """임시 작업 폴더에 완전한 합성 입력(스틸·클립·BGM·음성·manifest)을 만든다."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.saved = (MODULE.PROJECT, MODULE.MANIFEST, MODULE.BOARD, MODULE.REVIEW, MODULE.TIMINGS)
        MODULE.PROJECT = self.root
        MODULE.MANIFEST = self.root / "assets-manifest.json"
        MODULE.BOARD = self.root / "storyboard.json"
        MODULE.REVIEW = self.root / "script-review.json"
        MODULE.TIMINGS = self.root / "source/audio/timings.json"

    def tearDown(self):
        MODULE.PROJECT, MODULE.MANIFEST, MODULE.BOARD, MODULE.REVIEW, MODULE.TIMINGS = self.saved
        self.temp.cleanup()

    def ff(self, *args):
        subprocess.run([MODULE.FFMPEG, "-y", "-v", "error", *args], check=True)

    def sha(self, rel):
        return MODULE.sha256_file(self.root / rel)

    def approve(self, board):
        MODULE.BOARD.write_text(json.dumps(board, ensure_ascii=False), encoding="utf-8")
        review = review_template(board)
        review.update(status="PASS", reviewer="test fixture", sources_reviewed=["fixture"])
        review["checks"] = {k: True for k in review["checks"]}
        MODULE.REVIEW.write_text(json.dumps(review), encoding="utf-8")

    def make_still(self, rel, size="270x480"):
        (self.root / rel).parent.mkdir(parents=True, exist_ok=True)
        self.ff("-f", "lavfi", "-i", f"testsrc=s={size}", "-frames:v", "1", str(self.root / rel))

    def make_clip(self, rel, seconds=2, audio=False, size="270x480", rate=7):
        (self.root / rel).parent.mkdir(parents=True, exist_ok=True)
        # rate로 서로 다른 내용을 만들어 해시가 장면마다 다르게 한다.
        args = ["-f", "lavfi", "-i", f"testsrc=s={size}:d={seconds}:r={rate}"]
        if audio:
            args += ["-f", "lavfi", "-i", f"sine=frequency=500:duration={seconds}", "-shortest"]
        self.ff(*args, "-c:v", "libx264", "-pix_fmt", "yuv420p", str(self.root / rel))

    def write_voice(self, board, origin="gemini-api", seconds=1.5):
        (self.root / "source/audio").mkdir(parents=True, exist_ok=True)
        entries = {}
        for s in board["scenes"]:
            n = s["scene"]
            self.ff("-f", "lavfi", "-i", f"sine=frequency={300 + n * 10}:duration={seconds}", str(MODULE.scene_wav(n)))
            entry = {"narration_sha256": MODULE.sha256_text(s["narration"]), "wav_sha256": MODULE.sha256_file(MODULE.scene_wav(n)),
                     "voice": MODULE.VOICE, "origin": origin, "recorded_at": "fixture"}
            if origin == "gemini-api":
                entry.update(model=MODULE.MODEL, prompt_sha256=MODULE.sha256_text(MODULE.prompt_for(s["narration"])), provenance=None)
            else:
                entry.update(model="fixture-ui", provenance={f: "fixture" for f in MODULE.IMPORT_PROVENANCE_FIELDS})
            entries[str(n)] = entry
        MODULE.write_cache({"version": 1, "entries": entries})

    def build_project(self, board=None, *, voice=True, approved_scenes=(1,), audio_scenes=(1,), clip_seconds=2):
        board = board or json.loads(json.dumps(BOARD))
        self.approve(board)
        (self.root / "source/bgm").mkdir(parents=True, exist_ok=True)
        self.ff("-f", "lavfi", "-i", "sine=frequency=220:duration=3", str(self.root / MODULE.BGM_PATH))
        entries = []
        for n in MODULE.SCENE_IDS:
            still = n in MODULE.STILL_SCENES
            rel = f"source/images/scene-{n:02d}.png" if still else MODULE.VIDEO_SOURCES[n]
            if still:
                self.make_still(rel, size=f"{270 + n}x480")
            else:
                self.make_clip(rel, seconds=clip_seconds, audio=n in audio_scenes, rate=5 + n)
            entry = {"scene": n, "type": "image" if still else "video", "source": "Kling", "file": rel,
                     "prompt": "fixture prompt", "selection_reason": "fixture reason", "sha256": self.sha(rel),
                     **{f: "Kling" if f == "service" else "fixture" for f in MODULE.REQUIRED_RIGHTS_FIELDS}}
            if not still:
                entry.update(native_audio=n in audio_scenes, native_audio_approved=n in approved_scenes)
                if n in approved_scenes:
                    entry.update({f: "fixture" for f in MODULE.NATIVE_AUDIO_RIGHTS_FIELDS})
            entries.append(entry)
        self.manifest = {
            "status": MODULE.MANIFEST_READY_STATUS, "selected_visuals": entries,
            "voice": {"voice": MODULE.VOICE, "origin": "gemini-api", "rights_basis": "fixture"},
            "audio": {"track": MODULE.BGM_TRACK, "artist": MODULE.BGM_ARTIST, "source": "fixture", "license_text": "fixture",
                      "downloaded_at": "fixture", "sha256": self.sha(MODULE.BGM_PATH)},
        }
        self.save_manifest()
        if voice:
            self.write_voice(board)
        return board

    def save_manifest(self):
        MODULE.MANIFEST.write_text(json.dumps(self.manifest), encoding="utf-8")

    def entry(self, scene):
        return next(e for e in self.manifest["selected_visuals"] if e["scene"] == scene)

    def rehash(self, scene):
        entry = self.entry(scene)
        entry["sha256"] = self.sha(entry["file"])
        self.save_manifest()


@needs_drawtext
class PreflightTests(FixtureProject):
    def test_complete_valid_project_passes_without_any_network_or_secret(self):
        self.build_project()
        with mock.patch.object(MODULE, "secret", side_effect=AssertionError("secret")), \
                mock.patch.object(MODULE.urllib.request, "urlopen", side_effect=AssertionError("network")):
            ctx = MODULE.preflight(require_voice=True)
        self.assertEqual(sorted(ctx["selected"]), list(range(1, 8)))
        self.assertEqual(len(ctx["durations"]), 7)

    # ---- T1: 실제 스트림·디코딩·글꼴을 유료 작업 전에 확인한다
    def test_undecodable_inputs_are_rejected_even_when_hashes_match(self):
        for label, rel in (("still", "source/images/scene-02.png"), ("clip", MODULE.VIDEO_SOURCES[4]), ("bgm", MODULE.BGM_PATH)):
            with self.subTest(label=label):
                self.build_project(voice=False)
                (self.root / rel).write_bytes(b"x")
                if label == "bgm":
                    self.manifest["audio"]["sha256"] = self.sha(rel)
                else:
                    self.rehash(2 if label == "still" else 4)
                self.save_manifest()
                with self.assertRaisesRegex(SystemExit, "미디어 검사를 통과하지 못했습니다"):
                    MODULE.preflight()

    def test_audio_only_file_in_place_of_a_video_is_rejected(self):
        self.build_project(voice=False)
        self.ff("-f", "lavfi", "-i", "sine=duration=2", str(self.root / MODULE.VIDEO_SOURCES[3]).replace(".mp4", ".wav"))
        (self.root / MODULE.VIDEO_SOURCES[3]).unlink()
        shutil.move(str(self.root / MODULE.VIDEO_SOURCES[3]).replace(".mp4", ".wav"), self.root / MODULE.VIDEO_SOURCES[3])
        self.rehash(3)
        with self.assertRaisesRegex(SystemExit, "장면 3.*영상 스트림이 없음|장면 3.*읽을 수 없음"):
            MODULE.preflight()

    def test_landscape_still_is_rejected(self):
        self.build_project(voice=False)
        self.make_still("source/images/scene-07.png", size="480x270")
        self.rehash(7)
        with self.assertRaisesRegex(SystemExit, "장면 7: 세로 화면이 아님"):
            MODULE.preflight()

    def test_unusable_font_stops_before_any_tts_call(self):
        self.build_project(voice=False)
        not_a_font = self.root / "not-a-font.ttf"
        not_a_font.write_bytes(b"not a font")
        with mock.patch.object(MODULE, "font_file", return_value=str(not_a_font)), \
                mock.patch.object(MODULE, "tts", side_effect=AssertionError("TTS는 호출되면 안 됩니다")):
            with self.assertRaisesRegex(SystemExit, "글꼴로 한글을 그릴 수 없습니다"):
                MODULE.main(["script", "all"])

    def test_clip_too_short_for_cached_narration_stops_before_assembly(self):
        self.build_project(clip_seconds=0.5)  # 음성 1.5초 → 약 3.1배 늘려야 함
        with self.assertRaisesRegex(SystemExit, "장면 1: 클립을 .*배로 늘려야 합니다"):
            MODULE.preflight()

    # ---- T2: 해시·권리·선택 집합
    def test_wrong_or_missing_asset_hash_is_rejected(self):
        self.build_project(voice=False)
        self.entry(5)["sha256"] = "0" * 64
        del self.entry(6)["sha256"]
        self.save_manifest()
        with self.assertRaises(SystemExit) as caught:
            MODULE.preflight()
        self.assertIn("장면 5: sha256 불일치", str(caught.exception))
        self.assertIn("장면 6: sha256 기록이 64자리", str(caught.exception))

    def test_duplicate_extra_and_missing_scene_selection_is_rejected(self):
        self.build_project(voice=False)
        self.manifest["selected_visuals"].append(dict(self.entry(1)))
        self.manifest["selected_visuals"][2]["scene"] = 99
        self.save_manifest()
        with self.assertRaisesRegex(SystemExit, "중복·누락·추가 없이"):
            MODULE.preflight()

    def test_same_file_selected_for_two_scenes_is_rejected(self):
        self.build_project(voice=False)
        shutil.copyfile(self.root / MODULE.VIDEO_SOURCES[4], self.root / MODULE.VIDEO_SOURCES[5])
        self.rehash(5)
        with self.assertRaisesRegex(SystemExit, "같은 파일을 선택함"):
            MODULE.preflight()

    def test_template_status_and_non_kling_service_are_rejected(self):
        self.build_project(voice=False)
        self.manifest["status"] = "TEMPLATE_NOT_FILLED"
        self.entry(3)["service"] = "Hailuo"
        self.save_manifest()
        with self.assertRaises(SystemExit) as caught:
            MODULE.preflight()
        self.assertIn("manifest status", str(caught.exception))
        self.assertIn("service는 Kling이어야 함", str(caught.exception))

    def test_bgm_must_be_the_recorded_pulsar_file(self):
        for label, change, message in (
            ("other track", lambda m: m["audio"].update(track="Other Song"), "다른 곡 대체 금지"),
            ("no license", lambda m: m["audio"].update(license_text=""), "audio.license_text 기록 없음"),
            ("bad hash", lambda m: m["audio"].update(sha256="1" * 64), "audio.sha256"),
            ("no hash", lambda m: m["audio"].pop("sha256"), "audio.sha256"),
        ):
            with self.subTest(label=label):
                self.build_project(voice=False)
                change(self.manifest)
                self.save_manifest()
                with self.assertRaisesRegex(SystemExit, message):
                    MODULE.preflight()

    def test_voice_record_must_be_charon_with_origin_and_rights(self):
        self.build_project(voice=False)
        self.manifest["voice"] = {"voice": "Puck", "origin": "", "rights_basis": ""}
        self.save_manifest()
        with self.assertRaises(SystemExit) as caught:
            MODULE.preflight()
        for part in ("voice.voice는 Charon", "voice.origin", "voice.rights_basis"):
            self.assertIn(part, str(caught.exception))

    def test_native_audio_approval_needs_real_stream_and_rights_record(self):
        self.build_project(voice=False, approved_scenes=(1, 3), audio_scenes=(1,))  # 3은 소리 없는데 승인
        with self.assertRaisesRegex(SystemExit, "장면 3: 소리가 없다고 기록한 클립의 효과음을 승인할 수 없음"):
            MODULE.preflight()
        self.build_project(voice=False)
        self.entry(1)["native_audio_reviewed_by"] = ""
        self.save_manifest()
        with self.assertRaisesRegex(SystemExit, "장면 1: native_audio_reviewed_by 기록 없음"):
            MODULE.preflight()

    def test_native_audio_record_must_match_the_actual_stream(self):
        self.build_project(voice=False, approved_scenes=(), audio_scenes=(1,))
        self.entry(1)["native_audio"] = False   # 실제로는 소리가 있음
        self.entry(4)["native_audio"] = True    # 실제로는 소리가 없음
        self.save_manifest()
        with self.assertRaises(SystemExit) as caught:
            MODULE.preflight()
        self.assertIn("장면 1: native_audio=false로 기록했지만", str(caught.exception))
        self.assertIn("장면 4: native_audio=true로 기록했지만", str(caught.exception))

    # ---- T5: 장면 집합·순서·길이
    def test_reordered_or_incomplete_scene_sets_are_rejected(self):
        board = json.loads(json.dumps(BOARD))
        board["scenes"][0], board["scenes"][1] = board["scenes"][1], board["scenes"][0]
        self.build_project(board=board, voice=False)  # 재정렬한 Storyboard도 Digest상 승인됨
        with self.assertRaisesRegex(SystemExit, "정확히 \\[1, 2, 3, 4, 5, 6, 7\\] 순서"):
            MODULE.preflight()
        short = json.loads(json.dumps(BOARD))
        short["scenes"] = short["scenes"][:6]
        self.approve(short)
        with self.assertRaisesRegex(SystemExit, "정확히"):
            MODULE.preflight()

    def test_duration_sets_must_be_seven_finite_positive_numbers(self):
        for label, durations in (("short", [1.5] * 6), ("long", [1.5] * 8), ("nan", [1.5] * 6 + [float("nan")]),
                                 ("inf", [float("inf")] + [1.5] * 6), ("zero", [0] + [1.5] * 6),
                                 ("negative", [-1] + [1.5] * 6), ("text", ["a"] + [1.5] * 6)):
            with self.subTest(label=label):
                with mock.patch.object(MODULE, "preflight", side_effect=AssertionError("렌더 전에 거부해야 함")):
                    with self.assertRaisesRegex(SystemExit, "장면 길이"):
                        MODULE.build(durations)


@needs_ffmpeg
class VoiceCacheTests(FixtureProject):
    """T3: 음성 재사용은 파일 이름이 아니라 현재 대본·설정·해시에 묶인 기록으로만 한다."""

    def setUp(self):
        super().setUp()
        self.board = json.loads(json.dumps(BOARD))
        self.approve(self.board)

    def test_imported_voice_never_falls_back_to_paid_synthesis(self):
        MODULE.MANIFEST.write_text(json.dumps({"voice": {"origin": "imported"}}), encoding="utf-8")
        for state in ("missing", "stale", "mixed"):
            with self.subTest(state=state):
                if state != "missing":
                    self.write_voice(self.board, origin="imported")
                    cache = MODULE.read_cache()
                    if state == "stale":
                        cache["entries"]["1"]["narration_sha256"] = "0" * 64
                    else:
                        cache["entries"]["1"]["origin"] = "gemini-api"
                    MODULE.write_cache(cache)
                with mock.patch.object(MODULE, "secret", side_effect=AssertionError("secret reached")), \
                        mock.patch.object(MODULE, "synthesize", side_effect=AssertionError("paid synthesis reached")):
                    with self.assertRaises(SystemExit):
                        MODULE.tts()

    def test_complete_imported_voice_is_reused_without_secret(self):
        MODULE.MANIFEST.write_text(json.dumps({"voice": {"origin": "imported"}}), encoding="utf-8")
        self.write_voice(self.board, origin="imported")
        with mock.patch.object(MODULE, "secret", side_effect=AssertionError("secret reached")), \
                mock.patch.object(MODULE, "synthesize", side_effect=AssertionError("paid synthesis reached")):
            self.assertEqual(len(MODULE.tts()), 7)

    def test_valid_stale_wav_without_record_is_archived_not_reused(self):
        self.write_voice(self.board)
        MODULE.cache_path().unlink()  # 형식상 유효한 WAV만 남음(이전 대본의 음성일 수 있음)
        calls = []
        with mock.patch.object(MODULE, "secret", return_value="dummy"), \
                mock.patch.object(MODULE, "synthesize", side_effect=lambda *a: calls.append(a) or (_ for _ in ()).throw(RuntimeError("stop"))):
            with self.assertRaisesRegex(RuntimeError, "stop"):
                MODULE.tts()
        self.assertEqual(len(calls), 1)
        archived = sorted((self.root / "archive").glob("*/scene-*.wav"))
        self.assertEqual(len(archived), 7, "유료 음성을 삭제하지 않고 보관해야 함")

    def test_wav_replaced_after_recording_is_not_reused(self):
        self.write_voice(self.board)
        self.ff("-f", "lavfi", "-i", "sine=frequency=999:duration=1.5", str(MODULE.scene_wav(3)))
        entries = MODULE.read_cache()["entries"]
        problem = MODULE.cache_problem(self.board["scenes"][2], entries["3"])
        self.assertIn("WAV 해시", problem)
        with self.assertRaisesRegex(SystemExit, "장면 3: WAV 해시"):
            MODULE.voice_origin(self.board)

    def test_changed_narration_model_voice_or_prompt_invalidate_the_record(self):
        self.write_voice(self.board)
        scene = self.board["scenes"][0]
        base = MODULE.read_cache()["entries"]["1"]
        self.assertIsNone(MODULE.cache_problem(scene, base))
        for field, value, text in (("narration_sha256", "0" * 64, "내레이션"), ("model", "other-model", "모델"),
                                   ("voice", "Puck", "Charon"), ("prompt_sha256", "0" * 64, "프롬프트")):
            with self.subTest(field=field):
                self.assertIn(text, MODULE.cache_problem(scene, {**base, field: value}))
        self.assertIn("출처 기록 없음", MODULE.cache_problem(scene, None))

    def test_valid_record_is_reused_without_secret_or_network(self):
        self.write_voice(self.board)
        with mock.patch.object(MODULE, "secret", side_effect=AssertionError("키 불필요")), \
                mock.patch.object(MODULE, "synthesize", side_effect=AssertionError("재생성 금지")):
            durations = MODULE.tts()
        self.assertEqual(len(durations), 7)
        self.assertFalse((self.root / "archive").exists())

    def test_changed_storyboard_requires_new_review_and_blocks_cache(self):
        self.write_voice(self.board)
        self.board["scenes"][0]["narration"] += " 추가."
        MODULE.BOARD.write_text(json.dumps(self.board, ensure_ascii=False), encoding="utf-8")
        with mock.patch.object(MODULE, "synthesize", side_effect=AssertionError("승인 전 생성 금지")):
            with self.assertRaisesRegex(ValueError, "승인이 유효하지 않습니다"):
                MODULE.tts()

    def test_imported_charon_voice_needs_explicit_provenance(self):
        self.write_voice(self.board)
        MODULE.cache_path().unlink()
        spec = {"voice": "Charon", "provenance": {f: "fixture" for f in MODULE.IMPORT_PROVENANCE_FIELDS},
                "scenes": [{"scene": n, "wav": f"source/audio/scene-{n:02d}.wav"} for n in MODULE.SCENE_IDS]}
        spec_path = self.root / "source/audio/voice-import.json"

        def run(mutated):
            spec_path.write_text(json.dumps(mutated), encoding="utf-8")
            return MODULE.import_voice()

        with self.assertRaisesRegex(SystemExit, "voice는 Charon여야|voice는 Charon이어야|voice는 Charon"):
            run({**spec, "voice": "Puck"})
        incomplete = {**spec, "provenance": {**spec["provenance"], "verified_by": ""}}
        with self.assertRaisesRegex(SystemExit, "provenance.verified_by 없음"):
            run(incomplete)
        with self.assertRaisesRegex(SystemExit, "장면 2: wav는"):
            run({**spec, "scenes": [{"scene": n, "wav": "elsewhere.wav"} if n == 2 else item for n, item in zip(MODULE.SCENE_IDS, spec["scenes"])]})
        self.assertFalse(MODULE.cache_path().exists(), "실패한 가져오기는 Cache를 만들지 않아야 함")
        self.assertEqual(run(spec), 0)
        entries = MODULE.read_cache()["entries"]
        self.assertEqual({e["origin"] for e in entries.values()}, {"imported"})
        self.assertEqual(MODULE.voice_origin(self.board), "imported")
        self.assertEqual(entries["1"]["wav_sha256"], MODULE.sha256_file(MODULE.scene_wav(1)))
        # 가져온 뒤 파일을 바꾸면 더 이상 신뢰하지 않는다
        self.ff("-f", "lavfi", "-i", "sine=frequency=777:duration=1.5", str(MODULE.scene_wav(5)))
        with self.assertRaisesRegex(SystemExit, "장면 5: WAV 해시"):
            MODULE.voice_origin(self.board)

    def test_import_requires_an_approved_current_script(self):
        self.write_voice(self.board)
        self.board["scenes"][0]["narration"] += "!"
        MODULE.BOARD.write_text(json.dumps(self.board, ensure_ascii=False), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "승인이 유효하지 않습니다"):
            MODULE.import_voice()


@needs_ffmpeg
class ArchiveTests(FixtureProject):
    """T4: 무효화는 삭제가 아니라 보관이다."""

    def test_review_command_archives_old_review_audio_and_cache(self):
        board = json.loads(json.dumps(BOARD))
        self.approve(board)
        self.write_voice(board)
        old_review = MODULE.REVIEW.read_text(encoding="utf-8")
        wav_hash = MODULE.sha256_file(MODULE.scene_wav(2))
        MODULE.TIMINGS.write_text("{}", encoding="utf-8")
        MODULE.make_review_template()
        self.assertEqual(json.loads(MODULE.REVIEW.read_text(encoding="utf-8"))["status"], "REVIEW_REQUIRED")
        self.assertFalse(MODULE.scene_wav(2).exists())
        folders = list((self.root / "archive").iterdir())
        self.assertEqual(len(folders), 1)
        self.assertEqual((folders[0] / "script-review.json").read_text(encoding="utf-8"), old_review)
        self.assertEqual(MODULE.sha256_file(folders[0] / "scene-02.wav"), wav_hash)
        self.assertTrue((folders[0] / "tts-cache.json").is_file())
        self.assertTrue((folders[0] / "timings.json").is_file())

    def test_repeated_invalidation_never_overwrites_an_earlier_archive(self):
        board = json.loads(json.dumps(BOARD))
        self.approve(board)
        for expected in (1, 2):
            self.write_voice(board)
            MODULE.make_review_template()
            self.assertEqual(len(list((self.root / "archive").iterdir())), expected)
        self.assertEqual(len(list((self.root / "archive").glob("*/scene-01.wav"))), 2)


@needs_drawtext
class AssemblyTests(FixtureProject):
    """T4 게시 + 소리 처리: 합성 입력으로 실제 조립 경로를 실행한다. 산출물은 임시 폴더에만 있다."""

    def streams(self, path):
        info = MODULE.probe_media(path)
        return {s["codec_type"] for s in info["streams"]}, info

    def test_successful_build_stages_then_publishes_with_consumed_hashes(self):
        board = self.build_project(approved_scenes=(1,), audio_scenes=(1, 4))  # 4는 소리가 있지만 아직 미승인
        final = MODULE.build([1.5] * 7)
        self.assertEqual(final, self.root / MODULE.FINAL_NAME)
        kinds, info = self.streams(final)
        self.assertEqual(kinds, {"video", "audio"})
        video = MODULE.stream_of(info, "video")
        self.assertEqual((video["width"], video["height"]), (1080, 1920))
        report = json.loads((self.root / MODULE.REPORT_NAME).read_text(encoding="utf-8"))
        self.assertEqual(report["final_sha256"], MODULE.sha256_file(final))
        self.assertEqual(set(report["visual_sha256"]), {str(n) for n in range(1, 8)})
        self.assertEqual(report["visual_sha256"]["3"], self.sha(MODULE.VIDEO_SOURCES[3]))
        self.assertEqual(report["narration_wav_sha256"]["7"], self.sha("source/audio/scene-07.wav"))
        self.assertEqual(report["bgm"]["sha256"], self.sha(MODULE.BGM_PATH))
        self.assertEqual(report["narration_origin"], "gemini-api")
        sounds = {int(k): v for k, v in report["effect_sounds"].items()}
        self.assertEqual(sounds[1], "native audio")
        self.assertIn("approved가 true가 아님", sounds[4])
        self.assertTrue(sounds[3].startswith("silent: native_audio_approved"))
        self.assertTrue(sounds[2].startswith("silent: 정지 이미지") and sounds[7].startswith("silent: 정지 이미지"))
        self.assertFalse((self.root / "staging" / "x").exists())
        self.assertEqual(list((self.root / "staging").iterdir()), [], "성공하면 스테이징이 비어야 함")
        # 두 번째 실행은 완성본을 덮어쓰지 않고 시작 전에 막힌다
        before = MODULE.sha256_file(final)
        with self.assertRaisesRegex(SystemExit, "덮어쓰지 않습니다"):
            MODULE.build([1.5] * 7)
        self.assertEqual(MODULE.sha256_file(final), before)

    def test_concurrent_final_is_never_overwritten_and_no_orphan_report_remains(self):
        self.build_project()
        real = MODULE.publish_no_overwrite

        def race(staged, target):
            if target.name == MODULE.FINAL_NAME:  # 다른 실행이 먼저 게시한 상황
                target.write_bytes(b"other run")
            real(staged, target)

        with mock.patch.object(MODULE, "publish_no_overwrite", side_effect=race):
            with self.assertRaises(FileExistsError):
                MODULE.build([1.5] * 7)
        self.assertEqual((self.root / MODULE.FINAL_NAME).read_bytes(), b"other run")
        self.assertFalse((self.root / MODULE.REPORT_NAME).exists())
        self.assertTrue(any((self.root / "staging").iterdir()), "실패한 스테이징은 완성본과 구분해 보존")

    def test_report_uses_frozen_inputs_when_original_changes_after_rendering(self):
        self.build_project()
        original_hash = MODULE.sha256_file(MODULE.BOARD)
        real_probe = MODULE.probe_media

        def mutate_before_report(path):
            if path.parent.parent.name == "staging":
                changed = json.loads(MODULE.BOARD.read_text(encoding="utf-8"))
                changed["scenes"][0]["captions"] = ["changed after rendering"]
                MODULE.BOARD.write_text(json.dumps(changed), encoding="utf-8")
            return real_probe(path)

        with mock.patch.object(MODULE, "probe_media", side_effect=mutate_before_report):
            MODULE.build([1.5] * 7)
        report = json.loads((self.root / MODULE.REPORT_NAME).read_text(encoding="utf-8"))
        self.assertEqual(report["storyboard_sha256"], original_hash)
        self.assertNotEqual(report["storyboard_sha256"], MODULE.sha256_file(MODULE.BOARD))

    def test_failed_final_encode_leaves_no_final_and_allows_retry(self):
        self.build_project()
        with mock.patch.object(MODULE, "decode_error", side_effect=lambda p, **k: "손상" if p.parent.parent.name == "staging" else None):
            with self.assertRaisesRegex(SystemExit, "게시하지 않습니다"):
                MODULE.build([1.5] * 7)
        self.assertFalse((self.root / MODULE.FINAL_NAME).exists())
        self.assertFalse((self.root / MODULE.REPORT_NAME).exists())
        self.assertTrue(MODULE.build([1.5] * 7).is_file(), "부분 파일이 재시도를 막지 않아야 함")

    def test_publish_helper_refuses_existing_target(self):
        a, b = self.root / "a", self.root / "b"
        a.write_text("new", encoding="utf-8"); b.write_text("old", encoding="utf-8")
        with self.assertRaises(FileExistsError):
            MODULE.publish_no_overwrite(a, b)
        self.assertEqual(b.read_text(encoding="utf-8"), "old")

    def test_recover_preserves_orphan_report_and_refuses_completed_output(self):
        report = self.root / MODULE.REPORT_NAME
        data = json.dumps({"final": MODULE.FINAL_NAME, "final_sha256": "a" * 64})
        report.write_text(data, encoding="utf-8")
        archived = MODULE.recover_incomplete_publication()
        self.assertFalse(report.exists())
        self.assertEqual((archived / MODULE.REPORT_NAME).read_text(encoding="utf-8"), data)
        report.write_text(data, encoding="utf-8")
        final = self.root / MODULE.FINAL_NAME
        final.write_bytes(b"completed output")
        with self.assertRaises(SystemExit):
            MODULE.recover_incomplete_publication()
        self.assertEqual(final.read_bytes(), b"completed output")
        self.assertEqual(report.read_text(encoding="utf-8"), data)


if __name__ == "__main__":
    unittest.main()
