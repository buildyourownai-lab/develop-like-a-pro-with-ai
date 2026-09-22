#!/usr/bin/env python3
"""무료 Pexels 영상·Gemini TTS·Audio Library BGM으로 16장 v2 Shorts를 만든다."""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

from script_review import clear_tts_cache, require_pass, review_template


ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "prototypes/youtube-shorts/chapter-16"
ARTIFACTS = ROOT / "artifacts/chapter-16"
STORYBOARD = PROJECT / "storyboard.json"
SCRIPT_REVIEW = PROJECT / "script-review.json"
MANIFEST = PROJECT / "assets-manifest.json"
LOCAL_SECRET = ROOT / ".secrets/chapter-16.env"
EXISTING_GEMINI_SECRET = ROOT.parent / "ai-stock-briefing/.env.local"
TTS_MODEL = "gemini-3.1-flash-tts-preview"
TTS_VOICE = "Aoede"
TTS_MIN_REQUEST_INTERVAL_SECONDS = 21


def load_env_value(name: str, paths: list[Path]) -> str:
    if value := os.environ.get(name):
        return value
    for path in paths:
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip() == name:
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                return value
    raise SystemExit(f"{name}이 없습니다. 환경변수 또는 Git 제외 Secret 파일에 저장하세요.")


def ffmpeg_tool(name: str) -> str:
    """자막 Burn-in에는 libass가 들어간 build가 필요하므로 ffmpeg-full을 먼저 찾는다."""
    for prefix in ("/opt/homebrew", "/usr/local", "/home/linuxbrew/.linuxbrew"):
        full = Path(prefix) / "opt/ffmpeg-full/bin" / name
        if full.is_file():
            return str(full)
    if found := shutil.which(name):
        return found
    raise SystemExit(f"필요한 도구가 없습니다: {name}")


FFMPEG = ffmpeg_tool("ffmpeg")
FFPROBE = ffmpeg_tool("ffprobe")


def post_json(url: str, api_key: str, payload: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
            "User-Agent": "chapter-16/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Gemini TTS HTTP {error.code}: {body[:500]}") from error


def save_audio(data: bytes, mime_type: str, destination: Path) -> None:
    if data.startswith(b"RIFF"):
        destination.write_bytes(data)
        return
    rate_match = re.search(r"rate=(\d+)", mime_type)
    sample_rate = int(rate_match.group(1)) if rate_match else 24000
    with wave.open(str(destination), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(data)


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as audio:
        return audio.getnframes() / audio.getframerate()


def media_duration(path: Path) -> float:
    result = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=True, capture_output=True, text=True,
    )
    return float(result.stdout.strip())


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def download_videos() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    source_dir = ARTIFACTS / "source/video"
    source_dir.mkdir(parents=True, exist_ok=True)
    for item in manifest["videos"]:
        destination = source_dir / (
            f"scene-{item['scene']:02d}-pexels-{item['pexels_video_id']}.mp4"
        )
        if not destination.is_file():
            request = urllib.request.Request(
                item["video_file"]["download_url"],
                headers={"User-Agent": "chapter-16/1.0"},
            )
            with urllib.request.urlopen(request, timeout=180) as response:
                destination.write_bytes(response.read())
        print(f"Scene {item['scene']} video: {destination.name}")


def srt_time(seconds: float) -> str:
    millis = round(seconds * 1000)
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    seconds, millis = divmod(millis, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def escape_filter_path(path: Path) -> str:
    value = str(path.resolve())
    return value.replace("\\", "\\\\").replace(":", r"\:").replace("'", r"\'")


def generate_tts() -> None:
    try:
        require_pass(STORYBOARD, SCRIPT_REVIEW)
    except (ValueError, json.JSONDecodeError) as error:
        # 대본이 바뀌었는데 이전 WAV가 재사용되는 일을 막는다.
        clear_tts_cache(
            ARTIFACTS / "audio/narration",
            ARTIFACTS / "audio/narration-timings.json",
        )
        raise SystemExit(f"TTS 실행 중단: {error}\n먼저 review Stage에서 대본을 검수하세요.")
    board = json.loads(STORYBOARD.read_text(encoding="utf-8"))
    api_key = load_env_value(
        "GEMINI_API_KEY", [LOCAL_SECRET, EXISTING_GEMINI_SECRET]
    )
    audio_dir = ARTIFACTS / "audio/narration"
    audio_dir.mkdir(parents=True, exist_ok=True)
    timings: list[dict] = []
    cursor = 0.0
    last_request_at: float | None = None

    for scene in board["scenes"]:
        destination = audio_dir / f"scene-{scene['scene']:02d}.wav"
        if destination.is_file():
            duration = wav_duration(destination)
            print(f"Scene {scene['scene']}: {duration:.2f}s (cached)")
        else:
            if last_request_at is not None:
                remaining = TTS_MIN_REQUEST_INTERVAL_SECONDS - (
                    time.monotonic() - last_request_at
                )
                if remaining > 0:
                    print(
                        f"무료 TTS 분당 한도를 지키기 위해 {remaining:.0f}초 기다립니다."
                    )
                    time.sleep(remaining)
            payload = {
                "contents": [{
                    "parts": [{
                        "text": (
                            "또박또박하지만 뉴스 앵커처럼 딱딱하지 않은 한국어 과학 Shorts "
                            "내레이션으로, 과장된 광고 말투 없이 다음 문장만 자연스럽게 읽어주세요. "
                            f"문장: {scene['narration']}"
                        )
                    }]
                }],
                "generationConfig": {
                    "responseModalities": ["AUDIO"],
                    "speechConfig": {
                        "voiceConfig": {
                            "prebuiltVoiceConfig": {"voiceName": TTS_VOICE}
                        }
                    }
                }
            }
            response = post_json(
                f"https://generativelanguage.googleapis.com/v1beta/models/{TTS_MODEL}:generateContent",
                api_key,
                payload,
            )
            last_request_at = time.monotonic()
            try:
                inline = response["candidates"][0]["content"]["parts"][0]["inlineData"]
                audio = base64.b64decode(inline["data"])
                mime_type = inline.get("mimeType", "audio/L16;rate=24000")
            except (KeyError, IndexError, ValueError) as error:
                raise SystemExit("Gemini TTS 응답에 Audio가 없습니다.") from error
            save_audio(audio, mime_type, destination)
            duration = wav_duration(destination)
            print(f"Scene {scene['scene']}: {duration:.2f}s")
        timings.append({
            "scene": scene["scene"],
            "text": scene["narration"],
            "start_seconds": round(cursor, 3),
            "end_seconds": round(cursor + duration, 3),
            "duration_seconds": round(duration, 3),
            "audio_file": str(destination.relative_to(ROOT)),
        })
        cursor += duration

    result = {
        "model": TTS_MODEL,
        "voice": TTS_VOICE,
        "language": "ko",
        "total_duration_seconds": round(cursor, 3),
        "scenes": timings,
    }
    (ARTIFACTS / "audio/narration-timings.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Total narration: {cursor:.2f}s")


def build_short() -> None:
    board = json.loads(STORYBOARD.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    timings_path = ARTIFACTS / "audio/narration-timings.json"
    if not timings_path.is_file():
        raise SystemExit("내레이션이 없습니다. 먼저 tts Stage를 실행하세요.")
    timings = json.loads(timings_path.read_text(encoding="utf-8"))
    total_duration = float(timings["total_duration_seconds"])
    if not 50 <= total_duration < 60:
        raise SystemExit(f"내레이션 길이가 목표 범위를 벗어났습니다: {total_duration}s")

    bgm_path = ROOT / manifest["bgm"]["local_input"]
    if not bgm_path.is_file():
        raise SystemExit(f"YouTube Audio Library BGM이 없습니다: {bgm_path}")

    source_dir = ARTIFACTS / "source/video"
    scene_dir = ARTIFACTS / "work/scenes"
    subtitle_dir = ARTIFACTS / "subtitles"
    audio_dir = ARTIFACTS / "audio"
    final_dir = ARTIFACTS / "final"
    for directory in (scene_dir, subtitle_dir, audio_dir, final_dir):
        directory.mkdir(parents=True, exist_ok=True)

    video_by_scene = {item["scene"]: item for item in manifest["videos"]}
    timing_by_scene = {item["scene"]: item for item in timings["scenes"]}
    rendered_scenes: list[Path] = []

    for scene in board["scenes"]:
        number = scene["scene"]
        video = video_by_scene[number]
        timing = timing_by_scene[number]
        source = source_dir / f"scene-{number:02d}-pexels-{video['pexels_video_id']}.mp4"
        if not source.is_file():
            raise SystemExit(f"Pexels 영상이 없습니다: {source}")
        target = float(timing["duration_seconds"])
        available = float(video["source_duration_seconds"]) - float(video["use_start_seconds"])
        stretch = max(1.0, target / available)
        rendered = scene_dir / f"scene-{number:02d}.mp4"
        video_filter = (
            "scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,"
            f"setpts={stretch:.8f}*(PTS-STARTPTS),"
            f"trim=duration={target:.3f},setpts=PTS-STARTPTS,"
            "fps=30,format=yuv420p"
        )
        run([
            FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
            "-ss", str(video["use_start_seconds"]), "-i", str(source),
            "-vf", video_filter, "-an", "-c:v", "libx264", "-preset", "medium",
            "-crf", "19", "-pix_fmt", "yuv420p", "-r", "30",
            "-movflags", "+faststart", str(rendered),
        ])
        rendered_scenes.append(rendered)

    concat_list = scene_dir / "concat.txt"
    concat_list.write_text(
        "".join(f"file '{path.name}'\n" for path in rendered_scenes), encoding="utf-8"
    )
    picture = ARTIFACTS / "work/picture.mp4"
    run([
        FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", str(concat_list),
        "-c", "copy", "-movflags", "+faststart", str(picture),
    ])

    narration_inputs: list[str] = []
    narration_filters: list[str] = []
    narration_labels: list[str] = []
    for index, timing in enumerate(timings["scenes"]):
        narration_inputs += ["-i", str(ROOT / timing["audio_file"])]
        narration_filters.append(
            f"[{index}:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono[a{index}]"
        )
        narration_labels.append(f"[a{index}]")
    narration_filters.append(
        "".join(narration_labels) + f"concat=n={len(narration_labels)}:v=0:a=1[narration]"
    )
    narration = audio_dir / "narration.wav"
    run([
        FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
        *narration_inputs, "-filter_complex", ";".join(narration_filters),
        "-map", "[narration]", "-c:a", "pcm_s16le", str(narration),
    ])

    subtitle_entries: list[str] = []
    subtitle_index = 1
    for scene in board["scenes"]:
        timing = timing_by_scene[scene["scene"]]
        captions = scene["captions"]
        weights = [max(1, len(text.replace("\n", ""))) for text in captions]
        weight_total = sum(weights)
        cursor = float(timing["start_seconds"])
        end = float(timing["end_seconds"])
        for index, (caption, weight) in enumerate(zip(captions, weights)):
            caption_end = end if index == len(captions) - 1 else (
                cursor + (end - float(timing["start_seconds"])) * weight / weight_total
            )
            subtitle_entries.append(
                f"{subtitle_index}\n{srt_time(cursor)} --> {srt_time(caption_end)}\n{caption}\n"
            )
            subtitle_index += 1
            cursor = caption_end
    subtitles = subtitle_dir / "ko.srt"
    subtitles.write_text("\n".join(subtitle_entries), encoding="utf-8")

    mixed_audio = audio_dir / "narration-with-bgm.m4a"
    fade_out_start = max(0.0, total_duration - 1.8)
    audio_filter = (
        "[0:a]loudnorm=I=-16:TP=-1.5:LRA=11[narr];"
        f"[1:a]atrim=0:{total_duration:.3f},asetpts=PTS-STARTPTS,"
        "loudnorm=I=-30:TP=-6:LRA=7,"
        "afade=t=in:st=0:d=1.2,"
        f"afade=t=out:st={fade_out_start:.3f}:d=1.8[bgm];"
        "[narr][bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,"
        "alimiter=limit=0.95[mix]"
    )
    run([
        FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(narration), "-stream_loop", "-1", "-i", str(bgm_path),
        "-filter_complex", audio_filter, "-map", "[mix]", "-t", f"{total_duration:.3f}",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
        str(mixed_audio),
    ])

    style = (
        "FontName=Apple SD Gothic Neo,Fontsize=10,Bold=1,"
        "PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,"
        "BorderStyle=3,Outline=1,Shadow=0,MarginL=24,MarginR=24,"
        "MarginV=46,Alignment=2"
    )
    subtitle_filter = (
        f"subtitles='{escape_filter_path(subtitles)}':force_style='{style}'"
    )
    final = final_dir / "sun-disappears-short.mp4"
    run([
        FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(picture), "-i", str(mixed_audio),
        "-vf", subtitle_filter, "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "medium", "-crf", "19",
        "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "192k",
        "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart", "-shortest", str(final),
    ])

    probe = subprocess.run(
        [FFPROBE, "-v", "error", "-show_format", "-show_streams", "-of", "json", str(final)],
        check=True, capture_output=True, text=True,
    )
    report = {
        "output": str(final.relative_to(ROOT)),
        "storyboard": str(STORYBOARD.relative_to(ROOT)),
        "assets_manifest": str(MANIFEST.relative_to(ROOT)),
        "tts_model": TTS_MODEL,
        "tts_voice": TTS_VOICE,
        "narration_duration_seconds": total_duration,
        "bgm_track": manifest["bgm"]["track"],
        "bgm_artist": manifest["bgm"]["artist"],
        "probe": json.loads(probe.stdout),
    }
    (ARTIFACTS / "build-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Final: {final}")
    print(f"Duration: {media_duration(final):.2f}s")


def main() -> None:
    parser = argparse.ArgumentParser(description="16장 무료 Shorts E2E")
    parser.add_argument("stage", choices=("review", "download", "tts", "build", "all"))
    args = parser.parse_args()
    if args.stage == "review":
        board = json.loads(STORYBOARD.read_text(encoding="utf-8"))
        SCRIPT_REVIEW.write_text(
            json.dumps(review_template(board), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"검수 양식을 만들었습니다: {SCRIPT_REVIEW}")
        print("네 항목과 출처를 확인한 뒤 status를 PASS로 바꾸세요.")
    if args.stage in ("download", "all"):
        download_videos()
    if args.stage in ("tts", "all"):
        generate_tts()
    if args.stage in ("build", "all"):
        build_short()


if __name__ == "__main__":
    main()
