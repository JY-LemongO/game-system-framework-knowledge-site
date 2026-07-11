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

## 결과

중복 commit, stale plan, 중간 operation 실패를 명시적으로 검증할 수 있다. 생산 환경에서는 이 경계를 DB transaction과 durable outbox adapter로 대체해야 한다.
