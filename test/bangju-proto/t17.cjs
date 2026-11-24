'use strict';
// 내용이 똑같은 봇 찾기(server/node/bangju/twins.cjs): 무엇을 같다고 보고 무엇을 다르다고 보는지,
// 그리고 한 번 읽은 봇은 파일이 바뀔 때만 다시 읽는지. 서버 없이 임시 폴더에서 돈다.
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { contentPrint, createTwins } = require('../../server/node/bangju/twins.cjs');
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const card = extra => ({
    type: 'character', chaId: 'id-1', name: '아리아', desc: '도서관 사서. 조용하다.', firstMessage: '어서 와.', notes: '', chatPage: 0,
    image: 'assets/aaa.png', emotionImages: [['happy', 'assets/bbb.png']], additionalAssets: [],
    globalLore: [{ key: '도서관', content: '오래된 도서관이다.', insertorder: 100, alwaysActive: false }],
    customscript: [{ comment: 'trim', in: '\\s+$', out: '', type: 'editdisplay' }], triggerscript: [], tags: ['판타지'],
    ...extra,
});
const base = contentPrint(card());

ok('a print is made', /^[0-9a-f]{32}$/.test(base), base);
ok('the same card imported again (new id, new chat page, new use time) is the same', contentPrint(card({ chaId: 'id-2', chatPage: 3, lastInteraction: 1700000000000, reloadKeys: 4, firstMsgIndex: 1, chatFolders: [{ id: 'f' }], modules: ['m1'] })) === base);
ok('the order of fields does not matter', contentPrint(Object.fromEntries(Object.entries(card()).reverse())) === base);
ok('an empty field and a missing one are the same', contentPrint(card({ personality: '', alternateGreetings: [], extentions: {}, utilityBot: false, license: null })) === base);
ok('one changed letter in the description is a different bot', contentPrint(card({ desc: '도서관 사서. 조용하다!' })) !== base);
ok('a changed lorebook entry is a different bot', contentPrint(card({ globalLore: [{ key: '도서관', content: '새 도서관이다.', insertorder: 100, alwaysActive: false }] })) !== base);
ok('a changed regex is a different bot', contentPrint(card({ customscript: [{ comment: 'trim', in: '\\s+$', out: ' ', type: 'editdisplay' }] })) !== base);
ok('a different picture is a different bot', contentPrint(card({ image: 'assets/ccc.png' })) !== base);
ok('a different name is a different bot', contentPrint(card({ name: '아리아 2' })) !== base);
ok('a number that differs is a different bot', contentPrint(card({ globalLore: [{ key: '도서관', content: '오래된 도서관이다.', insertorder: 200, alwaysActive: false }] })) !== base);
ok('the order of lorebook entries matters', contentPrint(card({ globalLore: [{ key: 'a', content: '1' }, { key: 'b', content: '2' }] })) !== contentPrint(card({ globalLore: [{ key: 'b', content: '2' }, { key: 'a', content: '1' }] })));
ok('imported voice data differs only by its random id: the same', contentPrint(card({ vits: { name: 'Imported VITS', files: { a: 'x' }, id: 'r1' } })) === contentPrint(card({ vits: { name: 'Imported VITS', files: { a: 'x' }, id: 'r2' } })));
ok('blank new bots are not compared', contentPrint({ type: 'character', chaId: 'x', name: '새 캐릭터', desc: '', firstMessage: '' }) === '' && contentPrint({ name: '', desc: 'x' }) === '' && contentPrint(null) === '' && contentPrint([]) === '');

(async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bangju-twins-'));
    const cacheFile = path.join(work, 'archive', 'content-prints.json');
    const file = (side, id, data) => { const target = path.join(work, side, id, 'metadata.json'); fs.mkdirSync(path.dirname(target), { recursive: true }); if (data) fs.writeFileSync(target, JSON.stringify(data)); return target; };
    const active = [{ id: 'a1', file: file('active', 'a1', card({ chaId: 'new' })) }, { id: 'a2', file: file('active', 'a2', card({ name: '다른 봇', desc: '전혀 다른 봇' })) }, { id: 'a3', file: file('active', 'a3', null) }];
    const archived = [{ id: 'r1', file: file('archived', 'r1', card({ chaId: 'old', chatPage: 7 })) }, { id: 'r2', file: file('archived', 'r2', card({ desc: '도서관 사서. 시끄럽다.' })) }, { id: 'r3', file: file('archived', 'r3', card({ chaId: 'older' })) }];
    const settle = async finder => { for (let i = 0; i < 200 && finder.pending(); i++) await sleep(10); };

    const finder = createTwins({ cacheFile });
    ok('nothing is claimed before the files are read', JSON.stringify(finder.twins()) === '{"active":{},"archived":{}}');
    finder.look(active, archived, { force: true });
    ok('reading goes on in the background', finder.pending() > 0);
    await settle(finder);
    const found = finder.twins();
    ok('a bot in use and the archived bots with the same content find each other', JSON.stringify(found.active) === '{"a1":["r1","r3"]}' && JSON.stringify(found.archived) === '{"r1":["a1"],"r3":["a1"]}', JSON.stringify(found));
    ok('two archived bots alike with nothing in use alike would not be reported', !('r2' in found.archived) && !('a2' in found.active));
    const kept = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    ok('the prints are kept in one file of its own; a bot whose file is missing has none', kept.schemaVersion === 1 && Object.keys(kept.prints).sort().join() === 'a:a1,a:a2,r:r1,r:r2,r:r3');

    // a restart: nothing is read again while the files are unchanged
    const again = createTwins({ cacheFile });
    again.look(active, archived, { force: true });
    ok('after a restart unchanged bots are not read again', again.pending() === 0 && JSON.stringify(again.twins()) === JSON.stringify(found));
    again.look(active, archived);
    ok('looking again right away does nothing', again.pending() === 0);

    // the bot in use is edited: no longer the same
    await sleep(20);
    fs.writeFileSync(active[0].file, JSON.stringify(card({ chaId: 'new', desc: '도서관 사서. 조용하다. (고침)' })));
    again.look(active, archived, { force: true });
    ok('only the changed bot is read again', again.pending() === 1 || again.pending() === 2);
    await settle(again);
    ok('an edited bot is no longer reported', JSON.stringify(again.twins()) === '{"active":{},"archived":{}}', JSON.stringify(again.twins()));

    // the archived bot comes back (it is in use now): the pair is on one side, so nothing is reported; bots that left are forgotten
    fs.writeFileSync(active[0].file, JSON.stringify(card({ chaId: 'new' })));
    again.look([active[0], { id: 'r1', file: archived[0].file }], [archived[1]], { force: true });
    await settle(again);
    ok('two alike bots that are both in use are not reported, and bots that left are forgotten', JSON.stringify(again.twins()) === '{"active":{},"archived":{}}'
        && Object.keys(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).prints).sort().join() === 'a:a1,a:r1,r:r2');

    // a damaged card file is skipped, not fatal
    fs.writeFileSync(archived[1].file, '{ not json');
    again.look([active[0]], [archived[1], archived[2]], { force: true });
    await settle(again);
    ok('an unreadable card is skipped and the rest still work', JSON.stringify(again.twins()) === '{"active":{"a1":["r3"]},"archived":{"r3":["a1"]}}', JSON.stringify(again.twins()));

    fs.rmSync(work, { recursive: true, force: true });
})().catch(e => { console.error('TEST FAILED', e); process.exit(1); });
