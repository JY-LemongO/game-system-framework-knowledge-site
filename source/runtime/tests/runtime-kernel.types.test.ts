import * as Runtime from '../runtime-kernel';

const input = Runtime.normalizeScenarioInput({
  simulateStatusTicks: false,
});
const store = new Runtime.StateStore(Runtime.createInitialState(input));
const snapshot = store.snapshot([input.caster.id, input.target.id]);
const command = Runtime.createFireballCommand(input);
const resolution = Runtime.resolveFireball({
  snapshot,
  command,
  input,
  rng: new Runtime.KeyedRandom(input.rootSeed),
});

const exactRawDamage: Runtime.ExactDamageScalar =
  resolution.outcome.exactRawDamage;
const committedPlan: Runtime.CommitPlan = resolution.plan;
const reactionQueue =
  new Runtime.ReactionQueue<Runtime.ApplyStatusReaction>();
const canonicalState: string =
  Runtime.canonicalStringify(store.exportState());

Runtime.enqueueReactions([], reactionQueue);
const drained = reactionQueue.drain(reaction =>
  Runtime.applyStatusReaction(store, reaction));
Runtime.resolveDamageAgainstTarget({
  actorId: input.caster.id,
  sourceId: command.commandId,
  sourceRef: {
    kind: 'skill-execution',
    definitionId: input.skill.definitionId,
    instanceId: command.commandId,
  },
  target: snapshot.entities[input.target.id],
  damageType: 'fire',
  rawDamage: 1,
  exactRawDamage: { numerator: '3', denominator: '4' },
});

void exactRawDamage;
void committedPlan;
void canonicalState;
void drained;
