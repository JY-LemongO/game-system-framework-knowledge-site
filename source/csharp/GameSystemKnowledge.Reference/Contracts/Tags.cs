using System.Collections;

namespace GameSystemKnowledge.Reference.Contracts;

public readonly record struct Tag : IComparable<Tag>
{
    private readonly string? _value;

    public Tag(string value)
    {
        if (!TryValidate(value, out var error))
        {
            throw new ArgumentException(error, nameof(value));
        }

        _value = value;
    }

    public bool IsValid => _value is not null;

    public string Value => _value ?? throw new InvalidOperationException(
        "A default Tag is invalid and has no value.");

    public static bool TryCreate(string? value, out Tag tag)
    {
        if (!TryValidate(value, out _))
        {
            tag = default;
            return false;
        }

        tag = new Tag(value!);
        return true;
    }

    public int CompareTo(Tag other) =>
        StringComparer.Ordinal.Compare(Value, other.Value);

    public override string ToString() => Value;

    private static bool TryValidate(string? value, out string error)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            error = "A tag cannot be empty.";
            return false;
        }

        if (value[0] is not (>= 'a' and <= 'z'))
        {
            error = "A tag must start with a lowercase ASCII letter.";
            return false;
        }

        for (var index = 1; index < value.Length; index++)
        {
            var character = value[index];
            if (character is >= 'a' and <= 'z' ||
                char.IsAsciiDigit(character) ||
                character is '.' or '_' or '-')
            {
                continue;
            }

            error = "Tags may contain lowercase ASCII letters, digits, periods, underscores, and hyphens only.";
            return false;
        }

        error = string.Empty;
        return true;
    }
}

public sealed class TagSet : IReadOnlyList<string>, IEquatable<TagSet>
{
    private readonly Tag[] _tags;

    public static TagSet Empty { get; } = new(Array.Empty<Tag>(), true);

    public TagSet(IEnumerable<string> tags)
    {
        ArgumentNullException.ThrowIfNull(tags);

        // 입력 순서와 중복이 replay·cache identity를 바꾸지 않게 정규화한다.
        _tags = tags
            .Select(value => new Tag(value))
            .Distinct()
            .OrderBy(tag => tag)
            .ToArray();
    }

    public TagSet(IEnumerable<Tag> tags)
    {
        ArgumentNullException.ThrowIfNull(tags);

        var copy = tags.ToArray();
        if (copy.Any(tag => !tag.IsValid))
        {
            throw new ArgumentException(
                "A TagSet cannot contain a default Tag.",
                nameof(tags));
        }

        _tags = copy
            .Distinct()
            .OrderBy(tag => tag)
            .ToArray();
    }

    private TagSet(Tag[] tags, bool alreadyCanonical)
    {
        _tags = alreadyCanonical ? tags : tags.ToArray();
    }

    public int Count => _tags.Length;

    public string this[int index] => _tags[index].Value;

    public bool Contains(Tag tag)
    {
        if (!tag.IsValid)
        {
            return false;
        }

        return Array.BinarySearch(_tags, tag) >= 0;
    }

    public bool Contains(string tag) =>
        Tag.TryCreate(tag, out var canonicalTag) && Contains(canonicalTag);

    public bool Equals(TagSet? other) =>
        other is not null && _tags.SequenceEqual(other._tags);

    public override bool Equals(object? obj) =>
        obj is TagSet other && Equals(other);

    public override int GetHashCode()
    {
        var hash = new HashCode();
        foreach (var tag in _tags)
        {
            hash.Add(tag);
        }

        return hash.ToHashCode();
    }

    public IEnumerator<string> GetEnumerator() =>
        _tags.Select(tag => tag.Value).GetEnumerator();

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}
