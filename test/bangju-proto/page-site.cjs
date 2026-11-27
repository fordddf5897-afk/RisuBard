'use strict';
// 사이트 프롬으로 작품 만들기(묶음 D-1: K1 기반 표시, K2 붙여넣기로 만들기)를 실제 앱과 실제 브라우저로 본다.
// 앱을 먼저 지어 둬야 한다(dist). 사용: node page-site.cjs <base> <root>   (seed2 자료 12개)
// 서버에 저장된 것은 디스크의 봇 파일에서 읽는다. API로 읽으면 그 순간 앱의 세션을 가져가서, 앱이 하려던 저장이 거절된다.
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const zlib = require('node:zlib');
const puppeteer = require('puppeteer-core');
const [base, root] = process.argv.slice(2);
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Every bot the server has written to disk.
function botsOnDisk() {
    const folder = path.join(root, 'characters');
    const bots = [];
    for (const name of fs.existsSync(folder) ? fs.readdirSync(folder) : []) {
        try { bots.push(JSON.parse(fs.readFileSync(path.join(folder, name, 'metadata.json'), 'utf8'))); } catch { /* being written, or not a bot folder */ }
    }
    return bots;
}
async function until(check, ms = 20000) { const end = Date.now() + ms; for (;;) { const value = await check(); if (value) return value; if (Date.now() > end) return value; await sleep(250); } }

// A tiny real PNG of one colour, so each test picture is a different file.
function png(red, green, blue) {
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = buffer => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const head = Buffer.alloc(4); head.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body)); return Buffer.concat([head, body, tail]); };
    const header = Buffer.alloc(13); header.writeUInt32BE(2, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2;
    const row = Buffer.from([0, red, green, blue, red, green, blue]);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat([row, row]))), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bangju-site-'));
    const files = { smile: path.join(work, 'smile.png'), angry: path.join(work, 'angry.png'), hawa: path.join(work, 'hawa.png'), note: path.join(work, 'note.txt') };
    fs.writeFileSync(files.smile, png(250, 200, 10)); fs.writeFileSync(files.angry, png(200, 20, 20)); fs.writeFileSync(files.hawa, png(20, 60, 220)); fs.writeFileSync(files.note, 'not a picture');

    const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
    page.on('dialog', dialog => dialog.accept().catch(() => {}));
    await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1 });
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
    const press = selector => page.$eval(selector, item => item.click());
    const tab = async name => { await page.$eval(`[data-site-tab="${name}"]`, item => item.click()); await page.waitForSelector(`[data-site-tab="${name}"][aria-selected="true"]`, { timeout: 5000 }); await sleep(100); };
    const fill = async (selector, text, at = 0) => {
        const boxes = await page.$$(selector);
        if (!boxes[at]) throw new Error(`no field ${selector} #${at}; open tab: ${await page.$eval('[data-site-tab][aria-selected="true"]', item => item.textContent.trim()).catch(() => '?')}; dialogs: ${await page.$$eval('[role="alertdialog"], [role="dialog"]', list => list.map(item => (item.getAttribute('aria-label') || item.textContent.trim().slice(0, 40))).join(' | '))}`);
        // Focus and select by script (a mouse click can miss while the layout is still settling), then type like a person.
        await boxes[at].evaluate(box => { box.scrollIntoView({ block: 'center' }); box.focus(); if (box.select) box.select(); });
        await page.keyboard.type(text);
    };
    const field = name => `[data-site-field="${name}"]`;
    const pressButton = text => page.evaluate(wanted => { const button = [...document.querySelectorAll('button')].find(item => item.offsetParent !== null && item.textContent.trim().startsWith(wanted)); if (button) button.click(); return Boolean(button); }, text);
    const answerYes = () => until(() => page.evaluate(() => { const buttons = [...document.querySelectorAll('[role="alertdialog"] button, [role="dialog"] button')].filter(button => /^(yes|예|네|확인|ok|confirm)$/i.test(button.textContent.trim())); if (buttons.length) buttons[0].click(); return buttons.length > 0; }), 8000);

    ok('the app opens in easy mode', await open());
    const before = await page.$$eval('[data-easy-work-card]', list => list.length);
    ok('no existing work is marked as site-based', await page.$$eval('[data-easy-site-badge]', list => list.length) === 0 && before > 0, String(before));

    // 작품 추가 → 챗봇 사이트 프롬으로 만들기
    await press('[data-easy-add-work]');
    ok('작품 추가 offers the site-prompt way', await until(() => pressButton('챗봇 사이트 프롬으로 만들기'), 8000));
    await page.waitForSelector('[data-site-editor]', { timeout: 10000 });
    const tabs = await page.$$eval('[data-site-tab]', list => list.map(item => item.textContent.trim()).join(' | '));
    ok('the tabs follow 에덴챗, plus the 루나톡 rule box and the result', tabs === '작품 소개 | 상세 설정 | 캐릭터 설정 | 미디어 에셋 | 시작 상황 | 로어북 | 매 응답 규칙 | 변환 결과', tabs);

    // saving without a title is refused
    await press('[data-site-save]');
    await sleep(400);
    ok('a work without a title is not made', await answerYes() && await page.$('[data-site-editor]') !== null);

    await fill(field('title'), '에덴하임의 사서');
    await fill(field('subtitle'), '봉인된 서고');
    await fill(field('intro'), '도서관 이야기');
    await fill(field('genre'), '판타지');
    await fill(field('tags'), '도서관, 사서');
    await page.keyboard.press('Tab');
    await tab('world');
    await fill(field('world'), '왕도 지하에 서고가 있다.');
    await tab('characters');
    await fill(field('character-name'), '하와');
    await fill(field('character-detail'), '대사서. 조용하다.');
    await (await page.$('[data-site-character-image]')).uploadFile(files.hawa);
    await press('[data-site-add-character]');
    await fill(field('character-name'), '리노', 1);
    await fill(field('character-detail'), '견습 사서.', 1);

    // pictures: two through the picker, one dropped, one file that is not a picture
    await tab('assets');
    await (await page.$('[data-site-assets]')).uploadFile(files.smile, files.angry);
    await until(async () => (await page.$$('[data-site-asset]')).length === 2);
    await page.evaluate(async () => {
        const blob = await new Promise(resolve => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 3; canvas.getContext('2d').fillRect(0, 0, 3, 3); canvas.toBlob(resolve, 'image/png'); });
        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], 'dropped.png', { type: 'image/png' }));
        transfer.items.add(new File(['x'], 'notes.txt', { type: 'text/plain' }));
        document.querySelector('[data-site-drop]').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    });
    await until(async () => (await page.$$('[data-site-asset]')).length === 3);
    const shown = await page.$$eval('[data-site-asset]', list => list.map(item => item.querySelector('[data-site-asset-number]').textContent.trim() + '=' + item.querySelector('[data-site-field="asset-code"]').value).join(' | '));
    ok('pictures get numbers in the order they arrive, picked or dropped; a non-picture is left out', shown === '1번 · smile.png=1 | 2번 · angry.png=2 | 3번 · dropped.png=3', shown);
    await pressButton('빈 설명을 파일 이름으로 채우기');
    await fill(field('asset-code'), 'smi02', 1);
    const described = await page.$$eval('[data-site-field="asset-description"]', list => list.map(item => item.value).join(','));
    ok('empty descriptions can be filled from the file names', described === 'smile,angry,dropped', described);

    await tab('starts');
    await fill(field('start-title'), '첫 만남');
    await fill(field('start-body'), '<<나레이션>> 문이 열렸다.');
    await press('[data-site-add-start]');
    await fill(field('start-body'), '두 번째 시작', 1);
    await fill(field('start-extra'), '이 시작에서는 밤이다.', 1);
    await tab('lore');
    await press('[data-site-add-lore]');
    await fill(field('lore-name'), '서고');
    await fill(field('lore-content'), '봉인된 서고다.');
    await fill(field('lore-on'), '서고, 봉인');
    await fill(field('lore-off'), '꿈');
    await fill(field('lore-turns'), '5');
    await page.evaluate(() => { document.querySelector('[data-site-lore] details').open = true; });
    await fill(field('lore-order'), '2');
    await fill(field('lore-max'), '20');
    await page.keyboard.press('Tab');
    await tab('rule');
    await fill(field('rule'), '상태창을 매번 출력한다.');

    // what will go into the bot is shown before saving
    await tab('result');
    const result = await page.evaluate(() => ({ desc: document.querySelector('[data-site-result="desc"]').textContent, lore: [...document.querySelectorAll('[data-site-result="lore"]')].map(item => item.textContent), notes: document.querySelector('[data-site-notes]')?.textContent.replace(/\s+/g, ' ') || '', assets: document.querySelector('[data-site-result="assets"]').textContent }));
    ok('the result shows the description exactly as it will be stored', result.desc === '[세계관]\n왕도 지하에 서고가 있다.\n\n[등장인물: 하와]\n대사서. 조용하다.\n\n[등장인물: 리노]\n견습 사서.', JSON.stringify(result.desc));
    ok('and the lorebook marks, the start-only prompt, the pictures and what could not be carried over', result.lore.join(' / ') === '@@exclude_keys 꿈\n@@scan_depth 5\n봉인된 서고다. / @@is_greeting 1\n이 시작에서는 밤이다.'
        && result.assets === '1, smi02, 3, 하와' && result.notes.includes('최대 턴(20)') && result.notes.includes('1개'), JSON.stringify(result));

    await press('[data-site-save]');
    await page.waitForSelector('[data-easy-edit-site]', { timeout: 15000 });
    ok('making it opens the work page, marked as site-based, with a button to edit the site fields', await page.$('[data-easy-site-badge]') !== null && await page.$('[data-site-editor]') === null);

    // what the server holds, once the app has saved
    const stored = await until(() => botsOnDisk().find(c => c.name === '에덴하임의 사서' && c.desc), 30000);
    const site = stored?.extentions?.bangju?.site;
    ok('the bot holds the converted fields', Boolean(stored) && stored.desc === result.desc && stored.firstMessage === '<<나레이션>> 문이 열렸다.' && JSON.stringify(stored.alternateGreetings) === '["두 번째 시작"]'
        && JSON.stringify(stored.depth_prompt) === '{"depth":0,"prompt":"상태창을 매번 출력한다."}' && !stored.postHistoryInstructions && stored.creatorNotes === '도서관 이야기' && JSON.stringify(stored.tags) === '["판타지","도서관","사서"]', JSON.stringify({ desc: stored?.desc, tags: stored?.tags, rule: stored?.depth_prompt }));
    ok('its lorebook entries carry the marks and are tagged as made by the form', stored.globalLore.length === 2 && stored.globalLore[0].key === '서고,봉인' && stored.globalLore[0].insertorder === 998 && stored.globalLore[0].extentions?.bangju === true
        && stored.globalLore[1].alwaysActive === true && stored.globalLore[1].content.startsWith('@@is_greeting 1'), JSON.stringify(stored.globalLore.map(l => [l.key, l.insertorder, l.alwaysActive])));
    const assets = stored.additionalAssets || [];
    ok('the pictures are the bot\'s own assets, under their codes and the character\'s name, and the cover is set', assets.map(a => a[0]).join() === '1,smi02,3,하와' && assets.every(a => /^assets\//.test(a[1]) && a[2] === 'png')
        && new Set(assets.map(a => a[1])).size === 4 && stored.image === assets[3][1], JSON.stringify(assets));
    ok('the site fields are kept as written, next to the easy-mode titles', stored.extentions.bangju.base === 'site' && site.title === '에덴하임의 사서' && site.world === '왕도 지하에 서고가 있다.' && site.lore[0].maxTurn === 20 && site.lore[0].order === 2
        && site.assets.length === 3 && site.starts[1].extra === '이 시작에서는 밤이다.' && stored.extentions.risuEasy.subtitle === '봉인된 서고' && JSON.stringify(stored.extentions.risuEasy.startTitles) === '["첫 만남",""]', JSON.stringify(stored.extentions).slice(0, 300));
    const others = botsOnDisk().filter(c => c.name !== '에덴하임의 사서');
    ok('no other bot was given the value', others.length === before && others.every(c => !c.extentions?.bangju));

    // after a reload: the home marks it, and the site editor opens with what was written
    ok('the app opens again', await open());
    const marked = await page.$$eval('[data-easy-work-card]', list => list.filter(card => card.querySelector('[data-easy-site-badge]')).map(card => card.querySelector('p.font-semibold').textContent.trim()).join());
    ok('on the home only that work is marked', marked === '에덴하임의 사서', marked);
    await page.evaluate(() => [...document.querySelectorAll('[data-easy-work-card]')].find(card => card.querySelector('[data-easy-site-badge]')).click());
    await page.waitForSelector('[data-easy-edit-site]', { timeout: 10000 });
    await press('[data-easy-edit-site]');
    await page.waitForSelector('[data-site-editor]', { timeout: 10000 });
    await tab('world');
    const again = { title: await (async () => { await tab('intro'); return page.$eval(field('title'), item => item.value); })(), world: await (async () => { await tab('world'); return page.$eval(field('world'), item => item.value); })(), pictures: await (async () => { await tab('assets'); return (await page.$$('[data-site-asset]')).length; })(), keys: await (async () => { await tab('lore'); return page.$eval(field('lore-on'), item => item.value); })() };
    ok('the site editor shows the same fields again', again.title === '에덴하임의 사서' && again.world === '왕도 지하에 서고가 있다.' && again.pictures === 3 && again.keys === '서고, 봉인', JSON.stringify(again));

    // an edit: one picture removed, the world changed (what is kept from elsewhere is checked in siteWork.test.ts)
    await tab('assets');
    await page.evaluate(() => document.querySelectorAll('[data-site-remove-asset]')[2].click());
    await tab('world');
    await fill(field('world'), '왕도 지하에 서고가 있다. 열쇠는 하나다.');
    await press('[data-site-save]');
    ok('saving an existing work asks first', await answerYes());
    await page.waitForSelector('[data-easy-edit-site]', { timeout: 15000 });
    const edited = await until(() => botsOnDisk().find(c => c.name === '에덴하임의 사서' && c.desc.includes('열쇠는 하나다')) || null, 30000);
    const last = edited || botsOnDisk().find(c => c.name === '에덴하임의 사서');
    ok('the edit replaces what the form made and removes the dropped picture from the bot', Boolean(edited) && edited.additionalAssets.map(a => a[0]).join() === '1,smi02,하와' && edited.globalLore.length === 2 && edited.extentions.bangju.site.assets.length === 2,
        JSON.stringify({ saved: Boolean(edited), desc: last?.desc?.slice(-30), assets: last?.additionalAssets?.map(a => a[0]), lore: last?.globalLore?.length, siteAssets: last?.extentions?.bangju?.site?.assets?.length, editorOpen: await page.$('[data-site-editor]') !== null, dialogs: await page.$$eval('[role="alertdialog"], [role="dialog"]', list => list.map(item => item.textContent.trim().slice(0, 60)).join(' | ')) }));

    // K1 on the home: a chip shows only the site-based works
    ok('the app opens once more', await open());
    const all = await page.$$eval('[data-easy-work-card]', list => list.length);
    const chip = await page.$eval('[data-easy-site-only]', item => item.textContent.trim());
    await press('[data-easy-site-only]');
    await sleep(300);
    const only = await page.$$eval('[data-easy-work-card] p.font-semibold', list => list.map(item => item.textContent.trim()).join());
    await press('[data-easy-site-only]');
    await sleep(300);
    ok('the home has a chip that shows only site-based works', chip === '사이트 기반 1' && only === '에덴하임의 사서' && await page.$$eval('[data-easy-work-card]', list => list.length) === all && all === before + 1, `${chip} / ${only} / ${all}`);

    // K1 in the archive page: the same mark and a button to see only those (the bot is stored like any other)
    await page.goto(`${base}/bangju/archive`, { waitUntil: 'domcontentloaded' });
    await page.type('#password', 'test1234');
    await page.click('#loginButton');
    await page.waitForFunction(() => document.querySelectorAll('#list .row').length > 0, { timeout: 15000 });
    const siteRows = await until(() => page.$$eval('#list .row', rows => rows.filter(row => row.querySelector('.tags .site')).map(row => row.querySelector('.name').textContent).join()), 15000);
    const button = await page.$eval('#siteOnly', item => (item.classList.contains('hidden') ? '(hidden)' : item.textContent));
    await page.click('#siteOnly');
    await sleep(300);
    const filtered = await page.$$eval('#list .row .name', rows => rows.map(row => row.textContent).join());
    ok('the archive page marks it and can show only site-based bots', siteRows === '에덴하임의 사서' && button === '사이트 기반만 보기 (1개)' && filtered === '에덴하임의 사서', `${siteRows} / ${button} / ${filtered}`);

    ok('the app ran without script errors', errors.length === 0, errors.slice(0, 3).join(' ; '));
    await browser.close();
    fs.rmSync(work, { recursive: true, force: true });
})().catch(e => { console.error('PAGE TEST FAILED', e); process.exit(1); });
