(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GSFRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRuntime() {
  'use strict';

  const RUNTIME_VERSION = '3.3.0-reference';
  const CONTRACT_SCHEMA_VERSION = 1;
  const REPLAY_FORMAT_VERSION = 1;
  const RNG_ALGORITHM_VERSION = 'mulberry32-keyed-v1';
  const NUMERIC_POLICY_VERSION = 'integer-bps-half-up-v1';
  const BASIS_POINTS = 10_000;
  const ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[A-Za-z0-9_-]+)+$/;

  class DomainError extends Error {
    constructor(code, stage, message, details = {}, retryable = false) {
      super(message);
      this.name = 'DomainError';
      this.code = code;
      this.stage = stage;
      this.details = deepFreeze(deepClone(details));
      this.retryable = Boolean(retryable);
    }
    toJSON() {
      return { name: this.name, code: this.code, stage: this.stage, message: this.message, retryable: this.retryable, details: this.details };
    }
  }

  function domainAssert(condition, code, stage, message, details = {}, retryable = false) {
    if (!condition) throw new DomainError(code, stage, message, details, retryable);
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function deepClone(value) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (Array.isArray(value)) return value.map(deepClone);
    if (isPlainObject(value)) {
      const output = {};
      for (const [key, item] of Object.entries(value)) output[key] = deepClone(item);
      return output;
    }
    throw new DomainError('UNSERIALIZABLE_VALUE', 'contract', 'Only JSON-like values are supported.', { type: typeof value });
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
    return value;
  }

  function canonicalStringify(value) {
    function normalize(item) {
      if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
      if (typeof item === 'number') {
        domainAssert(Number.isFinite(item), 'NON_FINITE_NUMBER', 'canonical', 'Canonical values must contain finite numbers.');
        return Object.is(item, -0) ? 0 : item;
      }
      if (Array.isArray(item)) return item.map(normalize);
      domainAssert(isPlainObject(item), 'UNSERIALIZABLE_VALUE', 'canonical', 'Canonical values must be plain JSON objects.');
      const output = {};
      for (const key of Object.keys(item).sort(compareText)) output[key] = normalize(item[key]);
      return output;
    }
    return JSON.stringify(normalize(value));
  }

  function compareText(left, right) {
    return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
  }

  function hashHex(value) {
    const text = typeof value === 'string' ? value : canonicalStringify(value);
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    const mask = 0xffffffffffffffffn;
    const bytes = new TextEncoder().encode(text);
    for (const byte of bytes) {
      hash ^= BigInt(byte);
      hash = (hash * prime) & mask;
    }
    return hash.toString(16).padStart(16, '0');
  }

  function hash32(...parts) {
    const text = canonicalStringify(parts);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  function requireString(value, label) {
    domainAssert(typeof value === 'string' && value.trim().length > 0, 'INVALID_STRING', 'contract', `${label} must be a non-empty string.`, { label });
    return value;
  }

  function requireInteger(value, label, minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER) {
    domainAssert(Number.isSafeInteger(value), 'INVALID_INTEGER', 'contract', `${label} must be a safe integer.`, { label, value });
    domainAssert(value >= minimum && value <= maximum, 'INTEGER_OUT_OF_RANGE', 'contract', `${label} is outside the accepted range.`, { label, value, minimum, maximum });
    return value;
  }

  function requireId(value, label) {
    requireString(value, label);
    domainAssert(ID_PATTERN.test(value), 'INVALID_ID', 'contract', `${label} must be a namespaced identifier.`, { label, value });
    return value;
  }

  function createSourceRef(value) {
    domainAssert(isPlainObject(value), 'INVALID_SOURCE_REF', 'contract', 'sourceRef must be a plain object.');
    const unknownFields = Object.keys(value).filter(key => !['kind', 'definitionId', 'instanceId'].includes(key)).sort(compareText);
    domainAssert(unknownFields.length === 0, 'INVALID_SOURCE_REF', 'contract', 'sourceRef contains unsupported fields.', { unknownFields });
    const kind = requireString(value.kind, 'sourceRef.kind');
    domainAssert(/^[a-z][a-z0-9-]*$/.test(kind), 'INVALID_SOURCE_KIND', 'contract', 'sourceRef.kind must be a lowercase kebab-case identifier.', { kind });
    return deepFreeze({
      kind,
      definitionId: requireId(value.definitionId, 'sourceRef.definitionId'),
      instanceId: requireId(value.instanceId, 'sourceRef.instanceId'),
    });
  }

  function multiplyBps(value, basisPoints) {
    requireInteger(value, 'value');
    requireInteger(basisPoints, 'basisPoints', -1_000_000, 1_000_000);
    const product = value * basisPoints;
    domainAssert(Number.isSafeInteger(product), 'NUMERIC_OVERFLOW', 'numeric', 'Basis-point multiplication exceeded safe integer range.', { value, basisPoints });
    if (product >= 0) return Math.floor((product + BASIS_POINTS / 2) / BASIS_POINTS);
    return Math.ceil((product - BASIS_POINTS / 2) / BASIS_POINTS);
  }

  function mulberry32(seed) {
    let state = seed >>> 0;
    return function next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  class KeyedRandom {
    constructor(rootSeed) {
      this.rootSeed = requireInteger(rootSeed, 'rootSeed', 0, 0xffffffff);
    }
    sample(key) {
      const seed = hash32(this.rootSeed, key, RNG_ALGORITHM_VERSION);
      return mulberry32(seed)();
    }
    sampleBps(key) {
      return Math.floor(this.sample(key) * BASIS_POINTS);
    }
  }

  class TraceRecorder {
    constructor(header = {}) {
      this.header = deepFreeze(deepClone(header));
      this.records = [];
    }
    record(stage, tick, payload = {}) {
      requireString(stage, 'stage');
      requireInteger(tick, 'tick', 0);
      const record = deepFreeze({ sequence: this.records.length + 1, stage, tick, payload: deepClone(payload) });
      this.records.push(record);
      return record;
    }
    export() {
      return deepFreeze(this.records.map(deepClone));
    }
    hash() {
      return hashHex({ header: this.header, records: this.records });
    }
  }

  function createCommandEnvelope(value) {
    const envelope = {
      schemaVersion: value.schemaVersion ?? CONTRACT_SCHEMA_VERSION,
      commandId: requireId(value.commandId, 'commandId'),
      actorId: requireId(value.actorId, 'actorId'),
      requestedTick: requireInteger(value.requestedTick, 'requestedTick', 0),
      correlationId: requireId(value.correlationId, 'correlationId'),
      causationId: value.causationId == null ? null : requireId(value.causationId, 'causationId'),
      dataVersion: requireString(value.dataVersion ?? 'data.reference', 'dataVersion'),
      payload: deepClone(value.payload ?? {}),
    };
    requireInteger(envelope.schemaVersion, 'schemaVersion', 1);
    return deepFreeze(envelope);
  }

  function createDomainEventEnvelope(value) {
    const envelope = {
      schemaVersion: value.schemaVersion ?? CONTRACT_SCHEMA_VERSION,
      eventId: requireId(value.eventId, 'eventId'),
      type: requireString(value.type, 'type'),
      correlationId: requireId(value.correlationId, 'correlationId'),
      causationId: requireId(value.causationId, 'causationId'),
      occurredTick: requireInteger(value.occurredTick, 'occurredTick', 0),
      payload: deepClone(value.payload ?? {}),
    };
    requireInteger(envelope.schemaVersion, 'schemaVersion', 1);
    return deepFreeze(envelope);
  }

  class ReactionQueue {
    constructor({ maxDepth = 8, maxReactions = 64, maxBudget = 128 } = {}) {
      this.maxDepth = requireInteger(maxDepth, 'maxDepth', 0);
      this.maxReactions = requireInteger(maxReactions, 'maxReactions', 1);
      this.maxBudget = requireInteger(maxBudget, 'maxBudget', 1);
      this.pending = [];
      this.idempotency = new Set();
    }
    enqueue(raw) {
      const reaction = deepFreeze({
        reactionId: requireId(raw.reactionId, 'reactionId'),
        idempotencyKey: requireId(raw.idempotencyKey ?? raw.reactionId, 'idempotencyKey'),
        kind: requireString(raw.kind, 'kind'),
        priority: requireInteger(raw.priority ?? 100, 'priority'),
        stableOrderKey: requireString(raw.stableOrderKey ?? raw.reactionId, 'stableOrderKey'),
        depth: requireInteger(raw.depth ?? 0, 'depth', 0),
        budgetCost: requireInteger(raw.budgetCost ?? 1, 'budgetCost', 1),
        payload: deepClone(raw.payload ?? {}),
      });
      if (this.idempotency.has(reaction.idempotencyKey)) return false;
      this.idempotency.add(reaction.idempotencyKey);
      this.pending.push(reaction);
      return true;
    }
    drain(handler, trace = null, tick = 0) {
      domainAssert(typeof handler === 'function', 'INVALID_REACTION_HANDLER', 'reaction', 'Reaction handler must be a function.');
      const executed = [];
      const rejected = [];
      let budgetUsed = 0;
      while (this.pending.length) {
        this.pending.sort((left, right) => left.priority - right.priority || compareText(left.stableOrderKey, right.stableOrderKey) || compareText(left.reactionId, right.reactionId));
        const reaction = this.pending.shift();
        const reason = reaction.depth > this.maxDepth ? 'MAX_DEPTH'
          : executed.length >= this.maxReactions ? 'MAX_REACTIONS'
            : budgetUsed + reaction.budgetCost > this.maxBudget ? 'BUDGET_EXCEEDED' : null;
        if (reason) {
          rejected.push({ reaction, reason });
          trace?.record('reaction_rejected', tick, { reactionId: reaction.reactionId, reason, budgetUsed });
          continue;
        }
        budgetUsed += reaction.budgetCost;
        const result = handler(reaction);
        executed.push({ reaction, result });
        trace?.record('reaction_executed', tick, { reactionId: reaction.reactionId, kind: reaction.kind, budgetUsed });
      }
      return deepFreeze({ executed, rejected, budgetUsed, exhausted: rejected.length > 0 });
    }
  }

  function readContextPath(context, path) {
    let current = context;
    for (const segment of path.split('.')) {
      if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) return { found: false, value: null };
      current = current[segment];
    }
    return { found: true, value: current };
  }

  function createContextFingerprint(context = {}, dependencies = []) {
    domainAssert(isPlainObject(context), 'INVALID_STAT_CONTEXT', 'stat-cache', 'Context must be a plain object.');
    domainAssert(Array.isArray(dependencies), 'INVALID_CONTEXT_DEPENDENCIES', 'stat-cache', 'Dependencies must be an array.');
    const normalizedDependencies = [...new Set(dependencies.map((value, index) => requireString(value, `dependencies[${index}]`)))].sort(compareText);
    const values = {};
    for (const dependency of normalizedDependencies) {
      domainAssert(dependency.split('.').every(Boolean), 'INVALID_CONTEXT_PATH', 'stat-cache', 'Context path cannot contain empty segments.', { dependency });
      const resolved = readContextPath(context, dependency);
      values[dependency] = resolved.found ? deepClone(resolved.value) : { $missing: true };
    }
    const canonical = { dependencies: normalizedDependencies, values };
    return deepFreeze({ ...canonical, hash: hashHex(canonical) });
  }

  class ContextualStatCache {
    constructor({ maxEntries = 128 } = {}) {
      this.maxEntries = requireInteger(maxEntries, 'maxEntries', 1);
      this.entries = new Map();
      this.hits = 0;
      this.misses = 0;
      this.evictions = 0;
    }
    evaluate({ entityId, statId, ownerVersion, dependencies = [], context = {}, compute }) {
      requireId(entityId, 'entityId');
      requireId(statId, 'statId');
      requireInteger(ownerVersion, 'ownerVersion', 0);
      domainAssert(typeof compute === 'function', 'INVALID_STAT_COMPUTE', 'stat-cache', 'compute must be a function.');
      const fingerprint = createContextFingerprint(context, dependencies);
      const descriptor = { entityId, statId, ownerVersion, contextFingerprint: fingerprint.hash };
      const cacheKey = hashHex(descriptor);
      if (this.entries.has(cacheKey)) {
        const entry = this.entries.get(cacheKey);
        this.entries.delete(cacheKey);
        this.entries.set(cacheKey, entry);
        this.hits += 1;
        return deepFreeze({ cacheHit: true, cacheKey, fingerprint, value: deepClone(entry.value) });
      }
      const value = compute();
      domainAssert(value !== undefined, 'INVALID_STAT_RESULT', 'stat-cache', 'Computed value cannot be undefined.');
      canonicalStringify(value);
      this.entries.set(cacheKey, deepFreeze({ ...descriptor, value: deepClone(value) }));
      this.misses += 1;
      while (this.entries.size > this.maxEntries) {
        const oldest = this.entries.keys().next().value;
        this.entries.delete(oldest);
        this.evictions += 1;
      }
      return deepFreeze({ cacheHit: false, cacheKey, fingerprint, value: deepClone(value) });
    }
    invalidateEntity(entityId) {
      requireId(entityId, 'entityId');
      let removed = 0;
      for (const [key, entry] of this.entries) {
        if (entry.entityId !== entityId) continue;
        this.entries.delete(key);
        removed += 1;
      }
      return removed;
    }
    clear() {
      const removed = this.entries.size;
      this.entries.clear();
      return removed;
    }
    stats() {
      return deepFreeze({ size: this.entries.size, maxEntries: this.maxEntries, hits: this.hits, misses: this.misses, evictions: this.evictions });
    }
  }

  class SchemaMigrationRegistry {
    constructor({ currentVersion, minimumSupportedVersion = Math.max(1, currentVersion - 2) }) {
      this.currentVersion = requireInteger(currentVersion, 'currentVersion', 1);
      this.minimumSupportedVersion = requireInteger(minimumSupportedVersion, 'minimumSupportedVersion', 1, this.currentVersion);
      this.steps = new Map();
    }
    register({ migrationId, fromVersion, toVersion, migrate }) {
      requireId(migrationId, 'migrationId');
      requireInteger(fromVersion, 'fromVersion', 1);
      requireInteger(toVersion, 'toVersion', 2);
      domainAssert(toVersion === fromVersion + 1, 'NON_SEQUENTIAL_MIGRATION', 'migration', 'Migration must advance exactly one schema version.');
      domainAssert(typeof migrate === 'function', 'INVALID_MIGRATOR', 'migration', 'Migration requires a function.');
      const key = `${fromVersion}->${toVersion}`;
      domainAssert(!this.steps.has(key), 'DUPLICATE_MIGRATION', 'migration', 'Migration edge already exists.', { key });
      this.steps.set(key, { migrationId, fromVersion, toVersion, migrate });
      return this;
    }
    migrate(document, targetVersion = this.currentVersion) {
      domainAssert(isPlainObject(document), 'INVALID_VERSIONED_DOCUMENT', 'migration', 'Versioned document must be a plain object.');
      const sourceVersion = requireInteger(document.schemaVersion, 'document.schemaVersion', 1);
      requireInteger(targetVersion, 'targetVersion', 1, this.currentVersion);
      domainAssert(sourceVersion >= this.minimumSupportedVersion, 'SCHEMA_VERSION_UNSUPPORTED', 'migration', 'Document is older than the supported compatibility window.', { sourceVersion, minimumSupportedVersion: this.minimumSupportedVersion });
      domainAssert(sourceVersion <= targetVersion, 'SCHEMA_DOWNGRADE_UNSUPPORTED', 'migration', 'Downgrades are not supported.', { sourceVersion, targetVersion });
      let current = deepClone(document);
      const appliedMigrations = [];
      for (let version = sourceVersion; version < targetVersion; version += 1) {
        const key = `${version}->${version + 1}`;
        const step = this.steps.get(key);
        domainAssert(Boolean(step), 'MIGRATION_STEP_MISSING', 'migration', 'Required migration edge is missing.', { key, sourceVersion, targetVersion });
        const before = deepFreeze(deepClone(current));
        const migrated = step.migrate(before);
        domainAssert(isPlainObject(migrated), 'INVALID_MIGRATION_OUTPUT', 'migration', 'Migration output must be a plain object.', { migrationId: step.migrationId });
        domainAssert(migrated.schemaVersion === step.toVersion, 'MIGRATION_VERSION_MISMATCH', 'migration', 'Migration output version does not match its edge.', { migrationId: step.migrationId, expected: step.toVersion, actual: migrated.schemaVersion });
        canonicalStringify(migrated);
        current = deepClone(migrated);
        appliedMigrations.push({ migrationId: step.migrationId, fromVersion: step.fromVersion, toVersion: step.toVersion, beforeHash: hashHex(before), afterHash: hashHex(current) });
      }
      return deepFreeze({ sourceVersion, targetVersion, document: current, appliedMigrations });
    }
  }

  function cloneState(state) {
    return deepClone(state);
  }

  function validateEntity(entity) {
    for (const [resource, value] of Object.entries(entity.resources)) {
      requireInteger(value, `${entity.id}.${resource}`, 0);
    }
    domainAssert(entity.resources.hp <= entity.resources.maxHp, 'RESOURCE_OVERFLOW', 'commit', 'HP exceeds maxHp.', { entityId: entity.id });
    domainAssert(entity.resources.mana <= entity.resources.maxMana, 'RESOURCE_OVERFLOW', 'commit', 'Mana exceeds maxMana.', { entityId: entity.id });
    domainAssert(entity.resources.shield <= entity.resources.maxShield, 'RESOURCE_OVERFLOW', 'commit', 'Shield exceeds maxShield.', { entityId: entity.id });
  }

  class StateStore {
    constructor(initialState) {
      this.state = cloneState(initialState);
      this.tick = initialState.tick;
      this.processedCommands = new Set(initialState.processedCommands ?? []);
      this.outbox = (initialState.outbox ?? []).map(deepClone);
    }
    getEntity(entityId) {
      requireId(entityId, 'entityId');
      const entity = this.state.entities[entityId];
      domainAssert(Boolean(entity), 'ENTITY_NOT_FOUND', 'store', 'Entity does not exist.', { entityId });
      return deepFreeze(deepClone(entity));
    }
    snapshot(entityIds) {
      const entities = {};
      for (const id of [...new Set(entityIds)].sort(compareText)) entities[id] = deepClone(this.getEntity(id));
      return deepFreeze({ tick: this.tick, entities });
    }
    exportState() {
      const output = cloneState(this.state);
      output.tick = this.tick;
      delete output.processedCommands;
      delete output.outbox;
      return deepFreeze(output);
    }
    commit(command, plan, trace = null) {
      domainAssert(command.commandId === plan.commandId, 'COMMAND_PLAN_MISMATCH', 'commit', 'Plan does not belong to command.');
      domainAssert(!this.processedCommands.has(command.commandId), 'DUPLICATE_COMMAND', 'commit', 'Command has already been committed.', { commandId: command.commandId });
      for (const precondition of plan.preconditions ?? []) {
        const entity = this.state.entities[precondition.entityId];
        domainAssert(Boolean(entity), 'ENTITY_NOT_FOUND', 'commit', 'Precondition entity is missing.', precondition);
        domainAssert(entity.version === precondition.expectedVersion, 'VERSION_CONFLICT', 'commit', 'Entity version changed after resolve.', { entityId: entity.id, expectedVersion: precondition.expectedVersion, actualVersion: entity.version }, true);
      }
      trace?.record('commit_preconditions_checked', plan.commitTick, { commandId: command.commandId, preconditions: plan.preconditions });
      const working = cloneState(this.state);
      const touched = new Set();
      const operations = [...(plan.operations ?? [])].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || compareText(left.key ?? '', right.key ?? ''));
      for (const operation of operations) {
        const entity = working.entities[operation.entityId];
        domainAssert(Boolean(entity), 'ENTITY_NOT_FOUND', 'commit', 'Operation entity is missing.', operation);
        touched.add(entity.id);
        if (operation.kind === 'resource.delta') {
          domainAssert(Object.prototype.hasOwnProperty.call(entity.resources, operation.resource), 'RESOURCE_NOT_FOUND', 'commit', 'Resource does not exist.', operation);
          entity.resources[operation.resource] += requireInteger(operation.delta, 'operation.delta');
        } else if (operation.kind === 'cooldown.set') {
          entity.cooldowns[requireId(operation.definitionId, 'operation.definitionId')] = requireInteger(operation.readyTick, 'operation.readyTick', 0);
        } else if (operation.kind === 'status.add') {
          const status = deepClone(operation.status);
          entity.statuses[requireId(status.instanceId, 'status.instanceId')] = status;
        } else if (operation.kind === 'status.patch') {
          const status = entity.statuses[requireId(operation.instanceId, 'operation.instanceId')];
          domainAssert(Boolean(status), 'STATUS_NOT_FOUND', 'commit', 'Status does not exist.', operation);
          Object.assign(status, deepClone(operation.patch));
        } else if (operation.kind === 'status.remove') {
          delete entity.statuses[requireId(operation.instanceId, 'operation.instanceId')];
        } else {
          throw new DomainError('UNSUPPORTED_OPERATION', 'commit', 'Unsupported mutation operation.', { kind: operation.kind });
        }
      }
      for (const entityId of touched) {
        validateEntity(working.entities[entityId]);
        working.entities[entityId].version += 1;
      }
      const events = (plan.eventBlueprints ?? []).map((blueprint, index) => createDomainEventEnvelope({
        eventId: `event.${hashHex([command.commandId, blueprint.type, index, plan.commitTick])}`,
        type: blueprint.type,
        correlationId: command.correlationId,
        causationId: command.commandId,
        occurredTick: plan.commitTick,
        payload: blueprint.payload,
      }));
      this.state = working;
      this.tick = Math.max(this.tick, plan.commitTick);
      this.processedCommands.add(command.commandId);
      this.outbox.push(...events.map(deepClone));
      trace?.record('commit_published', plan.commitTick, { commandId: command.commandId, operationCount: operations.length, touched: [...touched].sort(compareText), eventCount: events.length });
      return deepFreeze({ planId: plan.planId, state: this.exportState(), events });
    }
  }

  function defaultScenarioInput() {
    return {
      rootSeed: 61_710,
      tick: 18_240,
      dataVersion: 'data.2026.07',
      definitionVersion: 'definitions.fireball.v3',
      formulaVersion: 'combat.fire.v3',
      caster: { id: 'entity.caster', hp: 600, maxHp: 600, mana: 100, maxMana: 100, spellPower: 120 },
      target: { id: 'entity.target', hp: 500, maxHp: 500, shield: 40, maxShield: 200, fireResistanceBps: 2_000 },
      skill: { definitionId: 'skill.fireball', baseDamage: 24, coefficientBps: 12_000, hitChanceBps: 9_200, critChanceBps: 2_800, critMultiplierBps: 15_000, manaCost: 20, cooldownTicks: 60 },
      burn: { definitionId: 'status.burn', ratioBps: 1_200, durationTicks: 6, intervalTicks: 2, maxCatchUpTicks: 8 },
      simulateStatusTicks: true,
    };
  }

  function mergeNested(base, patch) {
    const output = deepClone(base);
    for (const [key, value] of Object.entries(patch ?? {})) {
      if (isPlainObject(value) && isPlainObject(output[key])) output[key] = mergeNested(output[key], value);
      else output[key] = deepClone(value);
    }
    return output;
  }

  function normalizeScenarioInput(rawInput = {}) {
    const input = mergeNested(defaultScenarioInput(), rawInput);
    requireInteger(input.rootSeed, 'rootSeed', 0, 0xffffffff);
    requireInteger(input.tick, 'tick', 0);
    requireId(input.caster.id, 'caster.id');
    requireId(input.target.id, 'target.id');
    requireId(input.skill.definitionId, 'skill.definitionId');
    requireId(input.burn.definitionId, 'burn.definitionId');
    for (const value of ['hp', 'maxHp', 'mana', 'maxMana', 'spellPower']) requireInteger(input.caster[value], `caster.${value}`, 0);
    for (const value of ['hp', 'maxHp', 'shield', 'maxShield', 'fireResistanceBps']) requireInteger(input.target[value], `target.${value}`, 0, value === 'fireResistanceBps' ? BASIS_POINTS : Number.MAX_SAFE_INTEGER);
    for (const value of ['baseDamage', 'manaCost', 'cooldownTicks']) requireInteger(input.skill[value], `skill.${value}`, 0);
    for (const value of ['coefficientBps', 'critMultiplierBps']) requireInteger(input.skill[value], `skill.${value}`, 0, 100_000);
    for (const value of ['hitChanceBps', 'critChanceBps']) requireInteger(input.skill[value], `skill.${value}`, 0, BASIS_POINTS);
    for (const value of ['ratioBps', 'durationTicks', 'intervalTicks', 'maxCatchUpTicks']) requireInteger(input.burn[value], `burn.${value}`, value === 'intervalTicks' || value === 'maxCatchUpTicks' ? 1 : 0, value === 'ratioBps' ? 100_000 : Number.MAX_SAFE_INTEGER);
    domainAssert(input.caster.hp <= input.caster.maxHp && input.caster.mana <= input.caster.maxMana, 'INVALID_INITIAL_RESOURCE', 'input', 'Caster resources exceed maxima.');
    domainAssert(input.target.hp <= input.target.maxHp && input.target.shield <= input.target.maxShield, 'INVALID_INITIAL_RESOURCE', 'input', 'Target resources exceed maxima.');
    return deepFreeze(input);
  }

  function createInitialState(input) {
    return deepFreeze({
      tick: input.tick,
      entities: {
        [input.caster.id]: { id: input.caster.id, version: 1, resources: { hp: input.caster.hp, maxHp: input.caster.maxHp, mana: input.caster.mana, maxMana: input.caster.maxMana, shield: 0, maxShield: 0 }, stats: { spellPower: input.caster.spellPower, fireResistanceBps: 0 }, cooldowns: {}, statuses: {} },
        [input.target.id]: { id: input.target.id, version: 1, resources: { hp: input.target.hp, maxHp: input.target.maxHp, mana: 0, maxMana: 0, shield: input.target.shield, maxShield: input.target.maxShield }, stats: { spellPower: 0, fireResistanceBps: input.target.fireResistanceBps }, cooldowns: {}, statuses: {} },
      },
      processedCommands: [],
      outbox: [],
    });
  }

  function createReplayHeader(input) {
    return deepFreeze({ runtimeVersion: RUNTIME_VERSION, contractSchemaVersion: CONTRACT_SCHEMA_VERSION, replayFormatVersion: REPLAY_FORMAT_VERSION, rngAlgorithmVersion: RNG_ALGORITHM_VERSION, numericPolicyVersion: NUMERIC_POLICY_VERSION, dataVersion: input.dataVersion, definitionVersion: input.definitionVersion, formulaVersion: input.formulaVersion, rootSeed: input.rootSeed });
  }

  function createFireballCommand(input) {
    return createCommandEnvelope({
      commandId: 'command.fireball.cast.0001',
      actorId: input.caster.id,
      requestedTick: input.tick,
      correlationId: 'correlation.fireball.cast.0001',
      dataVersion: input.dataVersion,
      payload: { targetId: input.target.id, skillDefinitionId: input.skill.definitionId },
    });
  }

  function resolveDamageAgainstTarget({ actorId, sourceId, sourceRef, target, damageType, rawDamage }) {
    requireId(actorId, 'damage.actorId');
    requireId(sourceId, 'damage.sourceId');
    const normalizedSourceRef = createSourceRef(sourceRef);
    domainAssert(isPlainObject(target), 'INVALID_DAMAGE_TARGET', 'resolve', 'Damage target must be a runtime entity snapshot.');
    requireId(target.id, 'damage.targetId');
    requireString(damageType, 'damage.damageType');
    requireInteger(rawDamage, 'damage.rawDamage', 0);
    const resistanceStat = `${damageType}ResistanceBps`;
    const resistanceBps = requireInteger(target.stats?.[resistanceStat] ?? 0, `damage.${resistanceStat}`, 0, BASIS_POINTS);
    const resolvedDamage = multiplyBps(rawDamage, BASIS_POINTS - resistanceBps);
    const shieldAbsorbed = Math.min(target.resources.shield, resolvedDamage);
    const remaining = Math.max(0, resolvedDamage - shieldAbsorbed);
    const hpDamage = Math.min(target.resources.hp, remaining);
    return deepFreeze({
      actorId,
      sourceId,
      sourceRef: normalizedSourceRef,
      targetId: target.id,
      damageType,
      rawDamage,
      resistanceBps,
      resolvedDamage,
      shieldAbsorbed,
      hpDamage,
      overkill: Math.max(0, remaining - hpDamage),
      targetHpAfter: target.resources.hp - hpDamage,
    });
  }

  function createDefeatPayload(outcome, details = {}) {
    return {
      entityId: outcome.targetId,
      targetId: outcome.targetId,
      actorId: outcome.actorId,
      sourceId: outcome.sourceId,
      sourceRef: deepClone(outcome.sourceRef),
      damageType: outcome.damageType,
      ...deepClone(details),
    };
  }

  function resolveFireball({ snapshot, command, input, rng, trace = null }) {
    const caster = snapshot.entities[input.caster.id];
    const target = snapshot.entities[input.target.id];
    domainAssert(Boolean(caster && target), 'INVALID_SNAPSHOT', 'resolve', 'Caster and target must be present.');
    domainAssert(target.resources.hp > 0, 'TARGET_NOT_ALIVE', 'resolve', 'Target must be alive before skill resolution.', { targetId: target.id });
    domainAssert(caster.resources.mana >= input.skill.manaCost, 'INSUFFICIENT_MANA', 'resolve', 'Caster lacks mana.');
    const hitKey = [command.correlationId, 'fireball.hit', target.id];
    const critKey = [command.correlationId, 'fireball.critical', target.id];
    const hitRollBps = rng.sampleBps(hitKey);
    const critRollBps = rng.sampleBps(critKey);
    const hit = hitRollBps < input.skill.hitChanceBps;
    const critical = hit && critRollBps < input.skill.critChanceBps;
    let rawDamage = hit ? input.skill.baseDamage + multiplyBps(caster.stats.spellPower, input.skill.coefficientBps) : 0;
    if (critical) rawDamage = multiplyBps(rawDamage, input.skill.critMultiplierBps);
    const sourceRef = createSourceRef({ kind: 'skill-execution', definitionId: input.skill.definitionId, instanceId: command.commandId });
    const damage = resolveDamageAgainstTarget({ actorId: caster.id, sourceId: command.commandId, sourceRef, target, damageType: 'fire', rawDamage });
    const burnRawTickDamage = hit && rawDamage > 0 && input.burn.ratioBps > 0 ? Math.max(1, multiplyBps(rawDamage, input.burn.ratioBps)) : 0;
    const outcome = deepFreeze({
      ...deepClone(damage),
      skillDefinitionId: input.skill.definitionId,
      hit,
      critical,
      burn: { definitionId: input.burn.definitionId, rawTickDamage: burnRawTickDamage, durationTicks: input.burn.durationTicks, intervalTicks: input.burn.intervalTicks, applyWhenTargetAlive: hit && damage.targetHpAfter > 0 },
    });
    const operations = [
      { order: 10, kind: 'resource.delta', entityId: caster.id, resource: 'mana', delta: -input.skill.manaCost, key: 'cost' },
      { order: 20, kind: 'cooldown.set', entityId: caster.id, definitionId: input.skill.definitionId, readyTick: input.tick + input.skill.cooldownTicks, key: 'cooldown' },
    ];
    if (damage.shieldAbsorbed) operations.push({ order: 30, kind: 'resource.delta', entityId: target.id, resource: 'shield', delta: -damage.shieldAbsorbed, key: 'shield' });
    if (damage.hpDamage) operations.push({ order: 40, kind: 'resource.delta', entityId: target.id, resource: 'hp', delta: -damage.hpDamage, key: 'hp' });
    const eventBlueprints = [
      { type: 'SkillCommitted', payload: { actorId: caster.id, sourceId: command.commandId, sourceRef: deepClone(sourceRef), targetId: target.id, skillDefinitionId: input.skill.definitionId, cooldownReadyTick: input.tick + input.skill.cooldownTicks } },
      { type: hit ? 'DamageCommitted' : 'DamageMissed', payload: { ...deepClone(outcome) } },
    ];
    if (target.resources.hp > 0 && damage.targetHpAfter === 0) eventBlueprints.push({ type: 'EntityDefeated', payload: createDefeatPayload(outcome, { periodic: false }) });
    const planBase = { schemaVersion: CONTRACT_SCHEMA_VERSION, commandId: command.commandId, commitTick: input.tick, preconditions: [{ entityId: caster.id, expectedVersion: caster.version }, { entityId: target.id, expectedVersion: target.version }], operations, eventBlueprints };
    const plan = deepFreeze({ ...planBase, planId: `plan.${hashHex(planBase)}` });
    trace?.record('random_decisions', input.tick, { hitRollBps, critRollBps, hit, critical, hitKey, critKey });
    trace?.record('resolution_completed', input.tick, { outcome, operationCount: operations.length, planId: plan.planId });
    return deepFreeze({ decisions: { hitRollBps, critRollBps, hitKey, critKey }, outcome, plan });
  }

  function executeImpact(input, trace = null) {
    const store = new StateStore(createInitialState(input));
    const command = createFireballCommand(input);
    trace?.record('command_received', input.tick, { commandId: command.commandId, actorId: command.actorId, targetId: input.target.id });
    const snapshot = store.snapshot([input.caster.id, input.target.id]);
    trace?.record('snapshot_frozen', input.tick, { snapshotHash: hashHex(snapshot), entityVersions: Object.fromEntries(Object.entries(snapshot.entities).map(([id, entity]) => [id, entity.version])) });
    const resolution = resolveFireball({ snapshot, command, input, rng: new KeyedRandom(input.rootSeed), trace });
    const commit = store.commit(command, resolution.plan, trace);
    return { store, command, resolution, commit };
  }

  function enqueueReactions(events, input, queue, trace = null) {
    for (const event of events) {
      if (event.type !== 'DamageCommitted') continue;
      const burn = event.payload.burn;
      if (!burn?.applyWhenTargetAlive) continue;
      const reactionId = `reaction.${hashHex([event.eventId, 'apply-burn'])}`;
      queue.enqueue({ reactionId, idempotencyKey: `idempotency.${hashHex([event.eventId, input.burn.definitionId])}`, kind: 'apply-status', priority: 100, stableOrderKey: `${event.payload.targetId}:${input.burn.definitionId}`, depth: 1, budgetCost: 1, payload: { actorId: event.payload.actorId, sourceId: event.payload.sourceId, sourceRef: deepClone(event.payload.sourceRef), targetId: event.payload.targetId, definitionId: input.burn.definitionId, rawTickDamage: burn.rawTickDamage, durationTicks: burn.durationTicks, intervalTicks: burn.intervalTicks, maxCatchUpTicks: input.burn.maxCatchUpTicks, correlationId: event.correlationId, causationId: event.eventId, dataVersion: input.dataVersion } });
      trace?.record('reaction_enqueued', event.occurredTick, { reactionId, kind: 'apply-status' });
    }
  }

  function applyStatusReaction(store, reaction, trace = null) {
    domainAssert(reaction.kind === 'apply-status', 'UNSUPPORTED_REACTION', 'reaction', 'Reference handler only supports apply-status.');
    const payload = reaction.payload;
    const target = store.getEntity(payload.targetId);
    const appliedTick = store.tick;
    const instanceId = `status-instance.${hashHex([reaction.reactionId, payload.targetId, appliedTick])}`;
    const status = { instanceId, definitionId: payload.definitionId, actorId: payload.actorId, sourceId: payload.sourceId, sourceRef: createSourceRef(payload.sourceRef), targetId: payload.targetId, correlationId: payload.correlationId, causationId: payload.causationId, dataVersion: payload.dataVersion, appliedTick, nextTickAt: appliedTick + payload.intervalTicks, expireTick: appliedTick + payload.durationTicks, intervalTicks: payload.intervalTicks, rawTickDamage: payload.rawTickDamage, maxCatchUpTicks: payload.maxCatchUpTicks };
    const command = createCommandEnvelope({ commandId: `command.${hashHex([reaction.reactionId, 'status-apply'])}`, actorId: payload.actorId, requestedTick: appliedTick, correlationId: payload.correlationId, causationId: payload.causationId, dataVersion: payload.dataVersion, payload: { targetId: payload.targetId, status } });
    const planBase = { schemaVersion: CONTRACT_SCHEMA_VERSION, commandId: command.commandId, commitTick: appliedTick, preconditions: [{ entityId: target.id, expectedVersion: target.version }], operations: [{ order: 10, kind: 'status.add', entityId: target.id, status, key: instanceId }], eventBlueprints: [{ type: 'StatusApplied', payload: { targetId: target.id, status } }] };
    return store.commit(command, { ...planBase, planId: `plan.${hashHex(planBase)}` }, trace);
  }

  function listStatuses(store) {
    const state = store.exportState();
    const statuses = [];
    for (const entity of Object.values(state.entities)) {
      for (const status of Object.values(entity.statuses)) statuses.push({ entityId: entity.id, status });
    }
    return statuses.sort((left, right) => left.status.nextTickAt - right.status.nextTickAt || compareText(left.entityId, right.entityId) || compareText(left.status.instanceId, right.status.instanceId));
  }

  function createStatusExpiredPayload(status, endedTick, reason, details = {}) {
    return {
      actorId: status.actorId,
      sourceId: status.sourceId,
      sourceRef: deepClone(status.sourceRef),
      targetId: status.targetId,
      statusInstanceId: status.instanceId,
      definitionId: status.definitionId,
      expireTick: status.expireTick,
      scheduledExpireTick: status.expireTick,
      endedTick,
      reason,
      ...deepClone(details),
    };
  }

  function collectStatusActions(store, targetTick, perStatusCount) {
    const actions = [];
    let catchUpLimited = false;
    for (const item of listStatuses(store)) {
      const status = item.status;
      const entity = store.getEntity(item.entityId);
      if (entity.resources.hp <= 0) {
        actions.push({ kind: 'expire', priority: 0, actionTick: store.tick, entityId: item.entityId, status, reason: 'target-defeated', catchUpLimited: false });
        continue;
      }
      const count = perStatusCount.get(status.instanceId) ?? 0;
      const tickDue = status.nextTickAt <= targetTick && status.nextTickAt <= status.expireTick;
      if (tickDue && count < status.maxCatchUpTicks) {
        actions.push({ kind: 'tick', priority: 1, actionTick: status.nextTickAt, entityId: item.entityId, status });
        continue;
      }
      if (tickDue && count >= status.maxCatchUpTicks) catchUpLimited = true;
      if (status.expireTick <= targetTick) {
        const limited = tickDue && count >= status.maxCatchUpTicks;
        actions.push({ kind: 'expire', priority: 2, actionTick: status.expireTick, entityId: item.entityId, status, reason: limited ? 'catch-up-limited' : 'duration-expired', catchUpLimited: limited });
      }
    }
    actions.sort((left, right) => left.actionTick - right.actionTick || left.priority - right.priority || compareText(left.entityId, right.entityId) || compareText(left.status.instanceId, right.status.instanceId));
    return { actions, catchUpLimited };
  }

  function advanceStatuses(store, targetTick, trace = null) {
    requireInteger(targetTick, 'targetTick', store.tick);
    const commits = [];
    const perStatusCount = new Map();
    let catchUpLimited = false;
    let guard = 0;
    while (guard < 10_000) {
      const schedule = collectStatusActions(store, targetTick, perStatusCount);
      catchUpLimited ||= schedule.catchUpLimited;
      const candidate = schedule.actions[0];
      if (!candidate) break;
      guard += 1;
      const status = candidate.status;
      const entity = store.getEntity(candidate.entityId);
      const commitTick = Math.max(candidate.actionTick, store.tick);
      if (candidate.kind === 'expire') {
        const command = createCommandEnvelope({ commandId: `command.${hashHex([status.instanceId, 'expire', status.expireTick, candidate.reason])}`, actorId: status.actorId, requestedTick: commitTick, correlationId: status.correlationId, causationId: status.causationId, dataVersion: status.dataVersion, payload: { targetId: entity.id, statusInstanceId: status.instanceId, sourceId: status.sourceId, sourceRef: status.sourceRef, reason: candidate.reason } });
        const expiration = createStatusExpiredPayload(status, commitTick, candidate.reason, candidate.catchUpLimited ? { catchUpLimited: true } : {});
        const planBase = { schemaVersion: CONTRACT_SCHEMA_VERSION, commandId: command.commandId, commitTick, preconditions: [{ entityId: entity.id, expectedVersion: entity.version }], operations: [{ order: 10, kind: 'status.remove', entityId: entity.id, instanceId: status.instanceId, key: 'expire' }], eventBlueprints: [{ type: 'StatusExpired', payload: expiration }] };
        commits.push(store.commit(command, { ...planBase, planId: `plan.${hashHex(planBase)}` }, trace));
        continue;
      }
      const count = perStatusCount.get(status.instanceId) ?? 0;
      const damage = resolveDamageAgainstTarget({ actorId: status.actorId, sourceId: status.sourceId, sourceRef: status.sourceRef, target: entity, damageType: 'fire', rawDamage: status.rawTickDamage });
      const defeated = entity.resources.hp > 0 && damage.targetHpAfter === 0;
      const shouldExpire = status.nextTickAt >= status.expireTick || defeated;
      const command = createCommandEnvelope({ commandId: `command.${hashHex([status.instanceId, 'tick', status.nextTickAt])}`, actorId: status.actorId, requestedTick: commitTick, correlationId: status.correlationId, causationId: status.causationId, dataVersion: status.dataVersion, payload: { targetId: entity.id, statusInstanceId: status.instanceId, sourceId: status.sourceId, sourceRef: status.sourceRef } });
      const operations = [];
      if (damage.shieldAbsorbed) operations.push({ order: 10, kind: 'resource.delta', entityId: entity.id, resource: 'shield', delta: -damage.shieldAbsorbed, key: 'tick-shield' });
      if (damage.hpDamage) operations.push({ order: 20, kind: 'resource.delta', entityId: entity.id, resource: 'hp', delta: -damage.hpDamage, key: 'tick-hp' });
      operations.push(shouldExpire
        ? { order: 30, kind: 'status.remove', entityId: entity.id, instanceId: status.instanceId, key: 'expire' }
        : { order: 30, kind: 'status.patch', entityId: entity.id, instanceId: status.instanceId, patch: { nextTickAt: status.nextTickAt + status.intervalTicks }, key: 'schedule-next' });
      const tickDamageOutcome = { ...deepClone(damage), statusInstanceId: status.instanceId, statusDefinitionId: status.definitionId, periodic: true, tickAt: status.nextTickAt };
      const events = [
        { type: 'DamageCommitted', payload: tickDamageOutcome },
        { type: 'StatusTicked', payload: { actorId: status.actorId, sourceId: status.sourceId, sourceRef: deepClone(status.sourceRef), targetId: entity.id, statusInstanceId: status.instanceId, definitionId: status.definitionId, rawDamage: damage.rawDamage, resolvedDamage: damage.resolvedDamage, shieldAbsorbed: damage.shieldAbsorbed, hpDamage: damage.hpDamage, tickAt: status.nextTickAt } },
      ];
      if (defeated) events.push({ type: 'EntityDefeated', payload: createDefeatPayload(damage, { periodic: true, statusInstanceId: status.instanceId, statusDefinitionId: status.definitionId }) });
      if (shouldExpire) events.push({ type: 'StatusExpired', payload: createStatusExpiredPayload(status, commitTick, defeated ? 'target-defeated' : 'duration-expired') });
      const planBase = { schemaVersion: CONTRACT_SCHEMA_VERSION, commandId: command.commandId, commitTick, preconditions: [{ entityId: entity.id, expectedVersion: entity.version }], operations, eventBlueprints: events };
      commits.push(store.commit(command, { ...planBase, planId: `plan.${hashHex(planBase)}` }, trace));
      perStatusCount.set(status.instanceId, count + 1);
    }
    store.tick = Math.max(store.tick, targetTick);
    const tickCount = [...perStatusCount.values()].reduce((sum, value) => sum + value, 0);
    return deepFreeze({ targetTick, commits, tickCount, catchUpLimited: catchUpLimited || guard >= 10_000 });
  }

  function runFireballScenario(rawInput = {}) {
    const input = normalizeScenarioInput(rawInput);
    const header = createReplayHeader(input);
    const trace = new TraceRecorder(header);
    trace.record('replay_started', input.tick, { runtimeVersion: RUNTIME_VERSION, rootSeed: input.rootSeed });
    const impact = executeImpact(input, trace);
    const queue = new ReactionQueue({ maxDepth: 8, maxReactions: 32, maxBudget: 64 });
    enqueueReactions(impact.commit.events, input, queue, trace);
    const reactions = queue.drain(reaction => applyStatusReaction(impact.store, reaction, trace), trace, input.tick);
    const statusAdvance = input.simulateStatusTicks
      ? advanceStatuses(impact.store, input.tick + input.burn.durationTicks, trace)
      : deepFreeze({ targetTick: input.tick, commits: [], tickCount: 0, catchUpLimited: false });
    trace.record('replay_completed', impact.store.tick, { finalStateHash: hashHex(impact.store.exportState()), outboxCount: impact.store.outbox.length });
    const finalState = impact.store.exportState();
    const traceRecords = trace.export();
    const traceHash = trace.hash();
    const replayBody = { header, input, resolution: impact.resolution, finalState, outbox: impact.store.outbox, traceHash };
    const replayHash = hashHex(replayBody);
    const target = finalState.entities[input.target.id];
    const allResources = Object.values(finalState.entities).every(entity => entity.resources.hp >= 0 && entity.resources.mana >= 0 && entity.resources.shield >= 0);
    const damageGaps = impact.store.outbox
      .filter(event => event.type === 'DamageCommitted')
      .map(event => event.payload.resolvedDamage - event.payload.shieldAbsorbed - event.payload.hpDamage - event.payload.overkill);
    const conservationGap = damageGaps.reduce((sum, gap) => sum + gap, 0);
    return deepFreeze({
      runtimeVersion: RUNTIME_VERSION,
      header,
      input,
      command: impact.command,
      resolution: impact.resolution,
      commit: impact.commit,
      reactions,
      statusAdvance,
      finalState,
      outbox: deepClone(impact.store.outbox),
      trace: traceRecords,
      traceHash,
      replayHash,
      invariants: {
        nonNegativeResources: allResources,
        damageConservation: damageGaps.every(gap => gap === 0),
        conservationGap,
        statusRemovedAfterExpiry: !input.simulateStatusTicks || Object.keys(target.statuses).length === 0,
      },
    });
  }

  function verifyReplay(rawInput = {}) {
    const first = runFireballScenario(rawInput);
    const second = runFireballScenario(rawInput);
    return deepFreeze({ first, second, match: first.replayHash === second.replayHash, traceMatch: first.traceHash === second.traceHash, finalStateMatch: canonicalStringify(first.finalState) === canonicalStringify(second.finalState) });
  }

  function demonstrateDuplicateCommand(rawInput = {}) {
    const input = normalizeScenarioInput({ ...rawInput, simulateStatusTicks: false });
    const trace = new TraceRecorder(createReplayHeader(input));
    const impact = executeImpact(input, trace);
    const before = impact.store.exportState();
    let error = null;
    try { impact.store.commit(impact.command, impact.resolution.plan, trace); } catch (caught) { error = caught instanceof DomainError ? caught.toJSON() : { message: String(caught) }; }
    const after = impact.store.exportState();
    return deepFreeze({ error, duplicateDetected: error?.code === 'DUPLICATE_COMMAND', stateUnchanged: canonicalStringify(before) === canonicalStringify(after), before, after });
  }

  function demonstrateVersionConflict(rawInput = {}) {
    const input = normalizeScenarioInput({ ...rawInput, simulateStatusTicks: false });
    const store = new StateStore(createInitialState(input));
    const command = createFireballCommand(input);
    const snapshot = store.snapshot([input.caster.id, input.target.id]);
    const resolution = resolveFireball({ snapshot, command, input, rng: new KeyedRandom(input.rootSeed) });
    const target = store.getEntity(input.target.id);
    const external = createCommandEnvelope({ commandId: 'command.external.shield-adjust.0001', actorId: target.id, requestedTick: input.tick, correlationId: 'correlation.external.shield-adjust.0001', dataVersion: input.dataVersion, payload: {} });
    const operations = target.resources.shield > 0 ? [{ order: 10, kind: 'resource.delta', entityId: target.id, resource: 'shield', delta: -1, key: 'external' }] : [];
    const externalBase = { schemaVersion: CONTRACT_SCHEMA_VERSION, commandId: external.commandId, commitTick: input.tick, preconditions: [{ entityId: target.id, expectedVersion: target.version }], operations, eventBlueprints: [{ type: 'ExternalStateChanged', payload: { targetId: target.id } }] };
    store.commit(external, { ...externalBase, planId: `plan.${hashHex(externalBase)}` });
    const before = store.exportState();
    let error = null;
    try { store.commit(command, resolution.plan); } catch (caught) { error = caught instanceof DomainError ? caught.toJSON() : { message: String(caught) }; }
    const after = store.exportState();
    return deepFreeze({ error, rejected: error?.code === 'VERSION_CONFLICT', noPartialMutation: canonicalStringify(before) === canonicalStringify(after), before, after });
  }

  function demonstrateAtomicRollback(rawInput = {}) {
    const input = normalizeScenarioInput({ ...rawInput, simulateStatusTicks: false });
    const store = new StateStore(createInitialState(input));
    const before = store.exportState();
    const caster = store.getEntity(input.caster.id);
    const target = store.getEntity(input.target.id);
    const command = createCommandEnvelope({ commandId: 'command.atomic.rollback.0001', actorId: caster.id, requestedTick: input.tick, correlationId: 'correlation.atomic.rollback.0001', dataVersion: input.dataVersion, payload: {} });
    const base = { schemaVersion: CONTRACT_SCHEMA_VERSION, commandId: command.commandId, commitTick: input.tick, preconditions: [{ entityId: caster.id, expectedVersion: caster.version }, { entityId: target.id, expectedVersion: target.version }], operations: [{ order: 10, kind: 'resource.delta', entityId: caster.id, resource: 'mana', delta: -10, key: 'valid-first' }, { order: 20, kind: 'resource.delta', entityId: target.id, resource: 'hp', delta: target.resources.maxHp + 1, key: 'invalid-second' }], eventBlueprints: [] };
    let error = null;
    try { store.commit(command, { ...base, planId: `plan.${hashHex(base)}` }); } catch (caught) { error = caught instanceof DomainError ? caught.toJSON() : { message: String(caught) }; }
    const after = store.exportState();
    return deepFreeze({ error, rolledBack: canonicalStringify(before) === canonicalStringify(after), before, after });
  }

  return deepFreeze({
    RUNTIME_VERSION, CONTRACT_SCHEMA_VERSION, REPLAY_FORMAT_VERSION, RNG_ALGORITHM_VERSION, NUMERIC_POLICY_VERSION, BASIS_POINTS,
    DomainError, KeyedRandom, TraceRecorder, StateStore, ReactionQueue, ContextualStatCache, SchemaMigrationRegistry,
    canonicalStringify, hashHex, hash32, multiplyBps, createSourceRef, createContextFingerprint, createCommandEnvelope, createDomainEventEnvelope,
    defaultScenarioInput, normalizeScenarioInput, createInitialState, createFireballCommand, resolveDamageAgainstTarget, resolveFireball, enqueueReactions,
    applyStatusReaction, advanceStatuses, executeImpact, runFireballScenario, verifyReplay,
    demonstrateDuplicateCommand, demonstrateVersionConflict, demonstrateAtomicRollback,
  });
});
