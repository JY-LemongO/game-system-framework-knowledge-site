namespace GameSystemKnowledge.Reference.Contracts;

public readonly record struct EntityId : IComparable<EntityId>
{
    public EntityId(string value)
    {
        if (!TryValidate(value, out var error))
        {
            throw new ArgumentException(error, nameof(value));
        }

        Value = value;
    }

    public string Value { get; }

    public static bool TryCreate(string? value, out EntityId entityId)
    {
        if (!TryValidate(value, out _))
        {
            entityId = default;
            return false;
        }

        entityId = new EntityId(value!);
        return true;
    }

    public int CompareTo(EntityId other) =>
        StringComparer.Ordinal.Compare(Value, other.Value);

    public override string ToString() => Value ?? string.Empty;

    private static bool TryValidate(string? value, out string error)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            error = "An ID cannot be empty.";
            return false;
        }

        var segments = value.Split('.');
        if (segments.Length < 2)
        {
            error = "An ID must be namespaced, for example 'skill.fireball'.";
            return false;
        }

        for (var segmentIndex = 0; segmentIndex < segments.Length; segmentIndex++)
        {
            var segment = segments[segmentIndex];
            var validFirstCharacter = segment.Length > 0 &&
                (IsLowerAsciiLetter(segment[0]) ||
                 (segmentIndex > 0 && char.IsAsciiDigit(segment[0])));
            if (!validFirstCharacter)
            {
                error = segmentIndex == 0
                    ? "The namespace segment must start with a lowercase ASCII letter."
                    : "Local ID segments must start with a lowercase ASCII letter or digit.";
                return false;
            }

            for (var index = 1; index < segment.Length; index++)
            {
                var character = segment[index];
                if (!IsLowerAsciiLetter(character) &&
                    !char.IsAsciiDigit(character) &&
                    (character != '_' || segmentIndex == 0) &&
                    character != '-')
                {
                    error = "ID segments may contain lowercase ASCII letters, digits, underscores, and hyphens only.";
                    return false;
                }
            }
        }

        error = string.Empty;
        return true;
    }

    private static bool IsLowerAsciiLetter(char character) =>
        character is >= 'a' and <= 'z';
}

public enum SourceKind
{
    SkillExecution,
    Status,
    System
}

public readonly record struct SourceRef
{
    public SourceRef(
        SourceKind kind,
        EntityId definitionId,
        EntityId? instanceId = null)
    {
        if (kind is SourceKind.SkillExecution or SourceKind.Status &&
            instanceId is null)
        {
            throw new ArgumentException(
                $"A {kind} source must retain its instance ID.",
                nameof(instanceId));
        }

        Kind = kind;
        DefinitionId = definitionId;
        InstanceId = instanceId;
    }

    public SourceKind Kind { get; }

    public EntityId DefinitionId { get; }

    public EntityId? InstanceId { get; }

    public EntityId? StatusInstanceId =>
        Kind == SourceKind.Status ? InstanceId : null;

    public static SourceRef SkillExecution(
        EntityId skillDefinitionId,
        EntityId commandId) =>
        new(SourceKind.SkillExecution, skillDefinitionId, commandId);

    public static SourceRef Status(
        EntityId statusDefinitionId,
        EntityId statusInstanceId) =>
        new(SourceKind.Status, statusDefinitionId, statusInstanceId);

    public static SourceRef System(EntityId systemId) =>
        new(SourceKind.System, systemId);
}
