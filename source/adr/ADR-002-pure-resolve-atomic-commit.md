# ADR-002 · Pure Resolve와 Atomic Commit

- 상태: Accepted for reference implementation
- 범위: Skill / Combat / Resource

## 맥락

계산과 상태 변경이 섞이면 prediction, replay, 중복 요청, race condition에서 같은 피해가 두 번 적용되거나 일부 자원만 변경될 수 있다.

## 결정

- Resolve는 고정 snapshot을 읽고 immutable plan만 만든다.
- plan은 entity version precondition, 안정적으로 정렬되는 operation, event blueprint를 포함한다.
- StateStore commit이 Shield, HP, Mana, Cooldown, Status를 working copy에 적용하고 전체 검증 후 한 번에 교체한다.
- commandId는 idempotency key이며 이미 처리된 command는 거부한다.
- Domain event는 성공한 commit 뒤에만 outbox에 추가한다.
- Atomic outbox와 truthful outbox는 별도 불변식이다. 이 reference runtime은 닫힌 event taxonomy만 publish한다. `SkillCommitted`의 target·skill·mana·cooldown, primary/periodic damage의 SourceRef·실제 pre-state 저항·Shield 우선 분배·보존식·resource delta, Status add/tick/remove, 사망의 치명 전이를 command와 pre/working state에 대조한다.
- Fireball command의 actor·requested tick·data version·target·skill은 별도 resolver input과 RNG 전에 정확히 결속한다. 시나리오 orchestration은 성공한 commit receipt의 event만 reaction builder에 넘긴다. handler는 호출 관례에만 의존하지 않고 causation ID가 같은 store outbox의 유일한 `DamageCommitted`인지 확인한 뒤 event에서 reaction의 ID·정렬·budget과 actor/source/target/Burn payload 전체를 재파생해 canonical 비교한다. event가 정한 최소 causal depth는 낮출 수 없고, 더 큰 depth는 queue가 현재 부모에서 파생한다. handler는 queue가 동기 dispatch 중인 동일 reaction object에만 부여하는 내부 권한도 요구한다.
- 원시 피해량·RNG 판정·Burn definition/ratio에서 파생된 tick damage·duration·interval·catch-up 값처럼 committer가 post-state만으로 재구성할 수 없는 사실은 pure resolve가 기록한다. committer는 이 gameplay policy를 다시 실행하지 않고 exact raw 투영 이후의 저항·보호막·HP 전이와 provenance, Burn payload의 shape·data version·생존 적용 조건을 검증한다. upstream 사실은 runtime/formula/data version·입력 snapshot·trace·golden fixture로 재현 가능하게 남긴다.
- CommitPlan은 직렬화 가능한 event blueprint만 포함한다. 공개 schema에 열거된 event type이 고정 projector/invariant를 선택하며 함수 callback과 임의 event type은 plan에 저장하지 않는다.

## 결과

중복 commit, stale plan, 중간 operation 실패뿐 아니라 state와 outbox fact의 불일치도 publish 전에 거부할 수 있다. 이 실패는 state, outbox, command idempotency를 모두 유지한다. 생산 환경에서는 이 경계를 DB transaction과 durable outbox adapter로 대체해야 한다.

## 고려한 대안

| 대안 | 채택하지 않은 이유 |
|---|---|
| Resolve가 live state를 직접 변경 | 재시도와 prediction이 입력을 바꾸고 commit 전제조건·전체 rollback을 적용할 지점이 사라진다. |
| state 저장 뒤 event를 별도 write | 두 write 사이 장애에서 state만 남거나 event만 남을 수 있다. |
| event payload를 planner가 준 대로 신뢰 | mutation과 모순되는 “그럴듯한 거짓 fact”가 downstream 반응·분석을 오염시킨다. |
| 알 수 없는 event type을 자동 통과 | projector/invariant가 없는 payload를 authoritative fact처럼 publish하게 된다. 확장은 schema·validator·migration을 함께 추가해야 한다. |
| reaction의 causationId와 payload shape만 신뢰 | outbox에 없는 원인이나 event와 다른 Burn 값을 후속 authoritative command로 바꿀 수 있다. 같은 store의 committed event membership과 전체 deterministic projection을 함께 검증한다. |
| commit에서 RNG와 전체 공식을 재실행 | resolver와 committer가 두 번째 계산 권위를 가지며 정책 drift와 비용이 생긴다. 대신 재구성 가능한 전이만 독립 검증한다. |

## 재검토 조건

- 여러 aggregate 또는 shard를 한 command가 변경해야 할 때
- durable DB transaction/outbox relay를 선택할 때
- event taxonomy를 plugin registry로 열어야 할 때
- formula proof 또는 서명된 plan처럼 resolver 권위를 더 강하게 인증해야 할 때
- best-effort partial success가 gameplay 요구가 될 때

## 외부 근거

- Microsoft Azure Architecture Center의 [Transactional Outbox pattern](https://learn.microsoft.com/en-us/azure/architecture/databases/guide/transactional-out-box-cosmos): business state와 event를 같은 transaction에 기록하고 별도 relay/consumer가 전달하는 production 경계의 근거. 이 메모리 참조는 패턴의 원자성만 학습하며 durable delivery를 주장하지 않는다.
