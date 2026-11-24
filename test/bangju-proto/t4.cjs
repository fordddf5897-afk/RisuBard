'use strict';
// Interrupted moves: the server stops between steps. Files are arranged by hand while the server is
// down, exactly as each interruption would leave them, then the server is started again.
const fs = require('node:fs'); const path = require('node:path'); const { execSync } = require('node:child_process');
const { client } = require('./h.cjs');
const [base, root, port, log] = process.argv.slice(2);
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
const stop = () => execSync(`${path.join(__dirname, "stop.sh")} ${port} 9`, { stdio: "pipe" });
const start = () => execSync(`${path.join(__dirname, 'srv.sh')} ${port} ${root} ${log}`, { stdio: 'pipe' }).toString().trim();
const keys = () => Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'kv/manifest.json'), 'utf8')).entries);
(async () => {
    let tab = await client(base).login();
    const db0 = (await tab.readDb()).db;
    const list0 = (await tab.get('/api/bangju/archive')).json;
    const a = list0.active.find(c => c.name.startsWith('Bot 0002')), b = list0.active.find(c => c.name.startsWith('Bot 0009'));
    const archiveRoot = path.join(root, 'bangju/archive');

    // 1) Stopped right after a folder was renamed into the archive: journal still there, index and server list not updated.
    stop();
    fs.mkdirSync(path.join(archiveRoot, 'characters'), { recursive: true });
    fs.writeFileSync(path.join(archiveRoot, 'journal.json'), JSON.stringify({ schemaVersion: 1, direction: 'archive', startedAt: Date.now(), entries: [{ id: a.id, directory: a.id }, { id: b.id, directory: b.id }] }));
    fs.renameSync(path.join(root, 'characters', a.id), path.join(archiveRoot, 'characters', a.id));
    console.log('     (killed the server; moved Bot 0002 by hand, left Bot 0009 where it was, journal left behind)');
    console.log('    ', start());
    tab = await client(base).login();
    const db1 = await tab.readDb();
    ok('server starts and reads its list from the folders', db1.status === 200 && db1.db.characters.length === db0.characters.length - 1 && !db1.db.characters.some(c => c.name.startsWith('Bot 0002')) && db1.db.characters.some(c => c.name === 'Bot 0009'), `characters ${db1.db?.characters?.length ?? db1.body}`);
    const list1 = (await tab.get('/api/bangju/archive')).json;
    ok('archive list rebuilt from the folders', list1.totals.archived === 1 && list1.archived[0].name.startsWith('Bot 0002') && list1.archived[0].id === a.id, JSON.stringify(list1.archived.map(x => ({ name: x.name, id: x.id === a.id }))));
    // The batch was Bot 0002 + Bot 0009; one bot still waits, so the batch is offered for continuing.
    const status1 = (await tab.get('/api/bangju/archive/status')).json;
    ok('the interrupted batch is offered for continuing', fs.existsSync(path.join(archiveRoot, 'journal.json'))
        && status1.interrupted?.direction === 'archive' && status1.interrupted.total === 2 && status1.interrupted.remaining === 1, JSON.stringify(status1.interrupted));
    const everywhere = id => [fs.existsSync(path.join(root, 'characters', id)), fs.existsSync(path.join(archiveRoot, 'characters', id))];
    ok('each bot is in exactly one place', everywhere(a.id).filter(Boolean).length === 1 && everywhere(b.id).filter(Boolean).length === 1);
    // Continue what was left of the interrupted batch: Bot 0009 follows Bot 0002 into the archive.
    const resumed = await tab.post('/api/bangju/archive/move', { resume: true });
    const status2 = (await tab.get('/api/bangju/archive/status')).json;
    ok('continuing the batch archives the bot that was left', resumed.status === 200 && resumed.json.direction === 'archive' && resumed.json.moved.length === 1 && resumed.json.moved[0] === b.id
        && status2.interrupted === null && !fs.existsSync(path.join(archiveRoot, 'journal.json')), JSON.stringify({ status: resumed.status, moved: resumed.json?.moved?.length, interrupted: status2.interrupted }));
    const none = await tab.post('/api/bangju/archive/move', { resume: true });
    ok('nothing left to continue', none.status === 409 && none.json.code === 'BANGJU_ARCHIVE_NOTHING_TO_RESUME', `status ${none.status}`);
    const back = await tab.post('/api/bangju/archive/move', { ids: [a.id, b.id], direction: 'restore' });
    ok('both bots can be restored normally', back.status === 200 && back.json.moved.length === 2, JSON.stringify(back.json).slice(0, 160));

    // 2) Stopped during a restore: folder already back, image names not yet returned.
    tab = await client(base).login(); await tab.readDb();
    const list2 = (await tab.get('/api/bangju/archive')).json;
    const c = list2.active.find(x => x.name === 'Bot 0009');
    const arch = await tab.post('/api/bangju/archive/move', { ids: [c.id], direction: 'archive' });
    tab = await client(base).login(); await tab.readDb();
    await tab.post('/api/db/orphans/cleanup', {});
    const keptRoot = path.join(archiveRoot, 'assets');
    ok('setup: Bot 0009 archived and its images cleaned out of assets/', arch.json?.moved?.length === 1 && !keys().includes('assets/bot9.png') && fs.existsSync(path.join(keptRoot, c.id, 'bot9.png')));
    stop();
    fs.renameSync(path.join(archiveRoot, 'characters', c.id), path.join(root, 'characters', c.id));
    console.log('     (killed the server; moved Bot 0009 back by hand, image names not returned)');
    console.log('    ', start());
    tab = await client(base).login();
    const db3 = (await tab.readDb()).db;
    const bot9 = db3.characters.find(x => x.name === 'Bot 0009');
    const image = bot9 ? await tab.asset(bot9.image) : { status: 'missing bot' };
    ok('bot is back in the list after restart', Boolean(bot9), `characters ${db3.characters.length}`);
    ok('its images were returned during startup recovery', image.status === 200, JSON.stringify(image));
    ok('no kept image names left behind', fs.readdirSync(keptRoot).length === 0);
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });
