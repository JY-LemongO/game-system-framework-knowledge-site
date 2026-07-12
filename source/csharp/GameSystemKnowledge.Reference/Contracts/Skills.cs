namespace GameSystemKnowledge.Reference.Contracts;

public sealed class SkillRequest
{
    public SkillRequest(
        EntityId casterId,
        EntityId skillId,
        EntityId? targetId,
        long requestedTick,
        uint rootSeed)
    {
        if (requestedTick < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(requestedTick));
        }

        CasterId = casterId;
        SkillId = skillId;
        TargetId = targetId;
        RequestedTick = requestedTick;
        RootSeed = rootSeed;
    }

    public EntityId CasterId { get; }

    public EntityId SkillId { get; }

    public EntityId? TargetId { get; }

    public long RequestedTick { get; }

    public uint RootSeed { get; }
}

public enum SkillFailureReason
{
    NotLearned,
    OutOfResource,
    Cooldown,
    ControlLocked,
    InvalidTarget,
    Interrupted
}

public readonly record struct SkillDecision
{
    public SkillDecision(bool canExecute, SkillFailureReason? failureReason)
    {
        if (canExecute && failureReason is not null)
        {
            throw new ArgumentException(
                "An accepted skill request cannot have a failure reason.",
                nameof(failureReason));
        }

        if (!canExecute && failureReason is null)
        {
            throw new ArgumentException(
                "A rejected skill request must have a failure reason.",
                nameof(failureReason));
        }

        CanExecute = canExecute;
        FailureReason = failureReason;
    }

    public bool CanExecute { get; }

    public SkillFailureReason? FailureReason { get; }

    public static SkillDecision Accepted() => new(true, null);

    public static SkillDecision Rejected(SkillFailureReason reason) =>
        new(false, reason);
}

public interface ISkillRequestValidator
{
    SkillDecision Validate(SkillRequest request);
}

public sealed class SkillResult
{
    public SkillResult(
        bool succeeded,
        SkillFailureReason? failureReason,
        IEnumerable<EffectResult>? effects = null)
    {
        if (succeeded && failureReason is not null)
        {
            throw new ArgumentException(
                "A successful skill result cannot have a failure reason.",
                nameof(failureReason));
        }

        if (!succeeded && failureReason is null)
        {
            throw new ArgumentException(
                "A failed skill result must have a failure reason.",
                nameof(failureReason));
        }

        Succeeded = succeeded;
        FailureReason = failureReason;
        Effects = Array.AsReadOnly(
            (effects ?? Enumerable.Empty<EffectResult>()).ToArray());
    }

    public bool Succeeded { get; }

    public SkillFailureReason? FailureReason { get; }

    public IReadOnlyList<EffectResult> Effects { get; }
}
