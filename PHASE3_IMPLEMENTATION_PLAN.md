# Phase 3 이후 생산 구현 계획

- 기준 판본: `3.2.0-reference`
- 계획 원칙: reference kernel의 observable semantics를 유지하면서 인프라 adapter를 교체
- 우선순위: P0 correctness → P1 integration → P2 scale/tooling

---

## 1. 현재 완료 범위

| Workstream | 상태 | 완료 기준 |
|---|---|---|
| P3-A Contract Types | Reference 완료 | schema, d.ts, identity/version envelope |
| P3-B Commit Pipeline | Reference 완료 | idempotency, version conflict, atomic rollback |
| P3-C ReactionQueue | Reference 완료 | stable ordering, depth/count/budget |
| P3-D Cache/Tick/Migration | Reference 완료 | context cache, tick policy, N−2 migration |
| P3-E Fireball | 부분 완료 | 단일 대상 in-memory golden slice |
| P3-F Equipment | 미착수 | production gate 이후 시작 |

---

## 2. P0 · Production Port Interface

### 2.1 작업

reference kernel에서 다음 port를 명시적으로 분리한다.

```text
SnapshotReader
AtomicStateCommitter
ProcessedCommandStore
DurableOutbox
Clock
DefinitionRegistry
TraceSink
MigrationStore
```

`StateStore`의 in-memory 구현은 test adapter로 유지한다. production adapter는 같은 plan과 event blueprint를 받아야 하며, domain semantics를 자체적으로 재계산하지 않는다.

### 2.2 수용 기준

- memory adapter와 production adapter가 동일 golden fixture의 final state/event payload를 생성
- commit과 outbox가 같은 transaction 경계에 포함
- process crash가 commit 직후 발생해도 event가 유실되지 않음
- 동일 command retry가 자원을 두 번 변경하지 않음
- optimistic conflict가 retryable `VERSION_CONFLICT`로 매핑됨

### 2.3 예상 산출물

- `ports/*.ts` 또는 엔진 언어 interface
- SQL/NoSQL transaction adapter
- durable outbox publisher와 retry policy
- adapter conformance test suite
- 장애 주입 테스트 보고서

---

## 3. P0 · Authoritative Server Identity

### 3.1 작업

- client request ID와 server command ID의 관계 정의
- server tick assignment
- actor ownership/permission validation
- definition/formula version pinning
- duplicate/out-of-order packet 처리
- response에 authoritative state version과 reconciliation token 포함

### 3.2 수용 기준

- 같은 client request가 재전송되어도 한 번만 commit
- 늦게 도착한 오래된 request는 명확한 error/result로 종료
- server가 승인한 version과 client prediction version 차이를 trace에서 확인 가능
- correlation/causation chain이 network boundary를 지나 유지됨

---

## 4. P0 · Multi-target / AoE Semantics

### 4.1 먼저 결정할 정책

- 후보 대상 정렬: stable entity ID 또는 spatial query stable key
- 대상별 RNG key: `(correlationId, decision, targetId)`
- 대상 하나의 version conflict가 전체 cast를 실패시키는지, 대상별 부분 성공을 허용하는지
- 비용/쿨다운 commit과 대상별 damage commit의 transaction 경계
- target cap과 budget

### 4.2 권장 기본값

PvE reference에서는 비용/쿨다운을 cast 단위로 한 번 commit하고, target 결과는 stable order의 단일 atomic plan으로 묶는다. 대규모 MMO나 분산 shard에서는 대상별 result ledger와 부분 성공 정책이 별도 ADR로 필요하다.

### 4.3 수용 기준

- 후보 입력 배열 순서를 섞어도 target별 outcome과 replay hash 동일
- target 제거/추가 시 다른 target의 keyed roll이 이동하지 않음
- target cap 초과가 deterministic하게 잘림
- overkill/shield accounting invariant가 모든 대상에서 유지됨

---

## 5. P1 · Equipment MVP

### 5.1 최소 데이터 모델

```text
ItemDefinition
ItemInstance
EquipmentSlot
AffixDefinition
GrantedSkillRef
TriggeredEffectDefinition
EquipmentLoadout
```

### 5.2 통합 규칙

- 모든 Modifier sourceRef는 `ItemInstance.id`
- equip/unequip command는 idempotent
- 장착 시 ownerVersion 증가 및 관련 Stat cache invalidation
- TriggeredEffect는 EventBus에서 직접 상태를 바꾸지 않고 ReactionQueue에 enqueue
- set bonus도 별도 sourceRef를 가짐
- save 문서는 schemaVersion과 definition/data version을 기록

### 5.3 수용 기준

- 동일 item을 두 번 equip해도 Modifier가 중복 등록되지 않음
- unequip 시 해당 item source의 Modifier/Reaction만 제거
- 장착 직후 context cache가 stale 값을 반환하지 않음
- OnDamage trigger의 priority와 budget이 trace에 남음
- 저장 후 load/migration한 loadout이 동일 final stat을 생성

---

## 6. P1 · 테스트 확장

### 필수 추가

- property-based test: 수천 개 seed/수치 조합
- fuzz input: invalid ID, 범위, malformed payload
- reaction graph: lifesteal ↔ reflect ↔ thorns
- multi-status stacking/refresh/replace/independent duration
- large catch-up and pause/time-scale policy
- save migration batch, retry, partial failure
- durable outbox duplicate delivery
- adapter conformance test

### 성능 기준 초안

구체적인 수치는 실제 게임 규모를 측정한 뒤 정한다. 우선 다음 지표를 수집한다.

- resolve/commit p50, p95, p99
- cast당 allocation과 trace 크기
- ReactionQueue depth/budget 분포
- cache hit/miss/eviction 비율
- status tick backlog
- outbox lag와 retry count

---

## 7. P2 · Tooling과 운영

- definition/formula diff viewer
- trace first-divergence 비교 도구
- replay fixture 승인 workflow
- schema migration dry-run dashboard
- live reaction budget telemetry
- admin command replay/inspect 도구
- compatibility matrix와 deprecation policy

---

## 8. 권장 실행 순서

```text
1. Port interface 추출
2. Transaction + durable outbox adapter
3. Adapter conformance golden test
4. Authoritative request identity
5. Multi-target stable ordering
6. Load/fuzz/failure injection
7. Equipment MVP
8. TriggeredEffect regression graph
9. Save rollout/migration tooling
```

이 순서를 지키는 이유는 Equipment가 Stat, Effect, Event, Save에 동시에 새로운 source를 공급하기 때문이다. commit과 reaction의 생산 경계가 먼저 안정되어야 장비 버그가 각 시스템으로 확산되지 않는다.
