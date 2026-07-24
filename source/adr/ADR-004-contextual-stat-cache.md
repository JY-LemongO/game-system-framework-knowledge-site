# ADR-004 · Context Descriptor 기반 Stat Cache

- 상태: Accepted, bounded C#/JavaScript reference executable; production read-set·LRU pending
- 범위: Stat / Modifier / Derived Stat

## 맥락

대상 태그, 거리, 스킬 태그를 참조하는 Modifier의 값을 owner 단일 cachedValue에 저장하면 다른 대상에 잘못 재사용된다. 반대로 formula가 읽는 context를 정확히 추적하지 못하면서 일부 field만 key에 넣으면 hit rate는 높아 보여도 correctness bug가 된다.

## 결정

1. C# reference formula는 전체 `StatContext`를 받을 수 있으므로, 선언 read-set을 가장하지 않고 **관찰 가능한 전체 context**를 canonical descriptor에 넣는다.
2. nullable target/skill ID는 presence bit와 값을 분리한다. missing과 present는 hash가 같아도 동일하지 않다.
3. `TagSet`은 계약상 lowercase·중복 제거·Ordinal 정렬된 값을 기록한다. `TargetStatuses`는 formula가 목록 순서를 관찰할 수 있으므로 순서와 중복을 그대로 기록한다.
4. decimal distance는 invariant representation, moment와 ID는 length-prefixed text로 직렬화해 구분자 충돌을 피한다.
5. correctness key는 `StatId`, 전체 `CanonicalStatContextDescriptor`, `StatEvaluationVersion(OwnerVersion, DefinitionVersion, NumericPolicyVersion)`이다. evaluator 생성 시 default version도 caller가 명시해야 한다.
6. `Dictionary`의 hash는 bucket 탐색용일 뿐이다. hit는 `StatEvaluationCacheKey`의 전체 equality로만 판정한다.
7. 현재 cache는 unbounded이며 thread-safe하지 않은 in-memory dictionary이고 전체 `ClearCache()`만 제공한다. reference evaluator instance는 thread-confined로 사용한다. 공유 production cache의 동기화·수명·상한, bounded LRU, owner별 제거, reverse-edge dirty invalidation은 구현됐다고 주장하지 않는다.
8. production에서 typed context read-set 또는 개발 환경 read tracking을 도입하면 그때 증명된 field만 key에 넣어 hit rate를 높일 수 있다.

## Derived Stat과 평가 순서

- `DerivedStatGraph`는 중복 stat, missing dependency와 cycle을 구성 시 거부한다.
- 동시에 준비된 노드는 `EntityId` Ordinal 순으로 선택하며, evaluator는 요청 stat의 dependency closure만 topological order로 실행한다.
- formula는 `DeclaredStatValues`를 통해 선언한 stat dependency만 읽을 수 있다.
- dependency 최종값으로 derived base를 만든 뒤 local Add → 합산 PercentAdd → 개별 More/Less → 결정적 Override → optional decimal min/max clamp를 적용한다.
- commit 정수 반올림은 evaluator 안이 아니라 `StatNumericLanes.ToCommitInteger` 경계에서 한 번 수행한다.
- 변경 전파는 version key와 전체 `ClearCache`까지만 Executable이다. reverse dependency별 invalidation은 아직 없다.

## 실행 증거

- [`ReferenceDerivedStatEvaluator.cs`](../csharp/GameSystemKnowledge.Reference/Systems/ReferenceDerivedStatEvaluator.cs): DAG, declared dependency reads, numeric lane, clamp, full descriptor와 versioned cache.
- [`AdvancedFoundationVerification.cs`](../csharp/GameSystemKnowledge.Reference.Verification/AdvancedFoundationVerification.cs): missing/cycle/undeclared dependency, deterministic order, 정상·경계·invalid clamp, 강제 constant-hash collision, nullable presence, status-list order, owner/definition/numeric-policy version별 miss와 동일 key hit.
- JavaScript runtime reference도 짧은 hash가 아니라 전체 canonical descriptor equality로 hit를 판정한다.

## 고려한 대안

| 대안 | 채택하지 않은 이유 |
|---|---|
| owner별 최종값 하나 | target·거리·tag가 다른 조건부 Modifier 결과를 잘못 재사용한다. |
| 특수 sentinel 객체로 missing 표현 | 실제 값과 sentinel이 충돌할 수 있어 presence를 구조적으로 분리해야 한다. |
| 짧은 hash만 key로 사용 | 비보안 hash 충돌이 correctness 오류가 된다. |
| 검증 없는 부분 context key | formula가 누락 field를 읽으면 false hit가 된다. 현재 C# reference는 낮은 hit rate를 감수하고 전체 context를 사용한다. |
| 처음부터 LRU·세밀한 invalidation 구현 | eviction·동시성·owner lifetime 정책 없이 자료구조만 추가하면 학습 계약보다 framework가 앞선다. |

## 결과와 트레이드오프

현재 C# cache는 context dependency 누락 때문에 잘못 hit하지 않는다. 대신 formula가 읽지 않는 field 변화도 miss가 되고 cache가 자동으로 줄지 않으며 동시 접근을 보호하지 않으므로 장기 실행 production 저장소나 공유 singleton으로 그대로 사용할 수 없다. caller는 snapshot/definition/numeric policy version을 실제 변경 경계에 맞춰 올리고, owner lifetime 종료나 정책 전환 시 `ClearCache`를 호출해야 한다. 멀티스레드 제품은 evaluator를 실행 lane별로 소유하거나 외부 동기화·bounded cache adapter를 둬야 한다.

## 재검토 조건

- typed context read-set과 누락 read를 검출하는 개발 instrumentation이 준비될 때
- owner별 cache cardinality와 실제 hit rate를 측정해 LRU 상한을 정할 수 있을 때
- 멀티스레드 evaluator에서 lock contention과 eviction 비용을 측정할 때
- reverse dependency별 invalidation이 전체 version bump보다 의미 있게 저렴하다는 profile이 있을 때

## 외부 근거

- Microsoft .NET [`StringComparison.Ordinal`](https://learn.microsoft.com/en-us/dotnet/api/system.stringcomparison): culture와 무관한 canonical ID·tag·동률 정렬 의미의 근거. cache identity와 topological tie-break에는 사용자 언어별 정렬을 사용하지 않는다.
