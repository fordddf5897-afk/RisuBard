'use strict';
// If the server cannot reload its list after folders moved, everything must be put back.
// Run against a server started with BANGJU_ARCHIVE_TEST_FAIL_RELOAD=1.
const fs = require('node:fs'); const path = require('node:path');
const { client } = require('./h.cjs');
const [base, root] = process.argv.slice(2);
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
(async () => {
    const tab = await client(base).login();
    const before = (await tab.readDb()).db;
    const list = (await tab.get('/api/bangju/archive')).json;
    const ids = list.active.slice(0, 3).map(c => c.id);
    const r = await tab.post('/api/bangju/archive/move', { ids, direction: 'archive' });
    ok('the move reports the failure and the rollback', r.status === 500 && r.json?.code === 'BANGJU_ARCHIVE_ROLLED_BACK' && r.json.rolledBack === 3, JSON.stringify(r.json).slice(0, 200));
    ok('all folders are back in place', ids.every(id => fs.existsSync(path.join(root, 'characters', id)) && !fs.existsSync(path.join(root, 'bangju/archive/characters', id))));
    const tab2 = await client(base).login();
    const after = (await tab2.readDb()).db;
    ok('the list is unchanged, in the same order', JSON.stringify(after.characters.map(c => [c.name, c.chats.map(x => x.name)])) === JSON.stringify(before.characters.map(c => [c.name, c.chats.map(x => x.name)])), `characters ${after.characters.length}`);
    const list2 = (await tab2.get('/api/bangju/archive')).json;
    ok('archive is empty', list2.totals.archived === 0 && list2.totals.active === before.characters.length);
    const kept = path.join(root, 'bangju/archive/assets');
    ok('no kept image names left behind', !fs.existsSync(kept) || fs.readdirSync(kept).length === 0);
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });
