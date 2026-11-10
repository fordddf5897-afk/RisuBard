# 시놀로지 NAS에서 돌리기 (자동 업데이트 포함)

한 번 설정하면 이렇게 돌아갑니다.

1. 매일 새벽 4시 20분쯤 GitHub가 RisuBard 새 버전을 내 포크에 합치고, 간편 모드 검사를 돌린 뒤 Docker 이미지를 만듭니다.
2. 매일 새벽 5시 30분쯤 NAS가 새 이미지를 받아 다시 시작합니다.
3. 충돌이나 검사 실패가 있으면 아무것도 바꾸지 않고, GitHub가 실패 메일을 보냅니다.

직접 할 일은 실패 메일이 왔을 때뿐입니다.

---

## 1. GitHub 포크 만들기

1. https://github.com/rpaddict/RisuBard 에서 **Fork**를 누릅니다. 저장소 이름은 자유롭게 정하세요(예: `my-risu`).
2. 포크에 간편 모드를 넣습니다. 둘 중 하나를 고르세요.
   - **git을 쓸 수 있으면**
     ```bash
     git clone https://github.com/<내 아이디>/my-risu.git
     cd my-risu
     git am risubard-easy-mode.patch
     git push
     ```
   - **git이 어려우면**: `risubard-easy-mode-files.zip`을 풀고, 포크 저장소 화면에서 `Add file > Upload files`로 압축을 푼 폴더 안의 내용(`src`, `docs`, `deploy`, `.github` 폴더)을 통째로 끌어다 놓고 Commit 합니다. 같은 이름의 파일은 덮어써도 됩니다.
      - `.github` 폴더는 숨김 폴더라 탐색기/Finder에서 숨김 파일 보기를 켜야 보입니다.

## 2. GitHub Actions 켜기

1. 포크의 **Actions** 탭 → "I understand my workflows, go ahead and enable them"을 누릅니다.
2. **Settings > Actions > General** 맨 아래 Workflow permissions를 **Read and write permissions**로 바꾸고 Save.
3. **Actions** 탭 → 왼쪽 **Easy mode - RisuBard sync and image** → **Run workflow** → "RisuBard 새 버전이 없어도 이미지를 다시 만들기"를 체크하고 실행합니다. 15분쯤 걸립니다.
4. 끝나면 저장소 첫 화면 오른쪽 **Packages**에 이미지가 생깁니다. 패키지를 열고 **Package settings > Change visibility > Public**으로 바꿉니다.
   - 이미지에는 앱 코드만 들어 있고 캐릭터나 채팅은 없습니다. 비공개로 두려면 4-1을 보세요.

### NAS가 ARM CPU라면

제어판 > 정보 센터에서 CPU가 Realtek이나 ARM이면 **Settings > Secrets and variables > Actions > Variables**에 `EASY_ARM64` = `true`를 추가한 뒤 3번을 다시 실행하세요. Intel/AMD면 필요 없습니다.

## 3. NAS 준비

1. File Station에서 `docker/risubard` 폴더와 그 안에 `save` 폴더를 만듭니다.
2. `docker/risubard`에 이 폴더의 `docker-compose.yml`과 `update.sh`를 올립니다.
3. `docker-compose.yml`의 `image:` 줄을 내 이미지로 바꿉니다. 아이디와 저장소 이름은 **소문자**로 씁니다.
   ```yaml
   image: ghcr.io/<내 아이디>/my-risu:latest
   ```
4. Container Manager > 프로젝트 > 생성 → 경로 `docker/risubard` → 기존 `docker-compose.yml` 사용 → 완료.
5. `http://NAS주소:7777`에 접속해 비밀번호를 정합니다. 기존 리스 데이터는 설정 > 백업에서 `.bin`을 불러오면 됩니다.

### 4-1. 이미지를 비공개로 둘 때

GitHub **Settings > Developer settings > Personal access tokens > Tokens (classic)**에서 `read:packages` 권한만 있는 토큰을 만들고, Container Manager > 레지스트리 > 설정 > 추가에서 `https://ghcr.io`, 아이디, 토큰을 등록합니다. 그리고 NAS에 SSH로 한 번 `sudo docker login ghcr.io`를 해 둬야 `update.sh`가 이미지를 받을 수 있습니다.

## 4. NAS 자동 업데이트 켜기

1. 제어판 > 작업 스케줄러 > 생성 > 예약된 작업 > **사용자 정의 스크립트**
2. 일반: 이름 `risubard 업데이트`, 사용자 **root**
3. 일정: 매일, 첫 실행 시간 **05:30**
4. 작업 설정의 사용자 정의 스크립트:
   ```bash
   bash /volume1/docker/risubard/update.sh
   ```
5. 확인 후 목록에서 우클릭 > **실행**으로 한 번 돌려 봅니다. 결과는 `docker/risubard/update.log`에 남습니다.

## 5. 폰에서 앱처럼 쓰기

폰에 설치(PWA)하려면 HTTPS 주소가 필요합니다.

- **역방향 프록시**: 제어판 > 로그인 포털 > 고급 > 역방향 프록시에서 `https://risu.내도메인` → `http://localhost:7777`. 인증서는 제어판 > 보안 > 인증서에서 Let's Encrypt로 받고, 사용자 지정 머리글에 WebSocket을 추가합니다.
- **Tailscale**: NAS와 폰에 Tailscale을 깔고 `tailscale serve`로 HTTPS를 켭니다. 포트를 인터넷에 열지 않아도 됩니다.

HTTPS 주소를 열고 안드로이드 Chrome은 메뉴 > 홈 화면에 추가, iPhone Safari는 공유 > 홈 화면에 추가.

---

## 실패 메일이 왔을 때

GitHub 실행 기록을 열면 무엇이 문제인지 한국어로 적혀 있습니다.

| 내용 | 할 일 |
| --- | --- |
| **자동 병합 충돌** | RisuBard가 간편 모드가 쓰는 파일을 바꿨습니다. 실행 기록의 안내와 충돌 파일 목록을 Claude에게 보여 주세요. 고친 뒤 push 하면 자동으로 다시 돕니다. |
| **검사 실패** | 'Check easy mode' 단계 로그를 Claude에게 보여 주세요. |
| **워크플로 파일 변경** | 저장소 첫 화면의 **Sync fork > Update branch**를 누르면 끝납니다. |

어떤 경우든 NAS는 마지막으로 잘 되던 이미지를 계속 씁니다.

> 저장소 화면의 **Sync fork**에서 **Discard commits**는 절대 누르지 마세요. 간편 모드가 지워집니다.

## 선택 설정

- **EASY_SYNC_TOKEN** (Secrets): RisuBard가 자기 GitHub 워크플로 파일을 바꾼 업데이트까지 자동으로 올리려면, `repo`와 `workflow` 권한이 있는 토큰을 이 이름으로 등록하세요. 없으면 그런 업데이트 때만 위 표의 'Sync fork'를 한 번 눌러 주면 됩니다.
- GitHub는 저장소에 60일 동안 활동이 없으면 예약 실행을 멈춥니다. 멈추면 Actions 탭에서 다시 켜면 됩니다.
- 큰 업데이트 전후로 Hyper Backup이나 스냅샷에 `docker/risubard/save` 폴더를 넣어 두면 안전합니다.
