using GameSystemKnowledge.Reference.Contracts;
using GameSystemKnowledge.Reference.Systems;

namespace GameSystemKnowledge.Reference.Verification;

public static class StatusPolicyVerification
{
    public static int Run()
    {
        var suite = new StatusPolicySuite();
        suite.Run();
        return suite.AssertionCount;
    }
}

internal sealed class StatusPolicySuite
{
    public int AssertionCount { get; private set; }

    public void Run()
    {
        VerifyIdentitySourceScopes();
        VerifyReapplicationTruthTable();
        VerifyDurationTruthTableAndOverflow();
        VerifyImmunityOutcome();
        VerifyCleanseFiltersAndGlobalOrdering();
        VerifyBoundaryFailures();
    }

    private void VerifyIdentitySourceScopes()
    {
        var firstSource = SkillSource("skill.poison", "command.cast-a");
        var secondSource = SkillSource("skill.poison", "command.cast-b");
        var otherDefinitionSource =
            SkillSource("skill.toxin", "command.cast-c");

        var anyFirst = CreateIdentity(
            StatusSourceScope.AnySource,
            firstSource);
        var anySecond = CreateIdentity(
            StatusSourceScope.AnySource,
            otherDefinitionSource);
        True(
            anyFirst.Matches(anySecond),
            "AnySource ignores source definition and instance");

        var definitionFirst = CreateIdentity(
            StatusSourceScope.SourceDefinition,
            firstSource);
        var definitionSecond = CreateIdentity(
            StatusSourceScope.SourceDefinition,
            secondSource);
        True(
            definitionFirst.Matches(definitionSecond),
            "SourceDefinition merges casts from the same source definition");
        True(
            !definitionFirst.Matches(CreateIdentity(
                StatusSourceScope.SourceDefinition,
                otherDefinitionSource)),
            "SourceDefinition separates another source definition");

        var instanceFirst = CreateIdentity(
            StatusSourceScope.SourceInstance,
            firstSource);
        True(
            instanceFirst.Matches(CreateIdentity(
                StatusSourceScope.SourceInstance,
                firstSource)),
            "SourceInstance matches the exact source instance");
        True(
            !instanceFirst.Matches(CreateIdentity(
                StatusSourceScope.SourceInstance,
                secondSource)),
            "SourceInstance separates casts from one skill definition");

        True(
            !anyFirst.Matches(CreateIdentity(
                StatusSourceScope.AnySource,
                secondSource,
                targetId: "entity.other-target")),
            "target participates in status identity");
        True(
            !anyFirst.Matches(CreateIdentity(
                StatusSourceScope.AnySource,
                secondSource,
                statusDefinitionId: "status.venom")),
            "status definition participates in status identity");
        True(
            !anyFirst.Matches(CreateIdentity(
                StatusSourceScope.AnySource,
                secondSource,
                stackingGroupId: "stack-group.other")),
            "stacking group participates in status identity");
        True(
            !anyFirst.Matches(definitionFirst),
            "source scope itself participates in status identity");
    }

    private void VerifyReapplicationTruthTable()
    {
        var identity = CreateIdentity(
            StatusSourceScope.SourceDefinition,
            SkillSource("skill.poison", "command.cast-a"));
        var existing = CreateInstance(
            "status-instance.poison.existing",
            identity,
            stackCount: 2,
            expiresAtTick: 110);

        var created = ReferenceStatusReapplicationPolicy.Evaluate(
            CreateRequest(
                "status-instance.poison.created",
                identity,
                stackDelta: 2,
                maxStacks: 5,
                StatusStackBehavior.RefreshOnly,
                StatusDurationBehavior.RefreshFromCurrentTick),
            Array.Empty<StatusPolicyInstance>());
        Equal(
            StatusReapplyOutcome.Created,
            created.Outcome,
            "no identity match creates a status");
        Equal(
            2,
            created.ResultingInstance!.StackCount,
            "creation applies the requested initial stacks");
        Equal(
            120L,
            created.ResultingInstance.ExpiresAtTick,
            "creation starts duration at the current tick");
        True(!created.StackCapReached, "creation below the stack cap is not capped");
        var createdAtCap = ReferenceStatusReapplicationPolicy.Evaluate(
            CreateRequest(
                "status-instance.poison.created-at-cap",
                identity,
                stackDelta: 7,
                maxStacks: 5,
                StatusStackBehavior.AddStacksCapped,
                StatusDurationBehavior.RefreshFromCurrentTick),
            Array.Empty<StatusPolicyInstance>());
        Equal(
            5,
            createdAtCap.ResultingInstance!.StackCount,
            "first application is also clamped to MaxStacks");
        Equal(5, createdAtCap.StacksAdded, "creation reports committed initial stacks");
        True(createdAtCap.StackCapReached, "clamped first application reports its cap");

        var refreshed = ReferenceStatusReapplicationPolicy.Evaluate(
            CreateRequest(
                "status-instance.poison.refresh-command",
                CreateIdentity(
                    StatusSourceScope.SourceDefinition,
                    SkillSource("skill.poison", "command.cast-b")),
                stackDelta: 4,
                maxStacks: 5,
                StatusStackBehavior.RefreshOnly,
                StatusDurationBehavior.RefreshFromCurrentTick),
            new[] { existing });
        Equal(
            StatusReapplyOutcome.Refreshed,
            refreshed.Outcome,
            "RefreshOnly refreshes the matching instance");
        Equal(
            existing.InstanceId,
            refreshed.ResultingInstance!.InstanceId,
            "RefreshOnly preserves the status instance ID");
        Equal(
            2,
            refreshed.ResultingInstance.StackCount,
            "RefreshOnly preserves stack count");
        Equal(
            120L,
            refreshed.ResultingInstance.ExpiresAtTick,
            "RefreshOnly delegates expiry to the duration policy");
        Equal(0, refreshed.StacksAdded, "RefreshOnly adds no stacks");
        True(
            ReferenceEquals(existing.Identity, refreshed.ResultingInstance.Identity),
            "merge preserves the existing source identity");

        var nearlyCapped = CreateInstance(
            "status-instance.poison.nearly-capped",
            identity,
            stackCount: 4,
            expiresAtTick: 150);
        var capped = ReferenceStatusReapplicationPolicy.Evaluate(
            CreateRequest(
                "status-instance.poison.cap-command",
                identity,
                stackDelta: int.MaxValue,
                maxStacks: 5,
                StatusStackBehavior.AddStacksCapped,
                StatusDurationBehavior.KeepLongerExpiry),
            new[] { nearlyCapped });
        Equal(
            StatusReapplyOutcome.StacksAdded,
            capped.Outcome,
            "AddStacksCapped returns an explicit merge outcome");
        Equal(
            5,
            capped.ResultingInstance!.StackCount,
            "AddStacksCapped clamps to MaxStacks");
        Equal(1, capped.StacksAdded, "actual added stacks exclude the clamped excess");
        True(capped.StackCapReached, "clamped stack input is observable");
        Equal(
            150L,
            capped.ResultingInstance.ExpiresAtTick,
            "KeepLongerExpiry preserves the later existing expiry");
        var alreadyAtCap = CreateInstance(
            "status-instance.poison.at-cap",
            identity,
            stackCount: 5,
            expiresAtTick: 150);
        var cappedWithoutGrowth = ReferenceStatusReapplicationPolicy.Evaluate(
            CreateRequest(
                "status-instance.poison.at-cap-command",
                identity,
                stackDelta: 1,
                maxStacks: 5,
                StatusStackBehavior.AddStacksCapped,
                StatusDurationBehavior.KeepLongerExpiry),
            new[] { alreadyAtCap });
        Equal(
            5,
            cappedWithoutGrowth.ResultingInstance!.StackCount,
            "a stack already at cap remains at cap");
        Equal(0, cappedWithoutGrowth.StacksAdded, "cap can produce zero actual growth");
        True(cappedWithoutGrowth.StackCapReached, "zero-growth cap remains explicit");

        var extended = ReferenceStatusReapplicationPolicy.Evaluate(
            CreateRequest(
                "status-instance.poison.extend-command",
                identity,
                stackDelta: 2,
                maxStacks: 5,
                StatusStackBehavior.AddStacksCapped,
                StatusDurationBehavior.ExtendCurrentExpiry),
            new[] { existing });
        Equal(
            4,
            extended.ResultingInstance!.StackCount,
            "uncapped stack addition applies the full delta");
        Equal(2, extended.StacksAdded, "uncapped merge reports the full delta");
        True(!extended.StackCapReached, "uncapped merge stays distinguishable");
        Equal(
            130L,
            extended.ResultingInstance.ExpiresAtTick,
            "ExtendCurrentExpiry adds duration to the previous expiry");

        var longLived = CreateInstance(
            "status-instance.poison.replaced",
            identity,
            stackCount: 4,
            expiresAtTick: 500);
        var replacementIdentity = CreateIdentity(
            StatusSourceScope.SourceDefinition,
            SkillSource("skill.poison", "command.cast-b"));
        var replaced = ReferenceStatusReapplicationPolicy.Evaluate(
            CreateRequest(
                "status-instance.poison.replacement",
                replacementIdentity,
                stackDelta: 3,
                maxStacks: 5,
                StatusStackBehavior.Replace,
                StatusDurationBehavior.KeepLongerExpiry),
            new[] { longLived });
        Equal(
            StatusReapplyOutcome.Replaced,
            replaced.Outcome,
            "Replace reports that the old instance must be removed");
        Equal<EntityId?>(
            longLived.InstanceId,
            replaced.RemovedInstanceId,
            "Replace identifies the old instance");
        Equal(
            new EntityId("status-instance.poison.replacement"),
            replaced.ResultingInstance!.InstanceId,
            "Replace uses the incoming instance ID");
        Equal(3, replaced.ResultingInstance.StackCount, "Replace starts fresh stacks");
        Equal(
            120L,
            replaced.ResultingInstance.ExpiresAtTick,
            "Replace starts a fresh duration instead of merging old expiry");
        True(
            ReferenceEquals(replacementIdentity, replaced.ResultingInstance.Identity),
            "Replace adopts the incoming source identity");

        var independent = ReferenceStatusReapplicationPolicy.Evaluate(
            CreateRequest(
                "status-instance.poison.independent",
                identity,
                stackDelta: 1,
                maxStacks: 3,
                StatusStackBehavior.Independent,
                StatusDurationBehavior.ExtendCurrentExpiry),
            new[] { existing });
        Equal(
            StatusReapplyOutcome.IndependentCreated,
            independent.Outcome,
            "Independent always creates another instance");
        Equal<EntityId?>(
            null,
            independent.RemovedInstanceId,
            "Independent does not remove a matching instance");
        Equal(
            120L,
            independent.ResultingInstance!.ExpiresAtTick,
            "Independent starts a fresh duration");

        var differentGroup = CreateIdentity(
            StatusSourceScope.SourceDefinition,
            SkillSource("skill.poison", "command.cast-a"),
            stackingGroupId: "stack-group.poison-variant");
        var noIdentityMatch = ReferenceStatusReapplicationPolicy.Evaluate(
            CreateRequest(
                "status-instance.poison.other-group",
                differentGroup,
                stackDelta: 1,
                maxStacks: 5,
                StatusStackBehavior.AddStacksCapped,
                StatusDurationBehavior.RefreshFromCurrentTick),
            new[] { existing });
        Equal(
            StatusReapplyOutcome.Created,
            noIdentityMatch.Outcome,
            "a different stacking group creates instead of merging");
    }

    private void VerifyDurationTruthTableAndOverflow()
    {
        Equal(
            120L,
            ReferenceStatusDurationPolicy.CalculateInitialExpiry(100, 20),
            "initial expiry is current tick plus duration");
        Equal(
            120L,
            ReferenceStatusDurationPolicy.CalculateReappliedExpiry(
                100,
                20,
                110,
                StatusDurationBehavior.RefreshFromCurrentTick),
            "refresh ignores remaining duration");
        Equal(
            130L,
            ReferenceStatusDurationPolicy.CalculateReappliedExpiry(
                100,
                20,
                110,
                StatusDurationBehavior.ExtendCurrentExpiry),
            "extend adds to the current expiry");
        Equal(
            150L,
            ReferenceStatusDurationPolicy.CalculateReappliedExpiry(
                100,
                20,
                150,
                StatusDurationBehavior.KeepLongerExpiry),
            "keep-longer keeps a later existing expiry");
        Equal(
            120L,
            ReferenceStatusDurationPolicy.CalculateReappliedExpiry(
                100,
                20,
                105,
                StatusDurationBehavior.KeepLongerExpiry),
            "keep-longer accepts a later refreshed expiry");
        Equal(
            1L,
            ReferenceStatusDurationPolicy.CalculateInitialExpiry(0, 1),
            "one tick is the smallest persistent duration");
        Equal(
            1L,
            ReferenceStatusDurationPolicy.ScaleByResistance(
                baseDurationTicks: 1,
                resistanceBps: 5_000),
            "resistance never turns a persistent status into zero ticks");
        Equal(
            2L,
            ReferenceStatusDurationPolicy.ScaleByResistance(
                baseDurationTicks: 3,
                resistanceBps: 5_000),
            "duration midpoint rounds away from zero");
        Equal(
            10L,
            ReferenceStatusDurationPolicy.ScaleByResistance(
                baseDurationTicks: 10,
                resistanceBps: 0),
            "zero resistance preserves duration");
        Equal(
            1L,
            ReferenceStatusDurationPolicy.ScaleByResistance(
                baseDurationTicks: 10,
                resistanceBps: 9_000),
            "maximum resistance leaves the documented ten percent duration");
        Equal(
            long.MaxValue,
            ReferenceStatusDurationPolicy.ScaleByResistance(
                baseDurationTicks: long.MaxValue,
                resistanceBps: 0),
            "checked conversion supports the maximum valid unscaled duration");

        Throws<ArgumentOutOfRangeException>(
            () => ReferenceStatusDurationPolicy.CalculateReappliedExpiry(
                100,
                20,
                100,
                StatusDurationBehavior.RefreshFromCurrentTick),
            "an expired instance cannot be reapplied as active");
        Throws<OverflowException>(
            () => ReferenceStatusDurationPolicy.CalculateInitialExpiry(
                long.MaxValue,
                1),
            "initial expiry overflow fails explicitly");
        Throws<OverflowException>(
            () => ReferenceStatusDurationPolicy.CalculateReappliedExpiry(
                1,
                1,
                long.MaxValue,
                StatusDurationBehavior.ExtendCurrentExpiry),
            "extension overflow fails explicitly");
        Throws<OverflowException>(
            () => ReferenceStatusDurationPolicy.CalculateReappliedExpiry(
                long.MaxValue - 1,
                2,
                long.MaxValue,
                StatusDurationBehavior.KeepLongerExpiry),
            "keep-longer does not hide refreshed-expiry overflow");
        Throws<ArgumentOutOfRangeException>(
            () => ReferenceStatusDurationPolicy.ScaleByResistance(
                baseDurationTicks: 0,
                resistanceBps: 0),
            "duration resistance rejects a zero base duration");
        Throws<ArgumentOutOfRangeException>(
            () => ReferenceStatusDurationPolicy.ScaleByResistance(
                baseDurationTicks: 10,
                resistanceBps: -1),
            "duration resistance rejects a negative basis-point value");
        Throws<ArgumentOutOfRangeException>(
            () => ReferenceStatusDurationPolicy.ScaleByResistance(
                baseDurationTicks: 10,
                resistanceBps: 9_001),
            "duration resistance rejects a value above the documented cap");
    }

    private void VerifyImmunityOutcome()
    {
        var identity = CreateIdentity(
            StatusSourceScope.AnySource,
            SkillSource("skill.freeze", "command.freeze-a"),
            statusDefinitionId: "status.freeze",
            stackingGroupId: "stack-group.freeze");
        var immune = ReferenceStatusReapplicationPolicy.Evaluate(
            CreateRequest(
                "status-instance.freeze.blocked",
                identity,
                stackDelta: 1,
                maxStacks: 1,
                StatusStackBehavior.RefreshOnly,
                StatusDurationBehavior.RefreshFromCurrentTick,
                statusTags: new[] { "status", "debuff", "cc", "ice" },
                blockedStatusTags: new[] { "fire", "cc" }),
            Array.Empty<StatusPolicyInstance>());
        Equal(
            StatusReapplyOutcome.Immune,
            immune.Outcome,
            "a blocked canonical status tag returns Immune");
        Equal("cc", immune.MatchedImmunityTag, "Immune records the first canonical match");
        Equal<StatusPolicyInstance?>(
            null,
            immune.ResultingInstance,
            "Immune creates no instance");
        Equal<EntityId?>(
            null,
            immune.RemovedInstanceId,
            "Immune removes no instance");
        Equal(0, immune.StacksAdded, "Immune changes no stacks");

        var allowed = ReferenceStatusReapplicationPolicy.Evaluate(
            CreateRequest(
                "status-instance.freeze.allowed",
                identity,
                stackDelta: 1,
                maxStacks: 1,
                StatusStackBehavior.RefreshOnly,
                StatusDurationBehavior.RefreshFromCurrentTick,
                statusTags: new[] { "status", "debuff", "cc", "ice" },
                blockedStatusTags: new[] { "fire" }),
            Array.Empty<StatusPolicyInstance>());
        Equal(
            StatusReapplyOutcome.Created,
            allowed.Outcome,
            "non-overlapping immunity tags permit application");
        Equal<string?>(
            null,
            allowed.MatchedImmunityTag,
            "allowed application carries no immunity reason");
    }

    private void VerifyCleanseFiltersAndGlobalOrdering()
    {
        var alpha = CleanseCandidate(
            "status-instance.cleanse.alpha",
            priority: 10,
            "debuff",
            "fire");
        var beta = CleanseCandidate(
            "status-instance.cleanse.beta",
            priority: 20,
            "debuff",
            "poison");
        var epsilon = CleanseCandidate(
            "status-instance.cleanse.epsilon",
            priority: 20,
            "debuff",
            "fire");
        var gamma = CleanseCandidate(
            "status-instance.cleanse.gamma",
            priority: 20,
            "debuff",
            "fire",
            "protected");
        var delta = CleanseCandidate(
            "status-instance.cleanse.delta",
            priority: 30,
            "buff",
            "fire");
        var targetedRequest = new StatusCleanseRequest(
            requiredAnyTags: new TagSet(new[] { "poison", "fire" }),
            requiredAllTags: new TagSet(new[] { "debuff" }),
            excludedTags: new TagSet(new[] { "protected" }),
            maxRemovals: 2);

        var firstOrder = ReferenceStatusCleansePolicy.Select(
            targetedRequest,
            new[] { alpha, delta, epsilon, gamma, beta });
        Equal(
            StatusCleanseOutcome.Selected,
            firstOrder.Outcome,
            "matching cleanse candidates return Selected");
        Equal(3, firstOrder.EligibleCount, "filters run before MaxRemovals");
        SequenceEqual(
            new[]
            {
                beta.InstanceId,
                epsilon.InstanceId
            },
            firstOrder.SelectedInstanceIds,
            "priority descending then instance ID ascending is the total order");

        var permuted = ReferenceStatusCleansePolicy.Select(
            targetedRequest,
            new[] { gamma, beta, alpha, delta, epsilon });
        SequenceEqual(
            firstOrder.SelectedInstanceIds,
            permuted.SelectedInstanceIds,
            "cleanse selection is independent of repository enumeration order");

        var universal = ReferenceStatusCleansePolicy.Select(
            new StatusCleanseRequest(
                TagSet.Empty,
                TagSet.Empty,
                TagSet.Empty,
                maxRemovals: 1),
            new[] { alpha, beta, epsilon, gamma, delta });
        Equal(5, universal.EligibleCount, "empty filters explicitly match all candidates");
        SequenceEqual(
            new[] { delta.InstanceId },
            universal.SelectedInstanceIds,
            "MaxRemovals applies after the globally highest priority is found");

        var noMatch = ReferenceStatusCleansePolicy.Select(
            new StatusCleanseRequest(
                requiredAnyTags: new TagSet(new[] { "cc" }),
                requiredAllTags: TagSet.Empty,
                excludedTags: TagSet.Empty,
                maxRemovals: 3),
            new[] { alpha, beta, epsilon, gamma, delta });
        Equal(
            StatusCleanseOutcome.NoMatch,
            noMatch.Outcome,
            "a valid cleanse with no eligible instance is explicit");
        Equal(0, noMatch.EligibleCount, "NoMatch has zero eligible candidates");
        Equal(
            0,
            noMatch.SelectedInstanceIds.Count,
            "NoMatch selects no instance");
    }

    private void VerifyBoundaryFailures()
    {
        var source = SkillSource("skill.poison", "command.boundary");
        var identity = CreateIdentity(
            StatusSourceScope.SourceInstance,
            source);
        var validRequest = CreateRequest(
            "status-instance.poison.boundary-new",
            identity,
            stackDelta: 1,
            maxStacks: 3,
            StatusStackBehavior.RefreshOnly,
            StatusDurationBehavior.RefreshFromCurrentTick);

        Throws<ArgumentOutOfRangeException>(
            () => _ = CreateIdentity(
                (StatusSourceScope)int.MaxValue,
                source),
            "undefined source scope is rejected");
        Throws<ArgumentException>(
            () => _ = CreateIdentity(
                StatusSourceScope.SourceInstance,
                SourceRef.System(new EntityId("system.status-policy"))),
            "SourceInstance scope requires an actual source instance");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new StatusPolicyInstance(
                new EntityId("status-instance.invalid-stack"),
                identity,
                stackCount: 0,
                expiresAtTick: 1),
            "status instance rejects zero stacks");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new StatusPolicyInstance(
                new EntityId("status-instance.invalid-expiry"),
                identity,
                stackCount: 1,
                expiresAtTick: -1),
            "status instance rejects a negative expiry");
        Throws<ArgumentOutOfRangeException>(
            () => _ = CreateRequest(
                "status-instance.invalid-duration",
                identity,
                stackDelta: 1,
                maxStacks: 3,
                StatusStackBehavior.RefreshOnly,
                StatusDurationBehavior.RefreshFromCurrentTick,
                durationTicks: 0),
            "reapply request rejects zero duration");
        Throws<ArgumentOutOfRangeException>(
            () => _ = CreateRequest(
                "status-instance.invalid-delta",
                identity,
                stackDelta: 0,
                maxStacks: 3,
                StatusStackBehavior.RefreshOnly,
                StatusDurationBehavior.RefreshFromCurrentTick),
            "reapply request rejects zero stack delta");
        Throws<ArgumentOutOfRangeException>(
            () => _ = CreateRequest(
                "status-instance.invalid-max-stack",
                identity,
                stackDelta: 1,
                maxStacks: 0,
                StatusStackBehavior.RefreshOnly,
                StatusDurationBehavior.RefreshFromCurrentTick),
            "reapply request rejects zero max stacks");
        Throws<ArgumentOutOfRangeException>(
            () => _ = CreateRequest(
                "status-instance.invalid-stack-policy",
                identity,
                stackDelta: 1,
                maxStacks: 3,
                (StatusStackBehavior)int.MaxValue,
                StatusDurationBehavior.RefreshFromCurrentTick),
            "reapply request rejects an undefined stack behavior");
        Throws<ArgumentOutOfRangeException>(
            () => _ = CreateRequest(
                "status-instance.invalid-duration-policy",
                identity,
                stackDelta: 1,
                maxStacks: 3,
                StatusStackBehavior.RefreshOnly,
                (StatusDurationBehavior)int.MaxValue),
            "reapply request rejects an undefined duration behavior");
        Throws<ArgumentNullException>(
            () => ReferenceStatusReapplicationPolicy.Evaluate(
                null!,
                Array.Empty<StatusPolicyInstance>()),
            "reapplication rejects a null request");
        Throws<ArgumentNullException>(
            () => ReferenceStatusReapplicationPolicy.Evaluate(
                validRequest,
                null!),
            "reapplication rejects a null active snapshot");
        Throws<ArgumentException>(
            () => ReferenceStatusReapplicationPolicy.Evaluate(
                validRequest,
                new StatusPolicyInstance[] { null! }),
            "reapplication rejects a null active instance");

        var active = CreateInstance(
            "status-instance.poison.active",
            identity,
            stackCount: 1,
            expiresAtTick: 110);
        var duplicateId = CreateInstance(
            active.InstanceId.Value,
            CreateIdentity(
                StatusSourceScope.SourceInstance,
                SkillSource("skill.other", "command.other")),
            stackCount: 1,
            expiresAtTick: 110);
        Throws<ArgumentException>(
            () => ReferenceStatusReapplicationPolicy.Evaluate(
                validRequest,
                new[] { active, duplicateId }),
            "active instance IDs must be unique");

        var incomingIdCollision = CreateRequest(
            active.InstanceId.Value,
            identity,
            stackDelta: 1,
            maxStacks: 3,
            StatusStackBehavior.RefreshOnly,
            StatusDurationBehavior.RefreshFromCurrentTick);
        Throws<ArgumentException>(
            () => ReferenceStatusReapplicationPolicy.Evaluate(
                incomingIdCollision,
                new[] { active }),
            "incoming instance ID cannot collide with active state");

        var expired = CreateInstance(
            "status-instance.poison.expired",
            identity,
            stackCount: 1,
            expiresAtTick: 100);
        Throws<ArgumentException>(
            () => ReferenceStatusReapplicationPolicy.Evaluate(
                validRequest,
                new[] { expired }),
            "active snapshot cannot contain an expired instance");

        var secondMatch = CreateInstance(
            "status-instance.poison.second-match",
            identity,
            stackCount: 1,
            expiresAtTick: 120);
        Throws<InvalidOperationException>(
            () => ReferenceStatusReapplicationPolicy.Evaluate(
                validRequest,
                new[] { active, secondMatch }),
            "non-independent identity cannot match two active instances");

        var overDefinitionCap = CreateInstance(
            "status-instance.poison.over-definition-cap",
            identity,
            stackCount: 4,
            expiresAtTick: 110);
        Throws<InvalidOperationException>(
            () => ReferenceStatusReapplicationPolicy.Evaluate(
                validRequest,
                new[] { overDefinitionCap }),
            "active stack count cannot exceed the supplied definition cap");

        Throws<ArgumentOutOfRangeException>(
            () => _ = new StatusCleanseRequest(
                TagSet.Empty,
                TagSet.Empty,
                TagSet.Empty,
                maxRemovals: 0),
            "cleanse requires a positive removal cap");
        var cleanseRequest = new StatusCleanseRequest(
            TagSet.Empty,
            TagSet.Empty,
            TagSet.Empty,
            maxRemovals: 1);
        Throws<ArgumentNullException>(
            () => ReferenceStatusCleansePolicy.Select(null!, Array.Empty<StatusCleanseCandidate>()),
            "cleanse rejects a null request");
        Throws<ArgumentNullException>(
            () => ReferenceStatusCleansePolicy.Select(cleanseRequest, null!),
            "cleanse rejects a null candidate snapshot");
        Throws<ArgumentException>(
            () => ReferenceStatusCleansePolicy.Select(
                cleanseRequest,
                new StatusCleanseCandidate[] { null! }),
            "cleanse rejects a null candidate");
        var cleanseCandidate = CleanseCandidate(
            "status-instance.cleanse.duplicate",
            priority: 1,
            "debuff");
        Throws<ArgumentException>(
            () => ReferenceStatusCleansePolicy.Select(
                cleanseRequest,
                new[] { cleanseCandidate, cleanseCandidate }),
            "cleanse candidate IDs must be unique");
    }

    private static StatusIdentity CreateIdentity(
        StatusSourceScope sourceScope,
        SourceRef source,
        string targetId = "entity.target",
        string statusDefinitionId = "status.poison",
        string stackingGroupId = "stack-group.poison") =>
        new(
            new EntityId(targetId),
            new EntityId(statusDefinitionId),
            new EntityId(stackingGroupId),
            sourceScope,
            source);

    private static SourceRef SkillSource(
        string definitionId,
        string commandId) =>
        SourceRef.SkillExecution(
            new EntityId(definitionId),
            new EntityId(commandId));

    private static StatusPolicyInstance CreateInstance(
        string instanceId,
        StatusIdentity identity,
        int stackCount,
        long expiresAtTick) =>
        new(
            new EntityId(instanceId),
            identity,
            stackCount,
            expiresAtTick);

    private static StatusReapplyRequest CreateRequest(
        string incomingInstanceId,
        StatusIdentity identity,
        int stackDelta,
        int maxStacks,
        StatusStackBehavior stackBehavior,
        StatusDurationBehavior durationBehavior,
        long currentTick = 100,
        long durationTicks = 20,
        IEnumerable<string>? statusTags = null,
        IEnumerable<string>? blockedStatusTags = null) =>
        new(
            new EntityId(incomingInstanceId),
            identity,
            new TagSet(statusTags ?? new[] { "status", "debuff", "poison" }),
            new TagSet(blockedStatusTags ?? Array.Empty<string>()),
            currentTick,
            durationTicks,
            stackDelta,
            maxStacks,
            stackBehavior,
            durationBehavior);

    private static StatusCleanseCandidate CleanseCandidate(
        string instanceId,
        int priority,
        params string[] tags) =>
        new(
            new EntityId(instanceId),
            new TagSet(tags),
            priority);

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
