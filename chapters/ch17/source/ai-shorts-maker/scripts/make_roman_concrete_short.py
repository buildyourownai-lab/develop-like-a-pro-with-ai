#!/usr/bin/env python3
"""Kling 유료 생성 이미지·영상과 Gemini Charon 음성으로 로마 콘크리트 Shorts(Kling 단일 제작본)를 제작한다."""
from __future__ import annotations

import base64, hashlib, json, math, os, re, shutil, subprocess, sys, time, urllib.error, urllib.request, uuid, wave
from datetime import datetime, timezone
from pathlib import Path

from script_review import archive_invalidated, require_pass, review_template

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "artifacts/science-roman-concrete-kling-20261012"
PROTOTYPE_BOARD = ROOT / "prototypes/youtube-shorts/chapter-16/storyboard.json"
MANIFEST = PROJECT / "assets-manifest.json"
FINAL_NAME = "roman-concrete-kling-v2.mp4"
REPORT_NAME = "roman-concrete-kling-v2.build-report.json"
BOARD = PROJECT / "storyboard.json"
REVIEW = PROJECT / "script-review.json"
TIMINGS = PROJECT / "source/audio/timings.json"

def tool(env_name: str, command: str) -> str:
    configured = os.getenv(env_name)
    found = configured or shutil.which(command)
    if not found:
        raise SystemExit(f"{command}를 찾을 수 없습니다. {env_name}에 실행 파일 경로를 지정하세요.")
    return found

FFMPEG = tool("SHORTS_FFMPEG", "ffmpeg")
FFPROBE = tool("SHORTS_FFPROBE", "ffprobe")
MODEL = "gemini-3.1-flash-tts-preview"
VOICE = "Charon"
PROMPT_PREFIX = "차분하고 또렷한 한국어 다큐멘터리 내레이션으로, 과장 없이 자연스럽게 다음 문장만 읽어주세요. "

# Kling 영상 제작: 장면 1·3·4·5·6은 선택 영상 파일 하나씩, 장면 2·7은 승인한 기준 이미지의 느린 확대다.
# 선택 파일은 명시적으로 기록한 편집 파생일 수 있다. 장면3의 원본 작업장 영상+Kling 작업자 이미지 연결,
# 장면5의 실제 성장 구간 선택처럼 원본·사용 구간·편집 방법을 manifest에 기록한다.
# 편집 파생을 새로 생성한 단일 Kling 클립이라고 부르지 않는다.
# 선택한 클립이 없으면 기준 이미지로 대체하거나 성공으로 처리하지 않고 중단한다.
VIDEO_SOURCES = {
    1: "source/video/selected/scene-01-kling.mp4",
    3: "source/video/selected/scene-03-kling.mp4",
    4: "source/video/selected/scene-04-kling.mp4",
    5: "source/video/selected/scene-05-kling.mp4",
    6: "source/video/selected/scene-06-kling.mp4",
}
STILL_SCENES = (2, 7)
SCENE_IDS = tuple(range(1, 8))
# 효과음은 클립에 실제 원래 소리가 있고 manifest에서 권리 기록과 함께 승인한 장면에서만 쓴다.
# 장면 2·7은 항상 효과음이 없다. 승인 전·소리 없음은 조용히 무음 처리하고 build report에 이유를 남긴다.
SFX_GAINS = {1: 4.0, 3: 8.0, 4: 2.2, 5: 2.2, 6: 2.2}
BGM_PATH = "source/bgm/pulsar.mp3"
BGM_TRACK = "Pulsar"
BGM_ARTIST = "The Grey Room / Density & Time"
MAX_SLOWDOWN = 2.0  # 클립을 내레이션 길이에 맞추려 늘릴 수 있는 최대 배수. 넘으면 중단한다.
MANIFEST_READY_STATUS = "SELECTED_AND_RECORDED"
REQUIRED_RIGHTS_FIELDS = ("service", "plan", "model", "generated_at", "terms_url", "terms_checked_at", "rights_basis")
REQUIRED_RECORD_FIELDS = REQUIRED_RIGHTS_FIELDS + ("prompt", "selection_reason")
NATIVE_AUDIO_RIGHTS_FIELDS = ("native_audio_rights_basis", "native_audio_reviewed_by", "native_audio_reviewed_at")
BGM_RECORD_FIELDS = ("source", "license_text", "downloaded_at")
IMPORT_PROVENANCE_FIELDS = ("source", "model", "generated_at", "verified_by", "rights_basis")
VOICE_ORIGINS = ("gemini-api", "imported")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

def secret() -> str:
    if os.getenv("GEMINI_API_KEY"):
        return os.environ["GEMINI_API_KEY"]
    for p in [ROOT / ".secrets/chapter-16.env"]:
        if p.exists():
            for line in p.read_text().splitlines():
                if line.startswith("GEMINI_API_KEY="):
                    return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit("GEMINI_API_KEY가 없습니다.")

def font_file() -> str:
    configured = os.getenv("SHORTS_FONT_FILE")
    candidates = [
        configured,
        "/System/Library/Fonts/AppleSDGothicNeo.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "C:/Windows/Fonts/malgun.ttf",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    fc_match = shutil.which("fc-match")
    if fc_match:
        matched = subprocess.check_output(
            [fc_match, "-f", "%{file}", "Noto Sans CJK KR"], text=True
        ).strip()
        if matched and Path(matched).is_file():
            return matched
    raise SystemExit("한글 글꼴을 찾을 수 없습니다. SHORTS_FONT_FILE에 글꼴 경로를 지정하세요.")

# ---------------------------------------------------------------- 공통 보조

def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))

def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def blank(value) -> bool:
    return value is None or not str(value).strip()

def audio_dir() -> Path:
    return PROJECT / "source/audio"

def cache_path() -> Path:
    return audio_dir() / "tts-cache.json"

def scene_wav(scene: int) -> Path:
    return audio_dir() / f"scene-{scene:02d}.wav"

def duration(p: Path) -> float:
    return float(subprocess.check_output([FFPROBE,"-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",str(p)], text=True))

def probe_media(p: Path) -> dict:
    """ffprobe로 실제 스트림·길이를 읽는다. 읽을 수 없으면 ValueError."""
    result = subprocess.run([FFPROBE,"-v","error","-show_streams","-show_format","-of","json",str(p)],
                            capture_output=True, text=True)
    if result.returncode != 0:
        raise ValueError(result.stderr.strip() or "ffprobe 실패")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValueError(f"ffprobe 출력 오류: {error}")

def decode_error(p: Path, *, one_frame: bool = False) -> str | None:
    """끝까지(이미지는 1프레임) 실제로 디코딩해 본다. 오류가 있으면 첫 줄을 반환한다."""
    cmd = [FFMPEG,"-v","error","-xerror","-i",str(p)]
    if one_frame:
        cmd += ["-frames:v","1"]
    result = subprocess.run(cmd + ["-f","null","-"], capture_output=True, text=True)
    if result.returncode != 0 or result.stderr.strip():
        return (result.stderr.strip().splitlines() or ["디코딩 실패"])[0]
    return None

def finite_positive(value) -> bool:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    return math.isfinite(number) and number > 0

def stream_of(info: dict, kind: str) -> dict | None:
    return next((s for s in info.get("streams", []) if s.get("codec_type") == kind), None)

def media_duration(info: dict) -> float | None:
    value = info.get("format", {}).get("duration")
    return float(value) if finite_positive(value) else None

# ---------------------------------------------------------------- 장면·길이 계약

def validate_plan(board: dict) -> None:
    scenes = board.get("scenes")
    if not isinstance(scenes, list) or [s.get("scene") for s in scenes] != list(SCENE_IDS):
        raise SystemExit(f"장면은 정확히 {list(SCENE_IDS)} 순서여야 합니다: {[s.get('scene') for s in scenes or []]}")
    for s in scenes:
        if blank(s.get("narration")):
            raise SystemExit(f"장면 {s['scene']}: 내레이션이 비어 있습니다")
        captions = s.get("captions")
        if not isinstance(captions, list) or not captions or any(blank(c) for c in captions):
            raise SystemExit(f"장면 {s['scene']}: 자막이 비어 있습니다")

def validate_durations(ds) -> list[float]:
    if not isinstance(ds, (list, tuple)) or len(ds) != len(SCENE_IDS):
        raise SystemExit(f"장면 길이는 정확히 {len(SCENE_IDS)}개여야 합니다: {len(ds) if hasattr(ds, '__len__') else ds}")
    bad = [i for i, d in enumerate(ds, 1) if not finite_positive(d)]
    if bad:
        raise SystemExit(f"장면 길이가 유한한 양수가 아닙니다: 장면 {bad}")
    return [float(d) for d in ds]

def load_board() -> dict:
    if not BOARD.is_file():
        raise SystemExit(f"Storyboard가 없습니다: {BOARD}. 먼저 init 명령을 실행하세요.")
    board = json.loads(BOARD.read_text(encoding="utf-8"))
    validate_plan(board)
    return board

# ---------------------------------------------------------------- 대본 검수·보존

def make_review_template() -> Path:
    board = json.loads(BOARD.read_text(encoding="utf-8"))
    REVIEW.parent.mkdir(parents=True, exist_ok=True)
    # 이전 검수 기록과 이미 만든 유료 음성은 지우지 않고 Archive로 옮긴다.
    old_audio = sorted(audio_dir().glob("scene-*.wav")) if audio_dir().is_dir() else []
    archived = archive_invalidated(PROJECT / "archive", [REVIEW, *old_audio, TIMINGS, cache_path()])
    if archived:
        print(f"이전 검수 기록·음성을 보관했습니다: {archived}")
    REVIEW.write_text(
        json.dumps(review_template(board), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return REVIEW

def init_project() -> Path:
    """승인 전 Storyboard 초안을 새 작업 폴더로 복사한다. 다른 내용의 기존 파일은 덮어쓰지 않는다."""
    PROJECT.mkdir(parents=True, exist_ok=True)
    if BOARD.exists():
        if BOARD.read_bytes() != PROTOTYPE_BOARD.read_bytes():
            raise SystemExit(f"{BOARD}가 이미 있고 초안과 다릅니다. 덮어쓰지 않습니다.")
    else:
        shutil.copyfile(PROTOTYPE_BOARD, BOARD)
    return BOARD

# ---------------------------------------------------------------- 음성 Cache와 출처

def prompt_for(narration: str) -> str:
    return PROMPT_PREFIX + narration

def read_cache() -> dict:
    p = cache_path()
    if not p.is_file():
        return {"version": 1, "entries": {}}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data.get("entries"), dict):
            return data
    except (json.JSONDecodeError, AttributeError):
        pass
    return {"version": 1, "entries": {}}

def write_cache(data: dict) -> None:
    p = cache_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".part")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, p)

def cache_problem(scene: dict, entry: dict | None) -> str | None:
    """이 WAV를 현재 내레이션의 음성으로 재사용해도 되는지 확인한다. 문제 설명 또는 None."""
    n = scene["scene"]
    wav = scene_wav(n)
    if not wav.is_file():
        return "WAV 없음"
    if not isinstance(entry, dict):
        return "출처 기록 없음(파일 이름만으로는 재사용하지 않음)"
    if entry.get("narration_sha256") != sha256_text(scene["narration"]):
        return "내레이션 Digest가 현재 대본과 다름"
    if entry.get("wav_sha256") != sha256_file(wav):
        return "WAV 해시가 기록과 다름(검수 뒤 교체됨)"
    if entry.get("voice") != VOICE:
        return f"voice가 {VOICE}가 아님"
    origin = entry.get("origin")
    if origin == "gemini-api":
        if entry.get("model") != MODEL:
            return "TTS 모델이 현재 설정과 다름"
        if entry.get("prompt_sha256") != sha256_text(prompt_for(scene["narration"])):
            return "TTS 프롬프트 Digest가 다름"
    elif origin == "imported":
        provenance = entry.get("provenance")
        if not isinstance(provenance, dict) or any(blank(provenance.get(f)) for f in IMPORT_PROVENANCE_FIELDS):
            return "가져온 음성의 출처 기록이 불완전함"
    else:
        return f"알 수 없는 origin: {origin}"
    return None

def voice_origin(board: dict) -> str:
    """모든 장면의 Cache가 유효할 때 그 origin을 반환한다. 아니면 SystemExit."""
    entries = read_cache()["entries"]
    problems = []
    for s in board["scenes"]:
        problem = cache_problem(s, entries.get(str(s["scene"])))
        if problem:
            problems.append(f"장면 {s['scene']}: {problem}")
    origins = {entries[str(s["scene"])].get("origin") for s in board["scenes"] if str(s["scene"]) in entries}
    if len(origins) > 1:
        problems.append(f"음성 origin이 섞여 있음: {sorted(map(str, origins))}")
    if problems:
        raise SystemExit("현재 대본의 유효한 음성이 아닙니다:\n- " + "\n- ".join(problems))
    return origins.pop()

def wav_check(p: Path) -> float:
    try:
        info = probe_media(p)
    except ValueError as error:
        raise SystemExit(f"{p.name}을 읽을 수 없습니다: {error}")
    if stream_of(info, "audio") is None or media_duration(info) is None:
        raise SystemExit(f"{p.name}: 오디오 스트림 또는 길이가 올바르지 않습니다")
    error = decode_error(p)
    if error:
        raise SystemExit(f"{p.name}: 디코딩 실패: {error}")
    return media_duration(info)

def import_voice() -> int:
    """저자가 승인해 외부(예: Google AI Studio)에서 만든 Charon 음성을 출처 기록과 함께 등록한다.

    source/audio/voice-import.json에 voice, provenance(5개 필드), scenes[].wav를 직접 적어야 하며,
    이 명령은 값을 만들어내지 않고 현재 대본·실제 파일에 대해 해시를 계산해 기록할 뿐이다.
    """
    require_pass(BOARD, REVIEW)
    board = load_board()
    spec_path = audio_dir() / "voice-import.json"
    if not spec_path.is_file():
        raise SystemExit(f"가져오기 기록이 없습니다: {spec_path}")
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    problems = []
    if spec.get("voice") != VOICE:
        problems.append(f"voice는 {VOICE}여야 합니다: {spec.get('voice')!r}")
    provenance = spec.get("provenance") or {}
    problems += [f"provenance.{f} 없음" for f in IMPORT_PROVENANCE_FIELDS if blank(provenance.get(f))]
    files = {item.get("scene"): item.get("wav") for item in spec.get("scenes", [])}
    entries = {}
    for s in board["scenes"]:
        n = s["scene"]
        if files.get(n) != f"source/audio/scene-{n:02d}.wav":
            problems.append(f"장면 {n}: wav는 source/audio/scene-{n:02d}.wav여야 합니다")
            continue
        if not scene_wav(n).is_file():
            problems.append(f"장면 {n}: WAV 파일 없음")
            continue
        try:
            wav_check(scene_wav(n))
        except SystemExit as error:
            problems.append(f"장면 {n}: {error}")
            continue
        entries[str(n)] = {
            "narration_sha256": sha256_text(s["narration"]), "wav_sha256": sha256_file(scene_wav(n)),
            "voice": VOICE, "model": provenance.get("model"), "origin": "imported",
            "provenance": {f: provenance.get(f) for f in IMPORT_PROVENANCE_FIELDS},
            "recorded_at": datetime.now(timezone.utc).isoformat(),
        }
    if problems:
        raise SystemExit("음성 가져오기를 중단합니다:\n- " + "\n- ".join(problems))
    archive_invalidated(PROJECT / "archive", [cache_path()])
    write_cache({"version": 1, "entries": entries})
    print(f"가져온 Charon 음성 {len(entries)}개를 등록했습니다.")
    return 0

# ---------------------------------------------------------------- 사전 검증

def load_selected(board: dict) -> dict[int, dict]:
    """assets-manifest.json의 선택·권리·해시 기록과 실제 파일을 대조한다. 하나라도 어긋나면 중단한다."""
    if not MANIFEST.is_file():
        raise SystemExit(f"권리·선택 기록이 없습니다: {MANIFEST}")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    problems = []
    if manifest.get("status") != MANIFEST_READY_STATUS:
        problems.append(f"manifest status는 {MANIFEST_READY_STATUS}여야 합니다: {manifest.get('status')!r}")
    raw = manifest.get("selected_visuals", [])
    ids = [e.get("scene") for e in raw]
    if sorted(ids, key=str) != sorted(SCENE_IDS, key=str) or len(set(ids)) != len(ids):
        problems.append(f"selected_visuals는 장면 {list(SCENE_IDS)}를 중복·누락·추가 없이 한 번씩 가져야 합니다: {ids}")
    entries = {e.get("scene"): e for e in raw}
    seen_hashes: dict[str, int] = {}
    for n in SCENE_IDS:
        entry = entries.get(n)
        if entry is None:
            continue
        still = n in STILL_SCENES
        expected = f"source/images/scene-{n:02d}.png" if still else VIDEO_SOURCES[n]
        if entry.get("file") != expected:
            problems.append(f"장면 {n}: file은 {expected}이어야 함")
        if entry.get("source") != "Kling" or entry.get("type") != ("image" if still else "video"):
            problems.append(f"장면 {n}: Kling {'image' if still else 'video'} 기록이어야 함")
        for field in REQUIRED_RECORD_FIELDS:
            if blank(entry.get(field)):
                problems.append(f"장면 {n}: {field} 기록 없음")
        if not blank(entry.get("service")) and str(entry["service"]).strip() != "Kling":
            problems.append(f"장면 {n}: service는 Kling이어야 함: {entry['service']!r}")
        path = PROJECT / expected
        recorded = entry.get("sha256")
        valid_hash = isinstance(recorded, str) and bool(SHA256_RE.match(recorded))
        if not valid_hash:
            problems.append(f"장면 {n}: sha256 기록이 64자리 소문자 16진수가 아님")
        if not path.is_file():
            problems.append(f"장면 {n}: 선택한 파일이 없음 {expected}")
        elif valid_hash:
            actual = sha256_file(path)
            if actual != recorded:
                problems.append(f"장면 {n}: sha256 불일치(기록 {recorded[:12]}…, 실제 {actual[:12]}…)")
            if actual in seen_hashes:
                problems.append(f"장면 {n}: 장면 {seen_hashes[actual]}과 같은 파일을 선택함")
            seen_hashes[actual] = n
        if not still:
            if not isinstance(entry.get("native_audio"), bool):
                problems.append(f"장면 {n}: native_audio는 true/false여야 함")
            if not isinstance(entry.get("native_audio_approved"), bool):
                problems.append(f"장면 {n}: native_audio_approved는 true/false여야 함")
            if entry.get("native_audio_approved") is True:
                if entry.get("native_audio") is not True:
                    problems.append(f"장면 {n}: 소리가 없다고 기록한 클립의 효과음을 승인할 수 없음")
                problems += [f"장면 {n}: {f} 기록 없음" for f in NATIVE_AUDIO_RIGHTS_FIELDS if blank(entry.get(f))]
    audio = manifest.get("audio") or {}
    if audio.get("track") != BGM_TRACK or audio.get("artist") != BGM_ARTIST:
        problems.append(f"audio는 {BGM_TRACK} — {BGM_ARTIST}여야 합니다(다른 곡 대체 금지)")
    problems += [f"audio.{f} 기록 없음" for f in BGM_RECORD_FIELDS if blank(audio.get(f))]
    bgm = PROJECT / BGM_PATH
    if not bgm.is_file():
        problems.append(f"BGM이 없습니다: {bgm}. 다른 음악으로 바꾸지 않고 중단합니다.")
    elif audio.get("sha256") != sha256_file(bgm):
        problems.append("audio.sha256이 실제 pulsar.mp3와 다르거나 없음")
    voice = manifest.get("voice") or {}
    if voice.get("voice") != VOICE:
        problems.append(f"voice.voice는 {VOICE}여야 합니다: {voice.get('voice')!r}")
    if voice.get("origin") not in VOICE_ORIGINS:
        problems.append(f"voice.origin은 {list(VOICE_ORIGINS)} 중 하나여야 합니다")
    if blank(voice.get("rights_basis")):
        problems.append("voice.rights_basis 기록 없음")
    if problems:
        raise SystemExit("제작을 중단합니다:\n- " + "\n- ".join(problems))
    return entries

def check_media(selected: dict[int, dict]) -> dict[int, dict]:
    """선택한 이미지·영상·BGM이 실제로 열리고 디코딩되는지 확인한다. 장면별 영상 정보를 반환한다."""
    problems, infos = [], {}
    for n in SCENE_IDS:
        still = n in STILL_SCENES
        rel = f"source/images/scene-{n:02d}.png" if still else VIDEO_SOURCES[n]
        path = PROJECT / rel
        try:
            info = probe_media(path)
        except ValueError as error:
            problems.append(f"장면 {n}: {rel}을 읽을 수 없음: {error}")
            continue
        video = stream_of(info, "video")
        if video is None:
            problems.append(f"장면 {n}: {rel}에 영상 스트림이 없음")
            continue
        if not (int(video.get("height") or 0) > int(video.get("width") or 0) > 0):
            problems.append(f"장면 {n}: 세로 화면이 아님({video.get('width')}x{video.get('height')})")
        if not still and media_duration(info) is None:
            problems.append(f"장면 {n}: 영상 길이가 유한한 양수가 아님")
        error = decode_error(path, one_frame=still)
        if error:
            problems.append(f"장면 {n}: 디코딩 실패: {error}")
        if not still:
            has_sound = stream_of(info, "audio") is not None
            entry = selected[n]
            if entry.get("native_audio") is True and not has_sound:
                problems.append(f"장면 {n}: native_audio=true로 기록했지만 클립에 오디오 스트림이 없음")
            if entry.get("native_audio") is False and has_sound:
                problems.append(f"장면 {n}: native_audio=false로 기록했지만 클립에 오디오 스트림이 있음")
            info["_has_audio"] = has_sound
        infos[n] = info
    bgm = PROJECT / BGM_PATH
    try:
        info = probe_media(bgm)
        if stream_of(info, "audio") is None or media_duration(info) is None:
            problems.append("BGM에 오디오 스트림 또는 유한한 길이가 없음")
        else:
            error = decode_error(bgm)
            if error:
                problems.append(f"BGM 디코딩 실패: {error}")
    except ValueError as error:
        problems.append(f"BGM을 읽을 수 없음: {error}")
    if problems:
        raise SystemExit("미디어 검사를 통과하지 못했습니다:\n- " + "\n- ".join(problems))
    return infos

def require_drawtext() -> None:
    """자막을 입히는 drawtext 필터(libfreetype)가 없는 FFmpeg는 조립 중간에 실패하므로 미리 막는다."""
    filters = subprocess.run([FFMPEG,"-hide_banner","-filters"], capture_output=True, text=True).stdout
    if " drawtext " not in filters:
        raise SystemExit(f"{FFMPEG}에 drawtext 필터(libfreetype)가 없습니다. SHORTS_FFMPEG·SHORTS_FFPROBE에 drawtext가 있는 FFmpeg 경로를 지정하세요.")

def require_font_renders() -> str:
    """글꼴 파일이 실제로 한글을 그릴 수 있는지 한 프레임으로 확인한다."""
    font = font_file()
    with open(font, "rb") as handle:
        magic = handle.read(4)
    # FFmpeg는 깨진 글꼴 파일을 오류 없이 대체 글꼴로 그릴 수 있으므로 파일 형식도 직접 확인한다.
    if magic not in (b"\x00\x01\x00\x00", b"OTTO", b"ttcf", b"true"):
        raise SystemExit(f"글꼴로 한글을 그릴 수 없습니다({font}): TrueType/OpenType 글꼴 파일이 아닙니다")
    probe = subprocess.run([FFMPEG,"-v","error","-f","lavfi","-i","color=c=black:s=320x240:d=0.1","-vf",
        f"drawtext=fontfile='{esc(font)}':text='한글':fontsize=40:fontcolor=white","-frames:v","1","-f","null","-"],
        capture_output=True, text=True)
    if probe.returncode != 0 or probe.stderr.strip():
        raise SystemExit(f"글꼴로 한글을 그릴 수 없습니다({font}): {probe.stderr.strip()[:200]}")
    return font

def check_stretch(board: dict, infos: dict[int, dict], durations: list[float]) -> dict[int, float]:
    """내레이션 길이에 맞추려는 클립 늘림 배수를 계산하고 상한을 넘으면 중단한다."""
    stretch, problems = {}, []
    for scene, raw_d in zip(board["scenes"], durations):
        n = scene["scene"]
        if n not in VIDEO_SOURCES:
            continue
        speed = (raw_d / 1.25 + .35) / media_duration(infos[n])
        stretch[n] = round(speed, 4)
        if speed > MAX_SLOWDOWN:
            problems.append(f"장면 {n}: 클립을 {speed:.2f}배로 늘려야 합니다(상한 {MAX_SLOWDOWN}). 더 긴 클립을 선택하세요.")
    if problems:
        raise SystemExit("\n".join(problems))
    return stretch

def preflight(*, require_voice: bool = False) -> dict:
    """유료 TTS 호출 전에 대본 승인·장면 계약·선택 자산·실제 미디어·BGM·글꼴·FFmpeg를 모두 확인한다.

    require_voice=True(조립 직전)에는 현재 대본과 묶인 유효한 음성 Cache와 길이까지 확인한다.
    음성 길이에 의존하는 클립 늘림 상한은 음성이 있을 때만 사전 확인하고, 없으면 조립 직전에 다시 확인한다.
    """
    input_paths = [BOARD, REVIEW, MANIFEST, PROJECT / BGM_PATH, cache_path()]
    input_paths += [PROJECT / rel for rel in VIDEO_SOURCES.values()]
    input_paths += [PROJECT / f"source/images/scene-{n:02d}.png" for n in STILL_SCENES]
    input_paths += [scene_wav(n) for n in SCENE_IDS]
    input_hashes = {p: sha256_file(p) for p in input_paths if p.is_file()}
    board = load_board()
    require_pass(BOARD, REVIEW)
    selected = load_selected(board)
    infos = check_media(selected)
    final, report = PROJECT / FINAL_NAME, PROJECT / REPORT_NAME
    for existing in (final, report):
        if existing.exists():
            raise SystemExit(f"{existing}이 이미 있습니다. 덮어쓰지 않습니다.")
    require_drawtext()
    font = require_font_renders()
    context = {"board": board, "selected": selected, "infos": infos, "font": font, "durations": None, "stretch": None}
    cached = all(cache_problem(s, read_cache()["entries"].get(str(s["scene"]))) is None for s in board["scenes"])
    manifest_voice = json.loads(MANIFEST.read_text(encoding="utf-8")).get("voice", {})
    if require_voice or cached or manifest_voice.get("origin") == "imported":
        origin = voice_origin(board)
        if manifest_voice.get("origin") != origin:
            raise SystemExit(f"manifest voice.origin({manifest_voice.get('origin')!r})이 실제 음성 origin({origin!r})과 다릅니다")
        durations = validate_durations([wav_check(scene_wav(n)) for n in SCENE_IDS])
        context.update(durations=durations, stretch=check_stretch(board, infos, durations), voice_origin=origin)
    for path, digest in input_hashes.items():
        if not path.is_file() or sha256_file(path) != digest:
            raise SystemExit(f"검사 중 입력이 변경됐습니다: {path}")
    context.update(input_hashes=input_hashes, font_sha256=sha256_file(Path(font)))
    return context

# ---------------------------------------------------------------- 음성 생성

def archive_stale_audio(board: dict) -> None:
    entries = read_cache()["entries"]
    stale = [scene_wav(s["scene"]) for s in board["scenes"]
             if scene_wav(s["scene"]).is_file() and cache_problem(s, entries.get(str(s["scene"])))]
    archived = archive_invalidated(PROJECT / "archive", stale)
    if archived:
        print(f"현재 대본과 묶이지 않은 음성을 보관했습니다: {archived}")

def synthesize(key: str, narration: str, path: Path) -> None:
    payload={"contents":[{"parts":[{"text":prompt_for(narration)}]}],"generationConfig":{"responseModalities":["AUDIO"],"speechConfig":{"voiceConfig":{"prebuiltVoiceConfig":{"voiceName":VOICE}}}}}
    req=urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",data=json.dumps(payload,ensure_ascii=False).encode(),headers={"Content-Type":"application/json","x-goog-api-key":key},method="POST")
    for attempt in range(4):
        try:
            data=json.load(urllib.request.urlopen(req,timeout=180))["candidates"][0]["content"]["parts"][0]["inlineData"]
            break
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 3: raise
            time.sleep(45)
    raw=base64.b64decode(data["data"])
    part=path.with_name(path.name+".part")
    if raw.startswith(b"RIFF"): part.write_bytes(raw)
    else:
        rate=int((re.search(r"rate=(\d+)",data.get("mimeType","")) or [None,"24000"])[1])
        with wave.open(str(part),"wb") as w: w.setparams((1,2,rate,0,"NONE","")); w.writeframes(raw)
    os.replace(part, path)

def tts() -> list[float]:
    # 검수 기록이 없거나 현재 대본의 Digest와 다르면 API 호출과 Cache 재사용을 모두 막는다.
    require_pass(BOARD, REVIEW)
    board=load_board()
    manifest_voice = json.loads(MANIFEST.read_text(encoding="utf-8")).get("voice", {}) if MANIFEST.is_file() else {}
    if manifest_voice.get("origin") == "imported":
        if voice_origin(board) != "imported":
            raise SystemExit("가져온 Charon 음성을 먼저 import-voice로 등록하세요. API로 대체하지 않습니다.")
        return validate_durations([wav_check(scene_wav(n)) for n in SCENE_IDS])
    audio_dir().mkdir(parents=True,exist_ok=True)
    # 파일 이름만으로는 재사용하지 않는다. 현재 내레이션·모델·Voice·프롬프트·WAV 해시가 모두 맞는 항목만 쓴다.
    archive_stale_audio(board)
    cache=read_cache(); key=None; result=[]
    for s in board["scenes"]:
        n=s["scene"]; p=scene_wav(n)
        if not p.exists():
            key = key or secret()
            synthesize(key, s["narration"], p)
            wav_check(p)
            cache["entries"][str(n)]={
                "narration_sha256": sha256_text(s["narration"]), "wav_sha256": sha256_file(p),
                "voice": VOICE, "model": MODEL, "prompt_sha256": sha256_text(prompt_for(s["narration"])),
                "origin": "gemini-api", "provenance": None, "recorded_at": datetime.now(timezone.utc).isoformat(),
            }
            write_cache(cache)
            time.sleep(35)
        result.append(duration(p))
    return validate_durations(result)

# ---------------------------------------------------------------- 조립

def esc(s: str) -> str:
    return s.replace("\\","\\\\").replace(":","\\:").replace("'","\\'")

def publish_no_overwrite(staged: Path, target: Path) -> None:
    """같은 파일 시스템에서 하드 링크로 게시한다. 이미 있으면 덮어쓰지 않고 FileExistsError."""
    os.link(staged, target)

def recover_incomplete_publication() -> Path:
    """최종 파일 없는 보고서만 보관한다. 스테이징을 자동으로 완성본에 승격하지 않는다."""
    final, report = PROJECT / FINAL_NAME, PROJECT / REPORT_NAME
    if final.exists() or not report.is_file():
        raise SystemExit("최종 파일이 없고 보고서만 남은 경우에만 recover를 실행할 수 있습니다.")
    data = json.loads(report.read_text(encoding="utf-8"))
    if data.get("final") != FINAL_NAME or not SHA256_RE.fullmatch(data.get("final_sha256", "")):
        raise SystemExit("제작 보고서 형식이 아니므로 자동 보관하지 않습니다.")
    return archive_invalidated(PROJECT / "archive", [report])

def build(ds: list[float]) -> Path:
    ds = validate_durations(ds)
    ctx = preflight(require_voice=True)
    board, selected, infos, font = ctx["board"], ctx["selected"], ctx["infos"], ctx["font"]
    stretch = check_stretch(board, infos, ds)  # 넘겨 받은 길이 기준으로 다시 확인한다
    run_id = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    work = PROJECT/"work"/run_id; work.mkdir(parents=True)
    stage = PROJECT/"staging"/run_id; stage.mkdir(parents=True)
    frozen = work / "inputs"
    for original, digest in ctx["input_hashes"].items():
        target = frozen / original.relative_to(PROJECT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
        if sha256_file(target) != digest:
            raise SystemExit(f"조립 입력을 고정하는 동안 파일이 변경됐습니다: {original}")
    original_font = font
    frozen_font = frozen / "font" / Path(font).name
    frozen_font.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(font, frozen_font)
    if sha256_file(frozen_font) != ctx["font_sha256"]:
        raise SystemExit("조립 전 글꼴이 변경됐습니다.")
    font = str(frozen_font)
    bgm=frozen/BGM_PATH; final=PROJECT/FINAL_NAME; report_path=PROJECT/REPORT_NAME
    clips=[]
    for s,raw_d in zip(board["scenes"],ds):
        i=s["scene"]
        d=raw_d/1.25
        img=frozen/f"source/images/scene-{i:02d}.png"; clip=work/f"scene-{i:02d}.mp4"
        cap="  ·  ".join(s["captions"])
        # 2배 해상도에서 움직인 뒤 축소해 zoompan의 정수 좌표 떨림을 숨긴다.
        z="min(zoom+0.00028,1.06)"
        pan_x=("iw/2-(iw/zoom/2)+on*0.35" if i % 2 else
               "iw/2-(iw/zoom/2)-on*0.35")
        if i in VIDEO_SOURCES:
            source=frozen/VIDEO_SOURCES[i]
            visual=work/f"visual-{i:02d}.mp4"
            target = d + .35
            subprocess.run([FFMPEG,"-y","-i",str(source),
                "-an","-vf",f"scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setpts={stretch[i]:.8f}*PTS,fps=30,tpad=stop_mode=clone:stop_duration=1,trim=duration={target},setpts=PTS-STARTPTS",
                "-c:v","libx264","-crf","17","-preset","medium",str(visual)],check=True)
            source_filter="null"
            visual_args=["-i",str(visual)]
        else:
            source_filter=f"scale=4320:7680:force_original_aspect_ratio=increase,crop=4320:7680,zoompan=z='{z}':x='{pan_x}':y='ih/2-(ih/zoom/2)':d={int((d+.35)*30)}:s=2160x3840:fps=30,scale=1080:1920:flags=lanczos"
            visual_args=["-loop","1","-i",str(img)]
        illustration_note = ""
        if i in (2, 4, 5, 6):
            note = "원리 설명용 AI 시각화" + (" · 시간 경과 압축" if i == 5 else "")
            illustration_note = (
                f"drawtext=fontfile='{esc(font)}':text='{esc(note)}':fontcolor=white:"
                "fontsize=32:x=(w-text_w)/2:y=90:box=1:boxcolor=black@0.35:boxborderw=12,"
            )
        vf=(source_filter+","+illustration_note+
            f"drawbox=x=0:y=1450:w=1080:h=250:color=black@0.34:t=fill,"
            f"drawtext=fontfile='{esc(font)}':text='{esc(cap)}':fontcolor=white:fontsize=60:x=(w-text_w)/2:y=1525:shadowcolor=black@0.8:shadowx=3:shadowy=3,format=yuv420p")
        subprocess.run([FFMPEG,"-y",*visual_args,"-i",str(frozen / scene_wav(i).relative_to(PROJECT)),"-vf",vf,"-af","atempo=1.25,afade=t=in:d=0.12,afade=t=out:st="+str(max(0.1,d-0.2))+":d=0.2","-t",str(d+.18),"-c:v","libx264","-crf","18","-preset","medium","-c:a","aac","-b:a","192k",str(clip)],check=True)
        clips.append(clip)
    lst=work/"concat.txt"; lst.write_text("".join(f"file '{p}'\n" for p in clips))

    # 효과음: 클립에 실제 오디오가 있고 권리 기록과 함께 승인한 장면만 쓴다. 나머지는 이유와 함께 무음이다.
    sfx_status={}
    inputs=[]
    for scene in SFX_GAINS:
        entry=selected[scene]
        if entry.get("native_audio_approved") is not True:
            sfx_status[scene]="silent: native_audio_approved가 true가 아님"
        elif not infos[scene].get("_has_audio"):
            sfx_status[scene]="silent: 클립에 오디오 스트림 없음"
        else:
            sfx_status[scene]="native audio"
            inputs.extend(["-i", str(frozen/VIDEO_SOURCES[scene])])
    for scene in STILL_SCENES:
        sfx_status[scene]="silent: 정지 이미지 장면"

    scene_lengths=[duration(clip) for clip in clips]
    total=sum(scene_lengths)
    source_index=2
    sfx_filters=[]
    for scene, scene_length in enumerate(scene_lengths, 1):
        if sfx_status[scene] != "native audio":
            sfx_filters.append(
                f"anullsrc=r=48000:cl=stereo,atrim=0:{scene_length:.6f}[s{scene}]"
            )
            continue
        # 화면을 늘리거나 줄인 만큼 효과음도 같은 배수로 맞춘다.
        sfx_filters.append(
            f"[{source_index}:a]aresample=48000,asetpts=PTS-STARTPTS,atempo={1/stretch[scene]:.6f},"
            f"volume={SFX_GAINS[scene]},alimiter=0.85,apad,atrim=0:{scene_length:.6f}[s{scene}]"
        )
        source_index += 1

    mix=(";".join(sfx_filters) + ";" +
         "".join(f"[s{scene}]" for scene in SCENE_IDS) +
         f"concat=n={len(SCENE_IDS)}:v=0:a=1,volume=0.75[sfx];"
         f"[1:a]volume=0.15,afade=t=in:d=1.0,afade=t=out:st={max(0.0, total-1.5):.3f}:d=1.5[bgm];"
         "[bgm][0:a]sidechaincompress=threshold=0.04:ratio=4:attack=20:release=420[dbgm];"
         "[sfx][0:a]sidechaincompress=threshold=0.05:ratio=3:attack=12:release=250[dsfx];"
         "[0:a][dbgm][dsfx]amix=inputs=3:duration=first:dropout_transition=0,alimiter=limit=0.95[a]")
    staged_final = stage/FINAL_NAME
    subprocess.run([FFMPEG,"-y","-f","concat","-safe","0","-i",str(lst),
        "-stream_loop","-1","-i",str(bgm),*inputs,"-filter_complex",mix,"-map","0:v","-map","[a]",
        "-c:v","copy","-c:a","aac","-ar","48000","-b:a","192k","-shortest",str(staged_final)],check=True)

    # 만든 결과가 실제 1080x1920 영상+오디오이고 디코딩되는지 게시 전에 확인한다.
    final_info=probe_media(staged_final); fv=stream_of(final_info,"video")
    if (stream_of(final_info,"audio") is None or fv is None or (fv.get("width"),fv.get("height"))!=(1080,1920)
            or media_duration(final_info) is None or decode_error(staged_final)):
        raise SystemExit(f"조립 결과가 올바르지 않아 게시하지 않습니다. 스테이징 보존: {stage}")
    report={
        "final": FINAL_NAME,
        "final_sha256": sha256_file(staged_final),
        "final_duration_seconds": media_duration(final_info),
        "storyboard_sha256": sha256_file(frozen / BOARD.relative_to(PROJECT)),
        "script_review_sha256": sha256_file(frozen / REVIEW.relative_to(PROJECT)),
        "manifest_sha256": sha256_file(frozen / MANIFEST.relative_to(PROJECT)),
        "visual_sha256": {str(n): sha256_file(frozen/(f"source/images/scene-{n:02d}.png" if n in STILL_SCENES else VIDEO_SOURCES[n])) for n in SCENE_IDS},
        "narration_wav_sha256": {str(n): sha256_file(frozen / scene_wav(n).relative_to(PROJECT)) for n in SCENE_IDS},
        "narration_origin": ctx["voice_origin"],
        "voice_cache_sha256": sha256_file(frozen / cache_path().relative_to(PROJECT)),
        "bgm": {"track": BGM_TRACK, "artist": BGM_ARTIST, "sha256": sha256_file(bgm)},
        "font_file": original_font,
        "font_sha256": ctx["font_sha256"],
        "ffmpeg": FFMPEG,
        "clip_stretch_factor": {str(k): v for k, v in stretch.items()},
        "effect_sounds": sfx_status,
        "note": "측정 기록일 뿐 UPLOAD READY 판정이 아닙니다. 17장 검사와 사람의 시청은 별도입니다.",
    }
    staged_report = stage/REPORT_NAME
    staged_report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    # 게시: 이미 있는 파일을 절대 덮어쓰지 않는다. 보고서를 먼저 올리고, 최종 파일 게시가 실패하면 보고서를 되돌린다.
    publish_no_overwrite(staged_report, report_path)
    try:
        publish_no_overwrite(staged_final, final)
    except BaseException:
        report_path.unlink(missing_ok=True)
        raise
    shutil.rmtree(stage); shutil.rmtree(work)
    return final

def main(argv: list[str]) -> int:
    command = argv[1] if len(argv) > 1 else "all"
    if command == "init":
        print(init_project())
        return 0
    if command == "review":
        print(make_review_template())
        print("검수 항목과 출처·검수자를 확인한 뒤 status를 PASS로 바꾸세요.")
        return 0
    if command == "import-voice":
        return import_voice()
    if command == "recover":
        print(recover_incomplete_publication())
        print("미완료 보고서를 보관했습니다. 스테이징은 보존되며 완성본이 아닙니다.")
        return 0
    if command == "voice":
        durations = tts()
        for index, seconds in enumerate(durations, 1):
            print(f"scene-{index:02d}.wav: {seconds:.3f}초")
        return 0
    if command != "all":
        raise SystemExit("사용법: python3 scripts/make_roman_concrete_short.py [init|review|import-voice|voice|all|recover]")
    preflight()  # 유료 TTS 호출 전에 대본 승인·선택 클립·권리·실제 미디어·BGM·글꼴을 확인한다.
    print(build(tts()))
    return 0

if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
