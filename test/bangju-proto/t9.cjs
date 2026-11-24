'use strict';
// B1의 기본 동작: 옮기기는 바로 끝나고, 목록 다시 읽기(정리)는 조금 뒤에 서버가 한다.
// 서버를 BANGJU_ARCHIVE_SETTLE_DELAY_MS=3000 정도로 켜고 돌린다.
//   node t9.cjs <base> <root>            보통 경로
//   node t9.cjs <base> <root> rollback   서버를 BANGJU_ARCHIVE_TEST_FAIL_RELOAD=1 로 켰을 때: 되돌리기
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const { client, serverHash } = require('./h.cjs');
const [base, root, mode] = process.argv.slice(2);
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const treeHash = dir => {
    const hash = crypto.createHash('sha256');
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const p = path.join(d, e.name); hash.update(path.relative(dir, p)); if (e.isDirectory()) walk(p); else hash.update(fs.readFileSync(p)); } };
    walk(dir); return hash.digest('hex');
};
async function settled(tab, since) {
    for (let i = 0; i < 120; i++) {
        const s = (await tab.get('/api/bangju/archive/status')).json;
        if (s.settle.state === 'idle' && s.settle.bots === 0 && s.lastSettle && new Date(s.lastSettle.finishedAt).getTime() >= since) return s;
        await sleep(250);
    }
    return (await tab.get('/api/bangju/archive/status')).json;
}
(async () => {
    let tab = await client(base).login();
    const first = await tab.readDb();
    const total = first.db.characters.length;
    const list0 = (await tab.get('/api/bangju/archive')).json;
    const [a, b, c] = list0.active;

    if (mode === 'rollback') {
        const t0 = Date.now();
        const r = await tab.post('/api/bangju/archive/move', { ids: [a.id, b.id], direction: 'archive' });
        ok('the move itself answers right away', r.status === 200 && r.json.settle === 'pending' && r.json.moved.length === 2, JSON.stringify({ status: r.status, settle: r.json.settle }));
        const s = await settled(tab, t0);
        ok('the failed reload put both bots back', s.lastSettle.status === 'rolled-back' && s.lastSettle.rolledBack === 2 && !s.lastSettle.notRolledBack.length, JSON.stringify(s.lastSettle).slice(0, 200));
        ok('folders are back in characters/', [a, b].every(x => fs.existsSync(path.join(root, 'characters', x.id)) && !fs.existsSync(path.join(root, 'bangju/archive/characters', x.id))));
        const list = (await tab.get('/api/bangju/archive')).json;
        ok('lists are as before', list.totals.active === list0.totals.active && list.totals.archived === list0.totals.archived);
        tab = await client(base).login();
        const db = await tab.readDb();
        ok('the app opens with every bot', db.status === 200 && db.db.characters.length === total, `characters ${db.db?.characters?.length}`);
        return;
    }

    // RisuBard keeps save slots, BardWiki and manuscripts outside the bot folder. Nothing may touch them.
    const memory = path.join(root, 'risubard', 'characters', a.id, 'chats', 'chat-1');
    fs.mkdirSync(memory, { recursive: true });
    fs.writeFileSync(path.join(memory, 'narrative-state.json'), JSON.stringify({ note: 'kept outside the bot folder' }));
    fs.writeFileSync(path.join(memory, 'events.jsonl'), '{"n":1}\n');
    const memoryBefore = treeHash(path.join(root, 'risubard'));

    // 1) the move answers before the server reloads its list
    const stale = tab;
    const t0 = Date.now();
    const r1 = await tab.post('/api/bangju/archive/move', { ids: [a.id, b.id], direction: 'archive' });
    ok('archive answers right away, reload left for later', r1.status === 200 && r1.json.settle === 'pending' && r1.json.timings.adoptMs === undefined && r1.json.adopted === false,
        JSON.stringify({ settle: r1.json.settle, timings: r1.json.timings, ms: Date.now() - t0 }));
    const s1 = (await tab.get('/api/bangju/archive/status')).json;
    ok('status shows the reload as waiting', s1.settle.state === 'pending' && s1.settle.bots === 2, JSON.stringify(s1.settle));
    const list1 = (await tab.get('/api/bangju/archive')).json;
    ok('the lists are already right', list1.totals.active === list0.totals.active - 2 && list1.totals.archived === 2 && !list1.active.some(x => x.id === a.id), `active ${list1.totals.active}, archived ${list1.totals.archived}`);

    // 2) more moves before the reload: no waiting in between
    const r2 = await tab.post('/api/bangju/archive/move', { ids: [c.id], direction: 'archive' });
    const r3 = await tab.post('/api/bangju/archive/move', { ids: [b.id], direction: 'restore' });
    ok('a second archive and a restore go through before the reload', r2.status === 200 && r2.json.moved.length === 1 && r3.status === 200 && r3.json.moved.length === 1
        && r2.json.timings.adoptMs === undefined && r3.json.timings.adoptMs === undefined, JSON.stringify({ r2: r2.json.timings, r3: r3.json.timings }));
    const list2 = (await tab.get('/api/bangju/archive')).json;
    ok('lists follow every move', list2.totals.active === list0.totals.active - 2 && list2.totals.archived === 2 && list2.active.some(x => x.id === b.id) && !list2.active.some(x => x.id === c.id));

    const rechecked = await tab.post('/api/bangju/archive/recheck', {});
    ok('rechecking the archived bots\' images adds nothing when all are kept', rechecked.status === 200 && rechecked.json.totals.bots === 2 && rechecked.json.totals.added === 0
        && rechecked.json.totals.missing === 0 && rechecked.json.totals.alreadyKept === rechecked.json.totals.images, JSON.stringify(rechecked.json.totals));

    // 3) the server reloads once, a little later
    const s2 = await settled(tab, t0);
    ok('one reload settles all three moves', s2.lastSettle.status === 'done' && s2.lastSettle.adopted === true && s2.lastSettle.bots === 4, JSON.stringify(s2.lastSettle));
    const refused = await stale.patchDb([{ op: 'replace', path: '/characters/0/name', value: 'from a stale tab' }], serverHash(first.db));
    ok('a tab that was open before is refused', refused.status === 423, `status ${refused.status}`);
    tab = await client(base).login();
    const db2 = await tab.readDb();
    ok('a fresh page sees the smaller list, restored bot in its old place', db2.db.characters.length === total - 2 && !db2.db.characters.some(x => x.chaId === a.id || x.chaId === c.id)
        && db2.db.characters.findIndex(x => x.name === b.name) === first.db.characters.findIndex(x => x.name === b.name) - 1,
        `characters ${db2.db.characters.length}, ${b.name} at ${db2.db.characters.findIndex(x => x.name === b.name)}`);

    // 4) the app is opened before the reload timer: the server reloads on its own, the timer finds nothing left
    const t1 = Date.now();
    const r4 = await tab.post('/api/bangju/archive/move', { ids: [a.id], direction: 'restore' });
    tab = await client(base).login();
    const db3 = await tab.readDb();
    ok('opening the app right after a move already shows the result', r4.json.settle === 'pending' && db3.db.characters.length === total - 1 && db3.db.characters.some(x => x.name === a.name), `characters ${db3.db.characters.length}`);
    const s3 = await settled(tab, t1);
    ok('the later reload had nothing left to do', s3.lastSettle.status === 'done' && s3.lastSettle.adopted === false, JSON.stringify(s3.lastSettle));
    const saved = await tab.patchDb([{ op: 'replace', path: '/characters/0/desc', value: 'saved after archive moves' }], serverHash(db3.db));
    ok('the fresh page can save', saved.status === 200, `status ${saved.status} ${saved.text.slice(0, 80)}`);

    // 5) asking for the reload now
    const r5 = await tab.post('/api/bangju/archive/move', { ids: [c.id], direction: 'restore' });
    const now = await tab.post('/api/bangju/archive/settle', {});
    ok('the reload can be asked for at once', r5.json.settle === 'pending' && now.status === 200 && now.json.status === 'done', JSON.stringify(now.json).slice(0, 160));
    tab = await client(base).login();
    const db4 = await tab.readDb();
    ok('every bot is back', db4.db.characters.length === total && (await tab.get('/api/bangju/archive')).json.totals.archived === 0, `characters ${db4.db.characters.length}`);

    // 6) RisuBard's own per-bot files were never touched (also not by the app's image cleanup)
    await tab.post('/api/db/orphans/cleanup', {});
    ok('save slots / BardWiki / manuscript files untouched', treeHash(path.join(root, 'risubard')) === memoryBefore);
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });
