# 검토 및 수정 메모

시각 검토와 간단한 동작 점검 후 다음 항목을 수정했습니다.

- 다이어그램 갤러리의 썸네일 카드(`.thumb`)에 CSS가 적용되지 않아 SVG가 원본 크기로 노출되고 큰 공백/가로 스크롤이 생기던 문제를 수정했습니다.
- 다이어그램 갤러리에 “다이어그램 목록” 섹션과 우측 목차를 추가해 “섹션 목차가 없습니다.”가 보이지 않도록 정리했습니다.
- 모바일 헤더의 검색 버튼이 빈 버튼처럼 보이던 문제를 아이콘 표시와 `aria-label`로 보완했습니다.
- 한글 제목이 글자 중간에서 어색하게 줄바꿈되던 문제를 `word-break: keep-all`과 모바일 제목 크기 조정으로 완화했습니다.
- 모바일에서 긴 표와 코드/카드가 전체 페이지 폭을 밀어내던 문제를 표 전용 스크롤 래퍼와 grid 최소 폭 보정으로 수정했습니다.
- 로컬/샌드박스 환경에서 `localStorage` 접근이 차단되어 전체 JS 초기화가 중단될 수 있는 문제를 안전 접근 함수로 보완했습니다.
- 다이어그램 갤러리 이미지는 전체 갤러리/인쇄 상황에서도 누락되어 보이지 않도록 `loading="eager"`로 조정했습니다.

확인한 항목:

- HTML 내부 링크, 이미지, CSS, JS 상대 경로 누락 없음
- 중복 ID 없음
- 검색 팔레트, 다이어그램 확대 모달, 테마 토글 JS 초기화 오류 없음
- 데스크톱/모바일 주요 페이지 스크린샷 기준 레이아웃 이상 없음

## Core / Skill 확장 적용 내역

- Core Runtime / System Contract 페이지를 추가해 Entity, Tag, Event, SourceId, Context, Time, RandomSeed 기준을 분리했습니다.
- Skill / Action System 페이지를 추가해 SkillDefinition, SkillRuntime, SkillRequest, Validator, Cost/Cooldown/Targeting/Timeline/EffectBundle 실행 정책을 상세화했습니다.
- Integration Map을 Core → Stat → Effect → Skill 중심 의존성 설명으로 갱신했습니다.
- Fireball Case Study를 SkillRequest에서 DamageEffect와 Burn 상태 적용까지 이어지는 수직 슬라이스 예제로 확장했습니다.
- Glossary, Diagram Gallery, Implementation Roadmap, Next Expansion 페이지를 새 학습 흐름에 맞게 갱신했습니다.
- 신규 Graphviz 다이어그램 7종과 전체 의존성 지도 1종을 추가했습니다.


## Phase 1 content expansion

- Added `modules/core-runtime.html` as the shared system contract page.
- Added `modules/skill-action-system.html` with cost, cooldown, targeting, timeline, and EffectBundle policies.
- Updated home, Integration Map, Fireball Case Study, Glossary, Diagram Gallery, common navigation, search palette data, site map, and pager links.
- Added diagrams 16, 17, 18, 19, 20, 21, and 38 in DOT, SVG, and PNG formats.
