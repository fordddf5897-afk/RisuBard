# 간편 모드 (Easy mode)

캐릭터 채팅 사이트처럼 **홈 → 작품 → 대화** 순서로 쓰는 화면입니다. RisuBard 위에 새 화면만 얹었고, 채팅 엔진·데이터·스크립트는 그대로입니다. 그래서 RisuAI 캐릭터 카드, 모듈, 프리셋, `.bin` 백업이 전부 그대로 쓰입니다.

## 화면 흐름

| 화면 | 하는 일 |
| --- | --- |
| 홈 | 작품 카드 격자, 검색(이름·태그·제작자), 태그 칩 필터, 정렬(최근 대화/새로 추가/이름), "이어서 대화하기" 줄, 작품 추가(파일 가져오기·새로 만들기) |
| 작품 | 표지, 한 줄 소개, 태그, 작품 소개(제작자 노트), **시작 상황** 선택, **페르소나** 선택, 대화 기록, `새로운 대화 시작` / `이어하기` |
| 대화 | 기존 채팅 화면 + 상단 바(뒤로, 작품 이름, 세이브, 메뉴) + 오른쪽 메뉴 |

대화 메뉴에 모은 RisuBard 기능

- 세이브 / 불러오기 / 빠른 세이브 (비주얼 노벨식 세이브 슬롯)
- 메모리 위키 (BardWiki)
- 로어북 · Grimoire (작품 설정의 로어북 탭)
- 대화 목록 · 채팅 설정 (페르소나·프롬프트·모델 바인딩, 토글)
- 작품 설정 (기본 정보, 이미지, 로어북, 스크립트, TTS, 공유, 고급)
- 자동 삽화 켜기/끄기, 마지막 답변 지금 그리기
- 간편 모드 설정(앱 스킨), 전체 설정

휴대폰의 뒤로 가기 버튼은 대화 → 작품 → 홈 순서로 돌아갑니다.

## RisuAI 데이터와의 관계

- **시작 상황** = 캐릭터의 첫 메시지(`fmIndex -1`)와 추가 첫 메시지(`alternateGreetings[n]`, `fmIndex n`). 새 대화는 고른 시작 상황의 `fmIndex`로 만든 보통 RisuAI 채팅입니다.
- **시작 상황 제목, 한 줄 소개**는 캐릭터의 `extentions.risuEasy`에 저장됩니다. 카드로 내보내면 `data.extensions.risuEasy`로 들어가고, 원본 RisuAI도 이 값을 그대로 보존합니다. 제목이 없으면 "시작 상황 1, 2…"로 보입니다.
  - 제목은 첫 메시지 순서(번호)에 묶입니다. 작품 설정에서 추가 첫 메시지 순서를 바꾸면 제목도 다시 맞춰 주세요.
- **페르소나**는 새 채팅의 `bindedPersona`로 들어갑니다(RisuBard의 챗별 페르소나).
- **간편 모드 설정**(켜짐 여부, 자동 삽화, 정렬)은 기기별 브라우저 저장소(localStorage)에 둡니다. 데이터베이스와 백업에는 아무것도 추가하지 않습니다.

## 자동 삽화 (NovelAI)

AI 답변이 끝나면 다음 순서로 동작합니다.

1. 정해 둔 간격(매 답변, 2·3·5·10개마다)인지 확인합니다. 이미 그림이 있는 답변은 건너뜁니다.
2. 바드 페인터가 보조 모델로 장면 프롬프트를 씁니다(바드 페인터 설정의 모델 슬롯, 그림체, 인물·의상 프리셋을 그대로 사용).
3. NovelAI로 그림을 만들고 WebP로 저장한 뒤, 답변 끝에 `{{inlay::...}}`로 넣습니다. 바드 페인터 갤러리에도 남습니다.

필요한 것: 설정 > 기타 봇 > 이미지 생성의 NovelAI API 키. 그릴 때마다 Anlas가 듭니다.

## 앱 스킨

간편 모드 화면은 색·모서리·그림자를 전부 스킨 토큰으로 그리므로, RisuBard 앱 스킨(`.risuskin`)이 그대로 적용됩니다. 간편 모드 설정에서 밝은 초록 계열의 **정원** 스킨을 한 번에 설치할 수 있습니다(`src/ts/easyMode/gardenSkin.json`).

## 모드 전환

- 간편 모드 설정 > `기존 화면으로 전환`
- 기존 화면에서는 사이드바 메뉴 줄, 또는 설정 화면 왼쪽 아래 "플러그인" 묶음의 `간편 모드로 전환`
- 주소 끝에 `?classic`을 붙이면 이번만 기존 화면, `?easy`는 이번만 간편 모드

## 파일 구성

```
src/lib/EasyMode/          화면 (Svelte)
  EasyModeShell.svelte     홈/작품/대화 전환, 뒤로 가기, 작품 추가
  EasyHome.svelte          홈
  EasyWorkCard.svelte      작품 카드
  EasyWorkDetail.svelte    작품 화면
  EasyChat.svelte          대화 화면 상단 바와 메뉴, 자동 삽화 실행
  EasyWorkEditor.svelte    작품 설정(기존 CharConfig에 탭만 붙임)
  EasySettings.svelte      간편 모드 설정
  EasySheet.svelte         전체 화면 패널
  EasyImage.svelte         에셋 이미지 표시
  EasyNotes.svelte         작품 소개(마크다운, 다국어)
src/ts/easyMode/           로직
  works.ts                 작품 목록, 검색, 태그, 시작 상황, 메타데이터
  chatStart.ts             새 대화 시작, 기존 대화 열기, 페르소나 목록
  autoIllustrate.ts        자동 삽화 판단과 실행
  state.svelte.ts          설정, 화면 상태, 기존 화면 메뉴 등록
  events.ts                기존 채팅 화면에 보내는 이벤트
  gardenSkin.json          정원 스킨
deploy/synology/           시놀로지 compose, 자동 업데이트 스크립트(update.sh), 안내
deploy/easy-ci-sync.sh     RisuBard 새 버전 병합 (자동/수동 공용)
deploy/easy-ci-check.sh    간편 모드 검사 (자동/수동 공용)
.github/workflows/easy-mode-sync.yml  매일 병합 · 검사 · 이미지 빌드
deploy/easy-sync-upstream.sh  원본 업데이트 병합 스크립트
```

## 기존 파일 연결점

원본을 업데이트할 때 충돌이 날 수 있는 곳은 아래 네 곳뿐입니다. 모두 `easy-mode:` 주석이 붙어 있습니다.

| 파일 | 변경 |
| --- | --- |
| `src/App.svelte` | import 2줄, `{:else if $easyModeEnabled}<EasyModeShell />` 분기 2줄 |
| `src/lib/ChatScreens/ChatScreen.svelte` | import 1줄, 세이브 슬롯/빠른 세이브 이벤트를 듣는 `$effect` 한 블록 |
| `src/lib/ChatScreens/DefaultChatScreen.svelte` | import 1줄, 메모리 위키 이벤트를 듣는 `$effect` 한 블록 |
| `src/lib/UI/GUI/SideBarArrow.svelte` | 버튼 두 개에 `data-sidebar-arrow` 속성 |

나머지는 전부 새 파일이고, 기존 함수(`changeChar`, `changeChatTo`, `newChatModelDefaults`, `getPainterSession`, 앱 스킨 API)를 불러 쓰기만 합니다. 원본이 이 함수들의 이름이나 인자를 바꾸면 `pnpm check`가 알려 줍니다.

### 업데이트 받는 법

**자동**: `.github/workflows/easy-mode-sync.yml`이 매일 04:23(한국 시간)에 RisuBard 최신 버전을 합치고, 아래 검사를 통과하면 Docker 이미지(`ghcr.io/<아이디>/<저장소>:latest`)를 만듭니다. NAS는 `deploy/synology/update.sh`로 새 이미지를 받습니다. 설정은 `deploy/synology/README.ko.md`를 보세요.

- 충돌이나 검사 실패가 있으면 아무것도 올리지 않고 실행이 실패로 끝나며, 실행 요약에 충돌 파일과 고치는 법이 적힙니다.
- 병합 판단은 `deploy/easy-ci-sync.sh`, 검사는 `deploy/easy-ci-check.sh`가 합니다.

**수동**: 같은 일을 내 컴퓨터에서 하려면

```bash
./deploy/easy-sync-upstream.sh
```

RisuBard 대신 RisuAI 원본을 직접 받으려면 `UPSTREAM_URL=https://github.com/kwaroran/RisuAI.git`를 앞에 붙입니다. 이 경우 RisuBard가 바꾼 저장 구조와 겹치는 부분이 많아 충돌이 훨씬 큽니다. 평소에는 RisuBard를 받는 쪽을 권합니다.

## 테스트

```bash
node node_modules/vitest/vitest.mjs run src/ts/easyMode
```

작품 목록·검색·정렬, 시작 상황, 메타데이터 왕복, 설정 파싱, 자동 삽화 판단, 정원 스킨 검사를 확인합니다.
