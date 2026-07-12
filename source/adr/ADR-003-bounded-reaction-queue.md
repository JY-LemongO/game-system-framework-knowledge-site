# ADR-003 · Bounded Deterministic ReactionQueue

- 상태: Accepted for reference implementation
- 범위: Trigger / Equipment / Status

## 맥락

EventBus subscriber가 즉시 gameplay 상태를 변경하면 구독 등록 순서, 재진입, reflect loop, triggered effect 폭발이 결과를 좌우한다.

## 결정

- 상태를 바꾸는 후속 작업은 Observation Event가 아니라 Reaction command로 만든다.
- 실행 순서는 숫자가 낮은 priority부터 `(priority, stableOrderKey, reactionId)` 오름차순이다.
- idempotencyKey, maxDepth, maxReactions, budgetCost/maxBudget을 강제한다.
- `Drain` 한 번은 하나의 causation wave다. handler가 새 reaction을 만들더라도 같은 wave의 depth, 누적 개수, 누적 budget 상한을 공유한다.
- 시작 시 제한이 부족하거나 dispatch 중 상한을 넘으면 wave를 fail-fast로 종료한다. 아직 dispatch하지 않은 reaction은 폐기하고 idempotencyKey는 유지해 다음 `Drain`에서 조용히 재실행되지 않게 한다.
- dispatch handler 예외도 호출자에게 전달하고 남은 reaction을 폐기한다. 이미 handler가 별도 commit한 사실은 queue가 되돌리지 않으므로 handler는 멱등 command와 원자적 commit을 사용한다.

## 결과

후속 반응의 순서, wave 상한, 실패 종료 조건이 trace에 남는다. 이 참조 구현은 실패한 미dispatch 항목을 자동 재시도하지 않으므로 재시도가 필요한 제품은 별도 dead-letter/retry 정책을 명시해야 한다. 각 제품은 게임 규칙에 맞는 priority namespace와 budget 정책을 별도로 승인해야 한다.
