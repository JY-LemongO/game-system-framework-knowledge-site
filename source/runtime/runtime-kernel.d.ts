export const RUNTIME_VERSION: '3.4.0-reference';
export const CONTRACT_SCHEMA_VERSION: 1;
export const REPLAY_FORMAT_VERSION: 1;
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
  cooldowns: Record<NamespacedId, number>;
  statuses: Record<NamespacedId, StatusInstance>;
}
export interface RuntimeState { tick: number; entities: Record<NamespacedId, RuntimeEntity> }
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
  readonly type: string;
  readonly payload: JsonValue;
}
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

export interface DamageOutcome {
  actorId: NamespacedId;
  sourceId: NamespacedId;
  sourceRef: SourceRef;
  targetId: NamespacedId;
  skillDefinitionId: NamespacedId;
  damageType: 'fire';
  hitOutcome: 'Hit' | 'Miss' | 'Blocked' | 'Immune' | 'Rejected';
  critical: boolean;
  rawDamage: number;
  resistanceBps: number;
  resolvedDamage: number;
  shieldAbsorbed: number;
  finalHpDamage: number;
  overkill: number;
  targetHpAfter: number;
  targetShieldAfter: number;
  burn: { definitionId: NamespacedId; rawTickDamage: number; durationTicks: number; intervalTicks: number; applyWhenTargetAlive: boolean };
}

export interface CommittedDamageOutcome {
  actorId: NamespacedId;
  sourceId: NamespacedId;
  sourceRef: SourceRef;
  targetId: NamespacedId;
  damageType: string;
  hitOutcome: 'Hit' | 'Miss' | 'Blocked' | 'Immune' | 'Rejected';
  rawDamage: number;
  resistanceBps: number;
  resolvedDamage: number;
  shieldAbsorbed: number;
  finalHpDamage: number;
  overkill: number;
  targetHpAfter: number;
  targetShieldAfter: number;
}

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
  snapshot(entityIds: NamespacedId[]): Readonly<{ tick: number; entities: Record<NamespacedId, RuntimeEntity> }>;
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
export interface ReactionBudget {
  maxDepth?: number;
  maxReactions?: number;
  maxBudget?: number;
}
export class ReactionQueue {
  constructor(options?: ReactionBudget);
  readonly maxDepth: number;
  readonly maxReactions: number;
  readonly maxBudget: number;
  readonly pending: ReadonlyArray<Readonly<Required<Reaction>>>;
  enqueue(reaction: Reaction): boolean;
  drain(handler: (reaction: Readonly<Required<Reaction>>) => JsonValue, trace?: TraceRecorder | null, tick?: number, budget?: ReactionBudget | null): Readonly<Record<string, JsonValue>>;
}

export class ContextualStatCache {
  constructor(options?: { maxEntries?: number });
  evaluate<T extends JsonValue>(query: { entityId: NamespacedId; statId: NamespacedId; ownerVersion: number; dependencies?: string[]; context?: Record<string, JsonValue>; compute: () => T }): Readonly<{ cacheHit: boolean; cacheKey: string; fingerprint: JsonValue; value: T }>;
  invalidateEntity(entityId: NamespacedId): number;
  clear(): number;
  stats(): Readonly<{ size: number; maxEntries: number; hits: number; misses: number; evictions: number }>;
}

export class SchemaMigrationRegistry {
  constructor(options: { currentVersion: number; minimumSupportedVersion?: number });
  register(step: { migrationId: NamespacedId; fromVersion: number; toVersion: number; migrate: (document: Readonly<Record<string, JsonValue>>) => Record<string, JsonValue> }): this;
  migrate(document: Record<string, JsonValue> & { schemaVersion: number }, targetVersion?: number): Readonly<{ sourceVersion: number; targetVersion: number; document: Record<string, JsonValue>; appliedMigrations: ReadonlyArray<Record<string, JsonValue>> }>;
}

export function canonicalStringify(value: JsonValue): string;
export function hashHex(value: JsonValue | string): string;
export function hash32(...parts: JsonValue[]): number;
export function multiplyBps(value: number, basisPoints: number): number;
export function createSourceRef(value: SourceRef): Readonly<SourceRef>;
export function createContextFingerprint(context?: Record<string, JsonValue>, dependencies?: string[]): Readonly<Record<string, JsonValue>>;
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
export function createFireballCommand(input: ScenarioInput): Readonly<CommandEnvelope>;
export function resolveDamageAgainstTarget(args: { actorId: NamespacedId; sourceId: NamespacedId; sourceRef: SourceRef; target: RuntimeEntity; damageType: string; rawDamage: number; hitOutcome?: DamageOutcome['hitOutcome'] }): Readonly<CommittedDamageOutcome>;
export function resolveFireball(args: { snapshot: JsonValue; command: CommandEnvelope; input: ScenarioInput; rng: KeyedRandom; trace?: TraceRecorder | null }): Readonly<{ decisions: JsonValue; outcome: DamageOutcome; plan: CommitPlan }>;
export function enqueueReactions(events: ReadonlyArray<DomainEventEnvelope>, input: ScenarioInput, queue: ReactionQueue, trace?: TraceRecorder | null): void;
export function applyStatusReaction(store: StateStore, reaction: Readonly<Required<Reaction>>, trace?: TraceRecorder | null): Readonly<Record<string, any>>;
export function advanceStatuses(store: StateStore, targetTick: number, trace?: TraceRecorder | null): Readonly<{ targetTick: number; commits: ReadonlyArray<Record<string, JsonValue>>; tickCount: number; catchUpLimited: boolean }>;
export function executeImpact(input: ScenarioInput, trace?: TraceRecorder | null): { store: StateStore; command: Readonly<CommandEnvelope>; resolution: Readonly<{ decisions: JsonValue; outcome: DamageOutcome; plan: JsonValue }>; commit: Readonly<Record<string, any>> };
export function runFireballScenario(input?: ScenarioInputPatch): Readonly<Record<string, any>>;
export function verifyReplay(input?: ScenarioInputPatch): Readonly<{ match: boolean; traceMatch: boolean; finalStateMatch: boolean; first: any; second: any }>;
export function demonstrateDuplicateCommand(input?: ScenarioInputPatch): Readonly<Record<string, any>>;
export function demonstrateVersionConflict(input?: ScenarioInputPatch): Readonly<Record<string, any>>;
export function demonstrateAtomicRollback(input?: ScenarioInputPatch): Readonly<Record<string, any>>;
