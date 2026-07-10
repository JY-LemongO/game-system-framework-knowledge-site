# Game System Framework — System Atlas Redesign

`index.html`을 브라우저로 열면 됩니다. 외부 CDN, 빌드 도구, 서버 없이 로컬 파일만으로 동작합니다.

## 배포 및 브랜치 운영

- 운영 사이트: <https://jy-lemongo.github.io/GameSystemKnowledge/>
- QA 프리뷰: <https://jy-lemongo.github.io/GameSystemKnowledge/preview/>
- **main**: 운영·릴리스 브랜치
- **dev**: 통합·QA 브랜치

dev에 변경 사항을 푸시하면 QA 프리뷰가 갱신됩니다. 확인이 끝난 변경은 Pull Request로
dev에서 main으로 머지하며, 머지 후 운영 사이트가 자동으로 갱신됩니다.

## 이번 개편

- 학습 순서 / 런타임 실행 / 코드 계약을 분리한 인터랙티브 Architecture Lens
- 페이지 제목뿐 아니라 본문 섹션까지 찾는 `⌘/Ctrl + K` 검색
- 전체 문서 drawer, 핵심 시스템 dock, 반응형 모바일 하단 탐색
- 접근 가능한 native dialog 기반 검색·목차·다이어그램 포커스 뷰
- 테마 3단계(system/light/dark), 집중 읽기 모드, 읽기 진행률
- 다이어그램 pan/zoom, 코드 복사 fallback, heading deep link
- Phase 3 Readiness 페이지와 아키텍처 계약 보강
- 외부 자산 없이 동작하며 `prefers-reduced-motion`과 키보드 탐색을 지원

## 중요 용어

이 패키지의 **Release 2**는 지식 사이트 배포 버전입니다. `Implementation Roadmap`의 단계는 혼동을 피하기 위해 **Milestone**으로 표기합니다.

## 권장 시작점

1. `index.html` — 세 관점으로 전체 구조 읽기
2. `modules/fireball-case-study.html` — 수직 슬라이스 추적
3. `modules/phase3-readiness.html` — 설계 검토와 다음 구현 Gate
4. `ARCHITECTURE_AUDIT_AND_PHASE3_PLAN.md` — 상세 분석 보고서
