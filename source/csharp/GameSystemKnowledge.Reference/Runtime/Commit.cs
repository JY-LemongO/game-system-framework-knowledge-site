using System.Collections.ObjectModel;
using GameSystemKnowledge.Reference.Contracts;

namespace GameSystemKnowledge.Reference.Runtime;

public sealed record VersionedResourceState(
    EntityId ResourceId,
    long Value,
    long Version);

public sealed record VersionPrecondition(
    EntityId ResourceId,
    long ExpectedVersion);

public sealed class StateMutation
{
    public StateMutation(
        EntityId resourceId,
        long newValue,
        string description)
    {
        EntityId.ThrowIfInvalid(resourceId, nameof(resourceId));

        if (newValue < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(newValue));
        }

        if (string.IsNullOrWhiteSpace(description))
        {
            throw new ArgumentException(
                "A state mutation must explain the intended change.",
                nameof(description));
        }

        ResourceId = resourceId;
        NewValue = newValue;
        Description = description;
    }

    public EntityId ResourceId { get; }

    public long NewValue { get; }

    public string Description { get; }
}

public abstract record DomainEvent(
    EntityId EventId,
    EntityId CommandId,
    SourceRef Source)
{
    internal virtual void ValidateContract()
    {
        EntityId.ThrowIfInvalid(EventId, nameof(EventId));
        EntityId.ThrowIfInvalid(CommandId, nameof(CommandId));
        SourceRef.ThrowIfInvalid(Source, nameof(Source));
    }

    internal virtual void ValidatePostState(
        IReadOnlyDictionary<EntityId, VersionedResourceState> postState)
    {
    }

    internal virtual void ValidateStateTransition(
        IReadOnlyDictionary<EntityId, VersionedResourceState> preState,
        IReadOnlyDictionary<EntityId, VersionedResourceState> postState)
    {
        ArgumentNullException.ThrowIfNull(preState);
        ArgumentNullException.ThrowIfNull(postState);
        ValidatePostState(postState);
    }
}

public sealed record SkillCommitted(
    EntityId EventId,
    EntityId CommandId,
    EntityId CasterId,
    EntityId SkillId,
    EntityId? TargetId,
    SourceRef Source,
    EntityId ManaResourceId,
    long ManaSpent,
    EntityId CooldownResourceId,
    long CooldownReadyTick)
    : DomainEvent(EventId, CommandId, Source)
{
    internal override void ValidateContract()
    {
        base.ValidateContract();
        EntityId.ThrowIfInvalid(CasterId, nameof(CasterId));
        EntityId.ThrowIfInvalid(SkillId, nameof(SkillId));
        if (TargetId.HasValue)
        {
            EntityId.ThrowIfInvalid(TargetId.Value, nameof(TargetId));
        }

        if (Source.Kind != SourceKind.SkillExecution ||
            Source.DefinitionId != SkillId ||
            Source.InstanceId != CommandId)
        {
            throw new ArgumentException(
                "SkillCommitted.Source must identify this skill execution.");
        }

        EntityId.ThrowIfInvalid(ManaResourceId, nameof(ManaResourceId));
        EntityId.ThrowIfInvalid(CooldownResourceId, nameof(CooldownResourceId));
        if (ManaResourceId == CooldownResourceId)
        {
            throw new ArgumentException(
                "Mana and cooldown facts must identify distinct resources.");
        }

        if (ManaSpent < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(ManaSpent));
        }

        if (CooldownReadyTick < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(CooldownReadyTick));
        }
    }

    internal override void ValidateStateTransition(
        IReadOnlyDictionary<EntityId, VersionedResourceState> preState,
        IReadOnlyDictionary<EntityId, VersionedResourceState> postState)
    {
        base.ValidateStateTransition(preState, postState);

        if (!preState.TryGetValue(ManaResourceId, out var manaBefore) ||
            !postState.TryGetValue(ManaResourceId, out var manaAfter))
        {
            throw new InvalidOperationException(
                "SkillCommitted must reference a committed mana resource.");
        }

        if (manaBefore.Value < ManaSpent ||
            manaAfter.Value != manaBefore.Value - ManaSpent ||
            manaBefore.Version == long.MaxValue ||
            manaAfter.Version != manaBefore.Version + 1)
        {
            throw new InvalidOperationException(
                "SkillCommitted.ManaSpent must match the committed mana transition.");
        }

        if (!preState.TryGetValue(CooldownResourceId, out var cooldownBefore) ||
            !postState.TryGetValue(CooldownResourceId, out var cooldownAfter))
        {
            throw new InvalidOperationException(
                "SkillCommitted must reference a committed cooldown resource.");
        }

        if (cooldownAfter.Value != CooldownReadyTick ||
            cooldownBefore.Version == long.MaxValue ||
            cooldownAfter.Version != cooldownBefore.Version + 1)
        {
            throw new InvalidOperationException(
                "SkillCommitted.CooldownReadyTick must match the committed cooldown transition.");
        }
    }
}

public sealed record DamageCommitted(
    EntityId EventId,
    EntityId CommandId,
    EntityId AttackerId,
    EntityId DefenderId,
    SourceRef Source,
    DamageResult Result,
    EntityId TargetHpResourceId,
    long TargetHpAfter,
    EntityId TargetShieldResourceId,
    long TargetShieldAfter)
    : DomainEvent(EventId, CommandId, Source)
{
    internal override void ValidateContract()
    {
        base.ValidateContract();
        EntityId.ThrowIfInvalid(AttackerId, nameof(AttackerId));
        EntityId.ThrowIfInvalid(DefenderId, nameof(DefenderId));
        EntityId.ThrowIfInvalid(TargetHpResourceId, nameof(TargetHpResourceId));
        EntityId.ThrowIfInvalid(TargetShieldResourceId, nameof(TargetShieldResourceId));
        ArgumentNullException.ThrowIfNull(Result);

        if (TargetHpResourceId == TargetShieldResourceId)
        {
            throw new ArgumentException(
                "DamageCommitted must identify distinct HP and shield resources.");
        }

        if (Source.Kind == SourceKind.SkillExecution &&
            Source.InstanceId != CommandId)
        {
            throw new ArgumentException(
                "A skill-sourced DamageCommitted fact must identify this command execution.");
        }
    }

    internal override void ValidatePostState(
        IReadOnlyDictionary<EntityId, VersionedResourceState> postState)
    {
        ArgumentNullException.ThrowIfNull(postState);
        EntityId.ThrowIfInvalid(TargetHpResourceId, nameof(TargetHpResourceId));
        EntityId.ThrowIfInvalid(TargetShieldResourceId, nameof(TargetShieldResourceId));

        if (TargetHpAfter < 0 || TargetShieldAfter < 0)
        {
            throw new InvalidOperationException(
                "A committed damage event cannot report negative target resources.");
        }

        if (!postState.TryGetValue(TargetHpResourceId, out var targetHp) ||
            targetHp.Value != TargetHpAfter)
        {
            throw new InvalidOperationException(
                "DamageCommitted.TargetHpAfter must match the committed target HP resource.");
        }

        if (!postState.TryGetValue(TargetShieldResourceId, out var targetShield) ||
            targetShield.Value != TargetShieldAfter)
        {
            throw new InvalidOperationException(
                "DamageCommitted.TargetShieldAfter must match the committed target shield resource.");
        }
    }

    internal override void ValidateStateTransition(
        IReadOnlyDictionary<EntityId, VersionedResourceState> preState,
        IReadOnlyDictionary<EntityId, VersionedResourceState> postState)
    {
        base.ValidateStateTransition(preState, postState);

        if (!preState.TryGetValue(TargetHpResourceId, out var hpBefore) ||
            !postState.TryGetValue(TargetHpResourceId, out var hpAfter) ||
            !preState.TryGetValue(TargetShieldResourceId, out var shieldBefore) ||
            !postState.TryGetValue(TargetShieldResourceId, out var shieldAfter))
        {
            throw new InvalidOperationException(
                "DamageCommitted must reference committed HP and shield resources.");
        }

        ValidateDamageResourceTransition(
            hpBefore,
            hpAfter,
            Result.FinalHpDamage,
            "FinalHpDamage");
        ValidateDamageResourceTransition(
            shieldBefore,
            shieldAfter,
            Result.ShieldAbsorbed,
            "ShieldAbsorbed");
    }

    private static void ValidateDamageResourceTransition(
        VersionedResourceState before,
        VersionedResourceState after,
        int reportedDecrease,
        string factName)
    {
        if (before.Value - after.Value != reportedDecrease)
        {
            throw new InvalidOperationException(
                $"DamageCommitted.{factName} must match the committed resource decrease.");
        }

        if (reportedDecrease == 0)
        {
            if (after.Version != before.Version)
            {
                throw new InvalidOperationException(
                    $"A zero {factName} must not advance the resource version.");
            }

            return;
        }

        if (before.Version == long.MaxValue ||
            after.Version != before.Version + 1)
        {
            throw new InvalidOperationException(
                $"A positive {factName} must advance the resource version exactly once.");
        }
    }
}

public sealed record CommittedOutboxEvent
{
    public CommittedOutboxEvent(long sequence, DomainEvent @event)
    {
        if (sequence <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(sequence));
        }

        ArgumentNullException.ThrowIfNull(@event);
        @event.ValidateContract();
        Sequence = sequence;
        Event = @event;
    }

    public long Sequence { get; }

    public DomainEvent Event { get; }
}

public sealed class CommitPlan
{
    public CommitPlan(
        EntityId commandId,
        IEnumerable<VersionPrecondition> preconditions,
        IEnumerable<StateMutation> mutations,
        IEnumerable<DomainEvent>? outboxEvents = null)
    {
        EntityId.ThrowIfInvalid(commandId, nameof(commandId));

        var preconditionCopy = preconditions?.ToArray() ??
            throw new ArgumentNullException(nameof(preconditions));
        var mutationCopy = mutations?.ToArray() ??
            throw new ArgumentNullException(nameof(mutations));
        var outboxCopy = (outboxEvents ?? Enumerable.Empty<DomainEvent>()).ToArray();

        if (preconditionCopy.Any(item => !item.ResourceId.IsValid))
        {
            throw new ArgumentException(
                "Commit preconditions must contain initialized resource IDs.",
                nameof(preconditions));
        }

        if (mutationCopy.Any(item => item is null))
        {
            throw new ArgumentException(
                "Commit mutations cannot contain null values.",
                nameof(mutations));
        }

        foreach (var @event in outboxCopy)
        {
            ArgumentNullException.ThrowIfNull(@event, nameof(outboxEvents));
            @event.ValidateContract();
        }

        if (mutationCopy.Length == 0)
        {
            throw new ArgumentException(
                "A commit plan must contain at least one mutation.",
                nameof(mutations));
        }

        if (preconditionCopy.Any(item => item.ExpectedVersion < 0))
        {
            throw new ArgumentOutOfRangeException(
                nameof(preconditions),
                "Expected versions cannot be negative.");
        }

        EnsureUniqueIds(
            preconditionCopy.Select(item => item.ResourceId),
            nameof(preconditions),
            "resource");
        EnsureUniqueIds(
            mutationCopy.Select(item => item.ResourceId),
            nameof(mutations),
            "resource");
        EnsureUniqueIds(
            outboxCopy.Select(item => item.EventId),
            nameof(outboxEvents),
            "event");

        var preconditionResources = preconditionCopy
            .Select(item => item.ResourceId)
            .ToHashSet();
        var mutationResources = mutationCopy
            .Select(item => item.ResourceId)
            .ToHashSet();

        if (!mutationResources.IsSubsetOf(preconditionResources))
        {
            throw new ArgumentException(
                "Every mutated resource must have exactly one version precondition.");
        }

        if (outboxCopy.Any(item => item.CommandId != commandId))
        {
            throw new ArgumentException(
                "Every outbox event must belong to the plan command.",
                nameof(outboxEvents));
        }

        CommandId = commandId;
        Preconditions = Array.AsReadOnly(preconditionCopy);
        Mutations = Array.AsReadOnly(mutationCopy);
        OutboxEvents = Array.AsReadOnly(outboxCopy);
    }

    public EntityId CommandId { get; }

    public ReadOnlyCollection<VersionPrecondition> Preconditions { get; }

    public ReadOnlyCollection<StateMutation> Mutations { get; }

    public ReadOnlyCollection<DomainEvent> OutboxEvents { get; }

    private static void EnsureUniqueIds(
        IEnumerable<EntityId> ids,
        string parameterName,
        string kind)
    {
        var seen = new HashSet<EntityId>();
        if (ids.Any(id => !seen.Add(id)))
        {
            throw new ArgumentException(
                $"A commit plan can mention each {kind} ID only once.",
                parameterName);
        }
    }
}

public enum CommitStatus
{
    Committed,
    DuplicateCommand,
    PreconditionFailed
}

public sealed record CommitReceipt
{
    private CommitReceipt(
        CommitStatus status,
        EntityId commandId,
        IEnumerable<CommittedOutboxEvent> outboxEvents)
    {
        if (!Enum.IsDefined(status))
        {
            throw new ArgumentOutOfRangeException(nameof(status));
        }

        EntityId.ThrowIfInvalid(commandId, nameof(commandId));

        var outboxCopy = outboxEvents?.ToArray() ??
            throw new ArgumentNullException(nameof(outboxEvents));
        if (status != CommitStatus.Committed && outboxCopy.Length != 0)
        {
            throw new ArgumentException(
                "A non-committed receipt cannot expose outbox events.",
                nameof(outboxEvents));
        }

        Status = status;
        CommandId = commandId;
        OutboxEvents = Array.AsReadOnly(outboxCopy);
    }

    public CommitStatus Status { get; }

    public EntityId CommandId { get; }

    public ReadOnlyCollection<CommittedOutboxEvent> OutboxEvents { get; }

    public static CommitReceipt Committed(
        EntityId commandId,
        IEnumerable<CommittedOutboxEvent> outboxEvents) =>
        new(CommitStatus.Committed, commandId, outboxEvents);

    public static CommitReceipt Empty(
        CommitStatus status,
        EntityId commandId)
    {
        if (status == CommitStatus.Committed)
        {
            throw new ArgumentException(
                "Committed receipts must use the Committed factory.",
                nameof(status));
        }

        return new(status, commandId, Array.Empty<CommittedOutboxEvent>());
    }
}

public interface IRuntimeCommitter
{
    CommitReceipt Commit(CommitPlan plan);
}

public sealed class InMemoryRuntimeCommitter : IRuntimeCommitter
{
    private readonly object _gate = new();
    private Dictionary<EntityId, VersionedResourceState> _state;
    private HashSet<EntityId> _committedCommands = new();
    private List<CommittedOutboxEvent> _outbox = new();
    private long _nextOutboxSequence = 1;

    public InMemoryRuntimeCommitter(
        IEnumerable<VersionedResourceState>? initialState = null)
    {
        var stateCopy = (initialState ?? Enumerable.Empty<VersionedResourceState>())
            .ToArray();
        if (stateCopy.Any(item => !item.ResourceId.IsValid))
        {
            throw new ArgumentException(
                "Initial resource states must contain initialized resource IDs.",
                nameof(initialState));
        }

        if (stateCopy.Any(item => item.Value < 0 || item.Version < 0))
        {
            throw new ArgumentOutOfRangeException(
                nameof(initialState),
                "Resource values and versions cannot be negative.");
        }

        _state = stateCopy.ToDictionary(item => item.ResourceId);
    }

    public CommitReceipt Commit(CommitPlan plan)
    {
        ArgumentNullException.ThrowIfNull(plan);

        lock (_gate)
        {
            // Idempotency is checked first so a replay remains a duplicate even
            // though the first commit already advanced resource versions.
            if (_committedCommands.Contains(plan.CommandId))
            {
                return EmptyReceipt(CommitStatus.DuplicateCommand, plan.CommandId);
            }

            foreach (var precondition in plan.Preconditions)
            {
                var current = GetStateUnsafe(precondition.ResourceId);
                if (current.Version != precondition.ExpectedVersion)
                {
                    return EmptyReceipt(CommitStatus.PreconditionFailed, plan.CommandId);
                }
            }

            // All potentially rejecting work happens against copies. State,
            // command idempotency, and outbox become visible in one lock scope.
            var nextState = new Dictionary<EntityId, VersionedResourceState>(_state);
            foreach (var mutation in plan.Mutations)
            {
                var current = GetStateUnsafe(mutation.ResourceId);
                if (current.Version == long.MaxValue)
                {
                    throw new OverflowException(
                        $"Resource version cannot advance beyond Int64.MaxValue: {mutation.ResourceId}.");
                }

                nextState[mutation.ResourceId] = new VersionedResourceState(
                    mutation.ResourceId,
                    mutation.NewValue,
                    checked(current.Version + 1));
            }

            // 상태에서 파생된 이벤트 사실은 같은 커밋의 사후 상태와 일치할 때만 발행한다.
            foreach (var @event in plan.OutboxEvents)
            {
                @event.ValidateStateTransition(_state, nextState);
            }

            var committedEvents = plan.OutboxEvents
                .Select((item, index) => new CommittedOutboxEvent(
                    checked(_nextOutboxSequence + index),
                    item))
                .ToArray();
            var nextOutboxSequence = checked(
                _nextOutboxSequence + committedEvents.LongLength);
            var nextOutbox = new List<CommittedOutboxEvent>(_outbox);
            nextOutbox.AddRange(committedEvents);
            var nextCommittedCommands = new HashSet<EntityId>(_committedCommands)
            {
                plan.CommandId
            };

            _state = nextState;
            _outbox = nextOutbox;
            _committedCommands = nextCommittedCommands;
            _nextOutboxSequence = nextOutboxSequence;

            return CommitReceipt.Committed(
                plan.CommandId,
                Array.AsReadOnly(committedEvents));
        }
    }

    public long GetValue(EntityId resourceId)
    {
        EntityId.ThrowIfInvalid(resourceId, nameof(resourceId));

        lock (_gate)
        {
            return GetStateUnsafe(resourceId).Value;
        }
    }

    public long GetVersion(EntityId resourceId)
    {
        EntityId.ThrowIfInvalid(resourceId, nameof(resourceId));

        lock (_gate)
        {
            return GetStateUnsafe(resourceId).Version;
        }
    }

    public IReadOnlyList<CommittedOutboxEvent> GetOutbox()
    {
        lock (_gate)
        {
            return Array.AsReadOnly(_outbox.ToArray());
        }
    }

    private static CommitReceipt EmptyReceipt(
        CommitStatus status,
        EntityId commandId) =>
        CommitReceipt.Empty(status, commandId);

    private VersionedResourceState GetStateUnsafe(EntityId resourceId) =>
        _state.TryGetValue(resourceId, out var state)
            ? state
            : new VersionedResourceState(resourceId, 0, 0);
}

public sealed class DeterministicBoundedReactionQueue : IReactionQueue
{
    private readonly object _gate = new();
    private readonly int _maxReactions;
    private readonly int _maxDepth;
    private readonly int _maxBudget;
    private readonly Action<ReactionCommand> _dispatch;
    private readonly List<ReactionCommand> _pending = new();
    private readonly HashSet<EntityId> _knownIdempotencyKeys = new();
    private int _pendingBudget;
    private bool _isDraining;
    private int _activeMaxReactions;
    private int _activeMaxDepth;
    private int _activeMaxBudget;
    private int _activeAcceptedCount;
    private int _activeAcceptedBudget;
    private int _activeDispatchDepth = -1;
    private Exception? _activeFailure;

    public DeterministicBoundedReactionQueue(
        int maxReactions,
        int maxDepth,
        int maxBudget,
        Action<ReactionCommand> dispatch)
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

        _maxReactions = maxReactions;
        _maxDepth = maxDepth;
        _maxBudget = maxBudget;
        _dispatch = dispatch ?? throw new ArgumentNullException(nameof(dispatch));
    }

    public int PendingBudget
    {
        get
        {
            lock (_gate)
            {
                return _pendingBudget;
            }
        }
    }

    public int PendingCount
    {
        get
        {
            lock (_gate)
            {
                return _pending.Count;
            }
        }
    }

    public void Enqueue(ReactionCommand command)
    {
        ArgumentNullException.ThrowIfNull(command);

        lock (_gate)
        {
            if (_knownIdempotencyKeys.Contains(command.IdempotencyKey))
            {
                return;
            }

            var acceptedCommand = command;
            if (_isDraining)
            {
                if (_activeDispatchDepth < 0)
                {
                    throw CreateLimitExceptionUnsafe(
                        "A child reaction can be enqueued only while a parent is being dispatched.");
                }

                if (_activeDispatchDepth == int.MaxValue)
                {
                    throw CreateLimitExceptionUnsafe(
                        "Reaction depth cannot advance beyond Int32.MaxValue.");
                }

                // Child depth belongs to the queue's causal traversal. A handler
                // cannot bypass MaxDepth by submitting a forged lower value.
                acceptedCommand = command.WithDepth(_activeDispatchDepth + 1);
            }

            var maxDepth = _isDraining ? _activeMaxDepth : _maxDepth;
            if (acceptedCommand.Depth > maxDepth)
            {
                throw CreateLimitExceptionUnsafe(
                    $"Reaction depth {acceptedCommand.Depth} exceeds {maxDepth}.");
            }

            var acceptedCount = _isDraining
                ? _activeAcceptedCount
                : _pending.Count;
            var maxReactions = _isDraining
                ? _activeMaxReactions
                : _maxReactions;
            if (acceptedCount >= maxReactions)
            {
                throw CreateLimitExceptionUnsafe(
                    $"Reaction count limit {maxReactions} was reached.");
            }

            var acceptedBudget = _isDraining
                ? _activeAcceptedBudget
                : _pendingBudget;
            var maxBudget = _isDraining
                ? _activeMaxBudget
                : _maxBudget;
            if ((long)acceptedBudget + acceptedCommand.BudgetCost > maxBudget)
            {
                throw CreateLimitExceptionUnsafe(
                    $"Reaction budget limit {maxBudget} would be exceeded.");
            }

            _pending.Add(acceptedCommand);
            _knownIdempotencyKeys.Add(acceptedCommand.IdempotencyKey);
            _pendingBudget += acceptedCommand.BudgetCost;
            if (_isDraining)
            {
                _activeAcceptedCount++;
                _activeAcceptedBudget += acceptedCommand.BudgetCost;
            }
        }
    }

    public int Drain(ReactionBudget budget)
    {
        ArgumentNullException.ThrowIfNull(budget);

        lock (_gate)
        {
            if (_isDraining)
            {
                var exception = new InvalidOperationException(
                    "A reaction causation wave cannot be drained recursively.");
                _activeFailure ??= exception;
                throw exception;
            }

            if (_pending.Count == 0)
            {
                return 0;
            }

            BeginWaveUnsafe(budget);
            var drainedCount = 0;
            try
            {
                ValidateWaveFitsBoundsUnsafe();
                while (_pending.Count > 0)
                {
                    var next = _pending
                        .OrderBy(item => item.Priority)
                        .ThenBy(item => item.StableOrderKey)
                        .ThenBy(item => item.ReactionId)
                        .First();

                    _pending.Remove(next);
                    _pendingBudget -= next.BudgetCost;
                    _activeDispatchDepth = next.Depth;
                    try
                    {
                        _dispatch(next);
                    }
                    finally
                    {
                        _activeDispatchDepth = -1;
                    }
                    drainedCount++;

                    if (_activeFailure is not null)
                    {
                        throw new InvalidOperationException(
                            "The reaction causation wave exceeded its bounds during dispatch.",
                            _activeFailure);
                    }
                }

                return drainedCount;
            }
            catch
            {
                // Fail fast: commands not yet dispatched in this causation wave are
                // discarded and keep their idempotency keys. They cannot leak into a
                // later Drain call after a bound or handler failure.
                _pending.Clear();
                _pendingBudget = 0;
                throw;
            }
            finally
            {
                EndWaveUnsafe();
            }
        }
    }

    private void BeginWaveUnsafe(ReactionBudget budget)
    {
        _isDraining = true;
        _activeMaxReactions = Math.Min(_maxReactions, budget.MaxReactions);
        _activeMaxDepth = Math.Min(_maxDepth, budget.MaxDepth);
        _activeMaxBudget = Math.Min(_maxBudget, budget.MaxBudget);
        _activeAcceptedCount = _pending.Count;
        _activeAcceptedBudget = _pendingBudget;
        _activeFailure = null;
    }

    private void ValidateWaveFitsBoundsUnsafe()
    {
        if (_activeAcceptedCount > _activeMaxReactions)
        {
            throw new InvalidOperationException(
                $"The reaction causation wave contains {_activeAcceptedCount} commands, " +
                $"which exceeds the drain limit {_activeMaxReactions}.");
        }

        if (_activeAcceptedBudget > _activeMaxBudget)
        {
            throw new InvalidOperationException(
                $"The reaction causation wave costs {_activeAcceptedBudget}, " +
                $"which exceeds the drain budget {_activeMaxBudget}.");
        }

        var excessiveDepth = _pending
            .Select(item => item.Depth)
            .DefaultIfEmpty(0)
            .Max();
        if (excessiveDepth > _activeMaxDepth)
        {
            throw new InvalidOperationException(
                $"The reaction causation wave reaches depth {excessiveDepth}, " +
                $"which exceeds the drain depth {_activeMaxDepth}.");
        }
    }

    private InvalidOperationException CreateLimitExceptionUnsafe(string message)
    {
        var exception = new InvalidOperationException(message);
        if (_isDraining)
        {
            _activeFailure ??= exception;
        }

        return exception;
    }

    private void EndWaveUnsafe()
    {
        _isDraining = false;
        _activeMaxReactions = 0;
        _activeMaxDepth = 0;
        _activeMaxBudget = 0;
        _activeAcceptedCount = 0;
        _activeAcceptedBudget = 0;
        _activeDispatchDepth = -1;
        _activeFailure = null;
    }
}
