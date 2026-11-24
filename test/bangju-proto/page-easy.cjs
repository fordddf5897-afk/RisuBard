'use strict';
// 간편 모드 화면(묶음 B)을 실제 브라우저와 실제 앱으로 본다. 앱을 먼저 지어 둬야 한다(dist).
//   E2 보이는 카드만 그리기 · E4 폴더(만들기, 넣고 빼기, 이름 바꾸기, 지우기, 작품 화면에서 옮기기)
//   · 폴더와 보관함(보관하면 폴더에서 빠지고, 불러오면 그 폴더로 돌아오는지를 실제 앱으로)
//   · E1 기존 화면 버튼 · E3 모듈·플러그인 바로 열기 · 보관함 열기
// 사용: node page-easy.cjs <base> <root>   (서버는 BANGJU_ARCHIVE_SETTLE=now, seed2 자료 240개)
const fs = require('node:fs'); const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { client, serverHash } = require('./h.cjs');
const [base, root] = process.argv.slice(2);
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// What the server has written to disk: the app saves a moment after each change.
const savedOrder = () => { try { return JSON.parse(fs.readFileSync(path.join(root, 'settings/app.json'), 'utf8')).characterOrder || []; } catch { return []; } };
const savedFolder = name => savedOrder().find(item => item && typeof item === 'object' && item.name === name);
async function until(check, ms = 20000) { const end = Date.now() + ms; for (;;) { const value = await check(); if (value) return value; if (Date.now() > end) return value; await sleep(250); } }

(async () => {
    const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
    // The app asks before leaving a page whose session another sign-in took over (the test's own API calls do that).
    page.on('dialog', dialog => dialog.accept().catch(() => {}));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

    // Opens the app in easy mode and signs in if asked.
    async function open() {
        await page.goto(`${base}/?easy`, { waitUntil: 'domcontentloaded' });
        const end = Date.now() + 60000;
        while (Date.now() < end) {
            if (await page.$('[data-easy-home]')) return true;
            if (await page.$('#alert-input')) { await page.type('#alert-input', 'test1234'); await page.keyboard.press('Enter'); await sleep(600); }
            await sleep(300);
        }
        return false;
    }
    const cards = () => page.$$eval('[data-easy-work-card]', list => list.length);
    const chips = () => page.$$eval('[data-easy-folders] button', list => list.map(button => button.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
    const cardNames = () => page.$$eval('[data-easy-work-card] p.font-semibold', list => list.map(item => item.textContent.trim()).sort().join(','));
    const clickText = (selector, text) => page.evaluate((s, t) => { const hit = [...document.querySelectorAll(s)].find(node => node.textContent.replace(/\s+/g, ' ').trim().startsWith(t)); if (hit) hit.click(); return !!hit; }, selector, text);
    const answerInput = async text => { await page.waitForSelector('#alert-input', { timeout: 10000 }); await page.type('#alert-input', text); await page.keyboard.press('Enter'); await sleep(400); };
    const closeSheet = async () => { await page.evaluate(() => document.querySelector('[data-easy-sheet] header button')?.click()); await sleep(300); };

    ok('the app opens on the easy-mode home', await open());

    // E2: only the first cards are drawn; more come as the end is reached
    const first = await cards();
    await page.evaluate(() => { const scroller = document.querySelector('[data-easy-home]'); scroller.scrollTop = scroller.scrollHeight; });
    const more = await until(async () => (await cards()) > first && cards(), 8000);
    ok('the home draws 60 of 240 cards, then more when the end comes into view', first === 60 && more === 120, `first ${first}, after scrolling ${more}`);
    await page.evaluate(() => { document.querySelector('[data-easy-home]').scrollTop = 0; });

    // E4: a new folder, straight into choosing its works
    ok('without folders only "새 폴더" is offered', await chips() === '새 폴더', await chips());
    await page.click('[data-easy-folder-add]');
    await answerInput('판타지');
    await page.waitForSelector('[data-easy-folder-editor]', { timeout: 10000 });
    await page.type('[data-easy-folder-search]', 'Bot 000');
    await sleep(300);
    for (const name of ['Bot 0003', 'Bot 0005', 'Bot 0007']) await clickText('[data-easy-folder-work]', name);
    await sleep(300);
    const ticked = await page.$$eval('[data-easy-folder-work][aria-checked="true"]', list => list.map(row => row.textContent.trim()).join(','));
    ok('ticking works in the folder editor puts them in at once', ticked === 'Bot 0003,Bot 0005,Bot 0007', ticked);
    await closeSheet();
    const afterCreate = await chips();
    ok('the home shows the folder with its count, and the rest as "폴더 없음"', afterCreate === '새 폴더 | 모든 폴더 | 판타지 3 | 폴더 없음 237' && await cards() === 3 && await cardNames() === 'Bot 0003,Bot 0005,Bot 0007', `${afterCreate} / cards ${await cards()}`);
    const written = await until(() => savedFolder('판타지')?.data.length === 3 && savedFolder('판타지'));
    ok('it is RisuAI\'s own folder list that was written', !!written && typeof written.id === 'string' && written.id.length > 8 && written.color === 'default', JSON.stringify(written && { name: written.name, works: written.data.length }));

    // a second folder with the same name is refused; another name works
    await page.click('[data-easy-folder-add]');
    await answerInput('판타지');
    await sleep(500);
    await page.keyboard.press('Enter');   // closes the "already there" note
    await sleep(300);
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => /^(OK|확인)$/i.test(button.textContent.trim()))?.click());
    await sleep(300);
    ok('a second folder of the same name is refused', (await chips()).split('판타지').length === 2, await chips());

    // rename, and take one work out
    await page.click('[data-easy-folder="' + written.id + '"]').catch(() => {});
    if (!(await page.$('[data-easy-folder-edit]'))) await page.click('[data-easy-folder="' + written.id + '"]');
    await page.click('[data-easy-folder-edit]');
    await page.waitForSelector('[data-easy-folder-name]');
    await page.focus('[data-easy-folder-name]');
    await page.$eval('[data-easy-folder-name]', input => input.select());
    await page.keyboard.press('Backspace');
    await page.type('[data-easy-folder-name]', '모험');
    await page.click('[data-easy-folder-rename]');
    await page.click('input[type=checkbox]');   // 이 폴더에 있는 작품만 보기
    await sleep(300);
    const onlyInside = await page.$$eval('[data-easy-folder-work]', list => list.length);
    await clickText('[data-easy-folder-work]', 'Bot 0005');
    await sleep(300);
    await closeSheet();
    const afterEdit = await chips();
    ok('renaming and unticking a work are applied', onlyInside === 3 && afterEdit === '새 폴더 | 모든 폴더 | 모험 2 | 폴더 없음 238', `${afterEdit} / shown as inside: ${onlyInside}`);

    // the work page moves a work into a folder
    await page.click('[data-easy-folder="*"]');
    await page.type('input[type=search]', 'Bot 0009');
    await sleep(300);
    await page.click('[data-easy-work-card]');
    await page.waitForSelector('[data-easy-work-folder]', { timeout: 10000 });
    const before = await page.$eval('[data-easy-work-folder]', button => button.textContent.trim());
    await page.click('[data-easy-work-folder]');
    await sleep(400);
    await clickText('button', '모험');
    await sleep(400);
    const afterMove = await page.$eval('[data-easy-work-folder]', button => button.textContent.trim());
    ok('the work page shows the folder and moves the work into one', before === '폴더에 넣기' && afterMove === '폴더: 모험', `${before} → ${afterMove}`);
    const three = await until(() => savedFolder('모험')?.data.length === 3 && savedFolder('모험'));
    ok('the server has the folder with three works', !!three, JSON.stringify(three && three.data.length));
    const folderId = three.id;
    const wanted = three.data.slice();

    // folders and the archive, with the real app: archive two of the three, open the app (it drops them from the folder), restore, open again
    const api = await client(base).login();
    const list = (await api.get('/api/bangju/archive')).json;
    const inFolder = list.active.filter(item => item.folderId === folderId);
    const leaving = inFolder.filter(item => item.name !== 'Bot 0003').map(item => item.id);
    const archived = await api.post('/api/bangju/archive/move', { ids: leaving, direction: 'archive' });
    ok('the archive list knew the folder made in easy mode', list.folders.some(item => item.id === folderId && item.name === '모험') && inFolder.length === 3 && archived.json.moved.length === 2, `in folder ${inFolder.length}, archived ${archived.json.moved?.length}`);
    ok('the app opens again after the archive', await open());
    const dropped = await until(async () => (await chips()).includes('모험 1') && chips(), 15000);
    ok('the app shows the folder with the one work that stayed', String(dropped).startsWith('새 폴더 | 모든 폴더 | 모험 1 | 폴더 없음 '), String(dropped));
    await until(() => savedFolder('모험')?.data.length === 1, 20000);
    const api2 = await client(base).login();
    const restored = await api2.post('/api/bangju/archive/move', { ids: leaving, direction: 'restore' });
    ok('the app opens again after the restore', await open());
    const backChips = await until(async () => (await chips()).includes('모험 3') && chips(), 15000);
    await page.click('[data-easy-folder="' + folderId + '"]');
    await sleep(400);
    const backNames = await cardNames();
    ok('restored works are back in their folder, in the real app', restored.json.moved.length === 2 && restored.json.intoFolders === 2 && String(backChips).includes('모험 3') && backNames === 'Bot 0003,Bot 0007,Bot 0009', `${backChips} / ${backNames} / intoFolders ${restored.json.intoFolders}`);
    const backOrder = await until(() => savedFolder('모험')?.data.length === 3 && savedFolder('모험'));
    ok('and in their old order', JSON.stringify(backOrder && backOrder.data) === JSON.stringify(wanted), JSON.stringify(backOrder && backOrder.data.length));

    // deleting the folder keeps the works
    await page.click('[data-easy-folder-edit]');
    await page.waitForSelector('[data-easy-folder-delete]');
    await page.click('[data-easy-folder-delete]');
    await sleep(500);
    await page.evaluate(() => { const buttons = [...document.querySelectorAll('[role="alertdialog"] button, [role="dialog"] button')].filter(button => /^(yes|예|네)$/i.test(button.textContent.trim())); buttons.at(-1)?.click(); });
    await sleep(600);
    const afterDelete = await chips();
    ok('deleting a folder removes only the folder', afterDelete === '새 폴더' && await cards() === 60, `${afterDelete} / cards ${await cards()}`);
    const gone = await until(() => !savedFolder('모험') && savedOrder().length, 20000);
    ok('every work is still in the list on the server', gone === 240, `entries ${gone}`);

    // many folders: the rows wrap so every chip can be reached with a mouse; on a touch screen each row is one line to swipe
    const api3 = await client(base).login();
    const read3 = await api3.readDb();
    const all = read3.db.characters.map(character => character.chaId);
    const many = Array.from({ length: 16 }, (_, i) => ({ id: `many-${i}`, name: `원작 있는 다인 시뮬챗 ${i + 1}`, color: 'default', data: [all[i]] }));
    const tagged = read3.db.characters.slice(0, 40).map((character, i) => ({ op: 'replace', path: `/characters/${i}/tags`, value: [`태그 ${String(i).padStart(2, '0')}`, '공통'] }));
    const patched = await api3.patchDb([{ op: 'replace', path: '/characterOrder', value: [...many, ...all.slice(16)] }, ...tagged], serverHash(read3.db));
    const rowShape = () => page.evaluate(() => Object.fromEntries(['folders', 'tags'].map(name => {
        const row = document.querySelector(`[data-easy-${name}]`);
        const buttons = [...row.querySelectorAll('button')];
        const last = buttons.at(-1).getBoundingClientRect();
        return [name, {
            chips: buttons.length,
            overflow: row.scrollWidth - row.clientWidth > 1,
            lines: new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top))).size,
            lastInView: last.left >= 0 && last.right <= window.innerWidth,
            first: buttons[0].textContent.trim(),
        }];
    }).concat([['filters', getComputedStyle(document.querySelector('[data-easy-filters]')).position]])));
    await page.setViewport({ width: 1280, height: 900 });
    ok('the app opens at desktop size', patched.status === 200 && await open());
    await page.waitForSelector('[data-easy-tags]', { timeout: 10000 });
    const mouse = await rowShape();
    await page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', 'easy-home-desktop.png') });
    ok('without a touch screen the folder row wraps: "새 폴더" is first and every folder can be reached', mouse.folders.first === '새 폴더' && mouse.folders.chips === 19
        && !mouse.folders.overflow && mouse.folders.lines > 1 && mouse.folders.lastInView, JSON.stringify(mouse.folders));
    ok('the tag row wraps too, and the chips scroll away with the page', !mouse.tags.overflow && mouse.tags.lines > 1 && mouse.tags.lastInView && mouse.filters === 'static', JSON.stringify({ tags: mouse.tags, filters: mouse.filters }));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    ok('the app opens at phone size with touch', await open());
    await page.waitForSelector('[data-easy-tags]', { timeout: 10000 });
    const touch = await rowShape();
    ok('on a touch screen each row stays one line to swipe, under the header, with "새 폴더" first', touch.folders.first === '새 폴더' && touch.folders.overflow && touch.folders.lines === 1
        && touch.tags.overflow && touch.tags.lines === 1 && touch.filters === 'sticky', JSON.stringify(touch));
    const stuck = await page.evaluate(async () => {
        const scroller = document.querySelector('[data-easy-home]');
        scroller.scrollTop = 600;
        await new Promise(resolve => setTimeout(resolve, 300));
        const header = document.querySelector('header').getBoundingClientRect();
        const filters = document.querySelector('[data-easy-filters]').getBoundingClientRect();
        scroller.scrollTop = 0;
        return { headerTop: Math.round(header.top), gap: Math.round(filters.top - header.bottom) };
    });
    ok('after scrolling, the header and the chips are still at the top, one under the other', stuck.headerTop === 0 && Math.abs(stuck.gap) <= 1, JSON.stringify(stuck));
    // back to a plain narrow window (changing touch emulation reloads the page)
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    ok('the app opens again in a narrow window', await open());

    // E3 and the archive link in easy-mode settings
    await page.evaluate(() => document.querySelector('button[aria-label="간편 모드 설정"]').click());
    await page.waitForSelector('[data-easy-open-modules]', { timeout: 10000 });
    const links = await page.evaluate(() => ({
        modules: document.querySelector('[data-easy-open-modules]')?.textContent.trim(),
        plugins: document.querySelector('[data-easy-open-plugins]')?.textContent.trim(),
        archive: document.querySelector('[data-easy-open-archive]')?.getAttribute('href'),
        target: document.querySelector('[data-easy-open-archive]')?.getAttribute('target'),
    }));
    ok('easy-mode settings link to module and plugin management and to the archive', links.modules === '모듈 관리' && links.plugins === '플러그인 관리' && links.archive === '/bangju/archive' && links.target === '_blank', JSON.stringify(links));
    await page.click('[data-easy-open-modules]');
    const settings = await until(async () => !(await page.$('[data-easy-shell]')) && !!(await page.$('.settings-page')), 10000);
    ok('"모듈 관리" opens the existing management screen', settings === true);

    // E1: the home button goes to the classic screen
    ok('back on the easy-mode home', await open());
    await page.click('[data-easy-open-classic]');
    const classic = await until(async () => !(await page.$('[data-easy-shell]')), 10000);
    ok('the button beside "작품" switches to the classic screen', classic === true);

    ok('the app ran without script errors', errors.length === 0, errors.slice(0, 3).join(' ; '));
    await browser.close();
})().catch(e => { console.error('PAGE TEST FAILED', e); process.exit(1); });
