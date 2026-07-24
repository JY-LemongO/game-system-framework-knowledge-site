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
function defineOwn(target, key, value) {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

// 공용 fixture는 builder 출력이 공개 wire schema의 정확한 shape을 만족하는지 고정한다.
function matchesFixtureSchema(value, schema, rootSchema = schema) {
  if (schema.$ref) {
    const pathParts = schema.$ref.replace(/^#\//, '').split('/');
    const target = pathParts.reduce((current, key) => current?.[key], rootSchema);
    return Boolean(target) && matchesFixtureSchema(value, target, rootSchema);
  }
  if (schema.anyOf) return schema.anyOf.some(item => matchesFixtureSchema(value, item, rootSchema));
  if (schema.oneOf) return schema.oneOf.filter(item => matchesFixtureSchema(value, item, rootSchema)).length === 1;
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (schema.type === 'integer') {
    return Number.isInteger(value)
      && (schema.minimum === undefined || value >= schema.minimum)
      && (schema.maximum === undefined || value <= schema.maximum);
  }
  if (schema.type === 'string') {
    return typeof value === 'string'
      && (schema.minLength === undefined || value.length >= schema.minLength)
      && (schema.pattern === undefined || new RegExp(schema.pattern).test(value));
  }
  if (schema.type === 'array') {
    return Array.isArray(value) && value.every(item => matchesFixtureSchema(item, schema.items, rootSchema));
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const properties = schema.properties ?? {};
    if ((schema.required ?? []).some(key => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(properties, key))) return false;
    return Object.entries(value).every(([key, item]) => {
      const itemSchema = properties[key] ?? schema.additionalProperties;
      return itemSchema === undefined || itemSchema === true || matchesFixtureSchema(item, itemSchema, rootSchema);
    });
  }
  return true;
}

const fixturePath = path.join(__dirname, '..', 'fixtures', 'fireball-golden-v2.json');
const golden = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const envelopeFixturePath = path.join(__dirname, 'fixtures', 'envelope-builder-conformance-v2.json');
const envelopeFixture = JSON.parse(fs.readFileSync(envelopeFixturePath, 'utf8'));
const commandEnvelopeSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'contracts', 'command-envelope.schema.json'), 'utf8'));
const domainEventEnvelopeSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'contracts', 'domain-event-envelope.schema.json'), 'utf8'));
const commitPlanSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'contracts', 'commit-plan.schema.json'), 'utf8'));
const replayFixtureSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'contracts', 'replay-fixture.schema.json'), 'utf8'));

test('동일 입력은 replay/trace/final state가 완전히 일치한다', () => {
  const replay = G.verifyReplay();
  assert.equal(replay.match, true);
  assert.equal(replay.traceMatch, true);
  assert.equal(replay.finalStateMatch, true);
});

test('기본 Fireball 결과는 golden fixture와 일치한다', () => {
  const result = G.runFireballScenario(golden.input);
  assert.equal(matchesFixtureSchema(golden, replayFixtureSchema), true);
  assert.equal(golden.runtimeVersion, G.RUNTIME_VERSION);
  assert.equal(result.header.rngKeySchemaVersion, G.RNG_KEY_SCHEMA_VERSION);
  assert.equal(result.header.clockDomain, G.CLOCK_DOMAIN);
  assert.equal(result.replayHash, golden.expected.replayHash);
  assert.equal(result.traceHash, golden.expected.traceHash);
  assert.deepEqual(result.finalState, golden.expected.finalState);
  assert.deepEqual(result.resolution.outcome, golden.expected.outcome);
  assert.deepEqual(result.outbox.map(event => event.type), golden.expected.eventTypes);
  const skillCommitted = result.outbox.find(event => event.type === 'SkillCommitted');
  assert.equal(skillCommitted.payload.manaSpent, golden.input.skill.manaCost);
  assert.equal(
    skillCommitted.payload.cooldownReadyTick,
    golden.input.tick + golden.input.skill.cooldownTicks,
  );
  const damageTraces = result.trace.filter(entry => entry.stage === 'damage_calculated');
  assert.deepEqual(damageTraces[0].payload, {
    phase: 'primary',
    formulaVersion: golden.input.formulaVersion,
    baseDamage: 24,
    scalingDamageProjection: 144,
    scalingDamageExact: { numerator: '144', denominator: '1' },
    formulaDamageProjection: 168,
    formulaDamageExact: { numerator: '168', denominator: '1' },
    criticalMultiplierBps: 15_000,
    rawDamage: 252,
    rawDamageExact: { numerator: '252', denominator: '1' },
    resistanceBps: 2_000,
    resolvedDamage: 202,
  });
  assert.equal(damageTraces.filter(entry => entry.payload.phase === 'periodic').length, 3);
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

test('integer BPS midpoint는 양수와 음수 모두 0에서 멀어지게 반올림한다', () => {
  assert.equal(G.NUMERIC_POLICY_VERSION, 'integer-bps-half-away-from-zero-v1');
  assert.equal(G.multiplyBps(1, 5_000), 1);
  assert.equal(G.multiplyBps(-1, 5_000), -1);
  assert.equal(G.multiplyBps(1, 4_999), 0);
  assert.equal(G.multiplyBps(-1, 4_999), 0);
});

test('Fireball keeps fractional formula and critical stages exact until raw and mitigation reporting boundaries', () => {
  const result = G.runFireballScenario({
    caster: { spellPower: 1 },
    target: { shield: 0, fireResistanceBps: 5_000 },
    skill: {
      baseDamage: 0,
      coefficientBps: 5_000,
      hitChanceBps: 10_000,
      critChanceBps: 10_000,
      critMultiplierBps: 15_000,
    },
    burn: { ratioBps: 0 },
    simulateStatusTicks: false,
  });

  assert.deepEqual(
    result.resolution.outcome.exactRawDamage,
    { numerator: '3', denominator: '4' },
  );
  assert.deepEqual(
    [
      result.resolution.outcome.rawDamage,
      result.resolution.outcome.resolvedDamage,
      result.resolution.outcome.finalHpDamage,
    ],
    [1, 0, 0],
  );
  const damageTrace = result.trace.find(
    entry => entry.stage === 'damage_calculated' && entry.payload.phase === 'primary',
  );
  assert.deepEqual(
    [
      damageTrace.payload.scalingDamageExact,
      damageTrace.payload.formulaDamageExact,
      damageTrace.payload.rawDamageExact,
    ],
    [
      { numerator: '1', denominator: '2' },
      { numerator: '1', denominator: '2' },
      { numerator: '3', denominator: '4' },
    ],
  );
});

test('Fireball coefficient and critical multiplier use the shared versioned BPS ranges', () => {
  assert.throws(
    () => G.normalizeScenarioInput({ skill: { coefficientBps: 100_001 } }),
    error => error.code === 'INTEGER_OUT_OF_RANGE',
  );
  assert.throws(
    () => G.normalizeScenarioInput({ skill: { critMultiplierBps: 9_999 } }),
    error => error.code === 'INTEGER_OUT_OF_RANGE',
  );
  assert.throws(
    () => G.normalizeScenarioInput({ skill: { critMultiplierBps: 100_001 } }),
    error => error.code === 'INTEGER_OUT_OF_RANGE',
  );
});

test('public damage resolver keeps every non-Hit outcome distinct while zeroing all damage', () => {
  const input = G.normalizeScenarioInput();
  const target = new G.StateStore(G.createInitialState(input)).getEntity(input.target.id);
  const sourceRef = { kind: 'skill-execution', definitionId: input.skill.definitionId, instanceId: 'command.test.non-hit.0001' };
  for (const hitOutcome of ['Miss', 'Blocked', 'Immune', 'Rejected']) {
    const outcome = G.resolveDamageAgainstTarget({ actorId: input.caster.id, sourceId: sourceRef.instanceId, sourceRef, target, damageType: 'fire', rawDamage: 100, hitOutcome });
    assert.equal(outcome.hitOutcome, hitOutcome);
    assert.deepEqual(
      [outcome.rawDamage, outcome.resolvedDamage, outcome.shieldAbsorbed, outcome.finalHpDamage, outcome.overkill],
      [0, 0, 0, 0, 0],
    );
    assert.deepEqual(outcome.exactRawDamage, { numerator: '0', denominator: '1' });
    assert.equal(outcome.targetHpAfter, target.resources.hp);
  }
});

test('public damage resolver requires flat sourceId to match the structured SourceRef', () => {
  const input = G.normalizeScenarioInput();
  const target = new G.StateStore(G.createInitialState(input)).getEntity(input.target.id);
  const skillSource = { kind: 'skill-execution', definitionId: input.skill.definitionId, instanceId: 'command.test.source-match.0001' };
  assert.throws(() => G.resolveDamageAgainstTarget({ actorId: input.caster.id, sourceId: 'command.other.cast.0001', sourceRef: skillSource, target, damageType: 'fire', rawDamage: 10 }), error => error.code === 'SOURCE_IDENTITY_MISMATCH');
  assert.doesNotThrow(() => G.resolveDamageAgainstTarget({ actorId: input.caster.id, sourceId: skillSource.instanceId, sourceRef: skillSource, target, damageType: 'fire', rawDamage: 10 }));
  assert.throws(
    () => G.resolveDamageAgainstTarget({
      actorId: input.caster.id,
      sourceId: skillSource.instanceId,
      sourceRef: skillSource,
      target,
      damageType: 'fire',
      rawDamage: 10,
      exactRawDamage: { numerator: '21', denominator: '2' },
    }),
    error => error.code === 'EXACT_DAMAGE_MISMATCH',
  );
  for (const exactRawDamage of [
    { numerator: '2', denominator: '2' },
    { numerator: '01', denominator: '1' },
    { numerator: '1', denominator: '0' },
    { numerator: '1' },
    { numerator: '1', denominator: '1', unsupported: true },
    { numerator: '1'.repeat(129), denominator: '1' },
  ]) {
    assert.throws(
      () => G.resolveDamageAgainstTarget({
        actorId: input.caster.id,
        sourceId: skillSource.instanceId,
        sourceRef: skillSource,
        target,
        damageType: 'fire',
        rawDamage: 1,
        exactRawDamage,
      }),
      error => error.code === 'INVALID_EXACT_DAMAGE',
    );
  }
  const systemSource = { kind: 'system', definitionId: 'system.weather' };
  assert.doesNotThrow(() => G.resolveDamageAgainstTarget({ actorId: input.caster.id, sourceId: systemSource.definitionId, sourceRef: systemSource, target, damageType: 'fire', rawDamage: 10 }));
  assert.throws(() => G.resolveDamageAgainstTarget({ actorId: input.caster.id, sourceId: 'system.other', sourceRef: systemSource, target, damageType: 'fire', rawDamage: 10 }), error => error.code === 'SOURCE_IDENTITY_MISMATCH');
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

test('Fireball resolve binds command actor, tick, data version, target, and skill to its authoritative input before RNG', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const store = new G.StateStore(G.createInitialState(input));
  const snapshot = store.snapshot([input.caster.id, input.target.id]);
  const command = G.createFireballCommand(input);
  const before = G.canonicalStringify(store.exportState());
  let rolls = 0;
  const rng = { sampleBps: () => { rolls += 1; return 0; } };
  const probes = [
    { ...command, actorId: input.target.id },
    { ...command, requestedTick: input.tick + 1 },
    { ...command, dataVersion: 'data.forged' },
    { ...command, payload: { ...command.payload, targetId: input.caster.id } },
    { ...command, payload: { ...command.payload, skillDefinitionId: 'skill.forged' } },
    { ...command, payload: { ...command.payload, extraAuthority: 'forbidden' } },
    { ...command, payload: { targetId: command.payload.targetId } },
  ];
  for (const forged of probes) {
    assert.throws(
      () => G.resolveFireball({ snapshot, command: forged, input, rng }),
      error => error.code === 'COMMAND_INPUT_MISMATCH',
    );
  }
  assert.equal(rolls, 0);
  assert.equal(G.canonicalStringify(store.exportState()), before);
  assert.equal(store.outbox.length, 0);
});

test('Trace observers receive immutable payload snapshots and cannot alter resolution decisions', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  let mutationError = null;
  const impact = G.executeImpact(input, {
    record(stage, tick, payload) {
      if (stage !== 'random_decisions') return;
      try { payload.hitKey[0] = 'correlation.tampered'; } catch (error) { mutationError = error; }
    },
  });
  assert.ok(mutationError instanceof TypeError);
  assert.equal(impact.resolution.decisions.hitKey[0], 'correlation.fireball.cast.0001');
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

test('mutation entity의 version precondition이 없으면 commit 전에 거부한다', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const store = new G.StateStore(G.createInitialState(input));
  const command = G.createCommandEnvelope({ commandId: 'command.test.precondition-coverage.0001', actorId: input.caster.id, requestedTick: input.tick, correlationId: 'correlation.test.precondition-coverage.0001', dataVersion: input.dataVersion, payload: {} });
  const before = G.canonicalStringify(store.exportState());
  const plan = { schemaVersion: G.CONTRACT_SCHEMA_VERSION, planId: 'plan.test.precondition-coverage.0001', commandId: command.commandId, commitTick: input.tick, preconditions: [], operations: [{ order: 10, kind: 'resource.delta', entityId: input.target.id, resource: 'hp', delta: -1, key: 'hp' }], eventBlueprints: [] };
  assert.throws(() => store.commit(command, plan), error => error.code === 'MISSING_VERSION_PRECONDITION');
  assert.equal(G.canonicalStringify(store.exportState()), before);
  assert.equal(store.outbox.length, 0);

  const target = store.getEntity(input.target.id);
  const committed = store.commit(command, { ...plan, preconditions: [{ entityId: target.id, expectedVersion: target.version }] });
  assert.equal(committed.state.entities[target.id].resources.hp, target.resources.hp - 1);
});

test('같은 entity의 version precondition이 중복되면 mutation 전에 거부한다', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const store = new G.StateStore(G.createInitialState(input));
  const target = store.getEntity(input.target.id);
  const command = G.createCommandEnvelope({ commandId: 'command.test.duplicate-precondition.0001', actorId: input.caster.id, requestedTick: input.tick, correlationId: 'correlation.test.duplicate-precondition.0001', dataVersion: input.dataVersion, payload: {} });
  const before = G.canonicalStringify(store.exportState());
  const duplicate = { entityId: target.id, expectedVersion: target.version };
  const plan = { schemaVersion: G.CONTRACT_SCHEMA_VERSION, planId: 'plan.test.duplicate-precondition.0001', commandId: command.commandId, commitTick: input.tick, preconditions: [duplicate, { ...duplicate }], operations: [{ order: 10, kind: 'resource.delta', entityId: target.id, resource: 'hp', delta: -1, key: 'hp' }], eventBlueprints: [] };
  assert.throws(() => store.commit(command, plan), error => error.code === 'DUPLICATE_VERSION_PRECONDITION');
  assert.equal(G.canonicalStringify(store.exportState()), before);
  assert.equal(store.outbox.length, 0);
});

test('read-only snapshot entity의 추가 precondition은 허용한다', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const store = new G.StateStore(G.createInitialState(input));
  const caster = store.getEntity(input.caster.id);
  const target = store.getEntity(input.target.id);
  const command = G.createCommandEnvelope({ commandId: 'command.test.read-only-precondition.0001', actorId: caster.id, requestedTick: input.tick, correlationId: 'correlation.test.read-only-precondition.0001', dataVersion: input.dataVersion, payload: {} });
  const plan = { schemaVersion: G.CONTRACT_SCHEMA_VERSION, planId: 'plan.test.read-only-precondition.0001', commandId: command.commandId, commitTick: input.tick, preconditions: [{ entityId: caster.id, expectedVersion: caster.version }, { entityId: target.id, expectedVersion: target.version }], operations: [{ order: 10, kind: 'resource.delta', entityId: caster.id, resource: 'mana', delta: -1, key: 'mana' }], eventBlueprints: [] };
  store.commit(command, plan);
  assert.equal(store.getEntity(caster.id).version, caster.version + 1);
  assert.equal(store.getEntity(target.id).version, target.version);
});

test('StateStore는 null plan 배열을 commit 전에 거부하고 command를 미처리 상태로 둔다', () => {
  for (const field of ['preconditions', 'operations', 'eventBlueprints']) {
    const suffix = field.toLowerCase();
    const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
    const store = new G.StateStore(G.createInitialState(input));
    const target = store.getEntity(input.target.id);
    const command = G.createCommandEnvelope({ commandId: `command.test.null-${suffix}.0001`, actorId: input.caster.id, requestedTick: input.tick, correlationId: `correlation.test.null-${suffix}.0001`, dataVersion: input.dataVersion, payload: {} });
    const validPlan = { schemaVersion: G.CONTRACT_SCHEMA_VERSION, planId: `plan.test.null-${suffix}.0001`, commandId: command.commandId, commitTick: input.tick, preconditions: [{ entityId: target.id, expectedVersion: target.version }], operations: [{ order: 10, kind: 'resource.delta', entityId: target.id, resource: 'hp', delta: -1, key: 'hp' }], eventBlueprints: [] };
    const before = G.canonicalStringify(store.exportState());
    assert.throws(() => store.commit(command, { ...validPlan, [field]: null }), error => error.code === 'INVALID_COMMIT_PLAN');
    assert.equal(G.canonicalStringify(store.exportState()), before);
    assert.equal(store.outbox.length, 0);
    store.commit(command, validPlan);
    assert.equal(store.getEntity(target.id).resources.hp, target.resources.hp - 1);
  }
});

test('StateStore는 유효하지 않은 commitTick을 mutation 전에 거부한다', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const store = new G.StateStore(G.createInitialState(input));
  const target = store.getEntity(input.target.id);
  const command = G.createCommandEnvelope({ commandId: 'command.test.invalid-commit-tick.0001', actorId: input.caster.id, requestedTick: input.tick, correlationId: 'correlation.test.invalid-commit-tick.0001', dataVersion: input.dataVersion, payload: {} });
  const validPlan = { schemaVersion: G.CONTRACT_SCHEMA_VERSION, planId: 'plan.test.invalid-commit-tick.0001', commandId: command.commandId, commitTick: input.tick, preconditions: [{ entityId: target.id, expectedVersion: target.version }], operations: [{ order: 10, kind: 'resource.delta', entityId: target.id, resource: 'hp', delta: -1, key: 'hp' }], eventBlueprints: [] };
  const before = G.canonicalStringify(store.exportState());
  const tickBefore = store.tick;
  assert.throws(() => store.commit(command, { ...validPlan, commitTick: undefined }), error => error.code === 'UNSERIALIZABLE_VALUE');
  assert.equal(G.canonicalStringify(store.exportState()), before);
  assert.equal(store.tick, tickBefore);
  assert.equal(store.outbox.length, 0);
  store.commit(command, validPlan);
  assert.equal(store.getEntity(target.id).resources.hp, target.resources.hp - 1);
});

test('StateStore는 과거 commitTick을 거부하고 trace observer 실패와 무관하게 commit한다', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const store = new G.StateStore(G.createInitialState(input));
  const target = store.getEntity(input.target.id);
  const command = G.createCommandEnvelope({ commandId: 'command.test.tick-regression.0001', actorId: input.caster.id, requestedTick: input.tick - 1, correlationId: 'correlation.test.tick-regression.0001', dataVersion: input.dataVersion, payload: {} });
  const plan = { schemaVersion: G.CONTRACT_SCHEMA_VERSION, planId: 'plan.test.tick-regression.0001', commandId: command.commandId, commitTick: input.tick - 1, preconditions: [{ entityId: target.id, expectedVersion: target.version }], operations: [{ order: 10, kind: 'resource.delta', entityId: target.id, resource: 'hp', delta: -1, key: 'hp' }], eventBlueprints: [] };
  const before = G.canonicalStringify(store.exportState());
  assert.throws(() => store.commit(command, plan), error => error.code === 'COMMIT_TICK_REGRESSION');
  assert.equal(G.canonicalStringify(store.exportState()), before);

  const committed = store.commit(command, { ...plan, commitTick: input.tick }, { record: () => { throw new Error('trace sink unavailable'); } });
  assert.equal(committed.state.entities[target.id].resources.hp, target.resources.hp - 1);
  assert.throws(() => store.commit(command, { ...plan, commitTick: input.tick }), error => error.code === 'DUPLICATE_COMMAND');
});

test('StateStore commit은 canonical command와 plan 전체 schema를 mutation 전에 강제한다', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const probe = (mutateCommand, mutatePlan, expectedCode) => {
    const store = new G.StateStore(G.createInitialState(input));
    const target = store.getEntity(input.target.id);
    const command = G.createCommandEnvelope({
      commandId: 'command.test.canonical-boundary.0001',
      actorId: input.caster.id,
      requestedTick: input.tick,
      correlationId: 'correlation.test.canonical-boundary.0001',
      dataVersion: input.dataVersion,
      payload: { targetId: target.id, resource: 'hp', delta: -1 },
    });
    const plan = {
      schemaVersion: G.CONTRACT_SCHEMA_VERSION,
      planId: 'plan.test.canonical-boundary.0001',
      commandId: command.commandId,
      commitTick: input.tick,
      preconditions: [{ entityId: target.id, expectedVersion: target.version }],
      operations: [{ order: 10, kind: 'resource.delta', entityId: target.id, resource: 'hp', delta: -1, key: 'hp' }],
      eventBlueprints: [{
        type: 'ExternalStateChanged',
        payload: { targetId: target.id, resource: 'hp', delta: -1 },
      }],
    };
    const invalidCommand = mutateCommand ? mutateCommand({ ...command }) : command;
    const invalidPlan = mutatePlan ? mutatePlan({ ...plan }) : plan;
    const before = G.canonicalStringify(store.exportState());
    const tickBefore = store.tick;
    assert.throws(() => store.commit(invalidCommand, invalidPlan), error => error.code === expectedCode);
    assert.equal(G.canonicalStringify(store.exportState()), before);
    assert.equal(store.tick, tickBefore);
    assert.equal(store.outbox.length, 0);
    const committed = store.commit(command, plan);
    assert.equal(committed.state.entities[target.id].resources.hp, target.resources.hp - 1);
    assert.equal(store.outbox.length, 1);
  };

  for (const field of ['schemaVersion', 'commandId', 'actorId', 'requestedTick', 'correlationId', 'causationId', 'dataVersion', 'payload']) {
    probe(command => { delete command[field]; return command; }, null, 'INVALID_COMMAND');
  }
  for (const field of ['schemaVersion', 'planId', 'commandId', 'commitTick', 'preconditions', 'operations', 'eventBlueprints']) {
    probe(null, plan => { delete plan[field]; return plan; }, 'INVALID_COMMIT_PLAN');
  }
  probe(command => ({ ...command, schemaVersion: G.CONTRACT_SCHEMA_VERSION + 1 }), null, 'SCHEMA_VERSION_UNSUPPORTED');
  probe(null, plan => ({ ...plan, schemaVersion: G.CONTRACT_SCHEMA_VERSION + 1 }), 'SCHEMA_VERSION_UNSUPPORTED');
  probe(command => ({ ...command, schemaVersion: G.CONTRACT_SCHEMA_VERSION - 1 }), null, 'SCHEMA_VERSION_UNSUPPORTED');
  probe(null, plan => ({ ...plan, schemaVersion: G.CONTRACT_SCHEMA_VERSION - 1 }), 'SCHEMA_VERSION_UNSUPPORTED');
  probe(command => ({ ...command, actorId: 'invalid' }), null, 'INVALID_ID');
  probe(command => ({ ...command, causationId: 'invalid' }), null, 'INVALID_ID');
  probe(command => ({ ...command, dataVersion: '' }), null, 'INVALID_STRING');
  probe(command => ({ ...command, payload: { value: Infinity } }), null, 'NON_FINITE_NUMBER');
  probe(command => ({ ...command, unsupported: true }), null, 'INVALID_COMMAND');
  probe(null, plan => ({ ...plan, unsupported: true }), 'INVALID_COMMIT_PLAN');
  probe(null, plan => ({ ...plan, preconditions: [{ ...plan.preconditions[0], unsupported: true }] }), 'INVALID_COMMIT_PLAN');
  probe(null, plan => ({ ...plan, operations: [{ ...plan.operations[0], unsupported: true }] }), 'INVALID_COMMIT_PLAN');
  probe(null, plan => ({ ...plan, eventBlueprints: [{ ...plan.eventBlueprints[0], unsupported: true }] }), 'INVALID_COMMIT_PLAN');
  probe(null, plan => ({ ...plan, eventBlueprints: [{ type: 'ExternalStateChanged', payload: { value: Infinity } }] }), 'NON_FINITE_NUMBER');

  const cyclic = {};
  cyclic.self = cyclic;
  probe(command => ({ ...command, payload: cyclic }), null, 'CYCLIC_VALUE');
  assert.throws(() => G.createCommandEnvelope({
    schemaVersion: G.CONTRACT_SCHEMA_VERSION + 1,
    commandId: 'command.test.future.0001', actorId: input.caster.id,
    requestedTick: input.tick, correlationId: 'correlation.test.future.0001',
    causationId: null, dataVersion: input.dataVersion, payload: {},
  }), error => error.code === 'SCHEMA_VERSION_UNSUPPORTED');
});

test('envelope builder defaults and strict wire parsers match the public schemas', () => {
  const command = G.createCommandEnvelope(envelopeFixture.commandInput);
  const event = G.createDomainEventEnvelope(envelopeFixture.eventInput);
  assert.deepEqual(command, envelopeFixture.expectedCommand);
  assert.deepEqual(event, envelopeFixture.expectedEvent);
  assert.equal(matchesFixtureSchema(command, commandEnvelopeSchema), true);
  assert.equal(matchesFixtureSchema(event, domainEventEnvelopeSchema), true);
  assert.deepEqual(G.parseCommandEnvelope(command), command);
  assert.deepEqual(G.parseDomainEventEnvelope(event), event);

  const commandWithNullPayload = G.createCommandEnvelope({ ...envelopeFixture.commandInput, payload: null });
  const eventWithNullPayload = G.createDomainEventEnvelope({ ...envelopeFixture.eventInput, payload: null });
  assert.equal(commandWithNullPayload.payload, null);
  assert.equal(eventWithNullPayload.payload, null);
  assert.equal(matchesFixtureSchema(commandWithNullPayload, commandEnvelopeSchema), true);
  assert.equal(matchesFixtureSchema(eventWithNullPayload, domainEventEnvelopeSchema), true);
  assert.deepEqual(G.parseCommandEnvelope(commandWithNullPayload), commandWithNullPayload);
  assert.deepEqual(G.parseDomainEventEnvelope(eventWithNullPayload), eventWithNullPayload);

  assert.throws(() => G.parseCommandEnvelope(envelopeFixture.commandInput), error => error.code === 'INVALID_COMMAND');
  assert.throws(() => G.parseDomainEventEnvelope(envelopeFixture.eventInput), error => error.code === 'INVALID_DOMAIN_EVENT');
  assert.throws(() => G.parseCommandEnvelope({ ...command, unsupported: true }), error => error.code === 'INVALID_COMMAND');
  assert.throws(() => G.parseDomainEventEnvelope({ ...event, unsupported: true }), error => error.code === 'INVALID_DOMAIN_EVENT');
  assert.throws(() => G.parseCommandEnvelope({ ...command, schemaVersion: null }), error => error.code === 'INVALID_INTEGER');
  assert.throws(() => G.parseCommandEnvelope({ ...command, schemaVersion: 1 }), error => error.code === 'SCHEMA_VERSION_UNSUPPORTED');
  assert.throws(() => G.parseCommandEnvelope({ ...command, dataVersion: null }), error => error.code === 'INVALID_STRING');
  assert.throws(() => G.parseDomainEventEnvelope({ ...event, schemaVersion: null }), error => error.code === 'INVALID_INTEGER');
  assert.throws(() => G.parseDomainEventEnvelope({ ...event, schemaVersion: 1 }), error => error.code === 'SCHEMA_VERSION_UNSUPPORTED');
  assert.throws(() => G.createCommandEnvelope({ ...envelopeFixture.commandInput, schemaVersion: null }), error => error.code === 'INVALID_INTEGER');
  assert.throws(() => G.createCommandEnvelope({ ...envelopeFixture.commandInput, dataVersion: null }), error => error.code === 'INVALID_STRING');
  assert.throws(() => G.createDomainEventEnvelope({ ...envelopeFixture.eventInput, schemaVersion: null }), error => error.code === 'INVALID_INTEGER');

  const unsafeTick = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(matchesFixtureSchema({ ...command, requestedTick: unsafeTick }, commandEnvelopeSchema), false);
  assert.equal(matchesFixtureSchema({ ...event, occurredTick: unsafeTick }, domainEventEnvelopeSchema), false);
  assert.throws(() => G.createCommandEnvelope({ ...envelopeFixture.commandInput, requestedTick: unsafeTick }), error => error.code === 'INVALID_INTEGER');
  assert.throws(() => G.createDomainEventEnvelope({ ...envelopeFixture.eventInput, occurredTick: unsafeTick }), error => error.code === 'INVALID_INTEGER');
});

test('commit plan schema and runtime share JavaScript safe-integer boundaries', () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  const unsafe = maximum + 1;
  assert.equal(matchesFixtureSchema(maximum, commitPlanSchema.$defs.safeInteger, commitPlanSchema), true);
  assert.equal(matchesFixtureSchema(-maximum, commitPlanSchema.$defs.safeInteger, commitPlanSchema), true);
  assert.equal(matchesFixtureSchema(unsafe, commitPlanSchema.$defs.safeInteger, commitPlanSchema), false);
  assert.equal(matchesFixtureSchema(unsafe, commitPlanSchema.$defs.nonNegativeSafeInteger, commitPlanSchema), false);
  assert.equal(commitPlanSchema.properties.commitTick.$ref, '#/$defs/nonNegativeSafeInteger');

  const resourceDeltaSchema = commitPlanSchema.$defs.operation.oneOf.find(item => item.properties.kind.const === 'resource.delta');
  assert.equal(resourceDeltaSchema.properties.order.$ref, '#/$defs/safeInteger');
  assert.equal(resourceDeltaSchema.properties.delta.$ref, '#/$defs/safeInteger');
  for (const field of ['appliedTick', 'nextTickAt', 'expireTick']) {
    assert.equal(commitPlanSchema.$defs.statusInstance.properties[field].$ref, '#/$defs/nonNegativeSafeInteger');
  }

  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const makeCommand = (suffix, requestedTick = input.tick) => G.createCommandEnvelope({
    commandId: `command.test.safe-integer.${suffix}`,
    actorId: input.caster.id,
    requestedTick,
    correlationId: `correlation.test.safe-integer.${suffix}`,
    dataVersion: input.dataVersion,
  });
  const makePlan = (store, command, suffix, commitTick = input.tick) => ({
    schemaVersion: G.CONTRACT_SCHEMA_VERSION,
    planId: `plan.test.safe-integer.${suffix}`,
    commandId: command.commandId,
    commitTick,
    preconditions: [{ entityId: input.target.id, expectedVersion: store.getEntity(input.target.id).version }],
    operations: [{ order: 10, kind: 'resource.delta', entityId: input.target.id, resource: 'hp', delta: 0, key: 'boundary' }],
    eventBlueprints: [],
  });

  const maximumStore = new G.StateStore(G.createInitialState(input));
  const maximumCommand = makeCommand('maximum', maximum);
  const maximumPlan = makePlan(maximumStore, maximumCommand, 'maximum', maximum);
  maximumPlan.operations[0].order = maximum;
  assert.equal(matchesFixtureSchema(maximumPlan, commitPlanSchema), true);
  assert.equal(maximumStore.commit(maximumCommand, maximumPlan).state.tick, maximum);

  for (const [suffix, mutate] of [
    ['commit-tick', plan => { plan.commitTick = unsafe; }],
    ['operation-order', plan => { plan.operations[0].order = unsafe; }],
    ['resource-delta', plan => { plan.operations[0].delta = unsafe; }],
  ]) {
    const store = new G.StateStore(G.createInitialState(input));
    const command = makeCommand(suffix);
    const validPlan = makePlan(store, command, suffix);
    const invalidPlan = JSON.parse(JSON.stringify(validPlan));
    mutate(invalidPlan);
    assert.equal(matchesFixtureSchema(invalidPlan, commitPlanSchema), false);
    const beforeState = G.canonicalStringify(store.exportState());
    const beforeOutbox = G.canonicalStringify(store.outbox);
    const beforeTick = store.tick;
    assert.throws(() => store.commit(command, invalidPlan), error => error.code === 'INVALID_INTEGER');
    assert.equal(G.canonicalStringify(store.exportState()), beforeState);
    assert.equal(G.canonicalStringify(store.outbox), beforeOutbox);
    assert.equal(store.tick, beforeTick);
    assert.equal(store.commit(command, validPlan).planId, validPlan.planId);
  }
});

test('CommitPlan rejects function callbacks without publishing or consuming idempotency', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const store = new G.StateStore(G.createInitialState(input));
  const command = G.createCommandEnvelope({
    commandId: 'command.test.no-plan-callback.0001',
    actorId: input.caster.id,
    requestedTick: input.tick,
    correlationId: 'correlation.test.no-plan-callback.0001',
    dataVersion: input.dataVersion,
  });
  const validPlan = {
    schemaVersion: G.CONTRACT_SCHEMA_VERSION,
    planId: 'plan.test.no-plan-callback.0001',
    commandId: command.commandId,
    commitTick: input.tick,
    preconditions: [],
    operations: [],
    eventBlueprints: [],
  };
  let callbackInvoked = false;
  const callbackPlan = {
    ...validPlan,
    eventBlueprints: [{
      type: 'CallbackAttempted',
      payload: { projector: () => { callbackInvoked = true; } },
    }],
  };
  const beforeState = G.canonicalStringify(store.exportState());
  const beforeOutbox = G.canonicalStringify(store.outbox);
  const beforeTick = store.tick;
  assert.throws(() => store.commit(command, callbackPlan), error => error.code === 'UNSERIALIZABLE_VALUE');
  assert.equal(callbackInvoked, false);
  assert.equal(G.canonicalStringify(store.exportState()), beforeState);
  assert.equal(G.canonicalStringify(store.outbox), beforeOutbox);
  assert.equal(store.tick, beforeTick);
  assert.equal(store.commit(command, validPlan).planId, validPlan.planId);
});

test('StateStore rejects event types outside the closed runtime taxonomy without consuming idempotency', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const store = new G.StateStore(G.createInitialState(input));
  const command = G.createCommandEnvelope({
    commandId: 'command.test.unsupported-event.0001',
    actorId: input.caster.id,
    requestedTick: input.tick,
    correlationId: 'correlation.test.unsupported-event.0001',
    dataVersion: input.dataVersion,
    payload: {},
  });
  const validPlan = {
    schemaVersion: G.CONTRACT_SCHEMA_VERSION,
    planId: 'plan.test.unsupported-event.0001',
    commandId: command.commandId,
    commitTick: input.tick,
    preconditions: [],
    operations: [],
    eventBlueprints: [],
  };
  const unsupportedPlan = {
    ...validPlan,
    eventBlueprints: [{
      type: 'ArbitraryCommitted',
      payload: { plausibleButUnverified: true },
    }],
  };
  const beforeState = G.canonicalStringify(store.exportState());
  const beforeOutbox = G.canonicalStringify(store.outbox);

  assert.throws(
    () => store.commit(command, unsupportedPlan),
    error => error.code === 'UNSUPPORTED_EVENT_TYPE',
  );
  assert.equal(G.canonicalStringify(store.exportState()), beforeState);
  assert.equal(G.canonicalStringify(store.outbox), beforeOutbox);
  assert.equal(store.commit(command, validPlan).planId, validPlan.planId);
});

test('DamageCommitted rejects false HP or shield facts without publishing or consuming the command', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false, skill: { hitChanceBps: 10_000, critChanceBps: 0 } });
  for (const field of ['targetHpAfter', 'targetShieldAfter']) {
    const store = new G.StateStore(G.createInitialState(input));
    const command = G.createFireballCommand(input);
    const snapshot = store.snapshot([input.caster.id, input.target.id]);
    const resolution = G.resolveFireball({ snapshot, command, input, rng: new G.KeyedRandom(input.rootSeed) });
    const falsePlan = JSON.parse(JSON.stringify(resolution.plan));
    const damageEvent = falsePlan.eventBlueprints.find(event => event.type === 'DamageCommitted');
    damageEvent.payload[field] += 1;
    const beforeState = G.canonicalStringify(store.exportState());
    const beforeOutbox = G.canonicalStringify(store.outbox);
    const beforeTick = store.tick;

    assert.throws(() => store.commit(command, falsePlan), error => error.code === 'OUTBOX_FACT_MISMATCH');
    assert.equal(G.canonicalStringify(store.exportState()), beforeState);
    assert.equal(G.canonicalStringify(store.outbox), beforeOutbox);
    assert.equal(store.tick, beforeTick);

    const receipt = store.commit(command, resolution.plan);
    assert.equal(receipt.events.find(event => event.type === 'DamageCommitted').payload[field], receipt.state.entities[input.target.id].resources[field === 'targetHpAfter' ? 'hp' : 'shield']);
  }
});

test('DamageCommitted rejects a non-canonical exact fraction without publishing or consuming the command', () => {
  const input = G.normalizeScenarioInput({
    simulateStatusTicks: false,
    skill: { hitChanceBps: 10_000, critChanceBps: 0 },
  });
  const store = new G.StateStore(G.createInitialState(input));
  const command = G.createFireballCommand(input);
  const snapshot = store.snapshot([input.caster.id, input.target.id]);
  const resolution = G.resolveFireball({
    snapshot,
    command,
    input,
    rng: new G.KeyedRandom(input.rootSeed),
  });
  const forgedPlan = JSON.parse(JSON.stringify(resolution.plan));
  const damage = forgedPlan.eventBlueprints.find(
    event => event.type === 'DamageCommitted',
  );
  damage.payload.exactRawDamage = {
    numerator: String(damage.payload.rawDamage * 2),
    denominator: '2',
  };
  const beforeState = G.canonicalStringify(store.exportState());
  const beforeOutbox = G.canonicalStringify(store.outbox);

  assert.throws(
    () => store.commit(command, forgedPlan),
    error => error.code === 'OUTBOX_FACT_MISMATCH',
  );
  assert.equal(G.canonicalStringify(store.exportState()), beforeState);
  assert.equal(G.canonicalStringify(store.outbox), beforeOutbox);
  assert.doesNotThrow(() => store.commit(command, resolution.plan));
});

test('DamageCommitted rejects a self-consistent forged resistance and mutation that disagrees with the pre-state stat', () => {
  const input = G.normalizeScenarioInput({
    simulateStatusTicks: false,
    skill: { hitChanceBps: 10_000, critChanceBps: 0 },
  });
  const store = new G.StateStore(G.createInitialState(input));
  const command = G.createFireballCommand(input);
  const snapshot = store.snapshot([input.caster.id, input.target.id]);
  const resolution = G.resolveFireball({
    snapshot,
    command,
    input,
    rng: new G.KeyedRandom(input.rootSeed),
  });
  const forgedPlan = JSON.parse(JSON.stringify(resolution.plan));
  const damage = forgedPlan.eventBlueprints.find(
    event => event.type === 'DamageCommitted',
  ).payload;
  const targetBefore = store.getEntity(input.target.id);
  const forgedResolved = damage.rawDamage;
  const forgedShield = Math.min(
    targetBefore.resources.shield,
    forgedResolved,
  );
  const forgedHp = Math.min(
    targetBefore.resources.hp,
    forgedResolved - forgedShield,
  );
  damage.resistanceBps = 0;
  damage.resolvedDamage = forgedResolved;
  damage.shieldAbsorbed = forgedShield;
  damage.finalHpDamage = forgedHp;
  damage.overkill = forgedResolved - forgedShield - forgedHp;
  damage.targetShieldAfter = targetBefore.resources.shield - forgedShield;
  damage.targetHpAfter = targetBefore.resources.hp - forgedHp;
  const shieldOperation = forgedPlan.operations.find(
    operation => operation.kind === 'resource.delta'
      && operation.entityId === input.target.id
      && operation.resource === 'shield',
  );
  const hpOperation = forgedPlan.operations.find(
    operation => operation.kind === 'resource.delta'
      && operation.entityId === input.target.id
      && operation.resource === 'hp',
  );
  shieldOperation.delta = -forgedShield;
  hpOperation.delta = -forgedHp;
  const beforeState = G.canonicalStringify(store.exportState());
  const beforeOutbox = G.canonicalStringify(store.outbox);

  assert.throws(
    () => store.commit(command, forgedPlan),
    error => error.code === 'OUTBOX_FACT_MISMATCH',
  );
  assert.equal(G.canonicalStringify(store.exportState()), beforeState);
  assert.equal(G.canonicalStringify(store.outbox), beforeOutbox);
  assert.doesNotThrow(() => store.commit(command, resolution.plan));
});

test('DamageMissed cannot smuggle zero-authority damage operations into a plausible event', () => {
  const input = G.normalizeScenarioInput({
    simulateStatusTicks: false,
    skill: { hitChanceBps: 0, critChanceBps: 0 },
  });
  const store = new G.StateStore(G.createInitialState(input));
  const command = G.createFireballCommand(input);
  const snapshot = store.snapshot([input.caster.id, input.target.id]);
  const resolution = G.resolveFireball({
    snapshot,
    command,
    input,
    rng: new G.KeyedRandom(input.rootSeed),
  });
  const forgedPlan = JSON.parse(JSON.stringify(resolution.plan));
  const damage = forgedPlan.eventBlueprints.find(
    event => event.type === 'DamageMissed',
  ).payload;
  damage.rawDamage = 100;
  damage.resolvedDamage = 80;
  damage.shieldAbsorbed = 40;
  damage.finalHpDamage = 40;
  damage.overkill = 0;
  damage.targetShieldAfter = input.target.shield - 40;
  damage.targetHpAfter = input.target.hp - 40;
  forgedPlan.operations.push(
    {
      order: 30,
      kind: 'resource.delta',
      entityId: input.target.id,
      resource: 'shield',
      delta: -40,
      key: 'forged-miss-shield',
    },
    {
      order: 40,
      kind: 'resource.delta',
      entityId: input.target.id,
      resource: 'hp',
      delta: -40,
      key: 'forged-miss-hp',
    },
  );
  const beforeState = G.canonicalStringify(store.exportState());
  const beforeOutbox = G.canonicalStringify(store.outbox);

  assert.throws(
    () => store.commit(command, forgedPlan),
    error => error.code === 'OUTBOX_FACT_MISMATCH',
  );
  assert.equal(G.canonicalStringify(store.exportState()), beforeState);
  assert.equal(G.canonicalStringify(store.outbox), beforeOutbox);
  assert.doesNotThrow(() => store.commit(command, resolution.plan));
});

test('SkillCommitted rejects mana or cooldown facts that disagree with the committed transition', () => {
  const input = G.normalizeScenarioInput({
    simulateStatusTicks: false,
    skill: { hitChanceBps: 10_000, critChanceBps: 0 },
  });
  for (const field of ['manaSpent', 'cooldownReadyTick']) {
    const store = new G.StateStore(G.createInitialState(input));
    const command = G.createFireballCommand(input);
    const snapshot = store.snapshot([input.caster.id, input.target.id]);
    const resolution = G.resolveFireball({
      snapshot,
      command,
      input,
      rng: new G.KeyedRandom(input.rootSeed),
    });
    const falsePlan = JSON.parse(JSON.stringify(resolution.plan));
    const skillEvent = falsePlan.eventBlueprints.find(
      event => event.type === 'SkillCommitted',
    );
    skillEvent.payload[field] += 1;
    const beforeState = G.canonicalStringify(store.exportState());
    const beforeOutbox = G.canonicalStringify(store.outbox);

    assert.throws(
      () => store.commit(command, falsePlan),
      error => error.code === 'OUTBOX_FACT_MISMATCH',
    );
    assert.equal(G.canonicalStringify(store.exportState()), beforeState);
    assert.equal(G.canonicalStringify(store.outbox), beforeOutbox);

    const receipt = store.commit(command, resolution.plan);
    const committedSkill = receipt.events.find(
      event => event.type === 'SkillCommitted',
    );
    assert.equal(committedSkill.payload.manaSpent, input.skill.manaCost);
    assert.equal(
      committedSkill.payload.cooldownReadyTick,
      input.tick + input.skill.cooldownTicks,
    );
  }
});

test('SkillCommitted binds its target and skill facts to the command payload', () => {
  const input = G.normalizeScenarioInput({
    simulateStatusTicks: false,
    skill: { hitChanceBps: 10_000, critChanceBps: 0 },
  });
  for (const payload of [
    {
      targetId: input.caster.id,
      skillDefinitionId: input.skill.definitionId,
    },
    {
      targetId: input.target.id,
      skillDefinitionId: 'skill.forged',
    },
  ]) {
    const store = new G.StateStore(G.createInitialState(input));
    const command = G.createFireballCommand(input);
    const snapshot = store.snapshot([input.caster.id, input.target.id]);
    const resolution = G.resolveFireball({
      snapshot,
      command,
      input,
      rng: new G.KeyedRandom(input.rootSeed),
    });
    const forgedCommand = G.createCommandEnvelope({ ...command, payload });
    const beforeState = G.canonicalStringify(store.exportState());
    const beforeOutbox = G.canonicalStringify(store.outbox);

    assert.throws(
      () => store.commit(forgedCommand, resolution.plan),
      error => error.code === 'OUTBOX_FACT_MISMATCH',
    );
    assert.equal(G.canonicalStringify(store.exportState()), beforeState);
    assert.equal(G.canonicalStringify(store.outbox), beforeOutbox);
    assert.doesNotThrow(() => store.commit(command, resolution.plan));
  }
});

test('status and defeat facts are checked against post-state before publication', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false, skill: { hitChanceBps: 10_000, critChanceBps: 0 } });
  const reference = G.runFireballScenario(input);
  const targetId = input.target.id;
  const status = Object.values(reference.finalState.entities[targetId].statuses)[0];
  const appliedEvent = reference.outbox.find(event => event.type === 'StatusApplied');

  // 거짓 event는 working copy 검증에서 멈추고 같은 command의 올바른 재시도를 허용해야 한다.
  const assertRejectedUnchanged = (store, command, plan) => {
    const beforeState = G.canonicalStringify(store.exportState());
    const beforeOutbox = G.canonicalStringify(store.outbox);
    const beforeTick = store.tick;
    assert.throws(() => store.commit(command, plan), error => error.code === 'OUTBOX_FACT_MISMATCH');
    assert.equal(G.canonicalStringify(store.exportState()), beforeState);
    assert.equal(G.canonicalStringify(store.outbox), beforeOutbox);
    assert.equal(store.tick, beforeTick);
  };

  const statusStore = new G.StateStore(G.createInitialState(input));
  const initialTarget = statusStore.getEntity(targetId);
  const applyCommand = G.createCommandEnvelope({
    commandId: appliedEvent.causationId,
    actorId: status.actorId,
    requestedTick: status.appliedTick,
    correlationId: status.correlationId,
    causationId: status.applicationCausationId,
    dataVersion: status.dataVersion,
    payload: { targetId, status },
  });
  const applyPlan = {
    schemaVersion: G.CONTRACT_SCHEMA_VERSION,
    planId: 'plan.test.truth-status-applied.0001',
    commandId: applyCommand.commandId,
    commitTick: status.appliedTick,
    preconditions: [{ entityId: targetId, expectedVersion: initialTarget.version }],
    operations: [],
    eventBlueprints: [{ type: 'StatusApplied', payload: { targetId, status } }],
  };
  assertRejectedUnchanged(statusStore, applyCommand, applyPlan);
  const validApplyPlan = {
    ...applyPlan,
    operations: [{ order: 10, kind: 'status.add', entityId: targetId, status, key: status.instanceId }],
  };
  const falseApplyPlan = JSON.parse(JSON.stringify(validApplyPlan));
  falseApplyPlan.eventBlueprints[0].payload.status.rawTickDamage += 1;
  assertRejectedUnchanged(statusStore, applyCommand, falseApplyPlan);
  const applied = statusStore.commit(applyCommand, validApplyPlan);
  assert.ok(applied.state.entities[targetId].statuses[status.instanceId]);

  const activeTarget = statusStore.getEntity(targetId);
  const expireCommand = G.createCommandEnvelope({
    commandId: 'command.test.truth-status-expired.0001',
    actorId: status.actorId,
    requestedTick: status.expireTick,
    correlationId: status.correlationId,
    causationId: status.lastTransitionEventId,
    dataVersion: status.dataVersion,
    payload: {
      targetId,
      statusInstanceId: status.instanceId,
      applicationSourceId: status.applicationSourceId,
      applicationSourceRef: status.applicationSourceRef,
      sourceId: status.sourceId,
      sourceRef: status.sourceRef,
      reason: 'duration-expired',
    },
  });
  const expirePlan = {
    schemaVersion: G.CONTRACT_SCHEMA_VERSION,
    planId: 'plan.test.truth-status-expired.0001',
    commandId: expireCommand.commandId,
    commitTick: status.expireTick,
    preconditions: [{ entityId: targetId, expectedVersion: activeTarget.version }],
    operations: [],
    eventBlueprints: [{
      type: 'StatusExpired',
      payload: {
        actorId: status.actorId,
        applicationSourceId: status.applicationSourceId,
        applicationSourceRef: status.applicationSourceRef,
        sourceId: status.sourceId,
        sourceRef: status.sourceRef,
        targetId,
        statusInstanceId: status.instanceId,
        definitionId: status.definitionId,
        expireTick: status.expireTick,
        scheduledExpireTick: status.expireTick,
        endedTick: status.expireTick,
        reason: 'duration-expired',
        triggerEventId: status.lastTransitionEventId,
      },
    }],
  };
  assertRejectedUnchanged(statusStore, expireCommand, expirePlan);
  const validExpirePlan = {
    ...expirePlan,
    operations: [{ order: 10, kind: 'status.remove', entityId: targetId, instanceId: status.instanceId, key: 'expire' }],
  };
  const falseExpirePlan = JSON.parse(JSON.stringify(validExpirePlan));
  falseExpirePlan.eventBlueprints[0].payload.catchUpLimited = true;
  assertRejectedUnchanged(statusStore, expireCommand, falseExpirePlan);
  const expired = statusStore.commit(expireCommand, validExpirePlan);
  assert.equal(Object.hasOwn(expired.state.entities[targetId].statuses, status.instanceId), false);

  const defeatStore = new G.StateStore(G.createInitialState(input));
  const defeatTarget = defeatStore.getEntity(targetId);
  const defeatPayload = {
    entityId: targetId,
    targetId,
    actorId: input.caster.id,
    sourceId: 'system.test-defeat',
    sourceRef: { kind: 'system', definitionId: 'system.test-defeat' },
    damageType: 'scripted',
    periodic: false,
  };
  const defeatCommand = G.createCommandEnvelope({
    commandId: 'command.test.truth-entity-defeated.0001',
    actorId: input.caster.id,
    requestedTick: input.tick,
    correlationId: 'correlation.test.truth-entity-defeated.0001',
    dataVersion: input.dataVersion,
    payload: defeatPayload,
  });
  const defeatPlan = {
    schemaVersion: G.CONTRACT_SCHEMA_VERSION,
    planId: 'plan.test.truth-entity-defeated.0001',
    commandId: defeatCommand.commandId,
    commitTick: input.tick,
    preconditions: [{ entityId: targetId, expectedVersion: defeatTarget.version }],
    operations: [{ order: 10, kind: 'resource.delta', entityId: targetId, resource: 'hp', delta: -1, key: 'hp' }],
    eventBlueprints: [{
      type: 'EntityDefeated',
      payload: defeatPayload,
    }],
  };
  assertRejectedUnchanged(defeatStore, defeatCommand, defeatPlan);
  const validDefeatPlan = {
    ...defeatPlan,
    operations: [{ ...defeatPlan.operations[0], delta: -defeatTarget.resources.hp }],
  };
  const falseDefeatPlan = JSON.parse(JSON.stringify(validDefeatPlan));
  falseDefeatPlan.eventBlueprints[0].payload.sourceId = 'system.forged';
  falseDefeatPlan.eventBlueprints[0].payload.sourceRef = {
    kind: 'system',
    definitionId: 'system.forged',
  };
  assertRejectedUnchanged(defeatStore, defeatCommand, falseDefeatPlan);
  const defeated = defeatStore.commit(defeatCommand, validDefeatPlan);
  assert.equal(defeated.state.entities[targetId].resources.hp, 0);
});

test('StateStore 생성자는 malformed state와 outbox를 거부한다', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const base = () => JSON.parse(JSON.stringify(G.createInitialState(input)));
  const invalidStates = [];
  const badTick = base(); badTick.tick = '18240'; invalidStates.push(badTick);
  const badKey = base(); badKey.entities[input.target.id].id = 'entity.other'; invalidStates.push(badKey);
  const badVersion = base(); badVersion.entities[input.target.id].version = -1; invalidStates.push(badVersion);
  const badHp = base(); badHp.entities[input.target.id].resources.hp = -1; invalidStates.push(badHp);
  const badProcessed = base(); badProcessed.processedCommands = ['command.test.duplicate.0001', 'command.test.duplicate.0001']; invalidStates.push(badProcessed);
  const badOutbox = base(); badOutbox.outbox = [{ bogus: true }]; invalidStates.push(badOutbox);
  for (const state of invalidStates) assert.throws(() => new G.StateStore(state), error => error instanceof G.DomainError);

  const accessorState = base();
  const originalEntities = accessorState.entities;
  let entityReads = 0;
  Object.defineProperty(accessorState, 'entities', { enumerable: true, get() { entityReads += 1; return originalEntities; } });
  assert.throws(() => new G.StateStore(accessorState), error => error.code === 'UNSERIALIZABLE_VALUE');
  assert.equal(entityReads, 0);
});

test('StateStore의 tick, state, idempotency와 outbox는 외부에서 변조할 수 없다', () => {
  const impact = G.executeImpact(G.normalizeScenarioInput({ simulateStatusTicks: false }));
  const before = G.canonicalStringify(impact.store.exportState());
  assert.equal('state' in impact.store, false);
  assert.equal('processedCommands' in impact.store, false);
  assert.throws(() => { impact.store.tick = -1; }, TypeError);
  assert.throws(() => { impact.store.outbox.push({}); }, TypeError);
  assert.throws(() => { impact.store.outbox[0].payload.targetId = 'entity.other'; }, TypeError);
  assert.equal(G.canonicalStringify(impact.store.exportState()), before);
  assert.throws(() => impact.store.commit(impact.command, impact.resolution.plan), error => error.code === 'DUPLICATE_COMMAND');
});

test('StateStore rejects trace-driven reentrant commits before they can bypass optimistic versions', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const store = new G.StateStore(G.createInitialState(input));
  const target = store.getEntity(input.target.id);
  const makeCommand = suffix => G.createCommandEnvelope({
    commandId: `command.test.reentrant-${suffix}.0001`, actorId: input.caster.id,
    requestedTick: input.tick, correlationId: `correlation.test.reentrant-${suffix}.0001`,
    dataVersion: input.dataVersion, payload: {},
  });
  const makePlan = (command, delta) => ({
    schemaVersion: G.CONTRACT_SCHEMA_VERSION,
    planId: `plan.test.reentrant-${delta === -1 ? 'outer' : 'inner'}.0001`,
    commandId: command.commandId,
    commitTick: input.tick,
    preconditions: [{ entityId: target.id, expectedVersion: target.version }],
    operations: [{ order: 10, kind: 'resource.delta', entityId: target.id, resource: 'hp', delta, key: 'hp' }],
    eventBlueprints: [],
  });
  const outer = makeCommand('outer');
  const inner = makeCommand('inner');
  const crossStore = new G.StateStore(G.createInitialState(input));
  const cross = makeCommand('cross-store');
  let nestedCommitCode = null;
  let nestedClockCode = null;
  let crossStoreCode = null;
  const receipt = store.commit(outer, makePlan(outer, -1), {
    record(stage) {
      if (stage !== 'commit_preconditions_checked') return;
      try { store.commit(inner, makePlan(inner, -10)); } catch (error) { nestedCommitCode = error.code; }
      try { G.advanceStatuses(store, input.tick + 50); } catch (error) { nestedClockCode = error.code; }
      try { crossStore.commit(cross, makePlan(cross, -5)); } catch (error) { crossStoreCode = error.code; }
    },
  });
  assert.equal(nestedCommitCode, 'REENTRANT_COMMIT');
  assert.equal(nestedClockCode, 'REENTRANT_COMMIT');
  assert.equal(crossStoreCode, 'TRACE_OBSERVER_SIDE_EFFECT');
  assert.equal(store.getEntity(target.id).resources.hp, target.resources.hp - 1);
  assert.equal(store.getEntity(target.id).version, target.version + 1);
  assert.equal(store.tick, input.tick);
  assert.equal(crossStore.getEntity(target.id).resources.hp, target.resources.hp);
  assert.equal(receipt.state.entities[target.id].resources.hp, target.resources.hp - 1);
  const afterOuter = store.getEntity(target.id);
  const postCommand = makeCommand('post-guard');
  const postPlan = { ...makePlan(postCommand, -1), planId: 'plan.test.reentrant-post.0001', preconditions: [{ entityId: target.id, expectedVersion: afterOuter.version }] };
  assert.equal(store.commit(postCommand, postPlan).state.entities[target.id].resources.hp, target.resources.hp - 2);
});

test('StateStore canonicalizes a plan once and rejects accessor-based TOCTOU inputs', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const store = new G.StateStore(G.createInitialState(input));
  const target = store.getEntity(input.target.id);
  const command = G.createCommandEnvelope({ commandId: 'command.test.plan-toctou.0001', actorId: input.caster.id, requestedTick: input.tick, correlationId: 'correlation.test.plan-toctou.0001', dataVersion: input.dataVersion, payload: {} });
  const validPlan = { schemaVersion: G.CONTRACT_SCHEMA_VERSION, planId: 'plan.test.plan-toctou.0001', commandId: command.commandId, commitTick: input.tick, preconditions: [{ entityId: target.id, expectedVersion: target.version }], operations: [{ order: 10, kind: 'resource.delta', entityId: target.id, resource: 'hp', delta: -1, key: 'hp' }], eventBlueprints: [] };
  const accessorPlan = { ...validPlan };
  let reads = 0;
  Object.defineProperty(accessorPlan, 'operations', { enumerable: true, get() { reads += 1; return validPlan.operations; } });
  const before = G.canonicalStringify(store.exportState());
  assert.throws(() => store.commit(command, accessorPlan), error => error.code === 'UNSERIALIZABLE_VALUE');
  assert.equal(reads, 0);
  assert.equal(G.canonicalStringify(store.exportState()), before);
  assert.doesNotThrow(() => store.commit(command, validPlan));
});

test('StateStore keeps its clock capability private and prevents shadow properties', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const store = new G.StateStore(G.createInitialState(input));
  const prototypeSymbols = Reflect.ownKeys(Object.getPrototypeOf(store)).filter(key => typeof key === 'symbol');
  assert.deepEqual(prototypeSymbols, []);
  assert.equal(Object.isExtensible(store), false);
  assert.throws(() => { store.untrustedTick = -1; }, TypeError);
  assert.throws(() => Object.defineProperty(store, 'tick', { value: -1 }), TypeError);
  assert.equal(store.snapshot([input.target.id]).tick, store.exportState().tick);
});

test('Status time is monotonic across restore, add, and patch boundaries', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false, skill: { hitChanceBps: 10_000, critChanceBps: 0 } });
  const active = G.runFireballScenario(input);
  const activeState = JSON.parse(JSON.stringify(active.finalState));
  const targetId = input.target.id;
  const status = Object.values(activeState.entities[targetId].statuses)[0];
  assert.ok(status);

  const futureState = JSON.parse(JSON.stringify(activeState));
  futureState.entities[targetId].statuses[status.instanceId].appliedTick = futureState.tick + 1;
  assert.throws(() => new G.StateStore(futureState), error => error.code === 'STATUS_TIME_REGRESSION');

  const freshStore = new G.StateStore(G.createInitialState(input));
  const freshTarget = freshStore.getEntity(targetId);
  const addCommand = G.createCommandEnvelope({ commandId: 'command.test.future-status-add.0001', actorId: input.caster.id, requestedTick: input.tick, correlationId: status.correlationId, causationId: status.applicationCausationId, dataVersion: input.dataVersion, payload: {} });
  const makeAddPlan = candidate => ({ schemaVersion: G.CONTRACT_SCHEMA_VERSION, planId: 'plan.test.future-status-add.0001', commandId: addCommand.commandId, commitTick: input.tick, preconditions: [{ entityId: targetId, expectedVersion: freshTarget.version }], operations: [{ order: 10, kind: 'status.add', entityId: targetId, status: candidate, key: status.instanceId }], eventBlueprints: [] });
  const beforeAdd = G.canonicalStringify(freshStore.exportState());
  const futureStatus = JSON.parse(JSON.stringify(status));
  futureStatus.appliedTick = input.tick + 1;
  futureStatus.nextTickAt = input.tick + 2;
  assert.throws(() => freshStore.commit(addCommand, makeAddPlan(futureStatus)), error => error.code === 'STATUS_TIME_REGRESSION');
  const pastStatus = JSON.parse(JSON.stringify(status));
  pastStatus.appliedTick = input.tick - 1;
  assert.throws(() => freshStore.commit(addCommand, makeAddPlan(pastStatus)), error => error.code === 'STATUS_TIME_REGRESSION');
  const immediateStatus = JSON.parse(JSON.stringify(status));
  immediateStatus.nextTickAt = input.tick;
  assert.throws(() => freshStore.commit(addCommand, makeAddPlan(immediateStatus)), error => error.code === 'STATUS_TIME_REGRESSION');
  assert.equal(G.canonicalStringify(freshStore.exportState()), beforeAdd);
  assert.equal(freshStore.tick, input.tick);
  assert.equal(freshStore.outbox.length, 0);
  assert.doesNotThrow(() => freshStore.commit(addCommand, makeAddPlan(status)));

  const activeStore = new G.StateStore(activeState);
  const activeTarget = activeStore.getEntity(targetId);
  const patchCommand = G.createCommandEnvelope({ commandId: 'command.test.status-rewind.0001', actorId: input.caster.id, requestedTick: input.tick, correlationId: 'correlation.test.status-rewind.0001', dataVersion: input.dataVersion, payload: {} });
  const patchPlan = { schemaVersion: G.CONTRACT_SCHEMA_VERSION, planId: 'plan.test.status-rewind.0001', commandId: patchCommand.commandId, commitTick: input.tick, preconditions: [{ entityId: targetId, expectedVersion: activeTarget.version }], operations: [{ order: 10, kind: 'status.patch', entityId: targetId, instanceId: status.instanceId, patch: { nextTickAt: status.nextTickAt - 1, lastTransitionEventId: status.lastTransitionEventId }, key: 'rewind' }], eventBlueprints: [] };
  const beforePatch = G.canonicalStringify(activeStore.exportState());
  assert.throws(() => activeStore.commit(patchCommand, patchPlan), error => error.code === 'STATUS_TIME_REGRESSION');
  assert.equal(G.canonicalStringify(activeStore.exportState()), beforePatch);
});

test('StateStore rejects unsafe resource arithmetic before cancellation can hide precision loss', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const store = new G.StateStore(G.createInitialState(input));
  const target = store.getEntity(input.target.id);
  const command = G.createCommandEnvelope({ commandId: 'command.test.resource-precision.0001', actorId: input.caster.id, requestedTick: input.tick, correlationId: 'correlation.test.resource-precision.0001', dataVersion: input.dataVersion, payload: {} });
  const plan = { schemaVersion: G.CONTRACT_SCHEMA_VERSION, planId: 'plan.test.resource-precision.0001', commandId: command.commandId, commitTick: input.tick, preconditions: [{ entityId: target.id, expectedVersion: target.version }], operations: [
    { order: 10, kind: 'resource.delta', entityId: target.id, resource: 'hp', delta: Number.MAX_SAFE_INTEGER, key: 'overflow' },
    { order: 20, kind: 'resource.delta', entityId: target.id, resource: 'hp', delta: -Number.MAX_SAFE_INTEGER, key: 'cancel' },
    { order: 30, kind: 'resource.delta', entityId: target.id, resource: 'hp', delta: -1, key: 'damage' },
  ], eventBlueprints: [] };
  const before = G.canonicalStringify(store.exportState());
  assert.throws(() => store.commit(command, plan), error => error.code === 'NUMERIC_OVERFLOW');
  assert.equal(G.canonicalStringify(store.exportState()), before);
  assert.equal(store.outbox.length, 0);
  const valid = { ...plan, operations: [{ order: 10, kind: 'resource.delta', entityId: target.id, resource: 'hp', delta: -1, key: 'damage' }] };
  assert.equal(store.commit(command, valid).state.entities[target.id].resources.hp, target.resources.hp - 1);
});

test('Status add and remove require explicit instance existence transitions', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false, skill: { hitChanceBps: 10_000, critChanceBps: 0 } });
  const activeState = JSON.parse(JSON.stringify(G.runFireballScenario(input).finalState));
  const targetId = input.target.id;
  const status = Object.values(activeState.entities[targetId].statuses)[0];
  const duplicateStore = new G.StateStore(activeState);
  const duplicateTarget = duplicateStore.getEntity(targetId);
  const addCommand = G.createCommandEnvelope({ commandId: 'command.test.status-duplicate.0001', actorId: input.caster.id, requestedTick: input.tick, correlationId: status.correlationId, causationId: status.applicationCausationId, dataVersion: input.dataVersion, payload: {} });
  const addPlan = { schemaVersion: G.CONTRACT_SCHEMA_VERSION, planId: 'plan.test.status-duplicate.0001', commandId: addCommand.commandId, commitTick: input.tick, preconditions: [{ entityId: targetId, expectedVersion: duplicateTarget.version }], operations: [{ order: 10, kind: 'status.add', entityId: targetId, status, key: status.instanceId }], eventBlueprints: [] };
  const beforeDuplicate = G.canonicalStringify(duplicateStore.exportState());
  assert.throws(() => duplicateStore.commit(addCommand, addPlan), error => error.code === 'STATUS_ALREADY_EXISTS');
  assert.equal(G.canonicalStringify(duplicateStore.exportState()), beforeDuplicate);

  const emptyStore = new G.StateStore(G.createInitialState(input));
  const emptyTarget = emptyStore.getEntity(targetId);
  const removeCommand = G.createCommandEnvelope({ commandId: 'command.test.status-missing.0001', actorId: input.caster.id, requestedTick: input.tick, correlationId: 'correlation.test.status-missing.0001', dataVersion: input.dataVersion, payload: {} });
  const removePlan = { schemaVersion: G.CONTRACT_SCHEMA_VERSION, planId: 'plan.test.status-missing.0001', commandId: removeCommand.commandId, commitTick: input.tick, preconditions: [{ entityId: targetId, expectedVersion: emptyTarget.version }], operations: [{ order: 10, kind: 'status.remove', entityId: targetId, instanceId: status.instanceId, key: 'missing' }], eventBlueprints: [] };
  const beforeMissing = G.canonicalStringify(emptyStore.exportState());
  assert.throws(() => emptyStore.commit(removeCommand, removePlan), error => error.code === 'STATUS_NOT_FOUND');
  assert.equal(G.canonicalStringify(emptyStore.exportState()), beforeMissing);
});

test('Status applicationSourceId must match its structured SourceRef in restore and add paths', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false, skill: { hitChanceBps: 10_000, critChanceBps: 0 } });
  const activeState = JSON.parse(JSON.stringify(G.runFireballScenario(input).finalState));
  const targetId = input.target.id;
  const status = Object.values(activeState.entities[targetId].statuses)[0];

  const mismatchedState = JSON.parse(JSON.stringify(activeState));
  mismatchedState.entities[targetId].statuses[status.instanceId].applicationSourceId = 'command.other.cast.0001';
  assert.throws(() => new G.StateStore(mismatchedState), error => error.code === 'INVALID_STATUS_INSTANCE');

  const systemState = JSON.parse(JSON.stringify(activeState));
  const systemStatus = systemState.entities[targetId].statuses[status.instanceId];
  systemStatus.applicationSourceRef = { kind: 'system', definitionId: 'system.weather' };
  systemStatus.applicationSourceId = 'system.weather';
  assert.doesNotThrow(() => new G.StateStore(systemState));
  systemStatus.applicationSourceId = 'system.other';
  assert.throws(() => new G.StateStore(systemState), error => error.code === 'INVALID_STATUS_INSTANCE');

  const store = new G.StateStore(G.createInitialState(input));
  const target = store.getEntity(targetId);
  const command = G.createCommandEnvelope({ commandId: 'command.test.status-source.0001', actorId: input.caster.id, requestedTick: input.tick, correlationId: status.correlationId, causationId: status.applicationCausationId, dataVersion: input.dataVersion, payload: {} });
  const makePlan = candidate => ({ schemaVersion: G.CONTRACT_SCHEMA_VERSION, planId: 'plan.test.status-source.0001', commandId: command.commandId, commitTick: input.tick, preconditions: [{ entityId: targetId, expectedVersion: target.version }], operations: [{ order: 10, kind: 'status.add', entityId: targetId, status: candidate, key: status.instanceId }], eventBlueprints: [] });
  const mismatchedStatus = JSON.parse(JSON.stringify(status));
  mismatchedStatus.applicationSourceId = 'command.other.cast.0001';
  const before = G.canonicalStringify(store.exportState());
  assert.throws(() => store.commit(command, makePlan(mismatchedStatus)), error => error.code === 'INVALID_STATUS_INSTANCE');
  assert.equal(G.canonicalStringify(store.exportState()), before);
  assert.equal(store.outbox.length, 0);
  assert.doesNotThrow(() => store.commit(command, makePlan(status)));
});

test('Canonical JSON preserves __proto__ as data and rejects non-JSON container shapes', () => {
  const withProtoKey = Object.create(null);
  defineOwn(withProtoKey, '__proto__', { marker: 'kept' });
  defineOwn(withProtoKey, 'safe', 1);
  const withoutProtoKey = Object.create(null);
  defineOwn(withoutProtoKey, 'safe', 1);
  assert.equal(G.canonicalStringify(withProtoKey), '{"__proto__":{"marker":"kept"},"safe":1}');
  assert.notEqual(G.hashHex(withProtoKey), G.hashHex(withoutProtoKey));
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const envelope = G.createCommandEnvelope({ commandId: 'command.test.proto-key.0001', actorId: input.caster.id, requestedTick: input.tick, correlationId: 'correlation.test.proto-key.0001', dataVersion: input.dataVersion, payload: withProtoKey });
  assert.equal(Object.prototype.hasOwnProperty.call(envelope.payload, '__proto__'), true);
  assert.deepEqual(envelope.payload.__proto__, { marker: 'kept' });
  assert.equal(({}).marker, undefined);
  const sparse = new Array(1);
  assert.throws(() => G.canonicalStringify(sparse), error => error.code === 'UNSERIALIZABLE_VALUE');
});

test('ReactionQueue는 priority, stableOrderKey, reactionId 순으로 실행한다', () => {
  const queue = new G.ReactionQueue();
  queue.enqueue({ reactionId: 'reaction.z', kind: 'probe', priority: 20, stableOrderKey: 'b' });
  queue.enqueue({ reactionId: 'reaction.b', kind: 'probe', priority: 10, stableOrderKey: 'a' });
  queue.enqueue({ reactionId: 'reaction.a', kind: 'probe', priority: 10, stableOrderKey: 'a' });
  const result = queue.drain(item => item.reactionId);
  assert.deepEqual(result.executed.map(item => item.reaction.reactionId), ['reaction.a', 'reaction.b', 'reaction.z']);
});

test('ReactionQueue는 dispatch 자식 depth를 부모에서 파생하고 새 자식을 같은 wave에서 재정렬한다', () => {
  const queue = new G.ReactionQueue({ maxDepth: 2, maxReactions: 4, maxBudget: 4 });
  const root = { reactionId: 'reaction.depth.root', kind: 'probe', priority: 10, depth: 0 };
  const sibling = { reactionId: 'reaction.depth.sibling', kind: 'probe', priority: 50, depth: 0 };
  const child = { reactionId: 'reaction.depth.child', kind: 'probe', priority: 1, depth: 0 };
  const grandchild = { reactionId: 'reaction.depth.grandchild', kind: 'probe', priority: 1, depth: 0 };
  const observed = [];
  queue.enqueue(sibling);
  queue.enqueue(root);
  const result = queue.drain(reaction => {
    observed.push([reaction.reactionId, reaction.depth]);
    if (reaction.reactionId === root.reactionId) queue.enqueue(child);
    if (reaction.reactionId === child.reactionId) queue.enqueue(grandchild);
    return reaction.depth;
  });
  assert.deepEqual(observed, [
    [root.reactionId, 0],
    [child.reactionId, 1],
    [grandchild.reactionId, 2],
    [sibling.reactionId, 0],
  ]);
  assert.deepEqual(result.executed.map(item => item.result), [0, 1, 2, 0]);
});

test('ReactionQueue는 maxDepth=0에서 same-depth 자식 위조를 wave 실패로 처리한다', () => {
  const queue = new G.ReactionQueue({ maxDepth: 0, maxReactions: 2, maxBudget: 2 });
  const root = { reactionId: 'reaction.depth-limit.root', kind: 'probe', depth: 0 };
  const forgedChild = { reactionId: 'reaction.depth-limit.child', kind: 'probe', depth: 0 };
  let enqueueError = null;
  queue.enqueue(root);
  assert.throws(
    () => queue.drain(reaction => {
      assert.equal(reaction.depth, 0);
      try { queue.enqueue(forgedChild); } catch (error) { enqueueError = error; }
    }),
    error => error.code === 'REACTION_WAVE_LIMIT_EXCEEDED' && error.details.reason === 'MAX_DEPTH',
  );
  assert.equal(enqueueError?.details.reason, 'MAX_DEPTH');
  assert.equal(queue.pending.length, 0);
});

test('ReactionQueue는 생성자 상한을 enqueue에서, 더 작은 drain 상한을 dispatch 전에 강제한다', () => {
  const depthQueue = new G.ReactionQueue({ maxDepth: 0 });
  assert.throws(
    () => depthQueue.enqueue({ reactionId: 'reaction.enqueue.depth', kind: 'probe', depth: 1 }),
    error => error.code === 'REACTION_WAVE_LIMIT_EXCEEDED' && error.details.reason === 'MAX_DEPTH',
  );
  assert.equal(depthQueue.pending.length, 0);

  const capacityQueue = new G.ReactionQueue({ maxReactions: 1 });
  const capacityA = { reactionId: 'reaction.enqueue.count-a', kind: 'probe' };
  const capacityB = { reactionId: 'reaction.enqueue.count-b', kind: 'probe' };
  capacityQueue.enqueue(capacityA);
  assert.throws(
    () => capacityQueue.enqueue(capacityB),
    error => error.code === 'REACTION_WAVE_LIMIT_EXCEEDED' && error.details.reason === 'MAX_REACTIONS',
  );
  capacityQueue.drain(() => null);
  assert.equal(capacityQueue.enqueue(capacityB), true);

  const budgetQueue = new G.ReactionQueue({ maxBudget: 1 });
  assert.throws(
    () => budgetQueue.enqueue({ reactionId: 'reaction.enqueue.budget', kind: 'probe', budgetCost: 2 }),
    error => error.code === 'REACTION_WAVE_LIMIT_EXCEEDED' && error.details.reason === 'BUDGET_EXCEEDED',
  );
  assert.equal(budgetQueue.pending.length, 0);

  const cases = [
    { options: { maxDepth: 2 }, budget: { maxDepth: 1 }, reason: 'MAX_DEPTH', reactions: [{ reactionId: 'reaction.start.depth', kind: 'probe', depth: 2 }] },
    { options: { maxReactions: 2 }, budget: { maxReactions: 1 }, reason: 'MAX_REACTIONS', reactions: [{ reactionId: 'reaction.start.count-a', kind: 'probe' }, { reactionId: 'reaction.start.count-b', kind: 'probe' }] },
    { options: { maxBudget: 2 }, budget: { maxBudget: 1 }, reason: 'BUDGET_EXCEEDED', reactions: [{ reactionId: 'reaction.start.budget', kind: 'probe', budgetCost: 2 }] },
  ];
  for (const item of cases) {
    const queue = new G.ReactionQueue(item.options);
    for (const reaction of item.reactions) queue.enqueue(reaction);
    const dispatched = [];
    const records = [];
    const trace = { record: (stage, tick, payload) => records.push({ stage, tick, payload }) };
    assert.throws(
      () => queue.drain(reaction => dispatched.push(reaction.reactionId), trace, 0, item.budget),
      error => error.code === 'REACTION_WAVE_LIMIT_EXCEEDED' && error.details.reason === item.reason,
    );
    assert.deepEqual(dispatched, []);
    assert.equal(records.at(-1)?.stage, 'reaction_wave_failed');
    assert.equal(records.at(-1)?.payload.reason, item.reason);
    assert.equal(queue.drain(() => { throw new Error('discarded work leaked'); }).executed.length, 0);
    for (const reaction of item.reactions) assert.equal(queue.enqueue(reaction), false);
  }
});

test('ReactionQueue는 handler 예외 뒤 잔여 reaction을 폐기하고 idempotency를 유지한다', () => {
  const queue = new G.ReactionQueue();
  const throwing = { reactionId: 'reaction.handler.throwing', kind: 'probe', priority: 1 };
  const skipped = { reactionId: 'reaction.handler.skipped', kind: 'probe', priority: 2 };
  queue.enqueue(skipped);
  queue.enqueue(throwing);
  const records = [];
  assert.throws(
    () => queue.drain(reaction => {
      if (reaction.reactionId === throwing.reactionId) throw new Error('handler failure');
    }, { record: (stage, tick, payload) => records.push({ stage, tick, payload }) }),
    /handler failure/,
  );
  assert.equal(records.at(-1)?.stage, 'reaction_wave_failed');
  assert.equal(records.at(-1)?.payload.reason, 'HANDLER_ERROR');
  assert.equal(records.at(-1)?.payload.reactionId, throwing.reactionId);
  assert.equal(queue.drain(() => { throw new Error('discarded work leaked'); }).executed.length, 0);
  assert.equal(queue.enqueue(skipped), false);
});

test('ReactionQueue는 성공 trace observer 예외가 dispatch 결과를 바꾸지 않게 격리한다', () => {
  const queue = new G.ReactionQueue();
  queue.enqueue({ reactionId: 'reaction.trace.a', kind: 'probe', priority: 1 });
  queue.enqueue({ reactionId: 'reaction.trace.b', kind: 'probe', priority: 2 });
  const dispatched = [];
  const result = queue.drain(reaction => dispatched.push(reaction.reactionId), { record: () => { throw new Error('trace sink unavailable'); } });
  assert.deepEqual(dispatched, ['reaction.trace.a', 'reaction.trace.b']);
  assert.equal(result.executed.length, 2);
  assert.equal(queue.pending.length, 0);
});

test('ReactionQueue trace observers cannot enqueue or mutate pending domain work', () => {
  const queue = new G.ReactionQueue();
  const root = { reactionId: 'reaction.trace-purity.root', kind: 'probe', priority: 1 };
  const child = { reactionId: 'reaction.trace-purity.child', kind: 'probe', priority: 2 };
  queue.enqueue(root);
  const dispatched = [];
  let observerCode = null;
  let mutationError = null;
  const result = queue.drain(reaction => dispatched.push(reaction.reactionId), {
    record(stage) {
      if (stage !== 'reaction_executed') return;
      try { queue.enqueue(child); } catch (error) { observerCode = error.code; }
      try { queue.pending.push(child); } catch (error) { mutationError = error; }
    },
  });
  assert.equal(observerCode, 'REACTION_TRACE_SIDE_EFFECT');
  assert.ok(mutationError instanceof TypeError);
  assert.deepEqual(dispatched, [root.reactionId]);
  assert.equal(result.executed.length, 1);
  assert.equal(queue.pending.length, 0);
  assert.equal(queue.enqueue(child), true);
});

test('ReactionQueue rejects trace getters and reaction accessors before they can enqueue work', () => {
  const queue = new G.ReactionQueue();
  const root = { reactionId: 'reaction.getter.root', kind: 'probe', priority: 1 };
  const injected = { reactionId: 'reaction.getter.injected', kind: 'probe', priority: 2 };
  queue.enqueue(root);
  let traceGetterCode = null;
  const trace = {};
  Object.defineProperty(trace, 'record', {
    get() {
      try { queue.enqueue(injected); } catch (error) { traceGetterCode = error.code; }
      return () => {};
    },
  });
  const dispatched = [];
  queue.drain(reaction => dispatched.push(reaction.reactionId), trace);
  assert.equal(traceGetterCode, 'REACTION_TRACE_SIDE_EFFECT');
  assert.deepEqual(dispatched, [root.reactionId]);
  assert.equal(queue.pending.length, 0);

  const accessorQueue = new G.ReactionQueue();
  const accessorReaction = { kind: 'probe' };
  let reactionReads = 0;
  Object.defineProperty(accessorReaction, 'reactionId', {
    enumerable: true,
    get() {
      reactionReads += 1;
      accessorQueue.enqueue({ reactionId: 'reaction.accessor.injected', kind: 'probe' });
      return 'reaction.accessor.root';
    },
  });
  assert.throws(() => accessorQueue.enqueue(accessorReaction), error => error.code === 'UNSERIALIZABLE_VALUE');
  assert.equal(reactionReads, 0);
  assert.equal(accessorQueue.pending.length, 0);
});

test('Global trace callbacks cannot inject cross-component ReactionQueue work', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false, skill: { hitChanceBps: 10_000, critChanceBps: 0 } });
  const impact = G.executeImpact(input);
  const queue = new G.ReactionQueue();
  let observerCode = null;
  G.enqueueReactions(impact.commit.events, queue, {
    record(stage) {
      if (stage !== 'reaction_enqueued') return;
      try { queue.enqueue({ reactionId: 'reaction.global-trace.injected', kind: 'probe' }); } catch (error) { observerCode = error.code; }
    },
  });
  assert.equal(observerCode, 'REACTION_TRACE_SIDE_EFFECT');
  assert.equal(queue.pending.length, 1);
  const dispatched = queue.drain(reaction => reaction.reactionId);
  assert.equal(dispatched.executed.length, 1);
  assert.notEqual(dispatched.executed[0].reaction.reactionId, 'reaction.global-trace.injected');
});

test('ReactionQueue는 dispatch 중 enqueue 한도 초과를 handler가 삼켜도 wave를 실패시킨다', () => {
  const queue = new G.ReactionQueue({ maxReactions: 1, maxDepth: 2, maxBudget: 2 });
  const root = { reactionId: 'reaction.nested.root', kind: 'probe', priority: 1, depth: 0 };
  const child = { reactionId: 'reaction.nested.child', kind: 'probe', priority: 2, depth: 1 };
  const dispatched = [];
  let enqueueError = null;
  const records = [];
  queue.enqueue(root);
  assert.throws(
    () => queue.drain(reaction => {
      dispatched.push(reaction.reactionId);
      try { queue.enqueue(child); } catch (error) { enqueueError = error; }
    }, { record: (stage, tick, payload) => records.push({ stage, tick, payload }) }),
    error => error.code === 'REACTION_WAVE_LIMIT_EXCEEDED' && error.details.reason === 'MAX_REACTIONS',
  );
  assert.equal(enqueueError?.code, 'REACTION_WAVE_LIMIT_EXCEEDED');
  assert.deepEqual(dispatched, [root.reactionId]);
  assert.equal(records.at(-1)?.stage, 'reaction_wave_failed');
  assert.equal(records.at(-1)?.payload.reason, 'MAX_REACTIONS');
  assert.equal(queue.drain(() => { throw new Error('discarded work leaked'); }).executed.length, 0);
  assert.equal(queue.enqueue(root), false);
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
  assert.equal(result.resolution.outcome.hitOutcome, 'Miss');
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

test('ContextualStatCache는 missing path와 sentinel 모양의 실제 값을 구분한다', () => {
  const cache = new G.ContextualStatCache();
  let computes = 0;
  const evaluate = (context, value) => cache.evaluate({
    entityId: 'entity.caster',
    statId: 'stat.sentinel-probe',
    ownerVersion: 1,
    dependencies: ['target.marker'],
    context,
    compute: () => { computes += 1; return value; },
  });
  const missing = evaluate({}, 'missing');
  const repeatedMissing = evaluate({}, 'unused');
  const explicitSentinel = evaluate({ target: { marker: { $missing: true } } }, 'literal');
  assert.equal(missing.cacheHit, false);
  assert.equal(repeatedMissing.cacheHit, true);
  assert.equal(repeatedMissing.value, 'missing');
  assert.equal(explicitSentinel.cacheHit, false);
  assert.equal(explicitSentinel.value, 'literal');
  assert.deepEqual(missing.fingerprint.values['target.marker'], { presence: 'missing' });
  assert.deepEqual(explicitSentinel.fingerprint.values['target.marker'], { presence: 'present', value: { $missing: true } });
  assert.equal(cache.stats().size, 2);
  assert.equal(computes, 2);
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
  assert.equal(result.resolution.outcome.hitOutcome, 'Hit');
  assert.equal(result.resolution.outcome.finalHpDamage, 0);
  assert.equal(result.resolution.outcome.burn.rawTickDamage, 20);
  assert.equal(result.resolution.outcome.burn.applyWhenTargetAlive, true);
  assert.ok(result.outbox.some(event => event.type === 'StatusApplied'));
  assert.equal(Object.keys(result.finalState.entities[result.input.target.id].statuses).length, 1);
});

test('positive Burn ratios clamp a rounded-zero tick to one while zero ratio disables application', () => {
  const scenario = {
    caster: { spellPower: 0 },
    target: { hp: 10, maxHp: 10, shield: 0 },
    skill: { baseDamage: 1, coefficientBps: 0, hitChanceBps: 10_000, critChanceBps: 0 },
    burn: { ratioBps: 1 },
    simulateStatusTicks: false,
  };
  const positive = G.runFireballScenario(scenario);
  assert.equal(positive.resolution.outcome.rawDamage, 1);
  assert.equal(positive.resolution.outcome.burn.rawTickDamage, 1);
  assert.equal(positive.resolution.outcome.burn.applyWhenTargetAlive, true);
  assert.ok(positive.outbox.some(event => event.type === 'StatusApplied'));

  const disabled = G.runFireballScenario({ ...scenario, burn: { ratioBps: 0 } });
  assert.equal(disabled.resolution.outcome.burn.rawTickDamage, 0);
  assert.equal(disabled.resolution.outcome.burn.applyWhenTargetAlive, false);
  assert.equal(disabled.outbox.some(event => event.type === 'StatusApplied'), false);
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
    assert.deepEqual(
      damage.payload.exactRawDamage,
      { numerator: String(damage.payload.rawDamage), denominator: '1' },
    );
    assert.equal(damage.payload.rawDamage, 20);
    assert.equal(damage.payload.resistanceBps, 2_000);
    assert.equal(damage.payload.resolvedDamage, 16);
    if (tick === ticks[0]) {
      assert.equal(damage.payload.shieldAbsorbed, 16);
      assert.equal(tick.payload.finalHpDamage, 0);
    } else {
      assert.equal(damage.payload.shieldAbsorbed, 0);
      assert.equal(tick.payload.finalHpDamage, 16);
    }
  }
});

test('periodic DamageCommitted binds its exact fraction to the StatusInstance integer tick damage', () => {
  const input = G.normalizeScenarioInput({
    simulateStatusTicks: false,
    skill: { hitChanceBps: 10_000, critChanceBps: 0 },
  });
  const impact = G.executeImpact(input);
  const queue = new G.ReactionQueue({
    maxDepth: 8,
    maxReactions: 32,
    maxBudget: 64,
  });
  G.enqueueReactions(impact.commit.events, queue);
  queue.drain(
    reaction => G.applyStatusReaction(impact.store, reaction),
    null,
    input.tick,
  );

  const store = impact.store;
  const entity = store.getEntity(input.target.id);
  const status = Object.values(entity.statuses)[0];
  const sourceRef = {
    kind: 'status',
    definitionId: status.definitionId,
    instanceId: status.instanceId,
  };
  const commitTick = status.nextTickAt;
  const commandId =
    `command.${G.hashHex([status.instanceId, 'tick', status.nextTickAt])}`;
  const command = G.createCommandEnvelope({
    commandId,
    actorId: status.actorId,
    requestedTick: commitTick,
    correlationId: status.correlationId,
    causationId: status.lastTransitionEventId,
    dataVersion: status.dataVersion,
    payload: {
      targetId: entity.id,
      statusInstanceId: status.instanceId,
      applicationSourceId: status.applicationSourceId,
      applicationSourceRef: status.applicationSourceRef,
      sourceId: status.instanceId,
      sourceRef,
    },
  });
  const damage = G.resolveDamageAgainstTarget({
    actorId: status.actorId,
    sourceId: status.instanceId,
    sourceRef,
    target: entity,
    damageType: 'fire',
    rawDamage: status.rawTickDamage,
  });
  const statusTickedEventId =
    `event.${G.hashHex([commandId, 'StatusTicked', 1, commitTick])}`;
  const operations = [];
  if (damage.shieldAbsorbed > 0) {
    operations.push({
      order: 10,
      kind: 'resource.delta',
      entityId: entity.id,
      resource: 'shield',
      delta: -damage.shieldAbsorbed,
      key: 'tick-shield',
    });
  }
  if (damage.finalHpDamage > 0) {
    operations.push({
      order: 20,
      kind: 'resource.delta',
      entityId: entity.id,
      resource: 'hp',
      delta: -damage.finalHpDamage,
      key: 'tick-hp',
    });
  }
  operations.push({
    order: 30,
    kind: 'status.patch',
    entityId: entity.id,
    instanceId: status.instanceId,
    patch: {
      nextTickAt: status.nextTickAt + status.intervalTicks,
      lastTransitionEventId: statusTickedEventId,
    },
    key: 'schedule-next',
  });
  const tickDamageOutcome = {
    ...damage,
    statusInstanceId: status.instanceId,
    statusDefinitionId: status.definitionId,
    periodic: true,
    tickAt: status.nextTickAt,
    triggerEventId: status.lastTransitionEventId,
  };
  const eventBlueprints = [
    { type: 'DamageCommitted', payload: tickDamageOutcome },
    {
      type: 'StatusTicked',
      payload: {
        actorId: status.actorId,
        applicationSourceId: status.applicationSourceId,
        applicationSourceRef: status.applicationSourceRef,
        sourceId: status.instanceId,
        sourceRef,
        targetId: entity.id,
        statusInstanceId: status.instanceId,
        definitionId: status.definitionId,
        rawDamage: damage.rawDamage,
        resolvedDamage: damage.resolvedDamage,
        shieldAbsorbed: damage.shieldAbsorbed,
        finalHpDamage: damage.finalHpDamage,
        tickAt: status.nextTickAt,
        triggerEventId: status.lastTransitionEventId,
      },
    },
  ];
  const planBase = {
    schemaVersion: G.CONTRACT_SCHEMA_VERSION,
    commandId,
    commitTick,
    preconditions: [{ entityId: entity.id, expectedVersion: entity.version }],
    operations,
    eventBlueprints,
  };
  const validPlan = {
    ...planBase,
    planId: `plan.${G.hashHex(planBase)}`,
  };
  const forgedPlan = JSON.parse(JSON.stringify(validPlan));
  const forgedDamage = forgedPlan.eventBlueprints[0].payload;
  forgedDamage.exactRawDamage = {
    numerator: String(status.rawTickDamage * 5 + 2),
    denominator: '5',
  };
  const before = G.canonicalStringify(store.exportState());

  assert.throws(
    () => store.commit(command, forgedPlan),
    error => error.code === 'OUTBOX_FACT_MISMATCH',
  );
  assert.equal(G.canonicalStringify(store.exportState()), before);
  assert.doesNotThrow(() => store.commit(command, validPlan));
});

test('application source and periodic status source stay distinct across the full outcome', () => {
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
  assert.equal(applied.payload.status.applicationSourceId, result.command.commandId);
  assert.deepEqual(applied.payload.status.applicationSourceRef, expectedRef);
  const impact = result.outbox.find(event => event.type === 'DamageCommitted' && !event.payload.periodic);
  assert.equal(applied.payload.status.applicationCausationId, impact.eventId);
  assert.equal(applied.payload.status.lastTransitionEventId, applied.eventId);
  assert.equal(Object.hasOwn(applied.payload.status, 'causationId'), false);
  const expectedStatusRef = {
    kind: 'status',
    definitionId: result.input.burn.definitionId,
    instanceId: applied.payload.status.instanceId,
  };
  assert.equal(applied.payload.status.sourceId, applied.payload.status.instanceId);
  assert.deepEqual(applied.payload.status.sourceRef, expectedStatusRef);
  const periodic = result.outbox.find(event => event.type === 'DamageCommitted' && event.payload.periodic);
  assert.equal(periodic.payload.actorId, result.input.caster.id);
  assert.equal(periodic.payload.sourceId, applied.payload.status.instanceId);
  assert.deepEqual(periodic.payload.sourceRef, expectedStatusRef);
  const ticked = result.outbox.find(event => event.type === 'StatusTicked');
  assert.equal(ticked.payload.applicationSourceId, result.command.commandId);
  assert.deepEqual(ticked.payload.applicationSourceRef, expectedRef);
  assert.deepEqual(ticked.payload.sourceRef, expectedStatusRef);
  const transitions = result.outbox.filter(event => event.type === 'StatusTicked');
  assert.equal(transitions[0].payload.triggerEventId, applied.eventId);
  assert.equal(transitions[1].payload.triggerEventId, transitions[0].eventId);
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
    applicationSourceId: sourceRef.instanceId,
    applicationSourceRef: sourceRef,
    applicationCausationId: 'event.test.damage.0001',
    sourceId: instanceId,
    sourceRef: { kind: 'status', definitionId: 'status.burn', instanceId },
    targetId: input.target.id,
    correlationId: 'correlation.test.cast.0001',
    lastTransitionEventId: 'event.test.damage.0001',
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

test('restored overdue statuses preserve scheduled tick facts while committing at the current simulation tick', () => {
  const input = G.normalizeScenarioInput({
    target: { shield: 0, fireResistanceBps: 0 },
  });
  const state = JSON.parse(JSON.stringify(G.createInitialState(input)));
  const statusInstanceId = 'status-instance.restored-overdue';
  const scheduledTick = input.tick + 1;
  const restoredTick = input.tick + 5;
  const sourceRef = {
    kind: 'skill-execution',
    definitionId: input.skill.definitionId,
    instanceId: 'command.test.restored-cast.0001',
  };
  state.tick = restoredTick;
  state.entities[input.target.id].statuses = {
    [statusInstanceId]: {
      instanceId: statusInstanceId,
      definitionId: input.burn.definitionId,
      actorId: input.caster.id,
      applicationSourceId: sourceRef.instanceId,
      applicationSourceRef: sourceRef,
      applicationCausationId: 'event.test.restored-damage.0001',
      sourceId: statusInstanceId,
      sourceRef: {
        kind: 'status',
        definitionId: input.burn.definitionId,
        instanceId: statusInstanceId,
      },
      targetId: input.target.id,
      correlationId: 'correlation.test.restored-cast.0001',
      lastTransitionEventId: 'event.test.restored-status-applied.0001',
      dataVersion: input.dataVersion,
      appliedTick: input.tick,
      nextTickAt: scheduledTick,
      expireTick: scheduledTick,
      intervalTicks: 1,
      rawTickDamage: 1,
      maxCatchUpTicks: 8,
    },
  };
  const store = new G.StateStore(state);
  const result = G.advanceStatuses(store, restoredTick);
  const ticked = store.outbox.find(event => event.type === 'StatusTicked');
  const expired = store.outbox.find(event => event.type === 'StatusExpired');

  assert.equal(result.tickCount, 1);
  assert.equal(ticked.payload.tickAt, scheduledTick);
  assert.equal(ticked.occurredTick, restoredTick);
  assert.equal(expired.payload.scheduledExpireTick, scheduledTick);
  assert.equal(expired.payload.endedTick, restoredTick);
  assert.equal(expired.occurredTick, restoredTick);
  assert.equal(expired.payload.reason, 'duration-expired');
  assert.equal(Object.hasOwn(expired.payload, 'catchUpLimited'), false);
  assert.equal(
    Object.keys(store.exportState().entities[input.target.id].statuses).length,
    0,
  );
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
  assert.deepEqual(G.createSourceRef({
    kind: 'system',
    definitionId: 'system.combat',
  }), {
    kind: 'system',
    definitionId: 'system.combat',
  });
  assert.equal(errorCode(() => G.createSourceRef({
    kind: 'status',
    definitionId: 'status.burn',
  })), 'INVALID_STRING');
  assert.deepEqual(G.createSourceRef({
    kind: 'system',
    definitionId: 'system.combat',
    instanceId: 'runtime.combat.0001',
  }), {
    kind: 'system',
    definitionId: 'system.combat',
    instanceId: 'runtime.combat.0001',
  });
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

test('Fireball cooldown은 ready tick 경계에서 승인하고 미래 ready tick은 RNG 전에 거부한다', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const readyState = JSON.parse(JSON.stringify(G.createInitialState(input)));
  readyState.entities[input.caster.id].cooldowns[input.skill.definitionId] = input.tick;
  const readyStore = new G.StateStore(readyState);
  const command = G.createFireballCommand(input);
  let readyRolls = 0;
  const readyResolution = G.resolveFireball({
    snapshot: readyStore.snapshot([input.caster.id, input.target.id]),
    command,
    input,
    rng: { sampleBps: () => { readyRolls += 1; return 0; } },
  });
  assert.equal(readyResolution.outcome.hitOutcome, 'Hit');
  assert.equal(readyRolls, 2);

  const blockedState = JSON.parse(JSON.stringify(G.createInitialState(input)));
  blockedState.entities[input.caster.id].cooldowns[input.skill.definitionId] = input.tick + 1;
  const blockedStore = new G.StateStore(blockedState);
  const before = G.canonicalStringify(blockedStore.exportState());
  let blockedRolls = 0;
  assert.throws(
    () => G.resolveFireball({
      snapshot: blockedStore.snapshot([input.caster.id, input.target.id]),
      command,
      input,
      rng: { sampleBps: () => { blockedRolls += 1; return 0; } },
    }),
    error => error.code === 'COOLDOWN_ACTIVE'
      && error.details.cooldownReadyTick === input.tick + 1
      && error.details.executionTick === input.tick,
  );
  assert.equal(blockedRolls, 0);
  assert.equal(blockedStore.outbox.length, 0);
  assert.equal(G.canonicalStringify(blockedStore.exportState()), before);
});

test('Fireball resolve 뒤 cooldown interleaving은 stale plan 전체를 거부한다', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false });
  const store = new G.StateStore(G.createInitialState(input));
  const command = G.createFireballCommand(input);
  const snapshot = store.snapshot([input.caster.id, input.target.id]);
  const resolution = G.resolveFireball({ snapshot, command, input, rng: new G.KeyedRandom(input.rootSeed) });
  const caster = store.getEntity(input.caster.id);
  const externalReadyTick = input.tick + 100;
  const externalPayload = {
    actorId: input.caster.id,
    skillDefinitionId: input.skill.definitionId,
    readyTick: externalReadyTick,
  };
  const external = G.createCommandEnvelope({
    commandId: 'command.external.cooldown.0001',
    actorId: input.caster.id,
    requestedTick: input.tick,
    correlationId: 'correlation.external.cooldown.0001',
    dataVersion: input.dataVersion,
    payload: externalPayload,
  });
  const externalBase = {
    schemaVersion: G.CONTRACT_SCHEMA_VERSION,
    commandId: external.commandId,
    commitTick: input.tick,
    preconditions: [{ entityId: caster.id, expectedVersion: caster.version }],
    operations: [{ order: 10, kind: 'cooldown.set', entityId: caster.id, definitionId: input.skill.definitionId, readyTick: externalReadyTick, key: 'external-cooldown' }],
    eventBlueprints: [{ type: 'ExternalCooldownChanged', payload: externalPayload }],
  };
  store.commit(external, { ...externalBase, planId: 'plan.external.cooldown.0001' });
  const beforeState = G.canonicalStringify(store.exportState());
  const beforeOutbox = G.canonicalStringify(store.outbox);
  assert.throws(() => store.commit(command, resolution.plan), error => error.code === 'VERSION_CONFLICT');
  assert.equal(G.canonicalStringify(store.exportState()), beforeState);
  assert.equal(G.canonicalStringify(store.outbox), beforeOutbox);
});

test('apply-status reaction은 같은 store의 committed DamageCommitted와 전체 payload가 일치해야 한다', () => {
  const input = G.normalizeScenarioInput({
    simulateStatusTicks: false,
    skill: { hitChanceBps: 10_000, critChanceBps: 0 },
  });
  const impact = G.executeImpact(input);
  const queue = new G.ReactionQueue({
    maxDepth: 8,
    maxReactions: 8,
    maxBudget: 8,
  });
  G.enqueueReactions(impact.commit.events, queue);
  const committedReaction = queue.pending[0];
  const skillEvent = impact.commit.events.find(
    event => event.type === 'SkillCommitted',
  );
  const beforeState = G.canonicalStringify(impact.store.exportState());
  const beforeOutbox = G.canonicalStringify(impact.store.outbox);
  const dispatchCandidate = (
    candidate,
    limits = { maxDepth: 8, maxReactions: 8, maxBudget: 8 },
  ) => {
    const candidateQueue = new G.ReactionQueue(limits);
    candidateQueue.enqueue(candidate);
    return candidateQueue.drain(
      dispatched => G.applyStatusReaction(impact.store, dispatched),
    );
  };

  assert.throws(
    () => G.applyStatusReaction(impact.store, committedReaction),
    error => error.code === 'REACTION_DISPATCH_REQUIRED',
  );

  const forgedCause = JSON.parse(JSON.stringify(committedReaction));
  forgedCause.payload.causationId = 'event.forged.damage.0001';
  assert.throws(
    () => dispatchCandidate(forgedCause),
    error => error.code === 'REACTION_SOURCE_NOT_COMMITTED',
  );

  const wrongCommittedType = JSON.parse(JSON.stringify(committedReaction));
  wrongCommittedType.payload.causationId = skillEvent.eventId;
  assert.throws(
    () => dispatchCandidate(wrongCommittedType),
    error => error.code === 'REACTION_SOURCE_NOT_COMMITTED'
      && error.details.matchedType === 'SkillCommitted',
  );

  const tamperCases = [
    reaction => { reaction.reactionId = 'reaction.forged.apply-status.0001'; },
    reaction => { reaction.idempotencyKey = 'idempotency.forged.apply-status.0001'; },
    reaction => { reaction.priority += 1; },
    reaction => { reaction.stableOrderKey = 'entity.forged:status.forged'; },
    reaction => { reaction.budgetCost += 1; },
    reaction => { reaction.payload.actorId = 'entity.forged-actor'; },
    reaction => {
      reaction.payload.sourceId = 'command.forged.cast.0001';
      reaction.payload.sourceRef.instanceId = 'command.forged.cast.0001';
    },
    reaction => { reaction.payload.targetId = 'entity.forged-target'; },
    reaction => { reaction.payload.definitionId = 'status.forged'; },
    reaction => { reaction.payload.rawTickDamage += 1; },
    reaction => { reaction.payload.durationTicks += 1; },
    reaction => { reaction.payload.intervalTicks += 1; },
    reaction => { reaction.payload.maxCatchUpTicks += 1; },
    reaction => { reaction.payload.correlationId = 'correlation.forged.cast.0001'; },
    reaction => { reaction.payload.dataVersion = 'data.forged'; },
  ];
  for (const tamper of tamperCases) {
    const candidate = JSON.parse(JSON.stringify(committedReaction));
    tamper(candidate);
    assert.throws(
      () => dispatchCandidate(candidate),
      error => error.code === 'REACTION_SOURCE_MISMATCH',
    );
  }

  const depthUnderflow = JSON.parse(JSON.stringify(committedReaction));
  depthUnderflow.depth = 0;
  assert.throws(
    () => dispatchCandidate(
      depthUnderflow,
      { maxDepth: 0, maxReactions: 1, maxBudget: 1 },
    ),
    error => error.code === 'REACTION_SOURCE_MISMATCH',
  );

  assert.equal(G.canonicalStringify(impact.store.exportState()), beforeState);
  assert.equal(G.canonicalStringify(impact.store.outbox), beforeOutbox);
  const receipt = dispatchCandidate(committedReaction).executed[0].result;
  assert.equal(receipt.events.length, 1);
  assert.equal(receipt.events[0].type, 'StatusApplied');
  const applied = Object.values(
    impact.store.getEntity(input.target.id).statuses,
  )[0];
  assert.equal(applied.rawTickDamage, committedReaction.payload.rawTickDamage);
  assert.equal(applied.applicationCausationId, committedReaction.payload.causationId);
});

test('apply-status provenance는 queue가 부모에서 파생한 nested depth를 덮어쓰지 않는다', () => {
  const input = G.normalizeScenarioInput({
    simulateStatusTicks: false,
    skill: { hitChanceBps: 10_000, critChanceBps: 0 },
  });
  const impact = G.executeImpact(input);
  const queue = new G.ReactionQueue({
    maxDepth: 8,
    maxReactions: 8,
    maxBudget: 8,
  });
  queue.enqueue({
    reactionId: 'reaction.parent.dispatch.0001',
    idempotencyKey: 'idempotency.parent.dispatch.0001',
    kind: 'probe-parent',
    priority: 0,
    stableOrderKey: 'parent',
    depth: 1,
    budgetCost: 1,
    payload: {},
  });
  const drained = queue.drain(reaction => {
    if (reaction.kind === 'probe-parent') {
      G.enqueueReactions(impact.commit.events, queue);
      return { outcome: 'ParentDispatched' };
    }
    return G.applyStatusReaction(impact.store, reaction);
  });
  assert.deepEqual(
    drained.executed.map(item => [item.reaction.kind, item.reaction.depth]),
    [['probe-parent', 1], ['apply-status', 2]],
  );
  assert.equal(
    Object.keys(impact.store.getEntity(input.target.id).statuses).length,
    1,
  );
  assert.equal(
    drained.executed[1].result.events[0].type,
    'StatusApplied',
  );
});

test('Status reaction은 primary commit 뒤 사망한 live target을 terminal NotApplicable로 종료한다', () => {
  const input = G.normalizeScenarioInput({ simulateStatusTicks: false, skill: { hitChanceBps: 10_000, critChanceBps: 0 } });
  const impact = G.executeImpact(input);
  const queue = new G.ReactionQueue({ maxDepth: 8, maxReactions: 8, maxBudget: 8 });
  G.enqueueReactions(impact.commit.events, queue);
  const queuedReaction = queue.pending[0];
  const target = impact.store.getEntity(input.target.id);
  const killPayload = {
    entityId: target.id,
    targetId: target.id,
    actorId: input.caster.id,
    sourceId: 'system.external-kill',
    sourceRef: { kind: 'system', definitionId: 'system.external-kill' },
    damageType: 'scripted',
    periodic: false,
  };
  const killCommand = G.createCommandEnvelope({
    commandId: 'command.external.kill-before-reaction.0001',
    actorId: input.caster.id,
    requestedTick: impact.store.tick,
    correlationId: 'correlation.external.kill-before-reaction.0001',
    dataVersion: input.dataVersion,
    payload: killPayload,
  });
  const killBase = {
    schemaVersion: G.CONTRACT_SCHEMA_VERSION,
    commandId: killCommand.commandId,
    commitTick: impact.store.tick,
    preconditions: [{ entityId: target.id, expectedVersion: target.version }],
    operations: [{ order: 10, kind: 'resource.delta', entityId: target.id, resource: 'hp', delta: -target.resources.hp, key: 'kill' }],
    eventBlueprints: [{
      type: 'EntityDefeated',
      payload: killPayload,
    }],
  };
  impact.store.commit(killCommand, { ...killBase, planId: 'plan.external.kill-before-reaction.0001' });
  const beforeState = G.canonicalStringify(impact.store.exportState());
  const beforeOutbox = G.canonicalStringify(impact.store.outbox);
  const malformedReaction = {
    ...queuedReaction,
    payload: { ...queuedReaction.payload },
  };
  delete malformedReaction.payload.actorId;
  assert.throws(
    () => G.applyStatusReaction(impact.store, malformedReaction),
    error => error.code === 'INVALID_REACTION_PAYLOAD'
      && error.details.missingFields.includes('actorId'),
  );
  assert.equal(G.canonicalStringify(impact.store.exportState()), beforeState);
  assert.equal(G.canonicalStringify(impact.store.outbox), beforeOutbox);
  const drained = queue.drain(reaction => G.applyStatusReaction(impact.store, reaction));
  assert.equal(drained.executed.length, 1);
  assert.deepEqual(drained.executed[0].result, {
    outcome: 'NotApplicable',
    reason: 'TARGET_NOT_ALIVE',
    reactionId: queuedReaction.reactionId,
    targetId: input.target.id,
    stateChanged: false,
    events: [],
  });
  assert.equal(G.canonicalStringify(impact.store.exportState()), beforeState);
  assert.equal(G.canonicalStringify(impact.store.outbox), beforeOutbox);
  assert.equal(Object.keys(impact.store.getEntity(input.target.id).statuses).length, 0);
  assert.equal(queue.enqueue(queuedReaction), false);
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
    applicationSourceId: sourceRef.instanceId,
    applicationSourceRef: sourceRef,
    applicationCausationId: 'event.test.damage.0002',
    sourceId: instanceId,
    sourceRef: { kind: 'status', definitionId: 'status.burn', instanceId },
    targetId: input.target.id,
    correlationId: 'correlation.test.cast.0002',
    lastTransitionEventId: 'event.test.damage.0002',
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
    applicationSourceId: sourceRef.instanceId,
    applicationSourceRef: sourceRef,
    applicationCausationId: 'event.test.damage.0003',
    sourceId: instanceId,
    sourceRef: { kind: 'status', definitionId: 'status.burn', instanceId },
    targetId: input.target.id,
    correlationId: 'correlation.test.cast.0003',
    lastTransitionEventId: 'event.test.damage.0003',
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
  const defeated = store.outbox.find(event => event.type === 'EntityDefeated');
  const dependentExpiry = store.outbox.find(event => event.type === 'StatusExpired' && event.payload.statusInstanceId === 'status-instance.b-pending');
  assert.equal(dependentExpiry.payload.triggerEventId, defeated.eventId);
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
    assert.equal(event.payload.resolvedDamage, event.payload.shieldAbsorbed + event.payload.finalHpDamage + event.payload.overkill);
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
