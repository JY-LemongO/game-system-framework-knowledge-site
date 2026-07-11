using System.Collections.ObjectModel;

namespace GameSystemKnowledge.Reference.Contracts;

public sealed class StatContext
{
    public StatContext(
        EntityId ownerId,
        EntityId? targetId,
        EntityId skillId,
        IEnumerable<string>? skillTags = null,
        IEnumerable<string>? targetTags = null,
        IEnumerable<EntityId>? targetStatuses = null,
        decimal distance = 0m,
        string moment = "default")
    {
        if (distance < 0m)
        {
            throw new ArgumentOutOfRangeException(nameof(distance));
        }

        if (string.IsNullOrWhiteSpace(moment))
        {
            throw new ArgumentException("A stat query moment is required.", nameof(moment));
        }

        var skillTagCopy = CopyTags(skillTags, nameof(skillTags));
        var targetTagCopy = CopyTags(targetTags, nameof(targetTags));
        var targetStatusCopy = (targetStatuses ?? Enumerable.Empty<EntityId>()).ToArray();

        OwnerId = ownerId;
        TargetId = targetId;
        SkillId = skillId;
        SkillTags = Array.AsReadOnly(skillTagCopy);
        TargetTags = Array.AsReadOnly(targetTagCopy);
        TargetStatuses = Array.AsReadOnly(targetStatusCopy);
        Distance = distance;
        Moment = moment;
    }

    public EntityId OwnerId { get; }

    public EntityId? TargetId { get; }

    public EntityId SkillId { get; }

    public ReadOnlyCollection<string> SkillTags { get; }

    public ReadOnlyCollection<string> TargetTags { get; }

    public ReadOnlyCollection<EntityId> TargetStatuses { get; }

    public decimal Distance { get; }

    public string Moment { get; }

    private static string[] CopyTags(
        IEnumerable<string>? tags,
        string parameterName)
    {
        var copy = (tags ?? Enumerable.Empty<string>()).ToArray();
        if (copy.Any(string.IsNullOrWhiteSpace))
        {
            throw new ArgumentException("Stat context tags cannot be empty.", parameterName);
        }

        return copy;
    }
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
