using GameSystemKnowledge.Reference.Contracts;

namespace GameSystemKnowledge.Reference.Systems;

public sealed class LiveTargetSnapshot
{
    public LiveTargetSnapshot(
        EntityId targetId,
        long currentHealth,
        long healthVersion)
    {
        EntityId.ThrowIfInvalid(targetId, nameof(targetId));

        if (currentHealth < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(currentHealth));
        }

        if (healthVersion < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(healthVersion));
        }

        TargetId = targetId;
        CurrentHealth = currentHealth;
        HealthVersion = healthVersion;
    }

    public EntityId TargetId { get; }

    public long CurrentHealth { get; }

    public long HealthVersion { get; }
}

public enum StatusReactionDisposition
{
    ReadyToApply,
    NotApplicable
}

public sealed class StatusReactionDecision
{
    private StatusReactionDecision(
        StatusReactionDisposition disposition,
        ApplyStatusRequest? request,
        long observedTargetVersion)
    {
        Disposition = disposition;
        Request = request;
        ObservedTargetVersion = observedTargetVersion;
    }

    public StatusReactionDisposition Disposition { get; }

    public ApplyStatusRequest? Request { get; }

    public long ObservedTargetVersion { get; }

    public bool IsTerminal =>
        Disposition == StatusReactionDisposition.NotApplicable;

    internal static StatusReactionDecision Ready(
        ApplyStatusRequest request,
        long observedTargetVersion) =>
        new(
            StatusReactionDisposition.ReadyToApply,
            request ?? throw new ArgumentNullException(nameof(request)),
            observedTargetVersion);

    internal static StatusReactionDecision NotApplicable(
        long observedTargetVersion) =>
        new(
            StatusReactionDisposition.NotApplicable,
            null,
            observedTargetVersion);
}

public static class LiveTargetStatusReactionPolicy
{
    public static StatusReactionDecision Evaluate(
        ReactionCommand reaction,
        LiveTargetSnapshot liveTarget,
        EntityId statusId,
        int stackDelta)
    {
        ArgumentNullException.ThrowIfNull(reaction);
        ArgumentNullException.ThrowIfNull(liveTarget);
        EntityId.ThrowIfInvalid(statusId, nameof(statusId));

        if (stackDelta <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(stackDelta));
        }

        if (reaction.TargetId != liveTarget.TargetId)
        {
            throw new ArgumentException(
                "The live target snapshot must describe the reaction target.",
                nameof(liveTarget));
        }

        // 커밋 이후 사망은 정상적인 종결 결과이며 상태 적용 요청을 만들지 않는다.
        if (liveTarget.CurrentHealth == 0)
        {
            return StatusReactionDecision.NotApplicable(
                liveTarget.HealthVersion);
        }

        return StatusReactionDecision.Ready(
            new ApplyStatusRequest(
                statusId,
                reaction.TargetId,
                reaction.Source,
                stackDelta),
            liveTarget.HealthVersion);
    }
}
