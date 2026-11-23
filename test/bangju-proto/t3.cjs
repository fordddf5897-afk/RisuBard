'use strict';
// Image protection: archive bots, run the app's image cleanup, restore, and fetch the images again.
const fs = require('node:fs'); const path = require('node:path');
const { client } = require('./h.cjs');
const [base, root] = process.argv.slice(2);
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
const note = (label, detail) => console.log(`NOTE  ${label}  — ${detail}`);
const keys = () => { const m = JSON.parse(fs.readFileSync(path.join(root, 'kv/manifest.json'), 'utf8')); return Object.keys(m.entries); };
(async () => {
    let tab = await client(base).login(); await tab.readDb();
    let list = (await tab.get('/api/bangju/archive')).json;
    const id = name => list.active.find(c => c.name === name).id;
    const bot6 = id('Bot 0006');
    const mig = await tab.post('/api/character-packages/transition', { characterId: bot6, action: 'migrate' });
    ok('Bot 0006 converted to a V3 folder', mig.status === 200);
    tab = await client(base).login(); await tab.readDb();
    list = (await tab.get('/api/bangju/archive')).json;
    const ids = [id('Bot 0003'), bot6, id('Bot 0012')];
    const objectsBefore = fs.readdirSync(path.join(root, 'kv/objects')).length;
    const arch = await tab.post('/api/bangju/archive/move', { ids, direction: 'archive' });
    ok('archive 3 bots with images', arch.status === 200 && arch.json.moved.length === 3, JSON.stringify({ assets: arch.json.assets, timings: arch.json.timings }));
    ok('no image bytes were copied (second names only)', fs.readdirSync(path.join(root, 'kv/objects')).length <= objectsBefore + 1, `objects ${objectsBefore} -> ${fs.readdirSync(path.join(root, 'kv/objects')).length}`);
    tab = await client(base).login(); await tab.readDb();
    const cleanup = await tab.post('/api/db/orphans/cleanup', {});
    note('app image cleanup while archived', `removed ${JSON.stringify(cleanup.json?.assets)}, objects ${JSON.stringify(cleanup.json?.objects)}`);
    const k = keys();
    ok('cleanup removed the assets/ names of archived bots', !k.includes('assets/bot3.png') && !k.includes('assets/chatonly-12.png'), k.filter(x => x.startsWith('assets/')).join(', '));
    ok('second names survived', k.filter(x => x.startsWith('bangju/archive/assets/')).length === 7, k.filter(x => x.startsWith('bangju/')).map(x => x.split('/').pop()).join(', '));
    const res = await tab.post('/api/bangju/archive/move', { ids, direction: 'restore' });
    ok('restore', res.status === 200 && res.json.moved.length === 3, JSON.stringify({ assets: res.json.assets, failed: res.json.failed }));
    tab = await client(base).login();
    const db = (await tab.readDb()).db;
    for (const [name, expected] of [['Bot 0003', 'bot3'], ['Bot 0006', 'bot6'], ['Bot 0012', 'bot12']]) {
        const bot = db.characters.find(c => c.name === name);
        const image = await tab.asset(bot.image);
        const extra = await tab.asset(bot.additionalAssets[0][1]);
        ok(`${name}: images served again`, image.status === 200 && image.tail.endsWith(expected) && extra.status === 200, JSON.stringify({ image, extra }));
    }
    const chatOnly = await tab.asset('assets/chatonly-12.png');
    ok('image used only inside a chat message served again', chatOnly.status === 200 && chatOnly.tail.endsWith('chat12'), JSON.stringify(chatOnly));
    ok('second names cleaned up after restore', keys().filter(x => x.startsWith('bangju/')).length === 0);
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });
