'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../runtime-kernel.js');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function errorCode(fn) {
  try { fn(); } catch (error) { return error && error.code; }
  return null;
}

const fixturePath = path.join(__dirname, '..', 'fixtures', 'fireball-golden-v1.json');
const golden = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

test('동일 입력은 replay/trace/final state가 완전히 일치한다', () => {
  const replay = G.verifyReplay();
  assert.equal(replay.match, true);
  assert.equal(replay.traceMatch, true);
  assert.equal(replay.finalStateMatch, true);
});

test('기본 Fireball 결과는 golden fixture와 일치한다', () => {
  const result = G.runFireballScenario(golden.input);
  assert.equal(result.replayHash, golden.expected.replayHash);
  assert.equal(result.traceHash, golden.expected.traceHash);
  assert.deepEqual(result.finalState, golden.expected.finalState);
  assert.deepEqual(result.resolution.outcome, golden.expected.outcome);
  assert.deepEqual(result.outbox.map(event => event.type), golden.expected.eventTypes);
  assert.equal(result.trace.length, golden.expected.traceCount);
});

test('keyed RNG는 소비 순서와 무관하다', () => {
  const randomA = new G.KeyedRandom(9917);
  const a = randomA.sampleBps(['cast.alpha', 'hit', 'entity.target']);
  const b = randomA.sampleBps(['cast.alpha', 'crit', 'entity.target']);
  const randomB = new G.KeyedRandom(9917);
  const b2 = randomB.sampleBps(['cast.alpha', 'crit', 'entity.target']);
  const a2 = randomB.sampleBps(['cast.alpha', 'hit', 'entity.target']);
  assert.equal(a, a2);
  assert.equal(b, b2);
});

test('resolve 단계는 snapshot과 input을 변경하지 않는다', () => {
  const input = G.normalizeScenarioInput();
  const store = new G.StateStore(G.createInitialState(input));
  const snapshot = store.snapshot([input.caster.id, input.target.id]);
  const command = G.createFireballCommand(input);
  const beforeSnapshot = G.canonicalStringify(snapshot);
  const beforeInput = G.canonicalStringify(input);
  G.resolveFireball({ snapshot, command, input, rng: new G.KeyedRandom(input.rootSeed) });
  assert.equal(G.canonicalStringify(snapshot), beforeSnapshot);
  assert.equal(G.canonicalStringify(input), beforeInput);
});

test('같은 command의 두 번째 commit은 거부되고 state는 유지된다', () => {
  const probe = G.demonstrateDuplicateCommand();
  assert.equal(probe.duplicateDetected, true);
  assert.equal(probe.stateUnchanged, true);
  assert.equal(probe.error.code, 'DUPLICATE_COMMAND');
});

test('resolve 뒤 entity version이 바뀌면 stale plan을 거부한다', () => {
  const probe = G.demonstrateVersionConflict();
  assert.equal(probe.rejected, true);
  assert.equal(probe.noPartialMutation, true);
  assert.equal(probe.error.code, 'VERSION_CONFLICT');
  assert.equal(probe.error.retryable, true);
});

test('commit 중 뒤쪽 operation이 실패하면 앞쪽 변경도 rollback된다', () => {
  const probe = G.demonstrateAtomicRollback();
  assert.equal(probe.rolledBack, true);
  assert.equal(probe.error.code, 'RESOURCE_OVERFLOW');
});

test('ReactionQueue는 priority, stableOrderKey, reactionId 순으로 실행한다', () => {
  const queue = new G.ReactionQueue();
  queue.enqueue({ reactionId: 'reaction.z', kind: 'probe', priority: 20, stableOrderKey: 'b' });
  queue.enqueue({ reactionId: 'reaction.b', kind: 'probe', priority: 10, stableOrderKey: 'a' });
  queue.enqueue({ reactionId: 'reaction.a', kind: 'probe', priority: 10, stableOrderKey: 'a' });
  const result = queue.drain(item => item.reactionId);
  assert.deepEqual(result.executed.map(item => item.reaction.reactionId), ['reaction.a', 'reaction.b', 'reaction.z']);
});

test('ReactionQueue는 budget을 초과한 반응을 실행하지 않는다', () => {
  const queue = new G.ReactionQueue({ maxBudget: 2, maxReactions: 10 });
  queue.enqueue({ reactionId: 'reaction.first', kind: 'probe', priority: 1, budgetCost: 2 });
  queue.enqueue({ reactionId: 'reaction.second', kind: 'probe', priority: 2, budgetCost: 1 });
  const result = queue.drain(item => item.reactionId);
  assert.equal(result.executed.length, 1);
  assert.equal(result.executed[0].reaction.reactionId, 'reaction.first');
  assert.equal(result.rejected[0].reason, 'BUDGET_EXCEEDED');
  assert.equal(result.exhausted, true);
});

test('128개 seed sweep에서 damage conservation과 비음수 자원이 유지된다', () => {
  for (let seed = 0; seed < 128; seed += 1) {
    const result = G.runFireballScenario({ rootSeed: seed, simulateStatusTicks: false });
    assert.equal(result.invariants.damageConservation, true, `seed=${seed}`);
    assert.equal(result.invariants.nonNegativeResources, true, `seed=${seed}`);
  }
});

test('Burn은 +2, +4, +6 tick 후 같은 +6 시점에 expire한다', () => {
  const result = G.runFireballScenario({ skill: { hitChanceBps: 10_000, critChanceBps: 0 } });
  const ticks = result.outbox.filter(event => event.type === 'StatusTicked').map(event => event.occurredTick - result.input.tick);
  assert.deepEqual(ticks, [2, 4, 6]);
  const lastTickIndex = result.outbox.findLastIndex(event => event.type === 'StatusTicked');
  const expireIndex = result.outbox.findLastIndex(event => event.type === 'StatusExpired');
  assert.ok(lastTickIndex < expireIndex);
  assert.equal(result.outbox[expireIndex].occurredTick - result.input.tick, 6);
});

test('miss에서도 비용과 cooldown은 commit되지만 damage/status는 없다', () => {
  const result = G.runFireballScenario({ rootSeed: 1, skill: { hitChanceBps: 0 }, simulateStatusTicks: true });
  const caster = result.finalState.entities[result.input.caster.id];
  const target = result.finalState.entities[result.input.target.id];
  assert.equal(result.resolution.outcome.hit, false);
  assert.equal(caster.resources.mana, result.input.caster.mana - result.input.skill.manaCost);
  assert.equal(caster.cooldowns[result.input.skill.definitionId], result.input.tick + result.input.skill.cooldownTicks);
  assert.equal(target.resources.hp, result.input.target.hp);
  assert.equal(target.resources.shield, result.input.target.shield);
  assert.equal(Object.keys(target.statuses).length, 0);
  assert.deepEqual(result.outbox.map(event => event.type), ['SkillCommitted', 'DamageMissed']);
});

test('모든 domain event는 correlation/causation/tick/ID 메타데이터를 가진다', () => {
  const result = G.runFireballScenario();
  for (const event of result.outbox) {
    assert.match(event.eventId, /^event\./);
    assert.match(event.correlationId, /^correlation\./);
    assert.match(event.causationId, /^(command|event)\./);
    assert.ok(Number.isSafeInteger(event.occurredTick));
    assert.equal(event.schemaVersion, G.CONTRACT_SCHEMA_VERSION);
  }
});

test('canonical serialization은 object key 입력 순서에 영향받지 않는다', () => {
  const left = { z: 3, a: { y: 2, x: 1 }, list: [{ b: 2, a: 1 }] };
  const right = { list: [{ a: 1, b: 2 }], a: { x: 1, y: 2 }, z: 3 };
  assert.equal(G.canonicalStringify(left), G.canonicalStringify(right));
  assert.equal(G.hashHex(left), G.hashHex(right));
});

test('namespaced ID가 아닌 command identifier는 계약 단계에서 거부한다', () => {
  const code = errorCode(() => G.createCommandEnvelope({ commandId: 'bad', actorId: 'entity.actor', requestedTick: 0, correlationId: 'correlation.test', payload: {} }));
  assert.equal(code, 'INVALID_ID');
});

test('Status catch-up은 instance budget에서 멈추고 만료로 닫힌다', () => {
  const result = G.runFireballScenario({
    skill: { hitChanceBps: 10_000, critChanceBps: 0 },
    burn: { durationTicks: 20, intervalTicks: 1, maxCatchUpTicks: 2 },
  });
  assert.equal(result.statusAdvance.catchUpLimited, true);
  assert.equal(result.statusAdvance.tickCount, 2);
  assert.equal(Object.keys(result.finalState.entities[result.input.target.id].statuses).length, 0);
  const expiration = result.outbox.find(event => event.type === 'StatusExpired' && event.payload.catchUpLimited);
  assert.ok(expiration);
});

test('ContextualStatCache는 target/distance가 다른 질의를 분리한다', () => {
  const cache = new G.ContextualStatCache();
  let computes = 0;
  const evaluate = context => cache.evaluate({
    entityId: 'entity.caster', statId: 'stat.damage', ownerVersion: 7,
    dependencies: ['target.id', 'target.tags', 'distanceBand'], context,
    compute: () => { computes += 1; return context.target.tags.includes('status.burning') ? 130 : 100; },
  });
  const first = evaluate({ target: { id: 'entity.a', tags: ['status.burning'] }, distanceBand: 'far' });
  const repeated = evaluate({ distanceBand: 'far', target: { tags: ['status.burning'], id: 'entity.a' } });
  const other = evaluate({ target: { id: 'entity.b', tags: [] }, distanceBand: 'near' });
  assert.equal(first.cacheHit, false);
  assert.equal(repeated.cacheHit, true);
  assert.equal(other.cacheHit, false);
  assert.equal(first.value, 130);
  assert.equal(other.value, 100);
  assert.equal(computes, 2);
  assert.notEqual(first.cacheKey, other.cacheKey);
});

test('ContextualStatCache는 ownerVersion과 명시적 invalidation을 반영한다', () => {
  const cache = new G.ContextualStatCache();
  let computes = 0;
  const query = ownerVersion => cache.evaluate({ entityId: 'entity.caster', statId: 'stat.crit', ownerVersion, dependencies: [], context: {}, compute: () => ++computes });
  assert.equal(query(1).cacheHit, false);
  assert.equal(query(1).cacheHit, true);
  assert.equal(query(2).cacheHit, false);
  assert.equal(cache.invalidateEntity('entity.caster'), 2);
  assert.equal(query(2).cacheHit, false);
  assert.equal(computes, 3);
});

test('N−2 migration은 v1→v2→v3 순차 적용되고 audit hash를 남긴다', () => {
  const registry = new G.SchemaMigrationRegistry({ currentVersion: 3, minimumSupportedVersion: 1 });
  registry.register({ migrationId: 'migration.player.v1-v2', fromVersion: 1, toVersion: 2, migrate: document => ({ ...document, schemaVersion: 2, resources: { hp: document.resources.health, mana: document.resources.mana } }) });
  registry.register({ migrationId: 'migration.player.v2-v3', fromVersion: 2, toVersion: 3, migrate: document => ({ schemaVersion: 3, playerId: document.playerId, profile: document.profile, resources: document.resources, inventory: document.inventory, migratedAtPolicy: 'logical-version-only' }) });
  const source = { schemaVersion: 1, playerId: 'player.demo', profile: { displayName: 'Aria' }, resources: { health: 420, mana: 95 }, inventory: ['item.ember-ring'] };
  const before = G.canonicalStringify(source);
  const result = registry.migrate(source);
  assert.equal(result.document.schemaVersion, 3);
  assert.equal(result.document.resources.hp, 420);
  assert.deepEqual(result.appliedMigrations.map(step => step.migrationId), ['migration.player.v1-v2', 'migration.player.v2-v3']);
  assert.equal(result.appliedMigrations.length, 2);
  assert.ok(result.appliedMigrations.every(step => /^[0-9a-f]{16}$/.test(step.beforeHash) && /^[0-9a-f]{16}$/.test(step.afterHash)));
  assert.equal(G.canonicalStringify(source), before);
});

test('필수 migration edge가 없으면 source를 바꾸지 않고 거부한다', () => {
  const registry = new G.SchemaMigrationRegistry({ currentVersion: 3, minimumSupportedVersion: 1 });
  registry.register({ migrationId: 'migration.player.v1-v2', fromVersion: 1, toVersion: 2, migrate: document => ({ ...document, schemaVersion: 2 }) });
  const source = { schemaVersion: 1, playerId: 'player.demo' };
  const before = G.canonicalStringify(source);
  assert.equal(errorCode(() => registry.migrate(source)), 'MIGRATION_STEP_MISSING');
  assert.equal(G.canonicalStringify(source), before);
});

test('극단값 조합에서도 resolved damage의 회계 gap은 정확히 0이다', () => {
  const shields = [0, 1, 40, 500];
  const hpValues = [1, 25, 500];
  const resistance = [0, 2_000, 9_999, 10_000];
  for (const shield of shields) for (const hp of hpValues) for (const fireResistanceBps of resistance) {
    const result = G.runFireballScenario({
      rootSeed: 9,
      target: { hp, maxHp: hp, shield, maxShield: Math.max(shield, 500), fireResistanceBps },
      skill: { hitChanceBps: 10_000, critChanceBps: 10_000 },
      simulateStatusTicks: false,
    });
    assert.equal(result.invariants.conservationGap, 0, `${shield}/${hp}/${fireResistanceBps}`);
    assert.equal(result.invariants.damageConservation, true);
  }
});

test('Burn applies on a surviving hit even when impact damage is fully absorbed by shield', () => {
  const result = G.runFireballScenario({
    target: { shield: 200, maxShield: 200 },
    skill: { hitChanceBps: 10_000, critChanceBps: 0 },
    simulateStatusTicks: false,
  });
  assert.equal(result.resolution.outcome.hit, true);
  assert.equal(result.resolution.outcome.hpDamage, 0);
  assert.equal(result.resolution.outcome.burn.rawTickDamage, 20);
  assert.equal(result.resolution.outcome.burn.applyWhenTargetAlive, true);
  assert.ok(result.outbox.some(event => event.type === 'StatusApplied'));
  assert.equal(Object.keys(result.finalState.entities[result.input.target.id].statuses).length, 1);
});

test('Burn tick resolves resistance and shield before committing DamageCommitted then StatusTicked', () => {
  const result = G.runFireballScenario({
    target: { shield: 150, maxShield: 200 },
    skill: { hitChanceBps: 10_000, critChanceBps: 0 },
  });
  const ticks = result.outbox.filter(event => event.type === 'StatusTicked');
  assert.equal(ticks.length, 3);
  for (const tick of ticks) {
    const index = result.outbox.indexOf(tick);
    const damage = result.outbox[index - 1];
    assert.equal(damage.type, 'DamageCommitted');
    assert.equal(damage.occurredTick, tick.occurredTick);
    assert.equal(damage.payload.periodic, true);
    assert.equal(damage.payload.rawDamage, 20);
    assert.equal(damage.payload.resistanceBps, 2_000);
    assert.equal(damage.payload.resolvedDamage, 16);
    if (tick === ticks[0]) {
      assert.equal(damage.payload.shieldAbsorbed, 16);
      assert.equal(tick.payload.hpDamage, 0);
    } else {
      assert.equal(damage.payload.shieldAbsorbed, 0);
      assert.equal(tick.payload.hpDamage, 16);
    }
  }
});

test('actor identity stays separate from the skill execution source across outcome and status', () => {
  const result = G.runFireballScenario({ skill: { hitChanceBps: 10_000, critChanceBps: 0 } });
  const expectedRef = {
    kind: 'skill-execution',
    definitionId: result.input.skill.definitionId,
    instanceId: result.command.commandId,
  };
  assert.equal(result.resolution.outcome.actorId, result.input.caster.id);
  assert.equal(result.resolution.outcome.sourceId, result.command.commandId);
  assert.deepEqual(result.resolution.outcome.sourceRef, expectedRef);
  const applied = result.outbox.find(event => event.type === 'StatusApplied');
  assert.equal(applied.payload.status.actorId, result.input.caster.id);
  assert.equal(applied.payload.status.sourceId, result.command.commandId);
  assert.deepEqual(applied.payload.status.sourceRef, expectedRef);
  const periodic = result.outbox.find(event => event.type === 'DamageCommitted' && event.payload.periodic);
  assert.equal(periodic.payload.actorId, result.input.caster.id);
  assert.equal(periodic.payload.sourceId, result.command.commandId);
  assert.deepEqual(periodic.payload.sourceRef, expectedRef);
});

test('lethal impact emits one EntityDefeated event and does not apply Burn', () => {
  const result = G.runFireballScenario({
    target: { hp: 1, maxHp: 1, shield: 0 },
    skill: { hitChanceBps: 10_000, critChanceBps: 0 },
  });
  const defeated = result.outbox.filter(event => event.type === 'EntityDefeated');
  assert.equal(defeated.length, 1);
  assert.equal(defeated[0].payload.periodic, false);
  assert.equal(defeated[0].payload.sourceId, result.command.commandId);
  assert.equal(result.outbox.some(event => event.type === 'StatusApplied'), false);
});

test('lethal Burn tick emits EntityDefeated after the committed tick damage', () => {
  const result = G.runFireballScenario({
    target: { hp: 4, maxHp: 4, shield: 0, fireResistanceBps: 9_900 },
    skill: { hitChanceBps: 10_000, critChanceBps: 0 },
    burn: { ratioBps: 10_000 },
  });
  const defeatedIndex = result.outbox.findIndex(event => event.type === 'EntityDefeated');
  assert.ok(defeatedIndex >= 0);
  assert.equal(result.outbox[defeatedIndex].payload.periodic, true);
  assert.equal(result.outbox[defeatedIndex - 1].type, 'StatusTicked');
  assert.equal(result.outbox[defeatedIndex - 2].type, 'DamageCommitted');
  assert.equal(result.finalState.entities[result.input.target.id].resources.hp, 0);
});

test('per-instance catch-up limits do not starve other due status instances', () => {
  const input = G.normalizeScenarioInput({ target: { shield: 0 } });
  const state = JSON.parse(JSON.stringify(G.createInitialState(input)));
  const sourceRef = { kind: 'skill-execution', definitionId: 'skill.fireball', instanceId: 'command.test.cast.0001' };
  const makeStatus = (instanceId, maxCatchUpTicks) => ({
    instanceId,
    definitionId: 'status.burn',
    actorId: input.caster.id,
    sourceId: sourceRef.instanceId,
    sourceRef,
    targetId: input.target.id,
    correlationId: 'correlation.test.cast.0001',
    causationId: 'event.test.damage.0001',
    dataVersion: input.dataVersion,
    appliedTick: input.tick,
    nextTickAt: input.tick + 1,
    expireTick: input.tick + 4,
    intervalTicks: 1,
    rawTickDamage: 1,
    maxCatchUpTicks,
  });
  state.entities[input.target.id].statuses = {
    'status-instance.a': makeStatus('status-instance.a', 1),
    'status-instance.b': makeStatus('status-instance.b', 2),
  };
  const store = new G.StateStore(state);
  const result = G.advanceStatuses(store, input.tick + 4);
  const ticks = store.outbox.filter(event => event.type === 'StatusTicked');
  assert.equal(result.catchUpLimited, true);
  assert.equal(result.tickCount, 3);
  assert.equal(ticks.filter(event => event.payload.statusInstanceId === 'status-instance.a').length, 1);
  assert.equal(ticks.filter(event => event.payload.statusInstanceId === 'status-instance.b').length, 2);
  assert.equal(Object.keys(store.exportState().entities[input.target.id].statuses).length, 0);
});

test('hit and critical chances reject values above 10,000 BPS', () => {
  assert.equal(errorCode(() => G.normalizeScenarioInput({ skill: { hitChanceBps: 10_001 } })), 'INTEGER_OUT_OF_RANGE');
  assert.equal(errorCode(() => G.normalizeScenarioInput({ skill: { critChanceBps: 10_001 } })), 'INTEGER_OUT_OF_RANGE');
  assert.doesNotThrow(() => G.normalizeScenarioInput({ skill: { hitChanceBps: 10_000, critChanceBps: 10_000 } }));
});

test('SourceRef keeps dot-separated IDs canonical and rejects colon-separated IDs', () => {
  assert.deepEqual(G.createSourceRef({
    kind: 'skill-execution',
    definitionId: 'skill.fireball',
    instanceId: 'command.fireball.cast.0001',
  }), {
    kind: 'skill-execution',
    definitionId: 'skill.fireball',
    instanceId: 'command.fireball.cast.0001',
  });
  assert.equal(errorCode(() => G.createSourceRef({
    kind: 'skill-execution',
    definitionId: 'skill:fireball',
    instanceId: 'command.fireball.cast.0001',
  })), 'INVALID_ID');
  assert.equal(errorCode(() => G.createSourceRef({
    kind: 'skill-execution',
    definitionId: 'skill.fireball',
    instanceId: 'command.fireball.cast.0001',
    debugLabel: 'unsupported',
  })), 'INVALID_SOURCE_REF');
});

test('dead targets are rejected before mana, cooldown, or events can commit', () => {
  const input = G.normalizeScenarioInput({ target: { hp: 0, shield: 0 } });
  const store = new G.StateStore(G.createInitialState(input));
  const command = G.createFireballCommand(input);
  const snapshot = store.snapshot([input.caster.id, input.target.id]);
  const before = G.canonicalStringify(store.exportState());
  assert.throws(() => G.resolveFireball({ snapshot, command, input, rng: new G.KeyedRandom(input.rootSeed) }), error => error.code === 'TARGET_NOT_ALIVE');
  const caster = store.getEntity(input.caster.id);
  assert.equal(caster.resources.mana, input.caster.mana);
  assert.deepEqual(caster.cooldowns, {});
  assert.equal(store.outbox.length, 0);
  assert.equal(G.canonicalStringify(store.exportState()), before);
});

test('zero and sub-interval durations expire exactly once without a tick', () => {
  for (const durationTicks of [0, 1]) {
    const result = G.runFireballScenario({
      skill: { hitChanceBps: 10_000, critChanceBps: 0 },
      burn: { durationTicks, intervalTicks: 2 },
    });
    const expirations = result.outbox.filter(event => event.type === 'StatusExpired');
    assert.equal(result.outbox.some(event => event.type === 'StatusTicked'), false, `duration=${durationTicks}`);
    assert.equal(expirations.length, 1, `duration=${durationTicks}`);
    assert.equal(expirations[0].occurredTick, result.input.tick + durationTicks);
    assert.equal(expirations[0].payload.scheduledExpireTick, result.input.tick + durationTicks);
    assert.equal(expirations[0].payload.endedTick, result.input.tick + durationTicks);
    assert.equal(expirations[0].payload.reason, 'duration-expired');
    assert.equal(Object.keys(result.finalState.entities[result.input.target.id].statuses).length, 0);
  }
});

test('mixed status ticks and no-tick expiries stay chronological and deterministic', () => {
  const input = G.normalizeScenarioInput({ target: { shield: 0, fireResistanceBps: 0 } });
  const sourceRef = { kind: 'skill-execution', definitionId: 'skill.fireball', instanceId: 'command.test.cast.0002' };
  const makeStatus = ({ instanceId, nextTickAt, expireTick }) => ({
    instanceId,
    definitionId: 'status.burn',
    actorId: input.caster.id,
    sourceId: sourceRef.instanceId,
    sourceRef,
    targetId: input.target.id,
    correlationId: 'correlation.test.cast.0002',
    causationId: 'event.test.damage.0002',
    dataVersion: input.dataVersion,
    appliedTick: input.tick,
    nextTickAt,
    expireTick,
    intervalTicks: 10,
    rawTickDamage: 1,
    maxCatchUpTicks: 8,
  });
  const createStore = () => {
    const state = JSON.parse(JSON.stringify(G.createInitialState(input)));
    state.entities[input.target.id].statuses = {
      'status-instance.late-expiry': makeStatus({ instanceId: 'status-instance.late-expiry', nextTickAt: input.tick + 10, expireTick: input.tick + 3 }),
      'status-instance.early-expiry': makeStatus({ instanceId: 'status-instance.early-expiry', nextTickAt: input.tick + 10, expireTick: input.tick + 1 }),
      'status-instance.tick-at-expiry': makeStatus({ instanceId: 'status-instance.tick-at-expiry', nextTickAt: input.tick + 2, expireTick: input.tick + 2 }),
    };
    return new G.StateStore(state);
  };
  const first = createStore();
  const second = createStore();
  G.advanceStatuses(first, input.tick + 3);
  G.advanceStatuses(second, input.tick + 3);
  assert.deepEqual(first.outbox.map(event => event.type), ['StatusExpired', 'DamageCommitted', 'StatusTicked', 'StatusExpired', 'StatusExpired']);
  assert.deepEqual(first.outbox.map(event => event.occurredTick - input.tick), [1, 2, 2, 2, 3]);
  assert.ok(first.outbox.every((event, index, events) => index === 0 || events[index - 1].occurredTick <= event.occurredTick));
  assert.equal(G.canonicalStringify(first.outbox), G.canonicalStringify(second.outbox));
  assert.equal(Object.keys(first.exportState().entities[input.target.id].statuses).length, 0);
});

test('a lethal periodic status expires other statuses without extra damage or tick events', () => {
  const input = G.normalizeScenarioInput({ target: { hp: 5, shield: 0, fireResistanceBps: 0 } });
  const state = JSON.parse(JSON.stringify(G.createInitialState(input)));
  const sourceRef = { kind: 'skill-execution', definitionId: 'skill.fireball', instanceId: 'command.test.cast.0003' };
  const makeStatus = (instanceId, rawTickDamage) => ({
    instanceId,
    definitionId: 'status.burn',
    actorId: input.caster.id,
    sourceId: sourceRef.instanceId,
    sourceRef,
    targetId: input.target.id,
    correlationId: 'correlation.test.cast.0003',
    causationId: 'event.test.damage.0003',
    dataVersion: input.dataVersion,
    appliedTick: input.tick,
    nextTickAt: input.tick + 1,
    expireTick: input.tick + 6,
    intervalTicks: 1,
    rawTickDamage,
    maxCatchUpTicks: 8,
  });
  state.entities[input.target.id].statuses = {
    'status-instance.a-lethal': makeStatus('status-instance.a-lethal', 10),
    'status-instance.b-pending': makeStatus('status-instance.b-pending', 2),
  };
  const store = new G.StateStore(state);
  G.advanceStatuses(store, input.tick + 6);
  assert.equal(store.outbox.filter(event => event.type === 'DamageCommitted').length, 1);
  assert.equal(store.outbox.filter(event => event.type === 'StatusTicked').length, 1);
  assert.equal(store.outbox.filter(event => event.type === 'EntityDefeated').length, 1);
  const expirations = store.outbox.filter(event => event.type === 'StatusExpired');
  assert.equal(expirations.length, 2);
  for (const event of expirations) {
    assert.equal(event.payload.reason, 'target-defeated');
    assert.equal(event.payload.scheduledExpireTick, input.tick + 6);
    assert.equal(event.payload.endedTick, input.tick + 1);
  }
  assert.equal(store.outbox.some(event => event.type === 'StatusTicked' && event.payload.statusInstanceId === 'status-instance.b-pending'), false);
  assert.equal(Object.keys(store.exportState().entities[input.target.id].statuses).length, 0);
});

test('damage conservation covers impact and every periodic DamageCommitted event', () => {
  const result = G.runFireballScenario({ skill: { hitChanceBps: 10_000, critChanceBps: 0 } });
  const damageEvents = result.outbox.filter(event => event.type === 'DamageCommitted');
  assert.equal(damageEvents.length, 4);
  for (const event of damageEvents) {
    assert.equal(event.payload.resolvedDamage, event.payload.shieldAbsorbed + event.payload.hpDamage + event.payload.overkill);
  }
  assert.equal(result.invariants.damageConservation, true);
  assert.equal(result.invariants.conservationGap, 0);
});

(async () => {
  let passed = 0;
  const started = Date.now();
  for (const item of tests) {
    try {
      await item.fn();
      passed += 1;
      console.log(`✓ ${item.name}`);
    } catch (error) {
      console.error(`✗ ${item.name}`);
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
    }
  }
  const durationMs = Date.now() - started;
  console.log(`\n${passed}/${tests.length} tests passed (${durationMs} ms)`);
  if (passed !== tests.length) process.exitCode = 1;
})();
