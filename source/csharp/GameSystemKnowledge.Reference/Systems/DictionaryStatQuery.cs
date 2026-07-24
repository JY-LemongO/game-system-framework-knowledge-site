using GameSystemKnowledge.Reference.Contracts;

namespace GameSystemKnowledge.Reference.Systems;

public sealed class DictionaryStatQuery : IStatQuery
{
    private readonly IReadOnlyDictionary<(EntityId OwnerId, EntityId StatId), decimal> _values;

    public DictionaryStatQuery(
        IReadOnlyDictionary<(EntityId OwnerId, EntityId StatId), decimal> values)
    {
        var valueCopy = values?.ToArray() ??
            throw new ArgumentNullException(nameof(values));
        if (valueCopy.Any(item =>
                !item.Key.OwnerId.IsValid || !item.Key.StatId.IsValid))
        {
            throw new ArgumentException(
                "Stat query keys must contain initialized owner and stat IDs.",
                nameof(values));
        }

        _values = valueCopy.ToDictionary(item => item.Key, item => item.Value);
    }

    public decimal GetValue(
        EntityId ownerId,
        EntityId statId,
        StatContext context)
    {
        EntityId.ThrowIfInvalid(ownerId, nameof(ownerId));
        EntityId.ThrowIfInvalid(statId, nameof(statId));
        ArgumentNullException.ThrowIfNull(context);
        if (ownerId != context.OwnerId)
        {
            throw new ArgumentException(
                "The queried owner must match StatContext.OwnerId.",
                nameof(ownerId));
        }

        return _values.TryGetValue((ownerId, statId), out var value)
            ? value
            : throw new KeyNotFoundException(
                $"No value exists for owner '{ownerId}' and stat '{statId}'.");
    }
}
