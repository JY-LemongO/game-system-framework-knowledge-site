using GameSystemKnowledge.Reference.Contracts;
using GameSystemKnowledge.Reference.Runtime;
using GameSystemKnowledge.Reference.Systems;

namespace GameSystemKnowledge.Reference.Verification;

internal static class Program
{
    private static int Main()
    {
        try
        {
            var suite = new ContractVerificationSuite();
            suite.Run();
            var foundationAssertions = FoundationContractVerification.Run();
            var advancedFoundationAssertions =
                AdvancedFoundationVerification.Run();
            var combatPolicyAssertions = CombatPolicyVerification.Run();
            var statusPolicyAssertions = StatusPolicyVerification.Run();
            Console.WriteLine(
                $"PASS: {suite.AssertionCount + foundationAssertions + advancedFoundationAssertions + combatPolicyAssertions + statusPolicyAssertions} contract assertions");
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"FAIL: {exception.Message}");
            Console.Error.WriteLine(exception);
            return 1;
        }
    }
}

internal sealed class ContractVerificationSuite
{
    public int AssertionCount { get; private set; }

    public void Run()
    {
        VerifyCanonicalIdsAndSources();
        VerifyStatContracts();
        VerifySkillContracts();
        VerifySkillAdmissionAndPlanning();
        VerifyEffectAndStatusContracts();
        VerifyFireballCalculation();
        VerifyCommitAndReactionContracts();
        VerifyFireballExecutionIsolationAndNonHit();
        VerifyLiveTargetStatusReactionPolicy();
        VerifyReactionBoundsAndOrder();
        VerifyStatusCatchUpPolicy();
    }

    private void VerifyCanonicalIdsAndSources()
    {
        var canonicalId = new EntityId("skill.fireball");
        True(canonicalId.IsValid, "constructed EntityId is valid");
        Equal("skill.fireball", canonicalId.Value, "canonical namespaced ID");
        Equal(
            "status-instance.rage_001",
            new EntityId("status-instance.rage_001").Value,
            "hyphenated namespace and underscored local ID are valid");
        Throws<ArgumentException>(() => _ = new EntityId("player_001"), "ID without namespace is rejected");
        Throws<ArgumentException>(() => _ = new EntityId("Skill.Fireball"), "non-canonical casing is rejected");
        Throws<ArgumentException>(() => _ = new EntityId("skill..fireball"), "empty ID segment is rejected");
        Throws<ArgumentException>(
            () => _ = new EntityId("status_instance.rage_001"),
            "namespace segment cannot contain underscores");

        True(
            !EntityId.TryCreate("not-namespaced", out var invalidParsedId),
            "TryCreate reports an invalid ID");
        True(!invalidParsedId.IsValid, "failed TryCreate returns an explicit invalid sentinel");
        var defaultId = default(EntityId);
        True(!defaultId.IsValid, "default EntityId is invalid");
        Throws<InvalidOperationException>(
            () => _ = defaultId.Value,
            "default EntityId value access fails fast");
        Throws<InvalidOperationException>(
            () => _ = defaultId.ToString(),
            "default EntityId cannot silently format as an empty ID");

        var statusDefinitionId = new EntityId("status.rage");
        var statusInstanceId = new EntityId("status-instance.rage_001");
        var statusSource = SourceRef.Status(statusDefinitionId, statusInstanceId);
        Equal(statusInstanceId, statusSource.StatusInstanceId, "status source retains StatusInstanceId");
        Throws<ArgumentException>(
            () => _ = new SourceRef(SourceKind.Status, statusDefinitionId),
            "status source cannot omit StatusInstanceId");
        Throws<ArgumentException>(
            () => _ = SourceRef.Status(statusDefinitionId, default),
            "status source rejects a default instance ID");
        Throws<ArgumentException>(
            () => _ = SourceRef.System(default),
            "system source rejects a default definition ID");
        True(!default(SourceRef).IsValid, "default SourceRef is invalid");

        var skillSource = FireballReferenceScenario.SkillSource;
        Equal(SourceKind.SkillExecution, skillSource.Kind, "skill source identifies an execution");
        Equal(FireballReferenceScenario.CommandId, skillSource.InstanceId, "skill source retains command instance");
        Throws<ArgumentException>(
            () => _ = new SourceRef(SourceKind.SkillExecution, FireballReferenceScenario.SkillDefinitionId),
            "skill execution source cannot omit command instance");
    }

    private void VerifyStatContracts()
    {
        var targetStatus = new EntityId("status.burn");
        var skillTags = new[] { "magic" };
        var targetTags = new[] { "enemy" };
        var targetStatuses = new[] { targetStatus };
        var context = new StatContext(
            FireballReferenceScenario.CasterId,
            FireballReferenceScenario.TargetId,
            FireballReferenceScenario.SkillDefinitionId,
            skillTags,
            targetTags,
            targetStatuses,
            distance: 8m,
            moment: "before-damage");

        skillTags[0] = "mutated";
        targetTags[0] = "mutated";
        targetStatuses[0] = new EntityId("status.freeze");
        Equal("magic", context.SkillTags[0], "StatContext defensively copies skill tags");
        Equal("enemy", context.TargetTags[0], "StatContext defensively copies target tags");
        Equal(targetStatus, context.TargetStatuses[0], "StatContext defensively copies status IDs");
        Equal(FireballReferenceScenario.CasterId, context.OwnerId, "StatContext retains owner");
        Equal(FireballReferenceScenario.TargetId, context.TargetId, "StatContext retains target");
        Equal(8m, context.Distance, "StatContext retains distance");
        Equal("before-damage", context.Moment, "StatContext retains query moment");

        var otherOwnerId = new EntityId("entity.other");
        var statId = new EntityId("stat.spell-power");
        var statValues = new Dictionary<(EntityId OwnerId, EntityId StatId), decimal>
        {
            [(FireballReferenceScenario.CasterId, statId)] = 120m,
            [(otherOwnerId, statId)] = 10m
        };
        IStatQuery query = new DictionaryStatQuery(statValues);
        Equal(120m, query.GetValue(FireballReferenceScenario.CasterId, statId, context), "stat lookup uses ownerId");
        statValues[(FireballReferenceScenario.CasterId, statId)] = 999m;
        Equal(120m, query.GetValue(FireballReferenceScenario.CasterId, statId, context), "stat lookup is isolated from source dictionary mutation");
        Throws<ArgumentException>(
            () => query.GetValue(otherOwnerId, statId, context),
            "stat query rejects an owner that differs from its context");
        Throws<ArgumentException>(
            () => query.GetValue(default, statId, context),
            "stat query rejects a default owner ID");
        var otherContext = new StatContext(
            otherOwnerId,
            FireballReferenceScenario.TargetId,
            FireballReferenceScenario.SkillDefinitionId);
        Equal(10m, query.GetValue(otherOwnerId, statId, otherContext), "owners do not share stats");
        SequenceEqual(
            new[]
            {
                ModifierOperation.Add,
                ModifierOperation.PercentAdd,
                ModifierOperation.More,
                ModifierOperation.Less,
                ModifierOperation.Override
            },
            Enum.GetValues<ModifierOperation>(),
            "modifier enum matches the learning contract");

        var statusInstanceId = new EntityId("status-instance.rage.0001");
        var modifier = new StatModifier(
            new EntityId("modifier.rage.attack-power"),
            new EntityId("stat.attack-power"),
            ModifierOperation.PercentAdd,
            0.20m,
            SourceRef.Status(new EntityId("status.rage"), statusInstanceId),
            priority: 10,
            new EntityId("stack-rule.stack"));
        Equal(statusInstanceId, modifier.StatusInstanceId, "modifier is removable by StatusInstanceId");
        True(modifier.AppliesTo(context), "modifier without a condition applies");
    }

    private void VerifySkillContracts()
    {
        var request = FireballReferenceScenario.CreateSkillRequest();
        Equal(FireballReferenceScenario.CommandId, request.CommandId, "skill request keeps its idempotent command identity");
        Equal(FireballReferenceScenario.CasterId, request.CasterId, "skill request keeps caster");
        Equal(FireballReferenceScenario.TargetId, request.TargetId, "Fireball has one explicit target");
        Equal(FireballReferenceScenario.SkillDefinitionId, request.SkillId, "skill request uses a typed skill ID");
        Equal(FireballReferenceScenario.CastTick, request.RequestedTick, "skill request keeps the simulation tick");
        Equal(61_710u, request.RootSeed, "skill request keeps the replay seed");
        Throws<ArgumentException>(
            () => _ = new SkillRequest(
                default,
                FireballReferenceScenario.CasterId,
                FireballReferenceScenario.SkillDefinitionId,
                FireballReferenceScenario.TargetId,
                FireballReferenceScenario.CastTick,
                rootSeed: 1),
            "skill request rejects a default command ID");
        Throws<ArgumentException>(
            () => _ = new SkillRequest(
                FireballReferenceScenario.CommandId,
                default,
                FireballReferenceScenario.SkillDefinitionId,
                FireballReferenceScenario.TargetId,
                FireballReferenceScenario.CastTick,
                rootSeed: 1),
            "skill request rejects a default caster ID");
        Equal<SkillFailureReason?>(null, SkillDecision.Accepted().FailureReason, "accepted decision has no failure reason");
        Equal(
            SkillFailureReason.Cooldown,
            SkillDecision.Rejected(SkillFailureReason.Cooldown).FailureReason,
            "cooldown failure is canonical");
        Equal(
            SkillFailureReason.ControlLocked,
            SkillDecision.Rejected(SkillFailureReason.ControlLocked).FailureReason,
            "control-lock failure is canonical");
        Equal<SkillDecision?>(
            null,
            default(SkillDecision),
            "default SkillDecision cannot create an invalid decision instance");
        SequenceEqual(
            new[]
            {
                SkillFailureReason.NotLearned,
                SkillFailureReason.OutOfResource,
                SkillFailureReason.Cooldown,
                SkillFailureReason.ControlLocked,
                SkillFailureReason.InvalidTarget,
                SkillFailureReason.Interrupted
            },
            Enum.GetValues<SkillFailureReason>(),
            "failure enum matches the learning contract");
        Throws<ArgumentOutOfRangeException>(
            () => _ = SkillDecision.Rejected((SkillFailureReason)int.MaxValue),
            "skill decision rejects an undefined failure reason");
        Throws<ArgumentException>(
            () => _ = new SkillDecision(true, SkillFailureReason.Cooldown),
            "accepted decision rejects a failure reason");
        Throws<ArgumentException>(
            () => _ = new SkillDecision(false, null),
            "rejected decision requires a failure reason");

        var effectResult = new EffectOperationResult(
            Succeeded: true,
            OperationId: new EntityId("effect-operation.verify.skill-result"));
        var skillResult = new SkillResult(
            succeeded: true,
            failureReason: null,
            effects: new[] { effectResult });
        True(skillResult.Succeeded, "successful skill result is explicit");
        Equal(1, skillResult.Effects.Count, "skill result keeps immutable effect results");
        Throws<ArgumentException>(
            () => _ = new SkillResult(true, SkillFailureReason.Cooldown),
            "successful skill result rejects a failure reason");
        Throws<ArgumentException>(
            () => _ = new SkillResult(false, null),
            "failed skill result requires a failure reason");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new SkillResult(
                succeeded: false,
                failureReason: (SkillFailureReason)int.MaxValue),
            "skill result rejects an undefined failure reason");
        Throws<ArgumentException>(
            () => _ = new SkillResult(
                succeeded: true,
                failureReason: null,
                effects: new EffectResult[] { null! }),
            "skill result rejects a null effect result");
        Throws<ArgumentException>(
            () => _ = new SkillResult(
                succeeded: false,
                failureReason: SkillFailureReason.Interrupted,
                effects: new[] { effectResult }),
            "failed skill result cannot expose committed effects");
    }

    private void VerifySkillAdmissionAndPlanning()
    {
        var request = FireballReferenceScenario.CreateSkillRequest();
        var readyBefore = new SkillAdmissionSnapshot(
            FireballReferenceScenario.TargetId,
            targetHealth: 1,
            cooldownReadyTick: request.RequestedTick - 1,
            availableResource: FireballReferenceScenario.ManaCost);
        var readyBeforeDecision = SkillAdmissionPolicy.Evaluate(
            request,
            readyBefore,
            FireballReferenceScenario.ManaCost);
        True(
            readyBeforeDecision.CanExecute,
            "a cooldown ready before the requested tick is admitted");

        var readyExactly = new SkillAdmissionSnapshot(
            FireballReferenceScenario.TargetId,
            targetHealth: 1,
            cooldownReadyTick: request.RequestedTick,
            availableResource: FireballReferenceScenario.ManaCost);
        True(
            SkillAdmissionPolicy.Evaluate(
                request,
                readyExactly,
                FireballReferenceScenario.ManaCost).CanExecute,
            "readyTick equal to RequestedTick is admitted");

        var readyAfter = new SkillAdmissionSnapshot(
            FireballReferenceScenario.TargetId,
            targetHealth: 1,
            cooldownReadyTick: request.RequestedTick + 1,
            availableResource: FireballReferenceScenario.ManaCost);
        Equal(
            SkillFailureReason.Cooldown,
            SkillAdmissionPolicy.Evaluate(
                request,
                readyAfter,
                FireballReferenceScenario.ManaCost).FailureReason,
            "readyTick after RequestedTick is rejected as Cooldown");

        var simultaneousFailure = new SkillAdmissionSnapshot(
            FireballReferenceScenario.TargetId,
            targetHealth: 1,
            cooldownReadyTick: request.RequestedTick + 1,
            availableResource: FireballReferenceScenario.ManaCost - 1);
        Equal(
            SkillFailureReason.Cooldown,
            SkillAdmissionPolicy.Evaluate(
                request,
                simultaneousFailure,
                FireballReferenceScenario.ManaCost).FailureReason,
            "Cooldown wins when cooldown and mana fail together");

        var deadTarget = new SkillAdmissionSnapshot(
            FireballReferenceScenario.TargetId,
            targetHealth: 0,
            cooldownReadyTick: request.RequestedTick + 1,
            availableResource: 0);
        Equal(
            SkillFailureReason.InvalidTarget,
            SkillAdmissionPolicy.Evaluate(
                request,
                deadTarget,
                FireballReferenceScenario.ManaCost).FailureReason,
            "a dead target wins over cooldown and resource failures");

        var insufficientMana = new SkillAdmissionSnapshot(
            FireballReferenceScenario.TargetId,
            targetHealth: 1,
            cooldownReadyTick: request.RequestedTick,
            availableResource: FireballReferenceScenario.ManaCost - 1);
        Equal(
            SkillFailureReason.OutOfResource,
            SkillAdmissionPolicy.Evaluate(
                request,
                insufficientMana,
                FireballReferenceScenario.ManaCost).FailureReason,
            "mana is checked only after target and cooldown pass");
        Equal(
            request.RequestedTick - 1,
            readyBefore.CooldownReadyTick,
            "pure admission leaves the cooldown snapshot unchanged");
        Equal(
            FireballReferenceScenario.ManaCost,
            readyBefore.AvailableResource,
            "pure admission leaves the resource snapshot unchanged");
        Throws<ArgumentException>(
            () => _ = new SkillAdmissionSnapshot(
                default,
                targetHealth: 1,
                cooldownReadyTick: 0,
                availableResource: 0),
            "skill admission snapshot rejects a default target ID");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new SkillAdmissionSnapshot(
                FireballReferenceScenario.TargetId,
                targetHealth: 1,
                cooldownReadyTick: 0,
                availableResource: -1),
            "skill admission snapshot rejects a negative resource value");

        var resolveSnapshot = FireballReferenceScenario.CreateResolveSnapshot();
        var countingResolver = new CountingCombatResolver(new CombatResolver());
        var planning = FireballSkillPlanner.ResolveAndPlan(
            request,
            resolveSnapshot,
            countingResolver);
        True(planning.Decision.CanExecute, "the canonical Fireball snapshot is admitted");
        Equal(1, countingResolver.CallCount, "combat resolution runs once after admission");
        var plan = planning.Plan ??
            throw new InvalidOperationException("An admitted Fireball must carry a commit plan.");
        var expectedVersions = new Dictionary<EntityId, long>
        {
            [FireballReferenceScenario.ManaResourceId] =
                resolveSnapshot.ManaVersion,
            [FireballReferenceScenario.CooldownResourceId] =
                resolveSnapshot.CooldownVersion,
            [FireballReferenceScenario.TargetShieldResourceId] =
                resolveSnapshot.TargetShieldVersion,
            [FireballReferenceScenario.TargetHealthResourceId] =
                resolveSnapshot.TargetHealthVersion
        };
        foreach (var precondition in plan.Preconditions)
        {
            Equal(
                expectedVersions[precondition.ResourceId],
                precondition.ExpectedVersion,
                "the commit plan preserves each resolve-snapshot version");
        }

        var customSnapshot = new FireballResolveSnapshot(
            mana: 90,
            manaVersion: 11,
            cooldownReadyTick: request.RequestedTick - 10,
            cooldownVersion: 13,
            targetShield: 20,
            targetShieldVersion: 17,
            targetHealth: 300,
            targetHealthVersion: 19);
        var customPlanning = FireballSkillPlanner.ResolveAndPlan(
            request,
            customSnapshot,
            new CombatResolver());
        var customPlan = customPlanning.Plan ??
            throw new InvalidOperationException("A ready custom snapshot must produce a plan.");
        var customExpectedVersions = new Dictionary<EntityId, long>
        {
            [FireballReferenceScenario.ManaResourceId] = 11,
            [FireballReferenceScenario.CooldownResourceId] = 13,
            [FireballReferenceScenario.TargetShieldResourceId] = 17,
            [FireballReferenceScenario.TargetHealthResourceId] = 19
        };
        foreach (var precondition in customPlan.Preconditions)
        {
            Equal(
                customExpectedVersions[precondition.ResourceId],
                precondition.ExpectedVersion,
                "non-default resolve versions flow into the commit boundary");
        }

        var customCommitter = new InMemoryRuntimeCommitter(
            new[]
            {
                new VersionedResourceState(
                    FireballReferenceScenario.ManaResourceId,
                    customSnapshot.Mana,
                    customSnapshot.ManaVersion),
                new VersionedResourceState(
                    FireballReferenceScenario.CooldownResourceId,
                    customSnapshot.CooldownReadyTick,
                    customSnapshot.CooldownVersion),
                new VersionedResourceState(
                    FireballReferenceScenario.TargetShieldResourceId,
                    customSnapshot.TargetShield,
                    customSnapshot.TargetShieldVersion),
                new VersionedResourceState(
                    FireballReferenceScenario.TargetHealthResourceId,
                    customSnapshot.TargetHealth,
                    customSnapshot.TargetHealthVersion)
            });
        Equal(
            CommitStatus.Committed,
            customCommitter.Commit(customPlan).Status,
            "a plan produced from a non-default snapshot commits against that snapshot");
        Equal(
            70L,
            customCommitter.GetValue(FireballReferenceScenario.ManaResourceId),
            "the plan spends mana from the captured value instead of a fixture constant");
        Equal(
            118L,
            customCommitter.GetValue(FireballReferenceScenario.TargetHealthResourceId),
            "the plan applies damage to the captured target health");

        var rejectedResolver = new CountingCombatResolver(new CombatResolver());
        var rejectedPlanning = FireballSkillPlanner.ResolveAndPlan(
            request,
            new FireballResolveSnapshot(
                mana: FireballReferenceScenario.ManaCost - 1,
                manaVersion: resolveSnapshot.ManaVersion,
                cooldownReadyTick: request.RequestedTick + 1,
                cooldownVersion: resolveSnapshot.CooldownVersion,
                targetShield: resolveSnapshot.TargetShield,
                targetShieldVersion: resolveSnapshot.TargetShieldVersion,
                targetHealth: resolveSnapshot.TargetHealth,
                targetHealthVersion: resolveSnapshot.TargetHealthVersion),
            rejectedResolver);
        Equal(
            SkillFailureReason.Cooldown,
            rejectedPlanning.Decision.FailureReason,
            "the planner keeps canonical failure precedence");
        Equal<CommitPlan?>(null, rejectedPlanning.Plan, "a rejected cast has no commit plan");
        Equal(
            0,
            rejectedResolver.CallCount,
            "cooldown rejection happens before combat resolution and RNG consumption");

        var committer = new InMemoryRuntimeCommitter(
            FireballReferenceScenario.CreateInitialState());
        var cooldownInterleaving = new CommitPlan(
            new EntityId("command.external.cooldown-interleaving"),
            new[]
            {
                new VersionPrecondition(
                    FireballReferenceScenario.CooldownResourceId,
                    resolveSnapshot.CooldownVersion)
            },
            new[]
            {
                new StateMutation(
                    FireballReferenceScenario.CooldownResourceId,
                    request.RequestedTick + 1,
                    "Apply an external cooldown before Fireball commit")
            });
        Equal(
            CommitStatus.Committed,
            committer.Commit(cooldownInterleaving).Status,
            "the concurrent cooldown-only change commits first");

        var staleFireball = committer.Commit(plan);
        Equal(
            CommitStatus.PreconditionFailed,
            staleFireball.Status,
            "a cooldown-only interleaving rejects the whole Fireball plan");
        Equal(
            FireballReferenceScenario.InitialMana,
            committer.GetValue(FireballReferenceScenario.ManaResourceId),
            "the rejected Fireball spends no mana");
        Equal(
            FireballReferenceScenario.InitialHealth,
            committer.GetValue(FireballReferenceScenario.TargetHealthResourceId),
            "the rejected Fireball applies no target damage");
        Equal(
            FireballReferenceScenario.InitialShield,
            committer.GetValue(FireballReferenceScenario.TargetShieldResourceId),
            "the rejected Fireball consumes no shield");
        Equal(
            request.RequestedTick + 1,
            committer.GetValue(FireballReferenceScenario.CooldownResourceId),
            "the rejected Fireball preserves the concurrent cooldown value");
        Equal(
            0,
            committer.GetOutbox().Count,
            "the rejected Fireball appends no outbox event");
    }

    private void VerifyEffectAndStatusContracts()
    {
        var effectContext = FireballReferenceScenario.CreateEffectContext();
        Equal(FireballReferenceScenario.CasterId, effectContext.CasterId, "effect context keeps caster");
        Equal(FireballReferenceScenario.TargetId, effectContext.InitialTargetId, "effect context keeps initial target");
        Equal(FireballReferenceScenario.SkillSource, effectContext.Source, "effect context keeps structured source");
        Equal(61_710u, effectContext.RandomSeed, "effect context keeps deterministic seed");
        var (deconstructedCasterId, _, _, deconstructedSeed) = effectContext;
        Equal(FireballReferenceScenario.CasterId, deconstructedCasterId, "effect context retains positional deconstruction");
        Equal(61_710u, deconstructedSeed, "effect context deconstruction retains the seed");
        Throws<ArgumentException>(
            () => _ = new EffectContext(
                default,
                FireballReferenceScenario.TargetId,
                FireballReferenceScenario.SkillSource,
                RandomSeed: 1),
            "effect context rejects a default caster ID");
        Throws<ArgumentException>(
            () => _ = new EffectContext(
                FireballReferenceScenario.CasterId,
                default(EntityId),
                FireballReferenceScenario.SkillSource,
                RandomSeed: 1),
            "effect context rejects a default target ID");
        Throws<ArgumentException>(
            () => _ = new EffectContext(
                FireballReferenceScenario.CasterId,
                FireballReferenceScenario.TargetId,
                default,
                RandomSeed: 1),
            "effect context rejects a default source");
        Throws<ArgumentException>(
            () => _ = effectContext with { CasterId = default },
            "effect context rejects a default caster ID through record copy syntax");

        var damageRequest = FireballReferenceScenario.CreateDamageRequest();
        var damageOperation = new DamageEffectOperation(
            new EntityId("effect.verify.copy-guard"),
            damageRequest);
        Throws<ArgumentException>(
            () => _ = new DamageEffectOperation(default, damageRequest),
            "effect operation rejects a default operation ID");
        Throws<ArgumentException>(
            () => _ = damageOperation with { OperationId = default },
            "effect operation rejects a default operation ID through record copy syntax");
        var validOperationResult = new EffectOperationResult(
            Succeeded: true,
            OperationId: damageOperation.OperationId);
        Throws<ArgumentException>(
            () => _ = new EffectOperationResult(true, default),
            "effect operation result rejects a default operation ID");
        Throws<ArgumentException>(
            () => _ = validOperationResult with { OperationId = default },
            "effect operation result rejects a default ID through record copy syntax");
        var bundle = FireballReferenceScenario.CreateEffectBundle(damageRequest);
        Equal(EffectExecutionPolicy.CommitThenReact, bundle.Policy, "effect bundle uses CommitThenReact");
        Equal(1, bundle.Effects.Count, "Fireball bundle carries one primary damage effect");
        Equal(1, bundle.Reactions.Count, "Fireball bundle carries one Burn reaction rule");
        Throws<ArgumentException>(
            () => _ = new EffectBundle(default, bundle.Effects),
            "effect bundle rejects a default bundle ID");

        var plan = new EffectBundlePlan(
            bundle.BundleId,
            bundle.Effects,
            bundle.Reactions);
        Equal(bundle.BundleId, plan.BundleId, "effect plan keeps its bundle identity");
        Equal(1, plan.PrimaryOperations.Count, "effect plan keeps target-resolved primary operations");
        Equal(1, plan.Reactions.Count, "effect plan keeps post-commit reaction rules");
        Throws<ArgumentException>(
            () => _ = new EffectBundlePlan(
                bundle.BundleId,
                Array.Empty<EffectOperation>()),
            "effect plan requires at least one primary operation");
        Equal(
            FireballReferenceScenario.DamageCommittedEventTypeId,
            bundle.Reactions[0].TriggerEventTypeId,
            "Burn rule listens to a committed damage fact");
        Equal(new EntityId("effect.apply-burn"), bundle.Reactions[0].HandlerId, "Burn uses the Effect handler");
        True(bundle.Reactions[0].RequiresHit, "Burn rule requires Hit");
        True(bundle.Reactions[0].RequiresTargetAlive, "Burn rule requires a living target");

        var committedBundle = new EffectBundleResult(
            committed: true,
            bundle.BundleId,
            appliedEffectCount: 1,
            queuedReactionCount: 1);
        True(committedBundle.Committed, "committed effect bundle result is explicit");
        Equal(1, committedBundle.AppliedEffectCount, "committed bundle reports applied effects");
        Equal(1, committedBundle.QueuedReactionCount, "committed bundle reports queued reactions");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new EffectBundleResult(true, bundle.BundleId, -1, 0),
            "effect bundle result rejects a negative applied count");
        Throws<ArgumentException>(
            () => _ = new EffectBundleResult(false, bundle.BundleId, 1, 0),
            "uncommitted effect bundle cannot report applied work");
        Throws<ArgumentException>(
            () => _ = new EffectBundleResult(true, default, 0, 0),
            "effect bundle result rejects a default bundle ID");

        var applyStatus = new ApplyStatusRequest(
            FireballReferenceScenario.BurnDefinitionId,
            FireballReferenceScenario.TargetId,
            FireballReferenceScenario.SkillSource,
            stackDelta: 1);
        Equal(FireballReferenceScenario.BurnDefinitionId, applyStatus.StatusId, "status ID is explicit");
        Equal(FireballReferenceScenario.TargetId, applyStatus.TargetId, "status target is explicit");
        Equal(1, applyStatus.StackDelta, "status stack delta is explicit");
        Equal(6, FireballReferenceScenario.BurnDurationTicks, "Burn duration is six ticks");
        Equal(2, FireballReferenceScenario.BurnTickInterval, "Burn ticks every two ticks");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new ApplyStatusRequest(
                FireballReferenceScenario.BurnDefinitionId,
                FireballReferenceScenario.TargetId,
                FireballReferenceScenario.SkillSource,
                stackDelta: 0),
            "status request must add a positive stack count");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new ApplyStatusRequest(
                FireballReferenceScenario.BurnDefinitionId,
                FireballReferenceScenario.TargetId,
                FireballReferenceScenario.SkillSource,
                stackDelta: -1),
            "status stack removal uses a separate command");
        Throws<ArgumentException>(
            () => _ = new ApplyStatusRequest(
                default,
                FireballReferenceScenario.TargetId,
                FireballReferenceScenario.SkillSource,
                stackDelta: 1),
            "status request rejects a default status ID");

        var applied = StatusResult.Applied(new EntityId("status-instance.burn.0001"));
        True(applied.Succeeded, "applied status result succeeds");
        Equal(new EntityId("status-instance.burn.0001"), applied.StatusInstanceId, "applied status returns its instance");
        Equal<StatusRemoveReason?>(null, applied.RemoveReason, "applied status has no removal reason");
        Equal<StatusFailureReason?>(null, applied.FailureReason, "applied status has no failure reason");
        Throws<ArgumentException>(
            () => _ = StatusResult.Applied(default),
            "status result rejects a default instance ID");

        var removed = StatusResult.Removed(
            new EntityId("status-instance.burn.0001"),
            StatusRemoveReason.Dispelled);
        True(removed.Succeeded, "removed status result succeeds");
        Equal<StatusRemoveReason?>(StatusRemoveReason.Dispelled, removed.RemoveReason, "removed status keeps its reason");

        var failed = StatusResult.Failed(StatusFailureReason.Immune);
        True(!failed.Succeeded, "failed status result is explicit");
        Equal<StatusFailureReason?>(StatusFailureReason.Immune, failed.FailureReason, "failed status keeps its reason");
        Equal<EntityId?>(null, failed.StatusInstanceId, "failed status cannot expose an instance");
        Throws<ArgumentOutOfRangeException>(
            () => _ = StatusResult.Removed(
                new EntityId("status-instance.burn.0001"),
                (StatusRemoveReason)int.MaxValue),
            "removed status rejects an undefined removal reason");
        Throws<ArgumentOutOfRangeException>(
            () => _ = StatusResult.Failed((StatusFailureReason)int.MaxValue),
            "failed status rejects an undefined failure reason");
    }

    private void VerifyFireballCalculation()
    {
        ICombatResolver resolver = new CombatResolver();
        var request = FireballReferenceScenario.CreateDamageRequest();
        Equal(FireballReferenceScenario.FormulaId, request.FormulaId, "Fireball uses a typed formula ID");
        Equal(FireballReferenceScenario.CasterId, request.AttackerId, "Fireball fixture uses entity.caster");
        Equal(FireballReferenceScenario.TargetId, request.DefenderId, "Fireball fixture uses entity.target");
        SequenceEqual(
            new[] { "fire", "spell" },
            request.Tags,
            "damage tags are canonicalized with ordinal ordering");
        var equivalentTagRequest = new DamageRequest(
            FireballReferenceScenario.CasterId,
            FireballReferenceScenario.TargetId,
            FireballReferenceScenario.SkillSource,
            FireballReferenceScenario.FormulaId,
            "fire",
            baseValue: 1,
            coefficientBps: 0,
            tags: new[] { "spell", "fire", "spell" },
            seed: 1);
        True(
            request.Tags.Equals(equivalentTagRequest.Tags),
            "damage tag identity ignores input order and duplicates");
        Throws<ArgumentException>(
            () => _ = new DamageRequest(
                FireballReferenceScenario.CasterId,
                FireballReferenceScenario.TargetId,
                FireballReferenceScenario.SkillSource,
                FireballReferenceScenario.FormulaId,
                "fire",
                baseValue: 1,
                coefficientBps: 0,
                tags: new[] { "Fire" },
                seed: 1),
            "damage tags reject non-canonical casing");
        Throws<ArgumentException>(
            () => _ = new DamageRequest(
                FireballReferenceScenario.CasterId,
                FireballReferenceScenario.TargetId,
                FireballReferenceScenario.SkillSource,
                FireballReferenceScenario.FormulaId,
                "Fire",
                baseValue: 1,
                coefficientBps: 0,
                tags: Array.Empty<string>(),
                seed: 1),
            "damage type uses the same canonical tag grammar");
        Throws<ArgumentException>(
            () => _ = new DamageRequest(
                FireballReferenceScenario.CasterId,
                FireballReferenceScenario.TargetId,
                default,
                FireballReferenceScenario.FormulaId,
                "fire",
                baseValue: 1,
                coefficientBps: 0,
                Array.Empty<string>(),
                seed: 1),
            "damage request rejects a default source");

        var formulaDamage = RoundDamage(
            request.BaseValue +
            (FireballReferenceScenario.CreateCombatContext().ScalingStatValue *
             request.CoefficientBps / 10_000m));
        Equal(168, formulaDamage, "Fireball base formula stage");

        var result = resolver.Resolve(request, FireballReferenceScenario.CreateCombatContext());
        Equal(HitOutcome.Hit, result.Outcome, "Fireball resolves as Hit");
        Equal(252, result.RawDamage, "raw damage includes the critical stage");
        Equal(202, result.ResolvedDamage, "Fireball resistance result");
        Equal(40, result.ShieldAbsorbed, "Fireball shield absorption");
        Equal(162, result.FinalHpDamage, "Fireball health damage");
        Equal(0, result.Overkill, "normal Fireball has no overkill");
        Equal(
            result.ResolvedDamage,
            result.ShieldAbsorbed + result.FinalHpDamage + result.Overkill,
            "damage conservation includes overkill");
        Throws<ArgumentException>(
            () => _ = new DamageResult(HitOutcome.Miss, true, 1, 1, 0, 1, 0),
            "compact non-Hit damage result rejects critical and nonzero damage");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new DamageResult(
                (HitOutcome)int.MaxValue,
                false,
                0,
                0,
                0,
                0,
                0),
            "damage result rejects an undefined hit outcome");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new CombatContext(
                scalingStatValue: 0m,
                outcome: (HitOutcome)int.MaxValue,
                critical: false,
                criticalMultiplierBps: 10_000,
                resistanceBps: 0,
                availableShield: 0,
                availableTargetHp: 1),
            "combat context rejects an undefined hit outcome");
        Throws<ArgumentException>(
            () => _ = new CombatContext(
                scalingStatValue: 0m,
                outcome: HitOutcome.Blocked,
                critical: true,
                criticalMultiplierBps: 10_000,
                resistanceBps: 0,
                availableShield: 0,
                availableTargetHp: 1),
            "non-Hit combat context rejects a critical flag");
        Throws<ArgumentException>(
            () => _ = new DamageResult(
                HitOutcome.Hit,
                false,
                int.MaxValue,
                0,
                int.MaxValue,
                int.MaxValue,
                2),
            "damage conservation uses a widened sum and cannot pass through integer overflow");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new DamageRequest(
                FireballReferenceScenario.CasterId,
                FireballReferenceScenario.TargetId,
                FireballReferenceScenario.SkillSource,
                FireballReferenceScenario.FormulaId,
                "fire",
                baseValue: 0,
                coefficientBps: 100_001,
                tags: Array.Empty<string>(),
                seed: 1),
            "compact coefficient uses the shared zero-to-one-hundred-thousand BPS range");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new CombatContext(
                scalingStatValue: 0m,
                outcome: HitOutcome.Hit,
                critical: false,
                criticalMultiplierBps: 9_999,
                resistanceBps: 0,
                availableShield: 0,
                availableTargetHp: 1),
            "compact critical multiplier cannot reduce a critical below one hundred percent");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new CombatContext(
                scalingStatValue: 0m,
                outcome: HitOutcome.Hit,
                critical: false,
                criticalMultiplierBps: 100_001,
                resistanceBps: 0,
                availableShield: 0,
                availableTargetHp: 1),
            "compact critical multiplier uses the shared one-to-ten-times range");
        var extremeCoefficientRequest = new DamageRequest(
            FireballReferenceScenario.CasterId,
            FireballReferenceScenario.TargetId,
            FireballReferenceScenario.SkillSource,
            FireballReferenceScenario.FormulaId,
            "fire",
            baseValue: 0,
            coefficientBps: 100_000,
            tags: Array.Empty<string>(),
            seed: 1);
        var extremeScalingContext = new CombatContext(
            decimal.MaxValue,
            HitOutcome.Hit,
            critical: false,
            criticalMultiplierBps: 10_000,
            resistanceBps: 0,
            availableShield: 0,
            availableTargetHp: int.MaxValue);
        Throws<OverflowException>(
            () => resolver.Resolve(extremeCoefficientRequest, extremeScalingContext),
            "extreme coefficient math fails instead of wrapping decimal damage");
        var extremeCriticalContext = new CombatContext(
            scalingStatValue: 0m,
            outcome: HitOutcome.Hit,
            critical: true,
            criticalMultiplierBps: 100_000,
            resistanceBps: 0,
            availableShield: 0,
            availableTargetHp: int.MaxValue);
        Throws<OverflowException>(
            () => resolver.Resolve(
                new DamageRequest(
                    FireballReferenceScenario.CasterId,
                    FireballReferenceScenario.TargetId,
                    FireballReferenceScenario.SkillSource,
                    FireballReferenceScenario.FormulaId,
                    "fire",
                    baseValue: int.MaxValue,
                    coefficientBps: 0,
                    tags: Array.Empty<string>(),
                    seed: 1),
                extremeCriticalContext),
            "damage outside Int32 range fails during the documented conversion boundary");
        var widenedMitigation = resolver.Resolve(
            new DamageRequest(
                FireballReferenceScenario.CasterId,
                FireballReferenceScenario.TargetId,
                FireballReferenceScenario.SkillSource,
                FireballReferenceScenario.FormulaId,
                "fire",
                baseValue: int.MaxValue,
                coefficientBps: 0,
                tags: Array.Empty<string>(),
                seed: 1),
            new CombatContext(
                scalingStatValue: 0m,
                outcome: HitOutcome.Hit,
                critical: false,
                criticalMultiplierBps: 10_000,
                resistanceBps: 1,
                availableShield: 0,
                availableTargetHp: int.MaxValue));
        Equal(
            RoundDamage((decimal)int.MaxValue * 9_999m / 10_000m),
            widenedMitigation.ResolvedDamage,
            "mitigation widens integer operands before multiplication");
        var fractionalPipeline = resolver.Resolve(
            new DamageRequest(
                FireballReferenceScenario.CasterId,
                FireballReferenceScenario.TargetId,
                FireballReferenceScenario.SkillSource,
                FireballReferenceScenario.FormulaId,
                "fire",
                baseValue: 0,
                coefficientBps: 5_000,
                tags: Array.Empty<string>(),
                seed: 1),
            new CombatContext(
                scalingStatValue: 1m,
                outcome: HitOutcome.Hit,
                critical: true,
                criticalMultiplierBps: 15_000,
                resistanceBps: 5_000,
                availableShield: 0,
                availableTargetHp: 10));
        Equal(
            1,
            fractionalPipeline.RawDamage,
            "raw damage is only a rounded reporting projection");
        Equal(
            0,
            fractionalPipeline.ResolvedDamage,
            "fractional formula and critical stages keep decimal precision; mitigation uses the exact three-quarter subtotal instead of the rounded raw projection");

        var lethal = resolver.Resolve(
            request,
            FireballReferenceScenario.CreateCombatContext(availableTargetHp: 50));
        Equal(50, lethal.FinalHpDamage, "lethal damage is capped by available target HP");
        Equal(112, lethal.Overkill, "post-shield damage beyond target HP becomes overkill");
        Equal(
            lethal.ResolvedDamage,
            lethal.ShieldAbsorbed + lethal.FinalHpDamage + lethal.Overkill,
            "lethal damage also conserves resolved damage");

        var blocked = resolver.Resolve(request, FireballReferenceScenario.CreateCombatContext(HitOutcome.Blocked));
        var missed = resolver.Resolve(request, FireballReferenceScenario.CreateCombatContext(HitOutcome.Miss));
        Equal(HitOutcome.Blocked, blocked.Outcome, "Block remains a distinct outcome");
        Equal(HitOutcome.Miss, missed.Outcome, "Miss remains a distinct outcome");
        True(blocked.Outcome != missed.Outcome, "Block is not collapsed into Miss");
        Equal(0, blocked.FinalHpDamage, "reference Block policy prevents health damage");
        Equal(0, blocked.Overkill, "non-hit outcomes cannot produce overkill");
    }

    private void VerifyCommitAndReactionContracts()
    {
        ICombatResolver resolver = new CombatResolver();
        var damage = resolver.Resolve(
            FireballReferenceScenario.CreateDamageRequest(),
            FireballReferenceScenario.CreateCombatContext());
        var bundle = FireballReferenceScenario.CreateEffectBundle(
            FireballReferenceScenario.CreateDamageRequest());
        var planning = FireballSkillPlanner.ResolveAndPlan(
            FireballReferenceScenario.CreateSkillRequest(),
            FireballReferenceScenario.CreateResolveSnapshot(),
            resolver);
        var plan = planning.Plan ??
            throw new InvalidOperationException("The reference Fireball must be admitted.");
        Equal(4, plan.Mutations.Count, "one plan contains mana, cooldown, shield, and HP changes");
        Equal(4, plan.Preconditions.Count, "each mutated resource has a version check");
        Equal(2, plan.OutboxEvents.Count, "one atomic plan carries skill and damage facts");
        True(plan.OutboxEvents[0] is SkillCommitted, "SkillCommitted is planned first");
        True(plan.OutboxEvents[1] is DamageCommitted, "DamageCommitted is planned second");
        var plannedSkillFact = (SkillCommitted)plan.OutboxEvents[0];
        Equal(
            FireballReferenceScenario.ManaCost,
            plannedSkillFact.ManaSpent,
            "SkillCommitted carries the committed mana cost");
        Equal(
            FireballReferenceScenario.CooldownReadyTick,
            plannedSkillFact.CooldownReadyTick,
            "SkillCommitted carries the committed cooldown ready tick");
        Throws<ArgumentException>(
            () => _ = new CommitPlan(default, plan.Preconditions, plan.Mutations),
            "commit plan rejects a default command ID");
        Throws<ArgumentException>(
            () => _ = new CommitPlan(
                new EntityId("command.verify.missing-precondition"),
                plan.Preconditions.Take(plan.Preconditions.Count - 1),
                plan.Mutations),
            "a mutation without a matching version precondition is rejected");
        Throws<ArgumentException>(
            () => _ = new CommitPlan(
                new EntityId("command.verify.duplicate-precondition"),
                plan.Preconditions.Concat(new[] { plan.Preconditions[0] }),
                plan.Mutations),
            "duplicate version preconditions are rejected");
        Throws<ArgumentException>(
            () => _ = new CommitPlan(
                new EntityId("command.verify.invalid-precondition-id"),
                new[] { new VersionPrecondition(default, 0) },
                plan.Mutations.Take(1)),
            "commit plan rejects a default precondition resource ID");
        Throws<ArgumentException>(
            () => _ = new InMemoryRuntimeCommitter(
                new[] { new VersionedResourceState(default, 0, 0) }),
            "runtime state rejects a default resource ID at aggregate ingress");

        var invalidOutboxEvents = new (DomainEvent Event, string Label)[]
        {
            (
                new SkillCommitted(
                    default,
                    plan.CommandId,
                    FireballReferenceScenario.CasterId,
                    FireballReferenceScenario.SkillDefinitionId,
                    FireballReferenceScenario.TargetId,
                    FireballReferenceScenario.SkillSource,
                    FireballReferenceScenario.ManaResourceId,
                    FireballReferenceScenario.ManaCost,
                    FireballReferenceScenario.CooldownResourceId,
                    FireballReferenceScenario.CooldownReadyTick),
                "event envelope"),
            (
                new SkillCommitted(
                    new EntityId("event.skill-committed.verify.invalid-command"),
                    default,
                    FireballReferenceScenario.CasterId,
                    FireballReferenceScenario.SkillDefinitionId,
                    FireballReferenceScenario.TargetId,
                    FireballReferenceScenario.SkillSource,
                    FireballReferenceScenario.ManaResourceId,
                    FireballReferenceScenario.ManaCost,
                    FireballReferenceScenario.CooldownResourceId,
                    FireballReferenceScenario.CooldownReadyTick),
                "event command"),
            (
                new SkillCommitted(
                    new EntityId("event.skill-committed.verify.invalid-source"),
                    plan.CommandId,
                    FireballReferenceScenario.CasterId,
                    FireballReferenceScenario.SkillDefinitionId,
                    FireballReferenceScenario.TargetId,
                    default,
                    FireballReferenceScenario.ManaResourceId,
                    FireballReferenceScenario.ManaCost,
                    FireballReferenceScenario.CooldownResourceId,
                    FireballReferenceScenario.CooldownReadyTick),
                "event source"),
            (
                new SkillCommitted(
                    new EntityId("event.skill-committed.verify.invalid-caster"),
                    plan.CommandId,
                    default,
                    FireballReferenceScenario.SkillDefinitionId,
                    FireballReferenceScenario.TargetId,
                    FireballReferenceScenario.SkillSource,
                    FireballReferenceScenario.ManaResourceId,
                    FireballReferenceScenario.ManaCost,
                    FireballReferenceScenario.CooldownResourceId,
                    FireballReferenceScenario.CooldownReadyTick),
                "skill fact caster"),
            (
                new SkillCommitted(
                    new EntityId("event.skill-committed.verify.invalid-skill"),
                    plan.CommandId,
                    FireballReferenceScenario.CasterId,
                    default,
                    FireballReferenceScenario.TargetId,
                    FireballReferenceScenario.SkillSource,
                    FireballReferenceScenario.ManaResourceId,
                    FireballReferenceScenario.ManaCost,
                    FireballReferenceScenario.CooldownResourceId,
                    FireballReferenceScenario.CooldownReadyTick),
                "skill fact skill"),
            (
                new SkillCommitted(
                    new EntityId("event.skill-committed.verify.invalid-target"),
                    plan.CommandId,
                    FireballReferenceScenario.CasterId,
                    FireballReferenceScenario.SkillDefinitionId,
                    default(EntityId),
                    FireballReferenceScenario.SkillSource,
                    FireballReferenceScenario.ManaResourceId,
                    FireballReferenceScenario.ManaCost,
                    FireballReferenceScenario.CooldownResourceId,
                    FireballReferenceScenario.CooldownReadyTick),
                "skill fact target"),
            (
                new DamageCommitted(
                    new EntityId("event.damage-committed.verify.invalid-attacker"),
                    plan.CommandId,
                    default,
                    FireballReferenceScenario.TargetId,
                    FireballReferenceScenario.SkillSource,
                    damage,
                    FireballReferenceScenario.TargetHealthResourceId,
                    TargetHpAfter: 338,
                    TargetShieldResourceId: FireballReferenceScenario.TargetShieldResourceId,
                    TargetShieldAfter: 0),
                "damage fact attacker"),
            (
                new DamageCommitted(
                    new EntityId("event.damage-committed.verify.invalid-defender"),
                    plan.CommandId,
                    FireballReferenceScenario.CasterId,
                    default,
                    FireballReferenceScenario.SkillSource,
                    damage,
                    FireballReferenceScenario.TargetHealthResourceId,
                    TargetHpAfter: 338,
                    TargetShieldResourceId: FireballReferenceScenario.TargetShieldResourceId,
                    TargetShieldAfter: 0),
                "damage fact defender"),
            (
                new DamageCommitted(
                    new EntityId("event.damage-committed.verify.invalid-hp-resource"),
                    plan.CommandId,
                    FireballReferenceScenario.CasterId,
                    FireballReferenceScenario.TargetId,
                    FireballReferenceScenario.SkillSource,
                    damage,
                    default,
                    TargetHpAfter: 338,
                    TargetShieldResourceId: FireballReferenceScenario.TargetShieldResourceId,
                    TargetShieldAfter: 0),
                "damage fact HP resource"),
            (
                new DamageCommitted(
                    new EntityId("event.damage-committed.verify.invalid-shield-resource"),
                    plan.CommandId,
                    FireballReferenceScenario.CasterId,
                    FireballReferenceScenario.TargetId,
                    FireballReferenceScenario.SkillSource,
                    damage,
                    FireballReferenceScenario.TargetHealthResourceId,
                    TargetHpAfter: 338,
                    TargetShieldResourceId: default,
                    TargetShieldAfter: 0),
                "damage fact shield resource")
        };
        foreach (var invalidOutboxEvent in invalidOutboxEvents)
        {
            Throws<ArgumentException>(
                () => _ = new CommitPlan(
                    plan.CommandId,
                    plan.Preconditions,
                    plan.Mutations,
                    new[] { invalidOutboxEvent.Event }),
                $"commit plan rejects a default {invalidOutboxEvent.Label} ID");
        }

        var zeroCostSkillFact = new CommittedOutboxEvent(
            sequence: 1,
            new SkillCommitted(
                new EntityId("event.skill-committed.verify.zero-cost"),
                plan.CommandId,
                FireballReferenceScenario.CasterId,
                FireballReferenceScenario.SkillDefinitionId,
                FireballReferenceScenario.TargetId,
                FireballReferenceScenario.SkillSource,
                FireballReferenceScenario.ManaResourceId,
                ManaSpent: 0,
                CooldownResourceId: FireballReferenceScenario.CooldownResourceId,
                CooldownReadyTick: 0));
        Equal(
            0L,
            ((SkillCommitted)zeroCostSkillFact.Event).ManaSpent,
            "SkillCommitted permits an explicit zero-cost skill");

        var invalidSkillFacts = new[]
        {
            new SkillCommitted(
                new EntityId("event.skill-committed.verify.negative-mana"),
                plan.CommandId,
                FireballReferenceScenario.CasterId,
                FireballReferenceScenario.SkillDefinitionId,
                FireballReferenceScenario.TargetId,
                FireballReferenceScenario.SkillSource,
                FireballReferenceScenario.ManaResourceId,
                ManaSpent: -1,
                CooldownResourceId: FireballReferenceScenario.CooldownResourceId,
                CooldownReadyTick: FireballReferenceScenario.CooldownReadyTick),
            new SkillCommitted(
                new EntityId("event.skill-committed.verify.negative-cooldown"),
                plan.CommandId,
                FireballReferenceScenario.CasterId,
                FireballReferenceScenario.SkillDefinitionId,
                FireballReferenceScenario.TargetId,
                FireballReferenceScenario.SkillSource,
                FireballReferenceScenario.ManaResourceId,
                FireballReferenceScenario.ManaCost,
                FireballReferenceScenario.CooldownResourceId,
                CooldownReadyTick: -1)
        };
        foreach (var invalidSkillFact in invalidSkillFacts)
        {
            Throws<ArgumentOutOfRangeException>(
                () => _ = new CommitPlan(
                    plan.CommandId,
                    plan.Preconditions,
                    plan.Mutations,
                    new[] { invalidSkillFact }),
                "SkillCommitted rejects negative resource facts");
        }

        var nullDamageResultFact = new DamageCommitted(
            new EntityId("event.damage-committed.verify.null-result"),
            plan.CommandId,
            FireballReferenceScenario.CasterId,
            FireballReferenceScenario.TargetId,
            FireballReferenceScenario.SkillSource,
            null!,
            FireballReferenceScenario.TargetHealthResourceId,
            TargetHpAfter: 338,
            TargetShieldResourceId: FireballReferenceScenario.TargetShieldResourceId,
            TargetShieldAfter: 0);
        Throws<ArgumentNullException>(
            () => _ = new CommitPlan(
                plan.CommandId,
                plan.Preconditions,
                plan.Mutations,
                new DomainEvent[] { nullDamageResultFact }),
            "DamageCommitted rejects a null damage result");

        var readOnlyPreconditionPlan = new CommitPlan(
            new EntityId("command.verify.read-only-precondition"),
            plan.Preconditions,
            plan.Mutations.Take(plan.Mutations.Count - 1));
        Equal(
            4,
            readOnlyPreconditionPlan.Preconditions.Count,
            "a commit plan may retain an extra read-only version precondition");
        var readOnlyPreconditionCommitter = new InMemoryRuntimeCommitter(
            FireballReferenceScenario.CreateInitialState());
        Equal(
            CommitStatus.Committed,
            readOnlyPreconditionCommitter.Commit(readOnlyPreconditionPlan).Status,
            "a plan with a satisfied read-only precondition commits");
        Equal(
            7L,
            readOnlyPreconditionCommitter.GetVersion(
                FireballReferenceScenario.TargetHealthResourceId),
            "a read-only precondition does not advance the resource version");

        var maxVersionResourceId = new EntityId("resource.verify.max-version");
        var maxVersionCommandId = new EntityId("command.verify.max-version");
        var maxVersionPlan = new CommitPlan(
            maxVersionCommandId,
            new[] { new VersionPrecondition(maxVersionResourceId, long.MaxValue) },
            new[] { new StateMutation(maxVersionResourceId, 9, "probe version overflow") });
        var maxVersionCommitter = new InMemoryRuntimeCommitter(
            new[] { new VersionedResourceState(maxVersionResourceId, 10, long.MaxValue) });
        Throws<OverflowException>(
            () => maxVersionCommitter.Commit(maxVersionPlan),
            "resource version overflow is rejected before publication");
        Equal(10L, maxVersionCommitter.GetValue(maxVersionResourceId), "version overflow keeps the prior value");
        Equal(long.MaxValue, maxVersionCommitter.GetVersion(maxVersionResourceId), "version overflow keeps the prior version");
        Equal(0, maxVersionCommitter.GetOutbox().Count, "version overflow appends no outbox events");
        Throws<OverflowException>(
            () => maxVersionCommitter.Commit(maxVersionPlan),
            "version overflow does not consume command idempotency");

        var inconsistentDamageFacts = new[]
        {
            (Suffix: "hp", TargetHpAfter: 337L, TargetShieldAfter: 0L),
            (Suffix: "shield", TargetHpAfter: 338L, TargetShieldAfter: 1L)
        };
        foreach (var inconsistentFact in inconsistentDamageFacts)
        {
            var inconsistentCommandId = new EntityId(
                $"command.verify.inconsistent-damage-{inconsistentFact.Suffix}");
            var inconsistentDamagePlan = new CommitPlan(
                inconsistentCommandId,
                new[]
                {
                    new VersionPrecondition(
                        FireballReferenceScenario.TargetHealthResourceId,
                        7),
                    new VersionPrecondition(
                        FireballReferenceScenario.TargetShieldResourceId,
                        7)
                },
                new[]
                {
                    new StateMutation(
                        FireballReferenceScenario.TargetHealthResourceId,
                        338,
                        "Apply reference health damage"),
                    new StateMutation(
                        FireballReferenceScenario.TargetShieldResourceId,
                        0,
                        "Apply reference shield damage")
                },
                new DomainEvent[]
                {
                    new DamageCommitted(
                        new EntityId(
                            $"event.damage-committed.verify.inconsistent-{inconsistentFact.Suffix}"),
                        inconsistentCommandId,
                        FireballReferenceScenario.CasterId,
                        FireballReferenceScenario.TargetId,
                        SourceRef.SkillExecution(
                            FireballReferenceScenario.SkillDefinitionId,
                            inconsistentCommandId),
                        damage,
                        FireballReferenceScenario.TargetHealthResourceId,
                        inconsistentFact.TargetHpAfter,
                        FireballReferenceScenario.TargetShieldResourceId,
                        inconsistentFact.TargetShieldAfter)
                });
            var inconsistentDamageCommitter = new InMemoryRuntimeCommitter(
                FireballReferenceScenario.CreateInitialState());
            Throws<InvalidOperationException>(
                () => inconsistentDamageCommitter.Commit(inconsistentDamagePlan),
                $"damage fact cannot disagree with post-commit {inconsistentFact.Suffix}");
            Equal(
                500L,
                inconsistentDamageCommitter.GetValue(
                    FireballReferenceScenario.TargetHealthResourceId),
                "an inconsistent damage fact leaves HP unchanged");
            Equal(
                40L,
                inconsistentDamageCommitter.GetValue(
                    FireballReferenceScenario.TargetShieldResourceId),
                "an inconsistent damage fact leaves shield unchanged");
            Equal(
                0,
                inconsistentDamageCommitter.GetOutbox().Count,
                "an inconsistent damage fact appends no outbox event");
            Throws<InvalidOperationException>(
                () => inconsistentDamageCommitter.Commit(inconsistentDamagePlan),
                "an inconsistent damage fact does not consume command idempotency");
        }

        var transitionCommandId =
            new EntityId("command.verify.damage-transition-truth");
        var transitionSource = SourceRef.SkillExecution(
            FireballReferenceScenario.SkillDefinitionId,
            transitionCommandId);
        var targetPreconditions = new[]
        {
            new VersionPrecondition(
                FireballReferenceScenario.TargetHealthResourceId,
                7),
            new VersionPrecondition(
                FireballReferenceScenario.TargetShieldResourceId,
                7)
        };
        var targetMutations = new[]
        {
            new StateMutation(
                FireballReferenceScenario.TargetHealthResourceId,
                338,
                "Apply reference health damage"),
            new StateMutation(
                FireballReferenceScenario.TargetShieldResourceId,
                0,
                "Apply reference shield damage")
        };
        var lyingDamagePlan = new CommitPlan(
            transitionCommandId,
            targetPreconditions,
            targetMutations,
            new DomainEvent[]
            {
                new DamageCommitted(
                    new EntityId("event.damage-committed.verify.false-delta"),
                    transitionCommandId,
                    FireballReferenceScenario.CasterId,
                    FireballReferenceScenario.TargetId,
                    transitionSource,
                    new DamageResult(
                        HitOutcome.Hit,
                        critical: false,
                        rawDamage: 1,
                        resolvedDamage: 1,
                        shieldAbsorbed: 0,
                        finalHpDamage: 1,
                        overkill: 0),
                    FireballReferenceScenario.TargetHealthResourceId,
                    TargetHpAfter: 338,
                    FireballReferenceScenario.TargetShieldResourceId,
                    TargetShieldAfter: 0)
            });
        var transitionCommitter = new InMemoryRuntimeCommitter(
            FireballReferenceScenario.CreateInitialState());
        Throws<InvalidOperationException>(
            () => transitionCommitter.Commit(lyingDamagePlan),
            "DamageCommitted cannot report a result that disagrees with the actual resource deltas");
        Equal(
            500L,
            transitionCommitter.GetValue(
                FireballReferenceScenario.TargetHealthResourceId),
            "a false damage delta leaves HP unchanged");
        Equal(
            7L,
            transitionCommitter.GetVersion(
                FireballReferenceScenario.TargetHealthResourceId),
            "a false damage delta leaves the HP version unchanged");
        Equal(
            0,
            transitionCommitter.GetOutbox().Count,
            "a false damage delta appends no outbox fact");
        var truthfulDamagePlan = new CommitPlan(
            transitionCommandId,
            targetPreconditions,
            targetMutations,
            new DomainEvent[]
            {
                new DamageCommitted(
                    new EntityId("event.damage-committed.verify.true-delta"),
                    transitionCommandId,
                    FireballReferenceScenario.CasterId,
                    FireballReferenceScenario.TargetId,
                    transitionSource,
                    damage,
                    FireballReferenceScenario.TargetHealthResourceId,
                    TargetHpAfter: 338,
                    FireballReferenceScenario.TargetShieldResourceId,
                    TargetShieldAfter: 0)
            });
        Equal(
            CommitStatus.Committed,
            transitionCommitter.Commit(truthfulDamagePlan).Status,
            "a rejected false fact does not consume command idempotency");

        var sourceCommandId =
            new EntityId("command.verify.damage-source-truth");
        var wrongSourceFact = new DamageCommitted(
            new EntityId("event.damage-committed.verify.wrong-source"),
            sourceCommandId,
            FireballReferenceScenario.CasterId,
            FireballReferenceScenario.TargetId,
            FireballReferenceScenario.SkillSource,
            damage,
            FireballReferenceScenario.TargetHealthResourceId,
            TargetHpAfter: 338,
            FireballReferenceScenario.TargetShieldResourceId,
            TargetShieldAfter: 0);
        var sourceCommitter = new InMemoryRuntimeCommitter(
            FireballReferenceScenario.CreateInitialState());
        Throws<ArgumentException>(
            () => _ = new CommitPlan(
                sourceCommandId,
                targetPreconditions,
                targetMutations,
                new DomainEvent[] { wrongSourceFact }),
            "skill-sourced damage must point to the plan command execution");
        Equal(
            FireballReferenceScenario.InitialHealth,
            sourceCommitter.GetValue(
                FireballReferenceScenario.TargetHealthResourceId),
            "a wrong source cannot mutate target state");
        Equal(0, sourceCommitter.GetOutbox().Count, "a wrong source cannot append an outbox fact");
        var correctSource = SourceRef.SkillExecution(
            FireballReferenceScenario.SkillDefinitionId,
            sourceCommandId);
        var correctSourcePlan = new CommitPlan(
            sourceCommandId,
            targetPreconditions,
            targetMutations,
            new DomainEvent[]
            {
                new DamageCommitted(
                    new EntityId("event.damage-committed.verify.correct-source"),
                    sourceCommandId,
                    FireballReferenceScenario.CasterId,
                    FireballReferenceScenario.TargetId,
                    correctSource,
                    damage,
                    FireballReferenceScenario.TargetHealthResourceId,
                    TargetHpAfter: 338,
                    FireballReferenceScenario.TargetShieldResourceId,
                    TargetShieldAfter: 0)
            });
        Equal(
            CommitStatus.Committed,
            sourceCommitter.Commit(correctSourcePlan).Status,
            "correcting the source with the same command ID can still commit");

        var inconsistentSkillFacts = new[]
        {
            (
                Suffix: "mana",
                ManaSpent: FireballReferenceScenario.ManaCost - 1,
                CooldownReadyTick: FireballReferenceScenario.CooldownReadyTick),
            (
                Suffix: "cooldown",
                ManaSpent: FireballReferenceScenario.ManaCost,
                CooldownReadyTick: FireballReferenceScenario.CooldownReadyTick + 1)
        };
        foreach (var inconsistentFact in inconsistentSkillFacts)
        {
            var inconsistentCommandId = new EntityId(
                $"command.skill-committed.verify.inconsistent-{inconsistentFact.Suffix}");
            var inconsistentSkillPlan = new CommitPlan(
                inconsistentCommandId,
                plan.Preconditions,
                plan.Mutations,
                new DomainEvent[]
                {
                    new SkillCommitted(
                        new EntityId(
                            $"event.skill-committed.verify.inconsistent-{inconsistentFact.Suffix}"),
                        inconsistentCommandId,
                        FireballReferenceScenario.CasterId,
                        FireballReferenceScenario.SkillDefinitionId,
                        FireballReferenceScenario.TargetId,
                        SourceRef.SkillExecution(
                            FireballReferenceScenario.SkillDefinitionId,
                            inconsistentCommandId),
                        FireballReferenceScenario.ManaResourceId,
                        inconsistentFact.ManaSpent,
                        FireballReferenceScenario.CooldownResourceId,
                        inconsistentFact.CooldownReadyTick)
                });
            var inconsistentSkillCommitter = new InMemoryRuntimeCommitter(
                FireballReferenceScenario.CreateInitialState());
            Throws<InvalidOperationException>(
                () => inconsistentSkillCommitter.Commit(inconsistentSkillPlan),
                $"skill fact cannot disagree with committed {inconsistentFact.Suffix}");
            Equal(
                FireballReferenceScenario.InitialMana,
                inconsistentSkillCommitter.GetValue(
                    FireballReferenceScenario.ManaResourceId),
                "an inconsistent skill fact leaves mana unchanged");
            Equal(
                0L,
                inconsistentSkillCommitter.GetValue(
                    FireballReferenceScenario.CooldownResourceId),
                "an inconsistent skill fact leaves cooldown unchanged");
            Equal(
                0,
                inconsistentSkillCommitter.GetOutbox().Count,
                "an inconsistent skill fact appends no outbox event");
        }

        var committer = new InMemoryRuntimeCommitter(
            FireballReferenceScenario.CreateInitialState());
        var committed = committer.Commit(plan);
        Equal(CommitStatus.Committed, committed.Status, "first command commits");
        Equal(80L, committer.GetValue(FireballReferenceScenario.ManaResourceId), "commit spends mana");
        Equal(
            FireballReferenceScenario.CooldownReadyTick,
            committer.GetValue(FireballReferenceScenario.CooldownResourceId),
            "commit sets cooldown ready tick");
        Equal(0L, committer.GetValue(FireballReferenceScenario.TargetShieldResourceId), "commit consumes shield");
        Equal(338L, committer.GetValue(FireballReferenceScenario.TargetHealthResourceId), "commit subtracts HP damage");
        Equal(5L, committer.GetVersion(FireballReferenceScenario.ManaResourceId), "mana version advances");
        Equal(3L, committer.GetVersion(FireballReferenceScenario.CooldownResourceId), "cooldown version advances");
        Equal(8L, committer.GetVersion(FireballReferenceScenario.TargetShieldResourceId), "shield version advances");
        Equal(8L, committer.GetVersion(FireballReferenceScenario.TargetHealthResourceId), "HP version advances");
        Equal(2, committed.OutboxEvents.Count, "successful commit exposes both outbox facts");
        Equal(1L, committed.OutboxEvents[0].Sequence, "outbox sequence is stable");
        Equal(2L, committed.OutboxEvents[1].Sequence, "damage follows skill in outbox order");
        True(committed.OutboxEvents[0].Event is SkillCommitted, "committed order starts with SkillCommitted");
        True(committed.OutboxEvents[1].Event is DamageCommitted, "committed order continues with DamageCommitted");
        var damageFact = (DamageCommitted)committed.OutboxEvents[1].Event;
        Equal(338L, damageFact.TargetHpAfter, "committed damage retains target HP-after");
        Equal(0L, damageFact.TargetShieldAfter, "committed damage retains target shield-after");
        Equal(2, committer.GetOutbox().Count, "state and both outbox facts are stored together");

        var reactions = FireballReferenceScenario.CreateReactionCommands(
            bundle,
            committed.OutboxEvents[1]);
        Equal(1, reactions.Count, "committed damage derives one Burn reaction command");
        Equal(FireballReferenceScenario.BurnReactionId, reactions[0].ReactionId, "Burn reaction preserves identity");
        Equal(new EntityId("effect.apply-burn"), reactions[0].HandlerId, "Burn command uses the rule handler");
        Equal(
            FireballReferenceScenario.BurnIdempotencyKey,
            reactions[0].IdempotencyKey,
            "Burn command carries a separate idempotency key");
        Equal(damageFact.EventId, reactions[0].CausationId, "Burn command preserves the triggering committed event ID");
        var burnRequest = FireballReferenceScenario.CreateBurnRequest(reactions[0]);
        Equal(FireballReferenceScenario.BurnDefinitionId, burnRequest.StatusId, "reaction creates Burn request");
        Equal(FireballReferenceScenario.TargetId, burnRequest.TargetId, "Burn targets the damaged entity");
        Equal(
            0,
            FireballReferenceScenario.CreateReactionCommands(bundle, committed.OutboxEvents[0]).Count,
            "SkillCommitted does not trigger the damage reaction rule");

        var lethalDamage = resolver.Resolve(
            FireballReferenceScenario.CreateDamageRequest(),
            FireballReferenceScenario.CreateCombatContext(availableTargetHp: 50));
        var lethalFact = new CommittedOutboxEvent(
            sequence: 99,
            new DamageCommitted(
                FireballReferenceScenario.DamageCommittedEventId,
                FireballReferenceScenario.CommandId,
                FireballReferenceScenario.CasterId,
                FireballReferenceScenario.TargetId,
                FireballReferenceScenario.SkillSource,
                lethalDamage,
                FireballReferenceScenario.TargetHealthResourceId,
                TargetHpAfter: 0,
                TargetShieldResourceId: FireballReferenceScenario.TargetShieldResourceId,
                TargetShieldAfter: 0));
        Throws<ArgumentOutOfRangeException>(
            () => _ = new CommittedOutboxEvent(0, lethalFact.Event),
            "committed outbox sequence must be positive");
        Throws<ArgumentNullException>(
            () => _ = new CommittedOutboxEvent(1, null!),
            "committed outbox event cannot be null");
        Throws<ArgumentException>(
            () => _ = CommitReceipt.Empty(CommitStatus.Committed, FireballReferenceScenario.CommandId),
            "empty receipt factory is reserved for non-committed outcomes");
        Equal(
            0,
            FireballReferenceScenario.CreateReactionCommands(bundle, lethalFact).Count,
            "lethal damage does not apply Burn to a dead target");

        var duplicate = committer.Commit(plan);
        Equal(CommitStatus.DuplicateCommand, duplicate.Status, "duplicate command is idempotent");
        Equal(0, duplicate.OutboxEvents.Count, "duplicate does not append outbox facts again");
        Equal(338L, committer.GetValue(FireballReferenceScenario.TargetHealthResourceId), "duplicate does not mutate state");
        Equal(2, committer.GetOutbox().Count, "duplicate leaves outbox unchanged");

        var staleCommandId = new EntityId("command.fireball.cast.0002");
        var stalePlan = new CommitPlan(
            staleCommandId,
            plan.Preconditions,
            plan.Mutations,
            new DomainEvent[]
            {
                new SkillCommitted(
                    new EntityId("event.skill-committed.fireball.0002"),
                    staleCommandId,
                    FireballReferenceScenario.CasterId,
                    FireballReferenceScenario.SkillDefinitionId,
                    FireballReferenceScenario.TargetId,
                    SourceRef.SkillExecution(
                        FireballReferenceScenario.SkillDefinitionId,
                        staleCommandId),
                    FireballReferenceScenario.ManaResourceId,
                    FireballReferenceScenario.ManaCost,
                    FireballReferenceScenario.CooldownResourceId,
                    FireballReferenceScenario.CooldownReadyTick),
                new DamageCommitted(
                    new EntityId("event.damage-committed.fireball.0002"),
                    staleCommandId,
                    FireballReferenceScenario.CasterId,
                    FireballReferenceScenario.TargetId,
                    SourceRef.SkillExecution(
                        FireballReferenceScenario.SkillDefinitionId,
                        staleCommandId),
                    damage,
                    FireballReferenceScenario.TargetHealthResourceId,
                    TargetHpAfter: 338,
                    TargetShieldResourceId: FireballReferenceScenario.TargetShieldResourceId,
                    TargetShieldAfter: 0)
            });
        var stale = committer.Commit(stalePlan);
        Equal(CommitStatus.PreconditionFailed, stale.Status, "stale version is rejected");
        Equal(0, stale.OutboxEvents.Count, "failed commit does not append an outbox fact");
        Equal(80L, committer.GetValue(FireballReferenceScenario.ManaResourceId), "failed commit rolls back mana");
        Equal(338L, committer.GetValue(FireballReferenceScenario.TargetHealthResourceId), "failed commit rolls back HP");
        Equal(2, committer.GetOutbox().Count, "failed commit leaves outbox unchanged");
    }

    private void VerifyFireballExecutionIsolationAndNonHit()
    {
        ICombatResolver resolver = new CombatResolver();
        var firstRequest = FireballReferenceScenario.CreateSkillRequest();
        var firstPlanning = FireballSkillPlanner.ResolveAndPlan(
            firstRequest,
            FireballReferenceScenario.CreateResolveSnapshot(),
            resolver);
        var firstPlan = firstPlanning.Plan ??
            throw new InvalidOperationException("The first Fireball must be admitted.");
        var firstDamageRequest =
            FireballReferenceScenario.CreateDamageRequest(firstRequest);
        var firstBundle = FireballReferenceScenario.CreateEffectBundle(
            firstRequest,
            firstDamageRequest);
        var committer = new InMemoryRuntimeCommitter(
            FireballReferenceScenario.CreateInitialState());
        var firstCommit = committer.Commit(firstPlan);
        Equal(
            CommitStatus.Committed,
            firstCommit.Status,
            "the first execution commits before a later cast");

        var secondCommandId = new EntityId("command.fireball.cast.0002");
        var secondRequest = FireballReferenceScenario.CreateSkillRequest(
            secondCommandId,
            requestedTick: FireballReferenceScenario.CooldownReadyTick,
            rootSeed: 98_765);
        var secondDamageRequest =
            FireballReferenceScenario.CreateDamageRequest(secondRequest);
        Equal(98_765u, secondDamageRequest.Seed, "each execution forwards its own replay seed");
        var secondSnapshot = new FireballResolveSnapshot(
            mana: 80,
            manaVersion: 5,
            cooldownReadyTick: FireballReferenceScenario.CooldownReadyTick,
            cooldownVersion: 3,
            targetShield: 0,
            targetShieldVersion: 8,
            targetHealth: 338,
            targetHealthVersion: 8);
        var secondPlanning = FireballSkillPlanner.ResolveAndPlan(
            secondRequest,
            secondSnapshot,
            resolver);
        var secondPlan = secondPlanning.Plan ??
            throw new InvalidOperationException("The ready second Fireball must be admitted.");
        var firstIdentity =
            FireballReferenceScenario.CreateExecutionIdentity(firstRequest);
        var secondIdentity =
            FireballReferenceScenario.CreateExecutionIdentity(secondRequest);
        Equal(secondCommandId, secondPlan.CommandId, "a later plan keeps its own command identity");
        Equal(
            secondRequest.RequestedTick +
            FireballReferenceScenario.CooldownDurationTicks,
            secondIdentity.CooldownReadyTick,
            "cooldown derives from the current request tick");
        True(
            firstIdentity.BundleId != secondIdentity.BundleId,
            "effect bundle IDs differ across executions");
        True(
            firstIdentity.SkillCommittedEventId !=
            secondIdentity.SkillCommittedEventId,
            "SkillCommitted event IDs differ across executions");
        True(
            firstIdentity.DamageCommittedEventId !=
            secondIdentity.DamageCommittedEventId,
            "DamageCommitted event IDs differ across executions");
        True(
            firstIdentity.BurnReactionId != secondIdentity.BurnReactionId,
            "reaction IDs differ across executions");
        True(
            firstIdentity.BurnIdempotencyKey !=
            secondIdentity.BurnIdempotencyKey,
            "reaction idempotency keys differ across executions");
        Equal(
            3,
            secondPlan.Mutations.Count,
            "a second cast with no shield mutates mana, cooldown, and HP only");

        var secondCommit = committer.Commit(secondPlan);
        Equal(
            CommitStatus.Committed,
            secondCommit.Status,
            "a distinct ready command is not mistaken for a duplicate");
        Equal(60L, committer.GetValue(FireballReferenceScenario.ManaResourceId), "the second cast spends mana again");
        Equal(
            secondIdentity.CooldownReadyTick,
            committer.GetValue(FireballReferenceScenario.CooldownResourceId),
            "the second cast publishes its own cooldown");
        Equal(136L, committer.GetValue(FireballReferenceScenario.TargetHealthResourceId), "the second cast applies damage to current HP");
        Equal(
            8L,
            committer.GetVersion(FireballReferenceScenario.TargetShieldResourceId),
            "zero shield damage does not create a false resource write");
        Equal(
            9L,
            committer.GetVersion(FireballReferenceScenario.TargetHealthResourceId),
            "positive HP damage advances the resource version once");
        var secondSkillFact = (SkillCommitted)secondCommit.OutboxEvents[0].Event;
        var secondDamageFact = (DamageCommitted)secondCommit.OutboxEvents[1].Event;
        Equal(
            secondIdentity.SkillSource,
            secondSkillFact.Source,
            "the second skill fact points to the second command execution");
        Equal(
            secondIdentity.SkillSource,
            secondDamageFact.Source,
            "the second damage fact points to the second command execution");

        var secondBundle = FireballReferenceScenario.CreateEffectBundle(
            secondRequest,
            secondDamageRequest);
        var firstReaction = FireballReferenceScenario.CreateReactionCommands(
            firstBundle,
            firstCommit.OutboxEvents[1]).Single();
        var secondReaction = FireballReferenceScenario.CreateReactionCommands(
            secondBundle,
            secondCommit.OutboxEvents[1]).Single();
        True(
            firstReaction.ReactionId != secondReaction.ReactionId,
            "separate casts enqueue separate Burn identities");
        Equal(
            secondDamageFact.EventId,
            secondReaction.CausationId,
            "the second Burn points to the second committed damage fact");
        Equal(
            FireballReferenceScenario.BurnDefinitionId,
            FireballReferenceScenario.CreateBurnRequest(secondReaction).StatusId,
            "dynamic Fireball identities still create the Burn request");
        Throws<ArgumentException>(
            () => FireballReferenceScenario.CreateReactionCommands(
                firstBundle,
                secondCommit.OutboxEvents[1]),
            "a committed event cannot be paired with another execution's bundle");
        Equal(
            CommitStatus.DuplicateCommand,
            committer.Commit(secondPlan).Status,
            "replaying the second command remains idempotent");

        var missCommandId = new EntityId("command.fireball.cast.miss");
        var missRequest = FireballReferenceScenario.CreateSkillRequest(
            missCommandId,
            FireballReferenceScenario.CastTick,
            rootSeed: 7);
        var missResult = new DamageResult(
            HitOutcome.Miss,
            critical: false,
            rawDamage: 0,
            resolvedDamage: 0,
            shieldAbsorbed: 0,
            finalHpDamage: 0,
            overkill: 0);
        var missPlanning = FireballSkillPlanner.ResolveAndPlan(
            missRequest,
            FireballReferenceScenario.CreateResolveSnapshot(),
            new FixedCombatResolver(missResult));
        var missPlan = missPlanning.Plan ??
            throw new InvalidOperationException("An admitted miss must still produce a commit plan.");
        Equal(4, missPlan.Preconditions.Count, "a miss retains all snapshot consistency checks");
        Equal(2, missPlan.Mutations.Count, "a miss commits only mana and cooldown");
        Equal(2, missPlan.OutboxEvents.Count, "a miss publishes skill and zero-damage facts");
        var missCommitter = new InMemoryRuntimeCommitter(
            FireballReferenceScenario.CreateInitialState());
        var missCommit = missCommitter.Commit(missPlan);
        Equal(CommitStatus.Committed, missCommit.Status, "an admitted miss commits without throwing");
        Equal(80L, missCommitter.GetValue(FireballReferenceScenario.ManaResourceId), "a miss still spends skill cost");
        Equal(40L, missCommitter.GetValue(FireballReferenceScenario.TargetShieldResourceId), "a miss leaves shield unchanged");
        Equal(500L, missCommitter.GetValue(FireballReferenceScenario.TargetHealthResourceId), "a miss leaves HP unchanged");
        Equal(7L, missCommitter.GetVersion(FireballReferenceScenario.TargetShieldResourceId), "a miss does not advance shield version");
        Equal(7L, missCommitter.GetVersion(FireballReferenceScenario.TargetHealthResourceId), "a miss does not advance HP version");
        var missDamageFact = (DamageCommitted)missCommit.OutboxEvents[1].Event;
        Equal(HitOutcome.Miss, missDamageFact.Result.Outcome, "the zero-damage fact preserves Miss");
        Equal(
            missCommandId,
            missDamageFact.Source.InstanceId!.Value,
            "the miss fact points to its own command execution");
        var missBundle = FireballReferenceScenario.CreateEffectBundle(
            missRequest,
            FireballReferenceScenario.CreateDamageRequest(missRequest));
        Equal(
            0,
            FireballReferenceScenario.CreateReactionCommands(
                missBundle,
                missCommit.OutboxEvents[1]).Count,
            "a Miss cannot enqueue the hit-only Burn reaction");
    }

    private void VerifyLiveTargetStatusReactionPolicy()
    {
        ICombatResolver resolver = new CombatResolver();
        var planning = FireballSkillPlanner.ResolveAndPlan(
            FireballReferenceScenario.CreateSkillRequest(),
            FireballReferenceScenario.CreateResolveSnapshot(),
            resolver);
        var plan = planning.Plan ??
            throw new InvalidOperationException("The reference Fireball must be admitted.");
        var committer = new InMemoryRuntimeCommitter(
            FireballReferenceScenario.CreateInitialState());
        var committed = committer.Commit(plan);
        var damageFact = (DamageCommitted)committed.OutboxEvents[1].Event;
        True(
            damageFact.TargetHpAfter > 0,
            "the primary impact leaves the target alive when Burn is queued");
        var bundle = FireballReferenceScenario.CreateEffectBundle(
            FireballReferenceScenario.CreateDamageRequest());
        var reaction = FireballReferenceScenario.CreateReactionCommands(
            bundle,
            committed.OutboxEvents[1]).Single();

        var aliveDecision = LiveTargetStatusReactionPolicy.Evaluate(
            reaction,
            new LiveTargetSnapshot(
                reaction.TargetId,
                damageFact.TargetHpAfter,
                healthVersion: 8),
            FireballReferenceScenario.BurnDefinitionId,
            stackDelta: 1);
        Equal(
            StatusReactionDisposition.ReadyToApply,
            aliveDecision.Disposition,
            "a still-living target produces a status request");
        True(aliveDecision.Request is not null, "the live path carries the Burn request");
        Equal(
            FireballReferenceScenario.BurnDefinitionId,
            aliveDecision.Request!.StatusId,
            "the live path carries the intended Burn definition");
        True(!aliveDecision.IsTerminal, "the live path still requires status application");

        var deadDecision = LiveTargetStatusReactionPolicy.Evaluate(
            reaction,
            new LiveTargetSnapshot(
                reaction.TargetId,
                currentHealth: 0,
                healthVersion: 9),
            FireballReferenceScenario.BurnDefinitionId,
            stackDelta: 1);
        Equal(
            StatusReactionDisposition.NotApplicable,
            deadDecision.Disposition,
            "death after impact makes Burn NotApplicable at dispatch time");
        True(deadDecision.IsTerminal, "NotApplicable is a terminal reaction result");
        Equal<ApplyStatusRequest?>(
            null,
            deadDecision.Request,
            "the terminal dead-target path creates no status request");
        Equal(
            9L,
            deadDecision.ObservedTargetVersion,
            "the terminal result records the live snapshot version");
        Throws<ArgumentException>(
            () => LiveTargetStatusReactionPolicy.Evaluate(
                reaction,
                new LiveTargetSnapshot(
                    new EntityId("entity.other-target"),
                    currentHealth: 1,
                    healthVersion: 1),
                FireballReferenceScenario.BurnDefinitionId,
                stackDelta: 1),
            "reaction evaluation rejects a snapshot for another target");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new LiveTargetSnapshot(
                reaction.TargetId,
                currentHealth: -1,
                healthVersion: 1),
            "live target snapshots reject negative health");
    }

    private void VerifyReactionBoundsAndOrder()
    {
        Throws<ArgumentOutOfRangeException>(
            () => _ = new ReactionBudget(maxReactions: 1, maxDepth: 0, maxBudget: 0),
            "reaction drain budget must be positive in both C# and JavaScript");
        var dispatched = new List<EntityId>();
        var queue = new DeterministicBoundedReactionQueue(
            maxReactions: 4,
            maxDepth: 2,
            maxBudget: 10,
            command => dispatched.Add(command.ReactionId));
        var source = FireballReferenceScenario.SkillSource;
        var actual = new ReactionCommand(
            FireballReferenceScenario.BurnReactionId,
            FireballReferenceScenario.BurnIdempotencyKey,
            new EntityId("effect.apply-burn"),
            FireballReferenceScenario.TargetId,
            source,
            FireballReferenceScenario.DamageCommittedEventId,
            100,
            FireballReferenceScenario.CreateExecutionIdentity(
                FireballReferenceScenario.CreateSkillRequest())
                .BurnStableOrderKey,
            depth: 1,
            budgetCost: 1);
        var alpha = CreateTestReaction("alpha", priority: 50, order: "a", depth: 1, budgetCost: 2);
        var beta = CreateTestReaction("beta", priority: 50, order: "b", depth: 1, budgetCost: 2);
        var duplicateKey = CreateTestReaction(
            "different-reaction",
            priority: 1,
            order: "first",
            depth: 1,
            budgetCost: 1,
            idempotencySuffix: "alpha");

        queue.Enqueue(actual);
        queue.Enqueue(beta);
        queue.Enqueue(alpha);
        queue.Enqueue(duplicateKey);
        Equal(3, queue.PendingCount, "duplicate idempotency key is ignored even with another reaction ID");
        Equal(5, queue.PendingBudget, "pending queue tracks separate budget cost");
        Equal(
            3,
            queue.Drain(new ReactionBudget(maxReactions: 4, maxDepth: 1, maxBudget: 5)),
            "one drain completes the accepted causation wave");
        SequenceEqual(
            new[] { alpha.ReactionId, beta.ReactionId, actual.ReactionId },
            dispatched,
            "ascending priority and stable order key determine dispatch order");
        Equal(0, queue.PendingCount, "completed wave leaves no deferred reaction");
        Equal(0, queue.PendingBudget, "completed wave consumes all pending budget");
        queue.Enqueue(actual);
        Equal(0, queue.PendingCount, "processed idempotency key remains suppressed");

        var nestedDispatched = new List<EntityId>();
        var nestedDepths = new List<int>();
        var root = CreateTestReaction("nested-root", priority: 30, order: "root", depth: 0, budgetCost: 1);
        var child = CreateTestReaction("nested-child", priority: 20, order: "child", depth: 0, budgetCost: 1);
        var grandchild = CreateTestReaction("nested-grandchild", priority: 10, order: "grandchild", depth: 0, budgetCost: 1);
        DeterministicBoundedReactionQueue nestedQueue = null!;
        nestedQueue = new DeterministicBoundedReactionQueue(
            maxReactions: 3,
            maxDepth: 2,
            maxBudget: 3,
            command =>
            {
                nestedDispatched.Add(command.ReactionId);
                nestedDepths.Add(command.Depth);
                if (command.ReactionId == root.ReactionId)
                {
                    nestedQueue.Enqueue(child);
                }
                else if (command.ReactionId == child.ReactionId)
                {
                    nestedQueue.Enqueue(grandchild);
                }
            });
        nestedQueue.Enqueue(root);
        Equal(
            3,
            nestedQueue.Drain(new ReactionBudget(3, 2, 3)),
            "reactions enqueued by dispatch stay in the same causation wave");
        SequenceEqual(
            new[] { root.ReactionId, child.ReactionId, grandchild.ReactionId },
            nestedDispatched,
            "nested reactions are dispatched before the wave closes");
        SequenceEqual(
            new[] { 0, 1, 2 },
            nestedDepths,
            "the queue derives child depth from the active parent instead of trusting handler input");
        Equal(0, nestedQueue.PendingCount, "nested wave leaves no work for a later drain");

        var forgedRoot = CreateTestReaction(
            "forged-depth-root",
            priority: 1,
            order: "root",
            depth: 0,
            budgetCost: 1);
        var forgedChild = CreateTestReaction(
            "forged-depth-child",
            priority: 2,
            order: "child",
            depth: 0,
            budgetCost: 1);
        DeterministicBoundedReactionQueue depthOwnershipQueue = null!;
        depthOwnershipQueue = new DeterministicBoundedReactionQueue(
            maxReactions: 2,
            maxDepth: 0,
            maxBudget: 2,
            command =>
            {
                if (command.ReactionId == forgedRoot.ReactionId)
                {
                    depthOwnershipQueue.Enqueue(forgedChild);
                }
            });
        depthOwnershipQueue.Enqueue(forgedRoot);
        Throws<InvalidOperationException>(
            () => depthOwnershipQueue.Drain(new ReactionBudget(2, 0, 2)),
            "a handler cannot bypass MaxDepth by declaring its child as depth zero");
        Equal(
            0,
            depthOwnershipQueue.PendingCount,
            "a derived-depth violation discards the remainder of the causation wave");

        var exhaustedQueue = new DeterministicBoundedReactionQueue(2, 2, 6, _ => { });
        var expensive = CreateTestReaction("expensive", priority: 1, order: "a", depth: 2, budgetCost: 3);
        exhaustedQueue.Enqueue(expensive);
        Throws<InvalidOperationException>(
            () => exhaustedQueue.Drain(new ReactionBudget(1, 2, 2)),
            "a drain budget that cannot complete the wave fails explicitly");
        Equal(0, exhaustedQueue.PendingCount, "budget-exhausted work is discarded instead of deferred");
        Equal(
            0,
            exhaustedQueue.Drain(new ReactionBudget(1, 2, 3)),
            "discarded exhausted work cannot run on a later drain");

        var limitRoot = CreateTestReaction("limit-root", priority: 1, order: "a", depth: 0, budgetCost: 1);
        var limitChild = CreateTestReaction("limit-child", priority: 2, order: "b", depth: 1, budgetCost: 1);
        DeterministicBoundedReactionQueue limitQueue = null!;
        limitQueue = new DeterministicBoundedReactionQueue(
            maxReactions: 1,
            maxDepth: 1,
            maxBudget: 2,
            command =>
            {
                try
                {
                    limitQueue.Enqueue(limitChild);
                }
                catch (InvalidOperationException)
                {
                    // Even a handler that swallows the local Enqueue exception cannot
                    // hide a causation-wave bound violation from Drain.
                }
            });
        limitQueue.Enqueue(limitRoot);
        Throws<InvalidOperationException>(
            () => limitQueue.Drain(new ReactionBudget(1, 1, 2)),
            "nested count overflow fails the whole causation wave");
        Equal(0, limitQueue.PendingCount, "nested overflow leaves no deferred reaction");

        var throwingFirst = CreateTestReaction("throwing-first", priority: 1, order: "a", depth: 0, budgetCost: 1);
        var skippedSecond = CreateTestReaction("skipped-second", priority: 2, order: "b", depth: 0, budgetCost: 1);
        var throwingQueue = new DeterministicBoundedReactionQueue(
            2,
            1,
            2,
            command =>
            {
                if (command.ReactionId == throwingFirst.ReactionId)
                {
                    throw new InvalidOperationException("handler failure");
                }
            });
        throwingQueue.Enqueue(skippedSecond);
        throwingQueue.Enqueue(throwingFirst);
        Throws<InvalidOperationException>(
            () => throwingQueue.Drain(new ReactionBudget(2, 1, 2)),
            "dispatch exceptions are surfaced to the caller");
        Equal(0, throwingQueue.PendingCount, "dispatch failure discards undispatched reactions");
        throwingQueue.Enqueue(skippedSecond);
        Equal(0, throwingQueue.PendingCount, "discarded reaction idempotency keys remain suppressed");

        var depthQueue = new DeterministicBoundedReactionQueue(2, 2, 6, _ => { });
        Throws<InvalidOperationException>(
            () => depthQueue.Enqueue(CreateTestReaction("too-deep", 1, "z", 3, 1)),
            "queue rejects reaction beyond its depth bound");

        var capacityQueue = new DeterministicBoundedReactionQueue(1, 1, 5, _ => { });
        capacityQueue.Enqueue(CreateTestReaction("capacity-a", 1, "a", 1, 1));
        Throws<InvalidOperationException>(
            () => capacityQueue.Enqueue(CreateTestReaction("capacity-b", 1, "b", 1, 1)),
            "queue rejects work beyond its pending-count bound");

        var budgetQueue = new DeterministicBoundedReactionQueue(2, 1, 2, _ => { });
        Throws<InvalidOperationException>(
            () => budgetQueue.Enqueue(CreateTestReaction("over-budget", 1, "a", 1, 3)),
            "queue rejects work beyond its maximum pending budget");
    }

    private void VerifyStatusCatchUpPolicy()
    {
        const long currentTick = 1_000;
        Equal<StatusCatchUpResult?>(
            null,
            default(StatusCatchUpResult),
            "default StatusCatchUpResult cannot create an invalid result instance");
        var active = StatusCatchUpPolicy.Evaluate(currentTick, expiresAtTick: 1_010, 5, 3);
        Equal(3, active.TicksToExecute, "active catch-up respects the cap");
        Equal(StatusCatchUpAction.DeferRemainingTicks, active.Action, "active status defers excess ticks");
        Equal<StatusRemoveReason?>(null, active.RemoveReason, "active status remains open");

        var expiredBacklog = StatusCatchUpPolicy.Evaluate(currentTick, expiresAtTick: 999, 5, 3);
        Equal(3, expiredBacklog.TicksToExecute, "expired catch-up respects the cap");
        Equal(StatusCatchUpAction.CloseExpiredStatus, expiredBacklog.Action, "expired status closes after limited catch-up");
        Equal<StatusRemoveReason?>(
            StatusRemoveReason.CatchUpLimited,
            expiredBacklog.RemoveReason,
            "expired backlog has an explicit limited-catch-up reason");

        var withinLimit = StatusCatchUpPolicy.Evaluate(currentTick, expiresAtTick: 1_010, 2, 3);
        Equal(StatusCatchUpAction.ExecuteDueTicks, withinLimit.Action, "active ticks within the cap execute normally");

        var expiredWithinLimit = StatusCatchUpPolicy.Evaluate(currentTick, expiresAtTick: 999, 2, 3);
        Equal(2, expiredWithinLimit.TicksToExecute, "expired status executes due ticks within the cap");
        Equal(StatusCatchUpAction.CloseExpiredStatus, expiredWithinLimit.Action, "expired status closes even within the cap");
        Equal<StatusRemoveReason?>(StatusRemoveReason.Expired, expiredWithinLimit.RemoveReason, "normal expiry is explicit");

        var expiredWithoutTicks = StatusCatchUpPolicy.Evaluate(currentTick, expiresAtTick: currentTick, 0, 3);
        Equal(0, expiredWithoutTicks.TicksToExecute, "expired status may close with no due tick");
        Equal(StatusCatchUpAction.CloseExpiredStatus, expiredWithoutTicks.Action, "zero-due expired status still closes");
        Equal<StatusRemoveReason?>(StatusRemoveReason.Expired, expiredWithoutTicks.RemoveReason, "zero-due closure is normal expiry");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new StatusCatchUpResult(
                -1,
                StatusCatchUpAction.ExecuteDueTicks,
                null),
            "catch-up result rejects a negative tick count");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new StatusCatchUpResult(
                0,
                (StatusCatchUpAction)int.MaxValue,
                null),
            "catch-up result rejects an undefined action");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new StatusCatchUpResult(
                0,
                StatusCatchUpAction.CloseExpiredStatus,
                (StatusRemoveReason)int.MaxValue),
            "catch-up result rejects an undefined removal reason");
        Throws<ArgumentException>(
            () => _ = new StatusCatchUpResult(
                0,
                StatusCatchUpAction.CloseExpiredStatus,
                null),
            "closing a catch-up result requires an expiry reason");
        Throws<ArgumentException>(
            () => _ = new StatusCatchUpResult(
                1,
                StatusCatchUpAction.ExecuteDueTicks,
                StatusRemoveReason.Expired),
            "continuing a catch-up result cannot have a removal reason");
        Throws<ArgumentException>(
            () => _ = new StatusCatchUpResult(
                0,
                StatusCatchUpAction.CloseExpiredStatus,
                StatusRemoveReason.Dispelled),
            "catch-up closure cannot use an unrelated dispel reason");
        Throws<ArgumentException>(
            () => _ = new StatusCatchUpResult(
                0,
                StatusCatchUpAction.DeferRemainingTicks,
                null),
            "deferred catch-up cannot claim progress when it executes no tick");
        Throws<ArgumentException>(
            () => _ = new StatusCatchUpResult(
                0,
                StatusCatchUpAction.CloseExpiredStatus,
                StatusRemoveReason.CatchUpLimited),
            "limited catch-up closure must execute at least one bounded tick");
    }

    private sealed class CountingCombatResolver : ICombatResolver
    {
        private readonly ICombatResolver _inner;

        public CountingCombatResolver(ICombatResolver inner)
        {
            _inner = inner ?? throw new ArgumentNullException(nameof(inner));
        }

        public int CallCount { get; private set; }

        public DamageResult Resolve(
            DamageRequest request,
            CombatContext context)
        {
            CallCount++;
            return _inner.Resolve(request, context);
        }
    }

    private sealed class FixedCombatResolver : ICombatResolver
    {
        private readonly DamageResult _result;

        public FixedCombatResolver(DamageResult result)
        {
            _result = result ?? throw new ArgumentNullException(nameof(result));
        }

        public DamageResult Resolve(
            DamageRequest request,
            CombatContext context)
        {
            ArgumentNullException.ThrowIfNull(request);
            ArgumentNullException.ThrowIfNull(context);
            return _result;
        }
    }

    private static ReactionCommand CreateTestReaction(
        string suffix,
        int priority,
        string order,
        int depth,
        int budgetCost,
        string? idempotencySuffix = null) =>
        new(
            new EntityId($"reaction.test.{suffix}"),
            new EntityId($"idempotency.test.{idempotencySuffix ?? suffix}"),
            new EntityId("handler.test"),
            FireballReferenceScenario.TargetId,
            FireballReferenceScenario.SkillSource,
            new EntityId($"event.test.trigger.{suffix}"),
            priority,
            new EntityId($"order.test.{order}"),
            depth,
            budgetCost);

    private static int RoundDamage(decimal value) =>
        decimal.ToInt32(decimal.Round(value, 0, MidpointRounding.AwayFromZero));

    private void Equal<T>(T expected, T actual, string description)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new InvalidOperationException(
                $"{description}: expected '{expected}', actual '{actual}'.");
        }

        AssertionCount++;
    }

    private void SequenceEqual<T>(IEnumerable<T> expected, IEnumerable<T> actual, string description)
    {
        if (!expected.SequenceEqual(actual))
        {
            throw new InvalidOperationException($"{description}: sequences differ.");
        }

        AssertionCount++;
    }

    private void True(bool condition, string description)
    {
        if (!condition)
        {
            throw new InvalidOperationException(description);
        }

        AssertionCount++;
    }

    private void Throws<TException>(Action action, string description)
        where TException : Exception
    {
        try
        {
            action();
        }
        catch (TException)
        {
            AssertionCount++;
            return;
        }

        throw new InvalidOperationException(
            $"{description}: expected {typeof(TException).Name}.");
    }
}
