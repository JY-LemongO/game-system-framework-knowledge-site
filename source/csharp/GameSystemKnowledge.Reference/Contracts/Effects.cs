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
        int priority,
        EntityId stableOrderKey,
        int depth,
        int budgetCost)
    {
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

        if (maxBudget < 0)
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
    int RandomSeed);

public abstract record EffectOperation(EntityId OperationId);

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
        var effectCopy = effects?.ToArray() ??
            throw new ArgumentNullException(nameof(effects));
        if (effectCopy.Length == 0)
        {
            throw new ArgumentException(
                "An effect bundle must contain at least one effect.",
                nameof(effects));
        }

        var reactionCopy = (reactions ?? Enumerable.Empty<ReactionRule>()).ToArray();

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
        var operationCopy = primaryOperations?.ToArray() ??
            throw new ArgumentNullException(nameof(primaryOperations));
        if (operationCopy.Length == 0)
        {
            throw new ArgumentException(
                "An effect plan must contain at least one primary operation.",
                nameof(primaryOperations));
        }

        BundleId = bundleId;
        PrimaryOperations = Array.AsReadOnly(operationCopy);
        Reactions = Array.AsReadOnly(
            (reactions ?? Enumerable.Empty<ReactionRule>()).ToArray());
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

public sealed record EffectOperationResult(bool Succeeded, EntityId OperationId)
    : EffectResult(Succeeded);

public sealed record EffectBundleResult(
    bool Committed,
    EntityId BundleId,
    int AppliedEffectCount,
    int QueuedReactionCount)
    : EffectResult(Committed);

public interface IEffectExecutor
{
    EffectOperationResult Execute(
        EffectOperation operation,
        EffectContext context);

    EffectBundleResult Execute(
        EffectBundle bundle,
        EffectContext context);
}
