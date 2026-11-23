'use strict';
// Scale: a library shaped like the real one. Keep 100 bots active, archive the rest, then bring them back.
const fs = require('node:fs'); const path = require('node:path');
const { client, serverHash, fakeCharacter, encodeRisuSaveLegacyBuffer } = require('./h.cjs');
const [base, root] = process.argv.slice(2);
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
const mb = n => (n / 1048576).toFixed(1) + 'MB';
const timed = async fn => { const t = Date.now(); const value = await fn(); return { value, s: ((Date.now() - t) / 1000).toFixed(1) }; };
(async () => {
    let tab = await client(base).login();
    const read0 = await timed(() => tab.readDb());
    const list0 = await timed(() => tab.get('/api/bangju/archive'));
    const L0 = list0.value.json;
    console.log(`NOTE  before: ${L0.totals.active} bots, card text ${mb(L0.totals.activeCardBytes)}, file the app downloads ${mb(read0.value.bytes)} (read took ${read0.s}s), list call ${list0.s}s (server ${L0.listMs}ms)`);
    const keep = new Set(L0.active.slice(0, 100).map(c => c.id));
    const ids = L0.active.filter(c => !keep.has(c.id)).map(c => c.id);
    const arch = await timed(() => tab.post('/api/bangju/archive/move', { ids, direction: 'archive' }));
    ok(`archive ${ids.length} bots in one call`, arch.value.status === 200 && arch.value.json.moved.length === ids.length, `took ${arch.s}s, server timings ${JSON.stringify(arch.value.json?.timings)}, failed ${arch.value.json?.failed?.length}`);
    tab = await client(base).login();
    const read1 = await timed(() => tab.readDb());
    ok('app now downloads only the 100 active bots', read1.value.db.characters.length === 100, `file ${mb(read1.value.bytes)} (was ${mb(read0.value.bytes)}), read took ${read1.s}s`);
    const list1 = await timed(() => tab.get('/api/bangju/archive'));
    ok('list with ~1,000 archived bots is quick', list1.value.json.totals.archived === ids.length && list1.value.json.listMs < 1000, `list call ${list1.s}s (server ${list1.value.json.listMs}ms), response ${mb(JSON.stringify(list1.value.json).length)}`);

    // What today's app does when a bot is added: it resends the whole active list in one request.
    const db = read1.value.db;
    const added = fakeCharacter(9001, { cardBytes: 68000, chats: 1, messages: 2 });
    const next = [...db.characters, { ...added, chats: added.chats.map(chat => ({ ...chat, _stub: undefined })) }];
    const patch = [{ op: 'replace', path: '/characters', value: next }];
    const body = JSON.stringify({ patch, expectedHash: serverHash(db) });
    const p = await timed(() => tab.patchDb(patch, serverHash(db)));
    ok('adding a bot with 100 active: one request, accepted, under the 100MB limit', p.value.status === 200 && Buffer.byteLength(body) < 100 * 1048576, `request ${mb(Buffer.byteLength(body))}, status ${p.value.status}, took ${p.s}s ${p.value.status !== 200 ? p.value.text.slice(0, 150) : ''}`);
    await new Promise(r => setTimeout(r, 3000));

    tab = await client(base).login(); await tab.readDb();
    const res = await timed(() => tab.post('/api/bangju/archive/move', { ids, direction: 'restore' }));
    ok(`restore ${ids.length} bots in one call`, res.value.status === 200 && res.value.json.moved.length === ids.length, `took ${res.s}s, server timings ${JSON.stringify(res.value.json?.timings)}`);
    tab = await client(base).login();
    const read2 = await timed(() => tab.readDb());
    ok('everything is back', read2.value.db.characters.length === L0.totals.active + 1, `characters ${read2.value.db.characters.length}, file ${mb(read2.value.bytes)}, read took ${read2.s}s`);
    const order0 = L0.active.map(c => c.name).join('|');
    const order2 = read2.value.db.characters.filter(c => c.name !== added.name).map(c => c.name).join('|');
    ok('bots are back in their original order', order0 === order2);
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });
