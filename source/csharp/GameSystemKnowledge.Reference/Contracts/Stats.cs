namespace GameSystemKnowledge.Reference.Contracts;

public sealed class StatContext
{
    public StatContext(
        EntityId ownerId,
        EntityId? targetId,
        EntityId? skillId,
        IEnumerable<string>? skillTags = null,
        IEnumerable<string>? targetTags = null,
        IEnumerable<EntityId>? targetStatuses = null,
        decimal distance = 0m,
        string moment = "default")
    {
        EntityId.ThrowIfInvalid(ownerId, nameof(ownerId));
        if (targetId.HasValue)
        {
            EntityId.ThrowIfInvalid(targetId.Value, nameof(targetId));
        }

        if (skillId.HasValue)
        {
            EntityId.ThrowIfInvalid(skillId.Value, nameof(skillId));
        }

        if (distance < 0m)
        {
            throw new ArgumentOutOfRangeException(nameof(distance));
        }

        if (string.IsNullOrWhiteSpace(moment))
        {
            throw new ArgumentException("A stat query moment is required.", nameof(moment));
        }

        var skillTagSet = skillTags is null
            ? TagSet.Empty
            : new TagSet(skillTags);
        var targetTagSet = targetTags is null
            ? TagSet.Empty
            : new TagSet(targetTags);
        var targetStatusCopy = (targetStatuses ?? Enumerable.Empty<EntityId>()).ToArray();
        if (targetStatusCopy.Any(statusId => !statusId.IsValid))
        {
            throw new ArgumentException(
                "Stat context status IDs must be initialized.",
                nameof(targetStatuses));
        }

        OwnerId = ownerId;
        TargetId = targetId;
        SkillId = skillId;
        SkillTags = skillTagSet;
        TargetTags = targetTagSet;
        TargetStatuses = Array.AsReadOnly(targetStatusCopy);
        Distance = distance;
        Moment = moment;
    }

    public EntityId OwnerId { get; }

    public EntityId? TargetId { get; }

    public EntityId? SkillId { get; }

    public TagSet SkillTags { get; }

    public TagSet TargetTags { get; }

    public IReadOnlyList<EntityId> TargetStatuses { get; }

    public decimal Distance { get; }

    public string Moment { get; }

}

public interface IStatQuery
{
    decimal GetValue(
        EntityId ownerId,
        EntityId statId,
        StatContext context);
}

public enum ModifierOperation
{
    Add,
    PercentAdd,
    More,
    Less,
    Override
}

public interface IModifierCondition
{
    bool Evaluate(StatContext context);
}

public sealed class StatModifier
{
    public StatModifier(
        EntityId modifierId,
        EntityId statId,
        ModifierOperation operation,
        decimal value,
        SourceRef source,
        int priority,
        EntityId stackRuleId,
        IModifierCondition? condition = null)
    {
        EntityId.ThrowIfInvalid(modifierId, nameof(modifierId));
        EntityId.ThrowIfInvalid(statId, nameof(statId));
        SourceRef.ThrowIfInvalid(source, nameof(source));
        EntityId.ThrowIfInvalid(stackRuleId, nameof(stackRuleId));

        if (!Enum.IsDefined(operation))
        {
            throw new ArgumentOutOfRangeException(nameof(operation));
        }

        // 비율 operation은 음수 배율이나 100% 초과 감소를 만들지 못하게 막는다.
        switch (operation)
        {
            case ModifierOperation.PercentAdd when value < -1m:
                throw new ArgumentOutOfRangeException(
                    nameof(value),
                    "PercentAdd cannot reduce its input below zero by itself.");
            case ModifierOperation.More when value < 0m:
                throw new ArgumentOutOfRangeException(
                    nameof(value),
                    "More requires a non-negative ratio.");
            case ModifierOperation.Less when value is < 0m or > 1m:
                throw new ArgumentOutOfRangeException(
                    nameof(value),
                    "Less must be between zero and one.");
        }

        ModifierId = modifierId;
        StatId = statId;
        Operation = operation;
        Value = value;
        Source = source;
        Priority = priority;
        StackRuleId = stackRuleId;
        Condition = condition;
    }

    public EntityId ModifierId { get; }

    public EntityId StatId { get; }

    public ModifierOperation Operation { get; }

    public decimal Value { get; }

    public SourceRef Source { get; }

    public int Priority { get; }

    public EntityId StackRuleId { get; }

    public IModifierCondition? Condition { get; }

    public EntityId? StatusInstanceId => Source.StatusInstanceId;

    public bool AppliesTo(StatContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        return Condition?.Evaluate(context) ?? true;
    }
}
