'use strict';
// Hazard checks: image cleanup after archiving, V3 (folder-with-assets) bots, backup inventory.
const fs = require('node:fs');
const path = require('node:path');
const { client } = require('./h.cjs');
const [base, root] = process.argv.slice(2);
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
const note = (label, detail) => console.log(`NOTE  ${label}  — ${detail}`);
const kvKeys = () => Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'kv/manifest.json'), 'utf8')).entries || JSON.parse(fs.readFileSync(path.join(root, 'kv/manifest.json'), 'utf8')));

(async () => {
    let tab = await client(base).login();
    const list = (await tab.get('/api/bangju/archive')).json;
    const bot3 = list.active.find(c => c.name === 'Bot 0003');
    const bot6 = list.active.find(c => c.name === 'Bot 0006');
    const assetKeysBefore = kvKeys().filter(k => k.startsWith('assets/'));
    note('asset keys in the shared store', assetKeysBefore.join(', '));

    // --- A legacy-layout bot: its images live only in the shared store.
    const arch = await tab.post('/api/bangju/archive/move', { ids: [bot3.id], direction: 'archive' });
    ok('archive Bot 0003 (images in shared store)', arch.status === 200 && arch.json.moved.length === 1);
    tab = await client(base).login();
    await tab.readDb();
    const cleanup = await tab.post('/api/db/orphans/cleanup', {});
    const assetKeysAfter = kvKeys().filter(k => k.startsWith('assets/'));
    const lost = assetKeysBefore.filter(k => !assetKeysAfter.includes(k));
    note('image cleanup after archiving', `status ${cleanup.status}, removed ${JSON.stringify(cleanup.json?.assets)}; keys lost: ${lost.join(', ') || 'none'}`);
    ok('HAZARD CONFIRMED: cleanup deletes the archived bot\'s images', lost.includes('assets/bot3.png') && lost.includes('assets/extra-bot3.png'), 'this is the case that needs protection');

    // --- A V3 package bot: folder holds its own copies of the images.
    const status0 = await tab.get(`/api/character-packages/status?characterId=${bot6.id}`);
    const mig = await tab.post('/api/character-packages/transition', { characterId: bot6.id, action: 'migrate' });
    note('convert Bot 0006 to V3 folder', `status ${mig.status} ${JSON.stringify(mig.json).slice(0, 200)}`);
    const mapping = JSON.parse(fs.readFileSync(path.join(root, 'index/character-directories.json'), 'utf8'));
    const entry = mapping.characters.find(c => c.id === bot6.id);
    note('V3 folder', `${entry?.directory} contains: ${fs.readdirSync(path.join(root, 'characters', entry.directory)).join(', ')}`);
    const assetsDir = path.join(root, 'characters', entry.directory, 'assets');
    note('V3 folder asset copies', fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).join(', ') : '(no assets folder)');
    tab = await client(base).login(); await tab.readDb();
    const arch6 = await tab.post('/api/bangju/archive/move', { ids: [bot6.id], direction: 'archive' });
    ok('archive V3 bot', arch6.status === 200 && arch6.json.moved.length === 1 && arch6.json.adopted, JSON.stringify(arch6.json).slice(0, 220));
    ok('V3 folder moved with its asset copies', fs.existsSync(path.join(root, 'bangju/archive/characters', entry.directory, 'metadata.json')) && !fs.existsSync(path.join(root, 'characters', entry.directory)));
    tab = await client(base).login();
    const db1 = await tab.readDb();
    ok('database without the V3 bot', db1.status === 200 && db1.db.characters.length === 10 && !db1.db.characters.some(c => c.name === 'Bot 0006'), `characters ${db1.db?.characters?.length ?? db1.body}`);
    // an ordinary save after archiving a V3 bot must still work
    const { serverHash } = require('./h.cjs');
    const p = await tab.patchDb([{ op: 'replace', path: '/characters/0/name', value: db1.db.characters[0].name + ' +' }], serverHash(db1.db));
    ok('ordinary save after archiving a V3 bot', p.status === 200, `status ${p.status} ${p.text.slice(0, 160)}`);
    await new Promise(r => setTimeout(r, 2500));
    const res6 = await tab.post('/api/bangju/archive/move', { ids: [bot6.id], direction: 'restore' });
    ok('restore V3 bot', res6.status === 200 && res6.json.moved.length === 1, JSON.stringify(res6.json).slice(0, 220));
    tab = await client(base).login();
    const db2 = await tab.readDb();
    ok('V3 bot back in the database', db2.db.characters.some(c => c.name === 'Bot 0006') && db2.db.characters.length === 11, `characters ${db2.db.characters.length}`);
    const st = await tab.get(`/api/character-packages/status?characterId=${bot6.id}`);
    note('V3 status after restore', JSON.stringify(st.json).slice(0, 260));
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });
