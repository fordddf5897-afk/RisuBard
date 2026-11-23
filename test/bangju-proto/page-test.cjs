'use strict';
// Drives the test page in a real (headless) browser at phone size.
const puppeteer = require('puppeteer-core');
const [base, shot] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    page.on('dialog', d => d.accept());
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`${base}/bangju/archive`, { waitUntil: 'domcontentloaded' });
    await page.type('#password', 'test1234');
    await page.click('#loginButton');
    await page.waitForFunction(() => document.querySelectorAll('#list .row').length > 0, { timeout: 15000 });
    const text = sel => page.$eval(sel, el => el.innerText);
    console.log('totals:', (await text('#totals')).replace(/\n/g, ' / '));
    console.log('rows shown:', await page.$$eval('#list .row', rows => rows.length), '| first row:', await page.$eval('#list .row', r => r.innerText.replace(/\n/g, ' ')));
    await page.type('#search', 'Bot 000');
    await sleep(200);
    console.log('rows after search "Bot 000":', await page.$$eval('#list .row', rows => rows.length));
    // pick the first two rows
    await page.$$eval('#list .row input', boxes => { boxes[0].click(); boxes[1].click(); });
    console.log('selected label:', await text('#selected'));
    await page.screenshot({ path: shot.replace('.png', '-1.png') });
    await page.click('#moveButton');
    await page.waitForFunction(() => /완료/.test(document.getElementById('result').innerText), { timeout: 30000 });
    console.log('result after archive:', (await text('#result')).replace(/\n/g, ' / '));
    await page.click('#tabArchived');
    await sleep(200);
    console.log('archive tab rows:', await page.$$eval('#list .row', rows => rows.map(r => r.innerText.replace(/\n/g, ' '))));
    await page.screenshot({ path: shot.replace('.png', '-2.png') });
    await page.click('#selectAll');
    await page.click('#moveButton');
    await page.waitForFunction(() => /불러오기 2개 완료/.test(document.getElementById('result').innerText), { timeout: 30000 });
    console.log('result after restore:', (await text('#result')).replace(/\n/g, ' / '));
    // An expired login token: the server refuses the first move request; the page must renew the token and retry.
    await page.setRequestInterception(true);
    let refused = 0, renewed = 0;
    const onRequest = request => {
        if (request.url().endsWith('/api/token/refresh')) renewed += 1;
        if (request.url().endsWith('/api/bangju/archive/move') && refused === 0) {
            refused += 1;
            return request.respond({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Token Expired' }) });
        }
        request.continue();
    };
    page.on('request', onRequest);
    await page.click('#tabActive');
    await sleep(200);
    await page.$$eval('#list .row input', boxes => { boxes[0].click(); });
    await page.click('#moveButton');
    await page.waitForFunction(() => /보관 1개 완료/.test(document.getElementById('result').innerText), { timeout: 30000 });
    console.log('expired token: refused', refused, '| renewed', renewed, '| then:', (await text('#result')).split('\n')[0]);
    await page.click('#tabArchived');
    await sleep(200);
    await page.click('#selectAll');
    await page.click('#moveButton');
    await page.waitForFunction(() => /불러오기 1개 완료/.test(document.getElementById('result').innerText), { timeout: 30000 });
    page.off('request', onRequest);
    await page.setRequestInterception(false);
    // Reopening the page shows the last result again (kept on the server).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.type('#password', 'test1234');
    await page.click('#loginButton');
    await page.waitForFunction(() => /마지막 작업/.test(document.getElementById('result').innerText), { timeout: 15000 });
    console.log('after reopening:', (await text('#result')).split('\n').slice(0, 2).join(' / '));
    console.log('version line:', await text('#version'));
    console.log('page errors:', errors.length ? errors : 'none');
    await browser.close();
})().catch(e => { console.error('PAGE TEST FAILED', e.message); process.exit(1); });
