---
name: shorts
description: 주제만 받으면 30초 한국어 세로 쇼츠(9:16) 영상을 이 환경에서 바로 만든다. MoneyPrinterTurbo 기반이고 대본·검색어·장면 구성은 Claude가 직접 쓴다(다른 AI API 키 불필요). "○○ 주제로 영상 만들어줘", "쇼츠 만들어줘", "/shorts 반도체와 AI" 같은 요청에 사용.
argument-hint: <주제>
---

# /shorts — 주제 → 30초 세로 쇼츠

입력은 주제 하나다(예: `/shorts 반도체와 AI의 관계`). 다른 것은 묻지 말고 끝까지 진행한다.
설치나 실행이 막히면 사용자에게 묻지 말고 다른 방법으로 계속한다.

## 1. 설치 확인

```bash
bash shorts/setup.sh
```

처음에는 1~3분, 이미 설치돼 있으면 몇 초 걸린다. 마지막에 나오는 점검표의 "설치 상태"에
NO가 있으면 원인을 고치고 다시 실행한다. "네트워크" 쪽 NO는 정상이다(아래 자동 대체).

## 2. spec 작성

`output/shorts/<영문-슬러그>.json`에 쓴다. 형식은 `shorts/example.json`을 참고한다.

```json
{
  "topic": "주제",
  "accent": "cyan",
  "scenes": [
    {"text": "한 문장", "terms": "english search words", "scene": "icon", "icon": "robot", "title": "핵심어"}
  ]
}
```

대본 규칙:
- 한국어 9~10문장, 한 문장이 한 장면이다. 문장은 짧게(15~25자).
- 공백을 뺀 글자 수 합계를 170~200자로 맞춘다. 이 정도가 약 30초다.
- 첫 문장은 질문이나 놀라운 사실(훅)로, 마지막 문장은 한 줄 결론으로 쓴다.
- 사실만 쓴다. 확실하지 않은 숫자는 쓰지 않는다. chart와 counter는 대본에 나온 실제 숫자만 쓰고 수치를 지어내지 않는다.
- 자막(text)에 이모지나 특수기호를 넣지 않는다. 영문 약어(AI, GPU), 숫자, 단위(400mg, 50%)는 그대로 써도 된다. 음성용 한글 읽기로 자동 변환된다.
- 영어 단어나 브랜드처럼 읽기 애매한 말은 `"say": "읽는 법"`을 넣는다(예: text "ChatGPT가", say "챗지피티가").

장면 규칙:
- `terms`: 문장 내용에 맞는 구체적인 영어 검색어. Pixabay를 쓸 수 있을 때 소재 검색에 쓴다.
- `title`: 화면 위에 크게 나오는 2~8자 핵심어(12자 이하).
- `scene`: 아래 표에서 문장 내용에 맞는 것을 고른다. 같은 종류를 3번 이상 연속으로 쓰지 않는다.
- `color`: 장면별 강조색(선택). 쓸 수 있는 값은 blue, cyan, green, yellow, orange, red, pink, purple 또는 #RRGGBB다.

| scene | 쓰는 곳 | 필드 |
|---|---|---|
| icon | 핵심 대상 하나 | icon |
| icons | 2~4개 나열 | icons, labels(선택) |
| vs | 비교, `arrow: true`면 A→B 변화 | icons(2개), labels, arrow |
| flow | 이동·전달(데이터, 돈, 에너지) | icons(2개), labels, packet(선택, 움직이는 작은 아이콘) |
| chart | 실제 수치 비교 | values, labels, unit |
| counter | 숫자 하나 강조 | number, unit, prefix, caption, icon(선택) |
| list | 항목 2~4개(항목당 14자 이하) | items |
| network | 연결, AI, 인터넷 | icon(선택) |
| globe | 세계, 국가, 글로벌 | - |
| chip | 반도체, 컴퓨터 칩 | icon(선택) |
| grid | 병렬, 대량, 데이터 | icon(선택) |
| trend | 증가·감소 추세(숫자 없이) | direction(up/down), label, icon(선택) |

아이콘은 Fluent 이모지 3,145개 중에서 고른다. 이름(kebab-case)이나 이모지 문자(🤖)로 쓴다.
확실하지 않은 이름은 먼저 검색한다: `shorts/run.sh icons coffee heart`
- 자주 쓰는 이름: robot, brain, light-bulb, high-voltage, battery, automobile, rocket, factory,
  building-construction, globe-showing-asia-australia, money-bag, dollar-banknote, chart-increasing,
  chart-decreasing, bar-chart, desktop-computer, laptop, mobile-phone, computer-disk, gear,
  hot-beverage, anatomical-heart, pill, house, office-building, cityscape, books, alarm-clock,
  warning, check-mark-button, trophy, magnifying-glass-tilted-left, busts-in-silhouette, handshake,
  thumbs-up, sparkles, fire, droplet, seedling, sun, crescent-moon, sleeping-face
- 국기와 반도체 칩 아이콘은 없다. 칩은 `"scene": "chip"`을 쓴다.

## 3. 만들기

```bash
shorts/run.sh render output/shorts/<슬러그>.json
```

2~3분 걸린다. 설정은 자동으로 정해진다.
- 음성: Edge TTS(ko-KR-SunHiNeural)에 접속되면 그것을 쓰고, 안 되면 로컬 Supertonic(여성 2번)을 쓴다. 길이는 약 30초로 자동으로 맞춘다.
- 화면: Pixabay 키가 있고 접속되면 Pixabay 영상, 아니면 아이콘 애니메이션을 쓴다.
- 자막: 나눔고딕 Bold 120, 검정 외곽선 7, 화면 75% 높이. 배경음악은 없다.

결과로 `output/shorts/<시각>-<주제>/` 폴더에 영상(mp4), `sheet.jpg`(3초 간격 장면 모음), `qa.json`이 생긴다.
콘솔에는 발음 검사(음성인식 일치도)와 경고가 출력된다.

## 4. 확인과 수정 (다시 만들기는 최대 2번)

- `sheet.jpg`를 Read로 직접 본다. 장면이 문장 내용과 맞는지, 자막이 깨지거나 잘리지 않았는지, 아이콘이 엉뚱하지 않은지 확인한다.
- 콘솔 경고는 이렇게 처리한다.
  - 발음 일치도가 0.75 미만이면 해당 장면에 `say`를 넣는다.
  - 아이콘이 없거나 대체됐으면 이름을 고친다.
  - 길이가 짧거나 길면 문장 수를 조정한다.
  - 폰트에 없는 글자가 있으면 다른 글자로 바꾼다.
- 문제가 있으면 spec을 고쳐 다시 render한다. 최대 2번까지 한다.

## 5. 전달

- SendUserFile로 최종 mp4를 보낸다.
- 답변은 간단명료하게 쓴다. 영상 경로, 길이, 음성·화면 방식, 고친 내용을 각각 한 줄로 적는다.
- `output/`은 git에 올리지 않는다(.gitignore에 들어 있음).
