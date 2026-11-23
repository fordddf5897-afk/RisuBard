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
    const storeBefore = fs.existsSync(path.join(root, 'asset-store'));
    ok('archive 3 bots with images', arch.status === 200 && arch.json.moved.length === 3, JSON.stringify({ assets: arch.json.assets, timings: arch.json.timings, assetStoreInUse: storeBefore }));
    ok('no image bytes were copied (links only)', arch.json.assets.copied === 0 && arch.json.assets.protected === 8 && arch.json.assets.missing === 0, JSON.stringify(arch.json.assets));
    tab = await client(base).login(); await tab.readDb();
    const cleanup = await tab.post('/api/db/orphans/cleanup', {});
    note('app image cleanup while archived', `removed ${JSON.stringify(cleanup.json?.assets)}, objects ${JSON.stringify(cleanup.json?.objects)}`);
    const k = keys();
    const storeFiles = fs.existsSync(path.join(root, 'asset-store')) ? fs.readdirSync(path.join(root, 'asset-store')).flatMap(d => fs.readdirSync(path.join(root, 'asset-store', d))) : [];
    ok('cleanup removed the app-side names of archived bots', !k.includes('assets/bot3.png') && !k.includes('assets/chatonly-12.png') && storeFiles.length === 0, `left in assets/: ${k.filter(x => x.startsWith('assets/')).join(', ')}; asset-store files: ${storeFiles.length}`);
    const keptRoot = path.join(root, 'bangju/archive/assets');
    const kept = fs.readdirSync(keptRoot).flatMap(id => fs.readdirSync(path.join(keptRoot, id)));
    ok('the archive kept its own names for all 8 images', kept.length === 8, kept.map(name => name.length > 20 ? name.slice(0, 8) + '….png' : name).join(', '));
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
    const stored = db.characters.find(c => c.name === 'Bot 0012').additionalAssets.find(a => a[0] === 'stored')[1];
    const storedImage = await tab.asset(stored);
    ok('image kept in the newer asset store served again', storedImage.status === 200 && storedImage.tail.endsWith('stored12'), JSON.stringify(storedImage));
    ok('the archive dropped its kept names after restore', fs.readdirSync(keptRoot).length === 0);
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });
