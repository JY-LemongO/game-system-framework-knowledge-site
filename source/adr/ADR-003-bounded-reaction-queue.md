# ADR-003 · Bounded Deterministic ReactionQueue

- 상태: Accepted for reference implementation
- 범위: Trigger / Equipment / Status

## 맥락

EventBus subscriber가 즉시 gameplay 상태를 변경하면 구독 등록 순서, 재진입, reflect loop, triggered effect 폭발이 결과를 좌우한다.

## 결정

- 상태를 바꾸는 후속 작업은 Observation Event가 아니라 Reaction command로 만든다.
- 실행 순서는 숫자가 낮은 priority부터 `(priority, stableOrderKey, reactionId)` 오름차순이다.
- idempotencyKey, maxDepth, maxReactions, budgetCost/maxBudget을 강제한다.
- `Drain` 한 번은 하나의 causation wave다. handler가 만든 자식 depth는 queue가 `parent.depth + 1`로 파생한다. 호출자가 같은 depth를 다시 제출해 인과 상한을 우회할 수 없다.
- `maxDepth`는 현재 origin에서 지난 reaction edge 수다. `maxDepth = 0`이면 현재 root만 실행할 수 있다.
- 시작 시 제한이 부족하거나 dispatch 중 상한을 넘으면 wave를 fail-fast로 종료한다. 아직 dispatch하지 않은 reaction은 폐기하고 idempotencyKey는 유지해 다음 `Drain`에서 조용히 재실행되지 않게 한다.
- dispatch handler 예외도 호출자에게 전달하고 남은 reaction을 폐기한다. 이미 handler가 별도 commit한 사실은 queue가 되돌리지 않으므로 handler는 멱등 command와 원자적 commit을 사용한다.
- `reactionId`, business `idempotencyKey`, 후속 `commandId`, causal depth는 retry에서도 바꾸지 않는다. attempt만 별도 식별한다.
- 제품 retry는 reaction별 `Committed`, `OutcomeUnknown`, `Undispatched`, `PermanentFailure` disposition을 내구 저장하고 미커밋 항목만 명시적으로 다시 실행한다. 전체 wave에 새 business key를 부여하지 않는다.

## 고려한 대안

| 대안 | 채택하지 않은 이유 |
|---|---|
| Event subscriber가 즉시 상태 변경 | 등록 순서와 재진입이 gameplay 결과를 바꾸고 한 transaction의 실패 경계가 사라진다. |
| caller가 depth 숫자를 전적으로 지정 | 같은 depth를 반복 제출해 `maxDepth`를 우회할 수 있다. |
| 실패한 wave 전체를 새 idempotency key로 재실행 | 이미 commit된 앞부분까지 다시 적용될 수 있다. |
| 자동 무한 retry | 영구 실패와 poison reaction이 큐를 점유하고 결정론적 budget을 무너뜨린다. |

## 결과

C#과 JavaScript 실행 참조는 모두 자식 depth를 활성 부모에서 파생하고 같은-depth 위조를 거부한다. JavaScript는 순서·wave 상한·실패 종료 조건을 trace에도 남긴다. 두 queue는 메모리 참조이며 durable disposition/retry ledger를 구현하지 않는다. crash 이후 복구가 필요한 제품은 DB transaction/outbox adapter에 disposition을 저장하고 같은 business identity로 재시도해야 한다. exactly-once 전달을 주장하지 않으며 consumer와 command commit의 멱등성으로 중복을 흡수한다.

## 재검토 조건

- reaction을 프로세스 밖 worker가 처리하거나 crash recovery가 요구될 때
- priority namespace를 여러 팀이 공유해 starvation 분석이 필요할 때
- handler가 commit 여부를 확정할 수 없는 외부 시스템을 호출할 때
