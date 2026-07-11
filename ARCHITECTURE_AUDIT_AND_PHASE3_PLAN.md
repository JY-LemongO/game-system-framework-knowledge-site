# Game System Framework 지식 사이트
## 아키텍처 타당성 검토 · UX/UI 전면 개편 · Phase 3 구현 계획

> **역사적 기준선 안내 — Release 3.2**
> 이 문서는 실행 코드가 추가되기 전 원본 패키지와 UX/UI 개편본을 평가한 audit 기록이다. 당시 74/100은 pre-implementation baseline이며, 현재 구현 상태는 `PHASE3_REFERENCE_IMPLEMENTATION.md`, 남은 작업은 `PHASE3_IMPLEMENTATION_PLAN.md`, 검증 결과는 `QA_REPORT.md`를 기준으로 한다.


- 검토 대상: `Game_System_Framework_Knowledge_Site_Pro_Package_phase2_pre_phase3_checked(3).zip`
- 산출물: 오프라인 정적 웹사이트 전체 개편본
- 검토 기준: 책임 경계, 결정론, 상태 변경 소유권, 확장성, 테스트 가능성, 정보 구조, 접근성, 반응형 사용성
- 종합 판단: **개념 방향은 타당하지만, 실제 런타임 구현 전에는 핵심 계약을 더 고정해야 한다.**
- 준비도 점수: **74/100**

> 74점은 표준 인증 점수가 아니라, 현재 문서가 “개념 설명”에서 “구현 가능한 계약”으로 얼마나 이동했는지를 판단하기 위한 내부 휴리스틱이다. 패키지에는 실제 게임 런타임 소스와 성능 측정 데이터가 포함되어 있지 않으므로, 처리량·메모리·네트워크 예측 정확성까지 검증한 점수는 아니다.

---

## 1. 검토 범위와 방법

압축파일을 해제한 뒤 다음 항목을 확인했다.

1. 15개 HTML 페이지의 정보 구조, 링크, 제목 계층, 용어 일관성
2. Core, Stat, Effect, Skill, Combat, Status 문서의 책임과 호출 관계
3. Fireball 수직 슬라이스가 전체 시스템을 실제로 관통하는지 여부
4. Definition/Runtime, Request/Result, Source 추적, DebugTrace 설계의 일관성
5. 결정론, 캐시, 이벤트, 상태 tick, 저장/버전 정책의 구현 가능성
6. 데스크톱·모바일 레이아웃과 키보드 상호작용
7. 정적 오프라인 환경에서 검색, 모달, 다이어그램, 테마가 실제로 동작하는지 여부

자동 검증은 Chromium 기준으로 수행했다. Safari와 Firefox의 수동 회귀 테스트는 별도 배포 게이트로 남겨 두었다.

---

## 2. 이 콘텐츠가 말하고자 하는 핵심 의도

이 패키지는 게임 하나의 피해 공식을 설명하는 문서가 아니다. 여러 장르에서 재사용할 수 있는 **게임플레이 시스템의 책임 경계와 공통 계약**을 설명하는 아키텍처 지식 베이스다.

핵심 메시지는 다음과 같다.

- **Core**는 Entity, Source, Tag, Time, Random, Trace 같은 공통 언어를 제공한다.
- **Stat**은 수치와 Modifier 계산만 소유한다.
- **Effect**는 “어떤 결과를 요청할 것인가”를 데이터와 실행 문맥으로 표현한다.
- **Skill**은 입력, 비용, 쿨다운, 타임라인, 취소와 같은 행동 수명주기를 조율한다.
- **Combat**은 명중, 치명타, 방어, 저항, 보호막 등 피해 해석을 담당한다.
- **Status**는 지속시간, 중첩, tick, 해제와 같은 지속 상태를 관리한다.
- **Fireball**은 이 경계를 한 번에 검증하는 수직 슬라이스다.

원본의 가장 중요한 철학은 **Definition과 Runtime을 분리하고, 모든 변경 원천을 SourceId/SourceRef로 추적하며, 시스템 사이를 직접 참조가 아니라 Request/Result 계약으로 연결하는 것**이다.

---

## 3. 타당성 검토 결과

### 3.1 전체 방향은 타당하다

Ability가 비용·사용 조건·다단계 실행을 소유하고, Effect가 Attribute를 변경하며, Attribute가 숫자를 보관·계산하는 분리는 이미 대규모 상용 엔진의 Gameplay Ability System에서도 확인되는 방향이다. Unreal Engine 공식 문서도 Gameplay Ability, Gameplay Effect, Attribute를 서로 다른 역할로 설명하며, 정적 Effect asset과 런타임 spec을 분리한다.[^epic-gas][^epic-ability][^epic-effect]

따라서 다음 설계는 충분히 설득력이 있다.

- Definition / Runtime state 분리
- Ability 또는 Skill과 Effect의 분리
- Effect와 Attribute/Stat의 분리
- Request / Result 기반 계산
- Source provenance와 DebugTrace
- Fireball 같은 작은 수직 슬라이스 우선 구현

### 3.2 아직 “구현 계약”으로 부족한 부분이 있다

문서가 개념적으로 옳더라도, 아래 항목을 고정하지 않으면 실제 코드에서 서로 다른 해석이 생긴다.

| ID | 중요도 | 발견 내용 | 실제 위험 | 수정 방향 |
|---|---:|---|---|---|
| A-01 | Critical | `Core → Stat → Effect → Skill → Combat → Status`가 학습 순서·호출 순서·의존성처럼 함께 보임 | 잘못된 모듈 참조와 순환 의존 | 학습 순서, 런타임 흐름, 계약 의존성을 별도 뷰로 분리 |
| A-02 | Critical | DamageResult 계산 이후 HP/Shield를 누가 차감하는지 두 후보가 존재 | 중복 차감, 이벤트 이중 발행 | `DamageCommitService` 한 곳만 상태 변경 권한 보유 |
| A-03 | Critical | SkillRuntime에 개별 시전 인스턴스가 없음 | 동시 시전, 채널링, 취소, 예측 처리 불가 | 영속 SkillRuntime과 일회성 `SkillExecution` 분리 |
| A-04 | Critical | 같은 seed면 결정론적이라는 표현이 과도함 | 리플레이가 환경에 따라 달라짐 | 입력/월드 스냅샷, 버전, 정렬, clock, 반올림, 반응 순서를 함께 고정 |
| A-05 | Critical | EventBus는 관찰용이라고 하면서 흡혈·반사·장비 발동이 이벤트로 상태를 변경 | 재진입, 무한 루프, 비결정적 순서 | Observation Event와 상태 변경용 `ReactionQueue` 분리 |
| A-06 | High | StatInstance가 최종값 하나를 캐시하지만 조건부 Modifier는 target/distance/tag에 의존 | 다른 대상의 계산 결과를 재사용 | 무조건부 레이어만 기본 캐시, 조건부는 context fingerprint 기준 |
| A-07 | High | 같은 priority의 Modifier, 여러 Override, More/Less 결합 규칙이 불명확 | 플랫폼·등록 순서별 결과 차이 | 안정 정렬 키와 operation별 결합 법칙 명시 |
| A-08 | High | Effect의 일반적인 rollback 가능성이 암시됨 | spawn, move, event는 완전 rollback이 어려움 | Validate → Plan → Commit → Publish, 가역 명령만 원자 커밋 |
| A-09 | High | Skill TargetingSpec과 Effect TargetSelector가 중복처럼 보임 | 타겟 검증 책임 충돌 | Skill은 플레이어 의도 검증, Effect는 release/hit 시 실제 영향 대상 해석 |
| A-10 | High | Block이 Miss와 같은 단계로 해석될 여지가 있음 | 방어 규칙 확장 시 분기 폭증 | Eligibility → Hit/Evasion → Guard/Block → Resolve → Commit → Aftermath |
| A-11 | High | Status tick과 expire가 같은 시각일 때 순서가 없음 | 마지막 tick 유실 또는 중복 | clock domain, immediate tick, catch-up, tick/expire 동률 규칙 명시 |
| A-12 | High | Snapshot에 source 객체 참조를 둘 가능성과 save 버전 규칙 부족 | 대상 소멸 후 참조 오류, 저장 호환성 붕괴 | 불변 계수와 definition/formula/schema version을 저장하고 migration 제공 |
| A-13 | Medium | 비용·대상 검증이 요청 시점에만 수행될 수 있음 | 선딜 중 자원/대상 변경 후 잘못된 실행 | Release 직전에 비용·대상·상태 재검증 |
| A-14 | Medium | 문서 패키지 Phase와 구현 단계 Phase가 같은 이름을 사용 | 일정·범위 커뮤니케이션 혼선 | 사이트 배포는 Release, 기술 구현 단계는 Milestone으로 분리 |

---

## 4. 핵심 문제별 상세 판단

### 4.1 하나의 화살표로는 아키텍처를 설명할 수 없다

원본 선형 표기는 **추천 학습 순서**로는 사용할 수 있다. 하지만 실제 Fireball 실행은 대체로 다음과 같다.

```text
Input / AI
  → SkillExecution
  → Effect Plan
  → Combat Resolve 또는 Status Apply
  → Stat / Resource Commit
  → Observation Event + DebugTrace
```

반면 코드 계약의 읽기 방향은 다음처럼 다르다.

```text
Skill   → IEffectExecutor
Effect  → IStatQuery, ICombatResolver, IStatusService
Combat  → IStatQuery, IDamageCommitService
Status  → IStatModifierPort, IEffectExecutor
모든 시스템 → Core contracts
```

이번 개편에서는 이를 **Architecture Lens**의 세 탭으로 분리했다.

### 4.2 피해 계산과 상태 변경을 분리해야 한다

`CombatResolver`는 immutable한 `DamageResult`를 계산해야 한다. 실제 Shield와 HP 차감은 단일 커밋 서비스가 정확히 한 번만 수행해야 한다.

권장 계약:

```text
DamageRequest
  → CombatResolver.resolve()
  → DamageResult (immutable)
  → DamageCommitService.commit(result, idempotencyKey)
  → DamageCommitted
  → ReactionQueue
  → Observation Event / CombatLog
```

필수 조건:

- 같은 idempotency key는 두 번 적용되지 않는다.
- Shield 흡수와 HP 감소는 하나의 commit 결과에 기록한다.
- 계산 이벤트와 커밋 이벤트 이름을 구분한다.
- 대상이 commit 전에 사망·소멸했을 때의 정책을 고정한다.
- `DamageResult`는 계산 근거와 formula version을 가진다.

### 4.3 결정론의 범위는 seed보다 넓다

결정론적 재생에 필요한 최소 envelope:

- ExecutionId, correlationId, causationId
- request payload와 관련 world snapshot
- DefinitionVersion, FormulaVersion, SchemaVersion
- 대상 후보의 안정 정렬 키
- RandomStream seed와 소비 순서
- fixed-step 또는 turn clock domain
- 부동소수점/정수 스케일과 반올림 지점
- ReactionQueue priority와 동률 규칙
- 외부 I/O나 비동기 결과의 기록 또는 차단

“같은 seed”는 이 조건 중 하나일 뿐이다.

### 4.4 EventBus와 ReactionQueue를 분리해야 한다

세 종류를 분리한다.

1. **Rule step**: 결과를 결정하는 핵심 로직. 명시적 파이프라인 안에서 동기적으로 실행한다.
2. **Reaction**: 흡혈, 반사, TriggeredEffect처럼 새 gameplay command를 만드는 후속 처리. 정렬된 queue에서 실행한다.
3. **Observation**: UI, 사운드, 분석, 로그처럼 결과를 변경하지 않는 알림이다.

ReactionQueue에 필요한 메타데이터:

```text
reactionId
executionId
correlationId
causationId
priority
stableOrderKey
idempotencyKey
depth
sourceRef
```

깊이 제한만 두는 것으로는 충분하지 않다. 동일 원인·동일 대상·동일 반응을 식별하는 idempotency 정책과, 허용된 순환 규칙이 필요하다.

### 4.5 조건부 Stat 캐시는 별도의 의미론이 필요하다

다음 Modifier는 owner 하나만으로 값을 결정할 수 없다.

```text
화상 상태의 대상에게 치명타 확률 +10%
거리가 5m 이상이면 투사체 피해 +20%
fire 태그 스킬 사용 시 mana cost -15%
```

안전한 기본 전략:

- Base, Flat, 항상 활성인 Modifier까지 owner 단위로 캐시
- 대상·거리·태그가 필요한 항목은 query layer에서 평가
- 빈도가 높은 context만 `ContextFingerprint`로 제한 캐시
- context key에 mutable object pointer를 넣지 않음
- cache invalidation 원인을 DebugTrace에 기록

### 4.6 Status tick은 시간 서비스의 부가 기능이 아니라 계약이다

다음 항목을 데이터와 테스트로 고정해야 한다.

- clock domain: fixed simulation, real time, turn
- apply 즉시 tick 여부
- tick과 expire가 같은 timestamp일 때 우선순위
- pause와 time scale 적용 여부
- 프레임 지연 뒤 catch-up tick의 최대 개수
- stack별 독립 tick인지, 통합 tick인지
- source 소멸 뒤 snapshot 지속 여부
- dispel과 scheduled tick이 같은 순서에 있을 때 처리

---

## 5. 원본 UX/UI 검토

원본은 정보량이 많고 구조가 안정적인 정적 문서였지만, 다음 제약이 있었다.

- 데스크톱에서 왼쪽 문서 목록, 본문, 오른쪽 레일이 동시에 상주해 본문 폭이 좁고 시각 밀도가 높았다.
- 검색이 페이지 메타데이터 중심이라 본문 섹션과 계약 이름을 직접 찾기 어려웠다.
- 선형 시스템 지도 때문에 학습 순서와 호출 순서가 혼동될 수 있었다.
- 모바일에서 브랜드와 상단 탐색이 압축되고, 긴 카드가 계속 세로로 누적됐다.
- 커스텀 모달의 포커스 복귀·키보드 탐색·대화상자 의미가 충분히 명시되지 않았다.
- 다이어그램 확대 요소가 키보드 조작 대상으로 보장되지 않았다.
- skip link와 heading deep link가 없었다.
- 31개 다이어그램 갤러리를 한 번에 탐색할 때 정보 밀도가 높았다.
- 페이지 제목, 로드맵의 Phase, 패키지 Phase가 섞여 범위 이름이 모호했다.

---

## 6. 새 UX/UI의 설계 원칙

이번 개편은 특정 서비스의 외형을 복제하지 않고, 최근 개발자 도구와 문서 제품에서 검증된 상호작용 원리를 조합했다.

- Linear의 최근 UI 개편이 강조한 시각적 노이즈 감소, 정렬, 계층, 탐색 밀도 개선[^linear]
- Vercel Geist의 개발자 도구 중심 고대비 색상, 그리드, 일관된 구성 요소[^geist]
- Stripe quickstart의 단계적 설명과 상호작용 가능한 코드 중심 문서 패턴[^stripe]
- shadcn/ui가 보여 주는 dialog 기반 command palette 구성[^shadcn]
- 상태 변화의 원인과 방향을 알려 주는 CSS transition 원칙과 reduced-motion 대응[^webdev-transition]
- WCAG 2.2의 perceivable, operable, understandable, robust 원칙[^wcag]

### 적용한 디자인 시스템

- 화면 상단: glass topbar와 핵심 시스템 dock
- 본문: 넓은 editorial canvas와 문맥형 우측 목차
- 홈: bento형 시스템 카드와 대형 타이포그래피
- 색상: 시스템별 accent를 유지하되 배경·경계·텍스트 대비를 토큰화
- 글꼴: 외부 폰트 없이 system font stack 사용
- 모션: 짧은 상태 transition, `prefers-reduced-motion` 시 최소화
- 테마: system / light / dark 세 단계

---

## 7. 실제 반영한 UX/UI 기능

### 탐색

- 영구 왼쪽 사이드바를 제거하고 **System Dock**으로 핵심 시스템만 상시 노출
- 전체 문서는 native `<dialog>` 기반 drawer에서 탐색
- `⌘/Ctrl + K` 또는 `/`로 여는 전역 command palette
- 페이지 15개와 본문 섹션을 합친 **302개 검색 엔트리**
- 현재 페이지의 섹션을 추적하는 sticky contextual TOC
- 모바일 4개 항목 하단 탐색: Atlas, Map, Search, Docs

### 이해 지원

- 학습 순서 / 런타임 실행 / 코드 계약을 전환하는 **Architecture Lens**
- 본문 예상 읽기 시간과 스크롤 진행률
- 각 H2/H3의 deep-link 복사
- 코드 블록 language label과 복사 fallback
- Stat 계산기 유지 및 접근 가능한 label/output 적용

### 다이어그램

- 31개 다이어그램 키워드 필터
- 키보드 Enter/Space로 확대 가능
- native dialog 포커스 관리
- 확대/축소, reset, wheel zoom, drag pan, 원본 열기
- 이미지 lazy loading과 print 전 eager 전환

### 접근성

- 본문 skip link
- 한 페이지당 하나의 `<main>`과 별도 `<article>`
- native dialog의 Escape 닫기와 opener focus 복귀
- tab/listbox/option ARIA 상태
- 키보드 방향키 탐색
- focus-visible 스타일
- reduced-motion, forced-colors, print 스타일
- 모바일 390px 기준 수평 overflow 제거

---

## 8. 콘텐츠에 반영한 수정

- 홈의 단일 선형 지도를 세 관점 Architecture Lens로 대체
- Core 문서에 결정론 envelope와 Event/Reaction 분리 추가
- Stat 문서에 Modifier 동률 규칙과 contextual cache 의미론 추가
- Effect 문서에 Skill targeting과 Effect target resolution의 경계 추가
- Effect 실행을 Validate → Plan → Commit → Publish로 수정
- Skill 문서에 일회성 `SkillExecution`과 release-time 재검증 추가
- Combat 문서에 single commit owner와 계산/커밋/후속 단계 추가
- Status 문서에 instance key, tick/expire 순서, snapshot 주의 추가
- 통합 구조에 ReactionQueue와 architecture perspective 추가
- Fireball 예제에 버전·정렬·clock을 포함한 재현 조건과 commit 순서 추가
- 구현 로드맵의 기술 단계를 Phase에서 **Milestone**으로 변경
- Equipment보다 먼저 Runtime Contract Hardening Gate를 통과하도록 순서 변경
- 새 `Phase 3 Readiness` 페이지에 6개 gate와 수용 기준 추가

---

## 9. 다음 구현 계획

### P3-A. Contract Types

**목표:** 시스템이 공유하는 실행 식별자와 버전을 먼저 고정한다.

구현 타입:

```text
ExecutionId
CorrelationId
CausationId
IdempotencyKey
DefinitionVersion
FormulaVersion
SchemaVersion
ContextFingerprint
ClockDomain
StableOrderKey
```

산출물:

- Core package의 value object
- 직렬화 형식과 equality 규칙
- DebugTrace 공통 header
- request/result schema contract test

수용 기준:

- 모든 Skill, Effect, Damage, Status 실행이 ExecutionId를 가진다.
- 후속 반응은 causation chain으로 원인을 역추적할 수 있다.
- 로그 하나로 적용된 definition/formula version을 확인할 수 있다.

### P3-B. Commit Pipeline

**목표:** 상태 변경의 단일 소유권과 exactly-once 적용을 보장한다.

구현 순서:

1. immutable DamageRequest/Result
2. `DamageCommitService`
3. Shield/HP 원자 변경
4. idempotency repository
5. Calculated/Committed/After 이벤트 분리
6. commit failure와 target invalid 정책

필수 테스트:

- 동일 result 두 번 commit
- Shield와 HP가 함께 감소하는 경우
- commit 직전 대상 사망
- 피해 0, 면역, 완전 흡수
- 이벤트 구독자가 예외를 던지는 경우에도 상태 중복 변경이 없는지

### P3-C. Reaction Queue

**목표:** 흡혈, 반사, 장비 발동을 결정론적으로 처리한다.

구현 규칙:

- observation event와 reaction command 분리
- `(priority, stableOrderKey, reactionId)` 정렬
- depth와 budget 제한
- idempotency key 중복 제거
- 동일 execution 내 큐 drain 시점 고정
- 반응이 새 execution을 만들 때 parent/causation 연결

필수 테스트:

- 흡혈 + 반사 동시 발생
- 반사끼리 순환
- 같은 장비 trigger 중복 등록
- 등록 순서를 바꿔도 결과가 같은지

### P3-D. Cache & Tick Semantics

**목표:** 조건부 Stat과 Status 시간을 명확히 한다.

Stat:

- base cache와 contextual query 분리
- ContextFingerprint 정규화
- stable Modifier ordering
- dirty reason 기록

Status:

- StatusInstanceKey와 stacking key
- clock domain별 scheduler
- tick/expire 동률 규칙
- catch-up 상한
- immediate tick 정책
- source snapshot/version

### P3-E. Fireball Regression Slice

**목표:** 핵심 계약을 한 사례로 잠근다.

고정 fixture:

- caster/target snapshot
- Fireball/Burn definition version
- damage formula version
- seed와 random consumption count
- target ordering
- fixed clock timeline
- expected DamageResult, StatusInstance, EventLog, DebugTrace

회귀 시나리오:

1. 기본 명중
2. 빗나감
3. 치명타
4. 보호막 일부/전체 흡수
5. fire 면역
6. release 직전 대상 소멸
7. 시전 취소와 비용 환불
8. Burn 마지막 tick과 expire 동시 발생
9. 흡혈·반사 ReactionQueue
10. 저장 후 재개 또는 replay

### P3-F. Equipment MVP

앞의 gate를 통과한 뒤 구현한다.

최소 범위:

- ItemDefinition / ItemInstance
- EquipmentSlot
- Affix → StatModifier
- granted skill
- TriggeredEffect → ReactionQueue
- equip/unequip idempotency
- sourceRef와 save schema

Equipment를 먼저 만들면 EventBus, SourceId, Modifier removal, TriggeredEffect의 미정 계약이 한꺼번에 확산되므로 순서를 뒤로 미뤘다.

---

## 10. Phase 3 진입 수용 기준

다음 항목을 모두 통과한 뒤 Equipment/Progression 확장에 들어간다.

- [ ] 하나의 실행을 모든 시스템에서 ExecutionId로 추적할 수 있다.
- [ ] 같은 input snapshot, version, seed, clock으로 동일 trace가 생성된다.
- [ ] HP와 Shield 변경자는 DamageCommitService 하나뿐이다.
- [ ] 같은 idempotency key를 재전송해도 상태가 한 번만 변한다.
- [ ] Observation subscriber는 전투 결과를 직접 변경하지 않는다.
- [ ] 모든 gameplay reaction은 순서가 고정된 ReactionQueue를 통과한다.
- [ ] 조건부 Stat 질의가 다른 target의 cache를 오염시키지 않는다.
- [ ] 같은 priority의 Modifier 등록 순서를 바꿔도 결과가 같다.
- [ ] Status tick/expire 동률 테스트가 플랫폼과 프레임률에 무관하게 통과한다.
- [ ] Fireball 10개 회귀 시나리오가 golden trace와 일치한다.
- [ ] save data가 schema/definition/formula version을 보유한다.
- [ ] 390px 모바일과 키보드-only 탐색에서 핵심 기능을 사용할 수 있다.

---

## 11. 이번 단계에서 보류 가능한 항목

핵심 계약과 직접 관련이 없는 다음 항목은 후순위로 둘 수 있다.

- 완전한 네트워크 prediction/rollback
- 시각적 노드 에디터
- MMO 규모의 분산 전투 처리
- 모든 Effect operation의 범용 transaction rollback
- 복잡한 Talent tree 편집기
- 다국어 번역 시스템
- 모든 브라우저의 고급 view-transition 최적화

단, 향후 멀티플레이가 목표라면 ExecutionId, snapshot, deterministic ordering, idempotency는 지금부터 포함해야 한다.

---

## 12. QA 결과

### 정적 구조 검사

- 문서 페이지: 15
- 검색 인덱스: 302 entries
- 다이어그램: 31
- 깨진 내부 링크/이미지: 0
- 중복 HTML id: 0
- 페이지별 H1: 각 1개
- 페이지별 main landmark: 각 1개
- 외부 CDN/필수 네트워크 요청: 없음

### 자동 상호작용 검사

Chromium에서 27개 항목을 검사했고 모두 통과했다.

- 읽기 시간 계산
- heading anchor 생성
- Architecture Lens 전환
- command palette 열기/검색/키보드 닫기
- 문서 drawer
- 테마 전환
- 집중 모드
- Stat 계산기 입력 반응
- 코드 블록 복사 UI 생성
- 다이어그램 필터
- 다이어그램 modal/zoom/Escape
- 모바일 하단 탐색
- 모바일 브랜드 가독성
- 390px 수평 overflow 없음
- 테스트 대상 페이지의 JavaScript console/page error 없음

---

## 13. 최종 결론

원본 콘텐츠는 **시스템 분리의 방향과 학습 자료로서의 가치가 높다.** 특히 Definition/Runtime 분리, Source 추적, Request/Result, Fireball 수직 슬라이스는 유지해야 할 강점이다.

다만 실제 프레임워크 구현으로 넘어가기 전에 다음 네 가지를 최우선으로 고정해야 한다.

1. 실행 identity와 version envelope
2. 단일 state commit owner
3. 결정론적 ReactionQueue
4. contextual Stat cache와 Status tick semantics

UX/UI는 기존 레이아웃을 재사용하지 않고 System Atlas로 전면 개편했다. 새 구조는 문서를 “순서대로 읽는 사이트”에 머물지 않고, **시스템을 관점별로 탐색하고 계약 이름으로 즉시 검색하며 구현 gate까지 연결하는 개발자용 인터랙티브 지식 도구**로 바꾼다.

---

## 참고 자료

[^epic-gas]: Epic Games, “Gameplay Ability System for Unreal Engine,” https://dev.epicgames.com/documentation/unreal-engine/gameplay-ability-system-for-unreal-engine
[^epic-ability]: Epic Games, “Using Gameplay Abilities in Unreal Engine,” https://dev.epicgames.com/documentation/unreal-engine/using-gameplay-abilities-in-unreal-engine
[^epic-effect]: Epic Games, “Gameplay Effects for the Gameplay Ability System,” https://dev.epicgames.com/documentation/unreal-engine/gameplay-effects-for-the-gameplay-ability-system-in-unreal-engine
[^linear]: Linear, “How we redesigned the Linear UI,” https://linear.app/now/how-we-redesigned-the-linear-ui
[^geist]: Vercel, “Geist Design System,” https://vercel.com/geist/introduction
[^stripe]: Stripe, “Quickstarts,” https://docs.stripe.com/quickstarts
[^shadcn]: shadcn/ui, “Command,” https://ui.shadcn.com/docs/components/radix/command
[^webdev-transition]: web.dev, “Transitions,” https://web.dev/learn/css/transitions
[^wcag]: W3C WAI, “WCAG 2 Overview,” https://www.w3.org/WAI/standards-guidelines/wcag/
