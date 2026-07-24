using GameSystemKnowledge.Reference.Contracts;

namespace GameSystemKnowledge.Reference.Systems;

public enum StatusSourceScope
{
    AnySource,
    SourceDefinition,
    SourceInstance
}

public enum StatusStackBehavior
{
    RefreshOnly,
    AddStacksCapped,
    Replace,
    Independent
}

public enum StatusDurationBehavior
{
    RefreshFromCurrentTick,
    ExtendCurrentExpiry,
    KeepLongerExpiry
}

public enum StatusReapplyOutcome
{
    Created,
    Refreshed,
    StacksAdded,
    Replaced,
    IndependentCreated,
    Immune
}

public sealed class StatusIdentity
{
    public StatusIdentity(
        EntityId targetId,
        EntityId statusDefinitionId,
        EntityId stackingGroupId,
        StatusSourceScope sourceScope,
        SourceRef source)
    {
        EntityId.ThrowIfInvalid(targetId, nameof(targetId));
        EntityId.ThrowIfInvalid(statusDefinitionId, nameof(statusDefinitionId));
        EntityId.ThrowIfInvalid(stackingGroupId, nameof(stackingGroupId));
        SourceRef.ThrowIfInvalid(source, nameof(source));

        if (!Enum.IsDefined(sourceScope))
        {
            throw new ArgumentOutOfRangeException(nameof(sourceScope));
        }

        if (sourceScope == StatusSourceScope.SourceInstance &&
            source.InstanceId is null)
        {
            throw new ArgumentException(
                "SourceInstance scope requires a source instance ID.",
                nameof(source));
        }

        TargetId = targetId;
        StatusDefinitionId = statusDefinitionId;
        StackingGroupId = stackingGroupId;
        SourceScope = sourceScope;
        Source = source;
    }

    public EntityId TargetId { get; }

    public EntityId StatusDefinitionId { get; }

    public EntityId StackingGroupId { get; }

    public StatusSourceScope SourceScope { get; }

    public SourceRef Source { get; }

    public bool Matches(StatusIdentity other)
    {
        ArgumentNullException.ThrowIfNull(other);

        if (TargetId != other.TargetId ||
            StatusDefinitionId != other.StatusDefinitionId ||
            StackingGroupId != other.StackingGroupId ||
            SourceScope != other.SourceScope)
        {
            return false;
        }

        // 소스 범위가 넓을수록 변동 가능한 실행 인스턴스 정보는 동일성에서 제외한다.
        return SourceScope switch
        {
            StatusSourceScope.AnySource => true,
            StatusSourceScope.SourceDefinition =>
                Source.Kind == other.Source.Kind &&
                Source.DefinitionId == other.Source.DefinitionId,
            StatusSourceScope.SourceInstance => Source == other.Source,
            _ => throw new InvalidOperationException(
                $"Unsupported source scope '{SourceScope}'.")
        };
    }
}

public sealed class StatusPolicyInstance
{
    public StatusPolicyInstance(
        EntityId instanceId,
        StatusIdentity identity,
        int stackCount,
        long expiresAtTick)
    {
        EntityId.ThrowIfInvalid(instanceId, nameof(instanceId));
        ArgumentNullException.ThrowIfNull(identity);

        if (stackCount <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(stackCount));
        }

        if (expiresAtTick < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(expiresAtTick));
        }

        InstanceId = instanceId;
        Identity = identity;
        StackCount = stackCount;
        ExpiresAtTick = expiresAtTick;
    }

    public EntityId InstanceId { get; }

    public StatusIdentity Identity { get; }

    public int StackCount { get; }

    public long ExpiresAtTick { get; }
}

public sealed class StatusReapplyRequest
{
    public StatusReapplyRequest(
        EntityId incomingInstanceId,
        StatusIdentity identity,
        TagSet statusTags,
        TagSet blockedStatusTags,
        long currentTick,
        long durationTicks,
        int stackDelta,
        int maxStacks,
        StatusStackBehavior stackBehavior,
        StatusDurationBehavior durationBehavior)
    {
        EntityId.ThrowIfInvalid(incomingInstanceId, nameof(incomingInstanceId));
        ArgumentNullException.ThrowIfNull(identity);
        ArgumentNullException.ThrowIfNull(statusTags);
        ArgumentNullException.ThrowIfNull(blockedStatusTags);

        if (currentTick < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(currentTick));
        }

        if (durationTicks <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(durationTicks));
        }

        if (stackDelta <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(stackDelta));
        }

        if (maxStacks <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maxStacks));
        }

        if (!Enum.IsDefined(stackBehavior))
        {
            throw new ArgumentOutOfRangeException(nameof(stackBehavior));
        }

        if (!Enum.IsDefined(durationBehavior))
        {
            throw new ArgumentOutOfRangeException(nameof(durationBehavior));
        }

        IncomingInstanceId = incomingInstanceId;
        Identity = identity;
        StatusTags = statusTags;
        BlockedStatusTags = blockedStatusTags;
        CurrentTick = currentTick;
        DurationTicks = durationTicks;
        StackDelta = stackDelta;
        MaxStacks = maxStacks;
        StackBehavior = stackBehavior;
        DurationBehavior = durationBehavior;
    }

    public EntityId IncomingInstanceId { get; }

    public StatusIdentity Identity { get; }

    public TagSet StatusTags { get; }

    public TagSet BlockedStatusTags { get; }

    public long CurrentTick { get; }

    public long DurationTicks { get; }

    public int StackDelta { get; }

    public int MaxStacks { get; }

    public StatusStackBehavior StackBehavior { get; }

    public StatusDurationBehavior DurationBehavior { get; }
}

public sealed class StatusReapplyDecision
{
    private StatusReapplyDecision(
        StatusReapplyOutcome outcome,
        StatusPolicyInstance? resultingInstance,
        EntityId? removedInstanceId,
        int stacksAdded,
        bool stackCapReached,
        string? matchedImmunityTag)
    {
        Outcome = outcome;
        ResultingInstance = resultingInstance;
        RemovedInstanceId = removedInstanceId;
        StacksAdded = stacksAdded;
        StackCapReached = stackCapReached;
        MatchedImmunityTag = matchedImmunityTag;
    }

    public StatusReapplyOutcome Outcome { get; }

    public StatusPolicyInstance? ResultingInstance { get; }

    public EntityId? RemovedInstanceId { get; }

    public int StacksAdded { get; }

    public bool StackCapReached { get; }

    public string? MatchedImmunityTag { get; }

    internal static StatusReapplyDecision Applied(
        StatusReapplyOutcome outcome,
        StatusPolicyInstance resultingInstance,
        EntityId? removedInstanceId,
        int stacksAdded,
        bool stackCapReached)
    {
        ArgumentNullException.ThrowIfNull(resultingInstance);

        if (outcome == StatusReapplyOutcome.Immune)
        {
            throw new ArgumentException(
                "An applied decision cannot use the Immune outcome.",
                nameof(outcome));
        }

        return new(
            outcome,
            resultingInstance,
            removedInstanceId,
            stacksAdded,
            stackCapReached,
            null);
    }

    internal static StatusReapplyDecision Immune(string matchedImmunityTag)
    {
        if (string.IsNullOrWhiteSpace(matchedImmunityTag))
        {
            throw new ArgumentException(
                "An immune decision requires the matched canonical tag.",
                nameof(matchedImmunityTag));
        }

        return new(
            StatusReapplyOutcome.Immune,
            null,
            null,
            0,
            false,
            matchedImmunityTag);
    }
}

public static class ReferenceStatusDurationPolicy
{
    public const int BasisPoints = 10_000;

    public const int MaximumResistanceBps = 9_000;

    public static long ScaleByResistance(
        long baseDurationTicks,
        int resistanceBps)
    {
        if (baseDurationTicks <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(baseDurationTicks));
        }

        if (resistanceBps is < 0 or > MaximumResistanceBps)
        {
            throw new ArgumentOutOfRangeException(nameof(resistanceBps));
        }

        // 소수 tick을 끝까지 decimal로 유지하고 commit 직전에 한 번만 반올림한다.
        var scaledDuration =
            (decimal)baseDurationTicks *
            (BasisPoints - resistanceBps) /
            BasisPoints;
        var roundedDuration = decimal.Round(
            scaledDuration,
            decimals: 0,
            MidpointRounding.AwayFromZero);
        var committedTicks = checked(decimal.ToInt64(roundedDuration));
        return Math.Max(1, committedTicks);
    }

    public static long CalculateInitialExpiry(
        long currentTick,
        long durationTicks)
    {
        ValidateTicks(currentTick, durationTicks);
        return checked(currentTick + durationTicks);
    }

    public static long CalculateReappliedExpiry(
        long currentTick,
        long durationTicks,
        long existingExpiresAtTick,
        StatusDurationBehavior behavior)
    {
        ValidateTicks(currentTick, durationTicks);

        if (existingExpiresAtTick <= currentTick)
        {
            throw new ArgumentOutOfRangeException(
                nameof(existingExpiresAtTick),
                "Reapplication requires an active, unexpired instance.");
        }

        if (!Enum.IsDefined(behavior))
        {
            throw new ArgumentOutOfRangeException(nameof(behavior));
        }

        // 모든 후보 만료 시각을 checked 문맥에서 먼저 계산해 오버플로를 숨기지 않는다.
        var refreshedExpiry = checked(currentTick + durationTicks);
        return behavior switch
        {
            StatusDurationBehavior.RefreshFromCurrentTick => refreshedExpiry,
            StatusDurationBehavior.ExtendCurrentExpiry =>
                checked(existingExpiresAtTick + durationTicks),
            StatusDurationBehavior.KeepLongerExpiry =>
                Math.Max(existingExpiresAtTick, refreshedExpiry),
            _ => throw new InvalidOperationException(
                $"Unsupported duration behavior '{behavior}'.")
        };
    }

    private static void ValidateTicks(long currentTick, long durationTicks)
    {
        if (currentTick < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(currentTick));
        }

        if (durationTicks <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(durationTicks));
        }
    }
}

public static class ReferenceStatusReapplicationPolicy
{
    public static StatusReapplyDecision Evaluate(
        StatusReapplyRequest request,
        IReadOnlyList<StatusPolicyInstance> activeInstances)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(activeInstances);
        ValidateActiveInstances(request, activeInstances);

        var matchedImmunityTag = FindFirstSharedTag(
            request.StatusTags,
            request.BlockedStatusTags);
        if (matchedImmunityTag is not null)
        {
            return StatusReapplyDecision.Immune(matchedImmunityTag);
        }

        if (request.StackBehavior == StatusStackBehavior.Independent)
        {
            return CreateNew(
                request,
                StatusReapplyOutcome.IndependentCreated,
                removedInstanceId: null);
        }

        StatusPolicyInstance? matchingInstance = null;
        for (var index = 0; index < activeInstances.Count; index++)
        {
            var candidate = activeInstances[index];
            if (!candidate.Identity.Matches(request.Identity))
            {
                continue;
            }

            if (matchingInstance is not null)
            {
                throw new InvalidOperationException(
                    "A non-independent status identity matched more than one active instance.");
            }

            matchingInstance = candidate;
        }

        if (matchingInstance is null)
        {
            return CreateNew(
                request,
                StatusReapplyOutcome.Created,
                removedInstanceId: null);
        }

        if (matchingInstance.StackCount > request.MaxStacks)
        {
            throw new InvalidOperationException(
                "The active stack count exceeds the definition's maximum.");
        }

        return request.StackBehavior switch
        {
            StatusStackBehavior.RefreshOnly =>
                Refresh(request, matchingInstance),
            StatusStackBehavior.AddStacksCapped =>
                AddStacks(request, matchingInstance),
            StatusStackBehavior.Replace =>
                CreateNew(
                    request,
                    StatusReapplyOutcome.Replaced,
                    matchingInstance.InstanceId),
            _ => throw new InvalidOperationException(
                $"Unsupported stack behavior '{request.StackBehavior}'.")
        };
    }

    private static StatusReapplyDecision Refresh(
        StatusReapplyRequest request,
        StatusPolicyInstance existing)
    {
        var expiry = ReferenceStatusDurationPolicy.CalculateReappliedExpiry(
            request.CurrentTick,
            request.DurationTicks,
            existing.ExpiresAtTick,
            request.DurationBehavior);
        var result = new StatusPolicyInstance(
            existing.InstanceId,
            existing.Identity,
            existing.StackCount,
            expiry);

        return StatusReapplyDecision.Applied(
            StatusReapplyOutcome.Refreshed,
            result,
            removedInstanceId: null,
            stacksAdded: 0,
            stackCapReached: false);
    }

    private static StatusReapplyDecision AddStacks(
        StatusReapplyRequest request,
        StatusPolicyInstance existing)
    {
        var requestedStackCount =
            (long)existing.StackCount + request.StackDelta;
        var resultingStackCount = (int)Math.Min(
            requestedStackCount,
            request.MaxStacks);
        var expiry = ReferenceStatusDurationPolicy.CalculateReappliedExpiry(
            request.CurrentTick,
            request.DurationTicks,
            existing.ExpiresAtTick,
            request.DurationBehavior);
        var result = new StatusPolicyInstance(
            existing.InstanceId,
            existing.Identity,
            resultingStackCount,
            expiry);

        return StatusReapplyDecision.Applied(
            StatusReapplyOutcome.StacksAdded,
            result,
            removedInstanceId: null,
            stacksAdded: resultingStackCount - existing.StackCount,
            stackCapReached: requestedStackCount > request.MaxStacks);
    }

    private static StatusReapplyDecision CreateNew(
        StatusReapplyRequest request,
        StatusReapplyOutcome outcome,
        EntityId? removedInstanceId)
    {
        var initialStackCount = Math.Min(
            request.StackDelta,
            request.MaxStacks);
        var expiry = ReferenceStatusDurationPolicy.CalculateInitialExpiry(
            request.CurrentTick,
            request.DurationTicks);
        var result = new StatusPolicyInstance(
            request.IncomingInstanceId,
            request.Identity,
            initialStackCount,
            expiry);

        return StatusReapplyDecision.Applied(
            outcome,
            result,
            removedInstanceId,
            stacksAdded: initialStackCount,
            stackCapReached: request.StackDelta > request.MaxStacks);
    }

    private static void ValidateActiveInstances(
        StatusReapplyRequest request,
        IReadOnlyList<StatusPolicyInstance> activeInstances)
    {
        var instanceIds = new HashSet<EntityId>();
        for (var index = 0; index < activeInstances.Count; index++)
        {
            var instance = activeInstances[index] ??
                throw new ArgumentException(
                    "Active instances cannot contain null.",
                    nameof(activeInstances));

            if (!instanceIds.Add(instance.InstanceId))
            {
                throw new ArgumentException(
                    "Active instance IDs must be unique.",
                    nameof(activeInstances));
            }

            if (instance.ExpiresAtTick <= request.CurrentTick)
            {
                throw new ArgumentException(
                    "Active instances must be unexpired at the evaluation tick.",
                    nameof(activeInstances));
            }
        }

        if (instanceIds.Contains(request.IncomingInstanceId))
        {
            throw new ArgumentException(
                "The incoming instance ID must be unique in the active snapshot.",
                nameof(request));
        }
    }

    private static string? FindFirstSharedTag(
        TagSet statusTags,
        TagSet blockedStatusTags)
    {
        for (var index = 0; index < statusTags.Count; index++)
        {
            var statusTag = statusTags[index];
            if (blockedStatusTags.Contains(statusTag))
            {
                return statusTag;
            }
        }

        return null;
    }
}
