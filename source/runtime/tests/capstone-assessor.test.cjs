'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const C = require('../capstone-assessor.js');
const PASSING = require(path.join(__dirname, 'fixtures', 'capstone-passing-submission-v1.json'));
const SUBMISSION_SCHEMA = require(path.join(__dirname, '..', '..', 'contracts', 'combat-capstone-submission.schema.json'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const clone = value => JSON.parse(JSON.stringify(value));

function assertMatchesCandidateSchema(value, schema, label = '$') {
  if (Object.hasOwn(schema, 'const')) assert.deepEqual(value, schema.const, label);
  if (Object.hasOwn(schema, 'enum')) assert.equal(schema.enum.includes(value), true, `${label}: enum`);
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined) assert.equal(value.length <= schema.maxItems, true, `${label}: maxItems`);
    if (schema.uniqueItems) assert.equal(new Set(value).size, value.length, `${label}: uniqueItems`);
    for (const [index, item] of value.entries()) assertMatchesCandidateSchema(item, schema.items, `${label}[${index}]`);
    return;
  }
  if (value && typeof value === 'object') {
    assert.deepEqual(Object.keys(value).sort(), [...schema.required].sort(), `${label}: required keys`);
    for (const [key, item] of Object.entries(value)) assertMatchesCandidateSchema(item, schema.properties[key], `${label}.${key}`);
  }
}

test('rubric은 100점·80점 합격선·차원별 80% 최소점을 공개한다', () => {
  assert.equal(C.CAPSTONE_CHALLENGE.rubric.reduce((sum, item) => sum + item.maxScore, 0), 100);
  assert.equal(C.PASS_SCORE, 80);
  assert.equal(C.CAPSTONE_CHALLENGE.passScore, 80);
  for (const item of C.CAPSTONE_CHALLENGE.rubric) {
    assert.equal(item.minimumScore, Math.ceil(item.maxScore * 0.8), item.id);
  }
});

test('브라우저 공개 API는 완성 답안을 생성하지 않는다', () => {
  assert.equal(Object.hasOwn(C, 'createReferenceSubmission'), false);
  assert.deepEqual(Object.keys(C).sort(), [
    'ASSESSOR_VERSION', 'CAPSTONE_CHALLENGE', 'CHALLENGE_ID', 'MAX_SUBMISSION_CHARS',
    'PASS_SCORE', 'SCHEMA_VERSION', 'assessCombatCapstone', 'createStarterSubmission'
  ].sort());
});

test('starter와 passing fixture는 공개 candidate schema와 정확히 같은 shape·enum을 사용한다', () => {
  assertMatchesCandidateSchema(C.createStarterSubmission(), SUBMISSION_SCHEMA);
  assertMatchesCandidateSchema(PASSING, SUBMISSION_SCHEMA);
});

test('독립 fixture는 100점과 정상·경계·실패 실행 probe를 모두 통과한다', () => {
  const result = C.assessCombatCapstone(clone(PASSING));
  assert.equal(result.schemaValid, true);
  assert.equal(result.score, 100);
  assert.equal(result.dimensionFloorsPassed, true);
  assert.equal(result.passed, true);
  assert.deepEqual(result.gates, { normal: true, edge: true, failure: true });
  assert.deepEqual(result.criticalViolations, []);
  assert.equal(Object.values(result.probes).every(probe => probe.passed), true);
});

test('probe는 정렬·permutation·stale rollback·reaction wave의 계산 증거를 반환한다', () => {
  const result = C.assessCombatCapstone(clone(PASSING));
  assert.deepEqual(result.probes.normal.evidence.orderedTargetIds, [
    'entity.target-a', 'entity.target-b', 'entity.target-c'
  ]);
  assert.equal(result.probes.edge.evidence.firstPermutationHash, result.probes.edge.evidence.secondPermutationHash);
  assert.deepEqual(result.probes.edge.evidence.selectedTargetIds, [
    'entity.target-a', 'entity.target-b', 'entity.target-c'
  ]);
  const stale = result.probes.failure.evidence.staleCommit;
  assert.equal(stale.rejected, true);
  assert.equal(stale.beforeStateHash, stale.afterStateHash);
  assert.equal(stale.beforeOutboxHash, stale.afterOutboxHash);
  const reaction = result.probes.failure.evidence.reactionBudget;
  assert.equal(reaction.primaryCommit, 'kept');
  assert.deepEqual(reaction.dispatchedCommits, ['reaction.shock-a']);
  assert.deepEqual(reaction.undispatchedPending, []);
  assert.equal(reaction.diagnosticTrace.durable, false);
  assert.deepEqual(reaction.retainedReactionIdempotencyKeys, [
    'idempotency.shock-a', 'idempotency.shock-b', 'idempotency.shock-c'
  ]);
  assert.equal(reaction.diagnosticTrace.code, 'REACTION_WAVE_LIMIT_EXCEEDED');
  assert.equal(reaction.diagnosticTrace.reason, 'BUDGET_EXCEEDED');
});

test('Status probe는 적용→첫 tick→다음 tick의 직접 transition 인과와 마지막 원자 commit을 보인다', () => {
  const result = C.assessCombatCapstone(clone(PASSING));
  const evidence = result.probes.edge.evidence;
  assert.deepEqual(evidence.statusCausation, {
    damageEventId: 'event.damage-shielded',
    applyCommandCausationId: 'event.damage-shielded',
    statusInstanceApplicationCausationId: 'event.damage-shielded',
    statusAppliedEventCausationId: 'command.apply-shock',
    firstTickCommandCausationId: 'event.status-applied',
    finalTickCommandCausationId: 'event.status-ticked-42'
  });
  assert.match(evidence.finalTickCommitHash, /^fnv1a32:[0-9a-f]{8}$/);
  const finalCheck = result.probes.edge.checks.find(check => check.id === 'final-tick-expire-atomic');
  assert.equal(finalCheck.pass, true);
  assert.deepEqual(finalCheck.evidence.events, ['DamageCommitted', 'StatusTicked', 'StatusExpired']);
  assert.deepEqual(finalCheck.evidence.operations, ['resource.delta:damage-if-nonzero', 'status.remove']);
});

test('starter는 유효한 schema지만 미완성 상태로 불합격한다', () => {
  const result = C.assessCombatCapstone(C.createStarterSubmission());
  assert.equal(result.schemaValid, true);
  assert.equal(result.score, 0);
  assert.equal(result.passed, false);
  assert.equal(result.dimensionFloorsPassed, false);
  assert.equal(Object.values(result.gates).every(value => value === false), true);
  assert.equal(result.criticalViolations.length >= 1, true);
});

test('assessor는 제출물을 바꾸지 않고 깊게 동결된 결과를 반환한다', () => {
  const submission = clone(PASSING);
  const before = JSON.stringify(submission);
  const result = C.assessCombatCapstone(submission);
  assert.equal(JSON.stringify(submission), before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.criteria[0].checks[0]), true);
  assert.equal(Object.isFrozen(result.probes.failure.evidence.reactionBudget), true);
});

test('unknown field·accessor·enum 밖 token·중복/범위 밖 배열은 고정 schema에서 거부한다', () => {
  const extra = { ...clone(PASSING), unexpected: true };
  assert.equal(C.assessCombatCapstone(extra).schemaValid, false);

  const accessor = clone(PASSING);
  Object.defineProperty(accessor, 'challengeId', { enumerable: true, get: () => C.CHALLENGE_ID });
  assert.equal(C.assessCombatCapstone(accessor).schemaValid, false);

  const duplicateArray = clone(PASSING);
  duplicateArray.reaction.limits.push('maxDepth');
  assert.equal(C.assessCombatCapstone(duplicateArray).schemaValid, false);

  const unknownToken = clone(PASSING);
  unknownToken.ownership.orchestrationOwner = 'Bogus';
  assert.equal(C.assessCombatCapstone(unknownToken).schemaValid, false);

  const duplicateTicks = clone(PASSING);
  duplicateTicks.status.tickOffsets = [2, 2, 4];
  assert.equal(C.assessCombatCapstone(duplicateTicks).schemaValid, false);

  const negativeTick = clone(PASSING);
  negativeTick.status.tickOffsets = [-1, 2];
  assert.equal(C.assessCombatCapstone(negativeTick).schemaValid, false);

  const unknownScenario = clone(PASSING);
  unknownScenario.scenarios.normal = ['bogus'];
  assert.equal(C.assessCombatCapstone(unknownScenario).schemaValid, false);
});

test('sparse·extra property·index accessor 배열은 JSON data shape가 아니므로 실행 없이 거부한다', () => {
  const sparseTicks = clone(PASSING);
  sparseTicks.status.tickOffsets = new Array(2);
  sparseTicks.status.tickOffsets[1] = 4;
  assert.equal(C.assessCombatCapstone(sparseTicks).schemaValid, false);

  const extraTicks = clone(PASSING);
  extraTicks.status.tickOffsets.extra = 'not-json-array-data';
  assert.equal(C.assessCombatCapstone(extraTicks).schemaValid, false);

  let tickGetterCalls = 0;
  const accessorTicks = clone(PASSING);
  Object.defineProperty(accessorTicks.status.tickOffsets, '0', {
    enumerable: true,
    configurable: true,
    get() {
      tickGetterCalls += 1;
      return 2;
    }
  });
  assert.equal(C.assessCombatCapstone(accessorTicks).schemaValid, false);
  assert.equal(tickGetterCalls, 0);

  let tokenGetterCalls = 0;
  const accessorTokens = clone(PASSING);
  Object.defineProperty(accessorTokens.resolve.targetOrder, '0', {
    enumerable: true,
    configurable: true,
    get() {
      tokenGetterCalls += 1;
      return 'distanceBucket:asc';
    }
  });
  assert.equal(C.assessCombatCapstone(accessorTokens).schemaValid, false);
  assert.equal(tokenGetterCalls, 0);

  const symbolTokens = clone(PASSING);
  symbolTokens.resolve.targetOrder[Symbol('extra')] = 'not-json-array-data';
  assert.equal(C.assessCombatCapstone(symbolTokens).schemaValid, false);
});

test('expectedVersionSubjects는 집합 계약이므로 역순이어도 통과한다', () => {
  const submission = clone(PASSING);
  submission.commit.expectedVersionSubjects.reverse();
  const result = C.assessCombatCapstone(submission);
  assert.equal(result.score, 100);
  assert.equal(result.gates.failure, true);
  assert.equal(result.passed, true);
});

test('잘못된 소유권 문자열은 점수가 높아도 normal gate에서 통과하지 못한다', () => {
  const submission = clone(PASSING);
  submission.ownership.commitOwner = 'Combat';
  const result = C.assessCombatCapstone(submission);
  assert.equal(result.score, 97);
  assert.equal(result.criteria.find(item => item.id === 'ownership').pass, true);
  assert.equal(result.gates.normal, false);
  assert.equal(result.passed, false);
});

test('차원 최소점 미달은 총점 80 이상이어도 불합격한다', () => {
  const submission = clone(PASSING);
  submission.replay.envelopeFields = [];
  const result = C.assessCombatCapstone(submission);
  assert.equal(result.score, 95);
  assert.equal(result.criteria.find(item => item.id === 'replay').score, 5);
  assert.equal(result.dimensionFloorsPassed, false);
  assert.equal(result.criticalViolations.length, 0);
  assert.equal(result.passed, false);
});

test('reaction 재시도 정책은 동일 business key와 reaction별 disposition을 요구한다', () => {
  const submission = clone(PASSING);
  submission.reaction.retryPolicy = 'implicit-retry-same-command';
  const result = C.assessCombatCapstone(submission);
  assert.equal(result.score, 97);
  assert.equal(result.gates.failure, false);
  assert.deepEqual(result.probes.failure.evidence.reactionBudget.retainedReactionIdempotencyKeys, [
    'idempotency.shock-a', 'idempotency.shock-b', 'idempotency.shock-c'
  ]);
  assert.equal(result.probes.failure.evidence.reactionBudget.retryPolicy, 'implicit-retry-same-command');
  assert.equal(result.passed, false);
});

test('중복 command·reaction 정렬·permutation 선언의 단일 오답도 최종 PASS하지 않는다', () => {
  const cases = [
    ['duplicate-command-policy', submission => { submission.commit.duplicatePolicy = 'allow-repeat'; }, 'failure'],
    [null, submission => { submission.reaction.sortOrder = ['insertion-order']; }, 'normal'],
    [null, submission => { submission.replay.targetPermutationInvariant = false; }, 'edge']
  ];
  for (const [criticalId, mutate, failedGate] of cases) {
    const submission = clone(PASSING);
    mutate(submission);
    const result = C.assessCombatCapstone(submission);
    assert.equal(result.passed, false, failedGate);
    assert.equal(result.gates[failedGate], false, failedGate);
    if (criticalId) assert.equal(result.criticalViolations.some(item => item.id === criticalId), true, criticalId);
  }
});

test('시나리오 선언 누락은 rubric 100점이어도 계산 gate에서 불합격한다', () => {
  const submission = clone(PASSING);
  submission.scenarios.edge = submission.scenarios.edge.filter(item => item !== 'full-shield-hit-applies-shock');
  const result = C.assessCombatCapstone(submission);
  assert.equal(result.score, 100);
  assert.equal(result.probes.edge.checks.find(check => check.id === 'declared-edge-evidence').pass, false);
  assert.equal(result.gates.edge, false);
  assert.equal(result.passed, false);
});

test('대상 상한·전체 정렬 후 제한·중복 정책 위반은 실제 edge probe에서 드러난다', () => {
  const cases = [
    submission => { submission.resolve.maxTargets = 4; },
    submission => { submission.resolve.limitAfterSort = false; },
    submission => { submission.resolve.duplicateTargetPolicy = 'deduplicate-first'; }
  ];
  for (const mutate of cases) {
    const submission = clone(PASSING);
    mutate(submission);
    const result = C.assessCombatCapstone(submission);
    assert.equal(result.passed, false);
    assert.equal(result.gates.edge, false);
    assert.equal(result.criticalViolations.some(item => item.id === 'unbounded-target-selection'), true);
  }
});

test('각 critical 계약 위반은 점수와 무관하게 모두 불합격한다', () => {
  const cases = [
    ['resolve-mutation', submission => { submission.resolve.mutatesState = true; }],
    ['precommit-event', submission => { submission.resolve.emitsEvents = true; }],
    ['unbounded-target-selection', submission => { submission.resolve.maxTargets = null; }],
    ['missing-version-preconditions', submission => { submission.commit.expectedVersionSubjects = ['caster']; }],
    ['duplicate-command-policy', submission => { submission.commit.duplicatePolicy = 'allow-repeat'; }],
    ['partial-primary-commit', submission => { submission.commit.publish = 'state-first-outbox-later'; }],
    ['order-dependent-rng', submission => { submission.resolve.rngMode = 'sequential-consumption'; }],
    ['wrong-reaction-trigger', submission => { submission.reaction.triggerEvent = 'DamageResolved'; }],
    ['reaction-rolls-back-primary', submission => { submission.reaction.budgetFailure = 'rollback-primary'; }],
    ['indirect-causation', submission => { submission.reaction.causationId = 'origin-command'; }],
    ['broken-status-provenance', submission => { submission.status.periodicCausation = 'root-command'; }],
    ['ambiguous-status-time', submission => { submission.status.finalTickCommit = 'damage-only-then-expire-later'; }]
  ];
  for (const [criticalId, mutate] of cases) {
    const submission = clone(PASSING);
    mutate(submission);
    const result = C.assessCombatCapstone(submission);
    assert.equal(result.passed, false, criticalId);
    assert.equal(result.criticalViolations.some(item => item.id === criticalId), true, criticalId);
  }
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
  console.log(`\n${passed}/${tests.length} capstone tests passed (${durationMs} ms)`);
  if (passed !== tests.length) process.exitCode = 1;
})();
