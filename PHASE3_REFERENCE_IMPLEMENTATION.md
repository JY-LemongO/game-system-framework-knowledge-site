# Phase 3 Runtime Reference 구현 보고서

- 판본: `3.2.0-reference`
- 작성일: 2026-07-10
- 구현 성격: 엔진·서버 비종속, 단일 프로세스, in-memory 기준 구현
- 핵심 목적: 문서에 있던 결정론·commit·reaction·cache·tick·migration 계약을 실제 코드와 회귀 테스트로 고정

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

- `runtimeVersion`
- `contractSchemaVersion`
- `replayFormatVersion`
- `rngAlgorithmVersion`
- `numericPolicyVersion`
- `dataVersion`
- `definitionVersion`
- `formulaVersion`
- `rootSeed`

같은 seed는 동일 replay의 필요조건일 뿐 충분조건이 아니다. 입력 snapshot, 정의, 공식, 산술, RNG 의미가 함께 고정되어야 한다.

### 2.3 계약 산출물

- `source/contracts/command-envelope.schema.json`
- `source/contracts/domain-event-envelope.schema.json`
- `source/contracts/replay-fixture.schema.json`
- `source/contracts/versioned-document.schema.json`
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

- 모든 runtime 수치는 safe integer다.
- 비율은 10,000 basis points다.
- 반올림 정책은 `integer-bps-half-up-v1`이다.
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

`DamageCommitted`가 Burn 적용 조건을 만족하면 subscriber가 target을 즉시 바꾸지 않고 `apply-status` reaction을 만든다.

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

cache key는 다음 descriptor의 hash다.

```text
entityId
statId
ownerVersion
contextFingerprint
```

`contextFingerprint`는 caller가 선언한 dependency path의 값만 canonicalize한다. 예를 들어 `target.id`, `target.tags`, `distanceBand`가 다르면 같은 owner의 같은 stat이어도 별도 entry다.

현재 구현은 bounded LRU와 entity 단위 invalidation을 제공한다. 생산 단계에서는 dependency 선언 누락을 잡기 위한 dev-mode read tracking을 추가한다.

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
| Burn tick | 19 × 3 |
| Final target HP | 281 |
| Event count | 7 |
| Trace stages | 18 |
| Replay hash | `62b74418205d61ea` |
| Trace hash | `a41533f05cc6dc53` |

`source/runtime/fixtures/fireball-golden-v1.json`이 expected state, outcome, event type, hash를 보관한다.

---

## 7. UX/UI 통합

`modules/runtime-reference.html`은 단순 설명 페이지가 아니라 동일 커널을 실행하는 인터랙티브 문서다.

- Fireball input Workbench
- replay hash / trace hash 비교
- decision trace와 committed event timeline
- duplicate/version conflict/rollback failure probe
- Contextual Stat Cache Lab
- save v1→v2→v3 Migration Lab
- source/schema/ADR direct link
- desktop/mobile responsive layout
- 키보드 검색, native dialog, reduced motion, offline-first 유지

추가 다이어그램:

1. `39_runtime_ports_and_adapters`
2. `40_resolve_commit_reaction_sequence`
3. `41_deterministic_replay_envelope`

전체 갤러리는 34종으로 확장됐다.

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
