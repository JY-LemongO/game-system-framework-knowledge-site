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
  const RNG_KEY_SCHEMA_VERSION = 'correlation-branch-target-v1';
  const CLOCK_DOMAIN = 'simulation_tick';
  const NUMERIC_POLICY_VERSION = 'integer-bps-half-away-from-zero-v1';
  const BASIS_POINTS = 10_000;
  const ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9_-]*)+$/;
  const SOURCE_KINDS = deepFreeze(['skill-execution', 'status', 'system']);
  const HIT_OUTCOMES = deepFreeze(['Hit', 'Miss', 'Blocked', 'Immune', 'Rejected']);
  let traceObserverDepth = 0;

  class DomainError extends Error {
    constructor(code, stage, message, details = {}, retryable = false) {
      super(message);
      this.name = 'DomainError';
      this.code = code;
      this.stage = stage;
      this.details = deepFreeze(normalizeDiagnosticValue(details));
      this.retryable = Boolean(retryable);
    }
    toJSON() {
      return { name: this.name, code: this.code, stage: this.stage, message: this.message, retryable: this.retryable, details: this.details };
    }
  }

  function domainAssert(condition, code, stage, message, details = {}, retryable = false) {
    if (!condition) throw new DomainError(code, stage, message, details, retryable);
  }

  function recordTraceSafely(trace, stage, tick, payload) {
    if (!trace) return false;
    try {
      const snapshot = deepFreeze(deepClone(payload));
      traceObserverDepth += 1;
      try {
        trace.record(stage, tick, snapshot);
      } finally {
        traceObserverDepth -= 1;
      }
      return true;
    } catch {
      return false;
    }
  }

  function validateTraceSink(trace, code, stage, message) {
    if (trace === null) return;
    traceObserverDepth += 1;
    try {
      domainAssert(typeof trace?.record === 'function', code, stage, message);
    } finally {
      traceObserverDepth -= 1;
    }
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function defineDataProperty(target, key, value) {
    Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
    return target;
  }

  function requireJsonContainerShape(value, stage) {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      const elementKeys = keys.filter(key => key !== 'length');
      domainAssert(elementKeys.length === value.length, 'UNSERIALIZABLE_VALUE', stage, 'JSON arrays must be dense and cannot contain extra properties.');
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        domainAssert(Boolean(descriptor) && descriptor.enumerable && Object.prototype.hasOwnProperty.call(descriptor, 'value'), 'UNSERIALIZABLE_VALUE', stage, 'JSON array elements must be enumerable data properties.', { index });
      }
      return;
    }
    domainAssert(isPlainObject(value), 'UNSERIALIZABLE_VALUE', stage, 'Canonical values must be plain JSON objects.');
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      domainAssert(typeof key === 'string' && Boolean(descriptor) && descriptor.enumerable && Object.prototype.hasOwnProperty.call(descriptor, 'value'), 'UNSERIALIZABLE_VALUE', stage, 'JSON objects may contain only enumerable string data properties.');
    }
  }

  function deepClone(value) {
    const ancestors = new WeakSet();
    function clone(item) {
      if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) return item;
      if (Array.isArray(item)) {
        requireJsonContainerShape(item, 'contract');
        domainAssert(!ancestors.has(item), 'CYCLIC_VALUE', 'contract', 'JSON-like values cannot contain cycles.');
        ancestors.add(item);
        const output = item.map(clone);
        ancestors.delete(item);
        return output;
      }
      if (isPlainObject(item)) {
        requireJsonContainerShape(item, 'contract');
        domainAssert(!ancestors.has(item), 'CYCLIC_VALUE', 'contract', 'JSON-like values cannot contain cycles.');
        ancestors.add(item);
        const output = {};
        for (const key of Object.keys(item)) defineDataProperty(output, key, clone(item[key]));
        ancestors.delete(item);
        return output;
      }
      throw new DomainError('UNSERIALIZABLE_VALUE', 'contract', 'Only JSON-like values are supported.', { type: typeof item });
    }
    return clone(value);
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
    return value;
  }

  function canonicalStringify(value) {
    const ancestors = new WeakSet();
    function normalize(item) {
      if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
      if (typeof item === 'number') {
        domainAssert(Number.isFinite(item), 'NON_FINITE_NUMBER', 'canonical', 'Canonical values must contain finite numbers.');
        return Object.is(item, -0) ? 0 : item;
      }
      if (Array.isArray(item)) {
        requireJsonContainerShape(item, 'canonical');
        domainAssert(!ancestors.has(item), 'CYCLIC_VALUE', 'canonical', 'Canonical values cannot contain cycles.');
        ancestors.add(item);
        const output = item.map(normalize);
        ancestors.delete(item);
        return output;
      }
      requireJsonContainerShape(item, 'canonical');
      domainAssert(!ancestors.has(item), 'CYCLIC_VALUE', 'canonical', 'Canonical values cannot contain cycles.');
      ancestors.add(item);
      const output = {};
      for (const key of Object.keys(item).sort(compareText)) defineDataProperty(output, key, normalize(item[key]));
      ancestors.delete(item);
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

  function deriveEventId(commandId, type, index, commitTick) {
    return `event.${hashHex([commandId, type, index, commitTick])}`;
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

  function requireObjectFields(value, { label, required, allowed = required, code, stage }) {
    domainAssert(isPlainObject(value), code, stage, `${label} must be a plain object.`);
    const keys = Object.keys(value);
    const missingFields = required.filter(key => !Object.prototype.hasOwnProperty.call(value, key));
    const unknownFields = keys.filter(key => !allowed.includes(key)).sort(compareText);
    domainAssert(missingFields.length === 0 && unknownFields.length === 0, code, stage, `${label} fields do not match the canonical contract.`, { missingFields, unknownFields });
  }

  function requireCurrentSchemaVersion(value, label, stage) {
    const version = requireInteger(value, label, 1);
    domainAssert(version === CONTRACT_SCHEMA_VERSION, 'SCHEMA_VERSION_UNSUPPORTED', stage, `${label} is not supported by this runtime.`, { expected: CONTRACT_SCHEMA_VERSION, actual: version });
    return version;
  }

  function requireCanonicalJson(value, label) {
    try {
      canonicalStringify(value);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('UNSERIALIZABLE_VALUE', 'contract', `${label} must be finite, acyclic JSON data.`, { label });
    }
    return value;
  }

  function createSourceRef(value) {
    domainAssert(isPlainObject(value), 'INVALID_SOURCE_REF', 'contract', 'sourceRef must be a plain object.');
    const unknownFields = Object.keys(value).filter(key => !['kind', 'definitionId', 'instanceId'].includes(key)).sort(compareText);
    domainAssert(unknownFields.length === 0, 'INVALID_SOURCE_REF', 'contract', 'sourceRef contains unsupported fields.', { unknownFields });
    const kind = requireString(value.kind, 'sourceRef.kind');
    domainAssert(SOURCE_KINDS.includes(kind), 'INVALID_SOURCE_KIND', 'contract', 'sourceRef.kind is not canonical.', { kind });
    const normalized = {
      kind,
      definitionId: requireId(value.definitionId, 'sourceRef.definitionId'),
    };
    if (kind === 'system') {
      if (value.instanceId != null) normalized.instanceId = requireId(value.instanceId, 'sourceRef.instanceId');
    } else {
      normalized.instanceId = requireId(value.instanceId, 'sourceRef.instanceId');
    }
    return deepFreeze(normalized);
  }

  function multiplyBps(value, basisPoints) {
    requireInteger(value, 'value');
    requireInteger(basisPoints, 'basisPoints', -1_000_000, 1_000_000);
    const product = value * basisPoints;
    domainAssert(Number.isSafeInteger(product), 'NUMERIC_OVERFLOW', 'numeric', 'Basis-point multiplication exceeded safe integer range.', { value, basisPoints });
    if (product >= 0) return Math.floor((product + BASIS_POINTS / 2) / BASIS_POINTS);
    const rounded = Math.ceil((product - BASIS_POINTS / 2) / BASIS_POINTS);
    return Object.is(rounded, -0) ? 0 : rounded;
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
    const fields = ['schemaVersion', 'commandId', 'actorId', 'requestedTick', 'correlationId', 'causationId', 'dataVersion', 'payload'];
    requireObjectFields(value, { label: 'command', required: ['commandId', 'actorId', 'requestedTick', 'correlationId'], allowed: fields, code: 'INVALID_COMMAND', stage: 'contract' });
    const payload = value.payload ?? {};
    requireCanonicalJson(payload, 'command.payload');
    const envelope = {
      schemaVersion: value.schemaVersion ?? CONTRACT_SCHEMA_VERSION,
      commandId: requireId(value.commandId, 'commandId'),
      actorId: requireId(value.actorId, 'actorId'),
      requestedTick: requireInteger(value.requestedTick, 'requestedTick', 0),
      correlationId: requireId(value.correlationId, 'correlationId'),
      causationId: value.causationId == null ? null : requireId(value.causationId, 'causationId'),
      dataVersion: requireString(value.dataVersion ?? 'data.reference', 'dataVersion'),
      payload: deepClone(payload),
    };
    requireCurrentSchemaVersion(envelope.schemaVersion, 'schemaVersion', 'contract');
    return deepFreeze(envelope);
  }

  function createDomainEventEnvelope(value) {
    const fields = ['schemaVersion', 'eventId', 'type', 'correlationId', 'causationId', 'occurredTick', 'payload'];
    requireObjectFields(value, { label: 'event', required: ['eventId', 'type', 'correlationId', 'causationId', 'occurredTick'], allowed: fields, code: 'INVALID_DOMAIN_EVENT', stage: 'contract' });
    const payload = value.payload ?? {};
    requireCanonicalJson(payload, 'event.payload');
    const envelope = {
      schemaVersion: value.schemaVersion ?? CONTRACT_SCHEMA_VERSION,
      eventId: requireId(value.eventId, 'eventId'),
      type: requireString(value.type, 'type'),
      correlationId: requireId(value.correlationId, 'correlationId'),
      causationId: requireId(value.causationId, 'causationId'),
      occurredTick: requireInteger(value.occurredTick, 'occurredTick', 0),
      payload: deepClone(payload),
    };
    requireCurrentSchemaVersion(envelope.schemaVersion, 'schemaVersion', 'contract');
    return deepFreeze(envelope);
  }

  class ReactionQueue {
    #maxDepth;
    #maxReactions;
    #maxBudget;
    #pending;
    #pendingBudget;
    #idempotency;
    #isDraining;
    #activeMaxDepth;
    #activeMaxReactions;
    #activeMaxBudget;
    #activeAcceptedCount;
    #activeAcceptedBudget;
    #activeFailure;
    #isRecordingTrace;

    constructor({ maxDepth = 8, maxReactions = 64, maxBudget = 128 } = {}) {
      this.#maxDepth = requireInteger(maxDepth, 'maxDepth', 0);
      this.#maxReactions = requireInteger(maxReactions, 'maxReactions', 1);
      this.#maxBudget = requireInteger(maxBudget, 'maxBudget', 1);
      this.#pending = [];
      this.#pendingBudget = 0;
      this.#idempotency = new Set();
      this.#isDraining = false;
      this.#activeMaxDepth = this.#maxDepth;
      this.#activeMaxReactions = this.#maxReactions;
      this.#activeMaxBudget = this.#maxBudget;
      this.#activeAcceptedCount = 0;
      this.#activeAcceptedBudget = 0;
      this.#activeFailure = null;
      this.#isRecordingTrace = false;
      Object.preventExtensions(this);
    }
    get maxDepth() {
      return this.#maxDepth;
    }
    get maxReactions() {
      return this.#maxReactions;
    }
    get maxBudget() {
      return this.#maxBudget;
    }
    get pending() {
      return deepFreeze(this.#pending.map(deepClone));
    }
    enqueue(raw) {
      domainAssert(traceObserverDepth === 0 && !this.#isRecordingTrace, 'REACTION_TRACE_SIDE_EFFECT', 'reaction', 'A reaction trace observer cannot enqueue domain work.');
      const canonicalRaw = deepFreeze(deepClone(raw));
      const reaction = deepFreeze({
        reactionId: requireId(canonicalRaw.reactionId, 'reactionId'),
        idempotencyKey: requireId(canonicalRaw.idempotencyKey ?? canonicalRaw.reactionId, 'idempotencyKey'),
        kind: requireString(canonicalRaw.kind, 'kind'),
        priority: requireInteger(canonicalRaw.priority ?? 100, 'priority'),
        stableOrderKey: requireString(canonicalRaw.stableOrderKey ?? canonicalRaw.reactionId, 'stableOrderKey'),
        depth: requireInteger(canonicalRaw.depth ?? 0, 'depth', 0),
        budgetCost: requireInteger(canonicalRaw.budgetCost ?? 1, 'budgetCost', 1),
        payload: deepClone(canonicalRaw.payload ?? {}),
      });
      if (this.#idempotency.has(reaction.idempotencyKey)) return false;
      const maxDepth = this.#isDraining ? this.#activeMaxDepth : this.#maxDepth;
      const maxReactions = this.#isDraining ? this.#activeMaxReactions : this.#maxReactions;
      const maxBudget = this.#isDraining ? this.#activeMaxBudget : this.#maxBudget;
      const acceptedCount = this.#isDraining ? this.#activeAcceptedCount : this.#pending.length;
      const acceptedBudget = this.#isDraining ? this.#activeAcceptedBudget : this.#pendingBudget;
      const reason = reaction.depth > maxDepth ? 'MAX_DEPTH'
        : acceptedCount >= maxReactions ? 'MAX_REACTIONS'
          : reaction.budgetCost > maxBudget - acceptedBudget ? 'BUDGET_EXCEEDED' : null;
      if (reason) {
        const error = this.createLimitError(reason, reaction);
        if (this.#isDraining) this.#activeFailure ??= error;
        throw error;
      }
      const nextPendingBudget = this.#pendingBudget + reaction.budgetCost;
      domainAssert(Number.isSafeInteger(nextPendingBudget), 'NUMERIC_OVERFLOW', 'reaction', 'Pending reaction budget exceeded the safe integer range.', { pendingBudget: this.#pendingBudget, budgetCost: reaction.budgetCost });
      this.#idempotency.add(reaction.idempotencyKey);
      this.#pending.push(reaction);
      this.#pendingBudget = nextPendingBudget;
      if (this.#isDraining) {
        this.#activeAcceptedCount += 1;
        this.#activeAcceptedBudget += reaction.budgetCost;
      }
      return true;
    }
    drain(handler, trace = null, tick = 0, budget = null) {
      domainAssert(traceObserverDepth === 0 && !this.#isRecordingTrace, 'REACTION_TRACE_SIDE_EFFECT', 'reaction', 'A reaction trace observer cannot drain domain work.');
      domainAssert(typeof handler === 'function', 'INVALID_REACTION_HANDLER', 'reaction', 'Reaction handler must be a function.');
      this.#validateTrace(trace);
      requireInteger(tick, 'reaction.tick', 0);
      const canonicalBudget = budget === null ? null : deepFreeze(deepClone(budget));
      domainAssert(canonicalBudget === null || isPlainObject(canonicalBudget), 'INVALID_REACTION_BUDGET', 'reaction', 'Reaction drain budget must be a plain object.');
      if (canonicalBudget !== null) requireObjectFields(canonicalBudget, { label: 'reaction budget', required: [], allowed: ['maxDepth', 'maxReactions', 'maxBudget'], code: 'INVALID_REACTION_BUDGET', stage: 'reaction' });
      const requestedMaxDepth = requireInteger(canonicalBudget?.maxDepth ?? this.#maxDepth, 'reaction.maxDepth', 0);
      const requestedMaxReactions = requireInteger(canonicalBudget?.maxReactions ?? this.#maxReactions, 'reaction.maxReactions', 1);
      const requestedMaxBudget = requireInteger(canonicalBudget?.maxBudget ?? this.#maxBudget, 'reaction.maxBudget', 1);
      if (this.#isDraining) {
        const error = new DomainError('REACTION_REENTRANT_DRAIN', 'reaction', 'A reaction causation wave cannot be drained recursively.');
        this.#activeFailure ??= error;
        throw error;
      }
      const executed = [];
      let budgetUsed = 0;
      if (this.#pending.length === 0) return deepFreeze({ executed, rejected: [], budgetUsed, exhausted: false });
      this.#isDraining = true;
      this.#activeMaxDepth = Math.min(this.#maxDepth, requestedMaxDepth);
      this.#activeMaxReactions = Math.min(this.#maxReactions, requestedMaxReactions);
      this.#activeMaxBudget = Math.min(this.#maxBudget, requestedMaxBudget);
      this.#activeAcceptedCount = this.#pending.length;
      this.#activeAcceptedBudget = this.#pendingBudget;
      this.#activeFailure = null;
      let currentReaction = null;
      try {
        const initialFailure = this.validateWaveBounds();
        if (initialFailure) throw initialFailure;
        while (this.#pending.length) {
          this.#pending.sort((left, right) => left.priority - right.priority || compareText(left.stableOrderKey, right.stableOrderKey) || compareText(left.reactionId, right.reactionId));
          currentReaction = this.#pending.shift();
          this.#pendingBudget -= currentReaction.budgetCost;
          budgetUsed += currentReaction.budgetCost;
          const result = handler(currentReaction);
          executed.push({ reaction: currentReaction, result });
          this.#recordTraceSafely(trace, 'reaction_executed', tick, { reactionId: currentReaction.reactionId, kind: currentReaction.kind, budgetUsed });
          if (this.#activeFailure) throw this.#activeFailure;
          currentReaction = null;
        }
        return deepFreeze({ executed, rejected: [], budgetUsed, exhausted: false });
      } catch (error) {
        const undispatchedCount = this.#pending.length;
        const failure = {
          code: error?.code ?? error?.name ?? 'REACTION_HANDLER_FAILED',
          reason: error?.details?.reason ?? (error?.code === 'REACTION_REENTRANT_DRAIN' ? 'REENTRANT_DRAIN' : 'HANDLER_ERROR'),
          reactionId: error?.details?.reactionId ?? currentReaction?.reactionId ?? null,
          budgetUsed,
          undispatchedCount,
        };
        this.#pending.length = 0;
        this.#pendingBudget = 0;
        this.#recordTraceSafely(trace, 'reaction_wave_failed', tick, failure);
        throw error;
      } finally {
        this.#isDraining = false;
        this.#activeMaxDepth = this.#maxDepth;
        this.#activeMaxReactions = this.#maxReactions;
        this.#activeMaxBudget = this.#maxBudget;
        this.#activeAcceptedCount = 0;
        this.#activeAcceptedBudget = 0;
        this.#activeFailure = null;
      }
    }
    #recordTraceSafely(trace, stage, tick, payload) {
      this.#isRecordingTrace = true;
      try {
        return recordTraceSafely(trace, stage, tick, payload);
      } finally {
        this.#isRecordingTrace = false;
      }
    }
    #validateTrace(trace) {
      this.#isRecordingTrace = true;
      try {
        validateTraceSink(trace, 'INVALID_REACTION_TRACE', 'reaction', 'Reaction trace must expose a record function.');
      } finally {
        this.#isRecordingTrace = false;
      }
    }
    validateWaveBounds() {
      if (this.#activeAcceptedCount > this.#activeMaxReactions) return this.createLimitError('MAX_REACTIONS');
      if (this.#activeAcceptedBudget > this.#activeMaxBudget) return this.createLimitError('BUDGET_EXCEEDED');
      const excessiveDepth = this.#pending.reduce((maximum, reaction) => Math.max(maximum, reaction.depth), 0);
      return excessiveDepth > this.#activeMaxDepth ? this.createLimitError('MAX_DEPTH') : null;
    }
    createLimitError(reason, reaction = null) {
      const maxDepth = this.#isDraining ? this.#activeMaxDepth : this.#maxDepth;
      const maxReactions = this.#isDraining ? this.#activeMaxReactions : this.#maxReactions;
      const maxBudget = this.#isDraining ? this.#activeMaxBudget : this.#maxBudget;
      const acceptedCount = this.#isDraining ? this.#activeAcceptedCount : this.#pending.length;
      const acceptedBudget = this.#isDraining ? this.#activeAcceptedBudget : this.#pendingBudget;
      return new DomainError('REACTION_WAVE_LIMIT_EXCEEDED', 'reaction', 'Reaction causation wave exceeded its configured bounds.', {
        reason,
        reactionId: reaction?.reactionId ?? null,
        maxDepth,
        maxReactions,
        maxBudget,
        acceptedCount,
        acceptedBudget,
      });
    }
  }

  function normalizeDiagnosticValue(value) {
    if (value === undefined) return null;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (Array.isArray(value)) return value.map(normalizeDiagnosticValue);
    if (isPlainObject(value)) {
      const output = {};
      for (const [key, item] of Object.entries(value)) defineDataProperty(output, key, normalizeDiagnosticValue(item));
      return output;
    }
    return String(value);
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
      defineDataProperty(values, dependency, resolved.found ? deepClone(resolved.value) : { $missing: true });
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

  function validateCommandEnvelope(value) {
    const fields = ['schemaVersion', 'commandId', 'actorId', 'requestedTick', 'correlationId', 'causationId', 'dataVersion', 'payload'];
    requireObjectFields(value, { label: 'command', required: fields, code: 'INVALID_COMMAND', stage: 'commit' });
    return createCommandEnvelope(value);
  }

  function validateDomainEventEnvelope(value, label = 'event') {
    const fields = ['schemaVersion', 'eventId', 'type', 'correlationId', 'causationId', 'occurredTick', 'payload'];
    requireObjectFields(value, { label, required: fields, code: 'INVALID_DOMAIN_EVENT', stage: 'store' });
    return createDomainEventEnvelope(value);
  }

  function validateCommitPlan(plan) {
    const fields = ['schemaVersion', 'planId', 'commandId', 'commitTick', 'preconditions', 'operations', 'eventBlueprints'];
    requireObjectFields(plan, { label: 'commit plan', required: fields, code: 'INVALID_COMMIT_PLAN', stage: 'commit' });
    requireCurrentSchemaVersion(plan.schemaVersion, 'plan.schemaVersion', 'commit');
    requireId(plan.planId, 'plan.planId');
    requireId(plan.commandId, 'plan.commandId');
    requireInteger(plan.commitTick, 'plan.commitTick', 0);
    domainAssert(Array.isArray(plan.preconditions), 'INVALID_COMMIT_PLAN', 'commit', 'Plan preconditions must be an array.');
    domainAssert(Array.isArray(plan.operations), 'INVALID_COMMIT_PLAN', 'commit', 'Plan operations must be an array.');
    domainAssert(Array.isArray(plan.eventBlueprints), 'INVALID_COMMIT_PLAN', 'commit', 'Plan eventBlueprints must be an array.');
    for (const [index, precondition] of plan.preconditions.entries()) {
      requireObjectFields(precondition, { label: `preconditions[${index}]`, required: ['entityId', 'expectedVersion'], code: 'INVALID_COMMIT_PLAN', stage: 'commit' });
      requireId(precondition.entityId, `preconditions[${index}].entityId`);
      requireInteger(precondition.expectedVersion, `preconditions[${index}].expectedVersion`, 0);
    }
    const operationShapes = {
      'resource.delta': ['order', 'kind', 'entityId', 'resource', 'delta', 'key'],
      'cooldown.set': ['order', 'kind', 'entityId', 'definitionId', 'readyTick', 'key'],
      'status.add': ['order', 'kind', 'entityId', 'status', 'key'],
      'status.patch': ['order', 'kind', 'entityId', 'instanceId', 'patch', 'key'],
      'status.remove': ['order', 'kind', 'entityId', 'instanceId', 'key'],
    };
    for (const [index, operation] of plan.operations.entries()) {
      domainAssert(isPlainObject(operation), 'INVALID_COMMIT_PLAN', 'commit', 'Each mutation operation must be a plain object.', { index });
      const kind = requireString(operation.kind, `operations[${index}].kind`);
      const shape = operationShapes[kind];
      domainAssert(Boolean(shape), 'UNSUPPORTED_OPERATION', 'commit', 'Unsupported mutation operation.', { kind });
      requireObjectFields(operation, { label: `operations[${index}]`, required: shape, code: 'INVALID_COMMIT_PLAN', stage: 'commit' });
      requireInteger(operation.order, `operations[${index}].order`);
      requireId(operation.entityId, `operations[${index}].entityId`);
      requireString(operation.key, `operations[${index}].key`);
      if (kind === 'resource.delta') {
        requireString(operation.resource, `operations[${index}].resource`);
        requireInteger(operation.delta, `operations[${index}].delta`);
      } else if (kind === 'cooldown.set') {
        requireId(operation.definitionId, `operations[${index}].definitionId`);
        requireInteger(operation.readyTick, `operations[${index}].readyTick`, 0);
      } else if (kind === 'status.add') {
        validateStatusInstance(operation.status, operation.entityId, `operations[${index}].status`);
        domainAssert(operation.status.appliedTick === plan.commitTick, 'STATUS_TIME_REGRESSION', 'commit', 'A newly added status must be applied at the commit tick.', { appliedTick: operation.status.appliedTick, commitTick: plan.commitTick });
        domainAssert(operation.status.nextTickAt > plan.commitTick, 'STATUS_TIME_REGRESSION', 'commit', 'A newly added periodic status must schedule its first tick after the commit tick.', { nextTickAt: operation.status.nextTickAt, commitTick: plan.commitTick });
      } else if (kind === 'status.patch') {
        requireId(operation.instanceId, `operations[${index}].instanceId`);
        requireObjectFields(operation.patch, { label: `operations[${index}].patch`, required: ['nextTickAt', 'lastTransitionEventId'], code: 'INVALID_COMMIT_PLAN', stage: 'commit' });
        requireInteger(operation.patch.nextTickAt, `operations[${index}].patch.nextTickAt`, 0);
        requireId(operation.patch.lastTransitionEventId, `operations[${index}].patch.lastTransitionEventId`);
      } else {
        requireId(operation.instanceId, `operations[${index}].instanceId`);
      }
    }
    for (const [index, blueprint] of plan.eventBlueprints.entries()) {
      requireObjectFields(blueprint, { label: `eventBlueprints[${index}]`, required: ['type', 'payload'], code: 'INVALID_COMMIT_PLAN', stage: 'commit' });
      requireString(blueprint.type, `eventBlueprints[${index}].type`);
      requireCanonicalJson(blueprint.payload, `eventBlueprints[${index}].payload`);
    }
    return plan;
  }

  function validateEntityResources(entity) {
    for (const [resource, value] of Object.entries(entity.resources)) {
      requireInteger(value, `${entity.id}.${resource}`, 0);
    }
    domainAssert(entity.resources.hp <= entity.resources.maxHp, 'RESOURCE_OVERFLOW', 'commit', 'HP exceeds maxHp.', { entityId: entity.id });
    domainAssert(entity.resources.mana <= entity.resources.maxMana, 'RESOURCE_OVERFLOW', 'commit', 'Mana exceeds maxMana.', { entityId: entity.id });
    domainAssert(entity.resources.shield <= entity.resources.maxShield, 'RESOURCE_OVERFLOW', 'commit', 'Shield exceeds maxShield.', { entityId: entity.id });
  }

  function validateStatusInstance(status, targetId, label = 'status') {
    const fields = [
      'instanceId', 'definitionId', 'actorId',
      'applicationSourceId', 'applicationSourceRef', 'applicationCausationId',
      'sourceId', 'sourceRef', 'targetId', 'correlationId', 'lastTransitionEventId',
      'dataVersion', 'appliedTick', 'nextTickAt', 'expireTick', 'intervalTicks',
      'rawTickDamage', 'maxCatchUpTicks',
    ];
    requireObjectFields(status, { label, required: fields, code: 'INVALID_STATUS_INSTANCE', stage: 'store' });
    requireId(status.instanceId, `${label}.instanceId`);
    requireId(status.definitionId, `${label}.definitionId`);
    requireId(status.actorId, `${label}.actorId`);
    requireId(status.applicationSourceId, `${label}.applicationSourceId`);
    const applicationSourceRef = createSourceRef(status.applicationSourceRef);
    requireId(status.applicationCausationId, `${label}.applicationCausationId`);
    requireId(status.sourceId, `${label}.sourceId`);
    const sourceRef = createSourceRef(status.sourceRef);
    requireId(status.targetId, `${label}.targetId`);
    requireId(status.correlationId, `${label}.correlationId`);
    requireId(status.lastTransitionEventId, `${label}.lastTransitionEventId`);
    requireString(status.dataVersion, `${label}.dataVersion`);
    requireInteger(status.appliedTick, `${label}.appliedTick`, 0);
    requireInteger(status.nextTickAt, `${label}.nextTickAt`, status.appliedTick);
    requireInteger(status.expireTick, `${label}.expireTick`, status.appliedTick);
    requireInteger(status.intervalTicks, `${label}.intervalTicks`, 1);
    requireInteger(status.rawTickDamage, `${label}.rawTickDamage`, 0);
    requireInteger(status.maxCatchUpTicks, `${label}.maxCatchUpTicks`, 1);
    domainAssert(status.targetId === targetId, 'INVALID_STATUS_INSTANCE', 'store', 'Status target must match its owning entity.', { targetId, actual: status.targetId });
    const canonicalApplicationSourceId = applicationSourceRef.instanceId ?? applicationSourceRef.definitionId;
    domainAssert(canonicalApplicationSourceId === status.applicationSourceId, 'INVALID_STATUS_INSTANCE', 'store', 'applicationSourceId must flatten applicationSourceRef.instanceId or, for an uninstanced System source, definitionId.', { applicationSourceId: status.applicationSourceId, canonicalApplicationSourceId });
    domainAssert(status.sourceId === status.instanceId, 'INVALID_STATUS_INSTANCE', 'store', 'Periodic status sourceId must be the StatusInstance ID.', { sourceId: status.sourceId, instanceId: status.instanceId });
    domainAssert(sourceRef.kind === 'status' && sourceRef.definitionId === status.definitionId && sourceRef.instanceId === status.instanceId, 'INVALID_STATUS_INSTANCE', 'store', 'Periodic sourceRef must identify this StatusInstance.', { instanceId: status.instanceId });
  }

  function validateRuntimeEntity(entity, entityKey, label = 'entity', stateTick = null) {
    requireObjectFields(entity, { label, required: ['id', 'version', 'resources', 'stats', 'cooldowns', 'statuses'], code: 'INVALID_RUNTIME_ENTITY', stage: 'store' });
    requireId(entity.id, `${label}.id`);
    domainAssert(entity.id === entityKey, 'INVALID_RUNTIME_ENTITY', 'store', 'Entity map key must match entity.id.', { entityKey, entityId: entity.id });
    requireInteger(entity.version, `${label}.version`, 0);
    requireObjectFields(entity.resources, { label: `${label}.resources`, required: ['hp', 'maxHp', 'mana', 'maxMana', 'shield', 'maxShield'], code: 'INVALID_RUNTIME_ENTITY', stage: 'store' });
    validateEntityResources(entity);
    requireObjectFields(entity.stats, { label: `${label}.stats`, required: [], allowed: Object.keys(entity.stats ?? {}), code: 'INVALID_RUNTIME_ENTITY', stage: 'store' });
    for (const [stat, value] of Object.entries(entity.stats)) {
      requireString(stat, `${label}.stats key`);
      requireInteger(value, `${label}.stats.${stat}`);
    }
    requireObjectFields(entity.cooldowns, { label: `${label}.cooldowns`, required: [], allowed: Object.keys(entity.cooldowns ?? {}), code: 'INVALID_RUNTIME_ENTITY', stage: 'store' });
    for (const [definitionId, readyTick] of Object.entries(entity.cooldowns)) {
      requireId(definitionId, `${label}.cooldown definitionId`);
      requireInteger(readyTick, `${label}.cooldowns.${definitionId}`, 0);
    }
    requireObjectFields(entity.statuses, { label: `${label}.statuses`, required: [], allowed: Object.keys(entity.statuses ?? {}), code: 'INVALID_RUNTIME_ENTITY', stage: 'store' });
    for (const [instanceId, status] of Object.entries(entity.statuses)) {
      requireId(instanceId, `${label}.status instanceId`);
      validateStatusInstance(status, entity.id, `${label}.statuses.${instanceId}`);
      domainAssert(status.instanceId === instanceId, 'INVALID_STATUS_INSTANCE', 'store', 'Status map key must match status.instanceId.', { instanceId, actual: status.instanceId });
      if (stateTick !== null) domainAssert(status.appliedTick <= stateTick, 'STATUS_TIME_REGRESSION', 'store', 'Active status appliedTick cannot be in the future of the owning state.', { instanceId, appliedTick: status.appliedTick, stateTick });
    }
  }

  function validateInitialState(initialState) {
    requireObjectFields(initialState, { label: 'initialState', required: ['tick', 'entities'], allowed: ['tick', 'entities', 'processedCommands', 'outbox'], code: 'INVALID_RUNTIME_STATE', stage: 'store' });
    const tick = requireInteger(initialState.tick, 'initialState.tick', 0);
    requireObjectFields(initialState.entities, { label: 'initialState.entities', required: [], allowed: Object.keys(initialState.entities ?? {}), code: 'INVALID_RUNTIME_STATE', stage: 'store' });
    for (const [entityId, entity] of Object.entries(initialState.entities)) {
      requireId(entityId, 'initialState entity key');
      validateRuntimeEntity(entity, entityId, `initialState.entities.${entityId}`, tick);
    }
    const processedCommands = initialState.processedCommands ?? [];
    domainAssert(Array.isArray(processedCommands), 'INVALID_RUNTIME_STATE', 'store', 'processedCommands must be an array.');
    const processedSet = new Set();
    for (const [index, commandId] of processedCommands.entries()) {
      requireId(commandId, `processedCommands[${index}]`);
      domainAssert(!processedSet.has(commandId), 'INVALID_RUNTIME_STATE', 'store', 'processedCommands cannot contain duplicates.', { commandId });
      processedSet.add(commandId);
    }
    const outbox = initialState.outbox ?? [];
    domainAssert(Array.isArray(outbox), 'INVALID_RUNTIME_STATE', 'store', 'outbox must be an array.');
    const eventIds = new Set();
    for (const [index, event] of outbox.entries()) {
      const normalized = validateDomainEventEnvelope(event, `outbox[${index}]`);
      domainAssert(normalized.occurredTick <= tick, 'INVALID_RUNTIME_STATE', 'store', 'Outbox event cannot occur after the state tick.', { eventId: normalized.eventId, eventTick: normalized.occurredTick, stateTick: tick });
      domainAssert(!eventIds.has(normalized.eventId), 'INVALID_RUNTIME_STATE', 'store', 'Outbox event IDs must be unique.', { eventId: normalized.eventId });
      eventIds.add(normalized.eventId);
    }
  }

  const STORE_CLOCK_ADVANCERS = new WeakMap();

  class StateStore {
    #state;
    #tick;
    #processedCommands;
    #outbox;
    #isCommitting = false;

    constructor(initialState) {
      const canonicalInitialState = deepFreeze(deepClone(initialState));
      validateInitialState(canonicalInitialState);
      this.#state = deepFreeze(cloneState({ tick: canonicalInitialState.tick, entities: canonicalInitialState.entities }));
      this.#tick = canonicalInitialState.tick;
      this.#processedCommands = new Set(canonicalInitialState.processedCommands ?? []);
      this.#outbox = (canonicalInitialState.outbox ?? []).map(event => deepFreeze(deepClone(event)));
      STORE_CLOCK_ADVANCERS.set(this, targetTick => {
        domainAssert(!this.#isCommitting, 'REENTRANT_COMMIT', 'commit', 'StateStore clock cannot advance during an active commit.');
        domainAssert(traceObserverDepth === 0, 'TRACE_OBSERVER_SIDE_EFFECT', 'commit', 'A trace observer cannot advance runtime state.');
        requireInteger(targetTick, 'targetTick', this.#tick);
        const nextState = cloneState(this.#state);
        nextState.tick = targetTick;
        this.#state = deepFreeze(nextState);
        this.#tick = targetTick;
      });
      Object.preventExtensions(this);
    }
    get tick() {
      return this.#tick;
    }
    get outbox() {
      return deepFreeze(this.#outbox.map(deepClone));
    }
    getEntity(entityId) {
      requireId(entityId, 'entityId');
      const entity = this.#state.entities[entityId];
      domainAssert(Boolean(entity), 'ENTITY_NOT_FOUND', 'store', 'Entity does not exist.', { entityId });
      return deepFreeze(deepClone(entity));
    }
    snapshot(entityIds) {
      const entities = {};
      for (const id of [...new Set(entityIds)].sort(compareText)) entities[id] = deepClone(this.getEntity(id));
      return deepFreeze({ tick: this.#tick, entities });
    }
    exportState() {
      const output = cloneState(this.#state);
      output.tick = this.#tick;
      return deepFreeze(output);
    }
    commit(command, plan, trace = null) {
      domainAssert(!this.#isCommitting, 'REENTRANT_COMMIT', 'commit', 'StateStore commit cannot be entered recursively.');
      domainAssert(traceObserverDepth === 0, 'TRACE_OBSERVER_SIDE_EFFECT', 'commit', 'A trace observer cannot commit runtime state.');
      this.#isCommitting = true;
      try {
      const canonicalCommand = validateCommandEnvelope(deepFreeze(deepClone(command)));
      const canonicalPlan = deepFreeze(deepClone(plan));
      validateCommitPlan(canonicalPlan);
      const commandId = canonicalCommand.commandId;
      const requestedTick = canonicalCommand.requestedTick;
      const planId = canonicalPlan.planId;
      const planCommandId = canonicalPlan.commandId;
      const commitTick = canonicalPlan.commitTick;
      domainAssert(commandId === planCommandId, 'COMMAND_PLAN_MISMATCH', 'commit', 'Plan does not belong to command.');
      domainAssert(!this.#processedCommands.has(commandId), 'DUPLICATE_COMMAND', 'commit', 'Command has already been committed.', { commandId });
      domainAssert(commitTick >= requestedTick && commitTick >= this.#tick, 'COMMIT_TICK_REGRESSION', 'commit', 'Commit tick cannot precede the command request or current store tick.', { commitTick, requestedTick, storeTick: this.#tick });
      const preconditions = [...canonicalPlan.preconditions];
      const rawOperations = [...canonicalPlan.operations];
      const eventBlueprints = [...canonicalPlan.eventBlueprints];
      const preconditionEntities = new Set();
      for (const precondition of preconditions) {
        const entityId = requireId(precondition.entityId, 'precondition.entityId');
        domainAssert(!preconditionEntities.has(entityId), 'DUPLICATE_VERSION_PRECONDITION', 'commit', 'Plan contains more than one version precondition for an entity.', { entityId });
        preconditionEntities.add(entityId);
      }
      const operations = rawOperations.sort((left, right) => left.order - right.order || compareText(left.key, right.key));
      const mutationEntities = new Set(operations.map(operation => requireId(operation.entityId, 'operation.entityId')));
      const missingPreconditions = [...mutationEntities].filter(entityId => !preconditionEntities.has(entityId)).sort(compareText);
      domainAssert(missingPreconditions.length === 0, 'MISSING_VERSION_PRECONDITION', 'commit', 'Every mutated entity must have exactly one version precondition.', { missingEntityIds: missingPreconditions });
      for (const operation of operations) {
        if (operation.kind !== 'status.add') continue;
        domainAssert(canonicalCommand.causationId !== null && operation.status.applicationCausationId === canonicalCommand.causationId, 'STATUS_PROVENANCE_MISMATCH', 'commit', 'Status application causation must match the applying command.', { commandCausationId: canonicalCommand.causationId, statusCausationId: operation.status.applicationCausationId });
        domainAssert(operation.status.correlationId === canonicalCommand.correlationId, 'STATUS_PROVENANCE_MISMATCH', 'commit', 'Status correlation must match the applying command.', { commandCorrelationId: canonicalCommand.correlationId, statusCorrelationId: operation.status.correlationId });
        domainAssert(operation.status.dataVersion === canonicalCommand.dataVersion, 'STATUS_PROVENANCE_MISMATCH', 'commit', 'Status dataVersion must match the applying command.', { commandDataVersion: canonicalCommand.dataVersion, statusDataVersion: operation.status.dataVersion });
      }
      for (const precondition of preconditions) {
        const entity = this.#state.entities[precondition.entityId];
        domainAssert(Boolean(entity), 'ENTITY_NOT_FOUND', 'commit', 'Precondition entity is missing.', precondition);
        domainAssert(entity.version === precondition.expectedVersion, 'VERSION_CONFLICT', 'commit', 'Entity version changed after resolve.', { entityId: entity.id, expectedVersion: precondition.expectedVersion, actualVersion: entity.version }, true);
      }
      const events = eventBlueprints.map((blueprint, index) => createDomainEventEnvelope({
        eventId: deriveEventId(commandId, blueprint.type, index, commitTick),
        type: blueprint.type,
          correlationId: canonicalCommand.correlationId,
        causationId: commandId,
        occurredTick: commitTick,
        payload: blueprint.payload,
      }));
      validateTraceSink(trace, 'INVALID_COMMIT_TRACE', 'commit', 'Commit trace must expose a record function.');
      recordTraceSafely(trace, 'commit_preconditions_checked', commitTick, { commandId, preconditions });
      const working = cloneState(this.#state);
      const touched = new Set();
      for (const operation of operations) {
        const entity = working.entities[operation.entityId];
        domainAssert(Boolean(entity), 'ENTITY_NOT_FOUND', 'commit', 'Operation entity is missing.', operation);
        touched.add(entity.id);
        if (operation.kind === 'resource.delta') {
          domainAssert(Object.prototype.hasOwnProperty.call(entity.resources, operation.resource), 'RESOURCE_NOT_FOUND', 'commit', 'Resource does not exist.', operation);
          const delta = requireInteger(operation.delta, 'operation.delta');
          const nextResource = entity.resources[operation.resource] + delta;
          domainAssert(Number.isSafeInteger(nextResource), 'NUMERIC_OVERFLOW', 'commit', 'Resource delta exceeded the safe integer range.', { entityId: entity.id, resource: operation.resource, current: entity.resources[operation.resource], delta });
          entity.resources[operation.resource] = nextResource;
        } else if (operation.kind === 'cooldown.set') {
          entity.cooldowns[requireId(operation.definitionId, 'operation.definitionId')] = requireInteger(operation.readyTick, 'operation.readyTick', 0);
        } else if (operation.kind === 'status.add') {
          const status = deepClone(operation.status);
          const instanceId = requireId(status.instanceId, 'status.instanceId');
          domainAssert(!Object.prototype.hasOwnProperty.call(entity.statuses, instanceId), 'STATUS_ALREADY_EXISTS', 'commit', 'Status add cannot overwrite an existing instance.', { entityId: entity.id, instanceId });
          entity.statuses[instanceId] = status;
        } else if (operation.kind === 'status.patch') {
          const status = entity.statuses[requireId(operation.instanceId, 'operation.instanceId')];
          domainAssert(Boolean(status), 'STATUS_NOT_FOUND', 'commit', 'Status does not exist.', operation);
          domainAssert(operation.patch.nextTickAt > status.nextTickAt, 'STATUS_TIME_REGRESSION', 'commit', 'Status nextTickAt must advance monotonically.', { instanceId: status.instanceId, currentNextTickAt: status.nextTickAt, requestedNextTickAt: operation.patch.nextTickAt });
          Object.assign(status, deepClone(operation.patch));
        } else if (operation.kind === 'status.remove') {
          const instanceId = requireId(operation.instanceId, 'operation.instanceId');
          domainAssert(Object.prototype.hasOwnProperty.call(entity.statuses, instanceId), 'STATUS_NOT_FOUND', 'commit', 'Status remove requires an existing instance.', { entityId: entity.id, instanceId });
          delete entity.statuses[instanceId];
        } else {
          throw new DomainError('UNSUPPORTED_OPERATION', 'commit', 'Unsupported mutation operation.', { kind: operation.kind });
        }
      }
      const nextTick = Math.max(this.#tick, commitTick);
      for (const entityId of touched) {
        validateRuntimeEntity(working.entities[entityId], entityId, `working.entities.${entityId}`, nextTick);
        domainAssert(working.entities[entityId].version < Number.MAX_SAFE_INTEGER, 'NUMERIC_OVERFLOW', 'commit', 'Entity version cannot advance beyond the safe integer range.', { entityId });
        working.entities[entityId].version += 1;
      }
      working.tick = nextTick;
      this.#state = deepFreeze(working);
      this.#tick = working.tick;
      this.#processedCommands.add(commandId);
      this.#outbox.push(...events.map(event => deepFreeze(deepClone(event))));
      const receipt = deepFreeze({ planId, state: this.exportState(), events });
      recordTraceSafely(trace, 'commit_published', commitTick, { commandId, operationCount: operations.length, touched: [...touched].sort(compareText), eventCount: events.length });
      return receipt;
      } finally {
        this.#isCommitting = false;
      }
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
      if (isPlainObject(value) && isPlainObject(output[key])) defineDataProperty(output, key, mergeNested(output[key], value));
      else defineDataProperty(output, key, deepClone(value));
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
    return deepFreeze({ runtimeVersion: RUNTIME_VERSION, contractSchemaVersion: CONTRACT_SCHEMA_VERSION, replayFormatVersion: REPLAY_FORMAT_VERSION, rngAlgorithmVersion: RNG_ALGORITHM_VERSION, rngKeySchemaVersion: RNG_KEY_SCHEMA_VERSION, clockDomain: CLOCK_DOMAIN, numericPolicyVersion: NUMERIC_POLICY_VERSION, dataVersion: input.dataVersion, definitionVersion: input.definitionVersion, formulaVersion: input.formulaVersion, rootSeed: input.rootSeed });
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

  function resolveDamageAgainstTarget({ actorId, sourceId, sourceRef, target, damageType, rawDamage, hitOutcome = 'Hit' }) {
    requireId(actorId, 'damage.actorId');
    requireId(sourceId, 'damage.sourceId');
    const normalizedSourceRef = createSourceRef(sourceRef);
    const canonicalSourceId = normalizedSourceRef.instanceId ?? normalizedSourceRef.definitionId;
    domainAssert(sourceId === canonicalSourceId, 'SOURCE_IDENTITY_MISMATCH', 'resolve', 'damage.sourceId must flatten sourceRef.instanceId or, for an uninstanced System source, definitionId.', { sourceId, canonicalSourceId });
    domainAssert(isPlainObject(target), 'INVALID_DAMAGE_TARGET', 'resolve', 'Damage target must be a runtime entity snapshot.');
    requireId(target.id, 'damage.targetId');
    requireString(damageType, 'damage.damageType');
    requireInteger(rawDamage, 'damage.rawDamage', 0);
    domainAssert(HIT_OUTCOMES.includes(hitOutcome), 'INVALID_HIT_OUTCOME', 'resolve', 'Damage hitOutcome is not canonical.', { hitOutcome });
    const effectiveRawDamage = hitOutcome === 'Hit' ? rawDamage : 0;
    const resistanceStat = `${damageType}ResistanceBps`;
    const resistanceBps = requireInteger(target.stats?.[resistanceStat] ?? 0, `damage.${resistanceStat}`, 0, BASIS_POINTS);
    const resolvedDamage = multiplyBps(effectiveRawDamage, BASIS_POINTS - resistanceBps);
    const shieldAbsorbed = Math.min(target.resources.shield, resolvedDamage);
    const remaining = Math.max(0, resolvedDamage - shieldAbsorbed);
    const finalHpDamage = Math.min(target.resources.hp, remaining);
    return deepFreeze({
      actorId,
      sourceId,
      sourceRef: normalizedSourceRef,
      targetId: target.id,
      hitOutcome,
      damageType,
      rawDamage: effectiveRawDamage,
      resistanceBps,
      resolvedDamage,
      shieldAbsorbed,
      finalHpDamage,
      overkill: Math.max(0, remaining - finalHpDamage),
      targetHpAfter: target.resources.hp - finalHpDamage,
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
    const hitOutcome = hitRollBps < input.skill.hitChanceBps ? 'Hit' : 'Miss';
    const hit = hitOutcome === 'Hit';
    const critical = hit && critRollBps < input.skill.critChanceBps;
    let rawDamage = hit ? input.skill.baseDamage + multiplyBps(caster.stats.spellPower, input.skill.coefficientBps) : 0;
    if (critical) rawDamage = multiplyBps(rawDamage, input.skill.critMultiplierBps);
    const sourceRef = createSourceRef({ kind: 'skill-execution', definitionId: input.skill.definitionId, instanceId: command.commandId });
    const damage = resolveDamageAgainstTarget({ actorId: caster.id, sourceId: command.commandId, sourceRef, target, damageType: 'fire', rawDamage, hitOutcome });
    const burnRawTickDamage = hit && rawDamage > 0 && input.burn.ratioBps > 0 ? Math.max(1, multiplyBps(rawDamage, input.burn.ratioBps)) : 0;
    const outcome = deepFreeze({
      ...deepClone(damage),
      skillDefinitionId: input.skill.definitionId,
      critical,
      burn: { definitionId: input.burn.definitionId, rawTickDamage: burnRawTickDamage, durationTicks: input.burn.durationTicks, intervalTicks: input.burn.intervalTicks, applyWhenTargetAlive: hit && burnRawTickDamage > 0 && damage.targetHpAfter > 0 },
    });
    const operations = [
      { order: 10, kind: 'resource.delta', entityId: caster.id, resource: 'mana', delta: -input.skill.manaCost, key: 'cost' },
      { order: 20, kind: 'cooldown.set', entityId: caster.id, definitionId: input.skill.definitionId, readyTick: input.tick + input.skill.cooldownTicks, key: 'cooldown' },
    ];
    if (damage.shieldAbsorbed) operations.push({ order: 30, kind: 'resource.delta', entityId: target.id, resource: 'shield', delta: -damage.shieldAbsorbed, key: 'shield' });
    if (damage.finalHpDamage) operations.push({ order: 40, kind: 'resource.delta', entityId: target.id, resource: 'hp', delta: -damage.finalHpDamage, key: 'hp' });
    const eventBlueprints = [
      { type: 'SkillCommitted', payload: { actorId: caster.id, sourceId: command.commandId, sourceRef: deepClone(sourceRef), targetId: target.id, skillDefinitionId: input.skill.definitionId, cooldownReadyTick: input.tick + input.skill.cooldownTicks } },
      { type: hitOutcome === 'Hit' ? 'DamageCommitted' : 'DamageMissed', payload: { ...deepClone(outcome) } },
    ];
    if (target.resources.hp > 0 && damage.targetHpAfter === 0) eventBlueprints.push({ type: 'EntityDefeated', payload: createDefeatPayload(outcome, { periodic: false }) });
    const planBase = { schemaVersion: CONTRACT_SCHEMA_VERSION, commandId: command.commandId, commitTick: input.tick, preconditions: [{ entityId: caster.id, expectedVersion: caster.version }, { entityId: target.id, expectedVersion: target.version }], operations, eventBlueprints };
    const plan = deepFreeze({ ...planBase, planId: `plan.${hashHex(planBase)}` });
    recordTraceSafely(trace, 'random_decisions', input.tick, { hitRollBps, critRollBps, hitOutcome, critical, hitKey, critKey });
    recordTraceSafely(trace, 'resolution_completed', input.tick, { outcome, operationCount: operations.length, planId: plan.planId });
    return deepFreeze({ decisions: { hitRollBps, critRollBps, hitKey, critKey }, outcome, plan });
  }

  function executeImpact(input, trace = null) {
    const store = new StateStore(createInitialState(input));
    const command = createFireballCommand(input);
    recordTraceSafely(trace, 'command_received', input.tick, { commandId: command.commandId, actorId: command.actorId, targetId: input.target.id });
    const snapshot = store.snapshot([input.caster.id, input.target.id]);
    recordTraceSafely(trace, 'snapshot_frozen', input.tick, { snapshotHash: hashHex(snapshot), entityVersions: Object.fromEntries(Object.entries(snapshot.entities).map(([id, entity]) => [id, entity.version])) });
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
      recordTraceSafely(trace, 'reaction_enqueued', event.occurredTick, { reactionId, kind: 'apply-status' });
    }
  }

  function applyStatusReaction(store, reaction, trace = null) {
    domainAssert(reaction.kind === 'apply-status', 'UNSUPPORTED_REACTION', 'reaction', 'Reference handler only supports apply-status.');
    const payload = reaction.payload;
    const target = store.getEntity(payload.targetId);
    const appliedTick = store.tick;
    const instanceId = `status-instance.${hashHex([reaction.reactionId, payload.targetId, appliedTick])}`;
    const applicationSourceRef = createSourceRef(payload.sourceRef);
    const statusSourceRef = createSourceRef({ kind: 'status', definitionId: payload.definitionId, instanceId });
    const commandId = `command.${hashHex([reaction.reactionId, 'status-apply'])}`;
    const status = { instanceId, definitionId: payload.definitionId, actorId: payload.actorId, applicationSourceId: payload.sourceId, applicationSourceRef, applicationCausationId: payload.causationId, sourceId: instanceId, sourceRef: statusSourceRef, targetId: payload.targetId, correlationId: payload.correlationId, lastTransitionEventId: deriveEventId(commandId, 'StatusApplied', 0, appliedTick), dataVersion: payload.dataVersion, appliedTick, nextTickAt: appliedTick + payload.intervalTicks, expireTick: appliedTick + payload.durationTicks, intervalTicks: payload.intervalTicks, rawTickDamage: payload.rawTickDamage, maxCatchUpTicks: payload.maxCatchUpTicks };
    const command = createCommandEnvelope({ commandId, actorId: payload.actorId, requestedTick: appliedTick, correlationId: payload.correlationId, causationId: payload.causationId, dataVersion: payload.dataVersion, payload: { targetId: payload.targetId, status } });
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

  function findLatestDefeatEventId(store, targetId) {
    for (let index = store.outbox.length - 1; index >= 0; index -= 1) {
      const event = store.outbox[index];
      if (event.type === 'EntityDefeated' && event.payload.targetId === targetId) return event.eventId;
    }
    return null;
  }

  function createStatusExpiredPayload(status, endedTick, reason, details = {}) {
    const statusSourceRef = createSourceRef({ kind: 'status', definitionId: status.definitionId, instanceId: status.instanceId });
    return {
      actorId: status.actorId,
      applicationSourceId: status.applicationSourceId,
      applicationSourceRef: deepClone(status.applicationSourceRef),
      sourceId: status.instanceId,
      sourceRef: statusSourceRef,
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
      const statusSourceRef = createSourceRef({ kind: 'status', definitionId: status.definitionId, instanceId: status.instanceId });
      const applicationSourceId = status.applicationSourceId;
      const applicationSourceRef = deepClone(status.applicationSourceRef);
      const statusTriggerEventId = status.lastTransitionEventId;
      const triggerEventId = candidate.reason === 'target-defeated'
        ? findLatestDefeatEventId(store, entity.id) ?? statusTriggerEventId
        : statusTriggerEventId;
      if (candidate.kind === 'expire') {
        const command = createCommandEnvelope({ commandId: `command.${hashHex([status.instanceId, 'expire', status.expireTick, candidate.reason])}`, actorId: status.actorId, requestedTick: commitTick, correlationId: status.correlationId, causationId: triggerEventId, dataVersion: status.dataVersion, payload: { targetId: entity.id, statusInstanceId: status.instanceId, applicationSourceId, applicationSourceRef, sourceId: status.instanceId, sourceRef: statusSourceRef, reason: candidate.reason } });
        const expiration = createStatusExpiredPayload(status, commitTick, candidate.reason, { triggerEventId, ...(candidate.catchUpLimited ? { catchUpLimited: true } : {}) });
        const planBase = { schemaVersion: CONTRACT_SCHEMA_VERSION, commandId: command.commandId, commitTick, preconditions: [{ entityId: entity.id, expectedVersion: entity.version }], operations: [{ order: 10, kind: 'status.remove', entityId: entity.id, instanceId: status.instanceId, key: 'expire' }], eventBlueprints: [{ type: 'StatusExpired', payload: expiration }] };
        commits.push(store.commit(command, { ...planBase, planId: `plan.${hashHex(planBase)}` }, trace));
        continue;
      }
      const count = perStatusCount.get(status.instanceId) ?? 0;
      const damage = resolveDamageAgainstTarget({ actorId: status.actorId, sourceId: status.instanceId, sourceRef: statusSourceRef, target: entity, damageType: 'fire', rawDamage: status.rawTickDamage });
      const defeated = entity.resources.hp > 0 && damage.targetHpAfter === 0;
      const shouldExpire = status.nextTickAt >= status.expireTick || defeated;
      const command = createCommandEnvelope({ commandId: `command.${hashHex([status.instanceId, 'tick', status.nextTickAt])}`, actorId: status.actorId, requestedTick: commitTick, correlationId: status.correlationId, causationId: triggerEventId, dataVersion: status.dataVersion, payload: { targetId: entity.id, statusInstanceId: status.instanceId, applicationSourceId, applicationSourceRef, sourceId: status.instanceId, sourceRef: statusSourceRef } });
      const operations = [];
      if (damage.shieldAbsorbed) operations.push({ order: 10, kind: 'resource.delta', entityId: entity.id, resource: 'shield', delta: -damage.shieldAbsorbed, key: 'tick-shield' });
      if (damage.finalHpDamage) operations.push({ order: 20, kind: 'resource.delta', entityId: entity.id, resource: 'hp', delta: -damage.finalHpDamage, key: 'tick-hp' });
      operations.push(shouldExpire
        ? { order: 30, kind: 'status.remove', entityId: entity.id, instanceId: status.instanceId, key: 'expire' }
        : { order: 30, kind: 'status.patch', entityId: entity.id, instanceId: status.instanceId, patch: { nextTickAt: status.nextTickAt + status.intervalTicks, lastTransitionEventId: deriveEventId(command.commandId, 'StatusTicked', 1, commitTick) }, key: 'schedule-next' });
      const tickDamageOutcome = { ...deepClone(damage), statusInstanceId: status.instanceId, statusDefinitionId: status.definitionId, periodic: true, tickAt: status.nextTickAt, triggerEventId };
      const events = [
        { type: 'DamageCommitted', payload: tickDamageOutcome },
        { type: 'StatusTicked', payload: { actorId: status.actorId, applicationSourceId, applicationSourceRef, sourceId: status.instanceId, sourceRef: statusSourceRef, targetId: entity.id, statusInstanceId: status.instanceId, definitionId: status.definitionId, rawDamage: damage.rawDamage, resolvedDamage: damage.resolvedDamage, shieldAbsorbed: damage.shieldAbsorbed, finalHpDamage: damage.finalHpDamage, tickAt: status.nextTickAt, triggerEventId } },
      ];
      if (defeated) events.push({ type: 'EntityDefeated', payload: createDefeatPayload(damage, { periodic: true, statusInstanceId: status.instanceId, statusDefinitionId: status.definitionId }) });
      if (shouldExpire) events.push({ type: 'StatusExpired', payload: createStatusExpiredPayload(status, commitTick, defeated ? 'target-defeated' : 'duration-expired', { triggerEventId }) });
      const planBase = { schemaVersion: CONTRACT_SCHEMA_VERSION, commandId: command.commandId, commitTick, preconditions: [{ entityId: entity.id, expectedVersion: entity.version }], operations, eventBlueprints: events };
      commits.push(store.commit(command, { ...planBase, planId: `plan.${hashHex(planBase)}` }, trace));
      perStatusCount.set(status.instanceId, count + 1);
    }
    const advanceClock = STORE_CLOCK_ADVANCERS.get(store);
    domainAssert(typeof advanceClock === 'function', 'INVALID_STATE_STORE', 'status', 'advanceStatuses requires a canonical StateStore instance.');
    advanceClock(Math.max(store.tick, targetTick));
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
      .map(event => event.payload.resolvedDamage - event.payload.shieldAbsorbed - event.payload.finalHpDamage - event.payload.overkill);
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
    RUNTIME_VERSION, CONTRACT_SCHEMA_VERSION, REPLAY_FORMAT_VERSION, RNG_ALGORITHM_VERSION, RNG_KEY_SCHEMA_VERSION, CLOCK_DOMAIN, NUMERIC_POLICY_VERSION, BASIS_POINTS,
    DomainError, KeyedRandom, TraceRecorder, StateStore, ReactionQueue, ContextualStatCache, SchemaMigrationRegistry,
    canonicalStringify, hashHex, hash32, multiplyBps, createSourceRef, createContextFingerprint, createCommandEnvelope, createDomainEventEnvelope,
    defaultScenarioInput, normalizeScenarioInput, createInitialState, createFireballCommand, resolveDamageAgainstTarget, resolveFireball, enqueueReactions,
    applyStatusReaction, advanceStatuses, executeImpact, runFireballScenario, verifyReplay,
    demonstrateDuplicateCommand, demonstrateVersionConflict, demonstrateAtomicRollback,
  });
});
