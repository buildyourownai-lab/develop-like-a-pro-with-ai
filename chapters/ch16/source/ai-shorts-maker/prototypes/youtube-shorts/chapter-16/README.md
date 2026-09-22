# 16장 Roman Concrete Golden Path

이 폴더는 「로마 콘크리트는 왜 2천 년을 버틸까?」 Shorts의 재현 기준을
담습니다. 생성형 미디어 원본과 완성 MP4는 크기가 크고 서비스별 이용 조건이
달라 `artifacts/science-roman-concrete/`에 두며, Git에는 제작 규칙과 대본,
출처·권리 기록만 남깁니다.

## 준비할 파일

`storyboard.json`의 일곱 장면을 기준으로 Kling AI Images의 Image 3.0에서 기준
이미지를 한 장씩 만들고 승인한 뒤, 짧은 세로 영상 후보를 만듭니다. 파일은
다음 위치에 둡니다.

```text
artifacts/science-roman-concrete/storyboard.json
artifacts/science-roman-concrete/source/images/scene-01.png ... scene-07.png
artifacts/science-roman-concrete/source/video/       # 선택 사항
artifacts/science-roman-concrete/source/bgm/pulsar.mp3
```

Kling·Vidu·Hailuo·PixVerse 중 하나를 골라 화풍을 통일하는 것이 기본 경로입니다.
장면별 서비스를 섞는 고급 경로는 각 결과의 이용 조건과 워터마크를 다시 확인한
뒤 선택합니다. 결제가 필요하면 자동으로 진행하지 않습니다.

검증본은 실제로 장면 1에 Vidu, 장면 3에 Kling과 Hailuo, 장면 4·6에 Hailuo,
장면 5에 PixVerse를 사용했습니다. 장면 2·7은 승인한 기준 이미지에 느린 확대만
적용했습니다. 효과음은 선택한 영상의 원래 소리 중 장면에 맞는 부분만 사용하고,
장면 2·7은 비워 둡니다. 정확한 파일과 채택 이유는 `assets-manifest.json`에 기록합니다.

## 대본 검수와 제작

Gemini Key는 `.secrets/chapter-16.env`에 `GEMINI_API_KEY=...` 형식으로 저장하고
Git에 올리지 않습니다. FFmpeg와 한글 글꼴은 자동으로 찾으며, 찾지 못하면
`SHORTS_FFMPEG`, `SHORTS_FFPROBE`, `SHORTS_FONT_FILE`로 경로를 지정합니다.

```bash
python3 scripts/make_roman_concrete_short.py review
```

생성된 `artifacts/science-roman-concrete/script-review.json`에서 맞춤법·띄어쓰기·
누락, 숫자·단위·용어, 내레이션·자막 일치, 사실, 출처와 검수자를 확인합니다.
모두 확인한 뒤 `status`를 `PASS`로 바꾸고 제작합니다.

```bash
python3 scripts/make_roman_concrete_short.py all
```

대본 또는 Storyboard가 바뀌면 Digest가 달라져 TTS 호출과 기존 음성 Cache
재사용이 모두 차단됩니다.
