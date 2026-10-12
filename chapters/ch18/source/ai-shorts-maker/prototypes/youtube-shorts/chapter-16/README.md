# 16장 로마 콘크리트 제작 입력

Kling 이미지·영상, Gemini Charon 내레이션과 Pulsar 음악으로 한 편을 만듭니다. 생성 원본과 완성 MP4는 Git에 포함하지 않습니다. 모델과 이용 조건은 작업하는 날의 공식 화면에서 확인합니다.

먼저 `python3 scripts/make_roman_concrete_short.py init`으로 작업 공간을 준비합니다. `artifacts/science-roman-concrete-kling-20261012/` 안에서 승인 대본, 기준 이미지, 선택 영상과 음성·음악을 정리합니다. `assets-manifest.json`에는 실제 파일 경로·해시·이용 조건·승인 기록을 적습니다. 비어 있는 서식은 실행 가능한 완성 자료가 아닙니다.

장면 1·3·4·5·6에는 승인한 Kling 클립을, 장면 2·7에는 기준 이미지의 느린 확대를 사용합니다. 영상과 공개 설명에는 제작 안내 문구를 넣지 않습니다. 근거·출처·연출 조건과 실제 제작 방법은 제작 기록에 남깁니다.

`python3 scripts/make_roman_concrete_short.py review`로 대본 검수 서식을 만듭니다. 실제 대본을 읽고 모든 항목을 확인한 기록이 있어야 음성과 조립을 진행합니다. 승인한 Charon WAV는 `import-voice`로 가져올 수 있으며, 음성이 없다고 자동으로 TTS를 호출하지 않습니다. API 음성 생성은 인증·비용 승인 경로를 따릅니다.

FFmpeg와 한글 글꼴을 확인한 뒤 승인 자산으로 `assemble`을 실행합니다. 글꼴·파일·권리 기록이 누락되거나 바뀌면 중단합니다. 대본 또는 Storyboard가 바뀌면 기존 검수·음성 기록도 다시 확인해야 합니다.
