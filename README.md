# Game System Framework · System Atlas

C# 타입과 계약을 기준으로 게임 시스템 아키텍처를 순서대로 학습하는 오프라인 지식 사이트다. 최상위 `index.html`을 열면 별도 서버나 빌드 없이 Core Runtime, Stat, Effect, Skill, Combat, Status의 책임과 연결 관계를 읽을 수 있다.

코드 예제는 C#, 직렬화·설정·실행 결과 예시는 JSON, Runtime Contract Lab은 JavaScript 브라우저 시뮬레이터를 사용한다.

## 공개 학습 구성

공개 사이트는 학습에 직접 필요한 12개 페이지만 제공한다.

1. `index.html` — 전체 학습 경로와 아키텍처 관점
2. `modules/core-runtime.html` — 공통 식별자와 런타임 계약
3. `modules/stat-system.html` — 스탯, Modifier, 리소스 계산
4. `modules/effect-system.html` — 대상 선택과 결과 요청
5. `modules/skill-action-system.html` — 비용, 쿨다운, 타겟팅, 타임라인
6. `modules/combat-resolution-system.html` — 피해 계산과 commit 경계
7. `modules/status-system.html` — 지속시간, 중첩, tick, 정화, 면역
8. `modules/integration-map.html` — 시스템 의존성과 handoff 계약
9. `modules/fireball-case-study.html` — 전체 흐름을 잇는 수직 사례
10. `modules/runtime-reference.html` — 실행 결과를 직접 관찰하는 Runtime Contract Lab
11. `modules/diagram-gallery.html` — UML 다이어그램 레퍼런스
12. `modules/glossary.html` — 용어와 UML 기초 문법

구현 로드맵, 릴리스 현황, 품질 감사 결과, 앞으로의 기능 계획은 공개 학습 페이지와 검색 색인에 포함하지 않는다.

## 로컬에서 보기

`index.html`을 브라우저에서 직접 열 수 있다. Runtime Contract Lab까지 같은 조건으로 확인하려면 저장소 루트에서 정적 서버를 실행한다.

```bash
npm run serve
```

## 학습 자료와 저장소 문서의 경계

- 공개 HTML은 현재 설명하는 개념, 계약, 예제, 실습만 담는다.
- `source/csharp/`은 페이지의 핵심 계약과 Fireball 불변식을 실제 빌드로 검증하는 C# 참조 프로젝트를 보관한다.
- `source/runtime/`은 Runtime Contract Lab의 JavaScript 시뮬레이터 커널, fixture, 계약 스키마를 보관한다.
- `source/diagrams/`와 `assets/diagrams/`는 학습 다이어그램의 원본과 출력물을 보관한다.
- `DEVELOPMENT_WORKFLOW.md`는 브랜치 역할, Preview 승격 절차, 검증 기준과 현재 인수인계 기준점을 보관한다.
- `QA_REPORT.md`, `PHASE3_REFERENCE_IMPLEMENTATION.md`, `PHASE3_IMPLEMENTATION_PLAN.md` 같은 문서는 당시 상태를 남긴 저장소 내부 검증·계획 기록이며 공개 내비게이션에는 연결하지 않는다.

## 유지보수 검증

```bash
npm run python:deps
npm run csharp:verify
npm run qa
```

`csharp:verify`는 외부 테스트 패키지 없이 C# 계약과 Fireball 기준 수치를 빌드·실행한다. `qa`는 JavaScript 런타임 테스트, C# 참조 검증, 내비게이션 문구 일치, 검색 색인 재생성, 정적 링크·계약 검증, 체크섬 manifest 확인, 데스크톱·모바일 브라우저 smoke test를 순서대로 실행한다. 파일을 변경한 뒤에는 `npm run site-shell`로 drawer·pager 설명을, `npm run manifest`로 `MANIFEST.sha256`을 갱신한다. 검색 색인은 `source/site-map.json`과 공개 HTML을 기준으로 생성한다.
