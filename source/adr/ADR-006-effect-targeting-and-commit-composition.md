# ADR-006 · Effect Targeting과 Commit Composition

- 상태: Accepted, bounded C# reference executable; Skill/reaction composition pending
- 범위: Effect / Skill / Combat / Runtime Commit

## 맥락

기존 C# `EffectBundle`의 operation은 `DamageRequest`, `ApplyStatusRequest`처럼 target이 들어간 요청을 담는다. 이 carrier를 intent로 재사용해 실행 직전에 target을 다시 고르면 double resolution이 된다. 한편 여러 Effect mutation을 순서대로 직접 적용하면 중간 실패 때 partial state와 사실이 어긋난다.

## 결정

1. 새 reference pipeline의 입력은 target-independent `ReferenceEffectOperationSpec`이다. 현재 payload는 `DamageEffectSpec`과 `ApplyStatusEffectSpec`만 지원한다.
2. `ReferenceEffectSpecification`은 operation ID 중복을 구성 시 거부한다. 기존 target-bound `EffectBundle`/`EffectBundlePlan`과 새 specification을 같은 단계로 해석하지 않는다.
3. 실행 target mode는 `Self`, `ExplicitTarget`, `CandidateSnapshot` 세 가지다. Area/Arc/Chain은 아직 계약만 설명하는 production 확장이다.
4. Unity Physics, NavMesh, scene object 조회는 adapter가 eligibility를 판정하고 이미 canonical한 비음수 `long` metric을 넣은 `CanonicalTargetSnapshot`으로 변환한다. domain에 `UnityEngine` 타입을 넣지 않는다.
5. 현재 reference는 candidate metric의 범위와 결정 순서만 검증하며 world 좌표→정수 변환 정책은 구현하지 않는다. production adapter는 `TargetMetricPolicyVersion`, 길이 단위/scale, 좌표 quantization 시점, float→integer midpoint rounding, squared-distance overflow 처리와 saturate/reject 선택을 고정하고 replay 입력에 version을 포함해야 한다.
6. snapshot은 duplicate target ID를 거부하고 `(SelectionPriority DESC, DistanceSquared ASC, EntityId Ordinal ASC)`로 정렬한다. resolver가 `MaxTargets`를 적용한다.
7. missing explicit target과 빈 candidate snapshot은 configuration exception이 아니라 상태 변경 없는 stable NotApplicable reason으로 반환한다. rule 누락·중복·unknown operation은 configuration 오류로 거부한다.
8. `ResolvedEffectOperation`은 선택 target과 순서를 보존하고, `EffectContext`의 caster/source/random seed를 사용해 실제 `DamageRequest` 또는 `ApplyStatusRequest`를 한 번 bind한다.
9. 소유 resolver가 계산한 applied 결과는 `CommitPlanFragment`로 투영한다. 현재 fragment는 version precondition, mutation, outbox event만 포함하며 reaction command는 포함하지 않는다.
10. outcome은 `Applied`, `NotApplicable`, `Rejected`로 구분한다. Applied만 matching operation-target fragment를 가져야 하며, Rejected가 하나라도 있으면 partial plan을 만들지 않는다.
11. `DeterministicEffectCommitPlanComposer`는 **Effect fragment끼리만** operation-target identity 순으로 합친다. 동일 version precondition은 dedupe하고 conflicting version, duplicate outcome/fragment/event, 같은 resource의 복수 mutation을 거부한다.
12. ready composition만 기존 `CommitPlan`과 `IRuntimeCommitter`에 전달한다. commit precondition이 stale이면 전체 plan을 거부하며 같은 command에서 target을 자동 재선택하지 않는다.
13. Skill cost·cooldown fragment와 reaction fragment를 합치는 일반 outer composer는 아직 없다. Fireball reference의 Skill+Damage 원자성은 수동 `CommitPlan` 구성으로만 증명한다.

## 실행 증거

- [`Contracts/Effects.cs`](../csharp/GameSystemKnowledge.Reference/Contracts/Effects.cs): 기존 guarded target-bound operation, bundle, reaction identity.
- [`ReferenceEffectPipeline.cs`](../csharp/GameSystemKnowledge.Reference/Systems/ReferenceEffectPipeline.cs): target-independent spec, canonical adapter snapshot, resolver, resolved operation, outcome, fragment와 Effect-only composer.
- [`AdvancedFoundationVerification.cs`](../csharp/GameSystemKnowledge.Reference.Verification/AdvancedFoundationVerification.cs):
  - 정상: Self/Explicit/candidate bind, metric tie의 EntityId order, 입력 outcome 순서와 무관한 mutation/event order, 실제 `InMemoryRuntimeCommitter` commit.
  - 경계: missing explicit·빈 snapshot의 NotApplicable, NotApplicable-only NoChanges, Rejected의 no partial plan.
  - 실패: duplicate candidate/rule/outcome/fragment/event, contradictory precondition, mutation collision, operation-wide NotApplicable과 applied target의 모순.
- Fireball reference scenario는 Skill 비용·cooldown과 damage mutation을 하나의 `CommitPlan`으로 수동 구성한다.

## 고려한 대안

| 대안 | 채택하지 않은 이유 |
|---|---|
| 기존 target-bound `EffectBundle`을 resolver 입력으로 재사용 | placeholder target 또는 double resolution을 정상처럼 가르치게 된다. |
| operation 실행 때마다 target 재조회 | 같은 command에서도 world 변화나 query 순서에 따라 대상이 바뀐다. |
| duplicate candidate를 조용히 제거 | adapter 버그를 숨기고 어떤 metric을 보존했는지 모호해진다. |
| Unity collider 순서를 그대로 사용 | engine query 순서는 authoritative tie-breaker가 아니며 headless test와 replay가 불안정하다. |
| mutation collision에서 last-write-wins | operation 입력 순서가 결과를 바꾸고 각 event가 어느 상태를 설명하는지 불명확해진다. |
| commit 실패 시 자동 재선택 | preview와 실제 결과가 달라지고 stale conflict를 숨긴다. |

## 결과와 트레이드오프

bounded reference 범위에서는 target 선택과 commit 조합의 정상·경계·실패 의미가 실행 코드로 고정된다. adapter가 candidate eligibility와 metric을 먼저 계산해야 하므로 Unity/서버 query와 metric quantization/version 정책은 domain 밖에 남는다. 범용 Skill+Effect+reaction transaction이나 BestEffort per target은 아직 제공하지 않으므로 현재 composer만으로 전체 production pipeline이 완성됐다고 주장할 수 없다.

## 재검토 조건

- Area/Arc/Chain selection에 canonical geometry snapshot 계약이 필요할 때
- Skill 비용·cooldown과 reaction을 같은 fragment protocol로 일반화할 때
- 대규모 전투에서 SingleAtomic plan 크기나 lock contention이 허용 범위를 넘을 때
- cross-shard target을 하나의 command가 다뤄야 할 때
- gameplay가 의도적으로 partial success를 요구하고 UX·fact schema까지 의미를 명시할 때

## 외부 근거

- Microsoft Azure Architecture Center의 [Transactional Outbox pattern](https://learn.microsoft.com/en-us/azure/architecture/databases/guide/transactional-out-box-cosmos): 상태 변경과 발행할 event를 같은 transaction에 기록하고 별도 relay가 전달하며 consumer를 idempotent하게 설계해야 한다는 commit/outbox 경계의 근거.
