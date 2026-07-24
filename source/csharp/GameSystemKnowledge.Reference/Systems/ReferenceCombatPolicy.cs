using System.Collections.ObjectModel;
using GameSystemKnowledge.Reference.Contracts;

namespace GameSystemKnowledge.Reference.Systems;

public sealed class BarrierSnapshot
{
    public BarrierSnapshot(
        EntityId barrierId,
        int priority,
        int capacity)
    {
        EntityId.ThrowIfInvalid(barrierId, nameof(barrierId));
        if (capacity < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(capacity));
        }

        BarrierId = barrierId;
        Priority = priority;
        Capacity = capacity;
    }

    public EntityId BarrierId { get; }

    public int Priority { get; }

    public int Capacity { get; }
}

public sealed class CombatPipelineInput
{
    public CombatPipelineInput(
        decimal baseDamage,
        decimal scalingStatValue,
        int coefficientBps,
        int hitChanceBps,
        int hitRollBps,
        int criticalChanceBps,
        int criticalRollBps,
        int criticalMultiplierBps,
        int armor,
        int percentArmorPenetrationBps,
        int flatArmorPenetration,
        decimal armorConstant,
        int resistanceBps,
        int availableTargetHp,
        IEnumerable<BarrierSnapshot>? barriers = null,
        HitOutcome? forcedOutcome = null)
    {
        if (baseDamage < 0m)
        {
            throw new ArgumentOutOfRangeException(nameof(baseDamage));
        }

        if (scalingStatValue < 0m)
        {
            throw new ArgumentOutOfRangeException(nameof(scalingStatValue));
        }

        RequireBps(coefficientBps, nameof(coefficientBps), 0, 100_000);
        RequireBps(hitChanceBps, nameof(hitChanceBps), 0, 10_000);
        RequireBps(hitRollBps, nameof(hitRollBps), 0, 9_999);
        RequireBps(criticalChanceBps, nameof(criticalChanceBps), 0, 10_000);
        RequireBps(criticalRollBps, nameof(criticalRollBps), 0, 9_999);
        RequireBps(
            criticalMultiplierBps,
            nameof(criticalMultiplierBps),
            10_000,
            100_000);

        if (armor < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(armor));
        }

        RequireBps(
            percentArmorPenetrationBps,
            nameof(percentArmorPenetrationBps),
            0,
            10_000);
        if (flatArmorPenetration < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(flatArmorPenetration));
        }

        if (armorConstant <= 0m)
        {
            throw new ArgumentOutOfRangeException(nameof(armorConstant));
        }

        RequireBps(resistanceBps, nameof(resistanceBps), -5_000, 9_000);
        if (availableTargetHp < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(availableTargetHp));
        }

        if (forcedOutcome is { } outcome && !Enum.IsDefined(outcome))
        {
            throw new ArgumentOutOfRangeException(nameof(forcedOutcome));
        }

        var barrierCopy = (barriers ?? Enumerable.Empty<BarrierSnapshot>())
            .ToArray();
        if (barrierCopy.Any(barrier => barrier is null))
        {
            throw new ArgumentException(
                "Barrier snapshots cannot contain null values.",
                nameof(barriers));
        }

        var duplicateBarrier = barrierCopy
            .GroupBy(barrier => barrier.BarrierId)
            .FirstOrDefault(group => group.Count() > 1);
        if (duplicateBarrier is not null)
        {
            throw new ArgumentException(
                $"Barrier IDs must be unique: {duplicateBarrier.Key}.",
                nameof(barriers));
        }

        BaseDamage = baseDamage;
        ScalingStatValue = scalingStatValue;
        CoefficientBps = coefficientBps;
        HitChanceBps = hitChanceBps;
        HitRollBps = hitRollBps;
        CriticalChanceBps = criticalChanceBps;
        CriticalRollBps = criticalRollBps;
        CriticalMultiplierBps = criticalMultiplierBps;
        Armor = armor;
        PercentArmorPenetrationBps = percentArmorPenetrationBps;
        FlatArmorPenetration = flatArmorPenetration;
        ArmorConstant = armorConstant;
        ResistanceBps = resistanceBps;
        AvailableTargetHp = availableTargetHp;
        Barriers = Array.AsReadOnly(barrierCopy);
        ForcedOutcome = forcedOutcome;
    }

    public decimal BaseDamage { get; }

    public decimal ScalingStatValue { get; }

    public int CoefficientBps { get; }

    public int HitChanceBps { get; }

    public int HitRollBps { get; }

    public int CriticalChanceBps { get; }

    public int CriticalRollBps { get; }

    public int CriticalMultiplierBps { get; }

    public int Armor { get; }

    public int PercentArmorPenetrationBps { get; }

    public int FlatArmorPenetration { get; }

    public decimal ArmorConstant { get; }

    public int ResistanceBps { get; }

    public int AvailableTargetHp { get; }

    public ReadOnlyCollection<BarrierSnapshot> Barriers { get; }

    public HitOutcome? ForcedOutcome { get; }

    private static void RequireBps(
        int value,
        string parameterName,
        int minimum,
        int maximum)
    {
        if (value < minimum || value > maximum)
        {
            throw new ArgumentOutOfRangeException(parameterName);
        }
    }
}

public sealed class BarrierAbsorption
{
    public BarrierAbsorption(
        EntityId barrierId,
        int priority,
        int capacityBefore,
        int absorbed,
        int capacityAfter)
    {
        EntityId.ThrowIfInvalid(barrierId, nameof(barrierId));
        if (capacityBefore < 0 || absorbed < 0 || capacityAfter < 0 ||
            capacityBefore - absorbed != capacityAfter)
        {
            throw new ArgumentException(
                "Barrier absorption must conserve its capacity.");
        }

        BarrierId = barrierId;
        Priority = priority;
        CapacityBefore = capacityBefore;
        Absorbed = absorbed;
        CapacityAfter = capacityAfter;
    }

    public EntityId BarrierId { get; }

    public int Priority { get; }

    public int CapacityBefore { get; }

    public int Absorbed { get; }

    public int CapacityAfter { get; }
}

public sealed class CombatPipelineResult
{
    internal CombatPipelineResult(
        HitOutcome outcome,
        bool critical,
        decimal formulaSubtotal,
        decimal criticalSubtotal,
        decimal effectiveArmor,
        decimal armorMultiplier,
        decimal afterArmor,
        decimal resistanceMultiplier,
        decimal afterResistance,
        int resolvedDamage,
        IEnumerable<BarrierAbsorption> barrierAbsorptions,
        int finalHpDamage,
        int overkill)
    {
        if (!Enum.IsDefined(outcome))
        {
            throw new ArgumentOutOfRangeException(nameof(outcome));
        }

        var absorptionCopy = barrierAbsorptions.ToArray();
        var absorbed = absorptionCopy.Sum(item => item.Absorbed);
        if ((long)absorbed + finalHpDamage + overkill != resolvedDamage)
        {
            throw new ArgumentException(
                "Resolved damage must equal barrier absorption, HP damage, and overkill.");
        }

        Outcome = outcome;
        Critical = critical;
        FormulaSubtotal = formulaSubtotal;
        CriticalSubtotal = criticalSubtotal;
        EffectiveArmor = effectiveArmor;
        ArmorMultiplier = armorMultiplier;
        AfterArmor = afterArmor;
        ResistanceMultiplier = resistanceMultiplier;
        AfterResistance = afterResistance;
        ResolvedDamage = resolvedDamage;
        BarrierAbsorptions = Array.AsReadOnly(absorptionCopy);
        FinalHpDamage = finalHpDamage;
        Overkill = overkill;
    }

    public HitOutcome Outcome { get; }

    public bool Critical { get; }

    public decimal FormulaSubtotal { get; }

    public decimal CriticalSubtotal { get; }

    public decimal EffectiveArmor { get; }

    public decimal ArmorMultiplier { get; }

    public decimal AfterArmor { get; }

    public decimal ResistanceMultiplier { get; }

    public decimal AfterResistance { get; }

    public int ResolvedDamage { get; }

    public ReadOnlyCollection<BarrierAbsorption> BarrierAbsorptions { get; }

    public int FinalHpDamage { get; }

    public int Overkill { get; }

    public int BarrierAbsorbed =>
        BarrierAbsorptions.Sum(item => item.Absorbed);
}

public static class DeterministicNumericPolicy
{
    public static decimal MultiplyBps(decimal value, int basisPoints) =>
        value * basisPoints / 10_000m;

    public static int RoundToInt32(decimal value)
    {
        var rounded = decimal.Round(
            value,
            decimals: 0,
            MidpointRounding.AwayFromZero);
        if (rounded < int.MinValue || rounded > int.MaxValue)
        {
            throw new OverflowException(
                "Rounded combat value does not fit in Int32.");
        }

        return decimal.ToInt32(rounded);
    }
}

public static class ReferenceCombatPolicy
{
    public static CombatPipelineResult Resolve(CombatPipelineInput input)
    {
        ArgumentNullException.ThrowIfNull(input);

        var outcome = input.ForcedOutcome ??
            (input.HitRollBps < input.HitChanceBps
                ? HitOutcome.Hit
                : HitOutcome.Miss);
        if (outcome != HitOutcome.Hit)
        {
            return new CombatPipelineResult(
                outcome,
                critical: false,
                formulaSubtotal: 0m,
                criticalSubtotal: 0m,
                effectiveArmor: 0m,
                armorMultiplier: 0m,
                afterArmor: 0m,
                resistanceMultiplier: 0m,
                afterResistance: 0m,
                resolvedDamage: 0,
                Array.Empty<BarrierAbsorption>(),
                finalHpDamage: 0,
                overkill: 0);
        }

        var critical =
            input.CriticalRollBps < input.CriticalChanceBps;
        var formulaSubtotal = input.BaseDamage +
            DeterministicNumericPolicy.MultiplyBps(
                input.ScalingStatValue,
                input.CoefficientBps);
        var criticalSubtotal = critical
            ? DeterministicNumericPolicy.MultiplyBps(
                formulaSubtotal,
                input.CriticalMultiplierBps)
            : formulaSubtotal;

        // Percent penetration is applied before flat penetration. Keeping the
        // intermediate decimal avoids an early rounding discontinuity.
        var armorAfterPercent = DeterministicNumericPolicy.MultiplyBps(
            input.Armor,
            10_000 - input.PercentArmorPenetrationBps);
        var effectiveArmor = Math.Max(
            0m,
            armorAfterPercent - input.FlatArmorPenetration);
        var armorMultiplier =
            input.ArmorConstant / (input.ArmorConstant + effectiveArmor);
        var afterArmor = criticalSubtotal * armorMultiplier;

        // Resistance is a signed BPS lane. Negative values are vulnerability.
        var resistanceMultiplier =
            (10_000m - input.ResistanceBps) / 10_000m;
        var afterResistance = afterArmor * resistanceMultiplier;

        // This is the single scalar-to-committed-integer boundary.
        var resolvedDamage =
            DeterministicNumericPolicy.RoundToInt32(afterResistance);
        var remainingDamage = resolvedDamage;
        var absorptions = new List<BarrierAbsorption>();
        foreach (var barrier in input.Barriers
                     .OrderBy(item => item.Priority)
                     .ThenBy(item => item.BarrierId))
        {
            var absorbed = Math.Min(barrier.Capacity, remainingDamage);
            remainingDamage -= absorbed;
            absorptions.Add(new BarrierAbsorption(
                barrier.BarrierId,
                barrier.Priority,
                barrier.Capacity,
                absorbed,
                barrier.Capacity - absorbed));
        }

        var finalHpDamage = Math.Min(
            input.AvailableTargetHp,
            remainingDamage);
        var overkill = remainingDamage - finalHpDamage;
        return new CombatPipelineResult(
            outcome,
            critical,
            formulaSubtotal,
            criticalSubtotal,
            effectiveArmor,
            armorMultiplier,
            afterArmor,
            resistanceMultiplier,
            afterResistance,
            resolvedDamage,
            absorptions,
            finalHpDamage,
            overkill);
    }
}
