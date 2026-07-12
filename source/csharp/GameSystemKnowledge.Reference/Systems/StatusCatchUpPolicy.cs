using GameSystemKnowledge.Reference.Contracts;

namespace GameSystemKnowledge.Reference.Systems;

public static class StatusCatchUpPolicy
{
    public static StatusCatchUpResult Evaluate(
        long currentTick,
        long expiresAtTick,
        int dueTickCount,
        int maxCatchUpTicks)
    {
        if (currentTick < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(currentTick));
        }

        if (expiresAtTick < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(expiresAtTick));
        }

        if (dueTickCount < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(dueTickCount));
        }

        if (maxCatchUpTicks <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maxCatchUpTicks));
        }

        var ticksToExecute = Math.Min(dueTickCount, maxCatchUpTicks);
        if (dueTickCount > maxCatchUpTicks)
        {
            if (expiresAtTick <= currentTick)
            {
                return new StatusCatchUpResult(
                    ticksToExecute,
                    StatusCatchUpAction.CloseExpiredStatus,
                    StatusRemoveReason.CatchUpLimited);
            }

            return new StatusCatchUpResult(
                ticksToExecute,
                StatusCatchUpAction.DeferRemainingTicks,
                null);
        }

        if (expiresAtTick <= currentTick)
        {
            return new StatusCatchUpResult(
                ticksToExecute,
                StatusCatchUpAction.CloseExpiredStatus,
                StatusRemoveReason.Expired);
        }

        return new StatusCatchUpResult(
            ticksToExecute,
            StatusCatchUpAction.ExecuteDueTicks,
            null);
    }
}
