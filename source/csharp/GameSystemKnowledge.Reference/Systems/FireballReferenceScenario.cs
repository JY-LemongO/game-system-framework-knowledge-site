using GameSystemKnowledge.Reference.Contracts;
using GameSystemKnowledge.Reference.Runtime;

namespace GameSystemKnowledge.Reference.Systems;

public sealed class FireballExecutionIdentity
{
    public FireballExecutionIdentity(SkillRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        CommandId = request.CommandId;
        SkillSource = SourceRef.SkillExecution(
            request.SkillId,
            request.CommandId);
        BundleId = DeriveId(
            "effect-bundle.fireball",
            request.CommandId);
        SkillCommittedEventId = DeriveId(
            "event.skill-committed",
            request.CommandId);
        DamageCommittedEventId = DeriveId(
            "event.damage-committed",
            request.CommandId);
        BurnReactionId = DeriveId(
            "reaction.fireball.burn",
            request.CommandId);
        BurnIdempotencyKey = DeriveId(
            "idempotency.fireball.burn",
            request.CommandId);
        BurnStableOrderKey = DeriveId(
            "order.fireball.burn",
            request.CommandId);
        CooldownReadyTick = checked(
            request.RequestedTick +
            FireballReferenceScenario.CooldownDurationTicks);
    }

    public EntityId CommandId { get; }

    public SourceRef SkillSource { get; }

    public EntityId BundleId { get; }

    public EntityId SkillCommittedEventId { get; }

    public EntityId DamageCommittedEventId { get; }

    public EntityId BurnReactionId { get; }

    public EntityId BurnIdempotencyKey { get; }

    public EntityId BurnStableOrderKey { get; }

    public long CooldownReadyTick { get; }

    private static EntityId DeriveId(
        string prefix,
        EntityId commandId) =>
        new($"{prefix}.{commandId.Value}");
}

public static class FireballReferenceScenario
{
    public const long CastTick = 18_240;
    public const long CooldownDurationTicks = 60;
    public const long CooldownReadyTick =
        CastTick + CooldownDurationTicks;
    public const long InitialMana = 100;
    public const long ManaCost = 20;
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
        CreateExecutionIdentity(CreateSkillRequest())
            .SkillCommittedEventId;
    public static readonly EntityId DamageCommittedEventId =
        CreateExecutionIdentity(CreateSkillRequest())
            .DamageCommittedEventId;
    public static readonly EntityId DamageCommittedEventTypeId =
        new("event-type.damage-committed");
    public static readonly EntityId BurnReactionRuleId =
        new("reaction-rule.fireball.burn");
    public static readonly EntityId BurnReactionId =
        CreateExecutionIdentity(CreateSkillRequest())
            .BurnReactionId;
    public static readonly EntityId BurnIdempotencyKey =
        CreateExecutionIdentity(CreateSkillRequest())
            .BurnIdempotencyKey;

    public static SourceRef SkillSource =>
        CreateExecutionIdentity(CreateSkillRequest()).SkillSource;

    public static SkillRequest CreateSkillRequest() =>
        CreateSkillRequest(
            CommandId,
            CastTick,
            rootSeed: 61_710);

    public static SkillRequest CreateSkillRequest(
        EntityId commandId,
        long requestedTick,
        uint rootSeed) =>
        new(
            commandId,
            CasterId,
            SkillDefinitionId,
            TargetId,
            requestedTick,
            rootSeed);

    public static FireballExecutionIdentity CreateExecutionIdentity(
        SkillRequest request) =>
        new(request);

    public static EffectContext CreateEffectContext() =>
        CreateEffectContext(CreateSkillRequest());

    public static EffectContext CreateEffectContext(
        SkillRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var identity = CreateExecutionIdentity(request);
        return
        new(
            request.CasterId,
            request.TargetId,
            identity.SkillSource,
            RandomSeed: request.RootSeed);
    }

    public static DamageRequest CreateDamageRequest() =>
        CreateDamageRequest(CreateSkillRequest());

    public static DamageRequest CreateDamageRequest(
        SkillRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.TargetId is not { } targetId)
        {
            throw new ArgumentException(
                "The Fireball damage request requires an explicit target.",
                nameof(request));
        }

        var identity = CreateExecutionIdentity(request);
        return
        new(
            request.CasterId,
            targetId,
            identity.SkillSource,
            formulaId: FormulaId,
            damageType: "fire",
            baseValue: 24,
            coefficientBps: 12_000,
            tags: new[] { "spell", "fire" },
            seed: request.RootSeed);
    }

    public static CombatContext CreateCombatContext(
        HitOutcome outcome = HitOutcome.Hit,
        int availableTargetHp = 500,
        int availableShield = 40) =>
        new(
            scalingStatValue: 120m,
            outcome,
            critical: outcome == HitOutcome.Hit,
            criticalMultiplierBps: 15_000,
            resistanceBps: 2_000,
            availableShield,
            availableTargetHp: availableTargetHp);

    public static EffectBundle CreateEffectBundle(DamageRequest request)
        => CreateEffectBundle(
            CreateSkillRequest(),
            request);

    public static EffectBundle CreateEffectBundle(
        SkillRequest skillRequest,
        DamageRequest request)
    {
        ArgumentNullException.ThrowIfNull(skillRequest);
        ArgumentNullException.ThrowIfNull(request);
        var identity = CreateExecutionIdentity(skillRequest);
        if (request.Source != identity.SkillSource ||
            request.AttackerId != skillRequest.CasterId ||
            request.DefenderId != skillRequest.TargetId)
        {
            throw new ArgumentException(
                "The damage request must belong to the same Fireball execution.",
                nameof(request));
        }

        return new EffectBundle(
            identity.BundleId,
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
                    identity.BurnReactionId,
                    identity.BurnIdempotencyKey,
                    new EntityId("effect.apply-burn"),
                    priority: 100,
                    identity.BurnStableOrderKey,
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

    public static FireballResolveSnapshot CreateResolveSnapshot() =>
        new(
            mana: InitialMana,
            manaVersion: 4,
            cooldownReadyTick: 0,
            cooldownVersion: 2,
            targetShield: InitialShield,
            targetShieldVersion: 7,
            targetHealth: InitialHealth,
            targetHealthVersion: 7);

    internal static CommitPlan CreateCommitPlan(
        SkillRequest request,
        FireballResolveSnapshot snapshot,
        DamageResult result)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(result);
        if (request.CasterId != CasterId ||
            request.SkillId != SkillDefinitionId ||
            request.TargetId != TargetId)
        {
            throw new ArgumentException(
                "The reference Fireball plan requires its canonical caster, skill, and target.",
                nameof(request));
        }

        var identity = CreateExecutionIdentity(request);
        var targetHpAfter = Math.Max(
            0,
            snapshot.TargetHealth - result.FinalHpDamage);
        var targetShieldAfter =
            snapshot.TargetShield - result.ShieldAbsorbed;
        var mutations = new List<StateMutation>
        {
            new(
                ManaResourceId,
                checked(snapshot.Mana - ManaCost),
                $"Spend {ManaCost} mana"),
            new(
                CooldownResourceId,
                identity.CooldownReadyTick,
                $"Set Fireball ready tick to {identity.CooldownReadyTick}")
        };
        if (result.ShieldAbsorbed > 0)
        {
            mutations.Add(
                new StateMutation(
                    TargetShieldResourceId,
                    targetShieldAfter,
                    $"Absorb {result.ShieldAbsorbed} shield"));
        }

        if (result.FinalHpDamage > 0)
        {
            mutations.Add(
                new StateMutation(
                    TargetHealthResourceId,
                    targetHpAfter,
                    $"Lose {result.FinalHpDamage} health"));
        }

        return new CommitPlan(
            request.CommandId,
            new[]
            {
                new VersionPrecondition(
                    ManaResourceId,
                    snapshot.ManaVersion),
                new VersionPrecondition(
                    CooldownResourceId,
                    snapshot.CooldownVersion),
                new VersionPrecondition(
                    TargetShieldResourceId,
                    snapshot.TargetShieldVersion),
                new VersionPrecondition(
                    TargetHealthResourceId,
                    snapshot.TargetHealthVersion)
            },
            mutations,
            new DomainEvent[]
            {
                new SkillCommitted(
                    identity.SkillCommittedEventId,
                    request.CommandId,
                    request.CasterId,
                    request.SkillId,
                    request.TargetId,
                    identity.SkillSource,
                    ManaResourceId,
                    ManaCost,
                    CooldownResourceId,
                    identity.CooldownReadyTick),
                new DamageCommitted(
                    identity.DamageCommittedEventId,
                    request.CommandId,
                    request.CasterId,
                    TargetId,
                    identity.SkillSource,
                    result,
                    TargetHealthResourceId,
                    targetHpAfter,
                    TargetShieldResourceId,
                    targetShieldAfter)
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

        var damageOperations = bundle.Effects
            .OfType<DamageEffectOperation>()
            .ToArray();
        if (damageOperations.Length != 1)
        {
            throw new ArgumentException(
                "The Fireball reaction path requires exactly one damage operation.",
                nameof(bundle));
        }

        var plannedDamage = damageOperations[0].Request;
        if (plannedDamage.AttackerId != damage.AttackerId ||
            plannedDamage.DefenderId != damage.DefenderId ||
            plannedDamage.Source != damage.Source ||
            damage.Source.Kind != SourceKind.SkillExecution ||
            damage.Source.DefinitionId != SkillDefinitionId ||
            damage.Source.InstanceId is not { } commandId)
        {
            throw new ArgumentException(
                "The committed damage must belong to the supplied Fireball bundle.",
                nameof(committedEvent));
        }

        var identity = CreateExecutionIdentity(
            CreateSkillRequest(
                commandId,
                CastTick,
                rootSeed: 0));
        if (bundle.BundleId != identity.BundleId ||
            damage.EventId != identity.DamageCommittedEventId)
        {
            throw new ArgumentException(
                "The bundle and committed event IDs must derive from the same Fireball command.",
                nameof(committedEvent));
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
        if (reaction.Source.Kind != SourceKind.SkillExecution ||
            reaction.Source.DefinitionId != SkillDefinitionId ||
            reaction.Source.InstanceId is not { } commandId)
        {
            throw new ArgumentException(
                "Only a Fireball skill execution can create the Burn request.",
                nameof(reaction));
        }

        var identity = CreateExecutionIdentity(
            CreateSkillRequest(
                commandId,
                CastTick,
                rootSeed: 0));
        if (reaction.ReactionId != identity.BurnReactionId ||
            reaction.IdempotencyKey != identity.BurnIdempotencyKey ||
            reaction.StableOrderKey != identity.BurnStableOrderKey ||
            reaction.CausationId != identity.DamageCommittedEventId)
        {
            throw new ArgumentException(
                "The Burn reaction identities must derive from its Fireball command.",
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
