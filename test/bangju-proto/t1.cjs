'use strict';
// Core archive test: move bots out, reload the server's list from disk, refuse stale tabs, move back.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { client, serverHash } = require('./h.cjs');
const [base, root] = process.argv.slice(2);

function treeHash(directory) {
    const hash = crypto.createHash('sha256');
    const walk = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { hash.update(`D:${path.relative(directory, full)}\n`); walk(full); }
            else hash.update(`F:${path.relative(directory, full)}:`).update(fs.readFileSync(full)).update('\n');
        }
    };
    walk(directory);
    return hash.digest('hex').slice(0, 16);
}
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
const stripOrder = db => Object.fromEntries(db.characters.map(c => [c.chaId, c]));

(async () => {
    const tabA = await client(base).login();           // an open tab that will go stale
    const before = await tabA.readDb();
    const list0 = (await tabA.get('/api/bangju/archive')).json;
    ok('list before', list0.totals.active === before.db.characters.length && list0.totals.archived === 0,
        `active ${list0.totals.active}, archived ${list0.totals.archived}, database ${list0.totals.databaseBytes} bytes, list took ${list0.listMs}ms`);

    const withAsset = list0.active.find(c => c.name === 'Bot 0003');
    const targets = [list0.active[0], withAsset, list0.active[list0.active.length - 1]];
    const ids = targets.map(t => t.id);
    const folderOf = id => path.join(root, 'characters', id);
    const archivedOf = id => path.join(root, 'bangju/archive/characters', id);
    const hashesBefore = Object.fromEntries(ids.map(id => [id, treeHash(folderOf(id))]));

    const moved = await tabA.post('/api/bangju/archive/move', { ids, direction: 'archive' });
    ok('archive call', moved.status === 200 && moved.json.moved.length === 3 && moved.json.adopted === true,
        JSON.stringify({ status: moved.status, moved: moved.json?.moved?.length, failed: moved.json?.failed, timings: moved.json?.timings, databaseBytes: moved.json?.databaseBytes }));
    ok('folders moved', ids.every(id => !fs.existsSync(folderOf(id)) && fs.existsSync(archivedOf(id))));
    ok('archived folders byte-identical', ids.every(id => treeHash(archivedOf(id)) === hashesBefore[id]));
    ok('database got smaller', moved.json.databaseBytes < list0.totals.databaseBytes, `${list0.totals.databaseBytes} -> ${moved.json.databaseBytes}`);

    const tabB = await client(base).login();           // a page opened after the move
    const afterB = await tabB.readDb();
    ok('fresh page sees the smaller list', afterB.db.characters.length === before.db.characters.length - 3
        && !afterB.db.characters.some(c => targets.some(t => t.name === c.name)), `characters ${afterB.db.characters.length}`);

    // The stale tab tries to save with what it has in memory.
    const stalePatch = await tabA.patchDb([{ op: 'replace', path: '/characters/1/name', value: 'renamed by stale tab' }], serverHash(before.db));
    ok('stale tab patch refused', stalePatch.status === 423 || stalePatch.status === 409, `status ${stalePatch.status} ${stalePatch.text.slice(0, 120)}`);
    const staleWrite = await tabA.writeDb(before.db, before.etag);
    ok('stale tab full write refused', staleWrite.status === 423 || staleWrite.status === 409, `status ${staleWrite.status} ${staleWrite.text.slice(0, 120)}`);
    const afterStale = await tabB.readDb();
    ok('archived bots not brought back by the stale tab', afterStale.db.characters.length === before.db.characters.length - 3
        && ids.every(id => !fs.existsSync(folderOf(id))), `characters ${afterStale.db.characters.length}`);

    const list1 = (await tabB.get('/api/bangju/archive')).json;
    ok('archive list', list1.totals.archived === 3 && list1.archived.every(a => a.name && a.cardBytes > 0),
        JSON.stringify(list1.archived.map(a => ({ name: a.name, cardBytes: a.cardBytes, chats: a.chats, assets: a.assetCount }))));

    // The fresh page keeps working normally: an ordinary small save.
    const pB = await tabB.patchDb([{ op: 'replace', path: '/characters/0/name', value: afterB.db.characters[0].name + ' *' }], serverHash(afterB.db));
    ok('fresh page can save', pB.status === 200, `status ${pB.status} ${pB.text.slice(0, 100)}`);

    const restored = await tabB.post('/api/bangju/archive/move', { ids, direction: 'restore' });
    ok('restore call', restored.status === 200 && restored.json.moved.length === 3 && restored.json.adopted === true,
        JSON.stringify({ status: restored.status, moved: restored.json?.moved?.length, failed: restored.json?.failed, timings: restored.json?.timings }));
    ok('folders back and byte-identical', ids.every(id => fs.existsSync(folderOf(id)) && !fs.existsSync(archivedOf(id)) && treeHash(folderOf(id)) === hashesBefore[id]));

    const tabC = await client(base).login();
    const afterC = await tabC.readDb();
    const a = stripOrder(before.db), c = stripOrder(afterC.db);
    const same = targets.every(t => {
        const original = before.db.characters.find(x => x.name === t.name);
        return JSON.stringify(c[original.chaId]) === JSON.stringify(a[original.chaId]);
    });
    ok('restored bots equal to the originals in the database', afterC.db.characters.length === before.db.characters.length && same, `characters ${afterC.db.characters.length}`);
    const list2 = (await tabC.get('/api/bangju/archive')).json;
    ok('archive empty again', list2.totals.archived === 0 && list2.totals.active === before.db.characters.length);
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });
