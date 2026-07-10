export const RUNTIME_VERSION: '3.2.0-reference';
export const CONTRACT_SCHEMA_VERSION: 1;
export const REPLAY_FORMAT_VERSION: 1;
export const RNG_ALGORITHM_VERSION: string;
export const NUMERIC_POLICY_VERSION: string;
export const BASIS_POINTS: 10000;

export type NamespacedId = `${string}.${string}`;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

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
  readonly schemaVersion: number;
  readonly commandId: NamespacedId;
  readonly actorId: NamespacedId;
  readonly requestedTick: number;
  readonly correlationId: NamespacedId;
  readonly causationId: NamespacedId | null;
  readonly dataVersion: string;
  readonly payload: T;
}
export interface DomainEventEnvelope<T extends JsonValue = JsonValue> {
  readonly schemaVersion: number;
  readonly eventId: NamespacedId;
  readonly type: string;
  readonly correlationId: NamespacedId;
  readonly causationId: NamespacedId;
  readonly occurredTick: number;
  readonly payload: T;
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
  sourceRef: NamespacedId;
  targetId: NamespacedId;
  correlationId: NamespacedId;
  causationId: NamespacedId;
  dataVersion: string;
  appliedTick: number;
  nextTickAt: number;
  expireTick: number;
  intervalTicks: number;
  tickDamage: number;
  maxCatchUpTicks: number;
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

export interface DamageOutcome {
  sourceId: NamespacedId;
  targetId: NamespacedId;
  skillDefinitionId: NamespacedId;
  damageType: 'fire';
  hit: boolean;
  critical: boolean;
  rawDamage: number;
  resolvedDamage: number;
  shieldAbsorbed: number;
  hpDamage: number;
  overkill: number;
  targetHpAfter: number;
  burn: { definitionId: NamespacedId; tickDamage: number; durationTicks: number; intervalTicks: number; applyWhenTargetAlive: boolean };
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
  constructor(initialState: RuntimeState & { processedCommands?: string[]; outbox?: DomainEventEnvelope[] });
  readonly tick: number;
  readonly outbox: DomainEventEnvelope[];
  getEntity(entityId: NamespacedId): Readonly<RuntimeEntity>;
  snapshot(entityIds: NamespacedId[]): Readonly<{ tick: number; entities: Record<NamespacedId, RuntimeEntity> }>;
  exportState(): Readonly<RuntimeState>;
  commit(command: CommandEnvelope, plan: JsonValue, trace?: TraceRecorder | null): Readonly<Record<string, JsonValue>>;
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
export class ReactionQueue {
  constructor(options?: { maxDepth?: number; maxReactions?: number; maxBudget?: number });
  enqueue(reaction: Reaction): boolean;
  drain(handler: (reaction: Readonly<Required<Reaction>>) => JsonValue, trace?: TraceRecorder | null, tick?: number): Readonly<Record<string, JsonValue>>;
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
export function createContextFingerprint(context?: Record<string, JsonValue>, dependencies?: string[]): Readonly<Record<string, JsonValue>>;
export function createCommandEnvelope<T extends JsonValue>(value: Omit<CommandEnvelope<T>, 'schemaVersion'> & { schemaVersion?: number }): Readonly<CommandEnvelope<T>>;
export function createDomainEventEnvelope<T extends JsonValue>(value: Omit<DomainEventEnvelope<T>, 'schemaVersion'> & { schemaVersion?: number }): Readonly<DomainEventEnvelope<T>>;
export function defaultScenarioInput(): ScenarioInput;
export function normalizeScenarioInput(input?: Partial<ScenarioInput>): Readonly<ScenarioInput>;
export function createInitialState(input: ScenarioInput): Readonly<RuntimeState>;
export function createFireballCommand(input: ScenarioInput): Readonly<CommandEnvelope>;
export function resolveFireball(args: { snapshot: JsonValue; command: CommandEnvelope; input: ScenarioInput; rng: KeyedRandom; trace?: TraceRecorder | null }): Readonly<{ decisions: JsonValue; outcome: DamageOutcome; plan: JsonValue }>;
export function runFireballScenario(input?: Partial<ScenarioInput>): Readonly<Record<string, any>>;
export function verifyReplay(input?: Partial<ScenarioInput>): Readonly<{ match: boolean; traceMatch: boolean; finalStateMatch: boolean; first: any; second: any }>;
export function demonstrateDuplicateCommand(input?: Partial<ScenarioInput>): Readonly<Record<string, any>>;
export function demonstrateVersionConflict(input?: Partial<ScenarioInput>): Readonly<Record<string, any>>;
export function demonstrateAtomicRollback(input?: Partial<ScenarioInput>): Readonly<Record<string, any>>;
