'use strict';
const path = require('node:path');
const { createUserDataRepository } = require(path.resolve(__dirname, '../../server/node/user-data-repository.cjs'));
const repo = createUserDataRepository({ dataRoot: process.argv[2] });
try {
    const db = repo.loadStartupDatabase();
    console.log('loadStartupDatabase OK: characters', db.characters.length, '| characterOrder entries', (db.characterOrder || []).length);
} catch (e) { console.log('loadStartupDatabase THROWS:', e.code || '', e.message.slice(0, 300)); }
