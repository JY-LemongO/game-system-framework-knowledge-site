# Game System Framework · Phase 3 Runtime Reference

이 패키지는 기존 **System Atlas UX/UI 개편본** 위에 Phase 3 핵심 계약을 실행 가능한 reference kernel로 추가한 오프라인 지식 사이트다. 최상위 `index.html`을 열면 빌드나 서버 없이 문서를 볼 수 있고, `Runtime Reference` 페이지에서 Fireball replay와 실패 probe를 직접 실행할 수 있다.

## 배포 및 브랜치 운영

- 운영 사이트: <https://jy-lemongo.github.io/GameSystemKnowledge/>
- QA 프리뷰: <https://jy-lemongo.github.io/GameSystemKnowledge/preview/>
- **main**: 운영·릴리스 브랜치
- **dev**: 통합·QA 브랜치

`dev`에 변경 사항을 푸시하면 QA 프리뷰가 갱신됩니다. 확인이 끝난 변경은 Pull Request로 `dev`에서 `main`으로 머지하며, 머지 후 운영 사이트가 자동으로 갱신됩니다.

## 바로 시작하기

1. `index.html` — 전체 시스템과 세 가지 Architecture Lens
2. `modules/phase3-readiness.html` — 구현 전 audit baseline과 Release 3.2 상태
3. `modules/runtime-reference.html` — 실행 가능한 커널, Workbench, Cache/Migration Lab
4. `source/runtime/README.md` — kernel API와 Node 실행 방법
5. `PHASE3_REFERENCE_IMPLEMENTATION.md` — 구현 상세와 설계 판단
6. `PHASE3_IMPLEMENTATION_PLAN.md` — 남은 생산 구현 계획
7. `QA_REPORT.md` — 최종 자동 검증 결과

## Release 3.2에서 구현한 범위

- **P3-A Contract Types**: Command/Event envelope, namespaced identity, correlation/causation, version envelope
- **P3-B Commit Pipeline**: 순수한 resolve, optimistic version precondition, idempotent command, all-or-nothing commit, post-commit outbox
- **P3-C Reaction Queue**: priority/stable key 정렬, idempotency, depth/reaction/budget 상한
- **P3-D Runtime Hardening**: 정수 BPS 산술, keyed RNG, Burn tick-before-expire, catch-up cap, ContextualStatCache, 순차 N−2 migration
- **P3-E Reference Slice**: 단일 대상 Fireball golden replay, trace/replay hash, 21개 회귀 테스트

기본 fixture의 결과는 다음과 같다.

```text
Critical hit
Raw damage       252
Resolved damage  202
Shield absorbed   40
Impact HP damage 162
Burn              19 × 3
Final target HP  281
Replay hash       62b74418205d61ea
Trace hash        a41533f05cc6dc53
```

## 실행과 검증

Node.js 20 이상이 있으면 패키지 루트에서 다음 명령을 실행한다.

```bash
npm test                 # 21개 runtime 회귀 테스트
npm run demo             # 기본 Fireball 결과 출력
npm run migration-demo   # save v1 → v2 → v3 변환 출력
npm run validate         # 링크·ID·asset·contract 정적 무결성 검사
npm run smoke            # Chromium 데스크톱/모바일 및 인터랙션 검사
npm run qa               # 위 검사를 순서대로 모두 실행
```

최종 판본의 자동 검사 결과는 다음과 같다.

- Runtime tests: **21/21**
- HTML pages: **16**
- Search entries: **325**
- Diagrams: **34 DOT + 34 SVG + 34 PNG**
- JSON contract schemas: **4**
- Architecture decision records: **5**
- Browser smoke checks: **109/109**
- Static validation errors/warnings: **0/0**

## 주요 디렉터리

```text
assets/
  css/site.css                 전체 UX/UI와 Runtime Lab 스타일
  js/app.js                    탐색·검색·다이어그램·Runtime Lab UI
  js/runtime-kernel.js         브라우저용 공유 커널
modules/
  runtime-reference.html       실행 가능한 Phase 3 문서
source/
  runtime/runtime-kernel.js    Node/브라우저 공유 커널 원본
  runtime/runtime-kernel.d.ts  TypeScript 선언
  runtime/tests/               21개 회귀 테스트
  runtime/fixtures/            golden replay와 migration sample
  contracts/                   JSON Schema 4종
  adr/                         설계 결정 기록 5종
  tools/                       검색 인덱스·정적 검사·브라우저 검사·미리보기
PREVIEW/                       최종 UI 캡처
```

`source/runtime/runtime-kernel.js`와 `assets/js/runtime-kernel.js`는 byte-identical이다. 브라우저 데모와 Node 회귀 테스트가 다른 구현을 사용해 결과가 어긋나는 문제를 피하기 위한 규칙이다.

## 생산 적용 전 남은 경계

현재 커널은 아키텍처 계약을 검증하기 위한 **단일 프로세스·메모리 reference implementation**이다. 실제 제품에 적용하려면 DB transaction과 durable outbox, authoritative server identity, 네트워크 retry/reconciliation, multi-target stable ordering, engine resource/animation adapter, load/fuzz test, schema rollout/rollback 운영 절차가 추가되어야 한다.

초기 74/100 준비도는 구현 전 문서에 대한 audit baseline이며, 표준 인증 점수가 아니다. 현재 구현 상태와 남은 생산 작업은 `PHASE3_REFERENCE_IMPLEMENTATION.md`와 `PHASE3_IMPLEMENTATION_PLAN.md`를 기준으로 판단한다.
