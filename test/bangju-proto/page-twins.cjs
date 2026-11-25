'use strict';
// 내용이 똑같은 봇 알림(실제 서버와 실제 브라우저): 보관해 둔 봇과 내용이 100% 같은 봇을 새로 가져왔을 때.
// 사용: node page-twins.cjs <base>   (서버는 BANGJU_ARCHIVE_SETTLE=now, seed2 자료 12개)
const crypto = require('node:crypto');
const puppeteer = require('puppeteer-core');
const { client, serverHash } = require('./h.cjs');
const base = process.argv[2];
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// the way an import makes a bot: the same card, a new id, one new empty chat
const imported = (character, change = {}) => ({ ...structuredClone(character), chaId: crypto.randomUUID(), chatPage: 0,
    chats: [{ id: crypto.randomUUID(), message: [], note: '', name: 'Chat 1', localLore: [] }], ...change });

(async () => {
    let tab = await client(base).login();
    const read = await tab.readDb();
    const original = name => read.db.characters.find(c => c.name === name);
    const same = imported(original('Bot 0002'));
    const nearly = imported(original('Bot 0004'), { desc: original('Bot 0004').desc + '!' });
    // the app uploads the whole list when a bot is added
    const added = await tab.writeDb({ ...read.db, characters: [...read.db.characters, same, nearly] }, read.etag);
    ok('two bots are imported: one identical to Bot 0002, one a letter off Bot 0004', added.status === 200, `${added.status}`);

    const list = (await tab.get('/api/bangju/archive')).json;
    // the originals have two chats, the imported ones one
    const idOf = (name, chats) => list.active.find(c => c.name === name && c.chats === chats)?.id;
    const [old2, new2, old4, new4, old3] = [idOf('Bot 0002', 2), idOf('Bot 0002', 1), idOf('Bot 0004', 2), idOf('Bot 0004', 1), idOf('Bot 0003', 2)];
    ok('both copies are listed', Boolean(old2 && new2 && old4 && new4 && old3), JSON.stringify(list.active.filter(c => /000[24]/.test(c.name)).map(c => [c.name, c.chats])));
    const moved = await tab.post('/api/bangju/archive/move', { ids: [old2, old4, old3], direction: 'archive' });
    ok('the originals are archived', moved.status === 200 && moved.json.moved.length === 3, JSON.stringify(moved.json).slice(0, 200));

    tab = await client(base).login();
    const twinsNow = async () => {
        let answer = null;
        for (let i = 0; i < 100; i++) {
            answer = (await tab.get('/api/bangju/archive/twins?fresh=1')).json;
            if (answer && !answer.pending) break;
            await sleep(100);
        }
        return answer;
    };
    const first = await twinsNow();
    ok('the server pairs the imported bot with the archived one that has the same content, and nothing else',
        JSON.stringify(first.active) === JSON.stringify({ [new2]: [old2] }) && JSON.stringify(first.archived) === JSON.stringify({ [old2]: [new2] }), JSON.stringify(first));
    const anonymous = await fetch(`${base}/api/bangju/archive/twins`);
    ok('the answer needs a sign-in', anonymous.status === 401 || anonymous.status === 400 || anonymous.status === 403, String(anonymous.status));

    const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    const asked = [];
    page.on('pageerror', e => errors.push(String(e)));
    let reply = 'no';
    page.on('dialog', dialog => { asked.push(dialog.message()); if (reply === 'yes') dialog.accept(); else dialog.dismiss(); });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    const open = async () => {
        await page.goto(`${base}/bangju/archive`, { waitUntil: 'domcontentloaded' });
        await page.type('#password', 'test1234');
        await page.click('#loginButton');
        await page.waitForFunction(() => document.querySelectorAll('#list .row').length > 0, { timeout: 15000 });
    };
    const marked = () => page.$$eval('#list .row', rows => rows.filter(row => row.querySelector('.twin')).map(row => row.querySelector('.name').textContent + '=' + row.querySelector('.twin').textContent).join(' | '));
    const button = () => page.$eval('#twinsOnly', b => (b.classList.contains('hidden') ? '(hidden)' : b.textContent + '/' + b.getAttribute('aria-pressed')));
    const rows = () => page.$$eval('#list .row', list => list.length);

    await open();
    await page.waitForFunction(() => document.querySelector('#list .row .twin'), { timeout: 15000 });
    ok('쓰는 것: only the identical bot is marked', await marked() === 'Bot 0002=보관함에 똑같은 봇 있음', await marked());
    ok('a button offers to show only those', await button() === '똑같은 봇만 보기 (1개)/false', await button());
    const all = await rows();
    await page.click('#twinsOnly');
    await sleep(200);
    ok('pressing it leaves only the identical bot', await rows() === 1 && await marked() === 'Bot 0002=보관함에 똑같은 봇 있음' && (await button()).startsWith('전부 보기 (똑같은 봇 1개만 보는 중)/true'), `${await rows()} ${await button()}`);
    await page.click('#twinsOnly');
    await sleep(200);
    ok('pressing it again shows everything', await rows() === all && all > 5);

    await page.click('#tabArchived');
    await sleep(300);
    ok('보관함: the archived bot is marked too, the others are not', await marked() === 'Bot 0002=쓰는 것에 똑같은 봇 있음' && await rows() === 3, await marked());
    // bringing it back would make two of the same bot: the question says so
    await page.$$eval('#list .row', list => list.forEach(row => row.querySelector('input').click()));
    await page.click('#moveButton');
    await sleep(300);
    ok('before bringing bots back it warns how many would be doubled', asked.length === 1 && asked[0].includes('3개를 불러오기할까요?') && asked[0].includes('이 가운데 1개는 내용이 똑같은 봇이 이미 "쓰는 것"에 있습니다') && asked[0].includes('두 개가 됩니다') && asked[0].includes('건너뜁니다'), asked.join(' / '));
    ok('answering no moves nothing', (await tab.get('/api/bangju/archive')).json.archived.length === 3);

    // the imported bot is edited by one letter: it is a different bot now
    const now = await tab.readDb();
    const at = now.db.characters.findIndex(c => c.chaId === same.chaId);
    const edited = await tab.patchDb([{ op: 'replace', path: `/characters/${at}/desc`, value: same.desc + '?' }], serverHash(now.db));
    // the server writes an edit to the bot's file a few seconds later; the comparison follows the file
    let second = null;
    for (let i = 0; i < 40; i++) {
        second = await twinsNow();
        if (JSON.stringify(second.active) === '{}') break;
        await sleep(500);
    }
    ok('after one letter changes, nothing is reported (once the server has saved the edit)', edited.status === 200 && JSON.stringify(second.active) === '{}' && JSON.stringify(second.archived) === '{}', `${edited.status} ${JSON.stringify(second)}`);
    await open();
    await sleep(1500);
    ok('and the page shows no mark and no button', await marked() === '' && await button() === '(hidden)', `${await marked()} ${await button()}`);

    // Saying yes: the archived original comes back although the same card was imported again meanwhile.
    // The server gives a newly imported bot a folder name of its own ("이름 (2)"), so nothing is overwritten and both stay.
    const stowed = await tab.post('/api/bangju/archive/move', { ids: [new2], direction: 'archive' });
    tab = await client(base).login();
    const later = await tab.readDb();
    const once = imported(original('Bot 0002'));
    const addedAgain = await tab.writeDb({ ...later.db, characters: [...later.db.characters, once] }, later.etag);
    ok('the edited copy is archived and the original card is imported once more', stowed.status === 200 && stowed.json.moved.length === 1 && addedAgain.status === 200, `${stowed.status} ${addedAgain.status}`);
    await open();
    await page.click('#tabArchived');
    await page.waitForFunction(() => document.querySelector('#list .row .twin'), { timeout: 15000 });
    // two archived rows are called Bot 0002: the original (identical to the new import, so marked) and the edited copy (not marked)
    const picked = await page.$$eval('#list .row', list => { const row = list.find(item => item.querySelector('.name').textContent === 'Bot 0002' && item.querySelector('.twin')); if (row) row.querySelector('input').click(); return Boolean(row); });
    reply = 'yes';
    asked.length = 0;
    await page.click('#moveButton');
    await page.waitForFunction(() => /완료/.test(document.getElementById('result').textContent), { timeout: 20000 });
    const result = await page.$eval('#result', box => box.textContent);
    ok('bringing back the marked bot warns first, then brings it back', picked && asked.length === 1 && asked[0].includes('이 가운데 1개는 내용이 똑같은 봇이 이미') && result.includes('불러오기 1개 완료, 실패 0개'), `${asked.join(' / ')} :: ${result.slice(0, 120)}`);
    tab = await client(base).login();
    const after = (await tab.get('/api/bangju/archive')).json;
    const both = after.active.filter(c => c.name === 'Bot 0002');
    ok('nothing was overwritten: both bots are in use, the original with its two chats and the new import with one', both.length === 2 && both.map(c => c.chats).sort().join() === '1,2'
        && after.archived.filter(c => c.name === 'Bot 0002').length === 1, JSON.stringify(both.map(c => c.chats)));
    const last = await twinsNow();
    ok('two identical bots that are both in use are not reported', JSON.stringify(last.active) === '{}' && JSON.stringify(last.archived) === '{}', JSON.stringify(last));

    ok('the page ran without script errors', errors.length === 0, errors.slice(0, 3).join(' ; '));
    await browser.close();
})().catch(e => { console.error('PAGE TEST FAILED', e); process.exit(1); });
