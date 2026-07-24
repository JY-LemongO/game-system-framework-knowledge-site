using GameSystemKnowledge.Reference.Contracts;

namespace GameSystemKnowledge.Reference.Systems;

public enum StatusCleanseOutcome
{
    Selected,
    NoMatch
}

public sealed class StatusCleanseCandidate
{
    public StatusCleanseCandidate(
        EntityId instanceId,
        TagSet tags,
        int priority)
    {
        EntityId.ThrowIfInvalid(instanceId, nameof(instanceId));
        ArgumentNullException.ThrowIfNull(tags);

        InstanceId = instanceId;
        Tags = tags;
        Priority = priority;
    }

    public EntityId InstanceId { get; }

    public TagSet Tags { get; }

    public int Priority { get; }
}

public sealed class StatusCleanseRequest
{
    public StatusCleanseRequest(
        TagSet requiredAnyTags,
        TagSet requiredAllTags,
        TagSet excludedTags,
        int maxRemovals)
    {
        ArgumentNullException.ThrowIfNull(requiredAnyTags);
        ArgumentNullException.ThrowIfNull(requiredAllTags);
        ArgumentNullException.ThrowIfNull(excludedTags);

        if (maxRemovals <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maxRemovals));
        }

        RequiredAnyTags = requiredAnyTags;
        RequiredAllTags = requiredAllTags;
        ExcludedTags = excludedTags;
        MaxRemovals = maxRemovals;
    }

    public TagSet RequiredAnyTags { get; }

    public TagSet RequiredAllTags { get; }

    public TagSet ExcludedTags { get; }

    public int MaxRemovals { get; }
}

public sealed class StatusCleanseDecision
{
    private StatusCleanseDecision(
        StatusCleanseOutcome outcome,
        IReadOnlyList<EntityId> selectedInstanceIds,
        int eligibleCount)
    {
        Outcome = outcome;
        SelectedInstanceIds = selectedInstanceIds;
        EligibleCount = eligibleCount;
    }

    public StatusCleanseOutcome Outcome { get; }

    public IReadOnlyList<EntityId> SelectedInstanceIds { get; }

    public int EligibleCount { get; }

    internal static StatusCleanseDecision Selected(
        EntityId[] selectedInstanceIds,
        int eligibleCount)
    {
        if (selectedInstanceIds.Length == 0)
        {
            throw new ArgumentException(
                "A selected cleanse decision requires at least one instance.",
                nameof(selectedInstanceIds));
        }

        return new(
            StatusCleanseOutcome.Selected,
            Array.AsReadOnly((EntityId[])selectedInstanceIds.Clone()),
            eligibleCount);
    }

    internal static StatusCleanseDecision NoMatch() =>
        new(
            StatusCleanseOutcome.NoMatch,
            Array.Empty<EntityId>(),
            eligibleCount: 0);
}

public static class ReferenceStatusCleansePolicy
{
    public static StatusCleanseDecision Select(
        StatusCleanseRequest request,
        IReadOnlyList<StatusCleanseCandidate> candidates)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(candidates);

        var instanceIds = new HashSet<EntityId>();
        var eligible = new List<StatusCleanseCandidate>();
        for (var index = 0; index < candidates.Count; index++)
        {
            var candidate = candidates[index] ??
                throw new ArgumentException(
                    "Cleanse candidates cannot contain null.",
                    nameof(candidates));

            if (!instanceIds.Add(candidate.InstanceId))
            {
                throw new ArgumentException(
                    "Cleanse candidate IDs must be unique.",
                    nameof(candidates));
            }

            if (Matches(candidate.Tags, request))
            {
                eligible.Add(candidate);
            }
        }

        if (eligible.Count == 0)
        {
            return StatusCleanseDecision.NoMatch();
        }

        // 입력 순서와 무관하게 전체 적격 집합을 정렬한 뒤 제거 상한을 적용한다.
        eligible.Sort(static (left, right) =>
        {
            var byPriority = right.Priority.CompareTo(left.Priority);
            return byPriority != 0
                ? byPriority
                : left.InstanceId.CompareTo(right.InstanceId);
        });

        var selectedCount = Math.Min(request.MaxRemovals, eligible.Count);
        var selectedIds = new EntityId[selectedCount];
        for (var index = 0; index < selectedCount; index++)
        {
            selectedIds[index] = eligible[index].InstanceId;
        }

        return StatusCleanseDecision.Selected(
            selectedIds,
            eligible.Count);
    }

    private static bool Matches(
        TagSet candidateTags,
        StatusCleanseRequest request)
    {
        if (request.RequiredAnyTags.Count > 0 &&
            !ContainsAny(candidateTags, request.RequiredAnyTags))
        {
            return false;
        }

        if (!ContainsAll(candidateTags, request.RequiredAllTags))
        {
            return false;
        }

        return !ContainsAny(candidateTags, request.ExcludedTags);
    }

    private static bool ContainsAny(TagSet candidateTags, TagSet queryTags)
    {
        for (var index = 0; index < queryTags.Count; index++)
        {
            if (candidateTags.Contains(queryTags[index]))
            {
                return true;
            }
        }

        return false;
    }

    private static bool ContainsAll(TagSet candidateTags, TagSet queryTags)
    {
        for (var index = 0; index < queryTags.Count; index++)
        {
            if (!candidateTags.Contains(queryTags[index]))
            {
                return false;
            }
        }

        return true;
    }
}
