# ADR-001 · 결정론적 수치 Lane과 Keyed RNG

- 상태: Accepted
- 범위: Core / Stat / Combat / Commit / Replay

## 맥락

Stat의 성장 공식은 소수 정밀도가 필요하지만, 확률·저항·계수와 실제 HP·Mana commit까지 모두 같은 숫자 표현으로 처리하면 단위 혼동과 플랫폼별 반올림 차이가 생긴다. 같은 root seed를 저장해도 순차 RNG stream의 호출 수가 달라지면 뒤의 판정이 이동한다.

## 결정

1. Stat scalar와 공식의 중간값은 C#에서 `decimal`로 계산한다. JavaScript Fireball은 같은 경계를 `BigInt` 기반 기약 유리수로 계산하고 JSON에는 canonical `numerator`/`denominator` 10진 문자열로 직렬화한다.
2. 확률·저항·계수처럼 ratio인 값은 10,000 basis points를 authoritative 표현으로 사용한다.
3. HP·Mana·Shield와 보고·commit되는 피해량은 safe-integer 범위의 정수로 저장한다. `exactRawDamage`는 정수 피해를 검증하는 정밀도 증거이므로 두 문자열로 저장하며 resource delta가 아니다.
4. scalar에서 commit 정수로 넘어갈 때만 versioned numeric policy로 반올림한다. 기준 정책 `integer-bps-half-away-from-zero-v1`은 양수·음수 midpoint를 모두 0에서 멀어지는 방향으로 처리한다.
5. 중간 보정 단계마다 authoritative 정수 반올림을 하지 않는다. `scalar × coefficientBps / 10_000`과 critical을 정확히 합성한다. raw 정수 투영과 완화 뒤 commit 정수는 각각 그 exact scalar에서 변환하며, 먼저 반올림한 raw 정수를 같은 primary 완화 입력으로 되먹이지 않는다. 이 Fireball의 Burn처럼 후속 정책이 committed raw 투영을 명시적으로 snapshot하는 경우는 별도 formula 경계다. JavaScript trace의 `scalingDamageProjection`·`formulaDamageProjection`은 사람이 비교하기 위한 진단 투영일 뿐 계산 입력·commit 값이 아니며, 나란히 exact fraction을 기록한다.
6. 확률은 `(rootSeed, correlationId, decisionName, targetId, algorithmVersion)`을 key로 하는 stateless sample로 구한다.
7. replay header에는 RNG algorithm, RNG key schema, numeric policy, definition과 formula version을 기록한다.
8. canonical JSON과 FNV-1a 64-bit hash는 reference fixture의 재현성 표식으로만 사용한다.

## 현재 실행 증거

- `IStatQuery`와 `StatModifier`의 scalar 저장은 C# `decimal`이다.
- [`ReferenceDerivedStatEvaluator.cs`](../csharp/GameSystemKnowledge.Reference/Systems/ReferenceDerivedStatEvaluator.cs)의 `StatScalar`와 `BasisPointRate`는 decimal scalar와 integer BPS lane을 타입으로 분리하고, `StatNumericLanes.ApplyRate`가 둘 사이의 계산 경계를 드러낸다.
- `DerivedStatGraph`/`ReferenceDerivedStatEvaluator`는 formula → Add → 합산 PercentAdd → 개별 More/Less → 결정적 Override → optional decimal clamp 순서를 실행한다.
- `StatNumericLanes.ToCommitInteger`만 `MidpointRounding.AwayFromZero`를 사용하며 양수·음수 midpoint와 `long` overflow를 [`AdvancedFoundationVerification.cs`](../csharp/GameSystemKnowledge.Reference.Verification/AdvancedFoundationVerification.cs)에서 검증한다.
- Combat의 coefficient·critical multiplier·resistance는 BPS다.
- Runtime Commit의 resource 값은 정수 `long`이며 non-negative invariant를 검사한다.
- JavaScript Runtime Lab은 formula·critical의 기약 유리수, safe-integer 투영, BPS 완화와 half-away-from-zero 경계를 실행 검증한다. `3/4` raw가 보고상 `1`이어도 50% 저항은 `1 × 50%`가 아니라 정확한 `3/8`을 반올림해 `0`이 되는 회귀 fixture를 C#과 공유한다.
- C# `StatModifier`의 PercentAdd·More·Less 입력은 호환용 compact decimal ratio다. 생성 경계와 여러 PercentAdd의 합성 경계는 검증하지만, 저장된 BPS definition을 이 입력으로 바꾸는 loader는 아직 없다.

## 고려했지만 채택하지 않은 대안

- 모든 값을 float로 통일: 엔진 연동은 쉽지만 replay와 midpoint 정책이 플랫폼 구현에 의존한다.
- 모든 Stat을 정수 fixed-point로 통일: authoritative 서버에는 적합할 수 있으나 학습 reference의 공식 가독성과 범용성이 떨어진다.
- 순차 RNG 하나를 공유: 한 분기의 roll 추가가 다른 분기의 결과를 이동시킨다.

## 결과와 적용 경계

수치의 단위와 반올림 위치가 타입·버전 경계로 드러난다. JavaScript의 `BigInt`는 내부 계산에만 쓰고 wire payload에는 문자열을 사용하므로 JSON 직렬화 실패와 `Number` 정밀도 손실을 피한다. `integer-bps-half-away-from-zero-v1`은 처음부터 exact intermediate와 primary 완화 전 raw 미되먹임을 규정했다. Runtime 4.0.0의 단계 반올림은 정책 변경 전 동작이 아니라 비준수 구현 결함이므로 numeric/formula version은 유지하고 Runtime 4.0.1, contract schema 2, replay format 2로 교정 결과와 새 proof shape를 격리한다. C# stat cache caller는 `StatEvaluationVersion.NumericPolicyVersion`을 명시하므로 실제 정책 변경이 이전 결과를 재사용하지 않는다. 의사결정 추가·삭제도 다른 확률 roll을 이동시키지 않는다. Unity adapter는 float·fixed-point·Burst 친화 표현을 사용할 수 있지만, engine-neutral 입력과 결과를 공통 fixture로 검증해야 하며 domain contract에 `UnityEngine` 타입을 넣지 않는다. FNV는 보안 hash가 아니므로 신뢰 경계의 서명에는 별도 cryptographic hash가 필요하다.

## 외부 근거

- Microsoft .NET [`Math.Round` / `MidpointRounding`](https://learn.microsoft.com/en-us/dotnet/api/system.math.round): midpoint mode를 overload 기본값에 맡기지 않고 `AwayFromZero`로 명시하는 근거.
- Unity [Unity에서의 .NET 개요](https://docs.unity3d.com/kr/current/Manual/dotnet-profile-support.html)와 [C# 컴파일러](https://docs.unity3d.com/kr/6000.0/Manual/csharp-compiler.html): Unity가 지원하는 API profile과 language level은 별도 호환성 경계라는 근거.
- Unity Burst [C# type support](https://docs.unity3d.com/ja/Packages/com.unity.burst%401.8/manual/csharp-type-support.html): `decimal`을 Burst 경로에 그대로 옮길 수 없으므로 공통 fixture를 만족하는 fixed-point adapter가 필요하다는 근거.
