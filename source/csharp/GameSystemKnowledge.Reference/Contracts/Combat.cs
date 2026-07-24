namespace GameSystemKnowledge.Reference.Contracts;

public sealed class DamageRequest
{
    public DamageRequest(
        EntityId attackerId,
        EntityId defenderId,
        SourceRef source,
        EntityId formulaId,
        string damageType,
        int baseValue,
        int coefficientBps,
        IEnumerable<string> tags,
        uint seed)
    {
        EntityId.ThrowIfInvalid(attackerId, nameof(attackerId));
        EntityId.ThrowIfInvalid(defenderId, nameof(defenderId));
        SourceRef.ThrowIfInvalid(source, nameof(source));
        EntityId.ThrowIfInvalid(formulaId, nameof(formulaId));

        var canonicalDamageType = new Tag(damageType);

        if (baseValue < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(baseValue));
        }

        if (coefficientBps is < 0 or > 100_000)
        {
            throw new ArgumentOutOfRangeException(nameof(coefficientBps));
        }

        var canonicalTags = new TagSet(
            tags ?? throw new ArgumentNullException(nameof(tags)));

        AttackerId = attackerId;
        DefenderId = defenderId;
        Source = source;
        FormulaId = formulaId;
        DamageType = canonicalDamageType.Value;
        BaseValue = baseValue;
        CoefficientBps = coefficientBps;
        Tags = canonicalTags;
        Seed = seed;
    }

    public EntityId AttackerId { get; }

    public EntityId DefenderId { get; }

    public SourceRef Source { get; }

    public EntityId FormulaId { get; }

    public string DamageType { get; }

    public int BaseValue { get; }

    public int CoefficientBps { get; }

    public TagSet Tags { get; }

    public uint Seed { get; }
}

public enum HitOutcome
{
    Hit,
    Miss,
    Blocked,
    Immune,
    Rejected
}

public sealed class CombatContext
{
    public CombatContext(
        decimal scalingStatValue,
        HitOutcome outcome,
        bool critical,
        int criticalMultiplierBps,
        int resistanceBps,
        int availableShield,
        int availableTargetHp)
    {
        if (!Enum.IsDefined(outcome))
        {
            throw new ArgumentOutOfRangeException(nameof(outcome));
        }

        if (scalingStatValue < 0m)
        {
            throw new ArgumentOutOfRangeException(nameof(scalingStatValue));
        }

        if (criticalMultiplierBps is < 10_000 or > 100_000)
        {
            throw new ArgumentOutOfRangeException(nameof(criticalMultiplierBps));
        }

        if (resistanceBps is < 0 or > 10_000)
        {
            throw new ArgumentOutOfRangeException(nameof(resistanceBps));
        }

        if (availableShield < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(availableShield));
        }

        if (availableTargetHp < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(availableTargetHp));
        }

        if (outcome != HitOutcome.Hit && critical)
        {
            throw new ArgumentException(
                "A non-Hit combat context cannot carry a critical flag.",
                nameof(critical));
        }

        ScalingStatValue = scalingStatValue;
        Outcome = outcome;
        Critical = critical;
        CriticalMultiplierBps = criticalMultiplierBps;
        ResistanceBps = resistanceBps;
        AvailableShield = availableShield;
        AvailableTargetHp = availableTargetHp;
    }

    public decimal ScalingStatValue { get; }

    public HitOutcome Outcome { get; }

    public bool Critical { get; }

    public int CriticalMultiplierBps { get; }

    public int ResistanceBps { get; }

    public int AvailableShield { get; }

    public int AvailableTargetHp { get; }
}

public sealed class DamageResult
{
    public DamageResult(
        HitOutcome outcome,
        bool critical,
        int rawDamage,
        int resolvedDamage,
        int shieldAbsorbed,
        int finalHpDamage,
        int overkill)
    {
        if (!Enum.IsDefined(outcome))
        {
            throw new ArgumentOutOfRangeException(nameof(outcome));
        }

        if (rawDamage < 0 || resolvedDamage < 0 ||
            shieldAbsorbed < 0 || finalHpDamage < 0 || overkill < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(rawDamage));
        }

        if ((long)shieldAbsorbed + finalHpDamage + overkill != resolvedDamage)
        {
            throw new ArgumentException(
                "Resolved damage must equal shield absorption, final HP damage, and overkill.");
        }

        if (outcome != HitOutcome.Hit &&
            (critical || rawDamage != 0 || resolvedDamage != 0 ||
             shieldAbsorbed != 0 || finalHpDamage != 0 || overkill != 0))
        {
            throw new ArgumentException(
                "The compact resolver policy requires every non-Hit outcome to carry zero damage and no critical flag.");
        }

        Outcome = outcome;
        Critical = critical;
        RawDamage = rawDamage;
        ResolvedDamage = resolvedDamage;
        ShieldAbsorbed = shieldAbsorbed;
        FinalHpDamage = finalHpDamage;
        Overkill = overkill;
    }

    public HitOutcome Outcome { get; }

    public bool Critical { get; }

    public int RawDamage { get; }

    public int ResolvedDamage { get; }

    public int ShieldAbsorbed { get; }

    public int FinalHpDamage { get; }

    public int Overkill { get; }
}

public interface ICombatResolver
{
    DamageResult Resolve(DamageRequest request, CombatContext context);
}
