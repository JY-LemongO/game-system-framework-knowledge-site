using GameSystemKnowledge.Reference.Contracts;
using GameSystemKnowledge.Reference.Runtime;
using GameSystemKnowledge.Reference.Systems;

namespace GameSystemKnowledge.Reference.Verification;

public static class AdvancedFoundationVerification
{
    public static int Run()
    {
        var suite = new AdvancedFoundationSuite();
        suite.Run();
        return suite.AssertionCount;
    }
}

internal sealed class AdvancedFoundationSuite
{
    private static readonly EntityId OwnerId = new("entity.advanced-owner");
    private static readonly EntityId CasterId = new("entity.advanced-caster");
    private static readonly EntityId ExplicitTargetId =
        new("entity.advanced-explicit");
    private static readonly EntityId SkillId = new("skill.advanced-foundation");
    private static readonly EntityId CommandId =
        new("command.advanced-foundation");
    private static readonly SourceRef SkillSource =
        SourceRef.SkillExecution(SkillId, CommandId);

    public int AssertionCount { get; private set; }

    public void Run()
    {
        VerifyNumericLanes();
        VerifyDerivedStatGraphAndEvaluation();
        VerifyContextualCacheIdentity();
        VerifyDeterministicTargetResolution();
        VerifyEffectCommitComposition();
    }

    private void VerifyNumericLanes()
    {
        Equal(
            new StatScalar(100m),
            StatNumericLanes.ApplyRate(
                new StatScalar(80m),
                new BasisPointRate(12_500)),
            "basis-point rate stays in an explicit integer lane");
        Equal(
            3L,
            StatNumericLanes.ToCommitInteger(new StatScalar(2.5m)),
            "positive midpoint rounds away from zero at the commit boundary");
        Equal(
            -3L,
            StatNumericLanes.ToCommitInteger(new StatScalar(-2.5m)),
            "negative midpoint rounds away from zero at the commit boundary");
        Throws<OverflowException>(
            () => StatNumericLanes.ToCommitInteger(
                new StatScalar(decimal.MaxValue)),
            "commit conversion rejects long overflow");
    }

    private void VerifyDerivedStatGraphAndEvaluation()
    {
        var attackId = new EntityId("stat.attack");
        var criticalId = new EntityId("stat.critical");
        var powerId = new EntityId("stat.power");
        var stackRuleId = new EntityId("stack-rule.advanced");
        var source = SourceRef.System(new EntityId("system.advanced-stat"));
        var modifiers = new[]
        {
            CreateModifier(
                "more",
                attackId,
                ModifierOperation.More,
                0.1m,
                priority: 30),
            CreateModifier(
                "percent",
                attackId,
                ModifierOperation.PercentAdd,
                0.5m,
                priority: 20),
            CreateModifier(
                "add",
                attackId,
                ModifierOperation.Add,
                20m,
                priority: 10)
        };
        var attack = new DerivedStatDefinition(
            attackId,
            new StatScalar(100m),
            modifiers: modifiers);
        var critical = new DerivedStatDefinition(
            criticalId,
            new StatScalar(5m));
        var power = new DerivedStatDefinition(
            powerId,
            new StatScalar(2m),
            new[] { attackId },
            (baseValue, dependencies, _) =>
                new StatScalar(
                    baseValue.Value +
                    dependencies.Get(attackId).Value * 2m));

        var graph = new DerivedStatGraph(
            new[] { power, critical, attack });
        SequenceEqual(
            new[] { attackId, criticalId, powerId },
            graph.EvaluationOrder,
            "DAG topological ties use EntityId ordinal order");

        var evaluator = new ReferenceDerivedStatEvaluator(
            graph,
            new StatEvaluationVersion(0, 0, 0));
        var context = new StatContext(
            OwnerId,
            targetId: null,
            skillId: null);
        Equal(
            398m,
            evaluator.GetValue(OwnerId, powerId, context),
            "derived formula runs after Add, PercentAdd, and More stages");
        Equal(
            1,
            evaluator.CacheEntryCount,
            "only the requested stat result is cached");
        Throws<KeyNotFoundException>(
            () => evaluator.GetValue(
                OwnerId,
                new EntityId("stat.unknown"),
                context),
            "unknown requested stats fail explicitly");
        Throws<ArgumentException>(
            () => evaluator.GetValue(
                new EntityId("entity.other-owner"),
                powerId,
                context),
            "query owner cannot disagree with the context owner");

        var overrideId = new EntityId("stat.override");
        var overrideGraph = new DerivedStatGraph(
            new[]
            {
                new DerivedStatDefinition(
                    overrideId,
                    new StatScalar(10m),
                    modifiers: new[]
                    {
                        CreateModifier(
                            "zeta",
                            overrideId,
                            ModifierOperation.Override,
                            30m,
                            priority: 5),
                        CreateModifier(
                            "alpha",
                            overrideId,
                            ModifierOperation.Override,
                            20m,
                            priority: 5),
                        CreateModifier(
                            "low-priority",
                            overrideId,
                            ModifierOperation.Override,
                            15m,
                            priority: 0)
                    })
            });
        Equal(
            30m,
            new ReferenceDerivedStatEvaluator(
                    overrideGraph,
                    new StatEvaluationVersion(0, 0, 0))
                .GetValue(OwnerId, overrideId, context),
            "highest priority then greatest ordinal modifier ID wins Override");

        Throws<ArgumentException>(
            () => _ = new DerivedStatGraph(
                new[]
                {
                    new DerivedStatDefinition(
                        powerId,
                        new StatScalar(0m),
                        new[] { attackId },
                        (baseValue, _, _) => baseValue)
                }),
            "graph rejects a missing dependency at load time");

        var cycleAId = new EntityId("stat.cycle-a");
        var cycleBId = new EntityId("stat.cycle-b");
        Throws<ArgumentException>(
            () => _ = new DerivedStatGraph(
                new[]
                {
                    new DerivedStatDefinition(
                        cycleAId,
                        new StatScalar(0m),
                        new[] { cycleBId },
                        (baseValue, _, _) => baseValue),
                    new DerivedStatDefinition(
                        cycleBId,
                        new StatScalar(0m),
                        new[] { cycleAId },
                        (baseValue, _, _) => baseValue)
                }),
            "graph rejects dependency cycles at load time");

        Throws<ArgumentException>(
            () => _ = new DerivedStatDefinition(
                powerId,
                new StatScalar(0m),
                new[] { attackId, attackId },
                (baseValue, _, _) => baseValue),
            "a definition rejects duplicate dependencies");

        var undeclaredReadGraph = new DerivedStatGraph(
            new[]
            {
                attack,
                critical,
                new DerivedStatDefinition(
                    powerId,
                    new StatScalar(0m),
                    new[] { attackId },
                    (_, dependencies, _) =>
                        dependencies.Get(criticalId))
            });
        Throws<KeyNotFoundException>(
            () => new ReferenceDerivedStatEvaluator(
                    undeclaredReadGraph,
                    new StatEvaluationVersion(0, 0, 0))
                .GetValue(OwnerId, powerId, context),
            "a formula cannot read an undeclared dependency");

        var invalidPercentId = new EntityId("stat.invalid-percent");
        var invalidPercentGraph = new DerivedStatGraph(
            new[]
            {
                new DerivedStatDefinition(
                    invalidPercentId,
                    new StatScalar(100m),
                    modifiers: new[]
                    {
                        CreateModifier(
                            "negative-one",
                            invalidPercentId,
                            ModifierOperation.PercentAdd,
                            -0.6m,
                            priority: 0),
                        CreateModifier(
                            "negative-two",
                            invalidPercentId,
                            ModifierOperation.PercentAdd,
                            -0.6m,
                            priority: 1)
                    })
            });
        Throws<InvalidOperationException>(
            () => new ReferenceDerivedStatEvaluator(
                    invalidPercentGraph,
                    new StatEvaluationVersion(0, 0, 0))
                .GetValue(OwnerId, invalidPercentId, context),
            "combined PercentAdd cannot cross the zero multiplier boundary");

        var clampedId = new EntityId("stat.clamped");
        var clampedGraph = new DerivedStatGraph(
            new[]
            {
                new DerivedStatDefinition(
                    clampedId,
                    new StatScalar(100m),
                    modifiers: new[]
                    {
                        CreateModifier(
                            "clamp-upper",
                            clampedId,
                            ModifierOperation.Add,
                            50m,
                            priority: 0)
                    },
                    minimumValue: new StatScalar(0m),
                    maximumValue: new StatScalar(120m))
            });
        Equal(
            120m,
            new ReferenceDerivedStatEvaluator(
                    clampedGraph,
                    new StatEvaluationVersion(0, 0, 0))
                .GetValue(OwnerId, clampedId, context),
            "local modifiers are clamped before the commit rounding boundary");
        var boundaryGraph = new DerivedStatGraph(
            new[]
            {
                new DerivedStatDefinition(
                    clampedId,
                    new StatScalar(120m),
                    minimumValue: new StatScalar(0m),
                    maximumValue: new StatScalar(120m))
            });
        Equal(
            120m,
            new ReferenceDerivedStatEvaluator(
                    boundaryGraph,
                    new StatEvaluationVersion(0, 0, 0))
                .GetValue(OwnerId, clampedId, context),
            "a value exactly on the maximum remains unchanged");
        var minimumOnlyId = new EntityId("stat.minimum-only");
        var minimumOnlyGraph = new DerivedStatGraph(
            new[]
            {
                new DerivedStatDefinition(
                    minimumOnlyId,
                    new StatScalar(-5m),
                    minimumValue: new StatScalar(0m))
            });
        Equal(
            0m,
            new ReferenceDerivedStatEvaluator(
                    minimumOnlyGraph,
                    new StatEvaluationVersion(0, 0, 0))
                .GetValue(OwnerId, minimumOnlyId, context),
            "a definition may clamp only its lower boundary");
        var maximumOnlyId = new EntityId("stat.maximum-only");
        var maximumOnlyGraph = new DerivedStatGraph(
            new[]
            {
                new DerivedStatDefinition(
                    maximumOnlyId,
                    new StatScalar(150m),
                    maximumValue: new StatScalar(120m))
            });
        Equal(
            120m,
            new ReferenceDerivedStatEvaluator(
                    maximumOnlyGraph,
                    new StatEvaluationVersion(0, 0, 0))
                .GetValue(OwnerId, maximumOnlyId, context),
            "a definition may clamp only its upper boundary");
        Throws<ArgumentException>(
            () => _ = new DerivedStatDefinition(
                clampedId,
                new StatScalar(0m),
                minimumValue: new StatScalar(2m),
                maximumValue: new StatScalar(1m)),
            "definition rejects an inverted clamp interval");

        StatModifier CreateModifier(
            string suffix,
            EntityId statId,
            ModifierOperation operation,
            decimal value,
            int priority) =>
            new(
                new EntityId($"modifier.advanced-{suffix}"),
                statId,
                operation,
                value,
                source,
                priority,
                stackRuleId);
    }

    private void VerifyContextualCacheIdentity()
    {
        var contextualId = new EntityId("stat.contextual");
        var evaluationCount = 0;
        var graph = new DerivedStatGraph(
            new[]
            {
                new DerivedStatDefinition(
                    contextualId,
                    new StatScalar(10m),
                    formula: (baseValue, _, context) =>
                    {
                        evaluationCount++;
                        return new StatScalar(
                            baseValue.Value +
                            (context.TargetId.HasValue ? 100m : 0m) +
                            (context.SkillId.HasValue ? 10m : 0m) +
                            context.SkillTags.Count +
                            context.TargetTags.Count +
                            context.TargetStatuses.Count +
                            context.Distance);
                    })
            });
        var version = new StatEvaluationVersion(
            ownerVersion: 4,
            definitionVersion: 2,
            numericPolicyVersion: 1);
        var evaluator = new ReferenceDerivedStatEvaluator(
            graph,
            version,
            new ConstantHashStatCacheComparer());
        var statusAlpha = new EntityId("status.alpha");
        var statusBeta = new EntityId("status.beta");
        var first = new StatContext(
            OwnerId,
            targetId: null,
            skillId: null,
            skillTags: new[] { "spell", "fire" },
            targetTags: new[] { "boss" },
            targetStatuses: new[] { statusBeta, statusAlpha },
            distance: 2m,
            moment: "release");
        var equivalent = new StatContext(
            OwnerId,
            targetId: null,
            skillId: null,
            skillTags: new[] { "fire", "spell", "fire" },
            targetTags: new[] { "boss" },
            targetStatuses: new[] { statusBeta, statusAlpha },
            distance: 2.00m,
            moment: "release");

        Equal(
            17m,
            evaluator.GetValue(OwnerId, contextualId, first, version),
            "contextual formula observes every declared context lane");
        Equal(
            17m,
            evaluator.GetValue(OwnerId, contextualId, equivalent, version),
            "canonical tag order and identical status order reuse one cache entry");
        Equal(
            1,
            evaluationCount,
            "equivalent canonical contexts hit the cache");
        Equal(
            1,
            evaluator.CacheEntryCount,
            "equivalent contexts do not add a cache key");

        var reorderedStatuses = new StatContext(
            OwnerId,
            targetId: null,
            skillId: null,
            skillTags: new[] { "fire", "spell" },
            targetTags: new[] { "boss" },
            targetStatuses: new[] { statusAlpha, statusBeta },
            distance: 2m,
            moment: "release");
        evaluator.GetValue(
            OwnerId,
            contextualId,
            reorderedStatuses,
            version);
        Equal(
            2,
            evaluationCount,
            "observable status-list order stays in the full cache descriptor");
        Equal(
            2,
            evaluator.CacheEntryCount,
            "status-list reordering cannot create a correctness-unsafe hit");

        var targetPresent = new StatContext(
            OwnerId,
            ExplicitTargetId,
            skillId: null,
            skillTags: new[] { "fire", "spell" },
            targetTags: new[] { "boss" },
            targetStatuses: new[] { statusAlpha, statusBeta },
            distance: 2m,
            moment: "release");
        Equal(
            117m,
            evaluator.GetValue(
                OwnerId,
                contextualId,
                targetPresent,
                version),
            "target presence changes the contextual result under a forced hash collision");
        Equal(
            3,
            evaluationCount,
            "full descriptor equality prevents a collision false hit");

        var skillPresent = new StatContext(
            OwnerId,
            targetId: null,
            SkillId,
            skillTags: new[] { "fire", "spell" },
            targetTags: new[] { "boss" },
            targetStatuses: new[] { statusAlpha, statusBeta },
            distance: 2m,
            moment: "release");
        Equal(
            27m,
            evaluator.GetValue(
                OwnerId,
                contextualId,
                skillPresent,
                version),
            "optional skill presence is part of the cache identity");
        Equal(
            4,
            evaluator.CacheEntryCount,
            "target and skill presence create distinct full keys");

        var differentMoment = new StatContext(
            OwnerId,
            targetId: null,
            skillId: null,
            skillTags: new[] { "fire", "spell" },
            targetTags: new[] { "boss" },
            targetStatuses: new[] { statusAlpha, statusBeta },
            distance: 2m,
            moment: "commit");
        evaluator.GetValue(
            OwnerId,
            contextualId,
            differentMoment,
            version);
        Equal(
            5,
            evaluator.CacheEntryCount,
            "moment is included even when the current formula yields the same value");

        var absentDescriptor = CanonicalStatContextDescriptor.From(first);
        var presentDescriptor = CanonicalStatContextDescriptor.From(targetPresent);
        True(
            !absentDescriptor.Equals(presentDescriptor),
            "canonical descriptor distinguishes absent from present optional fields");

        var ownerChanged = new StatEvaluationVersion(
            ownerVersion: 5,
            definitionVersion: 2,
            numericPolicyVersion: 1);
        evaluator.GetValue(OwnerId, contextualId, first, ownerChanged);
        Equal(
            6,
            evaluationCount,
            "owner snapshot version change forces recomputation");
        var definitionChanged = new StatEvaluationVersion(
            ownerVersion: 4,
            definitionVersion: 3,
            numericPolicyVersion: 1);
        evaluator.GetValue(OwnerId, contextualId, first, definitionChanged);
        Equal(
            7,
            evaluationCount,
            "definition version change forces recomputation");
        var numericPolicyChanged = new StatEvaluationVersion(
            ownerVersion: 4,
            definitionVersion: 2,
            numericPolicyVersion: 2);
        evaluator.GetValue(
            OwnerId,
            contextualId,
            first,
            numericPolicyChanged);
        Equal(
            8,
            evaluationCount,
            "numeric policy version change forces recomputation");
        evaluator.GetValue(
            OwnerId,
            contextualId,
            first,
            numericPolicyChanged);
        Equal(
            8,
            evaluationCount,
            "equal full version and descriptor still hit under a hash collision");
        Equal(
            8,
            evaluator.CacheEntryCount,
            "each descriptor or version identity owns one cache entry");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new StatEvaluationVersion(
                ownerVersion: -1,
                definitionVersion: 0,
                numericPolicyVersion: 0),
            "stat evaluation versions cannot be negative");

        evaluator.ClearCache();
        Equal(0, evaluator.CacheEntryCount, "explicit snapshot invalidation clears the cache");
    }

    private void VerifyDeterministicTargetResolution()
    {
        var selfOperation = CreateStatusOperation("a-self");
        var explicitOperation = CreateDamageOperation("m-explicit");
        var candidateOperation = CreateDamageOperation("z-candidate");
        var specification = new ReferenceEffectSpecification(
            new EntityId("effect-specification.advanced-targeting"),
            new ReferenceEffectOperationSpec[]
            {
                candidateOperation,
                explicitOperation,
                selfOperation
            });
        var context = new EffectContext(
            CasterId,
            ExplicitTargetId,
            SkillSource,
            RandomSeed: 17);
        var candidateB = new EffectTargetCandidate(
            new EntityId("entity.candidate-b"),
            selectionPriority: 5,
            distanceSquared: 10);
        var candidateC = new EffectTargetCandidate(
            new EntityId("entity.candidate-c"),
            selectionPriority: 5,
            distanceSquared: 10);
        var candidateD = new EffectTargetCandidate(
            new EntityId("entity.candidate-d"),
            selectionPriority: 10,
            distanceSquared: 100);
        var snapshot = new CanonicalTargetSnapshot(
            new[] { candidateC, candidateB, candidateD });

        SequenceEqual(
            new[]
            {
                candidateD.TargetId,
                candidateB.TargetId,
                candidateC.TargetId
            },
            snapshot.Candidates.Select(candidate => candidate.TargetId),
            "candidate snapshot has a total priority-distance-ID order");

        var rules = new[]
        {
            new EffectTargetRule(
                candidateOperation.OperationId,
                EffectTargetMode.CandidateSnapshot,
                maxTargets: 2),
            new EffectTargetRule(
                selfOperation.OperationId,
                EffectTargetMode.Self),
            new EffectTargetRule(
                explicitOperation.OperationId,
                EffectTargetMode.ExplicitTarget)
        };
        var resolution = ReferenceEffectTargetResolver.Resolve(
            specification,
            context,
            rules,
            snapshot);

        SequenceEqual(
            new[]
            {
                selfOperation.OperationId,
                explicitOperation.OperationId,
                candidateOperation.OperationId,
                candidateOperation.OperationId
            },
            resolution.Operations.Select(operation => operation.OperationId),
            "operation IDs determine cross-operation resolution order");
        SequenceEqual(
            new[]
            {
                CasterId,
                ExplicitTargetId,
                candidateD.TargetId,
                candidateB.TargetId
            },
            resolution.Operations.Select(operation => operation.TargetId),
            "each target mode binds the expected canonical target");
        Equal(
            0,
            resolution.NotApplicable.Count,
            "complete targeting produces no unresolved operations");

        var boundSelf = (ApplyStatusEffectOperation)
            resolution.Operations[0].BoundOperation;
        Equal(
            CasterId,
            boundSelf.Request.TargetId,
            "Self rebinding reaches the executable status request");
        Equal(
            SkillSource,
            boundSelf.Request.Source,
            "target binding uses the effect context source");
        var boundExplicit = (DamageEffectOperation)
            resolution.Operations[1].BoundOperation;
        Equal(
            CasterId,
            boundExplicit.Request.AttackerId,
            "damage binding uses the effect context caster");
        Equal(
            ExplicitTargetId,
            boundExplicit.Request.DefenderId,
            "ExplicitTarget rebinding reaches the executable damage request");
        Equal(
            0,
            resolution.Operations[2].TargetOrder,
            "candidate target order is retained for traceability");
        Equal(
            1,
            resolution.Operations[3].TargetOrder,
            "second candidate target order is retained for traceability");

        Throws<ArgumentException>(
            () => _ = new CanonicalTargetSnapshot(
                new[] { candidateB, candidateB }),
            "candidate snapshots reject duplicate target IDs");
        Throws<ArgumentNullException>(
            () => ReferenceEffectTargetResolver.Resolve(
                specification,
                context,
                rules,
                candidateSnapshot: null),
            "candidate rules require an explicit adapter snapshot");
        Throws<ArgumentException>(
            () => ReferenceEffectTargetResolver.Resolve(
                specification,
                context,
                rules.Take(2),
                snapshot),
            "every plan operation needs exactly one target rule");

        var missingTargets = ReferenceEffectTargetResolver.Resolve(
            specification,
            context with { InitialTargetId = null },
            rules,
            new CanonicalTargetSnapshot(
                Array.Empty<EffectTargetCandidate>()));
        SequenceEqual(
            new[]
            {
                explicitOperation.OperationId,
                candidateOperation.OperationId
            },
            missingTargets.NotApplicable.Select(item => item.OperationId),
            "missing explicit and candidate targets become stable NotApplicable outcomes");
        SequenceEqual(
            new[] { "explicit-target-missing", "candidate-snapshot-empty" },
            missingTargets.NotApplicable.Select(item => item.Reason),
            "target-resolution failure reasons are deterministic");
    }

    private void VerifyEffectCommitComposition()
    {
        var selfOperation = CreateStatusOperation("a-compose");
        var damageOperation = CreateDamageOperation("m-compose");
        var specification = new ReferenceEffectSpecification(
            new EntityId("effect-specification.advanced-compose"),
            new ReferenceEffectOperationSpec[]
            {
                damageOperation,
                selfOperation
            });
        var resolution = ReferenceEffectTargetResolver.Resolve(
            specification,
            new EffectContext(
                CasterId,
                ExplicitTargetId,
                SkillSource,
                RandomSeed: 23),
            new[]
            {
                new EffectTargetRule(
                    damageOperation.OperationId,
                    EffectTargetMode.ExplicitTarget),
                new EffectTargetRule(
                    selfOperation.OperationId,
                    EffectTargetMode.Self)
            });
        var resolvedSelf = resolution.Operations.Single(
            operation => operation.OperationId == selfOperation.OperationId);
        var resolvedDamage = resolution.Operations.Single(
            operation => operation.OperationId == damageOperation.OperationId);
        var hpResourceId = new EntityId("resource.advanced-hp");
        var statusResourceId = new EntityId("resource.advanced-status");
        var otherResourceId = new EntityId("resource.advanced-other");
        var selfFragment = new CommitPlanFragment(
            new EntityId("fragment.advanced-self"),
            resolvedSelf.OperationId,
            resolvedSelf.TargetId,
            new[]
            {
                new VersionPrecondition(statusResourceId, 4),
                new VersionPrecondition(hpResourceId, 7)
            },
            new[]
            {
                new StateMutation(
                    statusResourceId,
                    newValue: 2,
                    "Apply one deterministic status stack")
            },
            new DomainEvent[]
            {
                CreateEvent("a-status", CommandId)
            });
        var damageFragment = new CommitPlanFragment(
            new EntityId("fragment.advanced-damage"),
            resolvedDamage.OperationId,
            resolvedDamage.TargetId,
            new[]
            {
                new VersionPrecondition(hpResourceId, 7)
            },
            new[]
            {
                new StateMutation(
                    hpResourceId,
                    newValue: 90,
                    "Commit resolved damage")
            },
            new DomainEvent[]
            {
                CreateEvent("m-damage", CommandId)
            });
        var selfOutcome = EffectOperationOutcome.Applied(
            resolvedSelf,
            selfFragment);
        var damageOutcome = EffectOperationOutcome.Applied(
            resolvedDamage,
            damageFragment);

        var composition = DeterministicEffectCommitPlanComposer.Compose(
            CommandId,
            new[] { damageOutcome, selfOutcome });
        Equal(
            EffectCompositionStatus.Ready,
            composition.Status,
            "applied outcomes compose into a ready atomic plan");
        True(composition.Plan is not null, "ready composition contains a commit plan");
        SequenceEqual(
            new[] { hpResourceId, statusResourceId },
            composition.Plan!.Preconditions.Select(item => item.ResourceId),
            "shared equal preconditions are deduplicated and sorted");
        SequenceEqual(
            new[] { statusResourceId, hpResourceId },
            composition.Plan.Mutations.Select(item => item.ResourceId),
            "mutation order follows operation-target identity, not input order");
        SequenceEqual(
            new[]
            {
                new EntityId("event.advanced-a-status"),
                new EntityId("event.advanced-m-damage")
            },
            composition.Plan.OutboxEvents.Select(@event => @event.EventId),
            "outbox order follows the same deterministic fragment order");

        var sameComposition = DeterministicEffectCommitPlanComposer.Compose(
            CommandId,
            new[] { selfOutcome, damageOutcome });
        SequenceEqual(
            composition.Plan.Mutations.Select(item => item.ResourceId),
            sameComposition.Plan!.Mutations.Select(item => item.ResourceId),
            "reversing outcome input cannot change the commit mutation order");

        var committer = new InMemoryRuntimeCommitter(
            new[]
            {
                new VersionedResourceState(hpResourceId, Value: 100, Version: 7),
                new VersionedResourceState(statusResourceId, Value: 1, Version: 4)
            });
        var receipt = committer.Commit(composition.Plan);
        Equal(
            CommitStatus.Committed,
            receipt.Status,
            "composed effect plan executes through the native runtime committer");
        Equal(
            90L,
            committer.GetValue(hpResourceId),
            "composed damage mutation reaches committed state");
        Equal(
            2L,
            committer.GetValue(statusResourceId),
            "composed status mutation reaches committed state");
        Equal(
            2,
            receipt.OutboxEvents.Count,
            "composed events commit in the same transaction");

        var noChanges = DeterministicEffectCommitPlanComposer.Compose(
            new EntityId("command.advanced-no-changes"),
            new[]
            {
                EffectOperationOutcome.NotApplicable(
                    selfOperation.OperationId,
                    targetId: null,
                    "no-valid-target")
            });
        Equal(
            EffectCompositionStatus.NoChanges,
            noChanges.Status,
            "NotApplicable outcomes produce an explicit no-change result");
        Equal<CommitPlan?>(
            null,
            noChanges.Plan,
            "no-change composition cannot expose a commit plan");

        var rejected = DeterministicEffectCommitPlanComposer.Compose(
            new EntityId("command.advanced-rejected"),
            new[]
            {
                selfOutcome,
                EffectOperationOutcome.Rejected(
                    damageOperation.OperationId,
                    ExplicitTargetId,
                    "target-version-stale")
            });
        Equal(
            EffectCompositionStatus.Rejected,
            rejected.Status,
            "one rejected operation rejects the atomic bundle");
        Equal<CommitPlan?>(
            null,
            rejected.Plan,
            "rejected composition cannot expose a partial plan");
        SequenceEqual(
            new[] { $"{damageOperation.OperationId.Value}:target-version-stale" },
            rejected.RejectionReasons,
            "rejection reasons retain stable operation identity");

        Throws<ArgumentException>(
            () => DeterministicEffectCommitPlanComposer.Compose(
                new EntityId("command.advanced-duplicate-outcome"),
                new[] { selfOutcome, selfOutcome }),
            "composer rejects duplicate operation-target outcomes");
        Throws<ArgumentException>(
            () => DeterministicEffectCommitPlanComposer.Compose(
                new EntityId("command.advanced-contradictory-outcome"),
                new[]
                {
                    selfOutcome,
                    EffectOperationOutcome.NotApplicable(
                        selfOperation.OperationId,
                        targetId: null,
                        "operation-wide-target-miss")
                }),
            "operation-wide NotApplicable cannot coexist with an applied target");
        Throws<ArgumentException>(
            () => EffectOperationOutcome.Applied(
                resolvedSelf,
                damageFragment),
            "applied outcome rejects a fragment for another operation");

        var candidateTargetId = new EntityId("entity.advanced-candidate");
        var candidateResolved = ResolveExplicitOperation(
            CreateDamageOperation("z-compose"),
            candidateTargetId,
            randomSeed: 29);
        var duplicateFragmentId = new CommitPlanFragment(
            selfFragment.FragmentId,
            candidateResolved.OperationId,
            candidateResolved.TargetId,
            new[] { new VersionPrecondition(otherResourceId, 1) },
            new[]
            {
                new StateMutation(
                    otherResourceId,
                    newValue: 1,
                    "Write an independent target resource")
            });
        Throws<ArgumentException>(
            () => DeterministicEffectCommitPlanComposer.Compose(
                new EntityId("command.advanced-duplicate-fragment"),
                new[]
                {
                    selfOutcome,
                    EffectOperationOutcome.Applied(
                        candidateResolved,
                        duplicateFragmentId)
                }),
            "composer rejects duplicate fragment IDs");

        var preconditionCollision = new CommitPlanFragment(
            new EntityId("fragment.advanced-precondition-collision"),
            candidateResolved.OperationId,
            candidateResolved.TargetId,
            new[]
            {
                new VersionPrecondition(hpResourceId, 8),
                new VersionPrecondition(otherResourceId, 1)
            },
            new[]
            {
                new StateMutation(
                    otherResourceId,
                    newValue: 1,
                    "Write an independently versioned resource")
            });
        Throws<ArgumentException>(
            () => DeterministicEffectCommitPlanComposer.Compose(
                new EntityId("command.advanced-precondition-collision"),
                new[]
                {
                    selfOutcome,
                    EffectOperationOutcome.Applied(
                        candidateResolved,
                        preconditionCollision)
                }),
            "composer rejects contradictory versions for one precondition");

        var mutationCollision = new CommitPlanFragment(
            new EntityId("fragment.advanced-mutation-collision"),
            candidateResolved.OperationId,
            candidateResolved.TargetId,
            new[] { new VersionPrecondition(statusResourceId, 4) },
            new[]
            {
                new StateMutation(
                    statusResourceId,
                    newValue: 3,
                    "Attempt a second write to the same resource")
            });
        Throws<ArgumentException>(
            () => DeterministicEffectCommitPlanComposer.Compose(
                new EntityId("command.advanced-mutation-collision"),
                new[]
                {
                    selfOutcome,
                    EffectOperationOutcome.Applied(
                        candidateResolved,
                        mutationCollision)
                }),
            "composer rejects implicit last-write-wins mutation collisions");

        var duplicateEvent = new CommitPlanFragment(
            new EntityId("fragment.advanced-duplicate-event"),
            candidateResolved.OperationId,
            candidateResolved.TargetId,
            new[] { new VersionPrecondition(otherResourceId, 1) },
            new[]
            {
                new StateMutation(
                    otherResourceId,
                    newValue: 1,
                    "Write an event test resource")
            },
            new DomainEvent[]
            {
                CreateEvent("a-status", CommandId)
            });
        Throws<ArgumentException>(
            () => DeterministicEffectCommitPlanComposer.Compose(
                new EntityId("command.advanced-duplicate-event"),
                new[]
                {
                    selfOutcome,
                    EffectOperationOutcome.Applied(
                        candidateResolved,
                        duplicateEvent)
                }),
            "composer rejects duplicate outbox event IDs");

        Throws<ArgumentException>(
            () => _ = new CommitPlanFragment(
                new EntityId("fragment.advanced-missing-precondition"),
                candidateResolved.OperationId,
                candidateResolved.TargetId,
                Array.Empty<VersionPrecondition>(),
                new[]
                {
                    new StateMutation(
                        otherResourceId,
                        newValue: 1,
                        "Mutation without an expected version")
                }),
            "fragment rejects a mutation without a precondition");

        AdvancedFoundationEvent CreateEvent(
            string suffix,
            EntityId commandId) =>
            new(
                new EntityId($"event.advanced-{suffix}"),
                commandId,
                SkillSource);
    }

    private static DamageEffectSpec CreateDamageOperation(string suffix) =>
        new(
            new EntityId($"effect.operation.{suffix}"),
            new EntityId("formula.advanced-damage"),
            "arcane",
            baseValue: 10,
            coefficientBps: 10_000,
            tags: new[] { "spell", "arcane" });

    private static ApplyStatusEffectSpec CreateStatusOperation(string suffix) =>
        new(
            new EntityId($"effect.operation.{suffix}"),
            new EntityId("status.advanced-mark"),
            stackDelta: 1);

    private static ResolvedEffectOperation ResolveExplicitOperation(
        ReferenceEffectOperationSpec operation,
        EntityId targetId,
        uint randomSeed)
    {
        var specification = new ReferenceEffectSpecification(
            new EntityId("effect-specification.advanced-single-explicit"),
            new[] { operation });
        return ReferenceEffectTargetResolver.Resolve(
                specification,
                new EffectContext(
                    CasterId,
                    targetId,
                    SkillSource,
                    randomSeed),
                new[]
                {
                    new EffectTargetRule(
                        operation.OperationId,
                        EffectTargetMode.ExplicitTarget)
                })
            .Operations
            .Single();
    }

    private void Equal<T>(T expected, T actual, string description)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new InvalidOperationException(
                $"{description}: expected '{expected}', actual '{actual}'.");
        }

        AssertionCount++;
    }

    private void SequenceEqual<T>(
        IEnumerable<T> expected,
        IEnumerable<T> actual,
        string description)
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

    private void Throws<TException>(
        Action action,
        string description)
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

internal sealed class ConstantHashStatCacheComparer :
    IEqualityComparer<StatEvaluationCacheKey>
{
    public bool Equals(
        StatEvaluationCacheKey? left,
        StatEvaluationCacheKey? right) =>
        left?.Equals(right) ?? right is null;

    public int GetHashCode(StatEvaluationCacheKey _) => 1;
}

internal sealed record AdvancedFoundationEvent(
    EntityId EventId,
    EntityId CommandId,
    SourceRef Source)
    : DomainEvent(EventId, CommandId, Source);
