# Changelog · Phase 3 Runtime Reference

## 3.4.0-reference · 2026-07-20

### Added

- learner-authored `Chain Lightning + Shock` JSON contract capstone
- exact candidate token·scenario schema with correct and distractor values
- 100-point rubric, per-dimension 80% floors, normal·edge·failure gates, critical violations
- deterministic fixture probes for target ordering, per-target RNG, stale rollback, reaction budget, Status causation, and atomic final tick
- desktop and 390px mobile interaction smoke coverage for assess, evidence, malformed JSON, and reset

### Changed

- replay teaching envelope now names contract schema, replay format, RNG key schema, clock domain, data, and target-order policy versions explicitly
- reaction failure teaching now distinguishes committed, dispatched, undispatched, non-durable diagnostic, idempotency, and retry semantics
- Status teaching now connects application and periodic source provenance to the direct transition-event causation chain

### Fixed

- removed the browser API that returned a complete 100-point submission
- replaced scenario-slug self-report gates with computed probe results plus exact evidence declarations
- made mutation version subjects order-independent as a set contract
- prevented high aggregate scores from hiding a weak rubric dimension or incorrect ownership boundary
- rejected sparse arrays, index accessors, symbol/extra properties, and other non-JSON array shapes before assessor values are read

### Evidence boundary

- the capstone validates a learner-authored design artifact against a fixture model; it does not claim a production multi-target runtime, Unity adapter, or network implementation

## 3.2.0-reference · 2026-07-10

### Added

- 실행 가능한 `modules/runtime-reference.html`
- 브라우저/Node 공유 `runtime-kernel.js`
- Command/Event envelope와 TypeScript 선언
- keyed deterministic RNG와 integer BPS numeric policy
- pure Fireball resolve와 atomic StateStore commit
- post-commit event outbox
- bounded deterministic ReactionQueue
- Burn fixed tick, tick-before-expire, catch-up budget
- ContextualStatCache와 bounded LRU
- sequential N−2 SchemaMigrationRegistry
- golden replay fixture와 save migration sample
- 21개 runtime regression tests
- JSON Schema 4종
- Architecture Decision Record 5종
- Runtime Workbench, failure probe, cache lab, migration lab
- Runtime 다이어그램 3종과 34개 갤러리
- 검색 인덱스 325개 항목
- 정적 validator, Chromium smoke, preview capture 도구

### Changed

- 전체 drawer와 상단 navigation에 Runtime Reference 추가
- 홈에 Release 3.2 실행 구현 CTA 추가
- Phase 3 Readiness의 74점 판정을 구현 전 baseline으로 명확화
- Implementation Roadmap과 다음 확장 문서에 production gate 상태 반영
- footer release 표기를 3.2로 갱신

### Fixed

- 계산 결과와 실제 HP/Shield commit 소유권을 단일 경계로 고정
- Event observation과 gameplay reaction의 의미 혼합 제거
- seed 단독 결정론 설명을 versioned replay envelope로 보강
- context-dependent stat의 owner 단일 cache 오염 방지
- Burn 마지막 tick/expire 동률과 catch-up 상한 명시
- duplicate command, stale plan, partial mutation 실패를 자동 검사

### Not production-complete

- persistent transaction/durable outbox adapter
- authoritative server/network identity
- multi-target/AoE stable commit policy
- Equipment MVP와 TriggeredEffect graph
- load/fuzz/soak test와 운영 migration tooling
