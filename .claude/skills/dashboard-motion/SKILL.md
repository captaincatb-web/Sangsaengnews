---
name: dashboard-motion
description: 대시보드·분석 화면의 차트 모션과 인터랙션 규격(막대 자라남, 호버 강조, 연동 요약 띠, 핀 고정, 펄스, 리플, 슬라이딩 메뉴 표시, 이중 Y축 콤보 차트)을 한 벌로 적용하거나 점검할 때 쓴다. "경영 개요처럼", "같은 효과로", "모션 규칙대로", 차트에 애니메이션·호버·툴팁·고정 동작을 넣을 때, 새 페이지를 기존 대시보드와 같은 느낌으로 맞출 때 사용한다. Use when adding or auditing chart motion, hover/pin interactions, and micro-interactions so every dashboard page behaves like site/dashboard.html.
---

# 대시보드 모션·인터랙션 규격

기준 구현: `site/dashboard.js`의 `comboChart`, `site/dashboard.theme.css`(모션 토큰·키프레임), `site/compare.js`의 `combo`·`sumTable`·요약 띠 핸들러. 새로 만들 때는 이 코드를 복사해 값만 바꾸고, 규칙을 새로 만들지 않는다.

## 0. 먼저 판단(애니메이션을 넣을지)

1. **얼마나 자주 보는가**: 하루 수십 번 이상 반복(키보드 단축키, 목록 이동, 필터 토글)이면 넣지 않거나 최소로. 가끔(화면 전환, 카드 입장)은 표준, 처음 한 번(첫 진입 차트)은 풍부하게.
2. **무엇을 설명하는가**: 상태 변화, 위치·관계, 누른 것에 대한 반응, 갑작스러운 변화 방지 중 하나여야 한다. "예뻐서"만이면 넣지 않는다.
3. **키보드로 시작한 동작은 애니메이션하지 않는다.**
4. 분석 화면은 "일하는 화면"이다. 페이지 로드 연출에 사용자를 기다리게 하지 않는다. 입장 모션은 전체 0.8초 안에 끝낸다.

## 1. 토큰(그대로 쓴다)

| 이름 | 값 | 용도 |
|---|---|---|
| `--ease` | `cubic-bezier(.2, .8, .2, 1)` | 등장·이동·크기 변화 전반(감속, 확신 있는 도착) |
| 즉각 반응 | `.08s`~`.15s` | 누르는 중(:active), 표 행 호버 |
| 일반 상태 변화 | `.2s`~`.3s` | 색·배경·테두리·그림자·살짝 뜸 |
| 화면·카드 전환 | `.32s`~`.38s` | 화면 전환 페이드(`th-fade`), 표 행 입장(`th-row`) |
| 연출(한 번) | `.45s`~`.75s` | 막대 자람(`th-grow` .75s), 리플 .65s, 아이콘 회전 .6s |
| 스태거 간격 | 칸당 `45ms`, 총 지연 **최대 0.4초** | 막대·목록 순차 등장 |
| 테마 전환 | `.45s ease` | 밝은/어두운 전환 시 색 속성만 |

규칙: 나가는 모션은 들어오는 것보다 빠르게. 바운스·탄성 곡선은 쓰지 않는다(드래그·놀이형 화면 제외). `ease-in`은 UI에 쓰지 않는다. 지속시간은 일반 UI 0.3초 이내, 연출만 길게.

## 2. 효과 카탈로그(용어 · 구현 · 값)

| 효과(용어) | 구현 |
|---|---|
| **스태거드 그로우인** (막대가 순서대로 자람) | `.bar { transform-box: fill-box; transform-origin: 50% 100%; animation: th-grow .75s var(--ease) both; animation-delay: calc(var(--i) * 45ms) }` · `@keyframes th-grow { from { transform: scaleY(.02); opacity: .35 } to { transform: none; opacity: 1 } }` · 음수 막대는 `transform-origin: 50% 0`. 칸마다 `style="--i:${i}"`. 막대 수가 9개를 넘으면 간격을 줄여 총 지연 0.4초 이하 |
| **호버 하이라이트** | `.slot .colbg { fill: var(--brand); opacity: 0; transition: opacity .2s; pointer-events: none }` · `.slot:hover .colbg { opacity: .10 }` · `.slot:hover .bar { filter: brightness(1.07) saturate(1.05) }` |
| **연동 요약 띠**(linked summary strip, 크로스 하이라이트) | 칸 `<g class="slot" data-strip="…">`, 차트 위 `<div class="db-strip">`. `mouseover`로 띠 내용을 칸 값으로 교체, `mouseout`으로 최근 값 복원(`data-def`에 원본 저장). 키보드는 `focusin`/`focusout`에 같은 동작 |
| **핀 고정**(sticky selection) | 칸 클릭 → `.pin` 토글 + 띠에 `.pinned`(라벨 뒤 "고정 · 다시 누르면 해제"). 같은 칸 다시 누르면 해제. 차트당 하나만 고정 |
| **펄스** | 고정·해제 때 띠에 `.pulse`: `@keyframes th-pulse { 0% { transform: scale(.985); box-shadow: 0 0 0 0 color-mix(in srgb, var(--brand) 30%, transparent) } 60% { transform: scale(1.005); box-shadow: 0 0 0 8px transparent } 100% { transform: none } }` .5s. 재생 전 `classList.remove` → `void el.offsetWidth` → `add` |
| **리플**(ripple) | 버튼에 `pointerdown`: 눌린 좌표에 원 `span.th-ripple`을 만들어 `scale(0→1)`, 투명도 .22→0, .65s 뒤 제거. 버튼은 `position: relative; overflow: hidden` |
| **눌림 피드백**(press) | `:active { transform: scale(.96); transition-duration: .08s }`(버튼), 카드류는 `translateY(-1px) scale(.985)` |
| **슬라이딩 인디케이터** | 메뉴 `ul::before` 알약 하나를 `--py/--ph/--px/--pw` CSS 변수로 옮기고 `transition`. 선택 시 JS가 선택 항목의 위치·크기를 측정해 변수에 넣는다 |
| **화면 전환 페이드** | `.db-view:not([hidden]) { animation: th-fade .38s var(--ease) both }` · `th-fade`: `opacity 0→1`, `translateY(8px→0)` |
| **표 행 입장** | `th-row .32s`: `opacity 0→1`, `translateY(5px→0)`. 행이 30개를 넘으면 지연 없이(또는 끄기) |
| **카드 상승** | `.db-card/.db-kpi:hover` 그림자만 `.3s var(--ease)`로 키움(이동 없이). 카드 전체가 눌리는 요소일 때만 `translateY(-1px)` |
| **막대 목록 채움** | `.fill { transition: width .6s var(--ease) }`. 데이터가 바뀔 때만 보인다 |
| **스핀 아이콘** | 새로고침·테마 아이콘: `th-spin .6s`(`rotate(-200deg) scale(.5)` → 없음) |

## 3. 차트 구조(이중 Y축 콤보 차트)

- 왼쪽 Y축 = 매출 막대, 오른쪽 Y축 = 영업이익 막대, 위쪽 띠(약 100px) = 영업이익률 선(점마다 값 표기). 두 축은 **같은 격자선**을 쓴다(눈금 수 k를 3~6 중 빈 공간이 가장 적은 값으로).
- 축은 0부터가 아니라 값 주변으로 맞추고(양수면 0 아래로 내리지 않음), 영업이익 막대는 같은 시점 매출 막대 높이의 90%를 넘지 않게.
- 격자선은 점선(`stroke-dasharray: 3 5`), X축은 연도·분기 라벨, 값이 없는 칸은 막대 대신 "결측".
- 차트 크기 단계: 폭 640px 미만 380, 이상 520. 단계가 바뀌면 다시 그린다(`resize`에서 단계 변화 때만).
- 차트 아래에 같은 열의 표(매출·영업이익·영업이익률·임직원, 연도별은 "전년 대비" 열). 숫자가 없으면 0이 아니라 "-"와 이유.
- 색만으로 구분하지 않는다: ▲▼ 기호와 글자, 범례에 "(왼쪽 축)/(오른쪽 축)".

## 4. 성능 규칙

- 애니메이션은 `transform`과 `opacity` 중심. `width/height/top/left/margin`을 애니메이션하지 않는다(막대 목록 `width` 채움처럼 작은 고립 영역만 예외).
- `transition: all` 금지. 바뀌는 속성만 적는다(`transition: transform .25s var(--ease), box-shadow .25s var(--ease)`).
- 상태가 자주 바뀌는 UI는 키프레임보다 **CSS transition**(중간에 끊겨도 현재 위치에서 이어짐). 키프레임은 한 번 재생하는 입장·연출에만.
- `scale(0)`에서 시작하지 않는다(`.95`~`.02`에서 시작하고 투명도를 함께).
- `will-change`는 애니메이션 중에만. 블러·그림자·필터는 작은 영역에만.
- 새 라이브러리를 들이지 않는다. 지금 스택(CSS + 짧은 JS)으로 표현한다.
- 이벤트는 `document`에 한 번 위임(차트를 다시 그려도 동작). 차트마다 리스너를 달지 않는다.

## 5. 접근성

- `@media (prefers-reduced-motion: reduce)`에서 입장·자람·펄스·리플·행 입장 애니메이션은 `animation: none`으로 끄고, 큰 이동·확대 transition도 끈다. 단, **상태를 알려 주는 변화(색·배경·선택 표시·고정 표시)는 남긴다.** 모션을 끄면 정보가 사라지면 안 된다.
- 슬롯은 `tabindex="0"`, 포커스는 호버와 같은 표시(`:focus-visible .colbg`), 마우스 클릭 포커스에는 외곽선을 그리지 않는다.
- 호버로만 보이는 값은 모바일에서도 보이게(누르면 고정되는 핀, 최근 값 기본 표시, 아래 표).
- 말풍선은 호버·포커스·터치 모두에서 열리고 Esc·스크롤에서 닫힌다.
- 무한 반복(loop) 애니메이션은 쓰지 않는다. 쓴다면 화면 밖에서 멈춘다.

## 6. 적용 절차

1. 대상 페이지에 `dashboard.css`, `dashboard.theme.css`가 있는지 확인(`--brand`, `--ease`, `th-*` 키프레임이 여기 있다). 없으면 `site/dashboard.theme.css`의 모션 구간을 가져온다.
2. 차트는 새로 그리지 말고 `comboChart`/`combo`를 복사. 칸은 `g.slot[data-strip]` + `.colbg` + `.bar`(`--i`) + `.hit` 구조를 지킨다.
3. 요약 띠 핸들러(`mouseover/out`, `focusin/out`, `click`)를 페이지 스크립트에 한 번만 추가.
4. 모바일(390px)과 데스크톱(1280px)에서 호버·고정·키보드 Tab·다크 모드·reduced-motion을 확인.
5. 값이 없는 칸, 음수 영업이익, 데이터 1~2개뿐인 경우를 시험.

## 7. 점검 체크리스트

- [ ] 모든 모션에 이유가 있다(상태·관계·반응·변화 완충).
- [ ] 총 입장 지연 0.4초 이하, 일반 전환 0.3초 이하.
- [ ] `transition: all`, `ease-in`, 바운스, `scale(0)` 없음.
- [ ] 레이아웃 속성 애니메이션 없음(예외는 주석으로 표시).
- [ ] reduced-motion에서 정보 손실 없음.
- [ ] 키보드로 호버와 같은 정보를 볼 수 있다.
- [ ] 모바일에서 호버 없이도 값을 읽을 수 있다.
- [ ] 차트를 다시 그려도 핀·요약 띠가 깨지지 않는다.

## 8. 요청 문구(다른 곳에 붙여 넣을 때)

> 이 화면의 차트와 인터랙션을 `dashboard-motion` 스킬 규격대로 만들어 줘. 이중 Y축 콤보 차트, 스태거드 그로우인(45ms 간격·총 0.4초 이내), 호버 하이라이트, 연동 요약 띠, 핀 고정과 펄스, 아래 실적 표를 포함하고, prefers-reduced-motion·키보드·모바일 대체 표시까지 확인해 줘. 기준 구현은 site/compare.js의 combo다.
