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
    SourceRef Source);

public sealed record SkillCommitted(
    EntityId EventId,
    EntityId CommandId,
    EntityId CasterId,
    EntityId SkillId,
    EntityId? TargetId,
    SourceRef Source)
    : DomainEvent(EventId, CommandId, Source);

public sealed record DamageCommitted(
    EntityId EventId,
    EntityId CommandId,
    EntityId AttackerId,
    EntityId DefenderId,
    SourceRef Source,
    DamageResult Result,
    long TargetHpAfter)
    : DomainEvent(EventId, CommandId, Source);

public sealed record CommittedOutboxEvent(
    long Sequence,
    DomainEvent Event);

public sealed class CommitPlan
{
    public CommitPlan(
        EntityId commandId,
        IEnumerable<VersionPrecondition> preconditions,
        IEnumerable<StateMutation> mutations,
        IEnumerable<DomainEvent>? outboxEvents = null)
    {
        var preconditionCopy = preconditions?.ToArray() ??
            throw new ArgumentNullException(nameof(preconditions));
        var mutationCopy = mutations?.ToArray() ??
            throw new ArgumentNullException(nameof(mutations));
        var outboxCopy = (outboxEvents ?? Enumerable.Empty<DomainEvent>()).ToArray();

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

        if (!preconditionResources.SetEquals(mutationResources))
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

public sealed record CommitReceipt(
    CommitStatus Status,
    EntityId CommandId,
    IReadOnlyList<CommittedOutboxEvent> OutboxEvents);

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
                nextState[mutation.ResourceId] = new VersionedResourceState(
                    mutation.ResourceId,
                    mutation.NewValue,
                    current.Version + 1);
            }

            var committedEvents = plan.OutboxEvents
                .Select((item, index) => new CommittedOutboxEvent(
                    _nextOutboxSequence + index,
                    item))
                .ToArray();
            var nextOutbox = new List<CommittedOutboxEvent>(_outbox);
            nextOutbox.AddRange(committedEvents);
            var nextCommittedCommands = new HashSet<EntityId>(_committedCommands)
            {
                plan.CommandId
            };

            _state = nextState;
            _outbox = nextOutbox;
            _committedCommands = nextCommittedCommands;
            _nextOutboxSequence += committedEvents.Length;

            return new CommitReceipt(
                CommitStatus.Committed,
                plan.CommandId,
                Array.AsReadOnly(committedEvents));
        }
    }

    public long GetValue(EntityId resourceId)
    {
        lock (_gate)
        {
            return GetStateUnsafe(resourceId).Value;
        }
    }

    public long GetVersion(EntityId resourceId)
    {
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
        new(status, commandId, Array.Empty<CommittedOutboxEvent>());

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

            var maxDepth = _isDraining ? _activeMaxDepth : _maxDepth;
            if (command.Depth > maxDepth)
            {
                throw CreateLimitExceptionUnsafe(
                    $"Reaction depth {command.Depth} exceeds {maxDepth}.");
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
            if ((long)acceptedBudget + command.BudgetCost > maxBudget)
            {
                throw CreateLimitExceptionUnsafe(
                    $"Reaction budget limit {maxBudget} would be exceeded.");
            }

            _pending.Add(command);
            _knownIdempotencyKeys.Add(command.IdempotencyKey);
            _pendingBudget += command.BudgetCost;
            if (_isDraining)
            {
                _activeAcceptedCount++;
                _activeAcceptedBudget += command.BudgetCost;
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
                    _dispatch(next);
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
        _activeFailure = null;
    }
}
