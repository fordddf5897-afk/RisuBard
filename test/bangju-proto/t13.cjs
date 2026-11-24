'use strict';
// 백업과 자리 옮김.
//   1) 예전 버전이 쓰던 자리(bangju/archive/…)의 보관함이 서버를 켤 때 새 자리(risubard/bangju-archive/…)로 옮겨지는지
//   2) 앱의 전체 백업에 보관된 봇이 들어가고, 그림 이름표 폴더는 들어가지 않는지
//   3) 그 백업을 빈 서버에 되돌리면 보관함이 같이 돌아오고, 불러온 봇의 그림이 보이는지
// 사용: node t13.cjs <base1> <root1> <port1> <log1> <base2> <root2>   (둘 다 BANGJU_ARCHIVE_SETTLE=now, 두 번째는 빈 서버)
const fs = require('node:fs'); const path = require('node:path'); const { execSync } = require('node:child_process');
const { client } = require('./h.cjs');
const { listCanonicalBackupEntries } = require('../../server/node/canonical-backup-inventory.cjs');
const [base1, root1, port1, log1, base2, root2] = process.argv.slice(2);
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
const stop = () => execSync(`${path.join(__dirname, 'stop.sh')} ${port1}`, { stdio: 'pipe' });
const start = () => execSync(`${path.join(__dirname, 'srv.sh')} ${port1} ${root1} ${log1}`, { stdio: 'pipe' }).toString().trim();
(async () => {
    let tab = await client(base1).login();
    await tab.readDb();
    const list0 = (await tab.get('/api/bangju/archive')).json;
    const ids = ['Bot 0003', 'Bot 0012'].map(name => list0.active.find(c => c.name === name).id);
    const moved = await tab.post('/api/bangju/archive/move', { ids, direction: 'archive' });
    ok('setup: two bots with images archived', moved.json.moved.length === 2 && moved.json.assets.protected === 6, JSON.stringify(moved.json.assets));

    // 1) put the archive where the earlier version kept it, then start the server again
    stop();
    const older = path.join(root1, 'bangju/archive'); const newer = path.join(root1, 'risubard/bangju-archive');
    for (const name of ['characters', 'references', 'index.json']) fs.renameSync(path.join(newer, name), path.join(older, name));
    fs.rmSync(newer, { recursive: true, force: true });
    start();
    tab = await client(base1).login(); await tab.readDb();
    const list1 = (await tab.get('/api/bangju/archive')).json;
    ok('an archive from the earlier version is moved to the new place at startup', fs.existsSync(path.join(newer, 'characters', ids[0])) && fs.existsSync(path.join(newer, 'index.json'))
        && !fs.existsSync(path.join(older, 'characters')) && !fs.existsSync(path.join(older, 'index.json')) && fs.existsSync(path.join(older, 'assets', ids[0])),
        `new place: ${fs.readdirSync(newer).join(', ')}; old place: ${fs.readdirSync(older).join(', ')}`);
    ok('the list is unchanged by the move', list1.totals.archived === 2 && list1.totals.active === list0.totals.active - 2 && list1.totals.unprotectedBots === 0
        && list1.archived.every(c => ids.includes(c.id)), `archived ${list1.totals.archived}, active ${list1.totals.active}`);

    // 2) what the app's own backup would carry
    const entries = (await listCanonicalBackupEntries(root1)).map(entry => entry.sortKey.replace('risubard-data/', ''));
    const ours = entries.filter(name => name.startsWith('risubard/bangju-archive/'));
    ok('the backup carries the archived bots (card, chats, list) and not the image-name folder',
        ids.every(id => ours.includes(`risubard/bangju-archive/characters/${id}/metadata.json`)) && ours.includes('risubard/bangju-archive/index.json')
        && ours.some(name => name.endsWith('/messages.jsonl')) && ours.includes(`risubard/bangju-archive/references/${ids[0]}.json`)
        && !entries.some(name => name.startsWith('bangju/')), `${ours.length} entries under risubard/bangju-archive, ${entries.filter(name => name.startsWith('bangju/')).length} under bangju/`);

    // 3) a real backup, restored into an empty server
    const exported = await fetch(`${base1}/api/backup/export`, { headers: tab.headers() });
    const backup = Buffer.from(await exported.arrayBuffer());
    let tab2 = await client(base2).login(); await tab2.readDb();
    await tab2.post('/api/backup/import/prepare', { size: backup.length });
    const imported = await fetch(`${base2}/api/backup/import`, { method: 'POST', headers: tab2.headers({ 'content-type': 'application/octet-stream', 'content-length': String(backup.length) }), body: backup });
    ok('backup exported and restored into an empty server', exported.status === 200 && imported.status === 200, `export ${exported.status} ${backup.length} bytes, import ${imported.status}`);
    tab2 = await client(base2).login();
    const db2 = await tab2.readDb();
    const list2 = (await tab2.get('/api/bangju/archive')).json;
    ok('the archive came back with the backup', db2.db.characters.length === list0.totals.active - 2 && list2.totals.archived === 2 && list2.archived.some(c => c.name === 'Bot 0012')
        && list2.totals.unprotectedBots === 2, `in use ${db2.db.characters.length}, archived ${list2.totals.archived}, without image names ${list2.totals.unprotectedBots}`);
    await tab2.post('/api/db/orphans/cleanup', {});
    const still = await tab2.asset('assets/bot3.png');
    ok('the app\'s cleanup on the restored server leaves the archived bots\' images alone', still.status === 200, JSON.stringify(still));
    const checked = await tab2.post('/api/bangju/archive/recheck', {});
    const list3 = (await tab2.get('/api/bangju/archive')).json;
    ok('"다시 확인" gives the restored archive its image names', checked.json.totals.added === 6 && checked.json.totals.missing === 0 && list3.totals.unprotectedBots === 0, JSON.stringify(checked.json.totals));
    const back = await tab2.post('/api/bangju/archive/move', { ids, direction: 'restore' });
    tab2 = await client(base2).login();
    const db3 = (await tab2.readDb()).db;
    const bot12 = db3.characters.find(c => c.name === 'Bot 0012');
    const image = bot12 ? await tab2.asset(bot12.image) : { status: 'missing' };
    const chatOnly = await tab2.asset('assets/chatonly-12.png');
    ok('bots restored on the other server, images and chats with them', back.json.moved.length === 2 && db3.characters.length === list0.totals.active && image.status === 200 && chatOnly.status === 200
        && bot12.chats.length === 2, JSON.stringify({ moved: back.json.moved?.length, characters: db3.characters.length, image: image.status, chatOnly: chatOnly.status }));
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });
