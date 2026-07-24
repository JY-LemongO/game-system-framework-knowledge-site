# 학습 콘텐츠 4.5 달성 계획

## 분석 요약

- 기준선은 `3.4.0-reference` / `c58eee9fdbd4`이며 초기 독립 감사 종합은 3.5/5이다.
- 목표는 화면 구성이 아니라 정확성·명료성·이론 깊이·현업 적용성의 산술 평균 4.5 이상이다.
- 학습 및 실행 참조는 Unity에서 호출 가능한 엔진 비의존 C# 도메인 코어로 설계한다. Unity 물리·프레임·직렬화 API가 필요한 경계만 adapter 예외로 둔다.
- 사용자가 `계획 → 수정 → QA` 반복과 구현을 명시적으로 승인했으므로 각 cycle의 계획 산출 후 구현·독립 QA로 연속 진행한다.

## 완료 판정 게이트

| 축 | 최소 점수 | 완료 증거 |
|---|---:|---|
| 정확성 | 4.6/5 | 알려진 Major 0건, adversarial regression 전부 통과, 문서·C#·JS·도식의 같은 계약 일치 |
| 명료성 | 4.5/5 | 모든 예제가 Executable/Conceptual/Production policy 중 하나로 표시되고 축약·생략 조건이 명시됨 |
| 이론 깊이 | 4.5/5 | 수식·불변식·결정표·대안과 trade-off·1차 출처가 핵심 모듈마다 존재 |
| 현업 적용성 | 4.4/5 | 정상·경계·실패 정책, 결정론 tie-break, 저장·재시도·버전 경계, C# native reference가 연결됨 |
| 종합 | **4.5/5 이상** | 최초 감사와 같은 기준으로 독립 재감사한 네 축 평균 |

자동 테스트 통과만으로 완료를 주장하지 않는다. 독립 QA가 각 주장과 실행 증거를 다시 대조하고, 위 네 축을 재채점해야 한다.

## 영향 파일/시스템

### Cycle 1 — 정확성·계약 신뢰성

- `source/runtime/runtime-kernel.js`
- `assets/js/runtime-kernel.js`
- `source/runtime/runtime-kernel.d.ts`
- `source/runtime/tests/runtime-kernel.test.cjs`
- `source/csharp/GameSystemKnowledge.Reference/Runtime/Commit.cs`
- `source/csharp/GameSystemKnowledge.Reference/Contracts/{Stats,Effects,Skills,Combat,Status}.cs`
- `source/csharp/GameSystemKnowledge.Reference/Systems/FireballReferenceScenario.cs`
- `source/csharp/GameSystemKnowledge.Reference.Verification/Program.cs`
- `modules/{stat-system,effect-system,skill-action-system,combat-resolution-system,status-system,fireball-case-study,integration-map,runtime-reference,glossary}.html`
- `source/adr/ADR-003-bounded-reaction-queue.md`
- `source/adr/ADR-004-contextual-stat-cache.md`

### Cycle 2 — 이론·현업 완결성

- Core/Stat/Effect/Skill/Combat/Status 학습 HTML 전체
- 엔진 비의존 C# 값 타입·정책 evaluator·targeting/commit handoff·상태 merge/cleanse 정책
- 관련 계약 schema, ADR, Runtime Capstone assessor/fixture
- `source/diagrams/*.dot` 및 생성된 `assets/diagrams/*.{svg,png}`
- 모듈별 참고문헌과 공식 출처

### Release/QA 산출물

- `VERSION`, `package.json`, 페이지·런타임 version 표기
- `source/search-index.json`, `assets/js/search-index.js`, `MANIFEST.sha256`
- `QA_REPORT.md`, 본 계획서의 QA 절

## 수정 계획

### Cycle 1: P0 의미적 결함 제거

1. ReactionQueue가 dispatch 중 생성된 자식 깊이를 현재 부모 깊이에서 파생하도록 JS/C# 계약을 수정한다.
2. context fingerprint에 명시적 presence tag를 넣고, 캐시는 짧은 hash가 아니라 전체 canonical descriptor로 hit를 판정한다.
3. Fireball availability의 canonical 검사 순서를 고정하고 쿨다운을 실제 snapshot에서 검증한다.
4. status reaction이 live snapshot의 생존 조건을 재검증하고, 사망 대상은 명시적 rejected result로 종료한다.
5. reaction retry 문구를 per-reaction disposition/business idempotency 기준으로 교정하고 현재 memory reference의 한계를 명시한다.
6. 정상·경계·실패·interleaving regression을 JS와 C# verification에 추가한다.

### Cycle 1: public C# 계약과 증거 일치

1. 모든 public enum 입력, null collection element, 중복 operation/reaction ID, 모순 결과를 생성 경계에서 차단한다.
2. `default`로 불법 상태가 생기는 결과 struct를 valid-by-construction reference type 또는 검증 factory로 바꾼다.
3. Modifier operation별 단위와 허용 범위를 계약·표·테스트에 고정한다.
4. 실제 페이지 snippet을 source 계약과 동기화하거나 축약 예제로 명시한다.
5. `SkillCommitted`와 damage calculation trace의 실제 carrier를 문서 주장과 일치시킨다.

### Cycle 2: Core/Stat/Effect 완결성

1. canonical `TagSet`, optional non-skill Stat context, condition dependency/read-set 계약을 C# native 값 타입으로 제공한다.
2. derived stat DAG의 load-time cycle rejection, topological evaluation/invalidation, local modifier 적용 순서를 구현·설명한다.
3. decimal 학습 lane과 integer/BPS authoritative lane의 변환·반올림·overflow 경계를 고정한다.
4. engine-neutral targeting context와 total ordering을 제공하고 Unity physics 결과는 adapter에서 canonical candidate snapshot으로 변환하도록 한다.
5. `Effect spec → target resolution → resolved operation → outcome → CommitPlan composer` handoff를 타입과 실패 의미로 완성한다.

### Cycle 2: Skill/Combat/Status 완결성

1. validation, reservation, release revalidation, interruption, commit rejection 결과를 서로 다른 단계로 구분한다.
2. accuracy/evasion, flat·percent penetration, armor/resistance, vulnerability, barrier ordering, minimum damage와 반올림 위치를 하나의 완결 공식과 대안 비교로 제공한다.
3. Status reapply를 identity/stack/expiry/tick phase/potency/source 축의 truth table로 고정한다.
4. 면역·정화의 deterministic ordering, 제거 수, 보호 charge, duration resistance 반올림을 pure C# policy와 예제로 제공한다.
5. 정상·경계·실패 표를 Fireball 수직 슬라이스와 연결한다.

### Cycle 2: 평가·도식·근거

1. UML composition diamond 방향을 바로잡고 flowchart를 UML sequence로 오칭하지 않는다.
2. Capstone은 token rubric임을 정직하게 낮추거나 학습자 작성 pure resolver/plan을 실제 실행하는 평가로 승격한다.
3. ADR마다 고려 대안, 채택 이유, 손실, 재검토 조건을 추가한다.
4. 핵심 이론에 UML/.NET/Unity/Microsoft architecture 등 1차·공식 출처를 붙인다.
5. `net9.0` reference와 Unity adapter 경계를 각 관련 단원 가까이 표시하되, 도메인 학습 구현은 C# native를 유지한다.

## 사이드이펙트 표

| 영향 범위 | 테스트 케이스 | 위험도 | 억제책 |
|---|---|---:|---|
| Reaction ordering/depth | root, child, grandchild, forged same-depth child, maxDepth=0 | 높음 | 부모 기반 depth 파생과 JS/C# 동형 테스트 |
| Cache key/serialization | missing, explicit sentinel-like object, property order, LRU, forced hash collision | 높음 | presence tag + canonical descriptor equality |
| Skill availability | ready, same-tick recast, multiple failures, stale snapshot | 높음 | canonical precedence와 no-mutation assertion |
| Status reaction | alive, killed-before-dispatch, version conflict | 높음 | live precondition과 rejected result |
| Public C# API | undefined enum, default/null, duplicate IDs, numeric boundaries | 높음 | 생성자/factory guard와 verification |
| Golden replay/trace | event fields와 trace stage 추가 | 중간 | fixture 재생성 전 의미 diff 확인 |
| Diagram regeneration | DOT 의미와 SVG/PNG 동기화 | 중간 | `diagrams:check`, 갤러리 명칭 검증 |
| Search/manifest/version | HTML 대량 수정 | 낮음 | 공식 생성 스크립트와 release integrity |
| Unity 소비 경계 | `net9.0`, records, decimal, System.Numerics adapter | 중간 | native domain contract와 Unity adapter 예외를 별도 표기 |

## 미해결 질문

- 사용자 결정으로 해결됨: 학습 구현은 C# native가 기본이며 Unity 직접 의존은 필수 adapter 경계에만 허용한다.
- 학습 reference이므로 public C# breaking change를 허용한다. 불법 상태를 보존하는 호환 shim은 만들지 않으며 다음 공개 기준은 `4.0.0-reference`로 올린다.
- 첫 Effect 실행 범위는 Self, ExplicitTarget, adapter가 제공한 candidate snapshot까지다. Area/Arc/Chain은 같은 결정론 계약을 설명하되 구현 전에는 Conceptual로 표시한다.
- 수치 정책은 decimal Stat scalar, 정수 BPS 비율, commit 경계의 정수 결과로 고정하고 numeric/schema version을 함께 갱신한다.
- 나머지 정책 선택은 계획의 명시적 공식·truth table을 기준으로 고정하고 ADR에 대안과 재검토 조건을 남긴다.

## 보고서 경로

`docs/agent-reports/learning_content_45_Plan.md`

## 실행 기록

### Cycle 1 · 계약 정합성과 실패 원자성

- Reaction depth를 caller 입력이 아니라 활성 부모에서 파생하도록 C#·JavaScript queue를 보강했다.
- `SkillCommitted`와 JavaScript event fact를 실제 commit 전후 상태에 대조하고, 실패 시 state·outbox·idempotency가 모두 보존되는 회귀를 추가했다.
- canonical `Tag`/`TagSet`, optional `StatContext.SkillId`, enum/null/duplicate guard를 공통 계약으로 고정했다.
- Skill admission, live-target status reaction, bounded retry 설명을 실행 코드와 문서에 연결했다.

### Cycle 2 · 누락된 이론과 실행 정책

- Derived Stat DAG, 전체 context/version cache key, hash collision 안전성, modifier→clamp 순서를 C# 참조와 검증으로 추가했다.
- target-independent Effect specification, canonical target snapshot, resolved operation, 원자적 fragment composition을 구현했다.
- full combat policy의 명중·치명타·관통·방어·저항·barrier·overkill·minimum damage 경계를 구현했다.
- Status identity/source scope, stack/refresh/replace/independent, duration resistance, deterministic cleanse 정책을 구현했다.
- 독립 QA 결과는 **3.9/5, Major 5**였다. 반복 Fireball의 고정 identity, non-hit planner 예외, compact/full 반올림 설명 불일치, raw damage tags, `DamageCommitted` 사실성 부족을 차단 결함으로 판정했다.

### Cycle 3 · 독립 QA 결함 해소

- `SkillRequest.CommandId`에서 bundle/event/reaction/idempotency/order/source/cooldown을 실행별로 파생하고, 서로 다른 두 cast가 연속 commit되는 회귀를 추가했다.
- Miss도 비용·쿨다운과 zero-damage fact를 원자 commit하되 대상 mutation/version과 hit-only Burn은 만들지 않도록 고정했다.
- compact resolver도 decimal 중간값을 보존하고 최종 계산 경계에서만 반올림하며, `DamageRequest`는 canonical `TagSet`을 사용한다.
- `DamageCommitted`가 skill-source command ownership, HP/shield 실제 감소량, zero/positive write의 version 의미를 commit 전 검증하도록 강화했다.
- C# event와 JavaScript correlation/causation envelope의 차이, executable/conceptual/production 경계를 학습 문서에 명시했다.
- 자동 증거: C# **620 assertions**, JavaScript runtime **74/74**, capstone **18/18**, browser smoke **443/443**, 정적 validator 오류·경고 0.
- 최종 완료 조건은 새 독립 감사의 **Major 0, Overall 4.5/5 이상**이며, 감사 전에는 완료로 표시하지 않는다.

### Cycle 4 · 4.5 게이트 독립 감사와 교정

- 세 영역을 분리해 새 독립 감사를 수행했으며, 1차 재채점은 모두 **4.3/5**로 게이트에 미달했다.
- Gameplay 감사의 Major였던 Fireball 단계별 정수 BPS 반올림을 제거했다. C#은 `decimal`, JavaScript는 `BigInt` 기약 유리수로 formula·critical 중간값을 보존하고, raw 표시값과 완화 뒤 commit 값을 각각 exact scalar에서 `AwayFromZero` 변환한다.
- Foundations 감사의 Major였던 Effect 대상 자격 판정 소유권 모순을 제거했다. 공간 adapter가 eligibility와 정수 metric을 확정하고, domain resolver는 immutable candidate snapshot의 구조·중복·total order·MaxTargets만 책임진다.
- Overall 감사의 Major였던 Diagram Gallery 증거 혼재를 모든 카드의 `conceptual-mixed` 기본 범위로 명시하고, 각 카드의 effective evidence scope를 validator가 강제하도록 했다.
- Burn tick의 실제 JavaScript 경로와 목표 product Effect 구조를 분리하고, C#에는 status tick executor가 없음을 명시했다.
- event dispatch 소유권, JavaScript `DamageMissed`와 C# zero-damage `DamageCommitted(Outcome=Miss)`의 taxonomy 차이, RandomStream 재현 조건, `SkillRequest.CommandId`, 실제 context fingerprint 범위를 교정했다.
- 독립 재검토에서 드러난 `3/4` raw의 조기 반올림 회귀를 C#·JavaScript 모두 `50% 저항 → 3/8 → 0` fixture로 고정했다. 피해 fact에는 canonical `exactRawDamage`를 보존하고, periodic fact는 StatusInstance의 정수 raw tick과 정확히 같은 `n/1`만 허용한다.
- Fireball command와 resolver input의 actor·tick·data version·target·skill을 RNG 전에 결속하고, reaction은 성공한 `DamageCommitted`의 동결된 Burn payload만 소비하게 했다.
- JavaScript outbox taxonomy를 닫고 Skill/Damage/Status/Defeat fact를 command·pre-state·operation·post-state에 대조했다. 이 validator는 formula/RNG를 다시 실행하지 않는다는 보장 한계도 문서에 명시했다.
- coefficient와 critical multiplier의 공통 BPS 범위를 C# compact/full policy와 JavaScript에서 동일하게 닫았고, 9,999/100,001 실패 경계를 추가했다.
- 사이트 release edition `4.0.0-reference`와 embedded runtime semantic version `4.0.1-reference`을 독립 버전 축으로 명시했다.
- 최신 자동 증거는 C# **623 assertions**, JavaScript runtime **86/86**, capstone **18/18**, TypeScript strict consumer **0 diagnostics**, browser smoke **443/443**다. 정적 validator는 HTML 12개·검색 항목 333개·DOT/SVG/PNG 각 34개·계약 7개·ADR 6개를 검사해 오류·경고 0으로 통과했다.
- release edition은 `4.0.0-reference`, embedded runtime은 `4.0.1-reference`, command/event/commit contract와 replay fixture는 v2로 정렬했다. 공개 Fireball command 예제도 v2이며 validator가 예제 marker·명령·replay header·JSON Schema const를 서로 대조한다.
- 최종 독립 probe에서 위조한 apply-status reaction이 committed 원인 event 없이 적용되던 Major를 발견했다. handler가 같은 store outbox의 유일한 `DamageCommitted`를 찾고 event에서 reaction 전체를 재파생해 canonical 비교하도록 수정했으며, 존재하지 않는 원인·잘못된 event type·ID/정렬/budget/모든 Burn payload 변조가 state와 outbox를 바꾸지 않는 회귀를 추가했다. C# projection helper는 receipt capability가 아니라 trusted handoff라는 남은 제품 경계도 공개 문서에 명시했다.
- 후속 합성 감사에서 event helper의 고정 depth=1과 `ReactionQueue`의 `parent.depth + 1` 소유권이 충돌하는 Major를 실행 재현했다. source binding은 event-owned 필드만 비교하고 causal depth는 queue가 파생·상한 검증하도록 분리했으며, parent depth 1에서 생성된 apply-status가 depth 2로 실행·commit되는 nested 회귀를 추가했다.
- 추가 상한 probe에서 depth를 완전히 제외하면 최초 depth 1을 0으로 낮춰 `maxDepth=0`을 우회할 수 있음을 재현했다. handler는 event-derived 최소 depth 1을 하한으로 강제하되 queue가 더 크게 파생한 값은 허용한다. 또한 module-private active-dispatch capability를 요구해 `ReactionQueue.drain` 밖의 직접 호출이나 clone으로 wave budget을 건너뛰지 못하게 했고, depth 0·직접 호출·nested depth 2 회귀를 함께 고정했다.
- 생성물과 manifest를 동기화하고 canonical 전체 QA를 통과한 뒤 같은 독립 감사자들에게 현재 트리를 다시 채점한다. 완료 게이트는 여전히 **Major 0, Overall 4.5/5 이상**이다.

### 수정 세션 내 게이트 기록

- Foundations: Critical 0 / Major 0 / Minor 0, 정확성 4.9·명료성 4.9·이론 깊이 4.9·현업 적용성 4.8, **Overall 4.9/5**.
- Gameplay: Critical 0 / Major 0 / Minor 0, 정확성 4.9·명료성 4.9·이론 깊이 4.9·현업 적용성 4.8, **Overall 4.9/5**.
- Overall: Critical 0 / Major 0 / Minor 0, 정확성 4.9·명료성 4.8·이론 깊이 4.9·현업 적용성 4.8, **Overall 4.9/5**.
- 세 감사자는 exact numeric lane, command/event truth, reaction source·depth·dispatch 권한, C#/JavaScript 증거 범위, trusted restore와 production adapter 경계를 최신 코드·문서·회귀에 대조했다.
- 당시 판정은 **Major 0, Overall 4.9/5, 게이트 PASS**였다. 다만 이 점수는 수정 목표를 공유한 감사자들이 마지막 계약 결함을 반복 검증한 결과로, 전체 학습 콘텐츠를 고정 rubric으로 다시 채점한 독립 품질 점수는 아니었다.

### 후속 보수 재평가 · 2026-07-24

- 전체 학습 콘텐츠를 정확성·이해 용이성·이론 깊이·현업 적용성 기준으로 다시 표본 감사했다.
- 정확성 **4.6**, 이해 용이성 **4.5**, 이론 깊이 **4.5**, 현업 적용성 **4.0**, 산술 평균 **4.4/5**로 정정한다.
- 실행 계약과 회귀 검증은 강하며 뚜렷한 치명 오류는 발견하지 못했다. 다만 QA 통과는 학습 품질 전체를 직접 증명하지 않고, `Minor 0`도 전수 증거 없이 단정할 수 없다.
- durable DB/outbox, network reconciliation, authoritative server, multi-target product path, Unity adapter, 학습자 구현을 실행하는 전이 평가가 범위 밖이거나 후속 단계이므로 현업 적용성과 종합 점수를 감점했다.
- 따라서 **자동·계약 QA 게이트는 PASS**, 전체 학습 콘텐츠의 보수적 품질 평가는 **4.4/5**를 최종 기록으로 사용한다.
