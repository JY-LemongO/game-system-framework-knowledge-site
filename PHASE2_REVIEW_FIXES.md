# Phase 2 Review Fixes

Phase 3 진입 전 점검에서 발견한 구조/시각/소스 정합성 이슈를 정리하고 수정했다.

## 수정 사항

- 학습 흐름을 기준으로 문서 순서를 재정렬했다. Home 다음은 Quality Audit이 아니라 Core Runtime으로 이동한다.
- 모든 페이지의 좌측 문서 내비게이션, 하단 이전/다음 pager, 검색 인덱스 순서를 갱신했다.
- 다이어그램 모달의 placeholder 이미지에 안전한 transparent data URI를 지정하고, JS close 동작을 안정화했다.
- `06_modifier_application_sequence_diagram.dot` 누락을 보완했다.
- `24_damage_execution_sequence_diagram`과 `28_status_apply_sequence_diagram`의 겹침이 있는 가로형 레이아웃을 세로형 흐름도로 재생성했다.
- Combat 문서에서 DamageFormula, DefenseResolver, ResistanceResolver, ShieldResolver의 책임 중복 표현을 줄였다.
- Fireball 계산 예시에 반올림 정책 `floor`를 명시하고 shield 계산 문구를 수정했다.
- Status 문서에서 `appliedBySourceId`와 `statusInstanceId` 기반 modifier sourceId를 분리해 설명했다.

## 확인 항목

- HTML 링크와 이미지 경로 확인
- site-map.json 유효성 확인
- 주요 페이지 데스크톱/모바일 overflow 확인
- 신규/수정 다이어그램 SVG/PNG 생성 확인


## 최종 일관성 보강

- DamageFormula 용어 설명을 Combat 문서의 책임 경계와 맞추어 수정했습니다.
- ApplyStatusRequest 예시에서 상태 부여 원천을 `appliedBySourceId`로 명확히 표기했습니다.
- Fireball Burn 예시에서 `appliedBySourceId`, `statusInstanceId`, `modifierSourceId`를 분리했습니다.
- Status MVP 체크리스트에 상태 적용 원천과 Modifier 제거 키의 차이를 반영했습니다.
