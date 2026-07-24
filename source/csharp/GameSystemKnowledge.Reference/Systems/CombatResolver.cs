using GameSystemKnowledge.Reference.Contracts;

namespace GameSystemKnowledge.Reference.Systems;

public sealed class CombatResolver : ICombatResolver
{
    public DamageResult Resolve(DamageRequest request, CombatContext context)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(context);

        // Miss, Blocked, Immune, and Rejected stay distinct even when this
        // compact policy resolves all four to zero committed damage.
        if (context.Outcome != HitOutcome.Hit)
        {
            return new DamageResult(
                context.Outcome,
                critical: false,
                rawDamage: 0,
                resolvedDamage: 0,
                shieldAbsorbed: 0,
                finalHpDamage: 0,
                overkill: 0);
        }

        var formulaDamage =
            request.BaseValue +
            (context.ScalingStatValue * request.CoefficientBps / 10_000m);
        // RawDamage is the value entering mitigation. Critical amplification
        // is therefore part of raw damage, not a hidden stage after it. The
        // integer RawDamage field is a reporting/downstream snapshot projection;
        // this primary mitigation keeps using the exact decimal subtotal so it
        // cannot feed an early rounded value back into the same calculation.
        var exactRawDamage = context.Critical
            ? formulaDamage * context.CriticalMultiplierBps / 10_000m
            : formulaDamage;
        var rawDamage = RoundDamage(exactRawDamage);
        var resolvedDamage = RoundDamage(
            exactRawDamage * (10_000 - context.ResistanceBps) / 10_000m);
        var shieldAbsorbed = Math.Min(context.AvailableShield, resolvedDamage);
        var postShieldDamage = resolvedDamage - shieldAbsorbed;
        var finalHpDamage = Math.Min(context.AvailableTargetHp, postShieldDamage);
        var overkill = postShieldDamage - finalHpDamage;

        return new DamageResult(
            context.Outcome,
            context.Critical,
            rawDamage,
            resolvedDamage,
            shieldAbsorbed,
            finalHpDamage,
            overkill);
    }

    private static int RoundDamage(decimal value) =>
        decimal.ToInt32(decimal.Round(value, 0, MidpointRounding.AwayFromZero));
}
