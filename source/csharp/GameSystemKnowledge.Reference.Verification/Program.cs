using GameSystemKnowledge.Reference.Contracts;
using GameSystemKnowledge.Reference.Runtime;
using GameSystemKnowledge.Reference.Systems;

namespace GameSystemKnowledge.Reference.Verification;

internal static class Program
{
    private static int Main()
    {
        try
        {
            var suite = new ContractVerificationSuite();
            suite.Run();
            Console.WriteLine($"PASS: {suite.AssertionCount} contract assertions");
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"FAIL: {exception.Message}");
            Console.Error.WriteLine(exception);
            return 1;
        }
    }
}

internal sealed class ContractVerificationSuite
{
    public int AssertionCount { get; private set; }

    public void Run()
    {
        VerifyCanonicalIdsAndSources();
        VerifyStatContracts();
        VerifySkillContracts();
        VerifyEffectAndStatusContracts();
        VerifyFireballCalculation();
        VerifyCommitAndReactionContracts();
        VerifyReactionBoundsAndOrder();
        VerifyStatusCatchUpPolicy();
    }

    private void VerifyCanonicalIdsAndSources()
    {
        Equal("skill.fireball", new EntityId("skill.fireball").Value, "canonical namespaced ID");
        Equal(
            "status-instance.rage_001",
            new EntityId("status-instance.rage_001").Value,
            "hyphenated namespace and underscored local ID are valid");
        Throws<ArgumentException>(() => _ = new EntityId("player_001"), "ID without namespace is rejected");
        Throws<ArgumentException>(() => _ = new EntityId("Skill.Fireball"), "non-canonical casing is rejected");
        Throws<ArgumentException>(() => _ = new EntityId("skill..fireball"), "empty ID segment is rejected");
        Throws<ArgumentException>(
            () => _ = new EntityId("status_instance.rage_001"),
            "namespace segment cannot contain underscores");

        var statusDefinitionId = new EntityId("status.rage");
        var statusInstanceId = new EntityId("status-instance.rage_001");
        var statusSource = SourceRef.Status(statusDefinitionId, statusInstanceId);
        Equal(statusInstanceId, statusSource.StatusInstanceId, "status source retains StatusInstanceId");
        Throws<ArgumentException>(
            () => _ = new SourceRef(SourceKind.Status, statusDefinitionId),
            "status source cannot omit StatusInstanceId");

        var skillSource = FireballReferenceScenario.SkillSource;
        Equal(SourceKind.SkillExecution, skillSource.Kind, "skill source identifies an execution");
        Equal(FireballReferenceScenario.CommandId, skillSource.InstanceId, "skill source retains command instance");
        Throws<ArgumentException>(
            () => _ = new SourceRef(SourceKind.SkillExecution, FireballReferenceScenario.SkillDefinitionId),
            "skill execution source cannot omit command instance");
    }

    private void VerifyStatContracts()
    {
        var targetStatus = new EntityId("status.burn");
        var skillTags = new[] { "magic" };
        var targetTags = new[] { "enemy" };
        var targetStatuses = new[] { targetStatus };
        var context = new StatContext(
            FireballReferenceScenario.CasterId,
            FireballReferenceScenario.TargetId,
            FireballReferenceScenario.SkillDefinitionId,
            skillTags,
            targetTags,
            targetStatuses,
            distance: 8m,
            moment: "before-damage");

        skillTags[0] = "mutated";
        targetTags[0] = "mutated";
        targetStatuses[0] = new EntityId("status.freeze");
        Equal("magic", context.SkillTags[0], "StatContext defensively copies skill tags");
        Equal("enemy", context.TargetTags[0], "StatContext defensively copies target tags");
        Equal(targetStatus, context.TargetStatuses[0], "StatContext defensively copies status IDs");
        Equal(FireballReferenceScenario.CasterId, context.OwnerId, "StatContext retains owner");
        Equal(FireballReferenceScenario.TargetId, context.TargetId, "StatContext retains target");
        Equal(8m, context.Distance, "StatContext retains distance");
        Equal("before-damage", context.Moment, "StatContext retains query moment");

        var otherOwnerId = new EntityId("entity.other");
        var statId = new EntityId("stat.spell-power");
        IStatQuery query = new DictionaryStatQuery(
            new Dictionary<(EntityId OwnerId, EntityId StatId), decimal>
            {
                [(FireballReferenceScenario.CasterId, statId)] = 120m,
                [(otherOwnerId, statId)] = 10m
            });
        Equal(120m, query.GetValue(FireballReferenceScenario.CasterId, statId, context), "stat lookup uses ownerId");
        Throws<ArgumentException>(
            () => query.GetValue(otherOwnerId, statId, context),
            "stat query rejects an owner that differs from its context");
        var otherContext = new StatContext(
            otherOwnerId,
            FireballReferenceScenario.TargetId,
            FireballReferenceScenario.SkillDefinitionId);
        Equal(10m, query.GetValue(otherOwnerId, statId, otherContext), "owners do not share stats");
        SequenceEqual(
            new[]
            {
                ModifierOperation.Add,
                ModifierOperation.PercentAdd,
                ModifierOperation.More,
                ModifierOperation.Less,
                ModifierOperation.Override
            },
            Enum.GetValues<ModifierOperation>(),
            "modifier enum matches the learning contract");

        var statusInstanceId = new EntityId("status-instance.rage.0001");
        var modifier = new StatModifier(
            new EntityId("modifier.rage.attack-power"),
            new EntityId("stat.attack-power"),
            ModifierOperation.PercentAdd,
            20m,
            SourceRef.Status(new EntityId("status.rage"), statusInstanceId),
            priority: 10,
            new EntityId("stack-rule.stack"));
        Equal(statusInstanceId, modifier.StatusInstanceId, "modifier is removable by StatusInstanceId");
        True(modifier.AppliesTo(context), "modifier without a condition applies");
    }

    private void VerifySkillContracts()
    {
        var request = FireballReferenceScenario.CreateSkillRequest();
        Equal(FireballReferenceScenario.CasterId, request.CasterId, "skill request keeps caster");
        Equal(FireballReferenceScenario.TargetId, request.TargetId, "Fireball has one explicit target");
        Equal(FireballReferenceScenario.SkillDefinitionId, request.SkillId, "skill request uses a typed skill ID");
        Equal(FireballReferenceScenario.CastTick, request.RequestedTick, "skill request keeps the simulation tick");
        Equal(61_710u, request.RootSeed, "skill request keeps the replay seed");
        Equal<SkillFailureReason?>(null, SkillDecision.Accepted().FailureReason, "accepted decision has no failure reason");
        Equal(
            SkillFailureReason.Cooldown,
            SkillDecision.Rejected(SkillFailureReason.Cooldown).FailureReason,
            "cooldown failure is canonical");
        Equal(
            SkillFailureReason.ControlLocked,
            SkillDecision.Rejected(SkillFailureReason.ControlLocked).FailureReason,
            "control-lock failure is canonical");
        SequenceEqual(
            new[]
            {
                SkillFailureReason.NotLearned,
                SkillFailureReason.OutOfResource,
                SkillFailureReason.Cooldown,
                SkillFailureReason.ControlLocked,
                SkillFailureReason.InvalidTarget,
                SkillFailureReason.Interrupted
            },
            Enum.GetValues<SkillFailureReason>(),
            "failure enum matches the learning contract");
        Throws<ArgumentException>(
            () => _ = new SkillDecision(true, SkillFailureReason.Cooldown),
            "accepted decision rejects a failure reason");
        Throws<ArgumentException>(
            () => _ = new SkillDecision(false, null),
            "rejected decision requires a failure reason");

        var effectResult = new EffectOperationResult(
            Succeeded: true,
            OperationId: new EntityId("effect-operation.verify.skill-result"));
        var skillResult = new SkillResult(
            succeeded: true,
            failureReason: null,
            effects: new[] { effectResult });
        True(skillResult.Succeeded, "successful skill result is explicit");
        Equal(1, skillResult.Effects.Count, "skill result keeps immutable effect results");
        Throws<ArgumentException>(
            () => _ = new SkillResult(true, SkillFailureReason.Cooldown),
            "successful skill result rejects a failure reason");
        Throws<ArgumentException>(
            () => _ = new SkillResult(false, null),
            "failed skill result requires a failure reason");
    }

    private void VerifyEffectAndStatusContracts()
    {
        var effectContext = FireballReferenceScenario.CreateEffectContext();
        Equal(FireballReferenceScenario.CasterId, effectContext.CasterId, "effect context keeps caster");
        Equal(FireballReferenceScenario.TargetId, effectContext.InitialTargetId, "effect context keeps initial target");
        Equal(FireballReferenceScenario.SkillSource, effectContext.Source, "effect context keeps structured source");
        Equal(61_710, effectContext.RandomSeed, "effect context keeps deterministic seed");

        var damageRequest = FireballReferenceScenario.CreateDamageRequest();
        var bundle = FireballReferenceScenario.CreateEffectBundle(damageRequest);
        Equal(EffectExecutionPolicy.CommitThenReact, bundle.Policy, "effect bundle uses CommitThenReact");
        Equal(1, bundle.Effects.Count, "Fireball bundle carries one primary damage effect");
        Equal(1, bundle.Reactions.Count, "Fireball bundle carries one Burn reaction rule");

        var plan = new EffectBundlePlan(
            bundle.BundleId,
            bundle.Effects,
            bundle.Reactions);
        Equal(bundle.BundleId, plan.BundleId, "effect plan keeps its bundle identity");
        Equal(1, plan.PrimaryOperations.Count, "effect plan keeps target-resolved primary operations");
        Equal(1, plan.Reactions.Count, "effect plan keeps post-commit reaction rules");
        Throws<ArgumentException>(
            () => _ = new EffectBundlePlan(
                bundle.BundleId,
                Array.Empty<EffectOperation>()),
            "effect plan requires at least one primary operation");
        Equal(
            FireballReferenceScenario.DamageCommittedEventTypeId,
            bundle.Reactions[0].TriggerEventTypeId,
            "Burn rule listens to a committed damage fact");
        Equal(new EntityId("effect.apply-burn"), bundle.Reactions[0].HandlerId, "Burn uses the Effect handler");
        True(bundle.Reactions[0].RequiresHit, "Burn rule requires Hit");
        True(bundle.Reactions[0].RequiresTargetAlive, "Burn rule requires a living target");

        var applyStatus = new ApplyStatusRequest(
            FireballReferenceScenario.BurnDefinitionId,
            FireballReferenceScenario.TargetId,
            FireballReferenceScenario.SkillSource,
            stackDelta: 1);
        Equal(FireballReferenceScenario.BurnDefinitionId, applyStatus.StatusId, "status ID is explicit");
        Equal(FireballReferenceScenario.TargetId, applyStatus.TargetId, "status target is explicit");
        Equal(1, applyStatus.StackDelta, "status stack delta is explicit");
        Equal(6, FireballReferenceScenario.BurnDurationTicks, "Burn duration is six ticks");
        Equal(2, FireballReferenceScenario.BurnTickInterval, "Burn ticks every two ticks");
        Throws<ArgumentOutOfRangeException>(
            () => _ = new ApplyStatusRequest(
                FireballReferenceScenario.BurnDefinitionId,
                FireballReferenceScenario.TargetId,
                FireballReferenceScenario.SkillSource,
                stackDelta: 0),
            "status request must change stacks");
    }

    private void VerifyFireballCalculation()
    {
        ICombatResolver resolver = new CombatResolver();
        var request = FireballReferenceScenario.CreateDamageRequest();
        Equal(FireballReferenceScenario.FormulaId, request.FormulaId, "Fireball uses a typed formula ID");
        Equal(FireballReferenceScenario.CasterId, request.AttackerId, "Fireball fixture uses entity.caster");
        Equal(FireballReferenceScenario.TargetId, request.DefenderId, "Fireball fixture uses entity.target");

        var formulaDamage = RoundDamage(
            request.BaseValue +
            (FireballReferenceScenario.CreateCombatContext().ScalingStatValue *
             request.CoefficientBps / 10_000m));
        Equal(168, formulaDamage, "Fireball base formula stage");

        var result = resolver.Resolve(request, FireballReferenceScenario.CreateCombatContext());
        Equal(HitOutcome.Hit, result.Outcome, "Fireball resolves as Hit");
        Equal(252, result.RawDamage, "raw damage includes the critical stage");
        Equal(202, result.ResolvedDamage, "Fireball resistance result");
        Equal(40, result.ShieldAbsorbed, "Fireball shield absorption");
        Equal(162, result.FinalHpDamage, "Fireball health damage");
        Equal(0, result.Overkill, "normal Fireball has no overkill");
        Equal(
            result.ResolvedDamage,
            result.ShieldAbsorbed + result.FinalHpDamage + result.Overkill,
            "damage conservation includes overkill");

        var lethal = resolver.Resolve(
            request,
            FireballReferenceScenario.CreateCombatContext(availableTargetHp: 50));
        Equal(50, lethal.FinalHpDamage, "lethal damage is capped by available target HP");
        Equal(112, lethal.Overkill, "post-shield damage beyond target HP becomes overkill");
        Equal(
            lethal.ResolvedDamage,
            lethal.ShieldAbsorbed + lethal.FinalHpDamage + lethal.Overkill,
            "lethal damage also conserves resolved damage");

        var blocked = resolver.Resolve(request, FireballReferenceScenario.CreateCombatContext(HitOutcome.Blocked));
        var missed = resolver.Resolve(request, FireballReferenceScenario.CreateCombatContext(HitOutcome.Miss));
        Equal(HitOutcome.Blocked, blocked.Outcome, "Block remains a distinct outcome");
        Equal(HitOutcome.Miss, missed.Outcome, "Miss remains a distinct outcome");
        True(blocked.Outcome != missed.Outcome, "Block is not collapsed into Miss");
        Equal(0, blocked.FinalHpDamage, "reference Block policy prevents health damage");
        Equal(0, blocked.Overkill, "non-hit outcomes cannot produce overkill");
    }

    private void VerifyCommitAndReactionContracts()
    {
        ICombatResolver resolver = new CombatResolver();
        var damage = resolver.Resolve(
            FireballReferenceScenario.CreateDamageRequest(),
            FireballReferenceScenario.CreateCombatContext());
        var bundle = FireballReferenceScenario.CreateEffectBundle(
            FireballReferenceScenario.CreateDamageRequest());
        var plan = FireballReferenceScenario.CreateCommitPlan(damage);
        Equal(4, plan.Mutations.Count, "one plan contains mana, cooldown, shield, and HP changes");
        Equal(4, plan.Preconditions.Count, "each mutated resource has a version check");
        Equal(2, plan.OutboxEvents.Count, "one atomic plan carries skill and damage facts");
        True(plan.OutboxEvents[0] is SkillCommitted, "SkillCommitted is planned first");
        True(plan.OutboxEvents[1] is DamageCommitted, "DamageCommitted is planned second");

        var committer = new InMemoryRuntimeCommitter(
            FireballReferenceScenario.CreateInitialState());
        var committed = committer.Commit(plan);
        Equal(CommitStatus.Committed, committed.Status, "first command commits");
        Equal(80L, committer.GetValue(FireballReferenceScenario.ManaResourceId), "commit spends mana");
        Equal(
            FireballReferenceScenario.CooldownReadyTick,
            committer.GetValue(FireballReferenceScenario.CooldownResourceId),
            "commit sets cooldown ready tick");
        Equal(0L, committer.GetValue(FireballReferenceScenario.TargetShieldResourceId), "commit consumes shield");
        Equal(338L, committer.GetValue(FireballReferenceScenario.TargetHealthResourceId), "commit subtracts HP damage");
        Equal(5L, committer.GetVersion(FireballReferenceScenario.ManaResourceId), "mana version advances");
        Equal(3L, committer.GetVersion(FireballReferenceScenario.CooldownResourceId), "cooldown version advances");
        Equal(8L, committer.GetVersion(FireballReferenceScenario.TargetShieldResourceId), "shield version advances");
        Equal(8L, committer.GetVersion(FireballReferenceScenario.TargetHealthResourceId), "HP version advances");
        Equal(2, committed.OutboxEvents.Count, "successful commit exposes both outbox facts");
        Equal(1L, committed.OutboxEvents[0].Sequence, "outbox sequence is stable");
        Equal(2L, committed.OutboxEvents[1].Sequence, "damage follows skill in outbox order");
        True(committed.OutboxEvents[0].Event is SkillCommitted, "committed order starts with SkillCommitted");
        True(committed.OutboxEvents[1].Event is DamageCommitted, "committed order continues with DamageCommitted");
        var damageFact = (DamageCommitted)committed.OutboxEvents[1].Event;
        Equal(338L, damageFact.TargetHpAfter, "committed damage retains target HP-after");
        Equal(2, committer.GetOutbox().Count, "state and both outbox facts are stored together");

        var reactions = FireballReferenceScenario.CreateReactionCommands(
            bundle,
            committed.OutboxEvents[1]);
        Equal(1, reactions.Count, "committed damage derives one Burn reaction command");
        Equal(FireballReferenceScenario.BurnReactionId, reactions[0].ReactionId, "Burn reaction preserves identity");
        Equal(new EntityId("effect.apply-burn"), reactions[0].HandlerId, "Burn command uses the rule handler");
        Equal(
            FireballReferenceScenario.BurnIdempotencyKey,
            reactions[0].IdempotencyKey,
            "Burn command carries a separate idempotency key");
        var burnRequest = FireballReferenceScenario.CreateBurnRequest(reactions[0]);
        Equal(FireballReferenceScenario.BurnDefinitionId, burnRequest.StatusId, "reaction creates Burn request");
        Equal(FireballReferenceScenario.TargetId, burnRequest.TargetId, "Burn targets the damaged entity");
        Equal(
            0,
            FireballReferenceScenario.CreateReactionCommands(bundle, committed.OutboxEvents[0]).Count,
            "SkillCommitted does not trigger the damage reaction rule");

        var lethalDamage = resolver.Resolve(
            FireballReferenceScenario.CreateDamageRequest(),
            FireballReferenceScenario.CreateCombatContext(availableTargetHp: 50));
        var lethalFact = new CommittedOutboxEvent(
            Sequence: 99,
            new DamageCommitted(
                new EntityId("event.damage-committed.fireball.lethal"),
                FireballReferenceScenario.CommandId,
                FireballReferenceScenario.CasterId,
                FireballReferenceScenario.TargetId,
                FireballReferenceScenario.SkillSource,
                lethalDamage,
                TargetHpAfter: 0));
        Equal(
            0,
            FireballReferenceScenario.CreateReactionCommands(bundle, lethalFact).Count,
            "lethal damage does not apply Burn to a dead target");

        var duplicate = committer.Commit(plan);
        Equal(CommitStatus.DuplicateCommand, duplicate.Status, "duplicate command is idempotent");
        Equal(0, duplicate.OutboxEvents.Count, "duplicate does not append outbox facts again");
        Equal(338L, committer.GetValue(FireballReferenceScenario.TargetHealthResourceId), "duplicate does not mutate state");
        Equal(2, committer.GetOutbox().Count, "duplicate leaves outbox unchanged");

        var staleCommandId = new EntityId("command.fireball.cast.0002");
        var stalePlan = new CommitPlan(
            staleCommandId,
            plan.Preconditions,
            plan.Mutations,
            new DomainEvent[]
            {
                new SkillCommitted(
                    new EntityId("event.skill-committed.fireball.0002"),
                    staleCommandId,
                    FireballReferenceScenario.CasterId,
                    FireballReferenceScenario.SkillDefinitionId,
                    FireballReferenceScenario.TargetId,
                    FireballReferenceScenario.SkillSource),
                new DamageCommitted(
                    new EntityId("event.damage-committed.fireball.0002"),
                    staleCommandId,
                    FireballReferenceScenario.CasterId,
                    FireballReferenceScenario.TargetId,
                    FireballReferenceScenario.SkillSource,
                    damage,
                    TargetHpAfter: 338)
            });
        var stale = committer.Commit(stalePlan);
        Equal(CommitStatus.PreconditionFailed, stale.Status, "stale version is rejected");
        Equal(0, stale.OutboxEvents.Count, "failed commit does not append an outbox fact");
        Equal(80L, committer.GetValue(FireballReferenceScenario.ManaResourceId), "failed commit rolls back mana");
        Equal(338L, committer.GetValue(FireballReferenceScenario.TargetHealthResourceId), "failed commit rolls back HP");
        Equal(2, committer.GetOutbox().Count, "failed commit leaves outbox unchanged");
    }

    private void VerifyReactionBoundsAndOrder()
    {
        var dispatched = new List<EntityId>();
        var queue = new DeterministicBoundedReactionQueue(
            maxReactions: 4,
            maxDepth: 2,
            maxBudget: 10,
            command => dispatched.Add(command.ReactionId));
        var source = FireballReferenceScenario.SkillSource;
        var actual = new ReactionCommand(
            FireballReferenceScenario.BurnReactionId,
            FireballReferenceScenario.BurnIdempotencyKey,
            new EntityId("effect.apply-burn"),
            FireballReferenceScenario.TargetId,
            source,
            100,
            new EntityId("order.fireball.burn.0001"),
            depth: 1,
            budgetCost: 1);
        var alpha = CreateTestReaction("alpha", priority: 50, order: "a", depth: 1, budgetCost: 2);
        var beta = CreateTestReaction("beta", priority: 50, order: "b", depth: 1, budgetCost: 2);
        var duplicateKey = CreateTestReaction(
            "different-reaction",
            priority: 1,
            order: "first",
            depth: 1,
            budgetCost: 1,
            idempotencySuffix: "alpha");

        queue.Enqueue(actual);
        queue.Enqueue(beta);
        queue.Enqueue(alpha);
        queue.Enqueue(duplicateKey);
        Equal(3, queue.PendingCount, "duplicate idempotency key is ignored even with another reaction ID");
        Equal(5, queue.PendingBudget, "pending queue tracks separate budget cost");
        Equal(
            3,
            queue.Drain(new ReactionBudget(maxReactions: 4, maxDepth: 1, maxBudget: 5)),
            "one drain completes the accepted causation wave");
        SequenceEqual(
            new[] { alpha.ReactionId, beta.ReactionId, actual.ReactionId },
            dispatched,
            "ascending priority and stable order key determine dispatch order");
        Equal(0, queue.PendingCount, "completed wave leaves no deferred reaction");
        Equal(0, queue.PendingBudget, "completed wave consumes all pending budget");
        queue.Enqueue(actual);
        Equal(0, queue.PendingCount, "processed idempotency key remains suppressed");

        var nestedDispatched = new List<EntityId>();
        var root = CreateTestReaction("nested-root", priority: 30, order: "root", depth: 0, budgetCost: 1);
        var child = CreateTestReaction("nested-child", priority: 20, order: "child", depth: 1, budgetCost: 1);
        var grandchild = CreateTestReaction("nested-grandchild", priority: 10, order: "grandchild", depth: 2, budgetCost: 1);
        DeterministicBoundedReactionQueue nestedQueue = null!;
        nestedQueue = new DeterministicBoundedReactionQueue(
            maxReactions: 3,
            maxDepth: 2,
            maxBudget: 3,
            command =>
            {
                nestedDispatched.Add(command.ReactionId);
                if (command.ReactionId == root.ReactionId)
                {
                    nestedQueue.Enqueue(child);
                }
                else if (command.ReactionId == child.ReactionId)
                {
                    nestedQueue.Enqueue(grandchild);
                }
            });
        nestedQueue.Enqueue(root);
        Equal(
            3,
            nestedQueue.Drain(new ReactionBudget(3, 2, 3)),
            "reactions enqueued by dispatch stay in the same causation wave");
        SequenceEqual(
            new[] { root.ReactionId, child.ReactionId, grandchild.ReactionId },
            nestedDispatched,
            "nested reactions are dispatched before the wave closes");
        Equal(0, nestedQueue.PendingCount, "nested wave leaves no work for a later drain");

        var exhaustedQueue = new DeterministicBoundedReactionQueue(2, 2, 6, _ => { });
        var expensive = CreateTestReaction("expensive", priority: 1, order: "a", depth: 2, budgetCost: 3);
        exhaustedQueue.Enqueue(expensive);
        Throws<InvalidOperationException>(
            () => exhaustedQueue.Drain(new ReactionBudget(1, 2, 2)),
            "a drain budget that cannot complete the wave fails explicitly");
        Equal(0, exhaustedQueue.PendingCount, "budget-exhausted work is discarded instead of deferred");
        Equal(
            0,
            exhaustedQueue.Drain(new ReactionBudget(1, 2, 3)),
            "discarded exhausted work cannot run on a later drain");

        var limitRoot = CreateTestReaction("limit-root", priority: 1, order: "a", depth: 0, budgetCost: 1);
        var limitChild = CreateTestReaction("limit-child", priority: 2, order: "b", depth: 1, budgetCost: 1);
        DeterministicBoundedReactionQueue limitQueue = null!;
        limitQueue = new DeterministicBoundedReactionQueue(
            maxReactions: 1,
            maxDepth: 1,
            maxBudget: 2,
            command =>
            {
                try
                {
                    limitQueue.Enqueue(limitChild);
                }
                catch (InvalidOperationException)
                {
                    // Even a handler that swallows the local Enqueue exception cannot
                    // hide a causation-wave bound violation from Drain.
                }
            });
        limitQueue.Enqueue(limitRoot);
        Throws<InvalidOperationException>(
            () => limitQueue.Drain(new ReactionBudget(1, 1, 2)),
            "nested count overflow fails the whole causation wave");
        Equal(0, limitQueue.PendingCount, "nested overflow leaves no deferred reaction");

        var throwingFirst = CreateTestReaction("throwing-first", priority: 1, order: "a", depth: 0, budgetCost: 1);
        var skippedSecond = CreateTestReaction("skipped-second", priority: 2, order: "b", depth: 0, budgetCost: 1);
        var throwingQueue = new DeterministicBoundedReactionQueue(
            2,
            1,
            2,
            command =>
            {
                if (command.ReactionId == throwingFirst.ReactionId)
                {
                    throw new InvalidOperationException("handler failure");
                }
            });
        throwingQueue.Enqueue(skippedSecond);
        throwingQueue.Enqueue(throwingFirst);
        Throws<InvalidOperationException>(
            () => throwingQueue.Drain(new ReactionBudget(2, 1, 2)),
            "dispatch exceptions are surfaced to the caller");
        Equal(0, throwingQueue.PendingCount, "dispatch failure discards undispatched reactions");
        throwingQueue.Enqueue(skippedSecond);
        Equal(0, throwingQueue.PendingCount, "discarded reaction idempotency keys remain suppressed");

        var depthQueue = new DeterministicBoundedReactionQueue(2, 2, 6, _ => { });
        Throws<InvalidOperationException>(
            () => depthQueue.Enqueue(CreateTestReaction("too-deep", 1, "z", 3, 1)),
            "queue rejects reaction beyond its depth bound");

        var capacityQueue = new DeterministicBoundedReactionQueue(1, 1, 5, _ => { });
        capacityQueue.Enqueue(CreateTestReaction("capacity-a", 1, "a", 1, 1));
        Throws<InvalidOperationException>(
            () => capacityQueue.Enqueue(CreateTestReaction("capacity-b", 1, "b", 1, 1)),
            "queue rejects work beyond its pending-count bound");

        var budgetQueue = new DeterministicBoundedReactionQueue(2, 1, 2, _ => { });
        Throws<InvalidOperationException>(
            () => budgetQueue.Enqueue(CreateTestReaction("over-budget", 1, "a", 1, 3)),
            "queue rejects work beyond its maximum pending budget");
    }

    private void VerifyStatusCatchUpPolicy()
    {
        const long currentTick = 1_000;
        var active = StatusCatchUpPolicy.Evaluate(currentTick, expiresAtTick: 1_010, 5, 3);
        Equal(3, active.TicksToExecute, "active catch-up respects the cap");
        Equal(StatusCatchUpAction.DeferRemainingTicks, active.Action, "active status defers excess ticks");
        Equal<StatusRemoveReason?>(null, active.RemoveReason, "active status remains open");

        var expiredBacklog = StatusCatchUpPolicy.Evaluate(currentTick, expiresAtTick: 999, 5, 3);
        Equal(3, expiredBacklog.TicksToExecute, "expired catch-up respects the cap");
        Equal(StatusCatchUpAction.CloseExpiredStatus, expiredBacklog.Action, "expired status closes after limited catch-up");
        Equal<StatusRemoveReason?>(
            StatusRemoveReason.CatchUpLimited,
            expiredBacklog.RemoveReason,
            "expired backlog has an explicit limited-catch-up reason");

        var withinLimit = StatusCatchUpPolicy.Evaluate(currentTick, expiresAtTick: 1_010, 2, 3);
        Equal(StatusCatchUpAction.ExecuteDueTicks, withinLimit.Action, "active ticks within the cap execute normally");

        var expiredWithinLimit = StatusCatchUpPolicy.Evaluate(currentTick, expiresAtTick: 999, 2, 3);
        Equal(2, expiredWithinLimit.TicksToExecute, "expired status executes due ticks within the cap");
        Equal(StatusCatchUpAction.CloseExpiredStatus, expiredWithinLimit.Action, "expired status closes even within the cap");
        Equal<StatusRemoveReason?>(StatusRemoveReason.Expired, expiredWithinLimit.RemoveReason, "normal expiry is explicit");

        var expiredWithoutTicks = StatusCatchUpPolicy.Evaluate(currentTick, expiresAtTick: currentTick, 0, 3);
        Equal(0, expiredWithoutTicks.TicksToExecute, "expired status may close with no due tick");
        Equal(StatusCatchUpAction.CloseExpiredStatus, expiredWithoutTicks.Action, "zero-due expired status still closes");
        Equal<StatusRemoveReason?>(StatusRemoveReason.Expired, expiredWithoutTicks.RemoveReason, "zero-due closure is normal expiry");
    }

    private static ReactionCommand CreateTestReaction(
        string suffix,
        int priority,
        string order,
        int depth,
        int budgetCost,
        string? idempotencySuffix = null) =>
        new(
            new EntityId($"reaction.test.{suffix}"),
            new EntityId($"idempotency.test.{idempotencySuffix ?? suffix}"),
            new EntityId("handler.test"),
            FireballReferenceScenario.TargetId,
            FireballReferenceScenario.SkillSource,
            priority,
            new EntityId($"order.test.{order}"),
            depth,
            budgetCost);

    private static int RoundDamage(decimal value) =>
        decimal.ToInt32(decimal.Round(value, 0, MidpointRounding.AwayFromZero));

    private void Equal<T>(T expected, T actual, string description)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
        {
            throw new InvalidOperationException(
                $"{description}: expected '{expected}', actual '{actual}'.");
        }

        AssertionCount++;
    }

    private void SequenceEqual<T>(IEnumerable<T> expected, IEnumerable<T> actual, string description)
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
