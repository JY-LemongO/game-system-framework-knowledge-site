using GameSystemKnowledge.Reference.Contracts;

namespace GameSystemKnowledge.Reference.Systems;

public sealed class SkillAdmissionSnapshot
{
    public SkillAdmissionSnapshot(
        EntityId targetId,
        long targetHealth,
        long cooldownReadyTick,
        long availableResource)
    {
        EntityId.ThrowIfInvalid(targetId, nameof(targetId));

        if (targetHealth < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(targetHealth));
        }

        if (cooldownReadyTick < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(cooldownReadyTick));
        }

        if (availableResource < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(availableResource));
        }

        TargetId = targetId;
        TargetHealth = targetHealth;
        CooldownReadyTick = cooldownReadyTick;
        AvailableResource = availableResource;
    }

    public EntityId TargetId { get; }

    public long TargetHealth { get; }

    public long CooldownReadyTick { get; }

    public long AvailableResource { get; }
}

public static class SkillAdmissionPolicy
{
    public static SkillDecision Evaluate(
        SkillRequest request,
        SkillAdmissionSnapshot snapshot,
        long resourceCost)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(snapshot);

        if (resourceCost < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(resourceCost));
        }

        // 외부에 드러나는 실패 사유는 대상, 쿨다운, 자원 순서로 하나만 고른다.
        if (request.TargetId is not { } targetId ||
            targetId != snapshot.TargetId ||
            snapshot.TargetHealth == 0)
        {
            return SkillDecision.Rejected(SkillFailureReason.InvalidTarget);
        }

        if (snapshot.CooldownReadyTick > request.RequestedTick)
        {
            return SkillDecision.Rejected(SkillFailureReason.Cooldown);
        }

        if (snapshot.AvailableResource < resourceCost)
        {
            return SkillDecision.Rejected(SkillFailureReason.OutOfResource);
        }

        return SkillDecision.Accepted();
    }
}
