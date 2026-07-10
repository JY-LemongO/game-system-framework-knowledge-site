# Phase 2 Extension Notes

## Added pages
- `modules/combat-resolution-system.html`
- `modules/status-system.html`

## Added UML diagrams
- `22_combat_core_class_diagram`
- `23_damage_resolution_activity_diagram`
- `24_damage_execution_sequence_diagram`
- `25_combat_data_model_diagram`
- `26_status_core_class_diagram`
- `27_status_lifecycle_state_diagram`
- `28_status_apply_sequence_diagram`
- `29_status_tick_activity_diagram`
- `30_status_data_model_diagram`

All diagrams were exported as DOT, SVG, and PNG. The full framework dependency map (`38_full_framework_dependency_map`) was refreshed to show Combat and Status as active systems.

## Updated existing pages
- `index.html`: learning route and system cards updated for Phase 2.
- `modules/effect-system.html`: DamageEffect → CombatResolver and ApplyStatusEffect → StatusSystem handoff added.
- `modules/stat-system.html`: Combat/Status reading and modifier registration rules added.
- `modules/skill-action-system.html`: Skill → EffectBundle → Combat/Status handoff added.
- `modules/integration-map.html`: rewritten around full dependency contracts and forbidden dependencies.
- `modules/fireball-case-study.html`: expanded into a full vertical slice through Skill, Effect, Combat, Status, EventLog, DebugTrace.
- `modules/glossary.html`: Combat and Status terms added.
- `modules/diagram-gallery.html`: Combat/Status diagrams registered.
- `modules/implementation-roadmap.html`: Phase 4 Combat, Phase 5 Status, Phase 6 Fireball vertical slice added.
- `modules/skill-combat-next.html`: next expansion refocused on Equipment / Progression.

## Key design decisions
- Skill never calculates damage directly; it runs EffectBundle at timeline markers.
- DamageEffect creates DamageRequest and delegates final calculation to Combat Resolution.
- ApplyStatusEffect creates a status application request and delegates duration/stack/tick to Status System.
- Status never directly mutates final stat values; it registers/removes StatModifier by sourceId.
- DoT/HoT ticks execute periodic Effects rather than bypassing Effect/Combat/Event logging.
