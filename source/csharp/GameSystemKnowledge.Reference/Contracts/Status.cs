namespace GameSystemKnowledge.Reference.Contracts;

public sealed class ApplyStatusRequest
{
    public ApplyStatusRequest(
        EntityId statusId,
        EntityId targetId,
        SourceRef source,
        int stackDelta)
    {
        EntityId.ThrowIfInvalid(statusId, nameof(statusId));
        EntityId.ThrowIfInvalid(targetId, nameof(targetId));
        SourceRef.ThrowIfInvalid(source, nameof(source));

        if (stackDelta <= 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(stackDelta),
                "A status application must add at least one stack. IStatusService.Remove handles whole-instance removal; partial stack decrement requires an explicit product policy.");
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
        new(true, ValidInstanceId(instanceId), null, null);

    public static StatusResult Removed(
        EntityId instanceId,
        StatusRemoveReason reason)
    {
        if (!Enum.IsDefined(reason))
        {
            throw new ArgumentOutOfRangeException(nameof(reason));
        }

        return new(true, ValidInstanceId(instanceId), reason, null);
    }

    public static StatusResult Failed(StatusFailureReason reason)
    {
        if (!Enum.IsDefined(reason))
        {
            throw new ArgumentOutOfRangeException(nameof(reason));
        }

        return new(false, null, null, reason);
    }

    private static EntityId ValidInstanceId(EntityId instanceId)
    {
        EntityId.ThrowIfInvalid(instanceId, nameof(instanceId));
        return instanceId;
    }
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

public sealed class StatusCatchUpResult
{
    public StatusCatchUpResult(
        int ticksToExecute,
        StatusCatchUpAction action,
        StatusRemoveReason? removeReason)
    {
        if (ticksToExecute < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(ticksToExecute));
        }

        if (!Enum.IsDefined(action))
        {
            throw new ArgumentOutOfRangeException(nameof(action));
        }

        if (removeReason is { } definedReason &&
            !Enum.IsDefined(definedReason))
        {
            throw new ArgumentOutOfRangeException(nameof(removeReason));
        }

        // 종료 동작만 명시적인 만료 사유를 가질 수 있다.
        if (action == StatusCatchUpAction.CloseExpiredStatus)
        {
            if (removeReason is not StatusRemoveReason.Expired and
                not StatusRemoveReason.CatchUpLimited)
            {
                throw new ArgumentException(
                    "Closing an expired status requires an expiry reason.",
                    nameof(removeReason));
            }

            if (removeReason == StatusRemoveReason.CatchUpLimited &&
                ticksToExecute == 0)
            {
                throw new ArgumentException(
                    "Limited catch-up closure must execute at least one bounded tick.",
                    nameof(ticksToExecute));
            }
        }
        else if (removeReason is not null)
        {
            throw new ArgumentException(
                "A continuing catch-up action cannot have a removal reason.",
                nameof(removeReason));
        }

        // 지연은 이번 평가에서 실제로 제한분을 처리한 뒤 남은 작업이 있을 때만 성립한다.
        if (action == StatusCatchUpAction.DeferRemainingTicks &&
            ticksToExecute == 0)
        {
            throw new ArgumentException(
                "Deferred catch-up must execute at least one bounded tick.",
                nameof(ticksToExecute));
        }

        TicksToExecute = ticksToExecute;
        Action = action;
        RemoveReason = removeReason;
    }

    public int TicksToExecute { get; }

    public StatusCatchUpAction Action { get; }

    public StatusRemoveReason? RemoveReason { get; }
}
