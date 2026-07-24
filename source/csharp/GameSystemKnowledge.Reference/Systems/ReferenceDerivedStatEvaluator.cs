using System.Collections.ObjectModel;
using System.Globalization;
using System.Text;
using GameSystemKnowledge.Reference.Contracts;

namespace GameSystemKnowledge.Reference.Systems;

public readonly record struct StatScalar(decimal Value);

public readonly record struct BasisPointRate(int Value)
{
    public const int One = 10_000;
}

public readonly record struct StatEvaluationVersion
{
    public StatEvaluationVersion(
        long ownerVersion,
        long definitionVersion,
        long numericPolicyVersion)
    {
        if (ownerVersion < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(ownerVersion));
        }

        if (definitionVersion < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(definitionVersion));
        }

        if (numericPolicyVersion < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(numericPolicyVersion));
        }

        OwnerVersion = ownerVersion;
        DefinitionVersion = definitionVersion;
        NumericPolicyVersion = numericPolicyVersion;
    }

    public long OwnerVersion { get; }

    public long DefinitionVersion { get; }

    public long NumericPolicyVersion { get; }
}

public static class StatNumericLanes
{
    public static StatScalar ApplyRate(
        StatScalar scalar,
        BasisPointRate rate) =>
        new(checked(scalar.Value * rate.Value / BasisPointRate.One));

    public static long ToCommitInteger(StatScalar scalar) =>
        checked((long)decimal.Round(
            scalar.Value,
            decimals: 0,
            MidpointRounding.AwayFromZero));
}

public sealed class DeclaredStatValues
{
    private readonly IReadOnlyDictionary<EntityId, StatScalar> _values;

    internal DeclaredStatValues(
        IReadOnlyDictionary<EntityId, StatScalar> values)
    {
        _values = values;
    }

    public int Count => _values.Count;

    public StatScalar Get(EntityId statId)
    {
        EntityId.ThrowIfInvalid(statId, nameof(statId));
        return _values.TryGetValue(statId, out var value)
            ? value
            : throw new KeyNotFoundException(
                $"Stat '{statId}' was not declared as a dependency.");
    }
}

public delegate StatScalar DerivedStatFormula(
    StatScalar baseValue,
    DeclaredStatValues dependencies,
    StatContext context);

public sealed class DerivedStatDefinition
{
    public DerivedStatDefinition(
        EntityId statId,
        StatScalar baseValue,
        IEnumerable<EntityId>? dependencies = null,
        DerivedStatFormula? formula = null,
        IEnumerable<StatModifier>? modifiers = null,
        StatScalar? minimumValue = null,
        StatScalar? maximumValue = null)
    {
        EntityId.ThrowIfInvalid(statId, nameof(statId));

        var dependencyCopy = (dependencies ?? Enumerable.Empty<EntityId>())
            .ToArray();
        if (dependencyCopy.Any(dependencyId => !dependencyId.IsValid))
        {
            throw new ArgumentException(
                "Derived stat dependencies must contain initialized IDs.",
                nameof(dependencies));
        }

        if (dependencyCopy.Length != dependencyCopy.Distinct().Count())
        {
            throw new ArgumentException(
                "A derived stat dependency can be declared only once.",
                nameof(dependencies));
        }

        if (dependencyCopy.Length > 0 && formula is null)
        {
            throw new ArgumentException(
                "A stat with dependencies requires an explicit formula.",
                nameof(formula));
        }

        var modifierCopy = (modifiers ?? Enumerable.Empty<StatModifier>())
            .ToArray();
        if (modifierCopy.Any(modifier => modifier is null))
        {
            throw new ArgumentException(
                "A stat definition cannot contain null modifiers.",
                nameof(modifiers));
        }

        if (modifierCopy.Any(modifier => modifier.StatId != statId))
        {
            throw new ArgumentException(
                "Every local modifier must target the definition stat.",
                nameof(modifiers));
        }

        if (modifierCopy.Length != modifierCopy
                .Select(modifier => modifier.ModifierId)
                .Distinct()
                .Count())
        {
            throw new ArgumentException(
                "A stat definition cannot contain duplicate modifier IDs.",
                nameof(modifiers));
        }

        if (minimumValue.HasValue &&
            maximumValue.HasValue &&
            minimumValue.Value.Value > maximumValue.Value.Value)
        {
            throw new ArgumentException(
                "A stat minimum cannot exceed its maximum.",
                nameof(minimumValue));
        }

        StatId = statId;
        BaseValue = baseValue;
        MinimumValue = minimumValue;
        MaximumValue = maximumValue;
        Dependencies = Array.AsReadOnly(
            dependencyCopy.OrderBy(dependencyId => dependencyId).ToArray());
        Formula = formula;
        Modifiers = Array.AsReadOnly(
            modifierCopy
                .OrderBy(modifier => OperationOrder(modifier.Operation))
                .ThenBy(modifier => modifier.Priority)
                .ThenBy(modifier => modifier.ModifierId)
                .ToArray());
    }

    public EntityId StatId { get; }

    public StatScalar BaseValue { get; }

    public StatScalar? MinimumValue { get; }

    public StatScalar? MaximumValue { get; }

    public ReadOnlyCollection<EntityId> Dependencies { get; }

    public DerivedStatFormula? Formula { get; }

    public ReadOnlyCollection<StatModifier> Modifiers { get; }

    private static int OperationOrder(ModifierOperation operation) =>
        operation switch
        {
            ModifierOperation.Add => 0,
            ModifierOperation.PercentAdd => 1,
            ModifierOperation.More => 2,
            ModifierOperation.Less => 3,
            ModifierOperation.Override => 4,
            _ => throw new ArgumentOutOfRangeException(nameof(operation))
        };
}

public sealed class DerivedStatGraph
{
    private readonly IReadOnlyDictionary<EntityId, DerivedStatDefinition> _definitions;
    private readonly IReadOnlyDictionary<EntityId, EntityId[]> _requiredOrders;

    public DerivedStatGraph(IEnumerable<DerivedStatDefinition> definitions)
    {
        var definitionCopy = definitions?.ToArray() ??
            throw new ArgumentNullException(nameof(definitions));
        if (definitionCopy.Length == 0)
        {
            throw new ArgumentException(
                "A derived stat graph requires at least one definition.",
                nameof(definitions));
        }

        if (definitionCopy.Any(definition => definition is null))
        {
            throw new ArgumentException(
                "A derived stat graph cannot contain null definitions.",
                nameof(definitions));
        }

        if (definitionCopy.Length != definitionCopy
                .Select(definition => definition.StatId)
                .Distinct()
                .Count())
        {
            throw new ArgumentException(
                "A derived stat graph cannot contain duplicate stat IDs.",
                nameof(definitions));
        }

        var byId = definitionCopy.ToDictionary(
            definition => definition.StatId,
            definition => definition);
        foreach (var definition in definitionCopy)
        {
            var missing = definition.Dependencies
                .Where(dependencyId => !byId.ContainsKey(dependencyId))
                .OrderBy(dependencyId => dependencyId)
                .ToArray();
            if (missing.Length > 0)
            {
                throw new ArgumentException(
                    $"Stat '{definition.StatId}' has missing dependencies: " +
                    string.Join(", ", missing.Select(id => id.Value)) + ".",
                    nameof(definitions));
            }
        }

        var indegree = byId.Keys.ToDictionary(statId => statId, _ => 0);
        var dependents = byId.Keys.ToDictionary(
            statId => statId,
            _ => new List<EntityId>());
        foreach (var definition in definitionCopy)
        {
            foreach (var dependencyId in definition.Dependencies)
            {
                indegree[definition.StatId]++;
                dependents[dependencyId].Add(definition.StatId);
            }
        }

        foreach (var dependentList in dependents.Values)
        {
            dependentList.Sort();
        }

        // 동시에 준비된 노드는 ID ordinal 순서로 골라 실행 순서를 플랫폼과 입력 순서에서 분리한다.
        var ready = new SortedSet<EntityId>(
            indegree
                .Where(pair => pair.Value == 0)
                .Select(pair => pair.Key));
        var evaluationOrder = new List<EntityId>(definitionCopy.Length);
        while (ready.Count > 0)
        {
            var next = ready.Min;
            ready.Remove(next);
            evaluationOrder.Add(next);

            foreach (var dependentId in dependents[next])
            {
                indegree[dependentId]--;
                if (indegree[dependentId] == 0)
                {
                    ready.Add(dependentId);
                }
            }
        }

        if (evaluationOrder.Count != definitionCopy.Length)
        {
            var cycleMembers = indegree
                .Where(pair => pair.Value > 0)
                .Select(pair => pair.Key)
                .OrderBy(statId => statId);
            throw new ArgumentException(
                "Derived stat dependencies contain a cycle among: " +
                string.Join(", ", cycleMembers.Select(id => id.Value)) + ".",
                nameof(definitions));
        }

        _definitions = byId;
        EvaluationOrder = Array.AsReadOnly(evaluationOrder.ToArray());

        var requiredOrders = new Dictionary<EntityId, EntityId[]>();
        foreach (var statId in evaluationOrder)
        {
            var required = new HashSet<EntityId>();
            AddDependencies(statId, required, byId);
            requiredOrders[statId] = evaluationOrder
                .Where(required.Contains)
                .ToArray();
        }

        _requiredOrders = requiredOrders;
    }

    public ReadOnlyCollection<EntityId> EvaluationOrder { get; }

    public bool Contains(EntityId statId) =>
        statId.IsValid && _definitions.ContainsKey(statId);

    internal DerivedStatDefinition GetDefinition(EntityId statId) =>
        _definitions.TryGetValue(statId, out var definition)
            ? definition
            : throw new KeyNotFoundException(
                $"No derived stat definition exists for '{statId}'.");

    internal IReadOnlyList<EntityId> GetRequiredOrder(EntityId statId) =>
        _requiredOrders.TryGetValue(statId, out var order)
            ? order
            : throw new KeyNotFoundException(
                $"No derived stat definition exists for '{statId}'.");

    private static void AddDependencies(
        EntityId statId,
        ISet<EntityId> required,
        IReadOnlyDictionary<EntityId, DerivedStatDefinition> definitions)
    {
        if (!required.Add(statId))
        {
            return;
        }

        foreach (var dependencyId in definitions[statId].Dependencies)
        {
            AddDependencies(dependencyId, required, definitions);
        }
    }
}

public sealed class CanonicalStatContextDescriptor :
    IEquatable<CanonicalStatContextDescriptor>
{
    private CanonicalStatContextDescriptor(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static CanonicalStatContextDescriptor From(StatContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        var builder = new StringBuilder(192);
        AppendText(builder, "owner");
        AppendText(builder, context.OwnerId.Value);
        AppendOptionalEntity(builder, "target", context.TargetId);
        AppendOptionalEntity(builder, "skill", context.SkillId);
        AppendSequence(builder, "skill-tags", context.SkillTags);
        AppendSequence(builder, "target-tags", context.TargetTags);
        AppendSequence(
            builder,
            "target-statuses",
            context.TargetStatuses
                .Select(statusId => statusId.Value));
        AppendText(builder, "distance");
        AppendText(
            builder,
            context.Distance.ToString("G29", CultureInfo.InvariantCulture));
        AppendText(builder, "moment");
        AppendText(builder, context.Moment);
        return new CanonicalStatContextDescriptor(builder.ToString());
    }

    public bool Equals(CanonicalStatContextDescriptor? other) =>
        other is not null &&
        StringComparer.Ordinal.Equals(Value, other.Value);

    public override bool Equals(object? obj) =>
        obj is CanonicalStatContextDescriptor other && Equals(other);

    public override int GetHashCode() =>
        StringComparer.Ordinal.GetHashCode(Value);

    public override string ToString() => Value;

    private static void AppendOptionalEntity(
        StringBuilder builder,
        string name,
        EntityId? value)
    {
        AppendText(builder, name);
        builder.Append(value.HasValue ? '1' : '0').Append(';');
        if (value.HasValue)
        {
            AppendText(builder, value.Value.Value);
        }
    }

    private static void AppendSequence(
        StringBuilder builder,
        string name,
        IEnumerable<string> values)
    {
        AppendText(builder, name);
        var copy = values.ToArray();
        builder
            .Append(copy.Length.ToString(CultureInfo.InvariantCulture))
            .Append(';');
        foreach (var value in copy)
        {
            AppendText(builder, value);
        }
    }

    private static void AppendText(
        StringBuilder builder,
        string value)
    {
        builder
            .Append(value.Length.ToString(CultureInfo.InvariantCulture))
            .Append(':')
            .Append(value)
            .Append(';');
    }
}

public sealed class StatEvaluationCacheKey : IEquatable<StatEvaluationCacheKey>
{
    public StatEvaluationCacheKey(
        EntityId statId,
        CanonicalStatContextDescriptor context,
        StatEvaluationVersion version)
    {
        EntityId.ThrowIfInvalid(statId, nameof(statId));
        StatId = statId;
        Context = context ?? throw new ArgumentNullException(nameof(context));
        Version = version;
    }

    public EntityId StatId { get; }

    public CanonicalStatContextDescriptor Context { get; }

    public StatEvaluationVersion Version { get; }

    public bool Equals(StatEvaluationCacheKey? other) =>
        other is not null &&
        StatId == other.StatId &&
        Context.Equals(other.Context) &&
        Version == other.Version;

    public override bool Equals(object? obj) =>
        obj is StatEvaluationCacheKey other && Equals(other);

    public override int GetHashCode() =>
        HashCode.Combine(StatId, Context, Version);
}

public sealed class ReferenceDerivedStatEvaluator : IStatQuery
{
    private readonly DerivedStatGraph _graph;
    private readonly Dictionary<StatEvaluationCacheKey, StatScalar> _cache;

    public ReferenceDerivedStatEvaluator(
        DerivedStatGraph graph,
        StatEvaluationVersion defaultVersion,
        IEqualityComparer<StatEvaluationCacheKey>? cacheComparer = null)
    {
        _graph = graph ?? throw new ArgumentNullException(nameof(graph));
        _cache = new Dictionary<StatEvaluationCacheKey, StatScalar>(
            cacheComparer);
        DefaultVersion = defaultVersion;
    }

    public int CacheEntryCount => _cache.Count;

    public StatEvaluationVersion DefaultVersion { get; }

    public decimal GetValue(
        EntityId ownerId,
        EntityId statId,
        StatContext context) =>
        GetScalar(ownerId, statId, context, DefaultVersion).Value;

    public decimal GetValue(
        EntityId ownerId,
        EntityId statId,
        StatContext context,
        StatEvaluationVersion version) =>
        GetScalar(ownerId, statId, context, version).Value;

    public StatScalar GetScalar(
        EntityId ownerId,
        EntityId statId,
        StatContext context) =>
        GetScalar(ownerId, statId, context, DefaultVersion);

    public StatScalar GetScalar(
        EntityId ownerId,
        EntityId statId,
        StatContext context,
        StatEvaluationVersion version)
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

        var key = new StatEvaluationCacheKey(
            statId,
            CanonicalStatContextDescriptor.From(context),
            version);
        if (_cache.TryGetValue(key, out var cached))
        {
            return cached;
        }

        var resolved = new Dictionary<EntityId, StatScalar>();
        foreach (var orderedStatId in _graph.GetRequiredOrder(statId))
        {
            var definition = _graph.GetDefinition(orderedStatId);
            var dependencyValues = new Dictionary<EntityId, StatScalar>(
                definition.Dependencies.Count);
            foreach (var dependencyId in definition.Dependencies)
            {
                dependencyValues.Add(dependencyId, resolved[dependencyId]);
            }

            var declaredValues = new DeclaredStatValues(dependencyValues);
            var rawValue = definition.Formula is null
                ? definition.BaseValue
                : definition.Formula(
                    definition.BaseValue,
                    declaredValues,
                    context);
            var modifiedValue = ApplyLocalModifiers(
                rawValue,
                definition.Modifiers,
                context);
            resolved.Add(
                orderedStatId,
                Clamp(modifiedValue, definition));
        }

        var result = resolved[statId];
        _cache.Add(key, result);
        return result;
    }

    public void ClearCache() => _cache.Clear();

    private static StatScalar Clamp(
        StatScalar value,
        DerivedStatDefinition definition)
    {
        if (definition.MinimumValue is { } minimum &&
            value.Value < minimum.Value)
        {
            return minimum;
        }

        if (definition.MaximumValue is { } maximum &&
            value.Value > maximum.Value)
        {
            return maximum;
        }

        return value;
    }

    private static StatScalar ApplyLocalModifiers(
        StatScalar rawValue,
        IReadOnlyList<StatModifier> modifiers,
        StatContext context)
    {
        var applicable = new List<StatModifier>(modifiers.Count);
        foreach (var modifier in modifiers)
        {
            if (modifier.AppliesTo(context))
            {
                applicable.Add(modifier);
            }
        }

        var value = rawValue.Value;
        foreach (var modifier in applicable)
        {
            if (modifier.Operation == ModifierOperation.Add)
            {
                value = checked(value + modifier.Value);
            }
        }

        var percentAdd = 0m;
        foreach (var modifier in applicable)
        {
            if (modifier.Operation == ModifierOperation.PercentAdd)
            {
                percentAdd = checked(percentAdd + modifier.Value);
            }
        }

        if (percentAdd < -1m)
        {
            throw new InvalidOperationException(
                "Combined PercentAdd modifiers cannot reduce the stage below zero.");
        }

        value = checked(value * (1m + percentAdd));
        foreach (var modifier in applicable)
        {
            if (modifier.Operation == ModifierOperation.More)
            {
                value = checked(value * (1m + modifier.Value));
            }
        }

        foreach (var modifier in applicable)
        {
            if (modifier.Operation == ModifierOperation.Less)
            {
                value = checked(value * (1m - modifier.Value));
            }
        }

        // Override는 정렬된 priority와 ID 순서로 적용되어 마지막 항목이 항상 같은 승자가 된다.
        foreach (var modifier in applicable)
        {
            if (modifier.Operation == ModifierOperation.Override)
            {
                value = modifier.Value;
            }
        }

        return new StatScalar(value);
    }
}
