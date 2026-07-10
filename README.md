# Game System Framework Knowledge Site — Pro UI

`index.html`을 브라우저로 열면 됩니다. 외부 CDN 없이 로컬 파일만으로 동작합니다.

## 배포 및 브랜치 운영

- 운영 사이트: <https://jy-lemongo.github.io/GameSystemKnowledge/>
- QA 프리뷰: <https://jy-lemongo.github.io/GameSystemKnowledge/preview/>
- `main`: 운영·릴리스 브랜치
- `dev`: 통합·QA 브랜치

`dev`에 변경 사항을 푸시하면 QA 프리뷰가 갱신됩니다. 확인이 끝난 변경은 Pull Request로
`dev`에서 `main`으로 머지하며, 머지 후 운영 사이트가 자동으로 갱신됩니다.

## 2026-07-09 Phase 2: Combat / Status 확장

이번 패키지에는 Phase 1의 Core Runtime / Skill 구조 위에 Combat Resolution System과 Status System이 추가되었습니다.

### 추가된 문서

- `modules/combat-resolution-system.html`: DamageEffect가 만든 DamageRequest를 명중, 치명타, 방어, 저항, 보호막 계산을 거쳐 DamageResult로 바꾸는 구조
- `modules/status-system.html`: ApplyStatusEffect 이후 버프, 디버프, DoT, 중첩, 지속시간, tick, 정화, 면역을 관리하는 구조

### 갱신된 문서

- `index.html`: 학습 흐름을 Core → Stat → Effect → Skill → Combat → Status로 재정렬
- `modules/effect-system.html`: DamageEffect → CombatResolver, ApplyStatusEffect → StatusSystem 책임 경계 추가
- `modules/stat-system.html`: Combat / Status가 Stat을 읽고 Modifier를 등록/제거하는 방식 추가
- `modules/skill-action-system.html`: EffectBundle 이후 Combat / Status handoff 추가
- `modules/integration-map.html`: 전체 의존성 계약과 금지 의존성 기준 보강
- `modules/fireball-case-study.html`: Fireball을 Skill → Effect → Combat → Status → EventLog 수직 슬라이스로 확장
- `modules/glossary.html`: Combat / Status 용어 추가
- `modules/diagram-gallery.html`: 신규 UML 9종 추가
- `modules/implementation-roadmap.html`: Combat MVP, Status MVP, Fireball Vertical Slice 단계 추가
- `modules/skill-combat-next.html`: 다음 확장 후보를 Equipment / Progression으로 재정리

### 추가된 UML

- `22_combat_core_class_diagram`
- `23_damage_resolution_activity_diagram`
- `24_damage_execution_sequence_diagram`
- `25_combat_data_model_diagram`
- `26_status_core_class_diagram`
- `27_status_lifecycle_state_diagram`
- `28_status_apply_sequence_diagram`
- `29_status_tick_activity_diagram`
- `30_status_data_model_diagram`
- `38_full_framework_dependency_map` 갱신

자세한 작업 메모는 `PHASE2_EXTENSION_NOTES.md`를 참고하세요.

## 이전 Phase 1 확장

- `modules/core-runtime.html`: EntityId, SourceId, TagSet, EventBus, GameContext, TimeService, RandomStream, DataRegistry, DebugTrace의 공통 계약
- `modules/skill-action-system.html`: 비용, 쿨다운, 타겟팅, 액션 타임라인, EffectBundle 실행 구조
- 신규 UML: 16 Core Runtime, 17~21 Skill / Action, 38 전체 프레임워크 의존성 지도
