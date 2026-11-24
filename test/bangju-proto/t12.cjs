'use strict';
// B3 화면이 쓰는 서버 쪽: 목록의 태그·표지·마지막 대화 날짜, 표지 그림 주소, 예전 보관분의 목록 정보 채우기.
// 서버는 바로 정리 방식(BANGJU_ARCHIVE_SETTLE=now)으로 켠다. seed2 자료.
const fs = require('node:fs'); const path = require('node:path');
const { client, serverHash } = require('./h.cjs');
const [base, root] = process.argv.slice(2);
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
(async () => {
    let tab = await client(base).login();
    const read = await tab.readDb();
    // give one bot tags, the way the app would save them
    const index = read.db.characters.findIndex(c => c.name === 'Bot 0003');
    const saved = await tab.patchDb([{ op: 'add', path: `/characters/${index}/tags`, value: ['판타지', '  긴 이야기  ', 7, ''] }], serverHash(read.db));
    ok('setup: tags saved through the app\'s own save path', saved.status === 200, `status ${saved.status} ${saved.text.slice(0, 80)}`);
    const cover = async id => {
        const response = await fetch(`${base}/api/bangju/archive/cover/${id}`, { headers: tab.headers() });
        return { status: response.status, type: response.headers.get('content-type'), bytes: Buffer.from(await response.arrayBuffer()) };
    };

    const list0 = (await tab.get('/api/bangju/archive')).json;
    const bot3 = list0.active.find(c => c.name === 'Bot 0003');
    const plain = list0.active.find(c => !c.hasCover);
    ok('the list of bots in use carries tags, cover flag and last-chat date', bot3.hasCover === true && JSON.stringify(bot3.tags) === JSON.stringify(['판타지', '긴 이야기']) && bot3.lastChatAt > 0
        && plain && plain.tags.length === 0, JSON.stringify({ bot3: { tags: bot3.tags, hasCover: bot3.hasCover, lastChatAt: bot3.lastChatAt }, withoutCover: plain?.name }));
    const original = await tab.asset('assets/bot3.png');
    const c0 = await cover(bot3.id);
    ok('cover of a bot in use is its own image', c0.status === 200 && c0.type.startsWith('image/png') && c0.bytes.length === original.bytes, `status ${c0.status}, ${c0.type}, ${c0.bytes.length} bytes`);
    const none = await cover(plain.id);
    const anonymous = await fetch(`${base}/api/bangju/archive/cover/${bot3.id}`);
    ok('no cover: 404; no login: refused', none.status === 404 && anonymous.status >= 400 && anonymous.status < 500, `${none.status}, ${anonymous.status}`);

    const moved = await tab.post('/api/bangju/archive/move', { ids: [bot3.id], direction: 'archive' });
    tab = await client(base).login(); await tab.readDb();
    // Something deletes the image from the app's own store (the app's cleanup itself now leaves it alone).
    await tab.remove('assets/bot3.png');
    const list1 = (await tab.get('/api/bangju/archive')).json;
    const archived = list1.archived.find(c => c.id === bot3.id);
    ok('the archived bot keeps tags, cover flag and last-chat date in the list', moved.json.moved.length === 1 && archived && archived.hasCover === true
        && JSON.stringify(archived.tags) === JSON.stringify(['판타지', '긴 이야기']) && archived.lastChatAt >= bot3.lastChatAt, JSON.stringify(archived));
    const gone = await tab.asset('assets/bot3.png');
    const c1 = await cover(bot3.id);
    ok('its cover still shows after the image is gone from the app\'s own store', gone.status !== 200 && c1.status === 200 && c1.bytes.equals(c0.bytes), `app store ${gone.status}, cover ${c1.status}`);

    // A bot archived by the earlier version: no tags or cover name in the index. "다시 확인" fills them in.
    const indexPath = path.join(root, 'risubard/bangju-archive/index.json');
    const stored = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    for (const entry of stored.characters) { delete entry.tags; delete entry.image; }
    fs.writeFileSync(indexPath, JSON.stringify(stored));
    const before = (await tab.get('/api/bangju/archive')).json.archived.find(c => c.id === bot3.id);
    const checked = await tab.post('/api/bangju/archive/recheck', {});
    const after = (await tab.get('/api/bangju/archive')).json.archived.find(c => c.id === bot3.id);
    ok('recheck fills the list facts of an older archive entry', before.hasCover === false && before.tags.length === 0 && checked.json.totals.listFilled === 1
        && after.hasCover === true && after.tags.length === 2, JSON.stringify({ before: { tags: before.tags, hasCover: before.hasCover }, filled: checked.json.totals.listFilled, after: { tags: after.tags, hasCover: after.hasCover } }));

    const back = await tab.post('/api/bangju/archive/move', { ids: [bot3.id], direction: 'restore' });
    tab = await client(base).login();
    const db = await tab.readDb();
    const restored = db.db.characters.find(c => c.name === 'Bot 0003');
    ok('restored with its tags', back.json.moved.length === 1 && JSON.stringify(restored.tags) === JSON.stringify(['판타지', '  긴 이야기  ', 7, '']), JSON.stringify(restored.tags));
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });
