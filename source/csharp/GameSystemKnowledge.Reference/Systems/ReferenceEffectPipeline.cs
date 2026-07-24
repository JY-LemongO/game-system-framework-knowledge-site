using System.Collections.ObjectModel;
using GameSystemKnowledge.Reference.Contracts;
using GameSystemKnowledge.Reference.Runtime;

namespace GameSystemKnowledge.Reference.Systems;

public enum EffectTargetMode
{
    Self,
    ExplicitTarget,
    CandidateSnapshot
}

public abstract class ReferenceEffectOperationSpec
{
    protected ReferenceEffectOperationSpec(EntityId operationId)
    {
        EntityId.ThrowIfInvalid(operationId, nameof(operationId));
        OperationId = operationId;
    }

    public EntityId OperationId { get; }
}

public sealed class DamageEffectSpec : ReferenceEffectOperationSpec
{
    public DamageEffectSpec(
        EntityId operationId,
        EntityId formulaId,
        string damageType,
        int baseValue,
        int coefficientBps,
        IEnumerable<string> tags)
        : base(operationId)
    {
        EntityId.ThrowIfInvalid(formulaId, nameof(formulaId));
        if (string.IsNullOrWhiteSpace(damageType))
        {
            throw new ArgumentException(
                "A damage specification requires a damage type.",
                nameof(damageType));
        }

        if (baseValue < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(baseValue));
        }

        if (coefficientBps < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(coefficientBps));
        }

        FormulaId = formulaId;
        DamageType = damageType;
        BaseValue = baseValue;
        CoefficientBps = coefficientBps;
        Tags = new TagSet(
            tags ?? throw new ArgumentNullException(nameof(tags)));
    }

    public EntityId FormulaId { get; }

    public string DamageType { get; }

    public int BaseValue { get; }

    public int CoefficientBps { get; }

    public TagSet Tags { get; }
}

public sealed class ApplyStatusEffectSpec : ReferenceEffectOperationSpec
{
    public ApplyStatusEffectSpec(
        EntityId operationId,
        EntityId statusId,
        int stackDelta)
        : base(operationId)
    {
        EntityId.ThrowIfInvalid(statusId, nameof(statusId));
        if (stackDelta <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(stackDelta));
        }

        StatusId = statusId;
        StackDelta = stackDelta;
    }

    public EntityId StatusId { get; }

    public int StackDelta { get; }
}

public sealed class ReferenceEffectSpecification
{
    public ReferenceEffectSpecification(
        EntityId specificationId,
        IEnumerable<ReferenceEffectOperationSpec> operations)
    {
        EntityId.ThrowIfInvalid(specificationId, nameof(specificationId));
        var operationCopy = operations?.ToArray() ??
            throw new ArgumentNullException(nameof(operations));
        if (operationCopy.Length == 0)
        {
            throw new ArgumentException(
                "An effect specification requires at least one operation.",
                nameof(operations));
        }

        if (operationCopy.Any(operation => operation is null))
        {
            throw new ArgumentException(
                "An effect specification cannot contain null operations.",
                nameof(operations));
        }

        if (operationCopy.Length != operationCopy
                .Select(operation => operation.OperationId)
                .Distinct()
                .Count())
        {
            throw new ArgumentException(
                "An effect specification cannot contain duplicate operation IDs.",
                nameof(operations));
        }

        SpecificationId = specificationId;
        Operations = Array.AsReadOnly(operationCopy);
    }

    public EntityId SpecificationId { get; }

    public ReadOnlyCollection<ReferenceEffectOperationSpec> Operations { get; }
}

public sealed class EffectTargetCandidate
{
    public EffectTargetCandidate(
        EntityId targetId,
        int selectionPriority,
        long distanceSquared)
    {
        EntityId.ThrowIfInvalid(targetId, nameof(targetId));
        if (distanceSquared < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(distanceSquared));
        }

        TargetId = targetId;
        SelectionPriority = selectionPriority;
        DistanceSquared = distanceSquared;
    }

    public EntityId TargetId { get; }

    public int SelectionPriority { get; }

    public long DistanceSquared { get; }
}

public sealed class CanonicalTargetSnapshot
{
    public CanonicalTargetSnapshot(
        IEnumerable<EffectTargetCandidate> candidates)
    {
        var candidateCopy = candidates?.ToArray() ??
            throw new ArgumentNullException(nameof(candidates));
        if (candidateCopy.Any(candidate => candidate is null))
        {
            throw new ArgumentException(
                "A target snapshot cannot contain null candidates.",
                nameof(candidates));
        }

        if (candidateCopy.Length != candidateCopy
                .Select(candidate => candidate.TargetId)
                .Distinct()
                .Count())
        {
            throw new ArgumentException(
                "A target snapshot cannot contain duplicate target IDs.",
                nameof(candidates));
        }

        // 물리 엔진의 열거 순서를 버리고 priority, 거리, ID 순서로 후보를 고정한다.
        Candidates = Array.AsReadOnly(
            candidateCopy
                .OrderByDescending(candidate => candidate.SelectionPriority)
                .ThenBy(candidate => candidate.DistanceSquared)
                .ThenBy(candidate => candidate.TargetId)
                .ToArray());
    }

    public ReadOnlyCollection<EffectTargetCandidate> Candidates { get; }
}

public sealed class EffectTargetRule
{
    public EffectTargetRule(
        EntityId operationId,
        EffectTargetMode mode,
        int maxTargets = 1)
    {
        EntityId.ThrowIfInvalid(operationId, nameof(operationId));
        if (!Enum.IsDefined(mode))
        {
            throw new ArgumentOutOfRangeException(nameof(mode));
        }

        if (maxTargets <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maxTargets));
        }

        if (mode is EffectTargetMode.Self or EffectTargetMode.ExplicitTarget &&
            maxTargets != 1)
        {
            throw new ArgumentException(
                "Self and ExplicitTarget rules resolve exactly one target.",
                nameof(maxTargets));
        }

        OperationId = operationId;
        Mode = mode;
        MaxTargets = maxTargets;
    }

    public EntityId OperationId { get; }

    public EffectTargetMode Mode { get; }

    public int MaxTargets { get; }
}

public sealed class ResolvedEffectOperation
{
    internal ResolvedEffectOperation(
        ReferenceEffectOperationSpec operation,
        EntityId targetId,
        int targetOrder,
        EffectContext context)
    {
        ArgumentNullException.ThrowIfNull(operation);
        EntityId.ThrowIfInvalid(targetId, nameof(targetId));
        ArgumentNullException.ThrowIfNull(context);
        if (targetOrder < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(targetOrder));
        }

        OperationId = operation.OperationId;
        TargetId = targetId;
        TargetOrder = targetOrder;
        BoundOperation = BindTarget(operation, targetId, context);
    }

    public EntityId OperationId { get; }

    public EntityId TargetId { get; }

    public int TargetOrder { get; }

    public EffectOperation BoundOperation { get; }

    private static EffectOperation BindTarget(
        ReferenceEffectOperationSpec operation,
        EntityId targetId,
        EffectContext context) =>
        operation switch
        {
            DamageEffectSpec damage => new DamageEffectOperation(
                damage.OperationId,
                new DamageRequest(
                    context.CasterId,
                    targetId,
                    context.Source,
                    damage.FormulaId,
                    damage.DamageType,
                    damage.BaseValue,
                    damage.CoefficientBps,
                    damage.Tags,
                    context.RandomSeed)),
            ApplyStatusEffectSpec status => new ApplyStatusEffectOperation(
                status.OperationId,
                new ApplyStatusRequest(
                    status.StatusId,
                    targetId,
                    context.Source,
                    status.StackDelta)),
            _ => throw new NotSupportedException(
                $"No target binder is registered for '{operation.GetType().Name}'.")
        };
}

public sealed class UnresolvedEffectOperation
{
    internal UnresolvedEffectOperation(
        EntityId operationId,
        string reason)
    {
        EntityId.ThrowIfInvalid(operationId, nameof(operationId));
        if (string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException(
                "An unresolved operation requires a stable reason.",
                nameof(reason));
        }

        OperationId = operationId;
        Reason = reason;
    }

    public EntityId OperationId { get; }

    public string Reason { get; }
}

public sealed class EffectTargetResolutionPlan
{
    internal EffectTargetResolutionPlan(
        IEnumerable<ResolvedEffectOperation> operations,
        IEnumerable<UnresolvedEffectOperation> notApplicable)
    {
        Operations = Array.AsReadOnly(operations.ToArray());
        NotApplicable = Array.AsReadOnly(notApplicable.ToArray());
    }

    public ReadOnlyCollection<ResolvedEffectOperation> Operations { get; }

    public ReadOnlyCollection<UnresolvedEffectOperation> NotApplicable { get; }
}

public static class ReferenceEffectTargetResolver
{
    public static EffectTargetResolutionPlan Resolve(
        ReferenceEffectSpecification specification,
        EffectContext context,
        IEnumerable<EffectTargetRule> rules,
        CanonicalTargetSnapshot? candidateSnapshot = null)
    {
        ArgumentNullException.ThrowIfNull(specification);
        ArgumentNullException.ThrowIfNull(context);
        var ruleCopy = rules?.ToArray() ??
            throw new ArgumentNullException(nameof(rules));
        if (ruleCopy.Any(rule => rule is null))
        {
            throw new ArgumentException(
                "Target rules cannot contain null values.",
                nameof(rules));
        }

        if (ruleCopy.Length != ruleCopy
                .Select(rule => rule.OperationId)
                .Distinct()
                .Count())
        {
            throw new ArgumentException(
                "Each effect operation requires exactly one target rule.",
                nameof(rules));
        }

        var operationIds = specification.Operations
            .Select(operation => operation.OperationId)
            .ToHashSet();
        var ruleIds = ruleCopy
            .Select(rule => rule.OperationId)
            .ToHashSet();
        if (!operationIds.SetEquals(ruleIds))
        {
            throw new ArgumentException(
                "Target rules must match the specification operation IDs exactly.",
                nameof(rules));
        }

        if (ruleCopy.Any(rule => rule.Mode == EffectTargetMode.CandidateSnapshot) &&
            candidateSnapshot is null)
        {
            throw new ArgumentNullException(
                nameof(candidateSnapshot),
                "CandidateSnapshot rules require one canonical adapter snapshot.");
        }

        var rulesByOperation = ruleCopy.ToDictionary(
            rule => rule.OperationId,
            rule => rule);
        var resolved = new List<ResolvedEffectOperation>();
        var notApplicable = new List<UnresolvedEffectOperation>();

        foreach (var operation in specification.Operations
                     .OrderBy(operation => operation.OperationId))
        {
            var rule = rulesByOperation[operation.OperationId];
            switch (rule.Mode)
            {
                case EffectTargetMode.Self:
                    resolved.Add(new ResolvedEffectOperation(
                        operation,
                        context.CasterId,
                        targetOrder: 0,
                        context));
                    break;
                case EffectTargetMode.ExplicitTarget:
                    if (context.InitialTargetId is { } explicitTargetId)
                    {
                        resolved.Add(new ResolvedEffectOperation(
                            operation,
                            explicitTargetId,
                            targetOrder: 0,
                            context));
                    }
                    else
                    {
                        notApplicable.Add(new UnresolvedEffectOperation(
                            operation.OperationId,
                            "explicit-target-missing"));
                    }

                    break;
                case EffectTargetMode.CandidateSnapshot:
                    var selectedCount = Math.Min(
                        rule.MaxTargets,
                        candidateSnapshot!.Candidates.Count);
                    if (selectedCount == 0)
                    {
                        notApplicable.Add(new UnresolvedEffectOperation(
                            operation.OperationId,
                            "candidate-snapshot-empty"));
                        break;
                    }

                    for (var index = 0; index < selectedCount; index++)
                    {
                        resolved.Add(new ResolvedEffectOperation(
                            operation,
                            candidateSnapshot.Candidates[index].TargetId,
                            targetOrder: index,
                            context));
                    }

                    break;
                default:
                    throw new ArgumentOutOfRangeException(nameof(rule.Mode));
            }
        }

        return new EffectTargetResolutionPlan(resolved, notApplicable);
    }
}

public sealed class CommitPlanFragment
{
    public CommitPlanFragment(
        EntityId fragmentId,
        EntityId operationId,
        EntityId targetId,
        IEnumerable<VersionPrecondition> preconditions,
        IEnumerable<StateMutation> mutations,
        IEnumerable<DomainEvent>? outboxEvents = null)
    {
        EntityId.ThrowIfInvalid(fragmentId, nameof(fragmentId));
        EntityId.ThrowIfInvalid(operationId, nameof(operationId));
        EntityId.ThrowIfInvalid(targetId, nameof(targetId));

        var preconditionCopy = preconditions?.ToArray() ??
            throw new ArgumentNullException(nameof(preconditions));
        var mutationCopy = mutations?.ToArray() ??
            throw new ArgumentNullException(nameof(mutations));
        var eventCopy = (outboxEvents ?? Enumerable.Empty<DomainEvent>())
            .ToArray();

        if (preconditionCopy.Any(precondition =>
                !precondition.ResourceId.IsValid ||
                precondition.ExpectedVersion < 0))
        {
            throw new ArgumentException(
                "Fragment preconditions require valid IDs and non-negative versions.",
                nameof(preconditions));
        }

        if (mutationCopy.Length == 0)
        {
            throw new ArgumentException(
                "An applied effect fragment requires at least one mutation.",
                nameof(mutations));
        }

        if (mutationCopy.Any(mutation => mutation is null))
        {
            throw new ArgumentException(
                "Fragment mutations cannot contain null values.",
                nameof(mutations));
        }

        if (eventCopy.Any(@event => @event is null))
        {
            throw new ArgumentException(
                "Fragment outbox events cannot contain null values.",
                nameof(outboxEvents));
        }

        foreach (var @event in eventCopy)
        {
            @event.ValidateContract();
        }

        EnsureUnique(
            preconditionCopy.Select(precondition => precondition.ResourceId),
            nameof(preconditions),
            "precondition resource");
        EnsureUnique(
            mutationCopy.Select(mutation => mutation.ResourceId),
            nameof(mutations),
            "mutation resource");
        EnsureUnique(
            eventCopy.Select(@event => @event.EventId),
            nameof(outboxEvents),
            "event");

        var preconditionResources = preconditionCopy
            .Select(precondition => precondition.ResourceId)
            .ToHashSet();
        if (mutationCopy.Any(mutation =>
                !preconditionResources.Contains(mutation.ResourceId)))
        {
            throw new ArgumentException(
                "Every fragment mutation requires a version precondition.");
        }

        FragmentId = fragmentId;
        OperationId = operationId;
        TargetId = targetId;
        Preconditions = Array.AsReadOnly(
            preconditionCopy
                .OrderBy(precondition => precondition.ResourceId)
                .ToArray());
        Mutations = Array.AsReadOnly(
            mutationCopy
                .OrderBy(mutation => mutation.ResourceId)
                .ToArray());
        OutboxEvents = Array.AsReadOnly(
            eventCopy
                .OrderBy(@event => @event.EventId)
                .ToArray());
    }

    public EntityId FragmentId { get; }

    public EntityId OperationId { get; }

    public EntityId TargetId { get; }

    public ReadOnlyCollection<VersionPrecondition> Preconditions { get; }

    public ReadOnlyCollection<StateMutation> Mutations { get; }

    public ReadOnlyCollection<DomainEvent> OutboxEvents { get; }

    private static void EnsureUnique(
        IEnumerable<EntityId> ids,
        string parameterName,
        string kind)
    {
        var seen = new HashSet<EntityId>();
        if (ids.Any(id => !seen.Add(id)))
        {
            throw new ArgumentException(
                $"A fragment can mention each {kind} ID only once.",
                parameterName);
        }
    }
}

public enum EffectOperationDisposition
{
    Applied,
    NotApplicable,
    Rejected
}

public sealed class EffectOperationOutcome
{
    private EffectOperationOutcome(
        EffectOperationDisposition disposition,
        EntityId operationId,
        EntityId? targetId,
        CommitPlanFragment? fragment,
        string? reason)
    {
        if (!Enum.IsDefined(disposition))
        {
            throw new ArgumentOutOfRangeException(nameof(disposition));
        }

        EntityId.ThrowIfInvalid(operationId, nameof(operationId));
        if (targetId.HasValue)
        {
            EntityId.ThrowIfInvalid(targetId.Value, nameof(targetId));
        }

        if (disposition == EffectOperationDisposition.Applied)
        {
            ArgumentNullException.ThrowIfNull(fragment);
            if (!targetId.HasValue ||
                fragment.OperationId != operationId ||
                fragment.TargetId != targetId.Value)
            {
                throw new ArgumentException(
                    "An applied fragment must match its resolved operation and target.",
                    nameof(fragment));
            }

            if (reason is not null)
            {
                throw new ArgumentException(
                    "An applied outcome cannot carry a failure reason.",
                    nameof(reason));
            }
        }
        else
        {
            if (fragment is not null)
            {
                throw new ArgumentException(
                    "A non-applied outcome cannot carry a commit fragment.",
                    nameof(fragment));
            }

            if (string.IsNullOrWhiteSpace(reason))
            {
                throw new ArgumentException(
                    "A non-applied outcome requires a stable reason.",
                    nameof(reason));
            }
        }

        Disposition = disposition;
        OperationId = operationId;
        TargetId = targetId;
        Fragment = fragment;
        Reason = reason;
    }

    public EffectOperationDisposition Disposition { get; }

    public EntityId OperationId { get; }

    public EntityId? TargetId { get; }

    public CommitPlanFragment? Fragment { get; }

    public string? Reason { get; }

    public static EffectOperationOutcome Applied(
        ResolvedEffectOperation operation,
        CommitPlanFragment fragment)
    {
        ArgumentNullException.ThrowIfNull(operation);
        return new EffectOperationOutcome(
            EffectOperationDisposition.Applied,
            operation.OperationId,
            operation.TargetId,
            fragment,
            reason: null);
    }

    public static EffectOperationOutcome NotApplicable(
        EntityId operationId,
        EntityId? targetId,
        string reason) =>
        new(
            EffectOperationDisposition.NotApplicable,
            operationId,
            targetId,
            fragment: null,
            reason);

    public static EffectOperationOutcome NotApplicable(
        UnresolvedEffectOperation operation)
    {
        ArgumentNullException.ThrowIfNull(operation);
        return NotApplicable(
            operation.OperationId,
            targetId: null,
            operation.Reason);
    }

    public static EffectOperationOutcome Rejected(
        EntityId operationId,
        EntityId? targetId,
        string reason) =>
        new(
            EffectOperationDisposition.Rejected,
            operationId,
            targetId,
            fragment: null,
            reason);
}

public enum EffectCompositionStatus
{
    Ready,
    NoChanges,
    Rejected
}

public sealed class EffectCommitComposition
{
    private EffectCommitComposition(
        EffectCompositionStatus status,
        CommitPlan? plan,
        IEnumerable<string>? rejectionReasons = null)
    {
        Status = status;
        Plan = plan;
        RejectionReasons = Array.AsReadOnly(
            (rejectionReasons ?? Enumerable.Empty<string>()).ToArray());
    }

    public EffectCompositionStatus Status { get; }

    public CommitPlan? Plan { get; }

    public ReadOnlyCollection<string> RejectionReasons { get; }

    internal static EffectCommitComposition Ready(CommitPlan plan) =>
        new(EffectCompositionStatus.Ready, plan);

    internal static EffectCommitComposition NoChanges() =>
        new(EffectCompositionStatus.NoChanges, plan: null);

    internal static EffectCommitComposition Rejected(
        IEnumerable<string> reasons) =>
        new(EffectCompositionStatus.Rejected, plan: null, reasons);
}

public static class DeterministicEffectCommitPlanComposer
{
    public static EffectCommitComposition Compose(
        EntityId commandId,
        IEnumerable<EffectOperationOutcome> outcomes)
    {
        EntityId.ThrowIfInvalid(commandId, nameof(commandId));
        var outcomeCopy = outcomes?.ToArray() ??
            throw new ArgumentNullException(nameof(outcomes));
        if (outcomeCopy.Any(outcome => outcome is null))
        {
            throw new ArgumentException(
                "Effect outcomes cannot contain null values.",
                nameof(outcomes));
        }

        var ordered = outcomeCopy
            .OrderBy(outcome => outcome.OperationId)
            .ThenBy(outcome => outcome.TargetId.HasValue ? 1 : 0)
            .ThenBy(
                outcome => outcome.TargetId?.Value ?? string.Empty,
                StringComparer.Ordinal)
            .ToArray();

        var outcomeKeys = new HashSet<(EntityId OperationId, EntityId? TargetId)>();
        if (ordered.Any(outcome =>
                !outcomeKeys.Add((outcome.OperationId, outcome.TargetId))))
        {
            throw new ArgumentException(
                "Each operation-target outcome can be composed only once.",
                nameof(outcomes));
        }

        var operationWideNotApplicable = ordered
            .Where(outcome =>
                outcome.Disposition == EffectOperationDisposition.NotApplicable &&
                !outcome.TargetId.HasValue)
            .Select(outcome => outcome.OperationId)
            .ToHashSet();
        if (ordered.Any(outcome =>
                outcome.TargetId.HasValue &&
                operationWideNotApplicable.Contains(outcome.OperationId)))
        {
            throw new ArgumentException(
                "An operation-wide NotApplicable outcome cannot coexist with target outcomes.",
                nameof(outcomes));
        }

        var rejected = ordered
            .Where(outcome =>
                outcome.Disposition == EffectOperationDisposition.Rejected)
            .Select(outcome =>
                $"{outcome.OperationId.Value}:{outcome.Reason}")
            .ToArray();
        if (rejected.Length > 0)
        {
            return EffectCommitComposition.Rejected(rejected);
        }

        var applied = ordered
            .Where(outcome =>
                outcome.Disposition == EffectOperationDisposition.Applied)
            .ToArray();
        if (applied.Length == 0)
        {
            return EffectCommitComposition.NoChanges();
        }

        var fragmentIds = new HashSet<EntityId>();
        var preconditions = new Dictionary<EntityId, VersionPrecondition>();
        var mutations = new List<StateMutation>();
        var mutationResources = new HashSet<EntityId>();
        var events = new List<DomainEvent>();
        var eventIds = new HashSet<EntityId>();

        foreach (var outcome in applied)
        {
            var fragment = outcome.Fragment!;
            if (!fragmentIds.Add(fragment.FragmentId))
            {
                throw new ArgumentException(
                    $"Duplicate commit fragment ID '{fragment.FragmentId}'.",
                    nameof(outcomes));
            }

            foreach (var precondition in fragment.Preconditions)
            {
                if (preconditions.TryGetValue(
                        precondition.ResourceId,
                        out var existing))
                {
                    if (existing.ExpectedVersion != precondition.ExpectedVersion)
                    {
                        throw new ArgumentException(
                            $"Precondition collision for resource " +
                            $"'{precondition.ResourceId}'.",
                            nameof(outcomes));
                    }

                    continue;
                }

                preconditions.Add(precondition.ResourceId, precondition);
            }

            // 둘 이상의 effect가 같은 resource를 쓰면 암묵적 last-write-wins 대신 조합을 거부한다.
            foreach (var mutation in fragment.Mutations)
            {
                if (!mutationResources.Add(mutation.ResourceId))
                {
                    throw new ArgumentException(
                        $"Mutation collision for resource '{mutation.ResourceId}'.",
                        nameof(outcomes));
                }

                mutations.Add(mutation);
            }

            foreach (var @event in fragment.OutboxEvents)
            {
                if (!eventIds.Add(@event.EventId))
                {
                    throw new ArgumentException(
                        $"Duplicate outbox event ID '{@event.EventId}'.",
                        nameof(outcomes));
                }

                events.Add(@event);
            }
        }

        var plan = new CommitPlan(
            commandId,
            preconditions.Values.OrderBy(item => item.ResourceId),
            mutations,
            events);
        return EffectCommitComposition.Ready(plan);
    }
}
