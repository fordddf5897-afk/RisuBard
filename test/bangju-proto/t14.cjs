'use strict';
// 폴더: 보관했다 불러오면 원래 폴더의 원래 자리로 돌아오는지, 목록이 폴더를 아는지.
// 앱을 열지 않은 상태(서버를 막 켠 뒤)에서도 쓰는 봇의 태그·표지가 채워지는지.
// 사용: BANGJU_ARCHIVE_SETTLE=now node t14.cjs <base> <root> <port> <log>   (서버도 바로 정리 방식, seed2 자료)
const fs = require('node:fs'); const path = require('node:path'); const { execSync } = require('node:child_process');
const { client, serverHash } = require('./h.cjs');
const [base, root, port, log] = process.argv.slice(2);
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stop = () => execSync(`${path.join(__dirname, 'stop.sh')} ${port}`, { stdio: 'pipe' });
const start = () => execSync(`${path.join(__dirname, 'srv.sh')} ${port} ${root} ${log}`, { stdio: 'pipe' }).toString().trim();
const order = () => JSON.parse(fs.readFileSync(path.join(root, 'settings/app.json'), 'utf8')).characterOrder;
(async () => {
    let tab = await client(base).login();
    let read = await tab.readDb();
    const cha = name => read.db.characters.find(c => c.name === name).chaId;
    const [b3, b5, b7] = [cha('Bot 0003'), cha('Bot 0005'), cha('Bot 0007')];
    const others = read.db.characters.map(c => c.chaId).filter(id => ![b3, b5, b7].includes(id));
    const folder = { name: '자주 쓰는 것', data: [b3, b5, b7], color: '', id: 'folder-1' };
    // the way the app saves its folder list
    const saved = await tab.patchDb([{ op: 'replace', path: '/characterOrder', value: [folder, ...others] }], serverHash(read.db));
    ok('setup: a folder with three bots saved through the app', saved.status === 200, `status ${saved.status} ${saved.text.slice(0, 80)}`);

    const list0 = (await tab.get('/api/bangju/archive')).json;
    const idOf = name => list0.active.find(c => c.name === name).id;
    ok('the list knows the app\'s folders', list0.folders.length === 1 && list0.folders[0].name === '자주 쓰는 것'
        && list0.active.filter(c => c.folderId === 'folder-1').map(c => c.name).sort().join() === 'Bot 0003,Bot 0005,Bot 0007'
        && list0.active.filter(c => c.folderId === '').length === list0.totals.active - 3, JSON.stringify(list0.folders));

    // archive the middle one; then the app does what it always does: drops the missing bot from the folder
    const a1 = await tab.post('/api/bangju/archive/move', { ids: [idOf('Bot 0005')], direction: 'archive' });
    tab = await client(base).login(); read = await tab.readDb();
    const cleaned = await tab.patchDb([{ op: 'replace', path: '/characterOrder/0/data', value: [b3, b7] }], serverHash(read.db));
    const list1 = (await tab.get('/api/bangju/archive')).json;
    ok('the archived bot remembers its folder', a1.json.moved.length === 1 && cleaned.status === 200 && list1.archived[0].folderId === 'folder-1' && list1.archived[0].folderName === undefined
        && list1.active.filter(c => c.folderId === 'folder-1').length === 2, JSON.stringify({ folderId: list1.archived[0].folderId, inFolderNow: list1.active.filter(c => c.folderId === 'folder-1').length }));
    const r1 = await tab.post('/api/bangju/archive/move', { ids: [idOf('Bot 0005')], direction: 'restore' });
    tab = await client(base).login(); read = await tab.readDb();
    const back = read.db.characterOrder[0];
    ok('restored into the same folder, at the same place', r1.json.moved.length === 1 && r1.json.foldersRestored === 1 && back.id === 'folder-1' && order()[0].data.includes(b5)
        && JSON.stringify(back.data) === JSON.stringify([b3, b5, b7]) && read.db.characterOrder.length === 1 + others.length, JSON.stringify({ foldersRestored: r1.json.foldersRestored, data: back.data.map(id => read.db.characters.find(c => c.chaId === id)?.name) }));

    // a bot outside folders goes back to its place in the list too
    const loose = others[2];
    const looseId = (await tab.get('/api/bangju/archive')).json.active.find(c => c.id === loose || c.name === read.db.characters.find(x => x.chaId === loose).name).id;
    await tab.post('/api/bangju/archive/move', { ids: [looseId], direction: 'archive' });
    tab = await client(base).login(); read = await tab.readDb();
    await tab.patchDb([{ op: 'replace', path: '/characterOrder', value: read.db.characterOrder.filter(item => item !== loose) }], serverHash(read.db));
    await tab.post('/api/bangju/archive/move', { ids: [looseId], direction: 'restore' });
    tab = await client(base).login(); read = await tab.readDb();
    ok('a bot outside folders returns to its place in the list', read.db.characterOrder.indexOf(loose) === 3, `at ${read.db.characterOrder.indexOf(loose)} of ${read.db.characterOrder.length}`);

    // the folder is deleted while the bot is archived: nothing breaks, the list says where it used to be
    await tab.post('/api/bangju/archive/move', { ids: [idOf('Bot 0007')], direction: 'archive' });
    tab = await client(base).login(); read = await tab.readDb();
    await tab.patchDb([{ op: 'replace', path: '/characterOrder', value: [b3, b5, ...others] }], serverHash(read.db));
    const list2 = (await tab.get('/api/bangju/archive')).json;
    const r2 = await tab.post('/api/bangju/archive/move', { ids: [idOf('Bot 0007')], direction: 'restore' });
    tab = await client(base).login(); read = await tab.readDb();
    ok('folder deleted meanwhile: shown by its old name, restore still works', list2.folders.length === 0 && list2.archived[0].folderName === '자주 쓰는 것'
        && r2.json.moved.length === 1 && !r2.json.foldersRestored && read.db.characters.some(c => c.chaId === b7), JSON.stringify({ folderName: list2.archived[0].folderName, moved: r2.json.moved.length }));

    // a bot archived by the earlier version (no folder remembered): "다시 확인" reads it from the app's list while it is still there
    await tab.patchDb([{ op: 'replace', path: '/characterOrder', value: [{ ...folder, data: [b3, b5] }, b7, ...others] }], serverHash(read.db));
    await tab.post('/api/bangju/archive/move', { ids: [idOf('Bot 0003')], direction: 'archive' });
    const indexPath = path.join(root, 'risubard/bangju-archive/index.json');
    const stored = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    for (const entry of stored.characters) delete entry.order;
    fs.writeFileSync(indexPath, JSON.stringify(stored));
    const checked = await tab.post('/api/bangju/archive/recheck', {});
    const list3 = (await tab.get('/api/bangju/archive')).json;
    ok('recheck finds the folder of an older archive entry', checked.json.totals.foldersFound === 1 && list3.archived[0].folderId === 'folder-1', JSON.stringify(checked.json.totals));
    await tab.post('/api/bangju/archive/move', { ids: [idOf('Bot 0003')], direction: 'restore' });

    // the server was just started and the app has not been opened: tags and covers of the bots in use are read in the background
    stop(); start();
    tab = await client(base).login();
    const cold = (await tab.get('/api/bangju/archive')).json;
    let facts = null;
    for (let i = 0; i < 40; i++) { facts = (await tab.get('/api/bangju/archive/facts')).json; if (!facts.pending) break; await sleep(250); }
    const bot9 = cold.active.find(c => c.name === 'Bot 0009');
    const cover = await fetch(`${base}/api/bangju/archive/cover/${bot9.id}`, { headers: tab.headers() });
    const warm = (await tab.get('/api/bangju/archive')).json;
    ok('without the app opened, covers and tags of bots in use are filled in shortly after', cold.factsPending > 0 && cold.active.every(c => c.hasCover === false)
        && facts.pending === 0 && facts.facts[bot9.id]?.hasCover === true && cover.status === 200
        && warm.factsPending === 0 && warm.active.find(c => c.name === 'Bot 0009').hasCover === true && warm.active.filter(c => c.hasCover).length === 4,
        JSON.stringify({ pendingAtFirst: cold.factsPending, withCoverLater: warm.active.filter(c => c.hasCover).length, cover: cover.status }));
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });
