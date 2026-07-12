using GameSystemKnowledge.Reference.Contracts;

namespace GameSystemKnowledge.Reference.Systems;

public sealed class DictionaryStatQuery : IStatQuery
{
    private readonly IReadOnlyDictionary<(EntityId OwnerId, EntityId StatId), decimal> _values;

    public DictionaryStatQuery(
        IReadOnlyDictionary<(EntityId OwnerId, EntityId StatId), decimal> values)
    {
        _values = values ?? throw new ArgumentNullException(nameof(values));
    }

    public decimal GetValue(
        EntityId ownerId,
        EntityId statId,
        StatContext context)
    {
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
