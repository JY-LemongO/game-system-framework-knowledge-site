# ADR-003 · Bounded Deterministic ReactionQueue

- 상태: Accepted for reference implementation
- 범위: Trigger / Equipment / Status

## 맥락

EventBus subscriber가 즉시 gameplay 상태를 변경하면 구독 등록 순서, 재진입, reflect loop, triggered effect 폭발이 결과를 좌우한다.

## 결정

- 상태를 바꾸는 후속 작업은 Observation Event가 아니라 Reaction command로 만든다.
- 실행 순서는 `(priority, stableOrderKey, reactionId)`다.
- idempotencyKey, maxDepth, maxReactions, budgetCost/maxBudget을 강제한다.
- handler가 새 reaction을 만들더라도 동일한 queue 규칙 안에서 처리한다.

## 결과

후속 반응의 순서와 종료 조건이 trace에 남는다. 각 제품은 게임 규칙에 맞는 priority namespace와 budget 정책을 별도로 승인해야 한다.
