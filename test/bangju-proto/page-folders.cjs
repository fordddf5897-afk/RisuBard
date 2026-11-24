'use strict';
// 화면의 폴더 보기(실제 브라우저): 폴더 고르기, 폴더별로 묶기, 줄마다 폴더 이름.
// 사용: node page-folders.cjs <base>   (서버는 BANGJU_ARCHIVE_SETTLE=now, seed2 자료 12개)
const puppeteer = require('puppeteer-core');
const { client, serverHash } = require('./h.cjs');
const base = process.argv[2];
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const tab = await client(base).login();
    const read = await tab.readDb();
    const cha = name => read.db.characters.find(c => c.name === name).chaId;
    const first = [cha('Bot 0003'), cha('Bot 0005'), cha('Bot 0007')];
    const second = [cha('Bot 0001'), cha('Bot 0002')];
    const rest = read.db.characters.map(c => c.chaId).filter(id => !first.includes(id) && !second.includes(id));
    await tab.patchDb([{ op: 'replace', path: '/characterOrder', value: [
        { name: '자주 쓰는 것', data: first, color: '', id: 'folder-1' }, { name: '판타지', data: second, color: '', id: 'folder-2' }, ...rest] }], serverHash(read.db));
    const list = (await tab.get('/api/bangju/archive')).json;
    const idOf = name => list.active.find(c => c.name === name).id;
    await tab.post('/api/bangju/archive/move', { ids: [idOf('Bot 0005'), idOf('Bot 0001'), idOf('Bot 0010')], direction: 'archive' });
    // the app, opened afterwards, does what it always does: drops the bots that left from its folder list
    const reopened = await client(base).login();
    const now = await reopened.readDb();
    const gone = new Set([cha('Bot 0005'), cha('Bot 0001'), cha('Bot 0010')]);
    await reopened.patchDb([{ op: 'replace', path: '/characterOrder', value: now.db.characterOrder
        .filter(item => typeof item !== 'string' || !gone.has(item))
        .map(item => (typeof item === 'string' ? item : { ...item, data: item.data.filter(id => !gone.has(id)) })) }], serverHash(now.db));

    const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', dialog => dialog.accept());
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.goto(`${base}/bangju/archive`, { waitUntil: 'domcontentloaded' });
    await page.type('#password', 'test1234');
    await page.click('#loginButton');
    await page.waitForFunction(() => document.querySelectorAll('#list .row').length > 0, { timeout: 15000 });
    const names = () => page.$$eval('#list > *', nodes => nodes.filter(node => !node.classList.contains('more'))
        .map(node => (node.classList.contains('group') ? '[' + node.textContent + ']' : node.querySelector('.name').textContent)).join(' | '));

    const options = await page.$$eval('#folder option', list => list.map(option => option.textContent).join(' | '));
    ok('the folder box offers the app\'s folders', options === '모든 폴더 | 자주 쓰는 것 | 판타지 | 폴더 없음', options);

    await page.select('#sort', 'name');
    await page.select('#folder', 'folder-1');
    await sleep(200);
    const inFirst = await names();
    ok('쓰는 것: one folder shows only its bots', inFirst === 'Bot 0003 | Bot 0007', inFirst);

    await page.click('#tabArchived');
    await sleep(200);
    const archivedFirst = await names();
    ok('보관함: the same folder shows the bot that was archived out of it', archivedFirst === 'Bot 0005', archivedFirst);

    await page.select('#folder', '*');
    await page.select('#sort', 'folder');
    await sleep(200);
    const groupedArchive = await names();
    ok('보관함: grouped by folder, in the app\'s folder order', groupedArchive === '[자주 쓰는 것 · 1개] | Bot 0005 | [판타지 · 1개] | Bot 0001 | [폴더 없음 · 1개] | Bot 0010', groupedArchive);

    await page.click('#tabActive');
    await sleep(200);
    const groupedActive = await names();
    ok('쓰는 것: grouped by folder', groupedActive.startsWith('[자주 쓰는 것 · 2개] | Bot 0003 | Bot 0007 | [판타지 · 1개] | Bot 0002 | [폴더 없음 · 6개] | '), groupedActive);

    // B7: every sort can be turned upside down; the button says which end comes first
    const flipLabel = () => page.$eval('#sortFlip', button => button.textContent + '/' + button.getAttribute('aria-pressed'));
    const rowNames = () => page.$$eval('#list .row .name', nodes => nodes.map(node => node.textContent));
    ok('the flip button says which end comes first', await flipLabel() === '⇅ 폴더 순서대로/false', await flipLabel());
    await page.click('#sortFlip');
    await sleep(200);
    const groupedFlipped = await names();
    ok('grouped by folder, flipped: the folders come in reverse and each keeps its name order', await flipLabel() === '⇅ 폴더 순서 거꾸로/true'
        && groupedFlipped.startsWith('[폴더 없음 · 6개] | ') && groupedFlipped.endsWith(' | [판타지 · 1개] | Bot 0002 | [자주 쓰는 것 · 2개] | Bot 0003 | Bot 0007'), groupedFlipped);
    await page.select('#sort', 'name');
    await sleep(200);
    const forward = await rowNames();
    ok('another sort starts the usual way round', await flipLabel() === '⇅ 가나다순/false' && forward.join() === [...forward].sort((a, b) => a.localeCompare(b, 'ko')).join(), forward.join(' '));
    await page.click('#sortFlip');
    await sleep(200);
    const backward = await rowNames();
    ok('name order flips', await flipLabel() === '⇅ 가나다 거꾸로/true' && backward.join() === [...forward].reverse().join() && backward.length === forward.length, backward.join(' '));
    // the sizes the server reports, in the order the rows are drawn
    const listed = (await reopened.get('/api/bangju/archive')).json;
    const bytesOf = new Map((listed.active || []).map(item => [item.name, item.cardBytes || 0]));
    const sizes = async () => (await rowNames()).map(name => bytesOf.get(name));
    await page.select('#sort', 'size');
    await sleep(200);
    const big = await sizes();
    await page.click('#sortFlip');
    await sleep(200);
    const small = await sizes();
    ok('size order flips: largest first, then smallest first', big.every((bytes, at) => at === 0 || big[at - 1] >= bytes) && small.every((bytes, at) => at === 0 || small[at - 1] <= bytes)
        && big.length === small.length && big.length > 3 && big[0] > big[big.length - 1] && await flipLabel() === '⇅ 작은 것부터/true', `${big.join()} / ${small.join()}`);
    await page.select('#sort', 'idle');
    await sleep(200);
    const idle = await rowNames();
    await page.click('#sortFlip');
    await sleep(200);
    const idleFlipped = await rowNames();
    await page.select('#sort', 'recent');
    await sleep(200);
    ok('longest-unused flipped is the same list as most recent', idleFlipped.length === idle.length && await flipLabel() === '⇅ 최근에 쓴 것부터/false');
    await page.select('#sort', 'name');
    await sleep(200);
    ok('each sort remembers its own direction while the page is open', await flipLabel() === '⇅ 가나다 거꾸로/true' && (await rowNames()).join() === backward.join());
    await page.click('#sortFlip');
    await page.select('#sort', 'folder');
    await page.click('#sortFlip');
    await sleep(200);
    ok('flipping back restores the usual order', await flipLabel() === '⇅ 폴더 순서대로/false' && (await names()) === groupedActive, await names());

    await page.select('#sort', 'name');
    await sleep(200);
    const chips = await page.$$eval('#list .row', rows => rows.filter(row => row.querySelector('.in-folder'))
        .map(row => row.querySelector('.name').textContent + '=' + row.querySelector('.in-folder').textContent).join(' | '));
    ok('other orders show each bot\'s folder on its row', chips === 'Bot 0002=폴더: 판타지 | Bot 0003=폴더: 자주 쓰는 것 | Bot 0007=폴더: 자주 쓰는 것', chips);

    // "찾은 것 모두 고르기" follows the folder filter: restoring a whole folder is two taps.
    await page.click('#tabArchived');
    await page.select('#folder', 'folder-2');
    await sleep(200);
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '찾은 것 모두 고르기').click());
    await page.click('#moveButton');
    await page.waitForFunction(() => /불러오기 1개 완료/.test(document.getElementById('result').innerText), { timeout: 30000 });
    const result = await page.$eval('#result', element => element.innerText);
    ok('restoring what the folder filter shows puts it back into that folder', /원래 자리로 돌려놓음: 1개 \(그 가운데 폴더 안으로 1개\)/.test(result), result.replace(/\n/g, ' / ').slice(0, 200));
    const after = await (await client(base).login()).readDb();
    const folder = after.db.characterOrder.find(item => item && item.id === 'folder-2');
    ok('the app sees the bot in its folder again, at its old place', folder && folder.data.join() === second.join(), JSON.stringify(folder && folder.data.length));
    ok('the page ran without script errors', errors.length === 0, errors.join('; '));
    await browser.close();
})().catch(e => { console.error('PAGE TEST FAILED', e); process.exit(1); });
