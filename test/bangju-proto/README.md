# 방주 보관함 시험판 검증 스크립트

`server/node/bangju/`의 보관함 시험판을 내 컴퓨터에서 가짜 봇으로 검증하는 스크립트입니다.
앱이 하는 것과 같은 HTTP 요청(로그인, DB 읽기/쓰기, 패치)으로 서버를 다룹니다.

준비: 저장소에서 `ONNXRUNTIME_NODE_INSTALL_CUDA=skip pnpm install --frozen-lockfile`. 화면 빌드(`dist`)는 필요 없습니다.

```bash
cd test/bangju-proto
./srv.sh 7801 /tmp/bangju-a /tmp/bangju-a.log       # 빈 데이터 폴더로 서버 시작
node seed2.cjs http://127.0.0.1:7801 12             # 가짜 봇 12개 (일부는 그림 포함)
node t1.cjs http://127.0.0.1:7801 /tmp/bangju-a     # 보관·불러오기 핵심 동작, 낡은 탭 거절
node t3.cjs http://127.0.0.1:7801 /tmp/bangju-a     # 그림 보호 (보관 뒤 앱의 그림 정리)
node t8.cjs http://127.0.0.1:7801 /tmp/bangju-a     # 마지막 결과 남기기, 연결이 끊긴 경우
node t4.cjs http://127.0.0.1:7801 /tmp/bangju-a 7801 /tmp/bangju-a.log   # 옮기는 도중 서버가 죽은 경우
./stop.sh 7801
```

| 파일 | 하는 일 |
| --- | --- |
| `h.cjs` | 공용 도우미 (로그인, DB 읽기·쓰기, 패치, 그림 요청, 가짜 봇 만들기) |
| `seed.cjs`, `seed2.cjs` | 가짜 봇 몇 개 넣기. `seed2`는 채팅 메시지에서만 쓰는 그림 하나를 더 넣음 |
| `seed3.cjs` | 실제와 비슷한 규모(봇 1,150개, 글 데이터 약 180MB) 넣기. `NODE_OPTIONS=--max-old-space-size=5000` 필요 |
| `t1.cjs` | 보관 → 새 페이지 확인 → 낡은 탭의 패치·전체 쓰기 거절 → 불러오기 → 원본과 같은지 |
| `t2.cjs` | 앱의 그림 정리가 보관된 봇의 `assets/` 이름을 지우는 것을 확인(그래서 보호가 필요), V3 폴더 봇 보관·불러오기 |
| `t3.cjs` | 그림 보호(하드링크): 보관 → 앱의 그림 정리 → 불러오기 → 그림 요청. 옛 방식 저장과 새 asset-store 둘 다 |
| `t4.cjs` | 중단 복구: 서버를 강제로 죽이고 파일을 중단 시점 모양으로 둔 뒤 다시 시작 |
| `t5.cjs` | 규모: 100개만 남기고 보관, 봇 추가 요청 크기, 전부 불러오기, 순서 |
| `t6.cjs` | 시험용 '봇 추가' 요청이 내는 경고가 보관함과 무관한지 확인 |
| `t7.cjs` | 목록 다시 읽기가 실패하면 폴더를 전부 되돌리는지. 서버를 `BANGJU_ARCHIVE_TEST_FAIL_RELOAD=1`로 켜고 돌림 |
| `t8.cjs` | 마지막 옮긴 결과가 서버에 남는지(`/api/bangju/archive/status`). 답을 받기 전에 연결이 끊겨도 결과를 다시 읽을 수 있는지 |
| `probe.cjs`, `probe2.cjs` | 시작 읽기 확인, 앱 전체 백업에 들어가는 파일 목록 |
| `page-test.cjs` | 시험 화면(`/bangju/archive`)을 실제 브라우저로 조작. `puppeteer-core`와 Chrome이 따로 필요 |
