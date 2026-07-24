using GameSystemKnowledge.Reference.Contracts;

namespace GameSystemKnowledge.Reference.Verification;

public static class FoundationContractVerification
{
    public static int Run()
    {
        var suite = new FoundationContractSuite();
        suite.Run();
        return suite.AssertionCount;
    }
}

internal sealed class FoundationContractSuite
{
    public int AssertionCount { get; private set; }

    public void Run()
    {
        VerifyCanonicalTags();
        VerifyStatBoundaryContracts();
        VerifyEffectBoundaryContracts();
    }

    private void VerifyCanonicalTags()
    {
        var source = new[] { "spell", "fire", "spell" };
        var canonical = new TagSet(source);
        source[0] = "mutated";

        SequenceEqual(
            new[] { "fire", "spell" },
            canonical,
            "TagSet sorts and removes duplicate tags");
        True(
            canonical.Equals(new TagSet(new[] { "spell", "fire" })),
            "TagSet equality depends on canonical content");
        True(canonical.Contains(new Tag("fire")), "TagSet finds a canonical Tag");
        True(!canonical.Contains("Fire"), "TagSet rejects non-canonical lookup text");
        Throws<ArgumentException>(
            () => _ = new Tag("Fire"),
            "Tag rejects uppercase input");
        Throws<ArgumentException>(
            () => _ = new TagSet(new[] { " spell" }),
            "TagSet rejects whitespace-normalized aliases");
        Throws<ArgumentException>(
            () => _ = new TagSet(new[] { default(Tag) }),
            "TagSet rejects a default Tag");
    }

    private void VerifyStatBoundaryContracts()
    {
        var ownerId = new EntityId("entity.foundation-owner");
        var statId = new EntityId("stat.foundation-value");
        var stackRuleId = new EntityId("stack-rule.foundation");
        var source = SourceRef.System(new EntityId("system.foundation"));
        var context = new StatContext(
            ownerId,
            targetId: null,
            skillId: null,
            skillTags: new[] { "spell", "fire", "spell" });

        Equal<EntityId?>(null, context.SkillId, "StatContext supports non-skill queries");
        SequenceEqual(
            new[] { "fire", "spell" },
            context.SkillTags,
            "StatContext exposes canonical skill tags");
        Throws<ArgumentException>(
            () => _ = new StatContext(
                ownerId,
                targetId: null,
                skillId: (EntityId?)default(EntityId)),
            "StatContext rejects a default optional skill ID");

        var validBoundaries = new[]
        {
            new StatModifier(
                new EntityId("modifier.foundation.percent-boundary"),
                statId,
                ModifierOperation.PercentAdd,
                -1m,
                source,
                priority: 0,
                stackRuleId),
            new StatModifier(
                new EntityId("modifier.foundation.more-boundary"),
                statId,
                ModifierOperation.More,
                0m,
                source,
                priority: 0,
                stackRuleId),
            new StatModifier(
                new EntityId("modifier.foundation.less-boundary"),
                statId,
                ModifierOperation.Less,
                1m,
                source,
                priority: 0,
                stackRuleId)
        };
        Equal(3, validBoundaries.Length, "modifier ratio boundaries are explicit");

        Throws<ArgumentOutOfRangeException>(
            () => CreateModifier((ModifierOperation)int.MaxValue, 0m),
            "StatModifier rejects an undefined operation");
        Throws<ArgumentOutOfRangeException>(
            () => CreateModifier(ModifierOperation.PercentAdd, -1.0001m),
            "PercentAdd rejects a multiplier below zero");
        Throws<ArgumentOutOfRangeException>(
            () => CreateModifier(ModifierOperation.More, -0.0001m),
            "More rejects a negative ratio");
        Throws<ArgumentOutOfRangeException>(
            () => CreateModifier(ModifierOperation.Less, -0.0001m),
            "Less rejects a negative ratio");
        Throws<ArgumentOutOfRangeException>(
            () => CreateModifier(ModifierOperation.Less, 1.0001m),
            "Less rejects a ratio above one");

        StatModifier CreateModifier(ModifierOperation operation, decimal value) =>
            new(
                new EntityId("modifier.foundation-probe"),
                statId,
                operation,
                value,
                source,
                priority: 0,
                stackRuleId);
    }

    private void VerifyEffectBoundaryContracts()
    {
        var casterId = new EntityId("entity.foundation-caster");
        var targetId = new EntityId("entity.foundation-target");
        var source = SourceRef.System(new EntityId("system.foundation"));
        var damageRequest = new DamageRequest(
            casterId,
            targetId,
            source,
            new EntityId("formula.foundation-damage"),
            "fire",
            baseValue: 10,
            coefficientBps: 10_000,
            tags: new[] { "fire" },
            seed: 1);
        var statusRequest = new ApplyStatusRequest(
            new EntityId("status.foundation-burn"),
            targetId,
            source,
            stackDelta: 1);
        var damage = new DamageEffectOperation(
            new EntityId("effect.foundation-damage"),
            damageRequest);

        Throws<ArgumentNullException>(
            () => _ = new DamageEffectOperation(
                new EntityId("effect.foundation-null-damage"),
                null!),
            "DamageEffectOperation rejects a null request");
        Throws<ArgumentNullException>(
            () => _ = damage with { Request = null! },
            "DamageEffectOperation rejects a null request through record copy");
        Throws<ArgumentNullException>(
            () => _ = new ApplyStatusEffectOperation(
                new EntityId("effect.foundation-null-status"),
                null!),
            "ApplyStatusEffectOperation rejects a null request");
        var applyStatus = new ApplyStatusEffectOperation(
            new EntityId("effect.foundation-status"),
            statusRequest);
        Throws<ArgumentNullException>(
            () => _ = applyStatus with { Request = null! },
            "ApplyStatusEffectOperation rejects a null request through record copy");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new EffectBundle(
                new EntityId("effect-bundle.foundation-invalid-policy"),
                new[] { damage },
                policy: (EffectExecutionPolicy)int.MaxValue),
            "EffectBundle rejects an undefined policy");

        var duplicateDamage = new DamageEffectOperation(
            damage.OperationId,
            damageRequest);
        Throws<ArgumentException>(
            () => _ = new EffectBundle(
                new EntityId("effect-bundle.foundation-duplicate-operation"),
                new EffectOperation[] { damage, duplicateDamage }),
            "EffectBundle rejects duplicate operation IDs");
        Throws<ArgumentException>(
            () => _ = new EffectBundlePlan(
                new EntityId("effect-bundle-plan.foundation-duplicate-operation"),
                new EffectOperation[] { damage, duplicateDamage }),
            "EffectBundlePlan rejects duplicate operation IDs");

        var firstReaction = CreateReaction(
            "one",
            "reaction.foundation-one",
            "idempotency.foundation-one");
        Throws<ArgumentException>(
            () => _ = new EffectBundle(
                new EntityId("effect-bundle.foundation-duplicate-rule"),
                new[] { damage },
                new[]
                {
                    firstReaction,
                    CreateReaction(
                        "one",
                        "reaction.foundation-two",
                        "idempotency.foundation-two")
                }),
            "EffectBundle rejects duplicate reaction rule IDs");
        Throws<ArgumentException>(
            () => _ = new EffectBundle(
                new EntityId("effect-bundle.foundation-duplicate-reaction"),
                new[] { damage },
                new[]
                {
                    firstReaction,
                    CreateReaction(
                        "two",
                        "reaction.foundation-one",
                        "idempotency.foundation-two")
                }),
            "EffectBundle rejects duplicate reaction IDs");
        Throws<ArgumentException>(
            () => _ = new EffectBundle(
                new EntityId("effect-bundle.foundation-duplicate-idempotency"),
                new[] { damage },
                new[]
                {
                    firstReaction,
                    CreateReaction(
                        "two",
                        "reaction.foundation-two",
                        "idempotency.foundation-one")
                }),
            "EffectBundle rejects duplicate reaction idempotency keys");
        Throws<ArgumentException>(
            () => _ = new EffectBundlePlan(
                new EntityId("effect-bundle-plan.foundation-duplicate-reaction"),
                new[] { damage },
                new[]
                {
                    firstReaction,
                    CreateReaction(
                        "two",
                        "reaction.foundation-one",
                        "idempotency.foundation-two")
                }),
            "EffectBundlePlan rejects duplicate reaction IDs");
        Equal(statusRequest, applyStatus.Request, "ApplyStatusEffectOperation keeps its request");

        ReactionRule CreateReaction(
            string ruleSuffix,
            string reactionId,
            string idempotencyKey) =>
            new(
                new EntityId($"reaction-rule.foundation-{ruleSuffix}"),
                new EntityId("event-type.foundation-damage"),
                new EntityId(reactionId),
                new EntityId(idempotencyKey),
                new EntityId("handler.foundation-effect"),
                priority: 0,
                new EntityId($"order.foundation-{ruleSuffix}"),
                depth: 0,
                budgetCost: 1,
                requiresHit: true,
                requiresTargetAlive: true);
    }

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
