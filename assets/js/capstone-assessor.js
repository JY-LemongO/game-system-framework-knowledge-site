(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GSFCapstone = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCapstoneAssessor() {
  'use strict';

  const ASSESSOR_VERSION = '2.0.1';
  const SCHEMA_VERSION = 1;
  const CHALLENGE_ID = 'chain-lightning-shock.v1';
  const PASS_SCORE = 80;
  const MAX_SUBMISSION_CHARS = 24_000;

  const ROOT_KEYS = ['schemaVersion', 'challengeId', 'ownership', 'resolve', 'commit', 'reaction', 'status', 'replay', 'scenarios'];
  const OWNERSHIP_KEYS = ['orchestrationOwner', 'targetSelectionOwner', 'damageResolutionOwner', 'statusLifecycleOwner', 'commitOwner'];
  const RESOLVE_KEYS = ['mutatesState', 'emitsEvents', 'maxTargets', 'duplicateTargetPolicy', 'limitAfterSort', 'targetOrder', 'rngMode', 'rngKeyParts'];
  const COMMIT_KEYS = ['scope', 'expectedVersionSubjects', 'publish', 'duplicatePolicy', 'versionConflict'];
  const REACTION_KEYS = ['triggerEvent', 'causationId', 'sortOrder', 'limits', 'budgetFailure', 'commandIdPolicy', 'retryPolicy'];
  const STATUS_KEYS = ['applyRule', 'applicationSource', 'periodicSource', 'periodicCausation', 'instanceIdPolicy', 'clockDomain', 'tickOffsets', 'expiresAtOffset', 'sameTickOrder', 'finalTickCommit'];
  const REPLAY_KEYS = ['targetPermutationInvariant', 'envelopeFields', 'evidence'];
  const SCENARIO_KEYS = ['normal', 'edge', 'failure'];

  const OWNERSHIP = {
    orchestrationOwner: 'Skill',
    targetSelectionOwner: 'Effect',
    damageResolutionOwner: 'Combat',
    statusLifecycleOwner: 'Status',
    commitOwner: 'RuntimeCommitter'
  };
  const TARGET_ORDER = ['distanceBucket:asc', 'entityId:ordinal:asc'];
  const RNG_KEY_PARTS = ['correlationId', 'decisionKind', 'targetId'];
  const EXPECTED_VERSION_SUBJECTS = ['caster', 'target:*'];
  const REACTION_SORT_ORDER = ['priority:asc', 'stableOrderKey:ordinal:asc', 'reactionId:ordinal:asc'];
  const REACTION_LIMITS = ['maxDepth', 'maxReactions', 'maxBudget', 'idempotency'];
  const REACTION_FAILURE = 'keep-primary-and-dispatched-discard-undispatched-diagnostic-trace';
  const REACTION_RETRY_POLICY = 'new-command-and-idempotency-keys-or-explicit-operator-policy';
  const STATUS_EVENT_ORDER = 'DamageCommitted-StatusTicked-StatusExpired';
  const FINAL_TICK_COMMIT = 'damage-tick-expire-status-remove-atomic';
  const REPLAY_ENVELOPE_FIELDS = [
    'runtimeVersion', 'contractSchemaVersion', 'replayFormatVersion',
    'rngAlgorithmVersion', 'rngKeySchemaVersion', 'clockDomain',
    'numericPolicyVersion', 'dataVersion', 'definitionVersion', 'formulaVersion',
    'rootSeed', 'targetOrderPolicyVersion'
  ];
  const REQUIRED_SCENARIOS = {
    normal: ['stable-target-order', 'target-keyed-rng', 'single-primary-plan', 'damage-event-per-target', 'direct-shock-reaction'],
    edge: ['permuted-input-same-hash', 'distance-tie-entity-id', 'sort-before-limit-max-3', 'duplicate-target-rejected', 'full-shield-hit-applies-shock', 'final-tick-expire-atomic'],
    failure: ['stale-target-zero-mutation', 'stale-target-zero-outbox', 'reaction-budget-keeps-primary', 'reaction-dispatched-commit-kept', 'reaction-wave-discards-undispatched', 'reaction-idempotency-consumed']
  };
  const DIMENSION_MINIMUMS = {
    ownership: 12,
    resolve: 16,
    commit: 16,
    reaction: 16,
    status: 12,
    replay: 8
  };
  const ENUM_CANDIDATES = {
    ownership: {
      orchestrationOwner: ['Skill', 'Effect', 'Combat'],
      targetSelectionOwner: ['Skill', 'Effect', 'Combat'],
      damageResolutionOwner: ['Skill', 'Effect', 'Combat'],
      statusLifecycleOwner: ['Combat', 'Status', 'RuntimeCommitter'],
      commitOwner: ['Combat', 'Status', 'RuntimeCommitter']
    },
    resolve: {
      duplicateTargetPolicy: ['allow-duplicates', 'deduplicate-first', 'reject-request'],
      targetOrder: ['input-order', 'distanceBucket:asc', 'entityId:ordinal:asc', 'entityId:ordinal:desc'],
      rngMode: ['sequential-consumption', 'shared-per-command', 'keyed-per-target'],
      rngKeyParts: ['correlationId', 'decisionKind', 'targetId', 'collectionIndex', 'wallClock']
    },
    commit: {
      scope: ['damage-per-target', 'cost-then-damage', 'cost-cooldown-all-primary-damage'],
      expectedVersionSubjects: ['caster', 'target:*', 'initial-target-only'],
      publish: ['state-first-outbox-later', 'outbox-first-state-later', 'state-and-outbox-atomic'],
      duplicatePolicy: ['allow-repeat', 'reject-after-mutation', 'reject-before-mutation'],
      versionConflict: ['skip-stale-target', 'commit-valid-subset', 'reject-entire-plan']
    },
    reaction: {
      triggerEvent: ['DamageResolved', 'DamageCommitted', 'SkillExecuted'],
      causationId: ['origin-command', 'correlation-root', 'direct-trigger-event'],
      sortOrder: ['insertion-order', 'priority:asc', 'stableOrderKey:ordinal:asc', 'reactionId:ordinal:asc', 'reactionId:ordinal:desc'],
      limits: ['maxDepth', 'maxReactions', 'maxBudget', 'idempotency', 'wallClockTimeout'],
      budgetFailure: ['rollback-primary', 'keep-primary-discard-all-reactions', 'keep-primary-and-dispatched-discard-undispatched-durable-error-event', REACTION_FAILURE],
      commandIdPolicy: ['random-guid', 'reuse-root-command', 'derive-from-trigger-event-and-reaction-kind'],
      retryPolicy: ['implicit-retry-same-command', 'reuse-consumed-idempotency-key', 'new-command-id-or-explicit-operator-policy', REACTION_RETRY_POLICY]
    },
    status: {
      applyRule: ['positive-hp-damage-only', 'any-resolved-attempt', 'committed-hit-and-target-alive'],
      applicationSource: ['damage-event', 'origin-skill-execution', 'shock-status-instance'],
      periodicSource: ['origin-skill-execution', 'shock-status-instance', 'system-clock'],
      periodicCausation: ['root-command', 'status-applied-event-only', 'last-transition-event'],
      instanceIdPolicy: ['random-guid', 'derive-from-target-only', 'derive-from-reaction-target-applied-tick'],
      clockDomain: ['wall_clock', 'render_frame', 'simulation_tick'],
      sameTickOrder: ['StatusExpired-DamageCommitted-StatusTicked', 'StatusTicked-DamageCommitted-StatusExpired', STATUS_EVENT_ORDER],
      finalTickCommit: ['damage-only-then-expire-later', 'expire-before-damage', FINAL_TICK_COMMIT]
    },
    replay: {
      envelopeFields: [...REPLAY_ENVELOPE_FIELDS, 'wallClock', 'machineName'],
      evidence: ['normal', 'edge', 'failure', 'happy-path-only']
    },
    scenarios: {
      normal: [...REQUIRED_SCENARIOS.normal, 'input-order', 'shared-rng'],
      edge: [...REQUIRED_SCENARIOS.edge, 'positive-damage-only', 'expire-before-tick'],
      failure: [...REQUIRED_SCENARIOS.failure, 'partial-target-commit', 'rollback-primary']
    }
  };

  function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function deepClone(value) {
    if (Array.isArray(value)) return value.map(deepClone);
    if (!isPlainObject(value)) return value;
    const copy = {};
    for (const key of Object.keys(value)) copy[key] = deepClone(value[key]);
    return copy;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    return Object.freeze(value);
  }

  function denseDataArrayItems(value, maxLength) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maxLength) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const names = Object.getOwnPropertyNames(value);
    if (Object.getOwnPropertySymbols(value).length > 0 || names.length !== value.length + 1) return null;

    const items = new Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) return null;
      items[index] = descriptor.value;
    }
    return items;
  }

  function sameArray(actual, expected) {
    const items = denseDataArrayItems(actual, expected.length);
    if (!items || items.length !== expected.length) return false;
    for (let index = 0; index < items.length; index += 1) {
      if (items[index] !== expected[index]) return false;
    }
    return true;
  }

  function hasAll(actual, expected) {
    return Array.isArray(actual) && expected.every(value => actual.includes(value));
  }

  function sameSet(actual, expected) {
    return Array.isArray(actual) && actual.length === expected.length && hasAll(actual, expected);
  }

  function exactKeys(value, expected, path, errors) {
    if (!isPlainObject(value)) {
      errors.push(`${path} must be an object.`);
      return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const symbolCount = Object.getOwnPropertySymbols(value).length;
    if (symbolCount > 0 || Object.values(descriptors).some(item => typeof item.get === 'function' || typeof item.set === 'function')) {
      errors.push(`${path} must contain data properties only.`);
      return false;
    }
    const actual = Object.keys(value).sort();
    const canonical = [...expected].sort();
    if (!sameArray(actual, canonical)) {
      errors.push(`${path} must contain exactly: ${expected.join(', ')}.`);
      return false;
    }
    return true;
  }

  function requireNullableString(value, path, errors) {
    if (value === null) return;
    if (typeof value !== 'string' || value.length > 120) errors.push(`${path} must be null or a string up to 120 characters.`);
  }

  function requireNullableBoolean(value, path, errors) {
    if (value !== null && typeof value !== 'boolean') errors.push(`${path} must be null or a boolean.`);
  }

  function requireNullableInteger(value, path, errors) {
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 32)) {
      errors.push(`${path} must be null or an integer from 0 through 32.`);
    }
  }

  function requireStringArray(value, path, errors) {
    const items = denseDataArrayItems(value, 24);
    if (!items || items.some(item => typeof item !== 'string' || item.length > 120)) {
      errors.push(`${path} must be an array of at most 24 short strings.`);
      return null;
    }
    if (new Set(items).size !== items.length) {
      errors.push(`${path} must be a dense JSON array of unique strings without extra properties.`);
      return null;
    }
    return items;
  }

  function requireNullableEnum(value, allowed, path, errors) {
    requireNullableString(value, path, errors);
    if (typeof value === 'string' && !allowed.includes(value)) {
      errors.push(`${path} must use a candidate token declared by the public JSON Schema.`);
    }
  }

  function requireEnumArray(value, allowed, path, errors) {
    const items = requireStringArray(value, path, errors);
    if (items && items.some(item => !allowed.includes(item))) {
      errors.push(`${path} contains a token not declared by the public JSON Schema.`);
    }
  }

  function validateSubmissionShape(value) {
    const errors = [];
    if (!exactKeys(value, ROOT_KEYS, '$', errors)) return errors;
    if (value.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}.`);
    if (value.challengeId !== CHALLENGE_ID) errors.push(`challengeId must be ${CHALLENGE_ID}.`);

    const sections = [
      ['ownership', OWNERSHIP_KEYS], ['resolve', RESOLVE_KEYS], ['commit', COMMIT_KEYS],
      ['reaction', REACTION_KEYS], ['status', STATUS_KEYS], ['replay', REPLAY_KEYS], ['scenarios', SCENARIO_KEYS]
    ];
    for (const [name, keys] of sections) exactKeys(value[name], keys, `$.${name}`, errors);
    if (errors.length) return errors;

    for (const key of OWNERSHIP_KEYS) requireNullableEnum(value.ownership[key], ENUM_CANDIDATES.ownership[key], `$.ownership.${key}`, errors);
    requireNullableBoolean(value.resolve.mutatesState, '$.resolve.mutatesState', errors);
    requireNullableBoolean(value.resolve.emitsEvents, '$.resolve.emitsEvents', errors);
    requireNullableInteger(value.resolve.maxTargets, '$.resolve.maxTargets', errors);
    requireNullableEnum(value.resolve.duplicateTargetPolicy, ENUM_CANDIDATES.resolve.duplicateTargetPolicy, '$.resolve.duplicateTargetPolicy', errors);
    requireNullableBoolean(value.resolve.limitAfterSort, '$.resolve.limitAfterSort', errors);
    requireEnumArray(value.resolve.targetOrder, ENUM_CANDIDATES.resolve.targetOrder, '$.resolve.targetOrder', errors);
    requireNullableEnum(value.resolve.rngMode, ENUM_CANDIDATES.resolve.rngMode, '$.resolve.rngMode', errors);
    requireEnumArray(value.resolve.rngKeyParts, ENUM_CANDIDATES.resolve.rngKeyParts, '$.resolve.rngKeyParts', errors);
    for (const key of COMMIT_KEYS) {
      if (key === 'expectedVersionSubjects') requireEnumArray(value.commit[key], ENUM_CANDIDATES.commit[key], `$.commit.${key}`, errors);
      else requireNullableEnum(value.commit[key], ENUM_CANDIDATES.commit[key], `$.commit.${key}`, errors);
    }
    for (const key of REACTION_KEYS) {
      if (key === 'sortOrder' || key === 'limits') requireEnumArray(value.reaction[key], ENUM_CANDIDATES.reaction[key], `$.reaction.${key}`, errors);
      else requireNullableEnum(value.reaction[key], ENUM_CANDIDATES.reaction[key], `$.reaction.${key}`, errors);
    }
    for (const key of STATUS_KEYS) {
      if (key === 'tickOffsets') {
        const items = denseDataArrayItems(value.status[key], 8);
        if (!items || items.some(item => !Number.isInteger(item) || item < 0 || item > 32) || new Set(items).size !== items.length) {
          errors.push(`$.status.${key} must be an array of at most 8 unique integers from 0 through 32.`);
        }
      } else if (key === 'expiresAtOffset') requireNullableInteger(value.status[key], `$.status.${key}`, errors);
      else requireNullableEnum(value.status[key], ENUM_CANDIDATES.status[key], `$.status.${key}`, errors);
    }
    requireNullableBoolean(value.replay.targetPermutationInvariant, '$.replay.targetPermutationInvariant', errors);
    requireEnumArray(value.replay.envelopeFields, ENUM_CANDIDATES.replay.envelopeFields, '$.replay.envelopeFields', errors);
    requireEnumArray(value.replay.evidence, ENUM_CANDIDATES.replay.evidence, '$.replay.evidence', errors);
    for (const key of SCENARIO_KEYS) requireEnumArray(value.scenarios[key], ENUM_CANDIDATES.scenarios[key], `$.scenarios.${key}`, errors);
    return errors;
  }

  function createStarterSubmission() {
    return {
      schemaVersion: SCHEMA_VERSION,
      challengeId: CHALLENGE_ID,
      ownership: {
        orchestrationOwner: null,
        targetSelectionOwner: null,
        damageResolutionOwner: null,
        statusLifecycleOwner: null,
        commitOwner: null
      },
      resolve: {
        mutatesState: null,
        emitsEvents: null,
        maxTargets: null,
        duplicateTargetPolicy: null,
        limitAfterSort: null,
        targetOrder: [],
        rngMode: null,
        rngKeyParts: []
      },
      commit: {
        scope: null,
        expectedVersionSubjects: [],
        publish: null,
        duplicatePolicy: null,
        versionConflict: null
      },
      reaction: {
        triggerEvent: null,
        causationId: null,
        sortOrder: [],
        limits: [],
        budgetFailure: null,
        commandIdPolicy: null,
        retryPolicy: null
      },
      status: {
        applyRule: null,
        applicationSource: null,
        periodicSource: null,
        periodicCausation: null,
        instanceIdPolicy: null,
        clockDomain: null,
        tickOffsets: [],
        expiresAtOffset: null,
        sameTickOrder: null,
        finalTickCommit: null
      },
      replay: {
        targetPermutationInvariant: null,
        envelopeFields: [],
        evidence: []
      },
      scenarios: {
        normal: [],
        edge: [],
        failure: []
      }
    };
  }

  const DIMENSIONS = [
    {
      id: 'ownership', label: '책임 소유권', maxScore: 15,
      checks: [
        ['skill-owner', 'Skill이 실행을 조율한다', 3, s => s.ownership.orchestrationOwner === OWNERSHIP.orchestrationOwner],
        ['effect-owner', 'Effect가 대상 선택을 소유한다', 3, s => s.ownership.targetSelectionOwner === OWNERSHIP.targetSelectionOwner],
        ['combat-owner', 'Combat이 피해를 계산한다', 3, s => s.ownership.damageResolutionOwner === OWNERSHIP.damageResolutionOwner],
        ['status-owner', 'Status가 수명주기를 소유한다', 3, s => s.ownership.statusLifecycleOwner === OWNERSHIP.statusLifecycleOwner],
        ['commit-owner', 'RuntimeCommitter가 상태·outbox를 확정한다', 3, s => s.ownership.commitOwner === OWNERSHIP.commitOwner]
      ]
    },
    {
      id: 'resolve', label: '순수 resolve·정렬·RNG', maxScore: 20,
      checks: [
        ['pure-resolve', 'resolve는 상태를 바꾸지 않는다', 3, s => s.resolve.mutatesState === false],
        ['no-precommit-event', 'resolve는 event를 발행하지 않는다', 3, s => s.resolve.emitsEvents === false],
        ['bounded-selection', '전체 정렬 뒤 최대 3개를 고르고 중복 요청을 거부한다', 4, s => s.resolve.maxTargets === 3 && s.resolve.duplicateTargetPolicy === 'reject-request' && s.resolve.limitAfterSort === true],
        ['stable-target-order', '대상은 거리와 EntityId로 안정 정렬한다', 4, s => sameArray(s.resolve.targetOrder, TARGET_ORDER)],
        ['target-keyed-rng', '각 대상 판정은 keyed RNG를 사용한다', 3, s => s.resolve.rngMode === 'keyed-per-target'],
        ['rng-key-schema', 'RNG key가 correlation·decision·target을 포함한다', 3, s => sameArray(s.resolve.rngKeyParts, RNG_KEY_PARTS)]
      ]
    },
    {
      id: 'commit', label: '원자적 commit·version·rollback', maxScore: 20,
      checks: [
        ['single-plan', '비용·쿨다운·모든 주 피해를 한 plan으로 묶는다', 4, s => s.commit.scope === 'cost-cooldown-all-primary-damage'],
        ['version-preconditions', 'caster와 모든 target version을 검사한다', 4, s => sameSet(s.commit.expectedVersionSubjects, EXPECTED_VERSION_SUBJECTS)],
        ['atomic-publication', 'state와 outbox를 함께 확정한다', 4, s => s.commit.publish === 'state-and-outbox-atomic'],
        ['duplicate-policy', '중복 command를 mutation 전에 거부한다', 4, s => s.commit.duplicatePolicy === 'reject-before-mutation'],
        ['conflict-policy', 'version 충돌은 plan 전체를 거부한다', 4, s => s.commit.versionConflict === 'reject-entire-plan']
      ]
    },
    {
      id: 'reaction', label: 'event·reaction 인과·상한', maxScore: 20,
      checks: [
        ['damage-trigger', 'Shock은 DamageCommitted 뒤에 생성된다', 3, s => s.reaction.triggerEvent === 'DamageCommitted'],
        ['direct-causation', 'CausationId는 직접 피해 event를 가리킨다', 4, s => s.reaction.causationId === 'direct-trigger-event'],
        ['reaction-order', 'reaction 정렬 tuple을 고정한다', 3, s => sameArray(s.reaction.sortOrder, REACTION_SORT_ORDER)],
        ['reaction-limits', 'depth·개수·budget·멱등 상한을 둔다', 3, s => sameSet(s.reaction.limits, REACTION_LIMITS)],
        ['reaction-failure', '실패 전 commit과 primary를 보존하고 미실행 작업만 폐기한다', 4, s => s.reaction.budgetFailure === REACTION_FAILURE],
        ['reaction-command-id', '후속 commandId를 결정론적으로 만들고 재시도에는 새 ID나 명시적 운영 정책을 요구한다', 3, s =>
          s.reaction.commandIdPolicy === 'derive-from-trigger-event-and-reaction-kind' &&
          s.reaction.retryPolicy === REACTION_RETRY_POLICY]
      ]
    },
    {
      id: 'status', label: 'Status 시간·출처', maxScore: 15,
      checks: [
        ['status-apply-rule', 'full-shield Hit의 생존 대상에도 Shock을 적용한다', 2, s => s.status.applyRule === 'committed-hit-and-target-alive'],
        ['application-source', '적용 출처는 원래 skill execution이다', 2, s => s.status.applicationSource === 'origin-skill-execution'],
        ['periodic-source', '주기 피해 출처는 Shock instance다', 1, s => s.status.periodicSource === 'shock-status-instance'],
        ['periodic-causation', '각 주기 명령은 직전 Status transition event를 원인으로 삼는다', 3, s => s.status.periodicCausation === 'last-transition-event'],
        ['status-instance-id', 'StatusInstanceId를 reaction·대상·적용 tick에서 결정론적으로 만든다', 2, s => s.status.instanceIdPolicy === 'derive-from-reaction-target-applied-tick'],
        ['status-clock', 'simulation_tick만 사용한다', 1, s => s.status.clockDomain === 'simulation_tick'],
        ['status-schedule', 'Shock은 +2와 +4에 tick한다', 2, s => sameArray(s.status.tickOffsets, [2, 4]) && s.status.expiresAtOffset === 4],
        ['final-tick-atomic', '+4 피해·tick·expire·remove를 같은 commit에서 순서대로 확정한다', 2, s => s.status.sameTickOrder === STATUS_EVENT_ORDER && s.status.finalTickCommit === FINAL_TICK_COMMIT]
      ]
    },
    {
      id: 'replay', label: 'Replay envelope·증거', maxScore: 10,
      checks: [
        ['permutation-invariant', '입력 순서가 replay 결과를 바꾸지 않는다', 2, s => s.replay.targetPermutationInvariant === true],
        ['replay-envelope', '런타임·계약·데이터·정렬 의미를 replay envelope에 고정한다', 5, s => sameSet(s.replay.envelopeFields, REPLAY_ENVELOPE_FIELDS)],
        ['three-axis-evidence', '정상·경계·실패 증거를 모두 남긴다', 3, s => sameSet(s.replay.evidence, ['normal', 'edge', 'failure'])]
      ]
    }
  ];

  function canonicalStringify(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
    if (isPlainObject(value)) {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function stableHash(value) {
    const text = canonicalStringify(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
  }

  function probeCheck(id, pass, evidence) {
    return { id, pass: Boolean(pass), evidence };
  }

  function targetComparator(left, right) {
    if (left.distanceBucket !== right.distanceBucket) return left.distanceBucket - right.distanceBucket;
    return left.entityId < right.entityId ? -1 : left.entityId > right.entityId ? 1 : 0;
  }

  function resolveTargets(submission, targets) {
    const duplicate = new Set(targets.map(target => target.entityId)).size !== targets.length;
    if (duplicate && submission.resolve.duplicateTargetPolicy === 'reject-request') {
      return { rejected: true, reason: 'duplicate-target', selectedTargetIds: [], rngKeys: [], resultHash: stableHash({ rejected: 'duplicate-target' }) };
    }

    const canSort = sameArray(submission.resolve.targetOrder, TARGET_ORDER);
    const sorted = canSort ? [...targets].sort(targetComparator) : [...targets];
    const maximum = Number.isInteger(submission.resolve.maxTargets) && submission.resolve.maxTargets > 0
      ? submission.resolve.maxTargets
      : targets.length;
    const selected = submission.resolve.limitAfterSort
      ? sorted.slice(0, maximum)
      : (canSort ? targets.slice(0, maximum).sort(targetComparator) : targets.slice(0, maximum));
    const rngKeys = selected.map((target, index) => {
      if (submission.resolve.rngMode === 'keyed-per-target' && sameArray(submission.resolve.rngKeyParts, RNG_KEY_PARTS)) {
        return `corr.capstone|hit-roll|${target.entityId}`;
      }
      return `sequential-consumption|${index}`;
    });
    const decisions = selected.map((target, index) => ({
      targetId: target.entityId,
      rngKey: rngKeys[index],
      sampleHash: stableHash({ rootSeed: 'seed.capstone', key: rngKeys[index] })
    }));
    return {
      rejected: false,
      reason: null,
      selectedTargetIds: selected.map(target => target.entityId),
      rngKeys,
      resultHash: stableHash(decisions)
    };
  }

  function runNormalProbe(submission) {
    const targets = [
      { entityId: 'entity.target-c', distanceBucket: 2 },
      { entityId: 'entity.target-b', distanceBucket: 1 },
      { entityId: 'entity.target-a', distanceBucket: 1 }
    ];
    const resolution = resolveTargets(submission, targets);
    const ownershipExact = Object.keys(OWNERSHIP).every(key => submission.ownership[key] === OWNERSHIP[key]);
    const singlePrimaryPlan = submission.commit.scope === 'cost-cooldown-all-primary-damage' && submission.commit.publish === 'state-and-outbox-atomic';
    const damageEvents = singlePrimaryPlan && submission.resolve.emitsEvents === false
      ? resolution.selectedTargetIds.map((targetId, index) => ({ type: 'DamageCommitted', eventId: `event.damage-${index + 1}`, targetId }))
      : [];
    const shockCommands = submission.reaction.triggerEvent === 'DamageCommitted'
      ? damageEvents.map(event => ({
        targetId: event.targetId,
        causationId: submission.reaction.causationId === 'direct-trigger-event' ? event.eventId : 'command.chain-lightning'
      }))
      : [];
    const checks = [
      probeCheck('declared-normal-evidence', sameSet(submission.scenarios.normal, REQUIRED_SCENARIOS.normal), submission.scenarios.normal),
      probeCheck('ownership-boundaries', ownershipExact, submission.ownership),
      probeCheck('stable-target-order', sameArray(resolution.selectedTargetIds, ['entity.target-a', 'entity.target-b', 'entity.target-c']), resolution.selectedTargetIds),
      probeCheck('target-keyed-rng', sameArray(resolution.rngKeys, [
        'corr.capstone|hit-roll|entity.target-a',
        'corr.capstone|hit-roll|entity.target-b',
        'corr.capstone|hit-roll|entity.target-c'
      ]), resolution.rngKeys),
      probeCheck('single-primary-plan', singlePrimaryPlan, { scope: submission.commit.scope, publish: submission.commit.publish }),
      probeCheck('damage-event-per-target', damageEvents.length === 3, damageEvents.map(event => event.targetId)),
      probeCheck('direct-shock-reaction', shockCommands.length === 3 && shockCommands.every((command, index) => command.causationId === damageEvents[index].eventId), shockCommands),
      probeCheck('deterministic-reaction-order', sameArray(submission.reaction.sortOrder, REACTION_SORT_ORDER), submission.reaction.sortOrder)
    ];
    return {
      passed: checks.every(check => check.pass),
      checks,
      evidence: {
        orderedTargetIds: resolution.selectedTargetIds,
        rngKeyHash: stableHash(resolution.rngKeys),
        resolutionHash: resolution.resultHash,
        primaryPlanCount: singlePrimaryPlan ? 1 : 0,
        damageEventCount: damageEvents.length,
        shockReactionCount: shockCommands.length
      }
    };
  }

  function buildStatusEvidence(submission) {
    const damageEvent = { type: 'DamageCommitted', eventId: 'event.damage-shielded', targetId: 'entity.target-shielded' };
    const hitOutcome = 'Hit';
    const targetAlive = true;
    const hpDamage = 0;
    const shockApplied = submission.status.applyRule === 'committed-hit-and-target-alive' && hitOutcome === 'Hit' && targetAlive;
    const applicationCausationId = submission.reaction.causationId === 'direct-trigger-event' ? damageEvent.eventId : 'command.chain-lightning';
    const applyCommand = { commandId: 'command.apply-shock', causationId: applicationCausationId };
    const statusInstanceId = submission.status.instanceIdPolicy === 'derive-from-reaction-target-applied-tick'
      ? `status.shock-${stableHash({ reactionId: 'reaction.shock', targetId: damageEvent.targetId, appliedTick: 40 }).slice(-8)}`
      : 'status.random';
    const statusInstance = { instanceId: statusInstanceId, applicationCausationId };
    const statusApplied = { type: 'StatusApplied', eventId: 'event.status-applied', causationId: applyCommand.commandId };
    const tick2CommandId = 'command.shock-tick-42';
    const tick2 = {
      commandId: tick2CommandId,
      commitTick: 42,
      events: ['DamageCommitted', 'StatusTicked'],
      commandCausationId: submission.status.periodicCausation === 'last-transition-event' ? statusApplied.eventId : damageEvent.eventId,
      statusTickedEventId: 'event.status-ticked-42',
      statusTickedEventCausationId: tick2CommandId
    };
    const tick4CommandId = 'command.shock-tick-44';
    const tick4 = {
      commandId: tick4CommandId,
      commitTick: 44,
      events: submission.status.sameTickOrder === STATUS_EVENT_ORDER
        ? ['DamageCommitted', 'StatusTicked', 'StatusExpired']
        : ['StatusExpired', 'DamageCommitted', 'StatusTicked'],
      operations: submission.status.finalTickCommit === FINAL_TICK_COMMIT
        ? ['resource.delta:damage-if-nonzero', 'status.remove']
        : ['resource.delta:damage-if-nonzero'],
      atomic: submission.status.finalTickCommit === FINAL_TICK_COMMIT,
      commandCausationId: submission.status.periodicCausation === 'last-transition-event' ? tick2.statusTickedEventId : statusApplied.eventId,
      eventCausationIds: [tick4CommandId, tick4CommandId, tick4CommandId]
    };
    return {
      damageEvent,
      hitOutcome,
      hpDamage,
      targetAlive,
      shockApplied,
      applicationSource: submission.status.applicationSource,
      periodicSource: submission.status.periodicSource,
      applicationCausationId,
      statusInstanceId,
      statusInstance,
      applyCommand,
      statusApplied,
      tick2,
      tick4
    };
  }

  function runEdgeProbe(submission) {
    const targets = [
      { entityId: 'entity.target-d', distanceBucket: 2 },
      { entityId: 'entity.target-c', distanceBucket: 1 },
      { entityId: 'entity.target-b', distanceBucket: 1 },
      { entityId: 'entity.target-a', distanceBucket: 0 }
    ];
    const permutation = [targets[2], targets[0], targets[3], targets[1]];
    const first = resolveTargets(submission, targets);
    const second = resolveTargets(submission, permutation);
    const duplicate = resolveTargets(submission, [targets[3], targets[2], targets[3]]);
    const status = buildStatusEvidence(submission);
    const statusChainValid =
      status.applyCommand.causationId === status.damageEvent.eventId &&
      status.statusInstance.applicationCausationId === status.damageEvent.eventId &&
      status.statusApplied.causationId === status.applyCommand.commandId &&
      status.applicationSource === 'origin-skill-execution' &&
      status.periodicSource === 'shock-status-instance' &&
      status.statusInstanceId.startsWith('status.shock-') &&
      status.tick2.commandCausationId === status.statusApplied.eventId &&
      status.tick2.statusTickedEventCausationId === status.tick2.commandId &&
      status.tick4.commandCausationId === status.tick2.statusTickedEventId &&
      status.tick4.eventCausationIds.every(causationId => causationId === status.tick4.commandId);
    const finalTickAtomic = status.tick4.atomic &&
      sameArray(status.tick4.events, ['DamageCommitted', 'StatusTicked', 'StatusExpired']) &&
      sameArray(status.tick4.operations, ['resource.delta:damage-if-nonzero', 'status.remove']);
    const checks = [
      probeCheck('declared-edge-evidence', sameSet(submission.scenarios.edge, REQUIRED_SCENARIOS.edge), submission.scenarios.edge),
      probeCheck('permuted-input-same-hash', submission.replay.targetPermutationInvariant === true && first.resultHash === second.resultHash, { declaredInvariant: submission.replay.targetPermutationInvariant, first: first.resultHash, second: second.resultHash }),
      probeCheck('distance-tie-entity-id', first.selectedTargetIds[1] === 'entity.target-b' && first.selectedTargetIds[2] === 'entity.target-c', first.selectedTargetIds),
      probeCheck('sort-before-limit-max-3', sameArray(first.selectedTargetIds, ['entity.target-a', 'entity.target-b', 'entity.target-c']), first.selectedTargetIds),
      probeCheck('duplicate-target-rejected', duplicate.rejected && duplicate.reason === 'duplicate-target', { rejected: duplicate.rejected, reason: duplicate.reason }),
      probeCheck('full-shield-hit-applies-shock', status.hitOutcome === 'Hit' && status.hpDamage === 0 && status.targetAlive && status.shockApplied, {
        hitOutcome: status.hitOutcome,
        hpDamage: status.hpDamage,
        targetAlive: status.targetAlive,
        shockApplied: status.shockApplied
      }),
      probeCheck('status-causation-chain', statusChainValid, {
        applyCommand: status.applyCommand,
        statusInstanceApplicationCausationId: status.statusInstance.applicationCausationId,
        statusAppliedEventCausationId: status.statusApplied.causationId,
        firstTickCausationId: status.tick2.commandCausationId,
        finalTickCausationId: status.tick4.commandCausationId,
        statusInstanceId: status.statusInstanceId
      }),
      probeCheck('status-schedule-and-clock', submission.status.clockDomain === 'simulation_tick' && sameArray(submission.status.tickOffsets, [2, 4]) && submission.status.expiresAtOffset === 4, {
        clockDomain: submission.status.clockDomain,
        tickOffsets: submission.status.tickOffsets,
        expiresAtOffset: submission.status.expiresAtOffset
      }),
      probeCheck('final-tick-expire-atomic', finalTickAtomic, status.tick4)
    ];
    return {
      passed: checks.every(check => check.pass),
      checks,
      evidence: {
        firstPermutationHash: first.resultHash,
        secondPermutationHash: second.resultHash,
        selectedTargetIds: first.selectedTargetIds,
        duplicateRejected: duplicate.rejected,
        shieldedHit: { hitOutcome: status.hitOutcome, hpDamage: status.hpDamage, shockApplied: status.shockApplied },
        statusCausation: {
          damageEventId: status.damageEvent.eventId,
          applyCommandCausationId: status.applyCommand.causationId,
          statusInstanceApplicationCausationId: status.statusInstance.applicationCausationId,
          statusAppliedEventCausationId: status.statusApplied.causationId,
          firstTickCommandCausationId: status.tick2.commandCausationId,
          finalTickCommandCausationId: status.tick4.commandCausationId
        },
        finalTickCommitHash: stableHash(status.tick4)
      }
    };
  }

  function runFailureProbe(submission) {
    const beforeState = {
      caster: { mana: 100, cooldownReadyAt: 0, version: 7 },
      targets: {
        'entity.target-a': { hp: 200, version: 3 },
        'entity.target-b': { hp: 200, version: 9 }
      }
    };
    const beforeOutbox = [];
    const staleProtected =
      sameSet(submission.commit.expectedVersionSubjects, EXPECTED_VERSION_SUBJECTS) &&
      submission.commit.scope === 'cost-cooldown-all-primary-damage' &&
      submission.commit.publish === 'state-and-outbox-atomic' &&
      submission.commit.versionConflict === 'reject-entire-plan';
    const afterState = staleProtected ? deepClone(beforeState) : {
      caster: { ...beforeState.caster, mana: 80, cooldownReadyAt: 50, version: 8 },
      targets: {
        ...beforeState.targets,
        'entity.target-a': { hp: 120, version: 4 }
      }
    };
    const afterOutbox = staleProtected ? [] : [{ type: 'DamageCommitted', targetId: 'entity.target-a' }];

    const duplicateBeforeState = { caster: { mana: 80, version: 8 }, target: { hp: 120, version: 4 } };
    const duplicateBeforeOutbox = [{ type: 'SkillCommitted' }, { type: 'DamageCommitted' }];
    const duplicateProtected = submission.commit.duplicatePolicy === 'reject-before-mutation';
    const duplicateAfterState = duplicateProtected ? deepClone(duplicateBeforeState) : { caster: { mana: 60, version: 9 }, target: { hp: 40, version: 5 } };
    const duplicateAfterOutbox = duplicateProtected ? deepClone(duplicateBeforeOutbox) : [...duplicateBeforeOutbox, { type: 'SkillCommitted' }, { type: 'DamageCommitted' }];

    const reactionPolicyExact = submission.reaction.budgetFailure === REACTION_FAILURE;
    const reactionPolicyKnown = typeof submission.reaction.budgetFailure === 'string';
    const keepsPrimary = submission.reaction.budgetFailure === 'keep-primary-discard-all-reactions' ||
      submission.reaction.budgetFailure === REACTION_FAILURE ||
      submission.reaction.budgetFailure === 'keep-primary-and-dispatched-discard-undispatched-durable-error-event';
    const keepsDispatched = submission.reaction.budgetFailure === REACTION_FAILURE || submission.reaction.budgetFailure === 'keep-primary-and-dispatched-discard-undispatched-durable-error-event';
    const durableDiagnostic = submission.reaction.budgetFailure === 'keep-primary-and-dispatched-discard-undispatched-durable-error-event';
    const retainsEnqueuedIdempotency = sameSet(submission.reaction.limits, REACTION_LIMITS);
    const reactionEvidence = {
      primaryCommit: keepsPrimary ? 'kept' : 'rolled-back',
      dispatchedCommits: keepsDispatched ? ['reaction.shock-a'] : [],
      undispatchedPending: reactionPolicyKnown ? [] : ['reaction.shock-b', 'reaction.shock-c'],
      discardedPending: reactionPolicyKnown ? ['reaction.shock-b', 'reaction.shock-c'] : [],
      diagnosticTrace: { durable: durableDiagnostic ? true : reactionPolicyExact ? false : null, code: 'REACTION_WAVE_LIMIT_EXCEEDED', reason: 'BUDGET_EXCEEDED' },
      retainedReactionIdempotencyKeys: retainsEnqueuedIdempotency ? ['idempotency.shock-a', 'idempotency.shock-b', 'idempotency.shock-c'] : [],
      retryPolicy: submission.reaction.retryPolicy
    };
    const beforeStateHash = stableHash(beforeState);
    const afterStateHash = stableHash(afterState);
    const beforeOutboxHash = stableHash(beforeOutbox);
    const afterOutboxHash = stableHash(afterOutbox);
    const duplicateBeforeStateHash = stableHash(duplicateBeforeState);
    const duplicateAfterStateHash = stableHash(duplicateAfterState);
    const duplicateBeforeOutboxHash = stableHash(duplicateBeforeOutbox);
    const duplicateAfterOutboxHash = stableHash(duplicateAfterOutbox);
    const checks = [
      probeCheck('declared-failure-evidence', sameSet(submission.scenarios.failure, REQUIRED_SCENARIOS.failure), submission.scenarios.failure),
      probeCheck('stale-target-zero-mutation', staleProtected && beforeStateHash === afterStateHash, { beforeStateHash, afterStateHash }),
      probeCheck('stale-target-zero-outbox', staleProtected && beforeOutboxHash === afterOutboxHash, { beforeOutboxHash, afterOutboxHash }),
      probeCheck('duplicate-command-zero-mutation-outbox', duplicateProtected && duplicateBeforeStateHash === duplicateAfterStateHash && duplicateBeforeOutboxHash === duplicateAfterOutboxHash, {
        rejectedBeforeMutation: duplicateProtected,
        beforeStateHash: duplicateBeforeStateHash,
        afterStateHash: duplicateAfterStateHash,
        beforeOutboxHash: duplicateBeforeOutboxHash,
        afterOutboxHash: duplicateAfterOutboxHash
      }),
      probeCheck('reaction-budget-keeps-primary', reactionEvidence.primaryCommit === 'kept', reactionEvidence.primaryCommit),
      probeCheck('reaction-dispatched-commit-kept', sameArray(reactionEvidence.dispatchedCommits, ['reaction.shock-a']), reactionEvidence.dispatchedCommits),
      probeCheck('reaction-wave-discards-undispatched', reactionPolicyExact && reactionEvidence.undispatchedPending.length === 0 && reactionEvidence.discardedPending.length === 2 && reactionEvidence.diagnosticTrace.durable === false, reactionEvidence),
      probeCheck('reaction-idempotency-consumed', reactionEvidence.retainedReactionIdempotencyKeys.length === 3 && submission.reaction.commandIdPolicy === 'derive-from-trigger-event-and-reaction-kind' && reactionEvidence.retryPolicy === REACTION_RETRY_POLICY, {
        retainedReactionIdempotencyKeys: reactionEvidence.retainedReactionIdempotencyKeys,
        commandIdPolicy: submission.reaction.commandIdPolicy,
        retryPolicy: reactionEvidence.retryPolicy
      })
    ];
    return {
      passed: checks.every(check => check.pass),
      checks,
      evidence: {
        staleCommit: { rejected: staleProtected, beforeStateHash, afterStateHash, beforeOutboxHash, afterOutboxHash },
        duplicateCommand: { rejectedBeforeMutation: duplicateProtected, beforeStateHash: duplicateBeforeStateHash, afterStateHash: duplicateAfterStateHash, beforeOutboxHash: duplicateBeforeOutboxHash, afterOutboxHash: duplicateAfterOutboxHash },
        reactionBudget: reactionEvidence
      }
    };
  }

  function runDesignProbes(submission) {
    return {
      normal: runNormalProbe(submission),
      edge: runEdgeProbe(submission),
      failure: runFailureProbe(submission)
    };
  }

  function zeroCriteria() {
    return DIMENSIONS.map(dimension => ({
      id: dimension.id,
      label: dimension.label,
      score: 0,
      maxScore: dimension.maxScore,
      minimumScore: DIMENSION_MINIMUMS[dimension.id],
      pass: false,
      checks: dimension.checks.map(([id, label, points]) => ({ id, label, points, earned: 0, pass: false }))
    }));
  }

  function zeroProbes() {
    const empty = () => ({ passed: false, checks: [], evidence: {} });
    return { normal: empty(), edge: empty(), failure: empty() };
  }

  function invalidAssessment(errors) {
    return deepFreeze({
      assessorVersion: ASSESSOR_VERSION,
      challengeId: CHALLENGE_ID,
      schemaValid: false,
      schemaErrors: [...errors],
      score: 0,
      maxScore: 100,
      passScore: PASS_SCORE,
      dimensionFloorsPassed: false,
      passed: false,
      criteria: zeroCriteria(),
      gates: { normal: false, edge: false, failure: false },
      probes: zeroProbes(),
      criticalViolations: [{ id: 'invalid-submission-schema', label: '제출 JSON이 고정 schema와 일치하지 않는다.' }]
    });
  }

  function assessCombatCapstone(rawSubmission) {
    const shapeErrors = validateSubmissionShape(rawSubmission);
    if (shapeErrors.length) return invalidAssessment(shapeErrors);
    const submission = deepClone(rawSubmission);
    if (JSON.stringify(submission).length > MAX_SUBMISSION_CHARS) {
      return invalidAssessment([`submission exceeds ${MAX_SUBMISSION_CHARS} characters.`]);
    }

    // 배점과 probe를 같은 canonical snapshot에서 계산해 관찰 중 입력 변경을 차단한다.
    const criteria = DIMENSIONS.map(dimension => {
      const checks = dimension.checks.map(([id, label, points, test]) => {
        const pass = test(submission);
        return { id, label, points, earned: pass ? points : 0, pass };
      });
      const score = checks.reduce((sum, check) => sum + check.earned, 0);
      const minimumScore = DIMENSION_MINIMUMS[dimension.id];
      return { id: dimension.id, label: dimension.label, score, maxScore: dimension.maxScore, minimumScore, pass: score >= minimumScore, checks };
    });
    const score = criteria.reduce((sum, criterion) => sum + criterion.score, 0);
    const dimensionFloorsPassed = criteria.every(criterion => criterion.pass);

    const criticalViolations = [];
    const critical = (condition, id, label) => { if (condition) criticalViolations.push({ id, label }); };
    critical(submission.resolve.mutatesState !== false, 'resolve-mutation', 'resolve 중 상태를 변경한다.');
    critical(submission.resolve.emitsEvents !== false, 'precommit-event', 'commit 전에 event를 발행한다.');
    critical(
      submission.resolve.maxTargets !== 3 || submission.resolve.duplicateTargetPolicy !== 'reject-request' || submission.resolve.limitAfterSort !== true,
      'unbounded-target-selection', '대상을 전체 정렬한 뒤 최대 3개로 제한하거나 중복 요청을 거부하지 않는다.'
    );
    critical(!sameSet(submission.commit.expectedVersionSubjects, EXPECTED_VERSION_SUBJECTS), 'missing-version-preconditions', 'mutation 대상 version 사전 조건이 완전하지 않다.');
    critical(submission.commit.duplicatePolicy !== 'reject-before-mutation', 'duplicate-command-policy', '중복 command를 mutation과 outbox 발행 전에 거부하지 않는다.');
    critical(
      submission.commit.scope !== 'cost-cooldown-all-primary-damage' || submission.commit.publish !== 'state-and-outbox-atomic' || submission.commit.versionConflict !== 'reject-entire-plan',
      'partial-primary-commit', 'primary plan의 전체 성공·전체 실패가 보장되지 않는다.'
    );
    critical(
      !sameArray(submission.resolve.targetOrder, TARGET_ORDER) || submission.resolve.rngMode !== 'keyed-per-target' || !sameArray(submission.resolve.rngKeyParts, RNG_KEY_PARTS),
      'order-dependent-rng', '컬렉션 순회나 RNG 소비 순서에 결과가 의존한다.'
    );
    critical(submission.reaction.triggerEvent !== 'DamageCommitted', 'wrong-reaction-trigger', 'Shock reaction이 확정된 피해 event에서 시작하지 않는다.');
    critical(submission.reaction.budgetFailure !== REACTION_FAILURE, 'reaction-rolls-back-primary', 'reaction 실패의 primary·dispatch 완료 commit 보존, 미실행 항목 폐기, 비영속 diagnostic 조합이 정확하지 않다.');
    critical(submission.reaction.causationId !== 'direct-trigger-event', 'indirect-causation', 'reaction이 직접 촉발 event 대신 먼 origin을 원인으로 기록한다.');
    critical(
      submission.status.applicationSource !== 'origin-skill-execution' ||
      submission.status.periodicSource !== 'shock-status-instance' ||
      submission.status.periodicCausation !== 'last-transition-event' ||
      submission.status.instanceIdPolicy !== 'derive-from-reaction-target-applied-tick',
      'broken-status-provenance', 'Status 적용·주기 피해의 source, causation 또는 instance 식별 정책이 끊겼다.'
    );
    critical(
      submission.status.clockDomain !== 'simulation_tick' ||
      !sameArray(submission.status.tickOffsets, [2, 4]) ||
      submission.status.expiresAtOffset !== 4 ||
      submission.status.sameTickOrder !== STATUS_EVENT_ORDER ||
      submission.status.finalTickCommit !== FINAL_TICK_COMMIT,
      'ambiguous-status-time', '마지막 주기 피해·tick·expire·remove의 시간 또는 원자적 순서가 완전하지 않다.'
    );

    const probes = runDesignProbes(submission);
    const gates = {
      normal: probes.normal.passed,
      edge: probes.edge.passed,
      failure: probes.failure.passed
    };
    const passed = score >= PASS_SCORE && dimensionFloorsPassed && Object.values(gates).every(Boolean) && criticalViolations.length === 0;
    return deepFreeze({
      assessorVersion: ASSESSOR_VERSION,
      challengeId: CHALLENGE_ID,
      schemaValid: true,
      schemaErrors: [],
      score,
      maxScore: 100,
      passScore: PASS_SCORE,
      dimensionFloorsPassed,
      passed,
      criteria,
      gates,
      probes,
      criticalViolations
    });
  }

  const CAPSTONE_CHALLENGE = deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    challengeId: CHALLENGE_ID,
    passScore: PASS_SCORE,
    assessorVersion: ASSESSOR_VERSION,
    dimensionMinimums: deepClone(DIMENSION_MINIMUMS),
    rubric: DIMENSIONS.map(({ id, label, maxScore }) => ({ id, label, maxScore, minimumScore: DIMENSION_MINIMUMS[id] })),
    requiredScenarios: deepClone(REQUIRED_SCENARIOS)
  });

  return deepFreeze({
    ASSESSOR_VERSION,
    SCHEMA_VERSION,
    CHALLENGE_ID,
    PASS_SCORE,
    MAX_SUBMISSION_CHARS,
    CAPSTONE_CHALLENGE,
    createStarterSubmission,
    assessCombatCapstone
  });
});
