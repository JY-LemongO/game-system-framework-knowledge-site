using GameSystemKnowledge.Reference.Contracts;
using GameSystemKnowledge.Reference.Runtime;

namespace GameSystemKnowledge.Reference.Systems;

public sealed class FireballResolveSnapshot
{
    public FireballResolveSnapshot(
        long mana,
        long manaVersion,
        long cooldownReadyTick,
        long cooldownVersion,
        long targetShield,
        long targetShieldVersion,
        long targetHealth,
        long targetHealthVersion)
    {
        if (mana < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(mana));
        }

        if (manaVersion < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(manaVersion));
        }

        if (cooldownReadyTick < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(cooldownReadyTick));
        }

        if (cooldownVersion < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(cooldownVersion));
        }

        if (targetShield is < 0 or > int.MaxValue)
        {
            throw new ArgumentOutOfRangeException(nameof(targetShield));
        }

        if (targetShieldVersion < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(targetShieldVersion));
        }

        if (targetHealth is < 0 or > int.MaxValue)
        {
            throw new ArgumentOutOfRangeException(nameof(targetHealth));
        }

        if (targetHealthVersion < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(targetHealthVersion));
        }

        Mana = mana;
        ManaVersion = manaVersion;
        CooldownReadyTick = cooldownReadyTick;
        CooldownVersion = cooldownVersion;
        TargetShield = targetShield;
        TargetShieldVersion = targetShieldVersion;
        TargetHealth = targetHealth;
        TargetHealthVersion = targetHealthVersion;
    }

    public long Mana { get; }

    public long ManaVersion { get; }

    public long CooldownReadyTick { get; }

    public long CooldownVersion { get; }

    public long TargetShield { get; }

    public long TargetShieldVersion { get; }

    public long TargetHealth { get; }

    public long TargetHealthVersion { get; }
}

public sealed class FireballPlanningResult
{
    private FireballPlanningResult(
        SkillDecision decision,
        CommitPlan? plan)
    {
        ArgumentNullException.ThrowIfNull(decision);

        if (decision.CanExecute != (plan is not null))
        {
            throw new ArgumentException(
                "An accepted Fireball decision must carry exactly one commit plan.");
        }

        Decision = decision;
        Plan = plan;
    }

    public SkillDecision Decision { get; }

    public CommitPlan? Plan { get; }

    internal static FireballPlanningResult Planned(CommitPlan plan) =>
        new(
            SkillDecision.Accepted(),
            plan ?? throw new ArgumentNullException(nameof(plan)));

    internal static FireballPlanningResult Rejected(
        SkillDecision decision) =>
        new(
            decision is { CanExecute: false }
                ? decision
                : throw new ArgumentException(
                    "A rejected planning result requires a rejected decision.",
                    nameof(decision)),
            null);
}

public static class FireballSkillPlanner
{
    public static FireballPlanningResult ResolveAndPlan(
        SkillRequest request,
        FireballResolveSnapshot snapshot,
        ICombatResolver combatResolver)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(combatResolver);

        if (request.CasterId != FireballReferenceScenario.CasterId ||
            request.SkillId != FireballReferenceScenario.SkillDefinitionId)
        {
            throw new ArgumentException(
                "The Fireball planner only accepts its canonical caster and skill fixture.",
                nameof(request));
        }

        var admission = SkillAdmissionPolicy.Evaluate(
            request,
            new SkillAdmissionSnapshot(
                FireballReferenceScenario.TargetId,
                snapshot.TargetHealth,
                snapshot.CooldownReadyTick,
                snapshot.Mana),
            FireballReferenceScenario.ManaCost);
        if (!admission.CanExecute)
        {
            return FireballPlanningResult.Rejected(admission);
        }

        // 전투 계산은 대상·쿨다운·자원 승인이 모두 끝난 뒤에만 시작한다.
        var damage = combatResolver.Resolve(
            FireballReferenceScenario.CreateDamageRequest(request),
            FireballReferenceScenario.CreateCombatContext(
                availableTargetHp: checked((int)snapshot.TargetHealth),
                availableShield: checked((int)snapshot.TargetShield)));
        var plan = FireballReferenceScenario.CreateCommitPlan(
            request,
            snapshot,
            damage);
        return FireballPlanningResult.Planned(plan);
    }
}
