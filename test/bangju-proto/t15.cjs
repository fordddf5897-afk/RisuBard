'use strict';
// 폴더 기억을 많은 수로: 폴더 여러 개에 나뉜 봇을 한꺼번에 보관했다가 불러오면 앱의 목록(폴더와 순서)이
// 보관 전과 완전히 같아지는지. 한 번에 다 불러올 때와 나눠서 불러올 때 둘 다 본다.
// 사용: BANGJU_ARCHIVE_SETTLE=now node t15.cjs <base>   (서버도 바로 정리 방식, seed2 자료 240개)
const { client, serverHash } = require('./h.cjs');
const [base] = process.argv.slice(2);
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// every move ends the session, so this logs in often; the server allows 10 logins per 30 seconds
const fresh = async () => {
    for (let attempt = 0; ; attempt++) {
        try { const tab = await client(base).login(); return { tab, read: await tab.readDb() }; }
        catch (error) { if (attempt >= 12 || !/login failed/.test(String(error))) throw error; await sleep(4000); }
    }
};
// what the app does when it opens: bots that are gone leave the folder list
const appCleansUp = async () => {
    const { tab, read } = await fresh();
    const alive = new Set(read.db.characters.map(c => c.chaId));
    const cleaned = read.db.characterOrder.filter(item => typeof item !== 'string' || alive.has(item))
        .map(item => (typeof item === 'string' ? item : { ...item, data: item.data.filter(id => alive.has(id)) }));
    const saved = await tab.patchDb([{ op: 'replace', path: '/characterOrder', value: cleaned }], serverHash(read.db));
    return saved.status;
};
const shape = order => JSON.stringify(order.map(item => (typeof item === 'string' ? item : { id: item.id, name: item.name, data: item.data })));
(async () => {
    let { tab, read } = await fresh();
    const ids = read.db.characters.map(c => c.chaId);
    // 10 folders of 18 bots, with loose bots between the folders
    const order = [];
    let at = 0;
    for (let f = 0; f < 10; f++) {
        order.push({ name: `폴더 ${f + 1}`, data: ids.slice(at, at + 18), color: '', id: `folder-${f + 1}` });
        at += 18;
        order.push(...ids.slice(at, at + 3));
        at += 3;
    }
    order.push(...ids.slice(at));
    const saved = await tab.patchDb([{ op: 'replace', path: '/characterOrder', value: order }], serverHash(read.db));
    const before = shape(order);
    ok('setup: 10 folders saved through the app', saved.status === 200 && ids.length >= 230, `bots ${ids.length}`);

    const list = (await tab.get('/api/bangju/archive')).json;
    const byCha = new Map(read.db.characters.map(c => [c.name, c.chaId]));
    const listId = new Map(list.active.map(c => [byCha.get(c.name), c.id]));
    // archive five of every six bots, from everywhere
    const leaving = ids.filter((id, i) => i % 6 !== 0);
    const archived = await tab.post('/api/bangju/archive/move', { ids: leaving.map(id => listId.get(id)), direction: 'archive' });
    ok('archived in one go', archived.json.moved.length === leaving.length && archived.json.failed.length === 0, `${archived.json.moved.length} of ${leaving.length}`);
    ok('the app drops them from its folders', await appCleansUp() === 200);
    ({ tab, read } = await fresh());
    const emptied = read.db.characterOrder.filter(item => typeof item !== 'string').reduce((n, f) => n + f.data.length, 0);
    ok('the folders are nearly empty now', emptied === 30, `bots left in folders: ${emptied}`);

    // all back at once
    const restored = await tab.post('/api/bangju/archive/move', { ids: leaving.map(id => listId.get(id)), direction: 'restore' });
    ({ tab, read } = await fresh());
    ok('restored in one go: the app\'s list is exactly what it was', restored.json.moved.length === leaving.length && restored.json.foldersRestored === leaving.length
        && shape(read.db.characterOrder) === before, `put back ${restored.json.foldersRestored}, same ${shape(read.db.characterOrder) === before}`);

    // again, but restored in three parts and in an unhelpful order
    await tab.post('/api/bangju/archive/move', { ids: leaving.map(id => listId.get(id)), direction: 'archive' });
    await appCleansUp();
    const shuffled = leaving.slice().reverse();
    const third = Math.ceil(shuffled.length / 3);
    let put = 0;
    for (let part = 0; part < 3; part++) {
        ({ tab } = await fresh());
        const answer = await tab.post('/api/bangju/archive/move', { ids: shuffled.slice(part * third, (part + 1) * third).map(id => listId.get(id)), direction: 'restore' });
        put += answer.json.foldersRestored || 0;
        await appCleansUp();
    }
    ({ tab, read } = await fresh());
    const after = read.db.characterOrder;
    const folderOf = orderList => { const map = new Map(); for (const item of orderList) { if (typeof item !== 'string') for (const id of item.data) map.set(id, item.id); else map.set(item, ''); } return map; };
    const was = folderOf(order); const now = folderOf(after);
    const wrongFolder = ids.filter(id => was.get(id) !== now.get(id)).length;
    ok('restored in three parts: every bot is back in its own folder', put === leaving.length && wrongFolder === 0 && now.size === ids.length, `put back ${put}, in a wrong folder ${wrongFolder}`);
    ok('restored in three parts: the order inside every folder is the old one too', shape(after) === before, `same ${shape(after) === before}`);
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });
