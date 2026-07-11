'use strict';
const G = require('./runtime-kernel.js');
const result = G.runFireballScenario();
const target = result.finalState.entities[result.input.target.id];
console.log(JSON.stringify({
  runtimeVersion: result.runtimeVersion,
  replayHash: result.replayHash,
  traceHash: result.traceHash,
  decision: { hit: result.resolution.outcome.hit, critical: result.resolution.outcome.critical },
  damage: {
    raw: result.resolution.outcome.rawDamage,
    resolved: result.resolution.outcome.resolvedDamage,
    shield: result.resolution.outcome.shieldAbsorbed,
    hp: result.resolution.outcome.hpDamage,
    overkill: result.resolution.outcome.overkill,
  },
  burnTicks: result.outbox.filter(event => event.type === 'StatusTicked').map(event => ({ tick: event.occurredTick, damage: event.payload.hpDamage })),
  finalTarget: { hp: target.resources.hp, shield: target.resources.shield, statuses: Object.keys(target.statuses).length },
  eventTypes: result.outbox.map(event => event.type),
  invariants: result.invariants,
}, null, 2));
