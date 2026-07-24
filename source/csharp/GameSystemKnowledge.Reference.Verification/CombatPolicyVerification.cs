using GameSystemKnowledge.Reference.Contracts;
using GameSystemKnowledge.Reference.Systems;

namespace GameSystemKnowledge.Reference.Verification;

public static class CombatPolicyVerification
{
    public static int Run()
    {
        var suite = new CombatPolicySuite();
        suite.Run();
        return suite.AssertionCount;
    }
}

internal sealed class CombatPolicySuite
{
    public int AssertionCount { get; private set; }

    public void Run()
    {
        VerifyChanceBoundariesAndDistinctOutcomes();
        VerifyPenetrationResistanceAndSingleRounding();
        VerifyStableBarrierOrderAndConservation();
        VerifyContractBoundaries();
    }

    private void VerifyChanceBoundariesAndDistinctOutcomes()
    {
        var zeroChance = ReferenceCombatPolicy.Resolve(
            CreateInput(hitChanceBps: 0, hitRollBps: 0));
        Equal(
            HitOutcome.Miss,
            zeroChance.Outcome,
            "zero hit chance never succeeds");

        var guaranteedChance = ReferenceCombatPolicy.Resolve(
            CreateInput(hitChanceBps: 10_000, hitRollBps: 9_999));
        Equal(
            HitOutcome.Hit,
            guaranteedChance.Outcome,
            "ten-thousand BPS hit chance always succeeds");

        var hit = ReferenceCombatPolicy.Resolve(
            CreateInput(hitChanceBps: 9_200, hitRollBps: 9_199));
        Equal(HitOutcome.Hit, hit.Outcome, "roll immediately below chance hits");

        var miss = ReferenceCombatPolicy.Resolve(
            CreateInput(hitChanceBps: 9_200, hitRollBps: 9_200));
        Equal(HitOutcome.Miss, miss.Outcome, "roll equal to chance misses");
        Equal(0, miss.ResolvedDamage, "miss carries no damage");

        var critical = ReferenceCombatPolicy.Resolve(
            CreateInput(criticalChanceBps: 2_800, criticalRollBps: 2_799));
        True(critical.Critical, "critical roll immediately below chance succeeds");
        var nonCritical = ReferenceCombatPolicy.Resolve(
            CreateInput(criticalChanceBps: 2_800, criticalRollBps: 2_800));
        True(!nonCritical.Critical, "critical roll equal to chance fails");

        foreach (var outcome in new[]
                 {
                     HitOutcome.Blocked,
                     HitOutcome.Immune,
                     HitOutcome.Rejected
                 })
        {
            var forced = ReferenceCombatPolicy.Resolve(
                CreateInput(forcedOutcome: outcome));
            Equal(outcome, forced.Outcome, "forced non-hit outcome stays distinct");
            Equal(0, forced.ResolvedDamage, "forced non-hit outcome has zero damage");
            True(!forced.Critical, "forced non-hit outcome cannot be critical");
        }
    }

    private void VerifyPenetrationResistanceAndSingleRounding()
    {
        var result = ReferenceCombatPolicy.Resolve(
            CreateInput(
                baseDamage: 24m,
                scalingStatValue: 120m,
                coefficientBps: 12_000,
                criticalChanceBps: 10_000,
                criticalRollBps: 0,
                criticalMultiplierBps: 15_000,
                armor: 100,
                percentArmorPenetrationBps: 2_000,
                flatArmorPenetration: 30,
                armorConstant: 100m,
                resistanceBps: -2_500,
                availableTargetHp: 1_000));

        Equal(168m, result.FormulaSubtotal, "formula keeps a decimal subtotal");
        Equal(252m, result.CriticalSubtotal, "critical precedes mitigation");
        Equal(50m, result.EffectiveArmor, "percent penetration precedes flat penetration");
        Equal(2m / 3m, result.ArmorMultiplier, "armor uses the documented hyperbola");
        Equal(1.25m, result.ResistanceMultiplier, "negative resistance becomes vulnerability");
        Near(
            210m,
            result.AfterResistance,
            tolerance: 0.0000000000000000000000001m,
            "decimal stages compose before rounding without changing the committed integer");
        Equal(210, result.ResolvedDamage, "one committed integer boundary is applied");

        var overPenetrated = ReferenceCombatPolicy.Resolve(
            CreateInput(
                armor: 40,
                percentArmorPenetrationBps: 5_000,
                flatArmorPenetration: 30));
        Equal(
            0m,
            overPenetrated.EffectiveArmor,
            "flat penetration cannot make effective armor negative");
        Equal(
            100,
            overPenetrated.ResolvedDamage,
            "over-penetration stops at zero armor");

        var lowerResistanceEndpoint = ReferenceCombatPolicy.Resolve(
            CreateInput(resistanceBps: -5_000));
        Equal(
            1.5m,
            lowerResistanceEndpoint.ResistanceMultiplier,
            "negative resistance endpoint yields the documented vulnerability");
        Equal(
            150,
            lowerResistanceEndpoint.ResolvedDamage,
            "negative resistance endpoint is executable");

        var upperResistanceEndpoint = ReferenceCombatPolicy.Resolve(
            CreateInput(resistanceBps: 9_000));
        Equal(
            0.1m,
            upperResistanceEndpoint.ResistanceMultiplier,
            "positive resistance endpoint retains ten percent damage");
        Equal(
            10,
            upperResistanceEndpoint.ResolvedDamage,
            "positive resistance endpoint is executable");

        Equal(
            3,
            DeterministicNumericPolicy.RoundToInt32(2.5m),
            "positive midpoint rounds away from zero");
        Equal(
            -3,
            DeterministicNumericPolicy.RoundToInt32(-2.5m),
            "negative midpoint rounds away from zero");
    }

    private void VerifyStableBarrierOrderAndConservation()
    {
        var barriers = new[]
        {
            new BarrierSnapshot(new EntityId("barrier.zeta"), priority: 20, capacity: 50),
            new BarrierSnapshot(new EntityId("barrier.beta"), priority: 10, capacity: 60),
            new BarrierSnapshot(new EntityId("barrier.alpha"), priority: 10, capacity: 40)
        };
        var result = ReferenceCombatPolicy.Resolve(
            CreateInput(
                baseDamage: 200m,
                scalingStatValue: 0m,
                coefficientBps: 0,
                criticalChanceBps: 0,
                armor: 0,
                resistanceBps: 0,
                availableTargetHp: 30,
                barriers: barriers));

        SequenceEqual(
            new[]
            {
                new EntityId("barrier.alpha"),
                new EntityId("barrier.beta"),
                new EntityId("barrier.zeta")
            },
            result.BarrierAbsorptions.Select(item => item.BarrierId),
            "barriers use priority then ordinal ID order");
        SequenceEqual(
            new[] { 40, 60, 50 },
            result.BarrierAbsorptions.Select(item => item.Absorbed),
            "stable barrier order determines absorption");
        Equal(150, result.BarrierAbsorbed, "barrier total is explicit");
        Equal(30, result.FinalHpDamage, "remaining damage is capped by live HP");
        Equal(20, result.Overkill, "excess after HP becomes overkill");
        Equal(
            result.ResolvedDamage,
            result.BarrierAbsorbed + result.FinalHpDamage + result.Overkill,
            "damage conservation is exact");
    }

    private void VerifyContractBoundaries()
    {
        var belowMinimum = ReferenceCombatPolicy.Resolve(
            CreateInput(
                baseDamage: 0.49m,
                scalingStatValue: 0m,
                coefficientBps: 0,
                armor: 0,
                resistanceBps: 0));
        Equal(
            0,
            belowMinimum.ResolvedDamage,
            "the reference policy has no hidden minimum-damage floor");
        var midpoint = ReferenceCombatPolicy.Resolve(
            CreateInput(
                baseDamage: 0.5m,
                scalingStatValue: 0m,
                coefficientBps: 0,
                armor: 0,
                resistanceBps: 0));
        Equal(
            1,
            midpoint.ResolvedDamage,
            "the final positive midpoint rounds away from zero");
        Throws<ArgumentNullException>(
            () => ReferenceCombatPolicy.Resolve(null!),
            "combat policy rejects a missing input");
        Throws<ArgumentOutOfRangeException>(
            () => _ = CreateInput(resistanceBps: -5_001),
            "resistance lower cap is explicit");
        Throws<ArgumentOutOfRangeException>(
            () => _ = CreateInput(resistanceBps: 9_001),
            "resistance upper cap is explicit");
        Throws<ArgumentOutOfRangeException>(
            () => _ = CreateInput(percentArmorPenetrationBps: 10_001),
            "percent penetration cannot exceed one hundred percent");
        Throws<ArgumentOutOfRangeException>(
            () => _ = CreateInput(
                forcedOutcome: unchecked((HitOutcome)int.MaxValue)),
            "undefined forced outcome is rejected");
        Throws<ArgumentException>(
            () => _ = CreateInput(
                barriers: new[]
                {
                    new BarrierSnapshot(new EntityId("barrier.duplicate"), 0, 1),
                    new BarrierSnapshot(new EntityId("barrier.duplicate"), 1, 2)
                }),
            "duplicate barrier identity is rejected");
        Throws<OverflowException>(
            () => DeterministicNumericPolicy.RoundToInt32((decimal)int.MaxValue + 1m),
            "commit integer overflow is explicit");
    }

    private static CombatPipelineInput CreateInput(
        decimal baseDamage = 100m,
        decimal scalingStatValue = 0m,
        int coefficientBps = 0,
        int hitChanceBps = 10_000,
        int hitRollBps = 0,
        int criticalChanceBps = 0,
        int criticalRollBps = 0,
        int criticalMultiplierBps = 15_000,
        int armor = 0,
        int percentArmorPenetrationBps = 0,
        int flatArmorPenetration = 0,
        decimal armorConstant = 100m,
        int resistanceBps = 0,
        int availableTargetHp = 1_000,
        IEnumerable<BarrierSnapshot>? barriers = null,
        HitOutcome? forcedOutcome = null) =>
        new(
            baseDamage,
            scalingStatValue,
            coefficientBps,
            hitChanceBps,
            hitRollBps,
            criticalChanceBps,
            criticalRollBps,
            criticalMultiplierBps,
            armor,
            percentArmorPenetrationBps,
            flatArmorPenetration,
            armorConstant,
            resistanceBps,
            availableTargetHp,
            barriers,
            forcedOutcome);

    private void Equal<T>(T expected, T actual, string description)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new InvalidOperationException(
                $"{description}: expected '{expected}', actual '{actual}'.");
        }

        AssertionCount++;
    }

    private void SequenceEqual<T>(
        IEnumerable<T> expected,
        IEnumerable<T> actual,
        string description)
    {
        if (!expected.SequenceEqual(actual))
        {
            throw new InvalidOperationException($"{description}: sequences differ.");
        }

        AssertionCount++;
    }

    private void True(bool condition, string description)
    {
        if (!condition)
        {
            throw new InvalidOperationException(description);
        }

        AssertionCount++;
    }

    private void Near(
        decimal expected,
        decimal actual,
        decimal tolerance,
        string description)
    {
        if (Math.Abs(expected - actual) > tolerance)
        {
            throw new InvalidOperationException(
                $"{description}: expected '{expected}' ± '{tolerance}', actual '{actual}'.");
        }

        AssertionCount++;
    }

    private void Throws<TException>(Action action, string description)
        where TException : Exception
    {
        try
        {
            action();
        }
        catch (TException)
        {
            AssertionCount++;
            return;
        }

        throw new InvalidOperationException(
            $"{description}: expected {typeof(TException).Name}.");
    }
}
