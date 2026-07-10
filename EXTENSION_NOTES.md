# Extension Notes

이번 작업에서 1차 추천 적용 범위를 실제 HTML 패키지에 반영했습니다.

## 추가된 페이지

- `modules/core-runtime.html`: EntityId, SourceId, TagSet, EventBus, GameContext, TimeService, RandomStream, DataRegistry, DebugTrace 계약
- `modules/skill-action-system.html`: SkillDefinition, SkillRuntime, CostPolicy, CooldownPolicy, TargetingSpec, ActionTimeline, EffectBundle 실행 구조

## 보강된 페이지

- `index.html`: 새 학습 루트와 카드 구성 반영
- `modules/integration-map.html`: Core 중심 의존성 지도와 금지 의존성 보강
- `modules/fireball-case-study.html`: SkillRequest부터 EffectBundle, Damage, Burn, Event까지의 수직 슬라이스로 확장
- `modules/glossary.html`: Core / Skill 관련 용어 추가
- `modules/diagram-gallery.html`: 신규 UML 7종 추가
- `modules/implementation-roadmap.html`: Core Runtime과 Skill / Action MVP 단계를 포함하도록 재정렬
- `modules/skill-combat-next.html`: Skill 상세 문서가 분리되었음을 안내
- `source/site-map.json`: 검색/문서 인덱스 갱신

## 추가된 다이어그램

- `16_core_runtime_component_diagram`
- `17_skill_core_class_diagram`
- `18_skill_lifecycle_state_diagram`
- `19_skill_execution_sequence_diagram`
- `20_skill_timeline_activity_diagram`
- `21_skill_data_model_diagram`
- `38_full_framework_dependency_map`
