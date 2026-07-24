(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GSFRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRuntime() {
  'use strict';

  const RUNTIME_VERSION = '4.0.1-reference';
  const CONTRACT_SCHEMA_VERSION = 2;
  const REPLAY_FORMAT_VERSION = 2;
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

  function greatestCommonDivisor(left, right) {
    left = left < 0n ? -left : left;
    right = right < 0n ? -right : right;
    while (right !== 0n) {
      const remainder = left % right;
      left = right;
      right = remainder;
    }
    return left;
  }

  function normalizeExactRational(numerator, denominator) {
    domainAssert(
      typeof numerator === 'bigint'
        && typeof denominator === 'bigint'
        && denominator !== 0n,
      'INVALID_EXACT_SCALAR',
      'numeric',
      'An exact scalar requires BigInt numerator and non-zero denominator.',
    );
    if (denominator < 0n) {
      numerator = -numerator;
      denominator = -denominator;
    }
    const divisor = greatestCommonDivisor(numerator, denominator);
    return {
      numerator: numerator / divisor,
      denominator: denominator / divisor,
    };
  }

  function exactRationalFromInteger(value) {
    requireInteger(value, 'exact integer');
    return { numerator: BigInt(value), denominator: 1n };
  }

  function addExactRationals(left, right) {
    return normalizeExactRational(
      left.numerator * right.denominator
        + right.numerator * left.denominator,
      left.denominator * right.denominator,
    );
  }

  function multiplyExactRationalBps(value, basisPoints) {
    requireInteger(basisPoints, 'exact basisPoints', -1_000_000, 1_000_000);
    return normalizeExactRational(
      value.numerator * BigInt(basisPoints),
      value.denominator * BigInt(BASIS_POINTS),
    );
  }

  function serializeExactDamageScalar(value) {
    const normalized = normalizeExactRational(
      value.numerator,
      value.denominator,
    );
    return deepFreeze({
      numerator: normalized.numerator.toString(),
      denominator: normalized.denominator.toString(),
    });
  }

  function parseExactDamageScalar(
    value,
    label,
    code = 'INVALID_EXACT_DAMAGE',
    stage = 'contract',
  ) {
    const fields = ['numerator', 'denominator'];
    requireObjectFields(value, {
      label,
      required: fields,
      allowed: fields,
      code,
      stage,
    });
    const decimalPattern = /^(0|[1-9][0-9]*)$/;
    domainAssert(
      typeof value.numerator === 'string'
        && typeof value.denominator === 'string'
        && value.numerator.length <= 128
        && value.denominator.length <= 128
        && decimalPattern.test(value.numerator)
        && decimalPattern.test(value.denominator)
        && value.denominator !== '0',
      code,
      stage,
      `${label} must use canonical non-negative decimal integer strings.`,
      { label },
    );
    const normalized = normalizeExactRational(
      BigInt(value.numerator),
      BigInt(value.denominator),
    );
    domainAssert(
      normalized.numerator.toString() === value.numerator
        && normalized.denominator.toString() === value.denominator,
      code,
      stage,
      `${label} must be a reduced canonical fraction.`,
      { label },
    );
    return normalized;
  }

  function roundExactRationalAwayFromZero(value, label) {
    const normalized = normalizeExactRational(
      value.numerator,
      value.denominator,
    );
    const negative = normalized.numerator < 0n;
    const absolute = negative
      ? -normalized.numerator
      : normalized.numerator;
    let rounded = absolute / normalized.denominator;
    const remainder = absolute % normalized.denominator;
    if (remainder * 2n >= normalized.denominator) rounded += 1n;
    if (negative) rounded = -rounded;
    const minimum = BigInt(Number.MIN_SAFE_INTEGER);
    const maximum = BigInt(Number.MAX_SAFE_INTEGER);
    domainAssert(
      rounded >= minimum && rounded <= maximum,
      'NUMERIC_OVERFLOW',
      'numeric',
      `${label} does not fit in the JavaScript safe-integer lane.`,
      {
        label,
        numerator: normalized.numerator.toString(),
        denominator: normalized.denominator.toString(),
      },
    );
    const output = Number(rounded);
    return Object.is(output, -0) ? 0 : output;
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
    const payload = value.payload === undefined ? {} : value.payload;
    requireCanonicalJson(payload, 'command.payload');
    const envelope = {
      schemaVersion: value.schemaVersion === undefined ? CONTRACT_SCHEMA_VERSION : value.schemaVersion,
      commandId: requireId(value.commandId, 'commandId'),
      actorId: requireId(value.actorId, 'actorId'),
      requestedTick: requireInteger(value.requestedTick, 'requestedTick', 0),
      correlationId: requireId(value.correlationId, 'correlationId'),
      causationId: value.causationId == null ? null : requireId(value.causationId, 'causationId'),
      dataVersion: requireString(value.dataVersion === undefined ? 'data.reference' : value.dataVersion, 'dataVersion'),
      payload: deepClone(payload),
    };
    requireCurrentSchemaVersion(envelope.schemaVersion, 'schemaVersion', 'contract');
    return deepFreeze(envelope);
  }

  function createDomainEventEnvelope(value) {
    const fields = ['schemaVersion', 'eventId', 'type', 'correlationId', 'causationId', 'occurredTick', 'payload'];
    requireObjectFields(value, { label: 'event', required: ['eventId', 'type', 'correlationId', 'causationId', 'occurredTick'], allowed: fields, code: 'INVALID_DOMAIN_EVENT', stage: 'contract' });
    const payload = value.payload === undefined ? {} : value.payload;
    requireCanonicalJson(payload, 'event.payload');
    const envelope = {
      schemaVersion: value.schemaVersion === undefined ? CONTRACT_SCHEMA_VERSION : value.schemaVersion,
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

  const ACTIVE_REACTION_DISPATCHES = new WeakSet();

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
    #activeParentDepth;
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
      this.#activeParentDepth = null;
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
      const requestedDepth = requireInteger(canonicalRaw.depth ?? 0, 'depth', 0);
      // dispatch 중 생성된 작업은 호출자 값이 아니라 현재 부모에서 인과 깊이를 파생한다.
      const depth = this.#isDraining ? this.#activeParentDepth + 1 : requestedDepth;
      const reaction = deepFreeze({
        reactionId: requireId(canonicalRaw.reactionId, 'reactionId'),
        idempotencyKey: requireId(canonicalRaw.idempotencyKey ?? canonicalRaw.reactionId, 'idempotencyKey'),
        kind: requireString(canonicalRaw.kind, 'kind'),
        priority: requireInteger(canonicalRaw.priority ?? 100, 'priority'),
        stableOrderKey: requireString(canonicalRaw.stableOrderKey ?? canonicalRaw.reactionId, 'stableOrderKey'),
        depth,
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
          this.#activeParentDepth = currentReaction.depth;
          let result;
          ACTIVE_REACTION_DISPATCHES.add(currentReaction);
          try {
            result = handler(currentReaction);
          } finally {
            ACTIVE_REACTION_DISPATCHES.delete(currentReaction);
            this.#activeParentDepth = null;
          }
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
        this.#activeParentDepth = null;
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
      defineDataProperty(values, dependency, resolved.found
        ? { presence: 'present', value: deepClone(resolved.value) }
        : { presence: 'missing' });
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
      const descriptor = { entityId, statId, ownerVersion, contextFingerprint: { dependencies: fingerprint.dependencies, values: fingerprint.values } };
      const canonicalDescriptor = canonicalStringify(descriptor);
      const cacheKey = hashHex(canonicalDescriptor);
      // 짧은 진단 hash가 충돌해도 전체 descriptor가 같은 경우에만 cache hit로 본다.
      if (this.entries.has(canonicalDescriptor)) {
        const entry = this.entries.get(canonicalDescriptor);
        this.entries.delete(canonicalDescriptor);
        this.entries.set(canonicalDescriptor, entry);
        this.hits += 1;
        return deepFreeze({ cacheHit: true, cacheKey, fingerprint, value: deepClone(entry.value) });
      }
      const value = compute();
      domainAssert(value !== undefined, 'INVALID_STAT_RESULT', 'stat-cache', 'Computed value cannot be undefined.');
      canonicalStringify(value);
      this.entries.set(canonicalDescriptor, deepFreeze({ ...descriptor, value: deepClone(value) }));
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

  function parseCommandEnvelope(value) {
    const fields = ['schemaVersion', 'commandId', 'actorId', 'requestedTick', 'correlationId', 'causationId', 'dataVersion', 'payload'];
    const canonicalValue = deepFreeze(deepClone(value));
    requireObjectFields(canonicalValue, { label: 'command', required: fields, code: 'INVALID_COMMAND', stage: 'commit' });
    return createCommandEnvelope(canonicalValue);
  }

  function validateCommandEnvelope(value) {
    return parseCommandEnvelope(value);
  }

  function parseDomainEventEnvelope(value, label = 'event') {
    const fields = ['schemaVersion', 'eventId', 'type', 'correlationId', 'causationId', 'occurredTick', 'payload'];
    const canonicalValue = deepFreeze(deepClone(value));
    requireObjectFields(canonicalValue, { label, required: fields, code: 'INVALID_DOMAIN_EVENT', stage: 'store' });
    return createDomainEventEnvelope(canonicalValue);
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

  function findWorkingEntity(workingState, entityId) {
    return typeof entityId === 'string'
      && isPlainObject(workingState?.entities)
      && Object.hasOwn(workingState.entities, entityId)
      ? workingState.entities[entityId]
      : null;
  }

  const DAMAGE_FACT_CORE_FIELDS = Object.freeze([
    'actorId', 'sourceId', 'sourceRef', 'targetId', 'hitOutcome', 'damageType',
    'exactRawDamage', 'rawDamage', 'resistanceBps', 'resolvedDamage', 'shieldAbsorbed',
    'finalHpDamage', 'overkill', 'targetHpAfter', 'targetShieldAfter',
  ]);
  const PRIMARY_DAMAGE_FACT_FIELDS = Object.freeze([
    'skillDefinitionId', 'critical', 'burn',
  ]);
  const PERIODIC_DAMAGE_FACT_FIELDS = Object.freeze([
    'statusInstanceId', 'statusDefinitionId', 'periodic', 'tickAt',
    'triggerEventId',
  ]);

  function requireFactBoolean(value, label) {
    domainAssert(
      typeof value === 'boolean',
      'OUTBOX_FACT_MISMATCH',
      'commit',
      `${label} must be boolean.`,
      { label, value },
    );
    return value;
  }

  function validateFactSource(payload, label) {
    const actorId = requireId(payload.actorId, `${label}.actorId`);
    const sourceId = requireId(payload.sourceId, `${label}.sourceId`);
    const sourceRef = createSourceRef(payload.sourceRef);
    const canonicalSourceId = sourceRef.instanceId ?? sourceRef.definitionId;
    domainAssert(
      sourceId === canonicalSourceId,
      'OUTBOX_FACT_MISMATCH',
      'commit',
      `${label}.sourceId must flatten its structured SourceRef.`,
      { sourceId, canonicalSourceId },
    );
    return { actorId, sourceId, sourceRef };
  }

  function validateDamageFact(event, workingState, transition, expectedOutcome) {
    const payload = event.payload;
    const periodic = payload?.periodic === true;
    const variantFields = periodic
      ? PERIODIC_DAMAGE_FACT_FIELDS
      : PRIMARY_DAMAGE_FACT_FIELDS;
    const fields = [...DAMAGE_FACT_CORE_FIELDS, ...variantFields];
    requireObjectFields(payload, {
      label: `${event.type} payload`,
      required: fields,
      allowed: fields,
      code: 'OUTBOX_FACT_MISMATCH',
      stage: 'commit',
    });
    const targetId = requireId(payload.targetId, `${event.type}.targetId`);
    const { actorId, sourceId, sourceRef } = validateFactSource(
      payload,
      event.type,
    );
    const hitOutcome = requireString(
      payload.hitOutcome,
      `${event.type}.hitOutcome`,
    );
    const damageType = requireString(
      payload.damageType,
      `${event.type}.damageType`,
    );
    const exactRawDamage = parseExactDamageScalar(
      payload.exactRawDamage,
      `${event.type}.exactRawDamage`,
      'OUTBOX_FACT_MISMATCH',
      'commit',
    );
    const rawDamage = requireInteger(
      payload.rawDamage,
      `${event.type}.rawDamage`,
      0,
    );
    const resistanceBps = requireInteger(
      payload.resistanceBps,
      `${event.type}.resistanceBps`,
      0,
      BASIS_POINTS,
    );
    const resolvedDamage = requireInteger(
      payload.resolvedDamage,
      `${event.type}.resolvedDamage`,
      0,
    );
    const shieldAbsorbed = requireInteger(
      payload.shieldAbsorbed,
      `${event.type}.shieldAbsorbed`,
      0,
    );
    const finalHpDamage = requireInteger(
      payload.finalHpDamage,
      `${event.type}.finalHpDamage`,
      0,
    );
    const overkill = requireInteger(
      payload.overkill,
      `${event.type}.overkill`,
      0,
    );
    const targetHpAfter = requireInteger(
      payload.targetHpAfter,
      `${event.type}.targetHpAfter`,
      0,
    );
    const targetShieldAfter = requireInteger(
      payload.targetShieldAfter,
      `${event.type}.targetShieldAfter`,
      0,
    );
    const command = transition?.command;
    const operations = transition?.operations ?? [];
    const before = findWorkingEntity(transition?.preState ?? {}, targetId);
    const after = findWorkingEntity(workingState, targetId);
    const hpOperations = operations.filter(operation =>
      operation.kind === 'resource.delta'
      && operation.entityId === targetId
      && operation.resource === 'hp');
    const shieldOperations = operations.filter(operation =>
      operation.kind === 'resource.delta'
      && operation.entityId === targetId
      && operation.resource === 'shield');
    const expectedRawDamage = roundExactRationalAwayFromZero(
      exactRawDamage,
      `${event.type}.rawDamage`,
    );
    const expectedResolvedDamage = roundExactRationalAwayFromZero(
      multiplyExactRationalBps(
        exactRawDamage,
        BASIS_POINTS - resistanceBps,
      ),
      `${event.type}.resolvedDamage`,
    );
    const resistanceStat = `${damageType}ResistanceBps`;
    const committedResistanceBps = before?.stats?.[resistanceStat] ?? 0;
    const expectedShieldAbsorbed = before
      ? Math.min(before.resources.shield, expectedResolvedDamage)
      : null;
    const expectedPostShieldDamage = expectedShieldAbsorbed === null
      ? null
      : expectedResolvedDamage - expectedShieldAbsorbed;
    const expectedFinalHpDamage = before && expectedPostShieldDamage !== null
      ? Math.min(before.resources.hp, expectedPostShieldDamage)
      : null;
    const expectedOverkill =
      expectedPostShieldDamage === null || expectedFinalHpDamage === null
        ? null
        : expectedPostShieldDamage - expectedFinalHpDamage;
    const damageOperationsMatch =
      hpOperations.length === (finalHpDamage > 0 ? 1 : 0)
      && shieldOperations.length === (shieldAbsorbed > 0 ? 1 : 0)
      && (finalHpDamage === 0 || hpOperations[0].delta === -finalHpDamage)
      && (shieldAbsorbed === 0
        || shieldOperations[0].delta === -shieldAbsorbed);
    domainAssert(
      Boolean(command)
        && command.actorId === actorId
        && event.correlationId === command.correlationId
        && event.causationId === command.commandId
        && hitOutcome === expectedOutcome
        && rawDamage === expectedRawDamage
        && (expectedOutcome === 'Hit'
          || (exactRawDamage.numerator === 0n && rawDamage === 0))
        && Boolean(before)
        && Boolean(after)
        && before.resources.hp - after.resources.hp === finalHpDamage
        && before.resources.shield - after.resources.shield === shieldAbsorbed
        && resistanceBps === committedResistanceBps
        && after.resources.hp === targetHpAfter
        && after.resources.shield === targetShieldAfter
        && resolvedDamage === expectedResolvedDamage
        && shieldAbsorbed === expectedShieldAbsorbed
        && finalHpDamage === expectedFinalHpDamage
        && overkill === expectedOverkill
        && resolvedDamage
          === shieldAbsorbed + finalHpDamage + overkill
        && damageOperationsMatch,
      'OUTBOX_FACT_MISMATCH',
      'commit',
      `${event.type} must match its command, source, damage policy, mutations, and committed resources.`,
      {
        eventId: event.eventId,
        targetId,
        sourceId,
        damageType,
        hitOutcome,
        expectedOutcome,
        rawDamage,
        exactRawDamage: serializeExactDamageScalar(exactRawDamage),
        expectedRawDamage,
        resistanceBps,
        committedResistanceBps,
        resolvedDamage,
        expectedResolvedDamage,
        shieldAbsorbed,
        finalHpDamage,
        overkill,
        hpOperationCount: hpOperations.length,
        shieldOperationCount: shieldOperations.length,
      },
    );

    if (periodic) {
      const statusInstanceId = requireId(
        payload.statusInstanceId,
        `${event.type}.statusInstanceId`,
      );
      const statusDefinitionId = requireId(
        payload.statusDefinitionId,
        `${event.type}.statusDefinitionId`,
      );
      requireFactBoolean(payload.periodic, `${event.type}.periodic`);
      const tickAt = requireInteger(
        payload.tickAt,
        `${event.type}.tickAt`,
        0,
      );
      const triggerEventId = requireId(
        payload.triggerEventId,
        `${event.type}.triggerEventId`,
      );
      const status = before?.statuses?.[statusInstanceId];
      domainAssert(
        Boolean(status)
          && sourceRef.kind === 'status'
          && sourceRef.definitionId === statusDefinitionId
          && sourceRef.instanceId === statusInstanceId
          && sourceId === statusInstanceId
          && status.definitionId === statusDefinitionId
          && status.actorId === actorId
          && status.targetId === targetId
          && status.nextTickAt === tickAt
          && exactRawDamage.numerator === BigInt(status.rawTickDamage)
          && exactRawDamage.denominator === 1n
          && rawDamage === status.rawTickDamage
          && status.lastTransitionEventId === triggerEventId
          && command.causationId === triggerEventId
          && command.dataVersion === status.dataVersion
          && command.payload.targetId === targetId
          && command.payload.statusInstanceId === statusInstanceId
          && command.payload.sourceId === sourceId
          && canonicalStringify(command.payload.sourceRef)
            === canonicalStringify(sourceRef)
          && damageType === 'fire'
          && event.occurredTick
            === Math.max(tickAt, transition.preState.tick),
        'OUTBOX_FACT_MISMATCH',
        'commit',
        `${event.type} periodic provenance must match the pre-commit StatusInstance and command.`,
        { statusInstanceId, statusDefinitionId, tickAt, triggerEventId },
      );
      return;
    }

    const skillDefinitionId = requireId(
      payload.skillDefinitionId,
      `${event.type}.skillDefinitionId`,
    );
    const critical = requireFactBoolean(
      payload.critical,
      `${event.type}.critical`,
    );
    const burnFields = [
      'definitionId', 'rawTickDamage', 'durationTicks', 'intervalTicks',
      'maxCatchUpTicks', 'dataVersion', 'applyWhenTargetAlive',
    ];
    requireObjectFields(payload.burn, {
      label: `${event.type}.burn`,
      required: burnFields,
      allowed: burnFields,
      code: 'OUTBOX_FACT_MISMATCH',
      stage: 'commit',
    });
    requireId(payload.burn.definitionId, `${event.type}.burn.definitionId`);
    const burnRawTickDamage = requireInteger(
      payload.burn.rawTickDamage,
      `${event.type}.burn.rawTickDamage`,
      0,
    );
    requireInteger(
      payload.burn.durationTicks,
      `${event.type}.burn.durationTicks`,
      0,
    );
    requireInteger(
      payload.burn.intervalTicks,
      `${event.type}.burn.intervalTicks`,
      1,
    );
    requireInteger(
      payload.burn.maxCatchUpTicks,
      `${event.type}.burn.maxCatchUpTicks`,
      1,
    );
    requireString(
      payload.burn.dataVersion,
      `${event.type}.burn.dataVersion`,
    );
    const applyWhenTargetAlive = requireFactBoolean(
      payload.burn.applyWhenTargetAlive,
      `${event.type}.burn.applyWhenTargetAlive`,
    );
    domainAssert(
      sourceRef.kind === 'skill-execution'
        && sourceRef.definitionId === skillDefinitionId
        && sourceRef.instanceId === command.commandId
        && sourceId === command.commandId
        && damageType === 'fire'
        && command.payload.targetId === targetId
        && command.payload.skillDefinitionId === skillDefinitionId
        && payload.burn.dataVersion === command.dataVersion
        && applyWhenTargetAlive
          === (expectedOutcome === 'Hit'
            && burnRawTickDamage > 0
            && targetHpAfter > 0)
        && (expectedOutcome === 'Hit' || (!critical && burnRawTickDamage === 0)),
      'OUTBOX_FACT_MISMATCH',
      'commit',
      `${event.type} primary skill facts and Burn self-consistency must match the command and transition.`,
      {
        skillDefinitionId,
        critical,
        burnRawTickDamage,
        applyWhenTargetAlive,
      },
    );
  }

  // 상태에서 파생되는 outbox 사실은 publish 직전의 working state를 기준으로 검증한다.
  const OUTBOX_STATE_VALIDATORS = Object.freeze({
    SkillCommitted(event, workingState, transition) {
      const payload = event.payload;
      const fields = [
        'actorId', 'sourceId', 'sourceRef', 'targetId',
        'skillDefinitionId', 'manaSpent', 'cooldownReadyTick',
      ];
      requireObjectFields(payload, {
        label: 'SkillCommitted payload',
        required: fields,
        code: 'OUTBOX_FACT_MISMATCH',
        stage: 'commit',
      });
      const actorId = requireId(payload.actorId, 'SkillCommitted.actorId');
      const targetId = requireId(payload.targetId, 'SkillCommitted.targetId');
      const skillDefinitionId = requireId(
        payload.skillDefinitionId,
        'SkillCommitted.skillDefinitionId',
      );
      const sourceId = requireId(payload.sourceId, 'SkillCommitted.sourceId');
      const sourceRef = createSourceRef(payload.sourceRef);
      const manaSpent = requireInteger(
        payload.manaSpent,
        'SkillCommitted.manaSpent',
        0,
      );
      const cooldownReadyTick = requireInteger(
        payload.cooldownReadyTick,
        'SkillCommitted.cooldownReadyTick',
        0,
      );
      const command = transition?.command;
      const operations = transition?.operations ?? [];
      const actorBefore = findWorkingEntity(transition?.preState ?? {}, actorId);
      const actorAfter = findWorkingEntity(workingState, actorId);
      const targetBefore = findWorkingEntity(
        transition?.preState ?? {},
        targetId,
      );
      const targetAfter = findWorkingEntity(workingState, targetId);
      const manaOperations = operations.filter(operation =>
        operation.kind === 'resource.delta'
        && operation.entityId === actorId
        && operation.resource === 'mana');
      const cooldownOperations = operations.filter(operation =>
        operation.kind === 'cooldown.set'
        && operation.entityId === actorId
        && operation.definitionId === skillDefinitionId);
      domainAssert(
        Boolean(command)
          && command.actorId === actorId
          && event.correlationId === command.correlationId
          && event.causationId === command.commandId
          && command.payload.targetId === targetId
          && command.payload.skillDefinitionId === skillDefinitionId
          && sourceId === command.commandId
          && sourceRef.kind === 'skill-execution'
          && sourceRef.definitionId === skillDefinitionId
          && sourceRef.instanceId === command.commandId
          && Boolean(actorBefore)
          && Boolean(actorAfter)
          && Boolean(targetBefore)
          && Boolean(targetAfter)
          && actorBefore.resources.mana - actorAfter.resources.mana === manaSpent
          && manaOperations.length === 1
          && manaOperations[0].delta === -manaSpent
          && cooldownOperations.length === 1
          && cooldownOperations[0].readyTick === cooldownReadyTick
          && actorAfter.cooldowns[skillDefinitionId] === cooldownReadyTick,
        'OUTBOX_FACT_MISMATCH',
        'commit',
        'SkillCommitted must match its command, skill source, mana transition, and cooldown mutation.',
        {
          actorId,
          targetId,
          skillDefinitionId,
          sourceId,
          manaSpent,
          cooldownReadyTick,
          manaOperationCount: manaOperations.length,
          cooldownOperationCount: cooldownOperations.length,
        },
      );
    },
    DamageCommitted(event, workingState, transition) {
      validateDamageFact(event, workingState, transition, 'Hit');
    },
    DamageMissed(event, workingState, transition) {
      validateDamageFact(event, workingState, transition, 'Miss');
    },
    StatusApplied(event, workingState, transition) {
      const payload = event.payload;
      const fields = ['targetId', 'status'];
      requireObjectFields(payload, {
        label: 'StatusApplied payload',
        required: fields,
        allowed: fields,
        code: 'OUTBOX_FACT_MISMATCH',
        stage: 'commit',
      });
      const targetId = requireId(payload.targetId, 'StatusApplied.targetId');
      const status = payload.status;
      const statusInstanceId = status?.instanceId;
      validateStatusInstance(
        status,
        targetId,
        'StatusApplied.status',
      );
      const before = findWorkingEntity(transition?.preState ?? {}, targetId);
      const after = findWorkingEntity(workingState, targetId);
      const command = transition?.command;
      const addOperations = (transition?.operations ?? []).filter(operation =>
        operation.kind === 'status.add'
        && operation.entityId === targetId
        && operation.status?.instanceId === statusInstanceId);
      const committedStatus = after?.statuses?.[statusInstanceId];
      domainAssert(
        Boolean(command)
          && Boolean(before)
          && Boolean(after)
          && !Object.hasOwn(before.statuses, statusInstanceId)
          && Boolean(committedStatus)
          && canonicalStringify(committedStatus)
            === canonicalStringify(status)
          && addOperations.length === 1
          && canonicalStringify(addOperations[0].status)
            === canonicalStringify(status)
          && command.actorId === status.actorId
          && command.correlationId === status.correlationId
          && command.causationId === status.applicationCausationId
          && command.dataVersion === status.dataVersion
          && command.payload.targetId === targetId
          && canonicalStringify(command.payload.status)
            === canonicalStringify(status)
          && event.correlationId === command.correlationId
          && event.causationId === command.commandId
          && event.eventId === status.lastTransitionEventId,
        'OUTBOX_FACT_MISMATCH',
        'commit',
        'StatusApplied must exactly match one status.add transition, committed instance, command provenance, and event identity.',
        {
          eventId: event.eventId,
          targetId,
          statusInstanceId,
          addOperationCount: addOperations.length,
        },
      );
    },
    StatusTicked(event, workingState, transition) {
      const payload = event.payload;
      const fields = [
        'actorId', 'applicationSourceId', 'applicationSourceRef',
        'sourceId', 'sourceRef', 'targetId', 'statusInstanceId',
        'definitionId', 'rawDamage', 'resolvedDamage', 'shieldAbsorbed',
        'finalHpDamage', 'tickAt', 'triggerEventId',
      ];
      requireObjectFields(payload, {
        label: 'StatusTicked payload',
        required: fields,
        allowed: fields,
        code: 'OUTBOX_FACT_MISMATCH',
        stage: 'commit',
      });
      const targetId = requireId(payload.targetId, 'StatusTicked.targetId');
      const statusInstanceId = requireId(
        payload.statusInstanceId,
        'StatusTicked.statusInstanceId',
      );
      const definitionId = requireId(
        payload.definitionId,
        'StatusTicked.definitionId',
      );
      const actorId = requireId(payload.actorId, 'StatusTicked.actorId');
      const applicationSourceId = requireId(
        payload.applicationSourceId,
        'StatusTicked.applicationSourceId',
      );
      const applicationSourceRef = createSourceRef(
        payload.applicationSourceRef,
      );
      const sourceId = requireId(payload.sourceId, 'StatusTicked.sourceId');
      const sourceRef = createSourceRef(payload.sourceRef);
      const rawDamage = requireInteger(
        payload.rawDamage,
        'StatusTicked.rawDamage',
        0,
      );
      const resolvedDamage = requireInteger(
        payload.resolvedDamage,
        'StatusTicked.resolvedDamage',
        0,
      );
      const shieldAbsorbed = requireInteger(
        payload.shieldAbsorbed,
        'StatusTicked.shieldAbsorbed',
        0,
      );
      const finalHpDamage = requireInteger(
        payload.finalHpDamage,
        'StatusTicked.finalHpDamage',
        0,
      );
      const tickAt = requireInteger(payload.tickAt, 'StatusTicked.tickAt', 0);
      const triggerEventId = requireId(
        payload.triggerEventId,
        'StatusTicked.triggerEventId',
      );
      const before = findWorkingEntity(transition?.preState ?? {}, targetId);
      const after = findWorkingEntity(workingState, targetId);
      const status = before?.statuses?.[statusInstanceId];
      const afterStatus = after?.statuses?.[statusInstanceId] ?? null;
      const command = transition?.command;
      const operations = transition?.operations ?? [];
      const statusOperations = operations.filter(operation =>
        operation.entityId === targetId
        && (operation.kind === 'status.patch'
          || operation.kind === 'status.remove')
        && operation.instanceId === statusInstanceId);
      const siblingDamage = (transition?.events ?? []).filter(candidate =>
        candidate.type === 'DamageCommitted'
        && candidate.payload?.periodic === true
        && candidate.payload?.statusInstanceId === statusInstanceId
        && candidate.payload?.targetId === targetId);
      const damage = siblingDamage[0]?.payload;
      const canonicalApplicationSourceId =
        applicationSourceRef.instanceId ?? applicationSourceRef.definitionId;
      const canonicalSourceId = sourceRef.instanceId ?? sourceRef.definitionId;
      const statusTransitionMatches = statusOperations.length === 1
        && (
          (statusOperations[0].kind === 'status.patch'
            && Boolean(afterStatus)
            && afterStatus.nextTickAt === status.nextTickAt + status.intervalTicks
            && afterStatus.lastTransitionEventId === event.eventId)
          || (statusOperations[0].kind === 'status.remove'
            && afterStatus === null)
        );
      domainAssert(
        Boolean(command)
          && Boolean(status)
          && Boolean(after)
          && siblingDamage.length === 1
          && statusTransitionMatches
          && actorId === status.actorId
          && applicationSourceId === status.applicationSourceId
          && canonicalApplicationSourceId === applicationSourceId
          && canonicalStringify(applicationSourceRef)
            === canonicalStringify(status.applicationSourceRef)
          && sourceId === status.instanceId
          && canonicalSourceId === sourceId
          && sourceRef.kind === 'status'
          && sourceRef.definitionId === definitionId
          && sourceRef.instanceId === statusInstanceId
          && definitionId === status.definitionId
          && status.targetId === targetId
          && status.nextTickAt === tickAt
          && status.lastTransitionEventId === triggerEventId
          && event.occurredTick
            === Math.max(tickAt, transition.preState.tick)
          && command.actorId === actorId
          && command.correlationId === status.correlationId
          && command.causationId === triggerEventId
          && command.dataVersion === status.dataVersion
          && command.payload.targetId === targetId
          && command.payload.statusInstanceId === statusInstanceId
          && command.payload.applicationSourceId === applicationSourceId
          && canonicalStringify(command.payload.applicationSourceRef)
            === canonicalStringify(applicationSourceRef)
          && command.payload.sourceId === sourceId
          && canonicalStringify(command.payload.sourceRef)
            === canonicalStringify(sourceRef)
          && damage.rawDamage === rawDamage
          && damage.resolvedDamage === resolvedDamage
          && damage.shieldAbsorbed === shieldAbsorbed
          && damage.finalHpDamage === finalHpDamage
          && damage.actorId === actorId
          && damage.sourceId === sourceId
          && canonicalStringify(damage.sourceRef)
            === canonicalStringify(sourceRef)
          && damage.targetId === targetId
          && damage.damageType === 'fire'
          && damage.statusDefinitionId === definitionId
          && damage.tickAt === tickAt
          && damage.triggerEventId === triggerEventId,
        'OUTBOX_FACT_MISMATCH',
        'commit',
        'StatusTicked must match its pre-commit status, periodic DamageCommitted sibling, command provenance, and patch/remove transition.',
        {
          eventId: event.eventId,
          targetId,
          statusInstanceId,
          siblingDamageCount: siblingDamage.length,
          statusOperationCount: statusOperations.length,
        },
      );
    },
    StatusExpired(event, workingState, transition) {
      const payload = event.payload;
      const baseFields = [
        'actorId', 'applicationSourceId', 'applicationSourceRef',
        'sourceId', 'sourceRef', 'targetId', 'statusInstanceId',
        'definitionId', 'expireTick', 'scheduledExpireTick', 'endedTick',
        'reason', 'triggerEventId',
      ];
      const allowedFields = [...baseFields, 'catchUpLimited'];
      requireObjectFields(payload, {
        label: 'StatusExpired payload',
        required: baseFields,
        allowed: allowedFields,
        code: 'OUTBOX_FACT_MISMATCH',
        stage: 'commit',
      });
      const targetId = requireId(payload.targetId, 'StatusExpired.targetId');
      const statusInstanceId = requireId(
        payload.statusInstanceId,
        'StatusExpired.statusInstanceId',
      );
      const definitionId = requireId(
        payload.definitionId,
        'StatusExpired.definitionId',
      );
      const actorId = requireId(payload.actorId, 'StatusExpired.actorId');
      const applicationSourceId = requireId(
        payload.applicationSourceId,
        'StatusExpired.applicationSourceId',
      );
      const applicationSourceRef = createSourceRef(
        payload.applicationSourceRef,
      );
      const sourceId = requireId(payload.sourceId, 'StatusExpired.sourceId');
      const sourceRef = createSourceRef(payload.sourceRef);
      const expireTick = requireInteger(
        payload.expireTick,
        'StatusExpired.expireTick',
        0,
      );
      const scheduledExpireTick = requireInteger(
        payload.scheduledExpireTick,
        'StatusExpired.scheduledExpireTick',
        0,
      );
      const endedTick = requireInteger(
        payload.endedTick,
        'StatusExpired.endedTick',
        0,
      );
      const reason = requireString(payload.reason, 'StatusExpired.reason');
      const triggerEventId = requireId(
        payload.triggerEventId,
        'StatusExpired.triggerEventId',
      );
      const hasCatchUpLimited = Object.hasOwn(payload, 'catchUpLimited');
      if (hasCatchUpLimited) {
        domainAssert(
          requireFactBoolean(
            payload.catchUpLimited,
            'StatusExpired.catchUpLimited',
          ) === true,
          'OUTBOX_FACT_MISMATCH',
          'commit',
          'StatusExpired.catchUpLimited, when present, must be true.',
        );
      }
      const before = findWorkingEntity(transition?.preState ?? {}, targetId);
      const after = findWorkingEntity(workingState, targetId);
      const status = before?.statuses?.[statusInstanceId];
      const command = transition?.command;
      const removeOperations = (transition?.operations ?? []).filter(
        operation =>
          operation.kind === 'status.remove'
          && operation.entityId === targetId
          && operation.instanceId === statusInstanceId,
      );
      const siblingStatusTicks = (transition?.events ?? []).filter(candidate =>
        candidate.type === 'StatusTicked'
        && candidate.payload?.targetId === targetId
        && candidate.payload?.statusInstanceId === statusInstanceId);
      const canonicalApplicationSourceId =
        applicationSourceRef.instanceId ?? applicationSourceRef.definitionId;
      const canonicalSourceId = sourceRef.instanceId ?? sourceRef.definitionId;
      const allowedReasons = [
        'duration-expired', 'catch-up-limited', 'target-defeated',
      ];
      domainAssert(
        Boolean(command)
          && Boolean(status)
          && Boolean(after)
          && !Object.hasOwn(after.statuses, statusInstanceId)
          && removeOperations.length === 1
          && actorId === status.actorId
          && applicationSourceId === status.applicationSourceId
          && canonicalApplicationSourceId === applicationSourceId
          && canonicalStringify(applicationSourceRef)
            === canonicalStringify(status.applicationSourceRef)
          && sourceId === status.instanceId
          && canonicalSourceId === sourceId
          && sourceRef.kind === 'status'
          && sourceRef.definitionId === definitionId
          && sourceRef.instanceId === statusInstanceId
          && definitionId === status.definitionId
          && status.targetId === targetId
          && expireTick === status.expireTick
          && scheduledExpireTick === status.expireTick
          && endedTick === event.occurredTick
          && allowedReasons.includes(reason)
          && (reason === 'catch-up-limited') === hasCatchUpLimited
          && (reason === 'target-defeated'
            || endedTick
              === Math.max(scheduledExpireTick, transition.preState.tick))
          && (reason !== 'target-defeated'
            || after.resources.hp === 0)
          && (reason === 'target-defeated'
            || triggerEventId === status.lastTransitionEventId)
          && command.actorId === actorId
          && command.correlationId === status.correlationId
          && command.causationId === triggerEventId
          && command.dataVersion === status.dataVersion
          && command.payload.targetId === targetId
          && command.payload.statusInstanceId === statusInstanceId
          && command.payload.applicationSourceId === applicationSourceId
          && canonicalStringify(command.payload.applicationSourceRef)
            === canonicalStringify(applicationSourceRef)
          && command.payload.sourceId === sourceId
          && canonicalStringify(command.payload.sourceRef)
            === canonicalStringify(sourceRef)
          && (siblingStatusTicks.length === 1
            ? !Object.hasOwn(command.payload, 'reason')
            : command.payload.reason === reason),
        'OUTBOX_FACT_MISMATCH',
        'commit',
        'StatusExpired must match one removed pre-commit status, its schedule, source, and command provenance.',
        {
          eventId: event.eventId,
          targetId,
          statusInstanceId,
          reason,
          removeOperationCount: removeOperations.length,
          siblingStatusTickCount: siblingStatusTicks.length,
        },
      );
    },
    EntityDefeated(event, workingState, transition) {
      const payload = event.payload;
      const periodic = payload?.periodic === true;
      const baseFields = [
        'entityId', 'targetId', 'actorId', 'sourceId', 'sourceRef',
        'damageType', 'periodic',
      ];
      const periodicFields = ['statusInstanceId', 'statusDefinitionId'];
      const fields = periodic
        ? [...baseFields, ...periodicFields]
        : baseFields;
      requireObjectFields(payload, {
        label: 'EntityDefeated payload',
        required: fields,
        allowed: fields,
        code: 'OUTBOX_FACT_MISMATCH',
        stage: 'commit',
      });
      const targetId = requireId(payload.targetId, 'EntityDefeated.targetId');
      const entityId = requireId(payload.entityId, 'EntityDefeated.entityId');
      const { actorId, sourceId, sourceRef } = validateFactSource(
        payload,
        'EntityDefeated',
      );
      requireString(payload.damageType, 'EntityDefeated.damageType');
      requireFactBoolean(payload.periodic, 'EntityDefeated.periodic');
      const before = findWorkingEntity(transition?.preState ?? {}, targetId);
      const after = findWorkingEntity(workingState, targetId);
      const command = transition?.command;
      const hpOperations = (transition?.operations ?? []).filter(operation =>
        operation.kind === 'resource.delta'
        && operation.entityId === targetId
        && operation.resource === 'hp');
      const siblingDamage = (transition?.events ?? []).filter(candidate =>
        candidate.type === 'DamageCommitted'
        && candidate.payload?.targetId === targetId
        && candidate.payload?.sourceId === sourceId);
      const siblingDamagePayload = siblingDamage[0]?.payload;
      const damageRequired =
        sourceRef.kind === 'skill-execution' || sourceRef.kind === 'status';
      const systemSourceMatchesCommand = sourceRef.kind !== 'system'
        || canonicalStringify(command?.payload)
          === canonicalStringify(payload);
      domainAssert(
        Boolean(command)
          && entityId === targetId
          && command.actorId === actorId
          && event.correlationId === command.correlationId
          && event.causationId === command.commandId
          && Boolean(before)
          && Boolean(after)
          && before.resources.hp > 0
          && after.resources.hp === 0
          && hpOperations.length === 1
          && hpOperations[0].delta === -before.resources.hp
          && systemSourceMatchesCommand
          && (!damageRequired
            || (siblingDamage.length === 1
              && siblingDamagePayload.targetHpAfter === 0
              && siblingDamagePayload.actorId === actorId
              && siblingDamagePayload.damageType === payload.damageType
              && (siblingDamagePayload.periodic === true) === periodic
              && canonicalStringify(siblingDamagePayload.sourceRef)
                === canonicalStringify(sourceRef))),
        'OUTBOX_FACT_MISMATCH',
        'commit',
        'EntityDefeated must match the lethal HP transition, source, command, and authoritative damage fact when damage-caused.',
        {
          eventId: event.eventId,
          targetId,
          sourceId,
          hpOperationCount: hpOperations.length,
          siblingDamageCount: siblingDamage.length,
        },
      );
      if (periodic) {
        const statusInstanceId = requireId(
          payload.statusInstanceId,
          'EntityDefeated.statusInstanceId',
        );
        const statusDefinitionId = requireId(
          payload.statusDefinitionId,
          'EntityDefeated.statusDefinitionId',
        );
        domainAssert(
          sourceRef.kind === 'status'
            && sourceRef.instanceId === statusInstanceId
            && sourceRef.definitionId === statusDefinitionId
            && siblingDamagePayload?.statusInstanceId === statusInstanceId
            && siblingDamagePayload?.statusDefinitionId === statusDefinitionId,
          'OUTBOX_FACT_MISMATCH',
          'commit',
          'Periodic EntityDefeated provenance must identify its StatusInstance.',
          { statusInstanceId, statusDefinitionId },
        );
      }
    },
    ExternalStateChanged(event, workingState, transition) {
      const payload = event.payload;
      const fields = ['targetId', 'resource', 'delta'];
      requireObjectFields(payload, {
        label: 'ExternalStateChanged payload',
        required: fields,
        allowed: fields,
        code: 'OUTBOX_FACT_MISMATCH',
        stage: 'commit',
      });
      const targetId = requireId(
        payload.targetId,
        'ExternalStateChanged.targetId',
      );
      const resource = requireString(
        payload.resource,
        'ExternalStateChanged.resource',
      );
      const delta = requireInteger(
        payload.delta,
        'ExternalStateChanged.delta',
      );
      const command = transition?.command;
      const before = findWorkingEntity(transition?.preState ?? {}, targetId);
      const after = findWorkingEntity(workingState, targetId);
      const matchingOperations = (transition?.operations ?? []).filter(
        operation =>
          operation.kind === 'resource.delta'
          && operation.entityId === targetId
          && operation.resource === resource
          && operation.delta === delta,
      );
      domainAssert(
        Boolean(command)
          && event.correlationId === command.correlationId
          && event.causationId === command.commandId
          && command.payload.targetId === targetId
          && command.payload.resource === resource
          && command.payload.delta === delta
          && Boolean(before)
          && Boolean(after)
          && Object.hasOwn(before.resources, resource)
          && matchingOperations.length === 1
          && after.resources[resource] - before.resources[resource] === delta,
        'OUTBOX_FACT_MISMATCH',
        'commit',
        'ExternalStateChanged is a closed concurrency-probe fact and must match one resource transition.',
        { targetId, resource, delta, operationCount: matchingOperations.length },
      );
    },
    ExternalCooldownChanged(event, workingState, transition) {
      const payload = event.payload;
      const fields = ['actorId', 'skillDefinitionId', 'readyTick'];
      requireObjectFields(payload, {
        label: 'ExternalCooldownChanged payload',
        required: fields,
        allowed: fields,
        code: 'OUTBOX_FACT_MISMATCH',
        stage: 'commit',
      });
      const actorId = requireId(
        payload.actorId,
        'ExternalCooldownChanged.actorId',
      );
      const skillDefinitionId = requireId(
        payload.skillDefinitionId,
        'ExternalCooldownChanged.skillDefinitionId',
      );
      const readyTick = requireInteger(
        payload.readyTick,
        'ExternalCooldownChanged.readyTick',
        0,
      );
      const command = transition?.command;
      const actorAfter = findWorkingEntity(workingState, actorId);
      const matchingOperations = (transition?.operations ?? []).filter(
        operation =>
          operation.kind === 'cooldown.set'
          && operation.entityId === actorId
          && operation.definitionId === skillDefinitionId
          && operation.readyTick === readyTick,
      );
      domainAssert(
        Boolean(command)
          && command.actorId === actorId
          && event.correlationId === command.correlationId
          && event.causationId === command.commandId
          && command.payload.actorId === actorId
          && command.payload.skillDefinitionId === skillDefinitionId
          && command.payload.readyTick === readyTick
          && Boolean(actorAfter)
          && matchingOperations.length === 1
          && actorAfter.cooldowns[skillDefinitionId] === readyTick,
        'OUTBOX_FACT_MISMATCH',
        'commit',
        'ExternalCooldownChanged is a closed concurrency-probe fact and must match one cooldown transition.',
        {
          actorId,
          skillDefinitionId,
          readyTick,
          operationCount: matchingOperations.length,
        },
      );
    },
  });

  function validateTruthfulOutbox(events, workingState, transition = null) {
    const validatedFactKeys = new Set();
    const validationContext = transition
      ? { ...transition, events }
      : { events };
    for (const event of events) {
      const validator = Object.hasOwn(OUTBOX_STATE_VALIDATORS, event.type)
        ? OUTBOX_STATE_VALIDATORS[event.type]
        : null;
      domainAssert(
        Boolean(validator),
        'UNSUPPORTED_EVENT_TYPE',
        'commit',
        'The reference kernel publishes only its closed, explicitly validated event taxonomy.',
        { eventType: event.type },
      );
      const factKey = canonicalStringify([
        event.type,
        event.payload?.targetId ?? null,
        event.payload?.sourceId ?? null,
        event.payload?.statusInstanceId ?? null,
        event.payload?.skillDefinitionId ?? null,
      ]);
      domainAssert(
        !validatedFactKeys.has(factKey),
        'OUTBOX_FACT_MISMATCH',
        'commit',
        'A commit cannot publish the same authoritative fact identity twice.',
        { eventType: event.type, factKey },
      );
      validatedFactKeys.add(factKey);
      validator(event, workingState, validationContext);
    }
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
      const normalized = parseDomainEventEnvelope(event, `outbox[${index}]`);
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
      const canonicalCommand = validateCommandEnvelope(command);
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
      const events = eventBlueprints.map((blueprint, index) => createDomainEventEnvelope({
        eventId: deriveEventId(commandId, blueprint.type, index, commitTick),
        type: blueprint.type,
        correlationId: canonicalCommand.correlationId,
        causationId: commandId,
        occurredTick: commitTick,
        payload: blueprint.payload,
      }));
      validateTruthfulOutbox(events, working, {
        command: canonicalCommand,
        operations,
        preState: this.#state,
      });
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
    requireInteger(input.skill.coefficientBps, 'skill.coefficientBps', 0, 100_000);
    requireInteger(input.skill.critMultiplierBps, 'skill.critMultiplierBps', BASIS_POINTS, 100_000);
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

  function bindFireballCommandToInput(rawCommand, input) {
    const command = parseCommandEnvelope(rawCommand);
    const payloadFields = ['targetId', 'skillDefinitionId'];
    requireObjectFields(command.payload, {
      label: 'Fireball command payload',
      required: payloadFields,
      allowed: payloadFields,
      code: 'COMMAND_INPUT_MISMATCH',
      stage: 'resolve',
    });
    const expected = {
      actorId: input.caster.id,
      requestedTick: input.tick,
      dataVersion: input.dataVersion,
      targetId: input.target.id,
      skillDefinitionId: input.skill.definitionId,
    };
    const actual = {
      actorId: command.actorId,
      requestedTick: command.requestedTick,
      dataVersion: command.dataVersion,
      targetId: command.payload.targetId,
      skillDefinitionId: command.payload.skillDefinitionId,
    };
    const mismatches = Object.keys(expected)
      .filter(field => actual[field] !== expected[field]);
    domainAssert(
      mismatches.length === 0,
      'COMMAND_INPUT_MISMATCH',
      'resolve',
      'Fireball command identity and version fields must match the authoritative resolver input.',
      { mismatches, expected, actual },
    );
    return command;
  }

  function resolveDamageAgainstTarget({
    actorId,
    sourceId,
    sourceRef,
    target,
    damageType,
    rawDamage,
    exactRawDamage = null,
    hitOutcome = 'Hit',
  }) {
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
    const suppliedExactRawDamage = exactRawDamage == null
      ? exactRationalFromInteger(rawDamage)
      : parseExactDamageScalar(
        exactRawDamage,
        'damage.exactRawDamage',
        'INVALID_EXACT_DAMAGE',
        'resolve',
      );
    const authoritativeExactRawDamage = hitOutcome === 'Hit'
      ? suppliedExactRawDamage
      : exactRationalFromInteger(0);
    const effectiveRawDamage = roundExactRationalAwayFromZero(
      authoritativeExactRawDamage,
      'damage.rawDamage',
    );
    domainAssert(
      hitOutcome !== 'Hit' || effectiveRawDamage === rawDamage,
      'EXACT_DAMAGE_MISMATCH',
      'resolve',
      'damage.rawDamage must be the half-away-from-zero reporting projection of damage.exactRawDamage.',
      {
        rawDamage,
        expectedRawDamage: effectiveRawDamage,
        exactRawDamage: serializeExactDamageScalar(authoritativeExactRawDamage),
      },
    );
    const resistanceStat = `${damageType}ResistanceBps`;
    const resistanceBps = requireInteger(target.stats?.[resistanceStat] ?? 0, `damage.${resistanceStat}`, 0, BASIS_POINTS);
    const resolvedDamage = roundExactRationalAwayFromZero(
      multiplyExactRationalBps(
        authoritativeExactRawDamage,
        BASIS_POINTS - resistanceBps,
      ),
      'damage.resolvedDamage',
    );
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
      exactRawDamage: serializeExactDamageScalar(authoritativeExactRawDamage),
      rawDamage: effectiveRawDamage,
      resistanceBps,
      resolvedDamage,
      shieldAbsorbed,
      finalHpDamage,
      overkill: Math.max(0, remaining - finalHpDamage),
      targetHpAfter: target.resources.hp - finalHpDamage,
      targetShieldAfter: target.resources.shield - shieldAbsorbed,
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
    input = normalizeScenarioInput(input);
    command = bindFireballCommandToInput(command, input);
    const caster = snapshot.entities[input.caster.id];
    const target = snapshot.entities[input.target.id];
    domainAssert(Boolean(caster && target), 'INVALID_SNAPSHOT', 'resolve', 'Caster and target must be present.');
    domainAssert(target.resources.hp > 0, 'TARGET_NOT_ALIVE', 'resolve', 'Target must be alive before skill resolution.', { targetId: target.id });
    const cooldownReadyTick = requireInteger(caster.cooldowns[input.skill.definitionId] ?? 0, 'cooldownReadyTick', 0);
    domainAssert(cooldownReadyTick <= input.tick, 'COOLDOWN_ACTIVE', 'resolve', 'Skill cooldown is not ready at the execution tick.', { actorId: caster.id, skillDefinitionId: input.skill.definitionId, cooldownReadyTick, executionTick: input.tick });
    domainAssert(caster.resources.mana >= input.skill.manaCost, 'INSUFFICIENT_MANA', 'resolve', 'Caster lacks mana.');
    const hitKey = [command.correlationId, 'fireball.hit', target.id];
    const critKey = [command.correlationId, 'fireball.critical', target.id];
    const hitRollBps = rng.sampleBps(hitKey);
    const critRollBps = rng.sampleBps(critKey);
    const hitOutcome = hitRollBps < input.skill.hitChanceBps ? 'Hit' : 'Miss';
    const hit = hitOutcome === 'Hit';
    const critical = hit && critRollBps < input.skill.critChanceBps;
    const zeroExactDamage = exactRationalFromInteger(0);
    const scalingDamageExact = hit
      ? multiplyExactRationalBps(
        exactRationalFromInteger(caster.stats.spellPower),
        input.skill.coefficientBps,
      )
      : zeroExactDamage;
    const formulaDamageExact = hit
      ? addExactRationals(
        exactRationalFromInteger(input.skill.baseDamage),
        scalingDamageExact,
      )
      : zeroExactDamage;
    const rawDamageExact = critical
      ? multiplyExactRationalBps(
        formulaDamageExact,
        input.skill.critMultiplierBps,
      )
      : formulaDamageExact;
    const scalingDamageProjection = roundExactRationalAwayFromZero(
      scalingDamageExact,
      'fireball.scalingDamageProjection',
    );
    const formulaDamageProjection = roundExactRationalAwayFromZero(
      formulaDamageExact,
      'fireball.formulaDamageProjection',
    );
    const rawDamage = roundExactRationalAwayFromZero(
      rawDamageExact,
      'fireball.rawDamage',
    );
    const sourceRef = createSourceRef({ kind: 'skill-execution', definitionId: input.skill.definitionId, instanceId: command.commandId });
    const damage = resolveDamageAgainstTarget({
      actorId: caster.id,
      sourceId: command.commandId,
      sourceRef,
      target,
      damageType: 'fire',
      rawDamage,
      exactRawDamage: serializeExactDamageScalar(rawDamageExact),
      hitOutcome,
    });
    const burnRawTickDamage = hit && rawDamage > 0 && input.burn.ratioBps > 0 ? Math.max(1, multiplyBps(rawDamage, input.burn.ratioBps)) : 0;
    const outcome = deepFreeze({
      ...deepClone(damage),
      skillDefinitionId: input.skill.definitionId,
      critical,
      burn: {
        definitionId: input.burn.definitionId,
        rawTickDamage: burnRawTickDamage,
        durationTicks: input.burn.durationTicks,
        intervalTicks: input.burn.intervalTicks,
        maxCatchUpTicks: input.burn.maxCatchUpTicks,
        dataVersion: input.dataVersion,
        applyWhenTargetAlive:
          hit && burnRawTickDamage > 0 && damage.targetHpAfter > 0,
      },
    });
    const operations = [
      { order: 10, kind: 'resource.delta', entityId: caster.id, resource: 'mana', delta: -input.skill.manaCost, key: 'cost' },
      { order: 20, kind: 'cooldown.set', entityId: caster.id, definitionId: input.skill.definitionId, readyTick: input.tick + input.skill.cooldownTicks, key: 'cooldown' },
    ];
    if (damage.shieldAbsorbed) operations.push({ order: 30, kind: 'resource.delta', entityId: target.id, resource: 'shield', delta: -damage.shieldAbsorbed, key: 'shield' });
    if (damage.finalHpDamage) operations.push({ order: 40, kind: 'resource.delta', entityId: target.id, resource: 'hp', delta: -damage.finalHpDamage, key: 'hp' });
    const eventBlueprints = [
      { type: 'SkillCommitted', payload: { actorId: caster.id, sourceId: command.commandId, sourceRef: deepClone(sourceRef), targetId: target.id, skillDefinitionId: input.skill.definitionId, manaSpent: input.skill.manaCost, cooldownReadyTick: input.tick + input.skill.cooldownTicks } },
      { type: hitOutcome === 'Hit' ? 'DamageCommitted' : 'DamageMissed', payload: { ...deepClone(outcome) } },
    ];
    if (target.resources.hp > 0 && damage.targetHpAfter === 0) eventBlueprints.push({ type: 'EntityDefeated', payload: createDefeatPayload(outcome, { periodic: false }) });
    const planBase = { schemaVersion: CONTRACT_SCHEMA_VERSION, commandId: command.commandId, commitTick: input.tick, preconditions: [{ entityId: caster.id, expectedVersion: caster.version }, { entityId: target.id, expectedVersion: target.version }], operations, eventBlueprints };
    const plan = deepFreeze({ ...planBase, planId: `plan.${hashHex(planBase)}` });
    recordTraceSafely(trace, 'random_decisions', input.tick, { hitRollBps, critRollBps, hitOutcome, critical, hitKey, critKey });
    recordTraceSafely(trace, 'damage_calculated', input.tick, {
      phase: 'primary',
      formulaVersion: input.formulaVersion,
      baseDamage: hit ? input.skill.baseDamage : 0,
      scalingDamageProjection,
      scalingDamageExact: serializeExactDamageScalar(scalingDamageExact),
      formulaDamageProjection,
      formulaDamageExact: serializeExactDamageScalar(formulaDamageExact),
      criticalMultiplierBps: critical ? input.skill.critMultiplierBps : 10_000,
      rawDamage,
      rawDamageExact: serializeExactDamageScalar(rawDamageExact),
      resistanceBps: damage.resistanceBps,
      resolvedDamage: damage.resolvedDamage,
    });
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

  function createApplyStatusReactionFromDamageEvent(rawEvent) {
    const event = parseDomainEventEnvelope(rawEvent, 'reaction source event');
    if (event.type !== 'DamageCommitted') return null;
    const burn = event.payload.burn;
    if (!burn?.applyWhenTargetAlive) return null;
    const reactionId = `reaction.${hashHex([event.eventId, 'apply-burn'])}`;
    const reaction = canonicalizeApplyStatusReaction({
      reactionId,
      idempotencyKey: `idempotency.${hashHex([event.eventId, burn.definitionId])}`,
      kind: 'apply-status',
      priority: 100,
      stableOrderKey: `${event.payload.targetId}:${burn.definitionId}`,
      depth: 1,
      budgetCost: 1,
      payload: {
        actorId: event.payload.actorId,
        sourceId: event.payload.sourceId,
        sourceRef: deepClone(event.payload.sourceRef),
        targetId: event.payload.targetId,
        definitionId: burn.definitionId,
        rawTickDamage: burn.rawTickDamage,
        durationTicks: burn.durationTicks,
        intervalTicks: burn.intervalTicks,
        maxCatchUpTicks: burn.maxCatchUpTicks,
        correlationId: event.correlationId,
        causationId: event.eventId,
        dataVersion: burn.dataVersion,
      },
    });
    return deepFreeze({ event, reaction });
  }

  function enqueueReactions(events, queue, trace = null) {
    for (const rawEvent of events) {
      const projection = createApplyStatusReactionFromDamageEvent(rawEvent);
      if (projection === null) continue;
      queue.enqueue(projection.reaction);
      recordTraceSafely(
        trace,
        'reaction_enqueued',
        projection.event.occurredTick,
        { reactionId: projection.reaction.reactionId, kind: 'apply-status' },
      );
    }
  }

  function reactionSourceBinding(reaction) {
    const binding = deepClone(reaction);
    // Causal depth belongs to ReactionQueue. During dispatch it is rewritten
    // from the active parent, so it is not a fact carried by DamageCommitted.
    delete binding.depth;
    return deepFreeze(binding);
  }

  function canonicalizeApplyStatusReaction(rawReaction) {
    domainAssert(
      isPlainObject(rawReaction),
      'INVALID_REACTION',
      'reaction',
      'An apply-status reaction must be a plain object.',
    );
    const reaction = deepFreeze(deepClone(rawReaction));
    const reactionFields = [
      'reactionId', 'idempotencyKey', 'kind', 'priority',
      'stableOrderKey', 'depth', 'budgetCost', 'payload',
    ];
    requireObjectFields(reaction, {
      label: 'apply-status reaction',
      required: reactionFields,
      code: 'INVALID_REACTION',
      stage: 'reaction',
    });
    requireId(reaction.reactionId, 'reaction.reactionId');
    requireId(reaction.idempotencyKey, 'reaction.idempotencyKey');
    requireString(reaction.kind, 'reaction.kind');
    domainAssert(
      reaction.kind === 'apply-status',
      'UNSUPPORTED_REACTION',
      'reaction',
      'Reference handler only supports apply-status.',
    );
    requireInteger(reaction.priority, 'reaction.priority');
    requireString(reaction.stableOrderKey, 'reaction.stableOrderKey');
    requireInteger(reaction.depth, 'reaction.depth', 0);
    requireInteger(reaction.budgetCost, 'reaction.budgetCost', 1);

    const payloadFields = [
      'actorId', 'sourceId', 'sourceRef', 'targetId', 'definitionId',
      'rawTickDamage', 'durationTicks', 'intervalTicks', 'maxCatchUpTicks',
      'correlationId', 'causationId', 'dataVersion',
    ];
    requireObjectFields(reaction.payload, {
      label: 'apply-status reaction payload',
      required: payloadFields,
      code: 'INVALID_REACTION_PAYLOAD',
      stage: 'reaction',
    });
    const payload = reaction.payload;
    requireId(payload.actorId, 'reaction.payload.actorId');
    requireId(payload.sourceId, 'reaction.payload.sourceId');
    const sourceRef = createSourceRef(payload.sourceRef);
    const canonicalSourceId = sourceRef.instanceId ?? sourceRef.definitionId;
    domainAssert(
      payload.sourceId === canonicalSourceId,
      'INVALID_REACTION_PAYLOAD',
      'reaction',
      'sourceId must flatten sourceRef.instanceId or an uninstanced System definitionId.',
      { sourceId: payload.sourceId, canonicalSourceId },
    );
    requireId(payload.targetId, 'reaction.payload.targetId');
    requireId(payload.definitionId, 'reaction.payload.definitionId');
    requireInteger(payload.rawTickDamage, 'reaction.payload.rawTickDamage', 0);
    requireInteger(payload.durationTicks, 'reaction.payload.durationTicks', 0);
    requireInteger(payload.intervalTicks, 'reaction.payload.intervalTicks', 1);
    requireInteger(payload.maxCatchUpTicks, 'reaction.payload.maxCatchUpTicks', 1);
    requireId(payload.correlationId, 'reaction.payload.correlationId');
    requireId(payload.causationId, 'reaction.payload.causationId');
    requireString(payload.dataVersion, 'reaction.payload.dataVersion');
    return deepFreeze({
      ...reaction,
      payload: {
        ...payload,
        sourceRef,
      },
    });
  }

  function applyStatusReaction(store, reaction, trace = null) {
    domainAssert(
      store instanceof StateStore,
      'INVALID_STATE_STORE',
      'reaction',
      'applyStatusReaction requires a canonical StateStore instance.',
    );
    const canonicalReaction = canonicalizeApplyStatusReaction(reaction);
    domainAssert(
      ACTIVE_REACTION_DISPATCHES.has(reaction),
      'REACTION_DISPATCH_REQUIRED',
      'reaction',
      'applyStatusReaction must run synchronously inside the ReactionQueue handler that owns this reaction.',
      { reactionId: canonicalReaction.reactionId },
    );
    const payload = canonicalReaction.payload;
    const committedSources = store.outbox.filter(
      event => event.eventId === payload.causationId,
    );
    domainAssert(
      committedSources.length === 1
        && committedSources[0].type === 'DamageCommitted',
      'REACTION_SOURCE_NOT_COMMITTED',
      'reaction',
      'An apply-status reaction must be caused by one DamageCommitted event in this store outbox.',
      {
        causationId: payload.causationId,
        matchCount: committedSources.length,
        matchedType: committedSources[0]?.type ?? null,
      },
    );
    const expectedProjection = createApplyStatusReactionFromDamageEvent(
      committedSources[0],
    );
    domainAssert(
      expectedProjection !== null
        && canonicalReaction.depth
          >= expectedProjection.reaction.depth
        && canonicalStringify(reactionSourceBinding(canonicalReaction))
          === canonicalStringify(
            reactionSourceBinding(expectedProjection.reaction),
          ),
      'REACTION_SOURCE_MISMATCH',
      'reaction',
      'The apply-status reaction must match every event-owned field and cannot undercut the event-derived root depth; greater causal depth remains queue-owned.',
      {
        causationId: payload.causationId,
        reactionId: canonicalReaction.reactionId,
      },
    );
    const target = store.getEntity(payload.targetId);
    // committed event의 과거 생존 정보 대신 dispatch 시점의 실제 상태를 다시 확인한다.
    if (target.resources.hp <= 0) {
      const result = deepFreeze({ outcome: 'NotApplicable', reason: 'TARGET_NOT_ALIVE', reactionId: canonicalReaction.reactionId, targetId: target.id, stateChanged: false, events: [] });
      recordTraceSafely(trace, 'reaction_not_applicable', store.tick, result);
      return result;
    }
    const appliedTick = store.tick;
    const instanceId = `status-instance.${hashHex([canonicalReaction.reactionId, payload.targetId, appliedTick])}`;
    const applicationSourceRef = createSourceRef(payload.sourceRef);
    const statusSourceRef = createSourceRef({ kind: 'status', definitionId: payload.definitionId, instanceId });
    const commandId = `command.${hashHex([canonicalReaction.reactionId, 'status-apply'])}`;
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
      recordTraceSafely(trace, 'damage_calculated', commitTick, { phase: 'periodic', statusInstanceId: status.instanceId, rawDamage: damage.rawDamage, resistanceBps: damage.resistanceBps, resolvedDamage: damage.resolvedDamage });
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
    enqueueReactions(impact.commit.events, queue, trace);
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
    const externalSkillDefinitionId = 'skill.external-version-probe';
    const externalPayload = {
      actorId: target.id,
      skillDefinitionId: externalSkillDefinitionId,
      readyTick: input.tick + 1,
    };
    const external = createCommandEnvelope({ commandId: 'command.external.target-touch.0001', actorId: target.id, requestedTick: input.tick, correlationId: 'correlation.external.target-touch.0001', dataVersion: input.dataVersion, payload: externalPayload });
    const operations = [{ order: 10, kind: 'cooldown.set', entityId: target.id, definitionId: externalSkillDefinitionId, readyTick: input.tick + 1, key: 'external' }];
    const externalBase = { schemaVersion: CONTRACT_SCHEMA_VERSION, commandId: external.commandId, commitTick: input.tick, preconditions: [{ entityId: target.id, expectedVersion: target.version }], operations, eventBlueprints: [{ type: 'ExternalCooldownChanged', payload: externalPayload }] };
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
    canonicalStringify, hashHex, hash32, multiplyBps, createSourceRef, createContextFingerprint,
    createCommandEnvelope, createDomainEventEnvelope, parseCommandEnvelope, parseDomainEventEnvelope,
    defaultScenarioInput, normalizeScenarioInput, createInitialState, createFireballCommand, resolveDamageAgainstTarget, resolveFireball, enqueueReactions,
    applyStatusReaction, advanceStatuses, executeImpact, runFireballScenario, verifyReplay,
    demonstrateDuplicateCommand, demonstrateVersionConflict, demonstrateAtomicRollback,
  });
});
