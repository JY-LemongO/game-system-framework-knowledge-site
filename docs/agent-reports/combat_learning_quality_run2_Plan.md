# Combat Learning Quality Run 2 Plan

작성일: 2026-07-20
목표: 기존 Fireball 실행 관찰을 넘어, 주니어 개발자가 낯선 전투 요구를 계약 중심 설계로 전이하고 명시적 기준으로 검증받게 한다.

## 분석 요약

- 현재 Runtime Lab은 replay·atomic commit·reaction·status time을 실행 증거로 관찰하는 데 강하지만, 학습자가 새 설계를 직접 작성하는 평가는 없다.
- Run 2는 `Chain Lightning + Shock` 미공개 변형의 구조화 JSON 설계 제출물과 실행 가능한 assessor를 추가한다.
- assessor는 학습 산출물의 계약 정합성을 검증한다. 다중 대상 production runtime을 구현하거나 Unity 호환성을 보증한다고 표현하지 않는다.
- 합격은 100점 중 80점 이상, 정상·경계·실패 gate 전부 통과, critical 위반 0개로 고정한다.
- 저장소에 `AGENTS.md`, `MEMORY.md`, `ProjectSettings/ProjectVersion.txt`는 없으며 이 프로젝트는 Unity 프로젝트가 아니라 엔진 비종속 학습 사이트다.

## 영향 파일/시스템

- `modules/runtime-reference.html:254` — Fireball Workbench 뒤에 캡스톤 brief, starter JSON editor, rubric, 결과 영역, 증거 한계 고지를 추가한다.
- `source/runtime/capstone-assessor.js` — 제출물 schema와 100점 rubric을 순수 함수로 평가하는 source-of-truth를 추가한다.
- `assets/js/capstone-assessor.js` — 브라우저 배포용 assessor mirror를 추가하고 source와 byte-identical 상태를 검증한다.
- `assets/js/app.js:1316` — editor 초기화, 제출·초기화, 항목별 점수·gate·critical feedback, 브라우저 로컬 draft 저장을 연결한다.
- `assets/css/site.css:1244` — 캡스톤 editor, 점수표, gate/critical feedback의 desktop·mobile 레이아웃을 추가한다.
- `source/runtime/tests/capstone-assessor.test.cjs` — 기준 제출물과 각 critical 결함, malformed 입력, mutation 방지, 경계 gate를 검증한다.
- `package.json` — assessor 테스트를 기본 테스트 체인에 포함하고 reference version을 갱신한다.
- `source/tools/browser_smoke.py:299` — starter 미채점 상태, 불완전 제출 실패, 유효 제출 합격, reset, 모바일 overflow와 접근성 상태를 확인한다.
- `source/tools/validate_site.py:899` — 캡스톤 section, 명시적 배점·합격 조건·증거 한계, assessor source/asset 동일성을 검사한다.
- `README.md`, `VERSION`, 검색 index, source manifest — 학습 경로와 버전·파생 산출물을 갱신한다.
- 기존 C# 참조와 `source/runtime/runtime-kernel.js`의 전투 실행 의미는 변경하지 않는다.

## 수정 계획 (단계별)

1. `chain-lightning-shock.v1` challenge와 starter submission의 정확한 필드 집합을 정의한다.
2. 아래 100점 rubric을 데이터로 고정하고 `assessCombatCapstone(submission)`을 입력 비변경 순수 함수로 구현한다.
   - 책임 소유권 15점
   - 순수 resolve·대상 정렬·target-keyed RNG 20점
   - 원자적 commit·version·rollback 20점
   - event·reaction 직접 인과·멱등성·budget 20점
   - Status clock·provenance·tick/expire 15점
   - replay envelope·검증 증거 10점
3. 합격 조건을 `score >= 80 && normal/edge/failure gate PASS && criticalViolations.length === 0`으로 구현한다.
4. critical 규칙을 고정한다: resolve mutation/pre-commit event, mutation 대상 version 누락/부분 성공, 순회·소비순서 RNG, reaction 실패의 primary rollback, origin 반복 causation, status clock/tick-expire 미정의.
5. 정상·경계·실패 probe를 제출물에서 독립 계산한다.
   - 정상: 섞인 3대상을 `(distanceBucket asc, EntityId ordinal asc)`로 정렬하고 target별 keyed RNG, 단일 primary plan, DamageCommitted별 Shock reaction을 선언한다.
   - 경계: 입력 permutation과 거리 동률에도 같은 순서·키가 나오고, full-shield Hit 생존 대상에도 Shock을 적용하며, +4 마지막 tick commit 뒤 같은 tick에 expire한다.
   - 실패: 한 target의 stale version이면 비용·쿨다운·모든 피해·outbox가 불변이고, 별도 reaction budget 실패는 primary commit을 유지한 채 wave 잔여 작업을 폐기한다.
6. Runtime Lab에 빈칸형 JSON starter, 과제 규칙, 명시적 rubric, 점수·gate·critical 결과를 추가한다. 완성 답안을 한 번에 불러오는 UI는 제공하지 않는다.
7. editor는 arbitrary JavaScript를 실행하지 않고 JSON만 parse해 assessor에 전달한다. draft는 현재 브라우저에만 저장되며 초기화할 수 있게 한다.
8. assessor Node 테스트, 원격과 동일한 브라우저 smoke, 정적 validator를 보강한다.
9. desktop 1440px와 mobile 390px에서 editor·rubric·feedback을 시각 점검하고 가로 page overflow, 잘린 버튼, 읽기 어려운 feedback을 수정한다.
10. 검색 index와 manifest를 마지막에 재생성하고 전체 `npm run qa`를 통과시킨다.

## 사이드이펙트 표

| 영향 범위 | 테스트 케이스 | 위험도 |
|---|---|---:|
| Runtime Lab 길이와 탐색 | 새 TOC anchor, 영웅 CTA 유지, mobile bottom bar와 겹침 없음 | 중 |
| Assessor 판정 정확성 | 기준 제출 100점, 각 critical fixture 불합격, 79/80 경계, gate 우선 조건 | 높음 |
| 학습 증거 표현 | evaluator와 production multi-target runtime의 범위를 혼동하지 않는 고지 | 높음 |
| JSON editor 안전성 | malformed JSON, array/null/unknown shape, oversized text를 오류로 처리하고 code eval 금지 | 중 |
| 로컬 draft | storage 차단 시 학습·채점은 계속 동작하고 저장 불가 안내 | 중 |
| 기존 Fireball Lab | 초기 replay·3 hardening probe·cache·migration 결과 회귀 없음 | 높음 |
| 배포 mirror | source/assets assessor SHA-256 동일, script load 순서 보장 | 높음 |
| 검색·manifest | 새 섹션 검색 가능, 파생 파일 최신 상태 | 낮음 |

## 미해결 질문 (사용자 확인 필요)

- 없음. 사용자는 반복 점검·수정과 `dev` 직접 푸시·프리뷰 검증까지 승인했으며, 이 계획은 그 승인된 Run 2 범위 안이다.

## 보고서 경로

`docs/agent-reports/combat_learning_quality_run2_Plan.md`

## 독립 감사 반영

초기 구현 뒤 도메인 정확성·교육 설계·QA를 서로 독립적으로 재검토하고, 발견된 false PASS 경로와 실제 런타임 의미 불일치를 수정했다.

- `commit.duplicatePolicy = allow-repeat`, `reaction.sortOrder = insertion-order`, `replay.targetPermutationInvariant = false` 중 하나만 틀려도 계산 gate 또는 critical violation으로 반드시 불합격한다.
- 공개 JSON Schema의 enum·필수 필드·배열 중복 금지·tick 범위/상한과 assessor의 실제 입력 검증을 일치시켰다. 정확한 토큰은 schema에서 발견할 수 있지만 완성 답안 생성 API는 공개하지 않는다.
- 대상은 전체 정렬 뒤 최대 3개로 제한하고 중복 대상을 거부한다. 대상별 keyed RNG와 입력 permutation 불변성은 선언문만 신뢰하지 않고 assessor가 독립 계산한다.
- Status 인과관계를 실제 커널 의미와 맞췄다. 적용 command는 `DamageCommitted`, `StatusApplied` event는 적용 command, 첫 tick command는 `StatusApplied`, 이후 tick command는 직전 `StatusTicked`를 직접 원인으로 삼는다. 마지막 +4 commit은 피해·`StatusTicked`·`StatusExpired`와 `status.remove`를 한 번에 반영한다.
- Reaction budget 실패는 이미 commit된 primary와 dispatch된 A를 유지하고 pending B/C만 폐기한다. enqueue가 수락된 A/B/C 멱등 키는 유지하며 실제 오류 `REACTION_WAVE_LIMIT_EXCEEDED` / `BUDGET_EXCEEDED`를 사용한다. 재시도는 새 command ID만으로 부족하고 새 command·reaction 멱등 키 쌍 또는 명시적 운영자 정책이 필요하다.
- 저장된 예전 draft가 현재 schema와 맞지 않으면 자동 폐기하고 최신 starter로 복구한다.
- 공개 JavaScript API에 직접 전달된 sparse 배열·index accessor·symbol/추가 property 배열은 JSON data shape가 아니므로 값을 실행하거나 읽기 전에 schema 오류로 거부한다.
- 이 평가는 계약 설계 산출물의 정합성 증거이며 production 다중 대상 런타임, Unity 통합, 네트워크 권위 모델의 구현 완료 증거는 아니다.

## 최종 검증 결과

| 검증 | 결과 |
|---|---:|
| Runtime kernel Node tests | 62/62 PASS |
| Capstone assessor Node tests | 18/18 PASS |
| 단일 오답 변형 독립 감사 | 41/41 불합격, false PASS 0 |
| 비 JSON 배열 shape 교차 감사 | source/browser 132/132 거부, getter 호출 0 |
| 정적 사이트 validator | 12 HTML, 검색 326, diagram 34세트, contract 7, ADR 5, 오류·경고 0 |
| 브라우저 smoke | 443/443 PASS |
| source/browser assessor mirror | SHA-256 동일 |

최종 판정은 **PASS**다. 새 캡스톤은 기존 Fireball 실행 관찰을 훼손하지 않으면서, 학습자가 소유권·결정론·원자성·직접 인과·Status 시간·replay 증거를 새 요구에 전이해 작성하고 계산 기반으로 검증받게 한다.
