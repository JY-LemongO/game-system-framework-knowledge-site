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

public sealed record StatusResult(
    bool Succeeded,
    EntityId? StatusInstanceId,
    StatusRemoveReason? RemoveReason = null);

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
