# Combat Learning Quality Run 1 Plan

## 분석 요약

- 최신 기준 브랜치는 `dev`이며, 현재 체크아웃된 `codex/add-branded-favicon`은 이미 `dev`에 반영된 이전 작업 브랜치다.
- 이번 Run은 학습자가 그대로 구현할 때 결과가 달라지는 런타임 계약 오류를 우선 수정하고, 그 계약을 설명하는 공개 문서와 범위 고지를 함께 맞춘다.
- 합격 기준은 JavaScript와 C# 참조 구현의 핵심 불변식 일치, 공개 설명의 단일 해석 가능성, 주요 데스크톱·모바일 화면의 기능·가독성 통과다.
- 이번 Run 완료 후 독립 QA에서 남은 결함을 재분류하고, 합격점에 미달하면 다음 Run 계획을 별도로 작성한다.

## 영향 파일/시스템

- Runtime 계약
  - `source/runtime/runtime-kernel.js`
  - `assets/js/runtime-kernel.js`
  - `source/runtime/runtime-kernel.d.ts`
  - `source/runtime/tests/runtime-kernel.test.cjs`
  - `source/csharp/GameSystemKnowledge.Reference/Runtime/Commit.cs`
  - `source/csharp/GameSystemKnowledge.Reference.Verification/Program.cs`
- 공개 학습 계약
  - `modules/runtime-reference.html`
  - `modules/integration-map.html`
  - `modules/combat-resolution-system.html`
  - `modules/status-system.html`
  - `modules/fireball-case-study.html`
  - `modules/core-runtime.html`
  - `modules/effect-system.html`
  - `modules/skill-action-system.html`
  - `modules/stat-system.html`
  - `modules/glossary.html`
  - `modules/diagram-gallery.html`
  - `index.html`
- 파생 산출물
  - `source/search-index.json`
  - `assets/js/search-index.js`
  - `MANIFEST.sha256`
- UX 검증
  - `assets/css/site.css`
  - `assets/js/app.js`
  - `source/tools/browser_smoke.py`
  - 필요 시 `PREVIEW/` 캡처

## 수정 계획 (단계별)

1. 깨끗한 worktree를 확인한 뒤 `dev`로 전환하고 `origin/dev`와 fast-forward 동기화한다.
2. JavaScript `ReactionQueue`를 ADR/C#과 동일한 causation-wave fail-fast 계약으로 수정한다.
   - 시작 시 wave 한도 위반은 dispatch 0회로 실패한다.
   - dispatch 중 enqueue 한도 위반과 handler 예외는 호출자에게 전달한다.
   - 실패 시 미dispatch 항목은 폐기하되 idempotency key는 유지해 다음 `Drain`으로 유출되지 않게 한다.
   - 성공 순서 `(priority, stableOrderKey, reactionId)`는 유지한다.
3. JavaScript commit plan 검증을 강화한다.
   - 모든 mutation entity가 정확히 하나의 version precondition을 갖게 한다.
   - read-only snapshot entity의 추가 precondition은 허용한다.
   - 중복·누락·잘못된 plan은 state/outbox/processed command 변경 전에 거부한다.
4. 정상·경계·실패 회귀 테스트를 추가하고 C# parity assertion을 보강한다.
5. 실행 참조와 공개 문서를 한 계약으로 정리한다.
   - `CombatContext`는 현재 C# fixture의 pre-resolved 입력임을 명시하고, full Hit/Critical pipeline은 conceptual extension으로 구분한다.
   - Status catch-up은 호출 cadence에 따른 tick 손실 가능성을 정확히 설명한다.
   - Burn refresh/immunity/stacking은 실행 구현 여부를 명시해 fixture 규칙처럼 오인되지 않게 한다.
   - `SourceRef`, `EffectResult`, Fireball range/LOS, Skill 상태 소유권 등 직접 모순을 수정한다.
   - Stat modifier의 비율 단위, Less/Override, clamp/round 순서를 재현 가능한 규칙으로 고정한다.
6. 홈과 Runtime Lab에 기존 `.callout`을 재사용해 증거 수준과 의도적 범위를 표시한다.
   - `Normative contract`, `Executable reference`, `Conceptual extension`, `Out of scope`를 구분한다.
   - DB transaction, durable outbox, network prediction/reconciliation, multi-target AoE, authoritative server, engine adapter가 실행 참조 범위 밖임을 공개한다.
7. 검색 색인·site shell·manifest를 재생성하고 정적 계약을 검사한다.
8. 로컬 서버에서 Home과 Runtime Lab을 최소 1440x1000, 390x844, 320x844로 검사한다.
   - 수평 overflow, 정보 계층, focus/keyboard, no-JS 고지, 검색 dialog, 이미지 modal, Workbench 실행·reset·failure probes를 확인한다.
9. 전체 `npm run qa`와 독립 QA를 수행한다. 발견된 결함은 같은 Run에서 수정·재검증한다.
10. 이번 Run 파일만 검토해 `dev`에 커밋·푸시하고, GitHub Pages Preview가 해당 `dev` HEAD SHA를 배포했는지 확인한다.

## 사이드이펙트 표

| 영향 범위 | 테스트 케이스 | 위험도 |
|---|---|---|
| ReactionQueue 실패 반환이 예외 종료로 변경 | 시작 전 depth/count/budget 초과, handler 예외, dispatch 중 enqueue 초과, 다음 Drain 0회 | 높음 |
| idempotency key 유지 | 폐기된 reaction 재등록 거부, 정상 queue 수명 내 중복 억제 | 중간 |
| commit precondition coverage | mutation 누락 거부, 중복 거부, read-only 추가 precondition 허용, rollback 불변 | 높음 |
| 정상 Fireball replay | 기존 hit/miss, Burn tick, replay/trace hash와 golden fixture | 높음 |
| 공개 계약 문구 | C# 타입·JS 구현·ADR·용어집·검색 결과의 동일 의미 | 높음 |
| Stat 수식 | 0%, 100%, 복수 More/Less, Override 동률, clamp 경계, 반올림 | 중간 |
| 범위 callout | Desktop/mobile/no-JS 가독성, h1 계층, 검색 노출 | 낮음 |
| 파생 산출물 | search index, shared runtime copy, manifest stale 여부 | 중간 |
| 배포 | dev HEAD와 Pages Preview 배포 SHA 일치, 핵심 페이지 실동작 | 높음 |

## 미해결 질문

- 사용자 목표가 반복 수정·커밋·푸시와 최종 `dev` Preview 검증을 명시했으므로 이번 Run 실행 권한은 확인된 것으로 간주한다.
- C#에 JavaScript와 동일한 keyed RNG 기반 Hit/Critical 결정기를 새로 추가하는 작업은 별도 설계가 필요한 범위다. 이번 Run에서는 현재 C#을 `pre-resolved deterministic fixture`로 정확히 표기하고, 재감사에서 다음 Run 필요성을 판단한다.
- 실제 Unity 프로젝트 파일은 존재하지 않는다. `net9.0` 참조 환경과 Unity adapter 경계를 공개 문서에 명시하는 것으로 이번 Run 범위를 제한한다.

## 보고서 경로

`docs/agent-reports/combat_learning_quality_run1_Plan.md`

## 재검토 반영

- JavaScript queue 생성자 상한은 C#처럼 `Enqueue`에서 즉시 거부하고, 더 작은 per-drain 상한은 dispatch 전에 전체 wave를 실패시키도록 확정했다.
- malformed commit plan의 필수 배열·tick·시간 역행을 mutation 전에 거부하고, trace observer 예외가 commit/reaction 결과를 바꾸지 않게 격리했다.
- C# compact fixture와 JavaScript 실행 fixture의 증거 범위를 표로 분리하고 `net9.0`·Unity adapter 경계를 공개했다.
- Stat 전체 evaluator는 현재 실행 참조에 없으므로 exact replay 구현이라고 주장하지 않는다. 공식은 명시적 conceptual policy로, 브라우저 계산기는 단일 보정자 단계의 근사 실험으로 낮춰 표기했다.
- Run 1 정확성 재검토에서 P0/P1 정합성 문제는 해소됐다. 독립 구현 숙달도 평가는 capstone·rubric·unseen variant 부재 때문에 다음 Run을 요구한다.
- 적용 원천은 `SkillExecution`, periodic 실행 원천은 `Status`로 `SourceRef`를 분리했다. 상태의 첫 tick은 `StatusApplied`, 다음 tick은 직전 `StatusTicked`, 다른 상태의 치명타로 정리되는 상태는 `EntityDefeated`를 직접 원인으로 보존한다.
- C# `ReactionCommand`에도 trigger event의 `CausationId`를 추가하고 verifier로 전파를 고정했다.
- 공개 JavaScript damage resolver의 `Miss`·`Blocked`·`Immune`·`Rejected`는 입력 raw damage와 무관하게 모든 피해 필드를 0으로 정규화한다.
- 양의 Burn ratio가 half-up 후 0이 되는 경우 최소 raw tick 1, ratio 0은 상태 미적용이라는 fixture 정책을 문서와 경계 테스트에 고정했다.
- Effect·Skill·Stat·GameContext·Fireball 상단의 문구를 다시 감사해 값 타입/인터페이스 존재와 실제 coordinator/evaluator/timeline 구현을 구분했다.
- 자동 QA 1차 재실행은 JavaScript 45/45, C# 157 assertions, 공개 페이지 12개, 검색 321개, 다이어그램 34세트, 브라우저 406/406을 통과했다. 후속 독립 감사에서 C# 결과 타입의 불법 상태와 피해 보존식 overflow 우회를 막아 verifier를 173 assertions로 강화했고, C#/JavaScript 요청 형태를 분리하면서 검색 항목은 323개가 됐다. 마지막 문서 freeze 뒤 파생물과 동일 suite를 다시 검증한다.
- 마지막 freeze 감사에서 raw `StateStore.commit`이 불완전 command/plan을 수용하고 생성자가 malformed state를 보존하는 P2를 재현했다. 이를 닫기 위해 exact-v1 CommandEnvelope/CommitPlan schema, 판별형 operation, canonical JSON, 초기 entity/status/outbox 검증과 private backing을 추가했으며 실패 뒤 state·tick·outbox·멱등 기록 불변을 회귀 테스트로 고정했다.
- replay header에 실제 key 조립 규칙인 `rngKeySchemaVersion=correlation-branch-target-v1`과 `clockDomain=simulation_tick`을 승격했다. 전투 결과·event·최종 state가 동일함을 확인하고 golden replay/trace hash만 재승인했다.
- C# `ReactionBudget`의 `maxBudget`을 JavaScript와 같이 양수로 제한하고, `CommittedOutboxEvent.Sequence` 및 `CommitReceipt`의 불법 상태를 factory/constructor로 차단했다. signed midpoint 의미가 모호하지 않도록 numeric policy를 `integer-bps-half-away-from-zero-v1`으로 명명하고 양수·음수 경계 테스트를 추가했다. 강화 후 빠른 실행 검증은 JavaScript 49/49, C# 177 assertions, 정적 사이트 검증은 페이지 12개·검색 323개·계약 schema 6개·다이어그램 34세트·오류/경고 0을 통과했다.
- 독립 freeze 감사에서 trace callback 재진입이 optimistic version과 ReactionQueue wave를 바꿀 수 있고, Status clock 되감기·reflection clock advance·`__proto__` canonical key 소실·plan/state accessor TOCTOU·safe integer 중간 연산 손실·Status add/remove 암묵 전이가 가능함을 재현했다. StateStore와 clock의 재진입 차단, module-wide trace mutation guard, queue private backing, 입력 단일 canonical snapshot, JSON data-key 보존, Status 시간·존재 전이와 매 단계 resource safe-integer 검증으로 닫았다.
- 각 재현을 정상·실패·재시도 불변 회귀 테스트로 고정했고, SourceRef의 flat 보조 ID 일치와 C# resource version 상한까지 보강해 JavaScript 62/62·C# 182 assertions를 통과했다. `PHASE3_REFERENCE_IMPLEMENTATION.md`의 판본·numeric 정책·Burn 수치·event 수·golden hash도 현재 3.3.0 실행 참조와 맞췄다.
- 최종 Run 1 gate는 JavaScript 62/62, C# 182 assertions, 공개 페이지 12개, 검색 323개, 계약 schema 6개, ADR 5개, 다이어그램 34세트, manifest 186개, 브라우저 406/406, 오류·경고 0을 통과했다. 도메인 정확성 감사와 런타임 경계 독립 감사가 모두 P1/P2 blocker 없음으로 PASS했다.
