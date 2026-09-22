#!/usr/bin/env python3
"""여러 생성형 영상 소스와 Gemini TTS로 로마 콘크리트 Shorts를 제작한다."""
from __future__ import annotations

import base64, json, os, re, shutil, subprocess, sys, time, urllib.error, urllib.request, wave
from pathlib import Path

from script_review import clear_tts_cache, require_pass, review_template

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "artifacts/science-roman-concrete"
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

# 각 서비스의 강점을 장면별로 조합한다. 후보가 아직 없으면 기준 이미지로 대체한다.
VIDEO_SOURCES = {
    1: ["source/video/candidates/scene-01-vidu.mp4"],
    3: [
        "source/video/scene-03-kling.mp4",
        "source/video/candidates/scene-03-hailuo.mp4",
    ],
    4: ["source/video/candidates/scene-04-hailuo.mp4"],
    5: ["source/video/candidates/scene-05-pixverse.mp4"],
    6: ["source/video/candidates/scene-06-hailuo.mp4"],
}

SFX_GAINS = {
    1: [4.0],
    3: [8.0, 5.0],
    4: [2.2],
    5: [2.2],
    6: [2.2],
}

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

def make_review_template() -> Path:
    board = json.loads(BOARD.read_text(encoding="utf-8"))
    REVIEW.parent.mkdir(parents=True, exist_ok=True)
    REVIEW.write_text(
        json.dumps(review_template(board), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    clear_tts_cache(PROJECT / "source/audio", TIMINGS)
    return REVIEW

def duration(p: Path) -> float:
    return float(subprocess.check_output([FFPROBE,"-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",str(p)], text=True))

def tts() -> list[float]:
    # 검수 기록이 없거나 현재 대본의 Digest와 다르면 API 호출과 Cache 재사용을 모두 막는다.
    require_pass(BOARD, REVIEW)
    board=json.loads(BOARD.read_text())
    out=PROJECT/"source/audio"; out.mkdir(parents=True,exist_ok=True)
    key=secret(); result=[]
    for s in board["scenes"]:
        p=out/f"scene-{s['scene']:02d}.wav"
        if not p.exists():
            payload={"contents":[{"parts":[{"text":"차분하고 또렷한 한국어 다큐멘터리 내레이션으로, 과장 없이 자연스럽게 다음 문장만 읽어주세요. "+s["narration"]}]}],"generationConfig":{"responseModalities":["AUDIO"],"speechConfig":{"voiceConfig":{"prebuiltVoiceConfig":{"voiceName":VOICE}}}}}
            req=urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",data=json.dumps(payload,ensure_ascii=False).encode(),headers={"Content-Type":"application/json","x-goog-api-key":key},method="POST")
            for attempt in range(4):
                try:
                    data=json.load(urllib.request.urlopen(req,timeout=180))["candidates"][0]["content"]["parts"][0]["inlineData"]
                    break
                except urllib.error.HTTPError as e:
                    if e.code != 429 or attempt == 3: raise
                    time.sleep(45)
            raw=base64.b64decode(data["data"])
            if raw.startswith(b"RIFF"): p.write_bytes(raw)
            else:
                rate=int((re.search(r"rate=(\d+)",data.get("mimeType","")) or [None,"24000"])[1])
                with wave.open(str(p),"wb") as w: w.setparams((1,2,rate,0,"NONE","")); w.writeframes(raw)
            time.sleep(35)
        result.append(duration(p))
    return result

def esc(s: str) -> str:
    return s.replace("\\","\\\\").replace(":","\\:").replace("'","\\'")

def build(ds: list[float]) -> Path:
    board=json.loads(BOARD.read_text()); work=PROJECT/"work"; work.mkdir(exist_ok=True)
    clips=[]
    font=font_file()
    for i,(s,raw_d) in enumerate(zip(board["scenes"],ds),1):
        d=raw_d/1.25
        img=PROJECT/f"source/images/scene-{i:02d}.png"; clip=work/f"scene-{i:02d}.mp4"
        cap="  ·  ".join(s["captions"])
        # 2배 해상도에서 움직인 뒤 축소해 zoompan의 정수 좌표 떨림을 숨긴다.
        z="min(zoom+0.00028,1.06)"
        pan_x=("iw/2-(iw/zoom/2)+on*0.35" if i % 2 else
               "iw/2-(iw/zoom/2)-on*0.35")
        sources=[PROJECT/p for p in VIDEO_SOURCES.get(i,[]) if (PROJECT/p).exists()]
        if sources:
            visual=work/f"visual-{i:02d}.mp4"
            if len(sources) == 1:
                target = d + .35
                speed = target / duration(sources[0])
                subprocess.run([FFMPEG,"-y","-i",str(sources[0]),
                    "-an","-vf",f"scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setpts={speed:.8f}*PTS,fps=30,tpad=stop_mode=clone:stop_duration=1,trim=duration={target},setpts=PTS-STARTPTS",
                    "-c:v","libx264","-crf","17","-preset","medium",str(visual)],check=True)
            else:
                ins=[]
                for p in sources: ins += ["-i",str(p)]
                parts="".join(f"[{n}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setpts=PTS-STARTPTS[v{n}];" for n in range(len(sources)))
                labels="".join(f"[v{n}]" for n in range(len(sources)))
                fc=parts+f"{labels}concat=n={len(sources)}:v=1:a=0,tpad=stop_mode=clone:stop_duration=1,trim=duration={d+.35},setpts=PTS-STARTPTS[v]"
                subprocess.run([FFMPEG,"-y",*ins,"-filter_complex",fc,"-map","[v]","-an",
                    "-c:v","libx264","-crf","17","-preset","medium",str(visual)],check=True)
            source_filter="null"
            visual_args=["-i",str(visual)]
        else:
            source_filter=f"scale=4320:7680:force_original_aspect_ratio=increase,crop=4320:7680,zoompan=z='{z}':x='{pan_x}':y='ih/2-(ih/zoom/2)':d={int((d+.35)*30)}:s=2160x3840:fps=30,scale=1080:1920:flags=lanczos"
            visual_args=["-loop","1","-i",str(img)]
        vf=(source_filter+","
            f"drawbox=x=0:y=1450:w=1080:h=250:color=black@0.34:t=fill,"
            f"drawtext=fontfile='{esc(font)}':text='{esc(cap)}':fontcolor=white:fontsize=60:x=(w-text_w)/2:y=1525:shadowcolor=black@0.8:shadowx=3:shadowy=3,format=yuv420p")
        subprocess.run([FFMPEG,"-y",*visual_args,"-i",str(PROJECT/f"source/audio/scene-{i:02d}.wav"),"-vf",vf,"-af","atempo=1.25,afade=t=in:d=0.12,afade=t=out:st="+str(max(0.1,d-0.2))+":d=0.2","-t",str(d+.18),"-c:v","libx264","-crf","18","-preset","medium","-c:a","aac","-b:a","192k",str(clip)],check=True)
        clips.append(clip)
    lst=work/"concat.txt"; lst.write_text("".join(f"file '{p}'\n" for p in clips))
    final=PROJECT/"roman-final-sounddesign-v3.mp4"
    bgm=PROJECT/"source/bgm/pulsar.mp3"
    if bgm.exists():
        sfx_paths=[]
        for scene in (1, 3, 4, 5, 6):
            sfx_paths.extend(PROJECT / path for path in VIDEO_SOURCES[scene])
        inputs=[]
        for path in sfx_paths:
            inputs.extend(["-i", str(path)])

        scene_lengths=[duration(clip) for clip in clips]
        source_index=2
        sfx_filters=[]
        for scene, scene_length in enumerate(scene_lengths, 1):
            gains=SFX_GAINS.get(scene, [])
            if not gains:
                sfx_filters.append(
                    f"anullsrc=r=48000:cl=stereo,atrim=0:{scene_length:.6f}[s{scene}]"
                )
                continue
            parts=[]
            for part, gain in enumerate(gains):
                label=f"s{scene}p{part}"
                sfx_filters.append(
                    f"[{source_index}:a]aresample=48000,asetpts=PTS-STARTPTS,"
                    f"volume={gain},alimiter=0.85[{label}]"
                )
                parts.append(f"[{label}]")
                source_index += 1
            if len(parts) == 1:
                sfx_filters.append(
                    f"{parts[0]}apad,atrim=0:{scene_length:.6f}[s{scene}]"
                )
            else:
                sfx_filters.append(
                    f"{''.join(parts)}concat=n={len(parts)}:v=0:a=1,"
                    f"apad,atrim=0:{scene_length:.6f}[s{scene}]"
                )

        mix=(";".join(sfx_filters) + ";" +
             "".join(f"[s{scene}]" for scene in range(1, 8)) +
             "concat=n=7:v=0:a=1,volume=0.75[sfx];"
             "[1:a]volume=0.15,afade=t=in:d=1.0,afade=t=out:st=51.5:d=1.5[bgm];"
             "[bgm][0:a]sidechaincompress=threshold=0.04:ratio=4:attack=20:release=420[dbgm];"
             "[sfx][0:a]sidechaincompress=threshold=0.05:ratio=3:attack=12:release=250[dsfx];"
             "[0:a][dbgm][dsfx]amix=inputs=3:duration=first:dropout_transition=0,alimiter=limit=0.95[a]")
        subprocess.run([FFMPEG,"-y","-f","concat","-safe","0","-i",str(lst),
            "-stream_loop","-1","-i",str(bgm),*inputs,"-filter_complex",mix,"-map","0:v","-map","[a]",
            "-c:v","copy","-c:a","aac","-ar","48000","-b:a","192k","-shortest",str(final)],check=True)
    else:
        subprocess.run([FFMPEG,"-y","-f","concat","-safe","0","-i",str(lst),"-c:v","libx264","-crf","18","-preset","medium","-c:a","aac","-ar","48000","-b:a","160k",str(final)],check=True)
    return final

def main(argv: list[str]) -> int:
    command = argv[1] if len(argv) > 1 else "all"
    if command == "review":
        print(make_review_template())
        print("검수 항목과 출처·검수자를 확인한 뒤 status를 PASS로 바꾸세요.")
        return 0
    if command == "voice":
        durations = tts()
        for index, seconds in enumerate(durations, 1):
            print(f"scene-{index:02d}.wav: {seconds:.3f}초")
        return 0
    if command != "all":
        raise SystemExit("사용법: python3 scripts/make_roman_concrete_short.py [review|voice|all]")
    print(build(tts()))
    return 0

if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
