'use strict';
const fs = require('node:fs');
const path = require('node:path');
const G = require('./runtime-kernel.js');
const registry = new G.SchemaMigrationRegistry({ currentVersion: 3, minimumSupportedVersion: 1 });
registry.register({
  migrationId: 'migration.player.v1-v2', fromVersion: 1, toVersion: 2,
  migrate: doc => ({ ...doc, schemaVersion: 2, resources: { hp: doc.resources.health, mana: doc.resources.mana } }),
});
registry.register({
  migrationId: 'migration.player.v2-v3', fromVersion: 2, toVersion: 3,
  migrate: doc => ({ schemaVersion: 3, playerId: doc.playerId, profile: doc.profile, resources: doc.resources, inventory: doc.inventory, migratedAtPolicy: 'logical-version-only' }),
});
const source = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'save-player-v1.json'), 'utf8'));
console.log(JSON.stringify(registry.migrate(source), null, 2));
