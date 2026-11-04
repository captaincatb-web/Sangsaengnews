# 쇼츠 자동 제작 (shorts)

주제 하나만 주면 30초짜리 한국어 세로 쇼츠(1080x1920)를 만듭니다.
Claude Code에서 `/shorts 반도체와 AI의 관계`처럼 입력하면 됩니다.
대본, 검색어, 장면 구성은 Claude가 직접 쓰기 때문에 다른 AI API 키가 필요 없습니다.

## 동작 방식

| 단계 | 기본(이 클라우드 환경) | 네트워크가 열려 있을 때 |
|---|---|---|
| 음성 | Supertonic 3 로컬 TTS(한국어 여성) | Edge TTS `ko-KR-SunHiNeural` |
| 화면 | Fluent 이모지와 도형 애니메이션 12종 | Pixabay 영상(MoneyPrinterTurbo로 검색·편집) |
| 자막·합성 | MoneyPrinterTurbo `generate_video` | 동일 |
| 점검 | 3초 간격 장면 모음(sheet.jpg), 음성인식 발음 검사, 폰트 글자 검사 | 동일 |

음성과 화면 방식은 접속 가능 여부를 보고 자동으로 정해집니다(`--tts`, `--visual`로 지정할 수도 있습니다).

## 직접 실행

```bash
bash shorts/setup.sh                                 # 설치 (여러 번 실행해도 안전)
shorts/run.sh render shorts/example.json             # 영상 생성 → output/shorts/...
shorts/run.sh icons robot chart                      # 아이콘 이름 검색
shorts/run.sh doctor                                 # 설치·네트워크 점검
```

설치되는 위치는 다음과 같습니다.
- MoneyPrinterTurbo: `~/MoneyPrinterTurbo` (uv 가상환경, 검증된 커밋 고정)
- 모델과 아이콘: `~/.cache/shorts`

spec 작성 규칙과 장면 종류는 `.claude/skills/shorts/SKILL.md`, 예시는 `example.json`에 있습니다.

## 경제 해부형 쇼츠 (/money-shorts)

실사 배경 속 귀여운 3D 캐릭터, 장면 속 전광판에 들어간 숫자, 굵은 외곽선 2줄 자막으로 만드는 약 45초짜리 경제·주식 해설 릴스입니다.
Claude Code에서 `/money-shorts 환율이 오르면 내 돈은?`처럼 입력합니다.

1. Claude가 웹 검색으로 수치를 확인한 대본, 캐릭터 시트와 장면별 이미지·움직임 프롬프트(`prompts.md`), 게시 캡션(`caption.txt`)을 만듭니다.
2. Gemini(Nano Banana Pro)나 ChatGPT로 캐릭터 시트를 먼저 만들고, 그 이미지를 첨부해 장면 이미지를 만듭니다. Kling 등으로 영상을 만드는 단계는 선택입니다.
3. 만든 파일을 올리면 `money.sh add`로 장면에 배정한 뒤 `money.sh render`로 조립합니다.

```bash
shorts/money.sh render shorts/money_example.json        # → output/money/<주제>/
shorts/money.sh add shorts/money_example.json a.png ... # 장면 S01, S02 …에 배정
```

캐릭터, 화면 톤, 자막 폰트·크기는 `money_style.json`에서 바꿉니다. 자막 폰트는 Pretendard ExtraBold(OFL)입니다.

## 시네마틱 설명형 쇼츠 (/why-shorts)

사실적인 AI 영상 컷에 네온 강조를 넣고, 중앙 자막, 크로스페이드, 워터마크, 엔딩 카드를 붙이는 약 45초짜리 형식입니다.
Claude Code에서 `/why-shorts 엘리베이터는 왜 추락하지 않을까`처럼 입력합니다.

1. Claude가 대본과 컷별 AI 영상 프롬프트(`prompts.md`)를 쓰고, 네온 대체 장면으로 미리보기를 만듭니다.
2. Google Flow(Veo), Kling 같은 도구로 컷 영상(또는 이미지)을 만들어 대화창에 올립니다.
3. Claude가 컷에 배정(`why.sh add`)한 뒤 다시 조립(`why.sh render`)해 완성본을 만듭니다.

```bash
shorts/why.sh render shorts/why_example.json             # 미리보기 또는 완성본 → output/why/<주제>/
shorts/why.sh add shorts/why_example.json clip1.mp4 ...  # 클립을 C01, C02 …에 배정
```

## Pixabay 키

이 저장소는 공개 저장소라서 키를 커밋하지 않습니다.
환경변수 `PIXABAY_API_KEY`가 있으면 설치할 때 `~/MoneyPrinterTurbo/config.toml`에 저장합니다.
클라우드 환경의 네트워크 정책에서 `pixabay.com`, `cdn.pixabay.com`, `speech.platform.bing.com`을 허용하면 Pixabay 영상과 Edge TTS를 자동으로 사용합니다.

## 사용하는 오픈소스

- [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) (MIT)
- [Supertonic 3](https://github.com/supertone-inc/supertonic): 코드는 MIT, 모델은 OpenRAIL-M. [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)로 실행합니다.
- SenseVoice: 발음 검사용 음성인식(sherpa-onnx 변환본)
- [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) (MIT)
- 나눔고딕 (OFL)
