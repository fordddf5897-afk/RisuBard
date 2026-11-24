'use strict';
// 많이 옮길 때: 진행 상황이 보이는지, 그동안 상태 물음에 서버가 답하는지, 걸리는 시간.
// 큰 가짜 자료(seed3)로 돌린다. 서버는 기본 방식(BANGJU_ARCHIVE_SETTLE_DELAY_MS=3000 정도).
const { client } = require('./h.cjs');
const [base] = process.argv.slice(2);
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const timed = async fn => { const t = Date.now(); const value = await fn(); return { value, ms: Date.now() - t }; };
async function watch(tab, promise) {
    const seen = []; let slowest = 0; let done = false;
    promise.finally(() => { done = true; });
    while (!done) {
        const s = await timed(() => tab.get('/api/bangju/archive/status'));
        slowest = Math.max(slowest, s.ms);
        if (s.value.json.running) seen.push(s.value.json.running.done);
        await sleep(40);
    }
    return { seen, slowest, result: await promise };
}
async function settled(tab, since) {
    for (let i = 0; i < 400; i++) {
        const s = (await tab.get('/api/bangju/archive/status')).json;
        if (s.settle.state === 'idle' && s.settle.bots === 0 && s.lastSettle && new Date(s.lastSettle.finishedAt).getTime() >= since) return s.lastSettle;
        await sleep(250);
    }
    return null;
}
(async () => {
    let tab = await client(base).login();
    const open0 = await timed(() => tab.readDb());
    const list = (await tab.get('/api/bangju/archive')).json;
    const total = list.totals.active;
    const keep = new Set(list.active.slice(0, 100).map(c => c.id));
    const ids = list.active.filter(c => !keep.has(c.id)).map(c => c.id);
    console.log(`NOTE  ${total} bots, card text ${(list.totals.activeCardBytes / 1048576).toFixed(1)}MB, app open ${open0.ms}ms`);

    let t0 = Date.now();
    const a = await watch(tab, tab.post('/api/bangju/archive/move', { ids, direction: 'archive' }));
    const rising = a.seen.every((n, i) => i === 0 || n >= a.seen[i - 1]);
    ok(`archive ${ids.length} bots: answered without the reload`, a.result.status === 200 && a.result.json.moved.length === ids.length && a.result.json.settle === 'pending',
        `${Date.now() - t0}ms, timings ${JSON.stringify(a.result.json.timings)}`);
    ok('progress was visible while it ran', a.seen.length >= 3 && rising && new Set(a.seen).size >= 3, `${a.seen.length} answers, counts ${a.seen[0]} … ${a.seen[a.seen.length - 1]}, slowest status answer ${a.slowest}ms`);
    const s1 = await settled(tab, t0);
    ok('the server reloaded once afterwards', s1?.status === 'done', JSON.stringify(s1));
    tab = await client(base).login();
    const open1 = await timed(() => tab.readDb());
    ok('the app opens with 100 bots', open1.value.db.characters.length === 100, `${open1.ms}ms, ${(open1.value.bytes / 1048576).toFixed(1)}MB (before: ${open0.ms}ms, ${(open0.value.bytes / 1048576).toFixed(1)}MB)`);

    t0 = Date.now();
    const r = await watch(tab, tab.post('/api/bangju/archive/move', { ids, direction: 'restore' }));
    ok(`restore ${ids.length} bots`, r.result.status === 200 && r.result.json.moved.length === ids.length, `${Date.now() - t0}ms, timings ${JSON.stringify(r.result.json.timings)}, slowest status answer ${r.slowest}ms`);
    const s2 = await settled(tab, t0);
    tab = await client(base).login();
    const open2 = await timed(() => tab.readDb());
    ok('everything is back, in the same order', s2?.status === 'done' && open2.value.db.characters.length === total
        && open2.value.db.characters.every((c, i) => c.chaId === open0.value.db.characters[i].chaId), `characters ${open2.value.db.characters.length}, reload ${s2?.totalMs}ms, app open ${open2.ms}ms`);
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });
