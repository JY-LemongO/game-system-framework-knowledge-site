namespace GameSystemKnowledge.Reference.Contracts;

public sealed class SkillRequest
{
    public SkillRequest(
        EntityId commandId,
        EntityId casterId,
        EntityId skillId,
        EntityId? targetId,
        long requestedTick,
        uint rootSeed)
    {
        EntityId.ThrowIfInvalid(commandId, nameof(commandId));
        EntityId.ThrowIfInvalid(casterId, nameof(casterId));
        EntityId.ThrowIfInvalid(skillId, nameof(skillId));
        if (targetId.HasValue)
        {
            EntityId.ThrowIfInvalid(targetId.Value, nameof(targetId));
        }

        if (requestedTick < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(requestedTick));
        }

        CommandId = commandId;
        CasterId = casterId;
        SkillId = skillId;
        TargetId = targetId;
        RequestedTick = requestedTick;
        RootSeed = rootSeed;
    }

    public EntityId CommandId { get; }

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

public sealed class SkillDecision
{
    public SkillDecision(bool canExecute, SkillFailureReason? failureReason)
    {
        if (failureReason is { } definedReason &&
            !Enum.IsDefined(definedReason))
        {
            throw new ArgumentOutOfRangeException(nameof(failureReason));
        }

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
        if (failureReason is { } definedReason &&
            !Enum.IsDefined(definedReason))
        {
            throw new ArgumentOutOfRangeException(nameof(failureReason));
        }

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

        var effectCopy = (effects ?? Enumerable.Empty<EffectResult>()).ToArray();
        if (effectCopy.Any(effect => effect is null))
        {
            throw new ArgumentException(
                "Skill effects cannot contain null values.",
                nameof(effects));
        }

        if (!succeeded && effectCopy.Length != 0)
        {
            throw new ArgumentException(
                "A failed skill result cannot expose committed effects.",
                nameof(effects));
        }

        Succeeded = succeeded;
        FailureReason = failureReason;
        Effects = Array.AsReadOnly(effectCopy);
    }

    public bool Succeeded { get; }

    public SkillFailureReason? FailureReason { get; }

    public IReadOnlyList<EffectResult> Effects { get; }
}
