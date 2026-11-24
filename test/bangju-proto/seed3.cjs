'use strict';
// Seeds a library shaped like the real one: ~1,150 bots, ~230MB of card text, 47 bots over 1MB.
const { client, fakeDb } = require('./h.cjs');
const [base, count = '1150'] = process.argv.slice(2);
(async () => {
    const c = await client(base).login();
    const n = Number(count);
    const t0 = Date.now();
    // filler() is mostly Korean (3 bytes per character): ~2.2 bytes per character on average
    const db = fakeDb(n, { per: i => ({ cardBytes: i % 24 === 0 ? 640000 : 68000, chats: 2, messages: 6, assetName: null }) });
    const first = await c.readDb();
    const w = await c.writeDb(db, first.etag);
    console.log('write:', w.status, w.text.slice(0, 80), '| payload MB', (w.bytes / 1048576).toFixed(1), '| took s', ((Date.now() - t0) / 1000).toFixed(1));
    const t1 = Date.now();
    const back = await c.readDb();
    console.log('read back:', back.status, 'characters', back.db?.characters?.length, '| MB', (back.bytes / 1048576).toFixed(1), '| took s', ((Date.now() - t1) / 1000).toFixed(1));
})().catch(e => { console.error('FAILED', e); process.exit(1); });
