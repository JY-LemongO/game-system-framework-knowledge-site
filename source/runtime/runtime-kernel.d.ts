export const RUNTIME_VERSION: '4.0.1-reference';
export const CONTRACT_SCHEMA_VERSION: 2;
export const REPLAY_FORMAT_VERSION: 2;
export const RNG_ALGORITHM_VERSION: string;
export const RNG_KEY_SCHEMA_VERSION: string;
export const CLOCK_DOMAIN: 'simulation_tick';
export const NUMERIC_POLICY_VERSION: string;
export const BASIS_POINTS: 10000;

export type NamespacedId = `${string}.${string}`;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type DeepPartial<T> = T extends object ? { [Key in keyof T]?: DeepPartial<T[Key]> } : T;

export type SourceRef =
  | { readonly kind: 'skill-execution' | 'status'; readonly definitionId: NamespacedId; readonly instanceId: NamespacedId }
  | { readonly kind: 'system'; readonly definitionId: NamespacedId; readonly instanceId?: NamespacedId };

export interface DomainErrorJson {
  name: 'DomainError';
  code: string;
  stage: string;
  message: string;
  retryable: boolean;
  details: Readonly<Record<string, JsonValue>>;
}
export class DomainError extends Error {
  readonly code: string;
  readonly stage: string;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, JsonValue>>;
  toJSON(): DomainErrorJson;
}

export interface CommandEnvelope<T extends JsonValue = JsonValue> {
  readonly schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  readonly commandId: NamespacedId;
  readonly actorId: NamespacedId;
  readonly requestedTick: number;
  readonly correlationId: NamespacedId;
  readonly causationId: NamespacedId | null;
  readonly dataVersion: string;
  readonly payload: T;
}
export interface DomainEventEnvelope<T extends JsonValue = JsonValue> {
  readonly schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  readonly eventId: NamespacedId;
  readonly type: string;
  readonly correlationId: NamespacedId;
  readonly causationId: NamespacedId;
  readonly occurredTick: number;
  readonly payload: T;
}
export interface CommandEnvelopeInput<T extends JsonValue = JsonValue> {
  readonly schemaVersion?: typeof CONTRACT_SCHEMA_VERSION;
  readonly commandId: NamespacedId;
  readonly actorId: NamespacedId;
  readonly requestedTick: number;
  readonly correlationId: NamespacedId;
  readonly causationId?: NamespacedId | null;
  readonly dataVersion?: string;
  readonly payload?: T;
}
export interface DomainEventEnvelopeInput<T extends JsonValue = JsonValue> {
  readonly schemaVersion?: typeof CONTRACT_SCHEMA_VERSION;
  readonly eventId: NamespacedId;
  readonly type: string;
  readonly correlationId: NamespacedId;
  readonly causationId: NamespacedId;
  readonly occurredTick: number;
  readonly payload?: T;
}

export interface ResourceSet { hp: number; maxHp: number; mana: number; maxMana: number; shield: number; maxShield: number }
export interface RuntimeEntity {
  id: NamespacedId;
  version: number;
  resources: ResourceSet;
  stats: Record<string, number>;
  cooldowns: Record<string, number>;
  statuses: Record<string, StatusInstance>;
}
export interface RuntimeState { tick: number; entities: Record<string, RuntimeEntity> }
export type RuntimeSnapshot = {
  readonly tick: number;
  readonly entities: Readonly<Record<string, Readonly<RuntimeEntity>>>;
};
export interface StatusInstance {
  instanceId: NamespacedId;
  definitionId: NamespacedId;
  actorId: NamespacedId;
  applicationSourceId: NamespacedId;
  applicationSourceRef: SourceRef;
  applicationCausationId: NamespacedId;
  sourceId: NamespacedId;
  sourceRef: SourceRef;
  targetId: NamespacedId;
  correlationId: NamespacedId;
  lastTransitionEventId: NamespacedId;
  dataVersion: string;
  appliedTick: number;
  nextTickAt: number;
  expireTick: number;
  intervalTicks: number;
  rawTickDamage: number;
  maxCatchUpTicks: number;
}

export interface VersionPrecondition {
  readonly entityId: NamespacedId;
  readonly expectedVersion: number;
}
export type CommitOperation =
  | { readonly order: number; readonly kind: 'resource.delta'; readonly entityId: NamespacedId; readonly resource: string; readonly delta: number; readonly key: string }
  | { readonly order: number; readonly kind: 'cooldown.set'; readonly entityId: NamespacedId; readonly definitionId: NamespacedId; readonly readyTick: number; readonly key: string }
  | { readonly order: number; readonly kind: 'status.add'; readonly entityId: NamespacedId; readonly status: StatusInstance; readonly key: string }
  | { readonly order: number; readonly kind: 'status.patch'; readonly entityId: NamespacedId; readonly instanceId: NamespacedId; readonly patch: { readonly nextTickAt: number; readonly lastTransitionEventId: NamespacedId }; readonly key: string }
  | { readonly order: number; readonly kind: 'status.remove'; readonly entityId: NamespacedId; readonly instanceId: NamespacedId; readonly key: string };
export interface EventBlueprint {
  readonly type: RuntimeEventType;
  readonly payload: JsonValue;
}
export type RuntimeEventType =
  | 'SkillCommitted'
  | 'DamageCommitted'
  | 'DamageMissed'
  | 'StatusApplied'
  | 'StatusTicked'
  | 'StatusExpired'
  | 'EntityDefeated'
  | 'ExternalStateChanged'
  | 'ExternalCooldownChanged';
export interface CommitPlan {
  readonly schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  readonly planId: NamespacedId;
  readonly commandId: NamespacedId;
  readonly commitTick: number;
  readonly preconditions: ReadonlyArray<VersionPrecondition>;
  readonly operations: ReadonlyArray<CommitOperation>;
  readonly eventBlueprints: ReadonlyArray<EventBlueprint>;
}
export interface CommitReceipt {
  readonly planId: NamespacedId;
  readonly state: RuntimeState;
  readonly events: ReadonlyArray<DomainEventEnvelope>;
}

export interface ScenarioInput {
  rootSeed: number;
  tick: number;
  dataVersion: string;
  definitionVersion: string;
  formulaVersion: string;
  caster: { id: NamespacedId; hp: number; maxHp: number; mana: number; maxMana: number; spellPower: number };
  target: { id: NamespacedId; hp: number; maxHp: number; shield: number; maxShield: number; fireResistanceBps: number };
  skill: { definitionId: NamespacedId; baseDamage: number; coefficientBps: number; hitChanceBps: number; critChanceBps: number; critMultiplierBps: number; manaCost: number; cooldownTicks: number };
  burn: { definitionId: NamespacedId; ratioBps: number; durationTicks: number; intervalTicks: number; maxCatchUpTicks: number };
  simulateStatusTicks: boolean;
}
export type ScenarioInputPatch = DeepPartial<ScenarioInput>;

export type ExactDamageScalar = {
  readonly numerator: string;
  readonly denominator: string;
};

export type DamageOutcome = {
  actorId: NamespacedId;
  sourceId: NamespacedId;
  sourceRef: SourceRef;
  targetId: NamespacedId;
  skillDefinitionId: NamespacedId;
  damageType: 'fire';
  hitOutcome: 'Hit' | 'Miss';
  critical: boolean;
  exactRawDamage: ExactDamageScalar;
  rawDamage: number;
  resistanceBps: number;
  resolvedDamage: number;
  shieldAbsorbed: number;
  finalHpDamage: number;
  overkill: number;
  targetHpAfter: number;
  targetShieldAfter: number;
  burn: {
    definitionId: NamespacedId;
    rawTickDamage: number;
    durationTicks: number;
    intervalTicks: number;
    maxCatchUpTicks: number;
    dataVersion: string;
    applyWhenTargetAlive: boolean;
  };
};

export type PeriodicDamageOutcome = CommittedDamageOutcome & {
  damageType: 'fire';
  hitOutcome: 'Hit';
  statusInstanceId: NamespacedId;
  statusDefinitionId: NamespacedId;
  periodic: true;
  tickAt: number;
  triggerEventId: NamespacedId;
};

export type PrimaryDamageCommittedOutcome =
  Omit<DamageOutcome, 'hitOutcome'> & { readonly hitOutcome: 'Hit' };
export type DamageMissedOutcome =
  Omit<DamageOutcome, 'hitOutcome' | 'critical'> & {
    readonly hitOutcome: 'Miss';
    readonly critical: false;
  };

export type SkillCommittedPayload = Readonly<{
  actorId: NamespacedId;
  sourceId: NamespacedId;
  sourceRef: SourceRef;
  targetId: NamespacedId;
  skillDefinitionId: NamespacedId;
  manaSpent: number;
  cooldownReadyTick: number;
}>;
export type SkillCommittedEvent =
  DomainEventEnvelope<SkillCommittedPayload> &
  { readonly type: 'SkillCommitted' };

export type DamageCommittedEvent =
  DomainEventEnvelope<PrimaryDamageCommittedOutcome | PeriodicDamageOutcome> &
  { readonly type: 'DamageCommitted' };
export type DamageMissedEvent =
  DomainEventEnvelope<DamageMissedOutcome> &
  { readonly type: 'DamageMissed' };

export type DamageCalculatedTracePayload =
  | Readonly<{
      phase: 'primary';
      formulaVersion: string;
      baseDamage: number;
      scalingDamageProjection: number;
      scalingDamageExact: ExactDamageScalar;
      formulaDamageProjection: number;
      formulaDamageExact: ExactDamageScalar;
      criticalMultiplierBps: number;
      rawDamage: number;
      rawDamageExact: ExactDamageScalar;
      resistanceBps: number;
      resolvedDamage: number;
    }>
  | Readonly<{
      phase: 'periodic';
      statusInstanceId: NamespacedId;
      rawDamage: number;
      resistanceBps: number;
      resolvedDamage: number;
    }>;

export type CommittedDamageOutcome = {
  actorId: NamespacedId;
  sourceId: NamespacedId;
  sourceRef: SourceRef;
  targetId: NamespacedId;
  damageType: string;
  hitOutcome: 'Hit' | 'Miss' | 'Blocked' | 'Immune' | 'Rejected';
  exactRawDamage: ExactDamageScalar;
  rawDamage: number;
  resistanceBps: number;
  resolvedDamage: number;
  shieldAbsorbed: number;
  finalHpDamage: number;
  overkill: number;
  targetHpAfter: number;
  targetShieldAfter: number;
};

export type FireballCommandPayload = {
  targetId: NamespacedId;
  skillDefinitionId: NamespacedId;
};

export class KeyedRandom {
  constructor(rootSeed: number);
  sample(key: JsonValue): number;
  sampleBps(key: JsonValue): number;
}
export class TraceRecorder {
  constructor(header?: Record<string, JsonValue>);
  record(stage: string, tick: number, payload?: Record<string, JsonValue>): Readonly<Record<string, JsonValue>>;
  export(): ReadonlyArray<Readonly<Record<string, JsonValue>>>;
  hash(): string;
}
export class StateStore {
  constructor(initialState: RuntimeState & { processedCommands?: ReadonlyArray<NamespacedId>; outbox?: ReadonlyArray<DomainEventEnvelope> });
  readonly tick: number;
  readonly outbox: ReadonlyArray<Readonly<DomainEventEnvelope>>;
  getEntity(entityId: NamespacedId): Readonly<RuntimeEntity>;
  snapshot(entityIds: NamespacedId[]): Readonly<RuntimeSnapshot>;
  exportState(): Readonly<RuntimeState>;
  commit(command: CommandEnvelope, plan: CommitPlan, trace?: TraceRecorder | null): Readonly<CommitReceipt>;
}

export interface Reaction {
  reactionId: NamespacedId;
  idempotencyKey?: NamespacedId;
  kind: string;
  priority?: number;
  stableOrderKey?: string;
  depth?: number;
  budgetCost?: number;
  payload?: JsonValue;
}
export type ApplyStatusReactionPayload = {
  actorId: NamespacedId;
  sourceId: NamespacedId;
  sourceRef: SourceRef;
  targetId: NamespacedId;
  definitionId: NamespacedId;
  rawTickDamage: number;
  durationTicks: number;
  intervalTicks: number;
  maxCatchUpTicks: number;
  correlationId: NamespacedId;
  causationId: NamespacedId;
  dataVersion: string;
};
export type ApplyStatusReaction = Omit<
  Reaction,
  'idempotencyKey' | 'kind' | 'priority' | 'stableOrderKey' | 'depth' |
    'budgetCost' | 'payload'
> & {
  reactionId: NamespacedId;
  idempotencyKey: NamespacedId;
  kind: 'apply-status';
  priority: number;
  stableOrderKey: string;
  depth: number;
  budgetCost: number;
  payload: ApplyStatusReactionPayload;
};
export interface ReactionBudget {
  maxDepth?: number;
  maxReactions?: number;
  maxBudget?: number;
}
export class ReactionQueue<TReaction extends Reaction = Reaction> {
  constructor(options?: ReactionBudget);
  readonly maxDepth: number;
  readonly maxReactions: number;
  readonly maxBudget: number;
  readonly pending: ReadonlyArray<Readonly<Required<TReaction>>>;
  enqueue(reaction: TReaction): boolean;
  drain<TResult>(handler: (reaction: Readonly<Required<TReaction>>) => TResult, trace?: TraceRecorder | null, tick?: number, budget?: ReactionBudget | null): Readonly<ReactionDrainResult<TReaction, TResult>>;
}
export type ReactionDrainResult<TReaction extends Reaction, TResult> = {
  readonly executed: ReadonlyArray<Readonly<{
    reaction: Readonly<Required<TReaction>>;
    result: TResult;
  }>>;
  readonly rejected: ReadonlyArray<never>;
  readonly budgetUsed: number;
  readonly exhausted: false;
};

export type ContextFingerprintEntry =
  | { readonly presence: 'missing' }
  | { readonly presence: 'present'; readonly value: JsonValue };
export interface ContextFingerprint {
  readonly dependencies: ReadonlyArray<string>;
  readonly values: Readonly<Record<string, ContextFingerprintEntry>>;
  readonly hash: string;
}
export class ContextualStatCache {
  constructor(options?: { maxEntries?: number });
  evaluate<T extends JsonValue>(query: { entityId: NamespacedId; statId: NamespacedId; ownerVersion: number; dependencies?: string[]; context?: Record<string, JsonValue>; compute: () => T }): Readonly<{ cacheHit: boolean; cacheKey: string; fingerprint: ContextFingerprint; value: T }>;
  invalidateEntity(entityId: NamespacedId): number;
  clear(): number;
  stats(): Readonly<{ size: number; maxEntries: number; hits: number; misses: number; evictions: number }>;
}

export class SchemaMigrationRegistry {
  constructor(options: { currentVersion: number; minimumSupportedVersion?: number });
  register(step: { migrationId: NamespacedId; fromVersion: number; toVersion: number; migrate: (document: Readonly<Record<string, JsonValue>>) => Record<string, JsonValue> }): this;
  migrate(document: Record<string, JsonValue> & { schemaVersion: number }, targetVersion?: number): Readonly<{ sourceVersion: number; targetVersion: number; document: Record<string, JsonValue>; appliedMigrations: ReadonlyArray<Record<string, JsonValue>> }>;
}

export function canonicalStringify(value: unknown): string;
export function hashHex(value: unknown): string;
export function hash32(...parts: unknown[]): number;
export function multiplyBps(value: number, basisPoints: number): number;
export function createSourceRef(value: SourceRef): Readonly<SourceRef>;
export function createContextFingerprint(context?: Record<string, JsonValue>, dependencies?: string[]): Readonly<ContextFingerprint>;
export function createCommandEnvelope<T extends JsonValue>(value: CommandEnvelopeInput<T> & { readonly payload: T }): Readonly<CommandEnvelope<T>>;
export function createCommandEnvelope(value: CommandEnvelopeInput<JsonValue> & { readonly payload?: undefined }): Readonly<CommandEnvelope<Record<string, never>>>;
export function createCommandEnvelope(value: CommandEnvelopeInput<JsonValue>): Readonly<CommandEnvelope<JsonValue>>;
export function createDomainEventEnvelope<T extends JsonValue>(value: DomainEventEnvelopeInput<T> & { readonly payload: T }): Readonly<DomainEventEnvelope<T>>;
export function createDomainEventEnvelope(value: DomainEventEnvelopeInput<JsonValue> & { readonly payload?: undefined }): Readonly<DomainEventEnvelope<Record<string, never>>>;
export function createDomainEventEnvelope(value: DomainEventEnvelopeInput<JsonValue>): Readonly<DomainEventEnvelope<JsonValue>>;
export function parseCommandEnvelope(value: unknown): Readonly<CommandEnvelope<JsonValue>>;
export function parseDomainEventEnvelope(value: unknown): Readonly<DomainEventEnvelope<JsonValue>>;
export function defaultScenarioInput(): ScenarioInput;
export function normalizeScenarioInput(input?: ScenarioInputPatch): Readonly<ScenarioInput>;
export function createInitialState(input: ScenarioInput): Readonly<RuntimeState>;
export function createFireballCommand(input: ScenarioInput): Readonly<CommandEnvelope<FireballCommandPayload>>;
export function resolveDamageAgainstTarget(args: { actorId: NamespacedId; sourceId: NamespacedId; sourceRef: SourceRef; target: Readonly<RuntimeEntity>; damageType: string; rawDamage: number; exactRawDamage?: ExactDamageScalar; hitOutcome?: CommittedDamageOutcome['hitOutcome'] }): Readonly<CommittedDamageOutcome>;
export function resolveFireball(args: { snapshot: RuntimeSnapshot; command: CommandEnvelope<FireballCommandPayload>; input: ScenarioInput; rng: KeyedRandom; trace?: TraceRecorder | null }): Readonly<{ decisions: JsonValue; outcome: DamageOutcome; plan: CommitPlan }>;
export function enqueueReactions(events: ReadonlyArray<DomainEventEnvelope>, queue: ReactionQueue, trace?: TraceRecorder | null): void;
export interface ReactionNotApplicableResult {
  readonly outcome: 'NotApplicable';
  readonly reason: 'TARGET_NOT_ALIVE';
  readonly reactionId: NamespacedId;
  readonly targetId: NamespacedId;
  readonly stateChanged: false;
  readonly events: ReadonlyArray<never>;
}
/** Must be invoked synchronously with the reaction object supplied to a ReactionQueue.drain handler. */
export function applyStatusReaction(store: StateStore, reaction: Readonly<ApplyStatusReaction>, trace?: TraceRecorder | null): Readonly<CommitReceipt> | Readonly<ReactionNotApplicableResult>;
export function advanceStatuses(store: StateStore, targetTick: number, trace?: TraceRecorder | null): Readonly<{ targetTick: number; commits: ReadonlyArray<Record<string, JsonValue>>; tickCount: number; catchUpLimited: boolean }>;
export function executeImpact(input: ScenarioInput, trace?: TraceRecorder | null): { store: StateStore; command: Readonly<CommandEnvelope<FireballCommandPayload>>; resolution: Readonly<{ decisions: JsonValue; outcome: DamageOutcome; plan: CommitPlan }>; commit: Readonly<CommitReceipt> };
export function runFireballScenario(input?: ScenarioInputPatch): Readonly<Record<string, any>>;
export function verifyReplay(input?: ScenarioInputPatch): Readonly<{ match: boolean; traceMatch: boolean; finalStateMatch: boolean; first: any; second: any }>;
export function demonstrateDuplicateCommand(input?: ScenarioInputPatch): Readonly<Record<string, any>>;
export function demonstrateVersionConflict(input?: ScenarioInputPatch): Readonly<Record<string, any>>;
export function demonstrateAtomicRollback(input?: ScenarioInputPatch): Readonly<Record<string, any>>;
