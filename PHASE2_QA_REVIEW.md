# Phase 2 QA Review Before Phase 3

## Checked
- Local HTML links and image paths
- `source/site-map.json` validity and page registration
- Diagram asset/source consistency
- JSON examples inside code blocks
- System responsibility consistency across Stat, Effect, Skill, Combat, Status
- Responsive CSS risk points for header/navigation, tables, code blocks, and diagram gallery

## Fixes applied
- Standardized `ApplyBurnEffect` wording to `ApplyStatusEffect(effect_apply_burn)` so the concrete Burn example does not look like a separate system type.
- Standardized stale `CombatResult` wording to `DamageResult`.
- Clarified `OrderedPartial` semantics in Effect System to match Skill and Fireball examples.
- Clarified Status Resistance naming to avoid confusion with Combat damage resistance.
- Added missing object rows for `DamagePipeline`, `CombatLogBuilder`, and `StatusResult`.
- Added missing `06_modifier_application_sequence_diagram.dot` source placeholder/reconstruction.
- Regenerated the updated Damage Resolution diagram and normalized PNG backgrounds to white for stable previews.
- Renamed the visible labels of the redesigned Damage/Status diagrams from sequence to flow while preserving file names for link stability.
- Added responsive header overrides so the primary nav does not become crowded between tablet and desktop widths.

## Remaining design notes
- `quality-audit.html` is useful as an internal QA page, but for an end-user learning site it may be moved out of the primary learning path later.
- Very tall activity diagrams are readable through SVG/PNG links and the zoom modal, but their inline preview is intentionally compact to avoid extremely long pages.
