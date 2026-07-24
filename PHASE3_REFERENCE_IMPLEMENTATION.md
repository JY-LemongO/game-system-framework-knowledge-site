# Phase 3 Runtime Reference 구현 보고서

- 판본: `4.0.0-reference`
- 최초 작성일: 2026-07-10
- 실행 참조 감사 갱신일: 2026-07-24
- 구현 성격: 엔진·서버 비종속, 단일 프로세스, in-memory 기준 구현
- 핵심 목적: 문서에 있던 결정론·commit·reaction·cache·tick·migration 계약을 실제 코드와 회귀 테스트로 고정

여기서 판본은 사이트·문서 묶음의 release edition이다. 내장 JavaScript 커널의 `runtimeVersion`은 replay semantics를 식별하는 별도 버전이며 현재 `4.0.1-reference`다. 따라서 `VERSION`/`package.json`의 `4.0.0-reference`와 커널·TypeScript 선언·golden fixture·Fireball 페이지의 `4.0.1-reference`는 drift가 아니라 의도적으로 독립된 두 버전 축이다.

---

## 1. 구현 결론

이번 단계는 Equipment 기능을 먼저 늘리는 대신, Fireball 하나가 지나가는 핵심 경계를 실행 가능한 형태로 만든 작업이다. 결과적으로 다음 위험을 코드에서 재현하고 차단할 수 있게 됐다.

| 기존 위험 | 구현한 통제 | 검증 방법 |
|---|---|---|
| 같은 피해가 두 번 적용됨 | `commandId` idempotency와 단일 `StateStore.commit` | duplicate command probe |
| resolve 뒤 상태가 바뀐 plan의 적용 | entity version precondition | version conflict probe |
| operation 일부만 반영됨 | working copy 전체 검증 후 state swap | atomic rollback probe |
| RNG 소비 순서에 따른 결과 변동 | stateless keyed RNG | 역순 sampling 테스트 |
| 반사·흡혈·trigger loop | bounded deterministic ReactionQueue | 정렬·budget 테스트 |
| context 조건부 Stat 오염 | dependency path 기반 fingerprint cache | target/distance 분리 테스트 |
| 마지막 tick과 expire 해석 차이 | `tick ≤ expire`, tick commit 후 expire | +2/+4/+6 테스트 |
| 오래된 save의 불명확한 직접 변환 | 순차 `vN → vN+1`, N−2 window, audit hash | v1→v2→v3 테스트 |
| “같은 seed”만 기록한 불완전 replay | runtime/RNG/numeric/data/definition/formula version envelope | golden replay hash |

---

## 2. P3-A · Contract Types

### 2.1 식별자와 envelope

커널은 상태 변경 의도를 `CommandEnvelope`, 성공한 상태 변경 사실을 `DomainEventEnvelope`로 구분한다.

```text
CommandEnvelope
  schemaVersion
  commandId
  actorId
  requestedTick
  correlationId
  causationId?
  dataVersion
  payload

DomainEventEnvelope
  schemaVersion
  eventId
  type
  correlationId
  causationId
  occurredTick
  payload
```

모든 ID는 `namespace.value` 형식이다. 예시는 `command.fireball.cast.0001`, `entity.target`, `status.burn`이다. 이 규칙은 로그에서 ID의 역할을 빠르게 구분하고, 서로 다른 ID 공간의 우발적 충돌을 줄인다.

### 2.2 버전 envelope

replay header에는 다음 버전을 기록한다.

`runtimeVersion`이 달라지면 같은 사이트 판본 안에서도 이전 golden replay를 그대로 승인하지 않는다. 커널 동작이 바뀌면 source·browser asset·TypeScript 선언·golden fixture·공개 예시를 함께 올리고, release edition은 학습 묶음 자체를 새로 발행할 때만 올린다.

현재 `contractSchemaVersion=2`는 피해 fact의 필수 canonical `exactRawDamage`와 닫힌 event payload 계약을, `replayFormatVersion=2`는 exact outcome·trace projection shape를 식별한다. v1 command/event/plan과 replay fixture를 묵시적으로 보정하지 않고 `SCHEMA_VERSION_UNSUPPORTED`로 거절한다. 실제 제품에서 v1을 계속 읽어야 한다면 별도 adapter 또는 명시적 migration을 제공해야 한다.

반면 numeric policy `integer-bps-half-away-from-zero-v1`과 formula `combat.fire.v3`의 규범은 원래부터 exact intermediate와 primary 완화 전 raw 미되먹임을 요구했다. JavaScript Runtime 4.0.0의 단계 반올림은 새 정책이 아니라 이 규범을 어긴 구현 결함이었고, 4.0.1이 이를 교정한다. 그래서 numeric/formula 축은 유지하되 runtime·contract·replay 축으로 구 결과와 wire shape를 격리한다.

- `runtimeVersion`
- `contractSchemaVersion`
- `replayFormatVersion`
- `rngAlgorithmVersion`
- `rngKeySchemaVersion`
- `clockDomain`
- `numericPolicyVersion`
- `dataVersion`
- `definitionVersion`
- `formulaVersion`
- `rootSeed`

다중 대상처럼 실행 순서 의미가 추가되는 replay는 `targetOrderPolicyVersion`도 함께 기록한다.

같은 seed는 동일 replay의 필요조건일 뿐 충분조건이 아니다. 입력 snapshot, 정의, 공식, 산술, RNG 의미가 함께 고정되어야 한다.

### 2.3 계약 산출물

- `source/contracts/command-envelope.schema.json`
- `source/contracts/domain-event-envelope.schema.json`
- `source/contracts/replay-fixture.schema.json`
- `source/contracts/versioned-document.schema.json`
- `source/contracts/combat-capstone-submission.schema.json`
- `source/runtime/runtime-kernel.d.ts`

---

## 3. P3-B · Pure Resolve / Atomic Commit

### 3.1 Pure resolve

`resolveFireball`은 snapshot을 읽고 다음 결과만 반환한다.

1. 확률 decision과 key
2. immutable `DamageOutcome`
3. version precondition과 ordered operation을 포함한 plan

resolve는 caster·target·store를 변경하지 않는다. 따라서 prediction, replay, 비교 실행, trace diff의 기준점으로 사용할 수 있다.

### 3.2 정수 산술

- HP·Mana·Shield, 설정 BPS, 보고용 `rawDamage`와 committed damage는 safe integer다.
- Fireball의 formula·critical 중간값은 `BigInt` 기반 기약 유리수로 유지한다. JSON trace의 `rawDamageExact`와 outcome/outbox의 `exactRawDamage`는 `{ numerator, denominator }`의 canonical 10진 문자열로 보존하고, 이 값을 다시 읽어도 정밀도를 잃지 않는다.
- 비율은 10,000 basis points다.
- 반올림 정책은 `integer-bps-half-away-from-zero-v1`이다. 표시용 raw 정수와 완화 뒤 committed 정수는 각각 같은 정확한 중간값에서 0을 기준으로 바깥 방향으로 반올림한다. 표시용 raw 정수를 완화식의 입력으로 재사용하지 않는다.
- 피해 회계 invariant는 다음과 같다.

```text
resolvedDamage
= shieldAbsorbed + hpDamage + overkill
```

128개 seed와 극단적인 shield/HP/resistance 조합에서 conservation gap이 0임을 검사한다.

### 3.3 Atomic commit

`StateStore.commit`은 다음 순서로 처리한다.

```text
command/plan 소유권 확인
→ command idempotency 확인
→ entity version precondition 확인
→ working copy 생성
→ stable order로 operation 적용
→ 모든 resource invariant 검증
→ entity version 증가
→ state 교체
→ processed command 기록
→ domain event outbox 추가
```

검증 실패 시 working copy는 버리고 현재 state와 outbox를 변경하지 않는다. reference 구현은 메모리 교체지만, 생산 구현에서는 이 경계를 DB transaction과 durable outbox로 치환한다.

---

## 4. P3-C · Bounded ReactionQueue

`DamageCommitted`가 Burn 적용 조건을 만족하면 subscriber가 target을 즉시 바꾸지 않고 `apply-status` reaction을 만든다. builder는 event를 deterministic reaction으로 투영할 뿐 권위 경계가 아니다. handler가 causation ID로 같은 store outbox의 committed `DamageCommitted`를 찾고 ID·정렬·budget과 actor/source/target/Burn payload 전체를 다시 파생해 일치시킨 뒤에만 Status commit을 만든다. event가 정한 최소 depth 1은 낮출 수 없고, 더 큰 값은 queue가 현재 부모에서 `parent.depth + 1`로 파생한다. handler도 queue의 동기 dispatch 권한을 요구하므로 직접 호출로 wave 상한을 우회할 수 없다.

실행 순서는 다음 tuple로 고정한다.

```text
(priority, stableOrderKey, reactionId)
```

상한은 다음과 같다.

- `maxDepth`
- `maxReactions`
- `maxBudget`
- reaction별 `budgetCost`
- `idempotencyKey`

이 구조는 triggered equipment, lifesteal, reflect를 추가할 때도 동일하게 사용한다. Observation Event는 UI·사운드·로그에만 사용하고 gameplay 변경은 새 command/reaction으로 변환한다.

---

## 5. P3-D · Cache, Tick, Migration

### 5.1 ContextualStatCache

외부에 돌려주는 진단용 `cacheKey`는 다음 descriptor의 hash다. 실제 in-memory Map의 equality key는 hash가 아니라 전체 `canonicalDescriptor` 문자열이므로 짧은 hash가 충돌해도 descriptor가 다르면 cache hit가 아니다.

```text
entityId
statId
ownerVersion
contextFingerprint
```

`contextFingerprint`는 caller가 선언한 dependency path의 presence와 값만 canonicalize한다. 예를 들어 `target.id`, `target.tags`, `distanceBand`가 다르면 같은 owner의 같은 stat이어도 별도 entry다. 하지만 runtime이 `compute`의 실제 read-set과 선언을 대조하지 않으므로 dependency 누락은 자동 검출되지 않으며 stale hit가 날 수 있다.

현재 구현은 bounded LRU와 entity 단위 invalidation을 제공한다. 생산 단계에서는 dependency 선언 누락을 잡기 위한 dev-mode read tracking을 추가한다. 반면 C# `ReferenceDerivedStatEvaluator`는 correctness 우선 정책으로 전체 canonical `StatContext`와 owner/definition/numeric version을 key에 넣으며, 이 JS 최적화형 계약과 범위를 구분한다.

### 5.2 Status tick

Burn reference policy는 다음과 같다.

- 첫 tick: 적용 시각 + interval
- 처리 조건: `nextTickAt <= targetTick && nextTickAt <= expireTick`
- tick과 expire가 같은 시각: tick commit 후 expire
- catch-up: status instance의 `maxCatchUpTicks` 상한
- 상한 초과 뒤 이미 expire 시각을 지났다면 `catchUpLimited` 이유를 남기고 status를 제거

### 5.3 SchemaMigrationRegistry

- edge는 `vN → vN+1`만 등록 가능
- 기본 호환 창은 current version 기준 N−2
- source는 clone/freeze되어 migration 함수가 직접 변경할 수 없음
- 각 단계에 `migrationId`, `beforeHash`, `afterHash` 기록
- 필수 edge 누락이나 output version 불일치 시 전체 거부

---

## 6. P3-E · Fireball Golden Slice

기본 fixture는 다음 흐름을 관통한다.

```text
Command received
→ Snapshot frozen
→ Keyed hit/crit decisions
→ Damage resolve
→ Atomic mana/cooldown/shield/HP commit
→ SkillCommitted + DamageCommitted
→ Burn reaction enqueue
→ StatusApplied commit
→ +2 / +4 / +6 StatusTicked commit
→ +6 StatusExpired
→ Final state / trace / replay hash
```

기본 결과:

| 항목 | 값 |
|---|---:|
| Hit / Critical | true / true |
| Raw damage | 252 |
| Resolved fire damage | 202 |
| Shield absorbed | 40 |
| Impact HP damage | 162 |
| Burn raw / committed tick | 30 / 24 × 3 |
| Final target HP | 266 |
| Event count | 10 |
| Trace stages | 18 |
| Replay hash | `18ea7715eebe2c03` |
| Trace hash | `f7ba8ff22fec26ba` |

`source/runtime/fixtures/fireball-golden-v2.json`이 expected state, outcome, event type, hash를 보관한다.

---

## 7. UX/UI 통합

`modules/runtime-reference.html`은 단순 설명 페이지가 아니라 동일 커널을 실행하는 인터랙티브 문서다.

- Fireball input Workbench
- replay hash / trace hash 비교
- decision trace와 committed event timeline
- duplicate/version conflict/rollback failure probe
- Contextual Stat Cache Lab
- save v1→v2→v3 Migration Lab
- learner-authored Chain Lightning + Shock contract capstone
- fixture 기반 normal·edge·failure 계산 probe와 차원별 최소점 feedback
- source/schema/ADR direct link
- desktop/mobile responsive layout
- 키보드 검색, native dialog, reduced motion, offline-first 유지

추가 다이어그램:

1. `39_runtime_ports_and_adapters`
2. `40_resolve_commit_reaction_sequence`
3. `41_deterministic_replay_envelope`

전체 갤러리는 34종으로 확장됐다.

### 7.1 캡스톤 증거 경계

캡스톤 assessor는 제출 JSON을 production gameplay code로 실행하지 않는다. 제출한 정책을 고정 fixture 모델에 적용해 다음 결과를 계산한다.

- 전체 정렬 뒤 최대 3개 선택, 동률 EntityId 순서, target-keyed RNG와 permutation hash
- 중복 target 요청 거부와 full-shield Hit의 Shock 적용
- caster·모든 target version 중 하나가 stale일 때 state/outbox hash 불변
- reaction budget 실패 전 primary·dispatch 완료 commit 보존, 미실행 항목 폐기, enqueue 완료 key 유지, 비영속 diagnostic과 새 commandId·reaction idempotencyKey 재시도 정책
- `DamageCommitted → apply-status command/StatusInstance.applicationCausationId`, `StatusApplied event → apply command`, 이후 tick command가 직전 transition event를 따르는 causation과 마지막 피해·tick·expire·remove의 단일 commit

합격은 총점 80점 이상만으로 결정하지 않는다. 여섯 차원 각각 80% 이상, normal·edge·failure probe 전부 PASS, critical 위반 0개가 동시에 필요하다. 공개 브라우저 API에는 완성 제출물 생성 함수를 두지 않으며, JSON Schema는 정답과 오답 후보 token을 함께 공개한다.

---

## 8. 의도적인 제한과 불확실성

이 구현이 증명하는 것은 **계약의 일관성과 단일 기준 시나리오의 재현성**이다. 다음 항목을 생산 수준으로 검증했다고 해석하면 안 된다.

- 실제 DB isolation과 장애 중복 처리
- outbox publisher의 at-least-once delivery
- authoritative server와 client prediction/reconciliation
- 멀티 타깃·AoE의 부분 성공/전체 원자성 정책
- 장시간 replay의 성능과 메모리
- 대규모 modifier dependency graph
- 부동소수점이 필요한 물리/좌표 계층
- save batch migration의 운영 rollback
- Unity/Unreal/custom engine adapter

FNV-1a hash는 회귀 식별용이며 보안 서명이나 변조 방지용 cryptographic hash가 아니다.

---

## 9. 현재 권고

Equipment를 바로 구현하기 전에 production port를 먼저 분리한다. 핵심 조건은 **동일 golden fixture를 memory adapter와 production adapter가 모두 통과하는 것**이다. 그 다음 Equipment의 ItemInstance sourceRef, Affix Modifier, TriggeredEffect를 ReactionQueue에 연결한다.
