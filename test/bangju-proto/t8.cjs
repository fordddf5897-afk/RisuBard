'use strict';
// The result of the last move must stay available on the server, so a page that lost
// its connection (or was closed) during a long move can still show it.
const fs = require('node:fs'); const path = require('node:path');
const { client } = require('./h.cjs');
const [base, root] = process.argv.slice(2);
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const tab = await client(base).login();
    const list = (await tab.get('/api/bangju/archive')).json;
    const ids = list.active.slice(0, 2).map(c => c.id);

    // 1) a normal move reports and records the same thing
    const r = await tab.post('/api/bangju/archive/move', { ids, direction: 'archive', runId: 'run-a' });
    ok('the answer carries the run id, before/after and timings', r.status === 200 && r.json.runId === 'run-a' && r.json.status === 'done'
        && r.json.before.active === list.totals.active && r.json.after.active === list.totals.active - 2
        && r.json.after.databaseBytes < r.json.before.databaseBytes && Number.isFinite(r.json.totalMs), JSON.stringify({ before: r.json.before, after: r.json.after, totalMs: r.json.totalMs }));
    const s1 = (await tab.get('/api/bangju/archive/status')).json;
    ok('the status shows that run as the last one, nothing running', s1.running === null && s1.queued === 0 && s1.last?.runId === 'run-a' && s1.last.moved.length === 2);
    ok('the last run is kept in a file', JSON.parse(fs.readFileSync(path.join(root, 'bangju/archive/last-run.json'), 'utf8')).runId === 'run-a');

    // 2) the browser gives up before the answer arrives: the server still finishes and keeps the result
    const controller = new AbortController();
    const dropped = fetch(`${base}/api/bangju/archive/move`, {
        method: 'POST', signal: controller.signal,
        headers: { ...tab.headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ ids, direction: 'restore', runId: 'run-b' }),
    }).then(() => 'answered', () => 'dropped');
    await sleep(15);
    controller.abort();
    const outcome = await dropped;
    let last = null;
    for (let i = 0; i < 40 && last?.runId !== 'run-b'; i++) { await sleep(250); last = (await tab.get('/api/bangju/archive/status')).json.last; }
    ok('after a dropped connection the result can still be read', last?.runId === 'run-b' && last.status === 'done' && last.moved.length === 2, `request ${outcome}; last ${last?.runId} ${last?.status}`);
    ok('and the bots really came back', ids.every(id => fs.existsSync(path.join(root, 'characters', id))));
    const list2 = (await tab.get('/api/bangju/archive')).json;
    ok('list is back to the start', list2.totals.active === list.totals.active && list2.totals.archived === list.totals.archived);

    // 3) the status needs a login
    const anonymous = await fetch(`${base}/api/bangju/archive/status`);
    ok('status is refused without a login', anonymous.status >= 400 && anonymous.status < 500 && !(await anonymous.text()).includes('last'), `status ${anonymous.status}`);
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });
