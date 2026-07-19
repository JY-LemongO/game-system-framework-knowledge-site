using GameSystemKnowledge.Reference.Contracts;
using GameSystemKnowledge.Reference.Runtime;

namespace GameSystemKnowledge.Reference.Systems;

public static class FireballReferenceScenario
{
    public const long CastTick = 18_240;
    public const long CooldownReadyTick = 18_300;
    public const long InitialMana = 100;
    public const long InitialShield = 40;
    public const long InitialHealth = 500;
    public const int BurnDurationTicks = 6;
    public const int BurnTickInterval = 2;

    public static readonly EntityId CommandId = new("command.fireball.cast.0001");
    public static readonly EntityId CasterId = new("entity.caster");
    public static readonly EntityId TargetId = new("entity.target");
    public static readonly EntityId SkillDefinitionId = new("skill.fireball");
    public static readonly EntityId FormulaId = new("combat.fire.v3");
    public static readonly EntityId BurnDefinitionId = new("status.burn");

    public static readonly EntityId ManaResourceId = new("resource.caster.mana");
    public static readonly EntityId CooldownResourceId = new("cooldown.caster.fireball");
    public static readonly EntityId TargetShieldResourceId = new("resource.target.shield");
    public static readonly EntityId TargetHealthResourceId = new("resource.target.hp");

    public static readonly EntityId SkillCommittedEventId =
        new("event.skill-committed.fireball.0001");
    public static readonly EntityId DamageCommittedEventId =
        new("event.damage-committed.fireball.0001");
    public static readonly EntityId DamageCommittedEventTypeId =
        new("event-type.damage-committed");
    public static readonly EntityId BurnReactionRuleId =
        new("reaction-rule.fireball.burn");
    public static readonly EntityId BurnReactionId =
        new("reaction.fireball.burn.0001");
    public static readonly EntityId BurnIdempotencyKey =
        new("idempotency.fireball.burn.0001");

    public static SourceRef SkillSource =>
        SourceRef.SkillExecution(SkillDefinitionId, CommandId);

    public static SkillRequest CreateSkillRequest() =>
        new(
            CasterId,
            SkillDefinitionId,
            TargetId,
            requestedTick: CastTick,
            rootSeed: 61_710);

    public static EffectContext CreateEffectContext() =>
        new(
            CasterId,
            TargetId,
            SkillSource,
            RandomSeed: 61_710);

    public static DamageRequest CreateDamageRequest() =>
        new(
            CasterId,
            TargetId,
            SkillSource,
            formulaId: FormulaId,
            damageType: "fire",
            baseValue: 24,
            coefficientBps: 12_000,
            tags: new[] { "spell", "fire" },
            seed: 61_710);

    public static CombatContext CreateCombatContext(
        HitOutcome outcome = HitOutcome.Hit,
        int availableTargetHp = 500) =>
        new(
            scalingStatValue: 120m,
            outcome,
            critical: true,
            criticalMultiplierBps: 15_000,
            resistanceBps: 2_000,
            availableShield: checked((int)InitialShield),
            availableTargetHp: availableTargetHp);

    public static EffectBundle CreateEffectBundle(DamageRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        return new EffectBundle(
            new EntityId("effect-bundle.fireball.cast.0001"),
            new EffectOperation[]
            {
                new DamageEffectOperation(
                    new EntityId("effect.fireball-damage"),
                    request)
            },
            new[]
            {
                new ReactionRule(
                    BurnReactionRuleId,
                    DamageCommittedEventTypeId,
                    BurnReactionId,
                    BurnIdempotencyKey,
                    new EntityId("effect.apply-burn"),
                    priority: 100,
                    new EntityId("order.fireball.burn.0001"),
                    depth: 1,
                    budgetCost: 1,
                    requiresHit: true,
                    requiresTargetAlive: true)
            },
            EffectExecutionPolicy.CommitThenReact);
    }

    public static IReadOnlyList<VersionedResourceState> CreateInitialState() =>
        new[]
        {
            new VersionedResourceState(ManaResourceId, InitialMana, 4),
            new VersionedResourceState(CooldownResourceId, 0, 2),
            new VersionedResourceState(TargetShieldResourceId, InitialShield, 7),
            new VersionedResourceState(TargetHealthResourceId, InitialHealth, 7)
        };

    public static CommitPlan CreateCommitPlan(DamageResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        if (result.Outcome != HitOutcome.Hit)
        {
            throw new ArgumentException(
                "The reference Fireball commit plan expects a resolved hit.",
                nameof(result));
        }

        var targetHpAfter = Math.Max(0, InitialHealth - result.FinalHpDamage);

        return new CommitPlan(
            CommandId,
            new[]
            {
                new VersionPrecondition(ManaResourceId, 4),
                new VersionPrecondition(CooldownResourceId, 2),
                new VersionPrecondition(TargetShieldResourceId, 7),
                new VersionPrecondition(TargetHealthResourceId, 7)
            },
            new[]
            {
                new StateMutation(ManaResourceId, InitialMana - 20, "Spend 20 mana"),
                new StateMutation(
                    CooldownResourceId,
                    CooldownReadyTick,
                    "Set Fireball ready tick to 18300"),
                new StateMutation(
                    TargetShieldResourceId,
                    InitialShield - result.ShieldAbsorbed,
                    $"Absorb {result.ShieldAbsorbed} shield"),
                new StateMutation(
                    TargetHealthResourceId,
                    targetHpAfter,
                    $"Lose {result.FinalHpDamage} health")
            },
            new DomainEvent[]
            {
                new SkillCommitted(
                    SkillCommittedEventId,
                    CommandId,
                    CasterId,
                    SkillDefinitionId,
                    TargetId,
                    SkillSource),
                new DamageCommitted(
                    DamageCommittedEventId,
                    CommandId,
                    CasterId,
                    TargetId,
                    SkillSource,
                    result,
                    targetHpAfter)
            });
    }

    public static IReadOnlyList<ReactionCommand> CreateReactionCommands(
        EffectBundle bundle,
        CommittedOutboxEvent committedEvent)
    {
        ArgumentNullException.ThrowIfNull(bundle);
        ArgumentNullException.ThrowIfNull(committedEvent);

        if (committedEvent.Event is not DamageCommitted damage)
        {
            return Array.Empty<ReactionCommand>();
        }

        return bundle.Reactions
            .Where(rule =>
                rule.TriggerEventTypeId == DamageCommittedEventTypeId &&
                (!rule.RequiresHit || damage.Result.Outcome == HitOutcome.Hit) &&
                (!rule.RequiresTargetAlive || damage.TargetHpAfter > 0))
            .Select(rule => new ReactionCommand(
                rule.ReactionId,
                rule.IdempotencyKey,
                rule.HandlerId,
                damage.DefenderId,
                damage.Source,
                committedEvent.Event.EventId,
                rule.Priority,
                rule.StableOrderKey,
                rule.Depth,
                rule.BudgetCost))
            .ToArray();
    }

    public static ApplyStatusRequest CreateBurnRequest(ReactionCommand reaction)
    {
        ArgumentNullException.ThrowIfNull(reaction);
        if (reaction.ReactionId != BurnReactionId)
        {
            throw new ArgumentException(
                "Only the committed Fireball Burn reaction is supported.",
                nameof(reaction));
        }

        if (reaction.HandlerId != new EntityId("effect.apply-burn"))
        {
            throw new ArgumentException(
                "The Burn reaction must use the Effect handler.",
                nameof(reaction));
        }

        return new ApplyStatusRequest(
            BurnDefinitionId,
            reaction.TargetId,
            reaction.Source,
            stackDelta: 1);
    }
}
