namespace GameSystemKnowledge.Reference.Contracts;

public sealed class ApplyStatusRequest
{
    public ApplyStatusRequest(
        EntityId statusId,
        EntityId targetId,
        SourceRef source,
        int stackDelta)
    {
        if (stackDelta == 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(stackDelta),
                "A status application must change the stack count.");
        }

        StatusId = statusId;
        TargetId = targetId;
        Source = source;
        StackDelta = stackDelta;
    }

    public EntityId StatusId { get; }

    public EntityId TargetId { get; }

    public SourceRef Source { get; }

    public int StackDelta { get; }
}

public sealed class StatusResult
{
    private StatusResult(
        bool succeeded,
        EntityId? statusInstanceId,
        StatusRemoveReason? removeReason,
        StatusFailureReason? failureReason)
    {
        Succeeded = succeeded;
        StatusInstanceId = statusInstanceId;
        RemoveReason = removeReason;
        FailureReason = failureReason;
    }

    public bool Succeeded { get; }

    public EntityId? StatusInstanceId { get; }

    public StatusRemoveReason? RemoveReason { get; }

    public StatusFailureReason? FailureReason { get; }

    public static StatusResult Applied(EntityId instanceId) =>
        new(true, instanceId, null, null);

    public static StatusResult Removed(
        EntityId instanceId,
        StatusRemoveReason reason) =>
        new(true, instanceId, reason, null);

    public static StatusResult Failed(StatusFailureReason reason) =>
        new(false, null, null, reason);
}

public interface IStatusService
{
    StatusResult Apply(ApplyStatusRequest request);

    StatusResult Remove(
        EntityId instanceId,
        StatusRemoveReason reason);

    void AdvanceTo(long simulationTick);
}

public enum StatusRemoveReason
{
    Expired,
    CatchUpLimited,
    Dispelled
}

public enum StatusFailureReason
{
    NotFound,
    Immune,
    StackPolicyRejected
}

public enum StatusCatchUpAction
{
    ExecuteDueTicks,
    DeferRemainingTicks,
    CloseExpiredStatus
}

public sealed record StatusCatchUpResult(
    int TicksToExecute,
    StatusCatchUpAction Action,
    StatusRemoveReason? RemoveReason);
