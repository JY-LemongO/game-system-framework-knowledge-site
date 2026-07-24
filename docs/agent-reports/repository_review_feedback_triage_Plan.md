# Repository Review Feedback Triage & Remediation Plan

- 작성일: 2026-07-21
- Unity 호환성 재검토: 2026-07-22
- 피드백 기준: `main` 정적 검수 문서
- 계획 기준: clean `dev`, `b876a2e1566cee01e1fb73a2c686c19d3ea47ffb`
- 범위: 피드백 판정과 수정 계획, 사용자 승인 후 구현 및 독립 QA 결과
- 구현 상태: 릴리스 전 독립 재감사 보완까지 반영. 최종 증빙은 `v3` 태그, Actions, Preview metadata로 고정

## 분석 요약

피드백은 `origin/main` 상태에는 대체로 타당하지만, 현재 `dev`에는 후속 수정이 이미 다수 반영돼 있다. 따라서 ReactionQueue, StateStore 캡슐화, StatusResult factory, ReactionBudget 0 거부, README 테스트 경로는 재작업하지 않는다.

현재 남은 최우선 문제는 두 가지다.

1. release/runtime/QA 버전과 증빙이 서로 다른 상태
2. Pages가 `main`과 `dev`를 QA 없이 다시 checkout하여 배포하는 상태

그다음 우선순위는 truthful outbox, Schema와 builder 입력 계약, 실행 소스와 공개 코드 블록의 drift, `DictionaryStatQuery`와 `default(EntityId)` 방어다.

읽기 전용 검증으로 `npm test`를 실행해 runtime 62/62, capstone 18/18을 확인했다. 전체 `npm run qa`와 C# verifier는 이번 계획 단계에서 실행하지 않았다.

## 검토 기준

- 루트 `AGENTS.md`, `MEMORY.md`, `ProjectSettings/ProjectVersion.txt`는 존재하지 않는다.
- 이 저장소는 Unity 프로젝트 자체가 아니라 엔진 비종속 학습 사이트와 C#/JavaScript 실행 참조다.
- 현재 브랜치와 피드백 기준 브랜치가 다르므로 “피드백 오류” 대신 “현재 dev 기준 종결”을 별도 판정으로 사용한다.
- 구현 시 기준 브랜치는 `DEVELOPMENT_WORKFLOW.md`에 따라 `dev`로 둔다.

## 피드백 필터링 결과

| 피드백 항목 | 판정 | 현재 근거 | 계획 반영 |
|---|---|---|---|
| C#/JS ReactionQueue 실패 정책 불일치 | 현재 `dev` 기준 종결 | ADR `:12-17`, JS `runtime-kernel.js:336-481`, C# `Commit.cs:366-596`, 양쪽 회귀 검증이 fail-fast wave를 구현 | 의미 변경 제외. 공용 fixture는 선택적 후속 |
| 현재 버전과 QA 증빙 불일치 | 수용(P0) | `VERSION:1`·`package.json:3`은 3.4, runtime/d.ts/golden은 3.3, `qa-results.json:2`는 3.2 | 버전 도메인 정의와 자동 checker |
| 모든 버전을 무조건 하나로 통일 | 조건부 수용 | runtime/RNG/schema 등 독립 의미 버전 개념이 이미 존재 | releaseVersion과 runtimeVersion을 명시적으로 분리하고 도메인 내부만 강제 |
| Pages 배포 전 QA gate | 수용(P0) | `deploy-pages.yml:19-57`은 deploy job 하나뿐 | 두 브랜치 exact SHA QA 후 동일 SHA 배포 |
| StateStore public 상태 노출 | 현재 `dev` 기준 종결 | private fields `runtime-kernel.js:828-841`, immutable getter `:853-873`, 변조 테스트 `tests:304-313` | 수정 제외 |
| `status.patch` 임의 필드 변경 | 현재 `dev` 기준 종결 | patch exact field 검증 `runtime-kernel.js:713-717` 후에만 assign `:944-948` | 수정 제외. `stackCount`/`expireTick` 허용도 보류 |
| 이벤트 payload와 post-state 일치 | 수용(P1) | C#은 mutation/event를 별도 입력 `Commit.cs:89-101`, JS는 blueprint payload를 그대로 publish `runtime-kernel.js:915-968` | 결정론적 projector/invariant와 negative test |
| 개념 모델과 buildable reference 경계 | 대부분 종결, 일부 수용(P1) | Status/Effect/Runtime 문서는 이미 Conceptual/Executable 경계를 표시 | 전면 라벨링 제외. “실제 소스와 동일” 블록의 drift gate만 추가 |
| 장비·아이템 SourceKind 추가 | 현재 범위에서는 미수용 | 실행 계약은 3종이나 문서가 장비를 범위 밖으로 명시 `core-runtime.html:730`, `stat-system.html:329` | 장비 runtime을 실제 도입할 때 ADR과 함께 별도 기능화 |
| JSON Schema와 builder 엄격도 | 조건부 수용(P1) | builder default와 d.ts 입력 타입은 불일치. 그러나 unknown field는 이미 거부 `runtime-kernel.js:203-208,299-333` | input 타입·strict parser·schema fixture만 보강 |
| `DictionaryStatQuery` defensive copy | 수용(P1) | 입력 dictionary를 그대로 저장 `DictionaryStatQuery.cs:7-13` | private 복사본과 원본 mutation 테스트 |
| `default(EntityId)` 방어 | 수용(P1) | 실패한 TryCreate가 default를 반환하고 ToString은 빈 문자열 `Identifiers.cs:17-32` | IsValid/fail-fast boundary guard |
| StatusResult invariant factory | 현재 `dev` 기준 종결 | private ctor와 Applied/Removed/Failed `Status.cs:33-64` | 수정 제외 |
| ReactionBudget의 0 허용 | 현재 `dev` 기준 종결 | `maxBudget <= 0` 거부 `Effects.cs:62-82` | 수정 제외 |
| README의 잘못된 tests 경로 | 현재 `dev` 기준 종결 | `README.md:100-106`이 `source/runtime/tests`를 정확히 표시 | `source/tools`·`source/qa` 설명만 선택 보완 |
| 과거 문서 전면 이동 | 조건부 수용(P2) | README와 QA_REPORT가 이미 historical 경계를 설명 | 우선 인덱스/metadata. 대규모 이동은 보류 |
| .NET 10 전환 | 현재 미수용, Unity 6.8 정식 지원 후 재검토 | 현재 Unity 6은 .NET Standard 2.1/.NET Framework 4.8 프로필만 안정 지원. Unity 6.8의 .NET 10/C# 14는 로드맵 단계 | 지금은 Unity target으로 사용하지 않고 외부 verifier SDK만 고정 |
| NuGetAudit 재활성화 | 조건부 수용(P2) | 외부 PackageReference 없음, 현재 false | CI 정책 또는 비활성 사유·재검토 조건을 명시 |
| 페이지별 production 기능 확장 | 미수용 | Stat calculator, Effect executor, Skill timeline, Status service는 이미 Conceptual/Out of scope | 이번 정합성 계획과 분리 |

## 영향 파일/시스템

### P0 · Release와 배포

- `VERSION:1`
- `package.json:3,6-23`
- `source/runtime/runtime-kernel.js:8`
- `assets/js/runtime-kernel.js:8`
- `source/runtime/runtime-kernel.d.ts:1`
- 당시 `source/runtime/fixtures/fireball-golden-v1.json:4` (현재 v2 fixture로 승격)
- `modules/fireball-case-study.html:358`
- `source/qa/qa-results.json:1-39`
- `QA_REPORT.md:1-8`
- `DEVELOPMENT_WORKFLOW.md:13-42,69-78`
- `.github/workflows/deploy-pages.yml:1-57`
- `source/tools/validate_site.py`
- `MANIFEST.sha256`

### P1 · Runtime contract와 문서 정합성

- `source/csharp/GameSystemKnowledge.Reference/Runtime/Commit.cs:89-162,266-327`
- `source/csharp/GameSystemKnowledge.Reference/Systems/FireballReferenceScenario.cs:122-175`
- `source/runtime/runtime-kernel.js:299-333,660-725,881-968`
- `source/runtime/runtime-kernel.d.ts:95-106,229-230`
- `source/contracts/command-envelope.schema.json`
- `source/contracts/domain-event-envelope.schema.json`
- `source/contracts/commit-plan.schema.json`
- `source/adr/ADR-002-pure-resolve-atomic-commit.md`
- `modules/core-runtime.html:586-663`
- `source/csharp/GameSystemKnowledge.Reference/Contracts/Identifiers.cs:3-132`
- `source/tools/validate_site.py:821-940`

### P1~P2 · C# hardening과 플랫폼

- `source/csharp/GameSystemKnowledge.Reference/Systems/DictionaryStatQuery.cs:5-31`
- `source/csharp/GameSystemKnowledge.Reference/Contracts/Identifiers.cs:3-32`
- `source/csharp/GameSystemKnowledge.Reference.Verification/Program.cs`
- 두 `.csproj`의 `TargetFramework`·`NuGetAudit`
- 신규 `global.json`
- `modules/runtime-reference.html:204-205`
- `source/site-map.json`과 생성 search index

## 수정 계획 (단계별)

### 1. 버전 도메인과 자동 정합성 gate 확정 — P0

1. `releaseVersion`과 `runtimeVersion`을 구분한다.
   - 권장: `VERSION`을 releaseVersion의 source of truth로 사용
   - runtimeVersion은 kernel 의미 버전으로 유지하되 JS source, browser copy, d.ts, golden fixture, 공개 예시가 일치해야 함
   - QA evidence에는 두 버전을 모두 기록
2. 현재 `dev`의 runtime 변경이 의미 변경인지 판정한다.
   - Reaction wave, private StateStore, strict input 등 의미 변경이 포함됐으므로 runtimeVersion 3.4 승격을 우선 권장
3. `source/tools/check_release_integrity.py`와 `npm run version:check`를 추가한다.
4. checker를 `npm run qa`와 CI의 첫 단계에 포함한다.
5. `source/qa/qa-results.json`은 3.2 historical snapshot으로 명시하고 history로 분리한다.
6. `DEVELOPMENT_WORKFLOW.md`의 수동 “최신 수치”는 metric 정의와 SHA가 있는 evidence를 가리키게 바꾼다.

완료 기준:

- releaseVersion 그룹 내부 불일치 시 QA 실패
- runtimeVersion 그룹 내부 불일치 시 QA 실패
- 3.2 QA snapshot을 현재 PASS로 해석할 수 없음

### 2. exact-SHA QA와 Pages 배포 gate — P0, 1단계 의존

1. 배포 시작 시 `mainSha`와 `devSha`를 먼저 고정한다.
2. 고정한 두 SHA를 matrix QA하거나, 동일 SHA의 required check 성공을 확인한다.
3. CI 환경에 Node 20+, Python, 고정 .NET SDK, Python deps, Playwright Chromium, Graphviz, Noto Sans KR를 설치한다.
4. 세부 명령을 workflow에 복제하지 않고 canonical `npm run qa`를 호출한다.
5. `search-index` 같은 생성 단계 뒤 `git diff --exit-code`로 stale generated output을 검출한다.
6. deploy job에 `needs: qa`를 두고 QA가 검증한 바로 그 SHA를 checkout한다.
7. PR workflow는 QA만 실행하고 Pages는 배포하지 않는다.
8. Production/Preview에 각각 releaseVersion, runtimeVersion, commit SHA, builtAt metadata를 남긴다.
9. repository ruleset에서 `main` 직접 push 제한과 required checks를 설정한다.

완료 기준:

- 어느 한 SHA라도 QA 실패 시 Pages upload/deploy 미실행
- QA한 SHA와 배포한 SHA가 동일
- Preview 화면이나 build metadata에서 검수 대상 `dev` SHA 확인 가능

### 3. QA evidence 자동화 — P1, 1·2단계 의존

1. 기존 검사들을 호출하는 통합 runner와 JSON 출력 모드를 만든다.
2. 일반 로컬/CI 결과는 tracked 파일이 아니라 `.artifacts/qa/<sha>/qa-results.json` 또는 Actions artifact로 저장한다.
3. evidence에 두 버전, SHA, 실행 시각, Node/.NET/Python/Chromium 버전, 각 stage 상태와 count를 기록한다.
4. 릴리스 승격 시에만 `source/qa/history/<releaseVersion>/<sha>.json`을 의도적으로 커밋한다.
5. tracked `current.json`의 매 실행 자동 덮어쓰기는 도입하지 않는다.

이유:

- timestamp/SHA 때문에 매 QA마다 worktree와 `MANIFEST.sha256`이 바뀌는 문제 방지
- 같은 버전의 여러 SHA 결과 충돌 방지
- HEAD SHA를 같은 커밋에 기록하는 자기참조 방지

### 4. truthful outbox invariant — P1, 독립 작업 가능

1. state-derived 필드를 명시한다.
   - DamageCommitted의 HP/shield after
   - StatusApplied instance의 post-state 존재
   - StatusExpired instance의 post-state 부재
   - EntityDefeated의 HP 0
2. operation을 working state에 적용한 뒤 publish 전에 typed projector/invariant registry를 실행한다.
3. JSON `CommitPlan`에는 함수 callback을 넣지 않는다.
   - 함수 factory는 serialization/hash/replay를 깨뜨리므로 declarative event intent 또는 projector ID를 사용
4. raw damage, 판정 이유, source처럼 post-state만으로 만들 수 없는 값과 state-derived 값을 구분한다.
5. ADR-002에 atomic outbox와 truthful outbox가 다른 invariant임을 기록한다.
6. C#/JS에 거짓 payload negative test를 추가한다.

완료 기준:

- HP 499를 commit하면서 event에 999를 기록하는 plan이 publish 전에 실패
- 실패 시 state, outbox, processed command/idempotency가 모두 불변
- 정상 Fireball/Burn event 순서와 replay hash는 의도한 버전 변화 안에서 유지

### 5. wire schema, builder 입력, 공개 코드 drift 정리 — P1

1. `CommandEnvelopeInput`과 `DomainEventEnvelopeInput` 타입으로 실제 default 허용 필드를 표현한다.
2. strict wire parser/validator와 convenience builder의 역할을 문서와 API에서 구분한다.
3. builder가 만든 출력이 JSON Schema를 통과하는 공용 fixture를 추가한다.
4. strict parser가 missing/unknown field를 거부하는 fixture를 유지한다.
5. JS wire integer에 safe-integer 범위를 명시한다.
6. “실제 source와 동일”이라고 표시된 C# 블록만 exact extraction 또는 정규화 비교 대상으로 만든다.
7. 축약 블록은 Abridged/Conceptual로 표시한다.
8. Fireball의 168/252/202/162/30/24/266 주요 수치를 golden marker와 비교한다.

완료 기준:

- d.ts 입력 타입과 runtime default가 일치
- unknown field를 무시한다는 잘못된 인상 제거
- `Identifiers.cs` 변경 시 Core Runtime의 동일-source 블록 drift를 QA가 검출

### 6. C# 방어성 보강 — P1~P2

1. `DictionaryStatQuery`가 생성자 입력을 private dictionary로 복사한다.
2. 원본 dictionary를 생성 후 변경해도 조회 결과가 바뀌지 않는 검증을 추가한다.
3. `EntityId`에 invalid/default 상태를 식별하는 `IsValid` 또는 동등한 fail-fast 경계를 둔다.
4. `SourceRef`와 주요 public request/plan 생성자가 default EntityId를 거부한다.
5. `ToString()`이 invalid 값을 빈 ID처럼 조용히 숨기지 않도록 정책을 정한다.
6. Combat decimal 변환·계수 상한과 overflow 실패 계약을 별도 테스트로 고정한다.

제외:

- EntityId를 즉시 class로 변경
- source generator/analyzer를 첫 해결책으로 도입
- 이미 해결된 StatusResult와 ReactionBudget 재설계

### 7. Unity 호환 플랫폼과 문서 유지보수 — P2

1. 외부 verifier의 재현성만 현재 설치된 .NET 9 SDK와 `global.json`으로 고정한다.
2. Unity 소비용 참조 라이브러리를 `net10.0`으로 전환하지 않는다.
3. Unity 6.8이 정식 출시되고 필요한 Editor·Player·IL2CPP 대상의 .NET 10 지원이 확인되면 전환을 다시 검토한다. 6.7의 실험적 CoreCLR Desktop Player는 기준으로 삼지 않는다.
4. 그 전 Unity 통합은 별도 계획에서 배포 방식을 먼저 결정한다.
   - prebuilt DLL: `netstandard2.1` target과 Unity 플랫폼별 로드 검증
   - source/UPM: Unity 6의 C# 9.0 문법·API 범위까지 함께 준수
5. 현재 코드에는 C# 10 이후 문법과 최신 .NET API가 있으므로, 별도 호환성 계획 없이 target만 `netstandard2.1`로 바꾸지 않는다.
6. `NuGetAudit=false`는 CI 활성화, 제거, 사유 문서화 중 하나를 명시적으로 선택한다.
7. `docs/README.md`에 current/historical 인덱스를 추가하고 과거 문서에 `status`, `asOf`, `supersededBy` metadata를 점진적으로 붙인다.
8. 과거 문서의 전면 이동과 SourceKind 장비 확장은 이번 계획에서 보류한다.

## 권장 PR 분할과 의존성

| PR | 범위 | 의존성 |
|---|---|---|
| A · Release Identity | 버전 도메인, checker, historical QA 정리 | 없음 |
| B · Exact-SHA QA Gate | PR QA, 두 SHA gate, deploy needs, metadata | A |
| C · QA Evidence | 비추적 JSON artifact와 release snapshot | A, B |
| D · Truthful Events | projector/invariant, ADR, negative tests | A 이후 병렬 가능 |
| E · Contract Drift | builder 입력 타입, strict parser, source block gate, golden markers | A 이후 병렬 가능 |
| F · C# Hardening | dictionary copy, EntityId guard, numeric boundary | D/E와 병렬 가능 |
| G · Platform/Docs | global.json, Unity 호환 정책, audit, history index | B 이후 |

## 사이드이펙트

| 변경 | 영향 범위 | 테스트 케이스 | 위험 |
|---|---|---|---|
| 버전 도메인 분리 | runtime header, golden, 공개 표기, QA evidence | release/runtime 각각 일치·불일치 | 두 버전의 의미를 문서화하지 않으면 혼란 지속 |
| QA matrix와 exact SHA | Actions 시간, Pages concurrency | main 실패, dev 실패, 둘 다 통과, workflow 중 branch 이동 | 두 브랜치 전체 QA로 CI 시간이 증가 |
| QA JSON artifact | runner, 로그, history, manifest | 같은 버전 다른 SHA, 재실행, 실패 stage | tracked current 파일을 쓰면 worktree churn |
| truthful outbox | CommitPlan, replay, reaction 소비자 | 정상 damage/status, 거짓 after, 실패 rollback | 기존에 허용되던 임의 event blueprint가 거부될 수 있음 |
| strict parser/input type | JS API, d.ts, schema fixture | default builder, strict missing, unknown field, safe integer 경계 | 공개 API rename은 breaking change |
| source block drift gate | HTML code block, validator | source 변경 후 미동기 HTML, abridged block | whitespace/HTML escaping 차이로 false positive |
| EntityId guard | 모든 C# public boundary | default, null parse, 정상 ID, dictionary key | 숨겨진 default 사용이 한꺼번에 드러날 수 있음 |
| Unity 호환 target | C# library, verifier, 향후 UPM/DLL 배포 | netstandard2.1 DLL import 또는 C# 9 source compile | 소비 방식 확정 없이 target만 바꾸면 문법/API 호환 실패 가능 |

## 검증 시나리오

### 정상

- 두 버전 도메인이 각자 일치하고 QA evidence에 같은 SHA가 기록된다.
- `main`·`dev` exact SHA가 모두 QA를 통과해 같은 SHA가 배포된다.
- 정상 Fireball과 Burn의 state/outbox/replay가 유지된다.

### 엣지

- QA 도중 branch HEAD가 이동해도 이미 고정한 SHA만 배포한다.
- 같은 releaseVersion을 여러 SHA에서 실행해 artifact가 덮어써지지 않는다.
- builder default는 허용하지만 strict wire parser는 누락 필드를 거부한다.
- source block이 Abridged이면 exact-source 검사에서 제외된다.

### 실패

- runtime d.ts 또는 golden만 버전이 다르면 QA가 즉시 실패한다.
- 두 배포 대상 중 하나라도 실패하면 deploy가 실행되지 않는다.
- event payload가 post-state와 다르면 state/outbox/idempotency를 바꾸지 않고 실패한다.
- default EntityId가 public contract 경계를 통과하지 못한다.

## 결정 사항

1. 버전 정책
   - releaseVersion과 runtimeVersion을 분리하고 각 도메인 내부 일치를 자동 검사한다.
2. CommitPlan 신뢰 경계
   - 공개 executable contract인 만큼 외부 입력도 신뢰하지 않고 truthful invariant를 committer에서 강제한다.
3. 장비 시스템 범위
   - 현재 범위 밖을 유지한다. 실제 equipment runtime 작업이 승인될 때만 SourceKind를 확장한다.
4. repository ruleset
   - branch protection과 required check는 저장소 관리자 권한이 필요한 운영 단계다.

## 외부 출처

- Unity 6의 지원 API 프로필은 .NET Standard 2.1과 .NET Framework 4.8이며 .NET Core 관리 플러그인은 지원하지 않는다: https://docs.unity3d.com/6000.0/Manual/dotnet-profile-support.html
- Unity 6 에디터 컴파일러는 C# 9.0이다: https://docs.unity3d.com/6000.0/Manual/csharp-compiler.html
- Unity는 6.7에서 CoreCLR Desktop Player를 실험 제공하고 6.8에서 .NET 10/C# 14를 목표로 하지만 아직 로드맵 단계다: https://discussions.unity.com/t/coreclr-scripting-and-serialization-update-june-2026/1723299
- Unity 6.7 실험 Player에는 .NET 10이 없고 Unity 6.8이 .NET 10 toolchain을 제공할 예정이라는 공식 upgrade guide: https://discussions.unity.com/t/path-to-coreclr-2026-upgrade-guide/1714279
- SDK 선택 정책은 `global.json`으로 고정할 수 있다: https://learn.microsoft.com/en-us/dotnet/core/tools/global-json
- NuGet Audit 정책: https://learn.microsoft.com/en-us/nuget/concepts/auditing-packages

## 보고서 경로

`docs/agent-reports/repository_review_feedback_triage_Plan.md`

## 구현 결과 (2026-07-22)

- release/runtime 버전 도메인 checker를 `npm run qa`의 첫 gate로 연결하고 runtime 그룹을 `3.4.0-reference`로 동기화했다.
- PR head SHA와 배포 시작 시 고정한 `main`·`dev` SHA를 같은 재사용 QA workflow로 검증하고, 모두 통과한 경우 동일 SHA만 Pages에 배포하도록 구성했다.
- QA 실행 결과를 `.artifacts/qa/<commitSha>/qa-results.json`에 기록하고 CI에서 commit-keyed artifact로 업로드하도록 했다. 3.2 QA 결과는 historical snapshot으로 이동했다.
- JavaScript와 C# 모두 working state 적용 후 outbox fact를 검증하며, 불일치 시 state·outbox·idempotency를 바꾸지 않는다.
- builder 입력 타입과 strict wire parser를 분리하고 schema/런타임 safe-integer 경계, 함수 callback 거부, 공용 fixture를 추가했다.
- `DictionaryStatQuery` 방어적 복사, invalid/default `EntityId`·`SourceRef` 경계, C# 피해 계산 overflow를 보강했다.
- Core Runtime의 동일-source C# 블록을 실제 `Identifiers.cs`와 exact 비교하고 Fireball 핵심 수치를 golden marker로 검증한다.
- 외부 verifier는 `net9.0`을 유지하고 SDK `9.0.306`을 고정했다. Unity 소비 target의 `net10.0` 전환은 Unity 6.8 정식 출시와 필요한 Editor·Player·IL2CPP 지원 확인 뒤 재검토한다.

## 독립 QA 결과 (unity-qa, 2026-07-22, `dc3fe3e` 기준)

정상·엣지·실패 3축 재검토에서 미해결 구현 결함은 발견되지 않았다.

- `npm run qa`: PASS
- JavaScript: 85/85 (runtime 67, capstone 18)
- C#: 213 contract assertions
- 사이트 셸: 12 pages
- 다이어그램: 34 sets
- 검색 색인: 326 entries
- 정적 검증: 오류 0, 경고 0
- Manifest: 199 files
- 브라우저: 443/443 checks
- source/browser runtime kernel SHA-256 동일
- 거짓 HP/shield/status/defeat fact, unsafe integer, strict parser 누락·unknown·null, callback, stale manifest 실패 경로 통과

해당 SHA의 원격 `Deploy production and QA preview` run `29857300289`에서 production QA, Preview QA, deploy가 모두 통과했고 Preview metadata가 같은 `dev` SHA와 `3.4.0-reference`를 기록했다.

`main` branch protection의 required-check 강제와 repository ruleset은 이번 `dev` Preview 릴리스의 코드·배포 범위와 분리한 운영 정책이다. 현재 main 직접 push 제한 정책을 임의로 강화하지 않으며, production 승격 작업에서 저장소 관리자가 별도로 결정한다.

## 릴리스 전 재감사 보완 (2026-07-22)

초기 PASS 뒤 다른 검수자가 완료 기준을 다시 공격적으로 대조해 다음 두 누락을 발견했다.

1. legacy production 브라우저 호환 단계가 `MANIFEST.sha256`을 먼저 재생성해 frozen production SHA의 stale manifest를 가릴 수 있었다.
2. Effect planner/executor 입력·결과와 committed event payload 일부가 `default(EntityId)`를 실제 public/아웃박스 경계까지 통과시킬 수 있었다.

반영 내용:

- production 호환 rewrite 전에 원본 exact SHA의 `MANIFEST.sha256`을 `--check`로 먼저 검증한다.
- `EffectContext`, `EffectOperation`, `EffectOperationResult`, `EffectBundleResult`가 생성과 record `with` 경로 모두 invalid ID를 거부한다.
- Effect positional constructor, named argument, `Deconstruct`, record copy API는 유지한다.
- `SkillCommitted`와 `DamageCommitted`의 공통 envelope·actor·target·resource ID를 `CommitPlan`과 `CommittedOutboxEvent` 수용 전에 검증한다.
- 중간 DTO인 `VersionPrecondition`과 `VersionedResourceState`는 각각 aggregate ingress에서 거부되는 negative assertion으로 고정한다.
- C# targeted verifier는 보완 뒤 236 assertions를 통과했다.

최종 통과 기준:

- 생성 파일 갱신 뒤 clean worktree의 최종 commit에서 `npm run qa` 전 단계 PASS
- 최종 `dev` SHA의 production QA, Preview QA, deploy job PASS
- Preview `build-metadata.json`의 branch/SHA/version이 최종 `dev`와 일치
- 같은 SHA에 annotated `v3` 태그를 생성하고 원격 peeled tag까지 확인
