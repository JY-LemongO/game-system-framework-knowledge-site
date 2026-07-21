using System.Collections.ObjectModel;

namespace GameSystemKnowledge.Reference.Contracts;

public sealed class ReactionCommand
{
    public ReactionCommand(
        EntityId reactionId,
        EntityId idempotencyKey,
        EntityId handlerId,
        EntityId targetId,
        SourceRef source,
        EntityId causationId,
        int priority,
        EntityId stableOrderKey,
        int depth,
        int budgetCost)
    {
        EntityId.ThrowIfInvalid(reactionId, nameof(reactionId));
        EntityId.ThrowIfInvalid(idempotencyKey, nameof(idempotencyKey));
        EntityId.ThrowIfInvalid(handlerId, nameof(handlerId));
        EntityId.ThrowIfInvalid(targetId, nameof(targetId));
        SourceRef.ThrowIfInvalid(source, nameof(source));
        EntityId.ThrowIfInvalid(causationId, nameof(causationId));
        EntityId.ThrowIfInvalid(stableOrderKey, nameof(stableOrderKey));

        if (depth < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(depth));
        }

        if (budgetCost <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(budgetCost));
        }

        ReactionId = reactionId;
        IdempotencyKey = idempotencyKey;
        HandlerId = handlerId;
        TargetId = targetId;
        Source = source;
        CausationId = causationId;
        Priority = priority;
        StableOrderKey = stableOrderKey;
        Depth = depth;
        BudgetCost = budgetCost;
    }

    public EntityId ReactionId { get; }

    public EntityId IdempotencyKey { get; }

    public EntityId HandlerId { get; }

    public EntityId TargetId { get; }

    public SourceRef Source { get; }

    public EntityId CausationId { get; }

    public int Priority { get; }

    public EntityId StableOrderKey { get; }

    public int Depth { get; }

    public int BudgetCost { get; }
}

public sealed class ReactionBudget
{
    public ReactionBudget(
        int maxReactions,
        int maxDepth,
        int maxBudget)
    {
        if (maxReactions <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maxReactions));
        }

        if (maxDepth < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maxDepth));
        }

        if (maxBudget <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maxBudget));
        }

        MaxReactions = maxReactions;
        MaxDepth = maxDepth;
        MaxBudget = maxBudget;
    }

    public int MaxReactions { get; }

    public int MaxDepth { get; }

    public int MaxBudget { get; }
}

public interface IReactionQueue
{
    void Enqueue(ReactionCommand command);

    int Drain(ReactionBudget budget);
}

public sealed class ReactionRule
{
    public ReactionRule(
        EntityId ruleId,
        EntityId triggerEventTypeId,
        EntityId reactionId,
        EntityId idempotencyKey,
        EntityId handlerId,
        int priority,
        EntityId stableOrderKey,
        int depth,
        int budgetCost,
        bool requiresHit,
        bool requiresTargetAlive)
    {
        EntityId.ThrowIfInvalid(ruleId, nameof(ruleId));
        EntityId.ThrowIfInvalid(triggerEventTypeId, nameof(triggerEventTypeId));
        EntityId.ThrowIfInvalid(reactionId, nameof(reactionId));
        EntityId.ThrowIfInvalid(idempotencyKey, nameof(idempotencyKey));
        EntityId.ThrowIfInvalid(handlerId, nameof(handlerId));
        EntityId.ThrowIfInvalid(stableOrderKey, nameof(stableOrderKey));

        if (depth < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(depth));
        }

        if (budgetCost <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(budgetCost));
        }

        RuleId = ruleId;
        TriggerEventTypeId = triggerEventTypeId;
        ReactionId = reactionId;
        IdempotencyKey = idempotencyKey;
        HandlerId = handlerId;
        Priority = priority;
        StableOrderKey = stableOrderKey;
        Depth = depth;
        BudgetCost = budgetCost;
        RequiresHit = requiresHit;
        RequiresTargetAlive = requiresTargetAlive;
    }

    public EntityId RuleId { get; }

    public EntityId TriggerEventTypeId { get; }

    public EntityId ReactionId { get; }

    public EntityId IdempotencyKey { get; }

    public EntityId HandlerId { get; }

    public int Priority { get; }

    public EntityId StableOrderKey { get; }

    public int Depth { get; }

    public int BudgetCost { get; }

    public bool RequiresHit { get; }

    public bool RequiresTargetAlive { get; }
}

public sealed record EffectContext(
    EntityId CasterId,
    EntityId? InitialTargetId,
    SourceRef Source,
    uint RandomSeed)
{
    private EntityId _casterId = ValidEntityId(CasterId, nameof(CasterId));
    private EntityId? _initialTargetId = ValidOptionalEntityId(
        InitialTargetId,
        nameof(InitialTargetId));
    private SourceRef _source = ValidSource(Source, nameof(Source));

    public EntityId CasterId
    {
        get => _casterId;
        init => _casterId = ValidEntityId(value, nameof(CasterId));
    }

    public EntityId? InitialTargetId
    {
        get => _initialTargetId;
        init => _initialTargetId = ValidOptionalEntityId(
            value,
            nameof(InitialTargetId));
    }

    public SourceRef Source
    {
        get => _source;
        init => _source = ValidSource(value, nameof(Source));
    }

    private static EntityId ValidEntityId(
        EntityId entityId,
        string parameterName)
    {
        EntityId.ThrowIfInvalid(entityId, parameterName);
        return entityId;
    }

    private static EntityId? ValidOptionalEntityId(
        EntityId? entityId,
        string parameterName)
    {
        if (entityId.HasValue)
        {
            EntityId.ThrowIfInvalid(entityId.Value, parameterName);
        }

        return entityId;
    }

    private static SourceRef ValidSource(
        SourceRef source,
        string parameterName)
    {
        SourceRef.ThrowIfInvalid(source, parameterName);
        return source;
    }
}

public abstract record EffectOperation(EntityId OperationId)
{
    private EntityId _operationId = ValidOperationId(
        OperationId,
        nameof(OperationId));

    public EntityId OperationId
    {
        get => _operationId;
        init => _operationId = ValidOperationId(value, nameof(OperationId));
    }

    private static EntityId ValidOperationId(
        EntityId operationId,
        string parameterName)
    {
        EntityId.ThrowIfInvalid(operationId, parameterName);
        return operationId;
    }
}

public sealed record DamageEffectOperation(
    EntityId OperationId,
    DamageRequest Request)
    : EffectOperation(OperationId);

public sealed record ApplyStatusEffectOperation(
    EntityId OperationId,
    ApplyStatusRequest Request)
    : EffectOperation(OperationId);

/// <summary>
/// Controls only when reactions begin relative to the primary commit.
/// Target failure, transaction grouping, and compensation are separate policies.
/// </summary>
public enum EffectExecutionPolicy
{
    CommitThenReact
}

public sealed class EffectBundle
{
    public EffectBundle(
        EntityId bundleId,
        IEnumerable<EffectOperation> effects,
        IEnumerable<ReactionRule>? reactions = null,
        EffectExecutionPolicy policy = EffectExecutionPolicy.CommitThenReact)
    {
        EntityId.ThrowIfInvalid(bundleId, nameof(bundleId));

        var effectCopy = effects?.ToArray() ??
            throw new ArgumentNullException(nameof(effects));
        if (effectCopy.Length == 0)
        {
            throw new ArgumentException(
                "An effect bundle must contain at least one effect.",
                nameof(effects));
        }

        foreach (var effect in effectCopy)
        {
            ArgumentNullException.ThrowIfNull(effect, nameof(effects));
            EntityId.ThrowIfInvalid(effect.OperationId, nameof(effects));
        }

        var reactionCopy = (reactions ?? Enumerable.Empty<ReactionRule>()).ToArray();
        if (reactionCopy.Any(reaction => reaction is null))
        {
            throw new ArgumentException(
                "Effect bundle reactions cannot contain null values.",
                nameof(reactions));
        }

        BundleId = bundleId;
        Effects = Array.AsReadOnly(effectCopy);
        Reactions = Array.AsReadOnly(reactionCopy);
        Policy = policy;
    }

    public EntityId BundleId { get; }

    public ReadOnlyCollection<EffectOperation> Effects { get; }

    public ReadOnlyCollection<ReactionRule> Reactions { get; }

    public EffectExecutionPolicy Policy { get; }
}

/// <summary>
/// A pure, target-resolved plan that can be composed with skill cost and
/// cooldown changes before one RuntimeCommitter transaction is created.
/// </summary>
public sealed class EffectBundlePlan
{
    public EffectBundlePlan(
        EntityId bundleId,
        IEnumerable<EffectOperation> primaryOperations,
        IEnumerable<ReactionRule>? reactions = null)
    {
        EntityId.ThrowIfInvalid(bundleId, nameof(bundleId));

        var operationCopy = primaryOperations?.ToArray() ??
            throw new ArgumentNullException(nameof(primaryOperations));
        if (operationCopy.Length == 0)
        {
            throw new ArgumentException(
                "An effect plan must contain at least one primary operation.",
                nameof(primaryOperations));
        }

        foreach (var operation in operationCopy)
        {
            ArgumentNullException.ThrowIfNull(operation, nameof(primaryOperations));
            EntityId.ThrowIfInvalid(operation.OperationId, nameof(primaryOperations));
        }

        var reactionCopy = (reactions ?? Enumerable.Empty<ReactionRule>()).ToArray();
        if (reactionCopy.Any(reaction => reaction is null))
        {
            throw new ArgumentException(
                "Effect plan reactions cannot contain null values.",
                nameof(reactions));
        }

        BundleId = bundleId;
        PrimaryOperations = Array.AsReadOnly(operationCopy);
        Reactions = Array.AsReadOnly(reactionCopy);
    }

    public EntityId BundleId { get; }

    public ReadOnlyCollection<EffectOperation> PrimaryOperations { get; }

    public ReadOnlyCollection<ReactionRule> Reactions { get; }
}

public interface IEffectPlanner
{
    EffectBundlePlan Prepare(
        EffectBundle bundle,
        EffectContext context);
}

public abstract record EffectResult(bool Succeeded);

public sealed record EffectOperationResult(
    bool Succeeded,
    EntityId OperationId)
    : EffectResult(Succeeded)
{
    private EntityId _operationId = ValidOperationId(
        OperationId,
        nameof(OperationId));

    public EntityId OperationId
    {
        get => _operationId;
        init => _operationId = ValidOperationId(value, nameof(OperationId));
    }

    private static EntityId ValidOperationId(
        EntityId operationId,
        string parameterName)
    {
        EntityId.ThrowIfInvalid(operationId, parameterName);
        return operationId;
    }
}

public sealed record EffectBundleResult : EffectResult
{
    public EffectBundleResult(
        bool committed,
        EntityId bundleId,
        int appliedEffectCount,
        int queuedReactionCount)
        : base(committed)
    {
        EntityId.ThrowIfInvalid(bundleId, nameof(bundleId));

        if (appliedEffectCount < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(appliedEffectCount));
        }

        if (queuedReactionCount < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(queuedReactionCount));
        }

        if (!committed && (appliedEffectCount != 0 || queuedReactionCount != 0))
        {
            throw new ArgumentException(
                "An uncommitted bundle cannot report applied effects or queued reactions.");
        }

        Committed = committed;
        BundleId = bundleId;
        AppliedEffectCount = appliedEffectCount;
        QueuedReactionCount = queuedReactionCount;
    }

    public bool Committed { get; }

    public EntityId BundleId { get; }

    public int AppliedEffectCount { get; }

    public int QueuedReactionCount { get; }
}

public interface IEffectExecutor
{
    EffectOperationResult Execute(
        EffectOperation operation,
        EffectContext context);

    EffectBundleResult Execute(
        EffectBundle bundle,
        EffectContext context);
}
