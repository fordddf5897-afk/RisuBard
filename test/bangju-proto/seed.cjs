'use strict';
// Seeds a running local server with fake bots through the same HTTP calls the browser uses.
const { client, fakeDb } = require('./h.cjs');
const [base, count = '12'] = process.argv.slice(2);
(async () => {
    const c = await client(base).login();
    const png = Buffer.from('89504e470d0a1a0a' + '00'.repeat(64), 'hex');
    const n = Number(count);
    // every third bot gets its own image asset in the shared asset store
    const db = fakeDb(n, { per: i => ({ cardBytes: 20000 + (i % 5) * 30000, chats: 2, messages: 6, assetName: i % 3 === 0 ? `bot${i}.png` : null }) });
    for (let i = 3; i <= n; i += 3) {
        await c.writeKey(`assets/bot${i}.png`, Buffer.concat([png, Buffer.from(`bot${i}`)]));
        await c.writeKey(`assets/extra-bot${i}.png`, Buffer.concat([png, Buffer.from(`extra${i}`)]));
    }
    const first = await c.readDb();
    console.log('initial read:', first.status, 'bytes', first.bytes ?? first.body);
    const w = await c.writeDb(db, first.etag);
    console.log('write db:', w.status, w.text.slice(0, 160), 'payload bytes', w.bytes);
    const back = await c.readDb();
    console.log('read back:', back.status, 'bytes', back.bytes, 'characters', back.db?.characters?.length, 'etag', back.etag);
    console.log('first bot:', back.db?.characters?.[0]?.name, '| chats', back.db?.characters?.[0]?.chats?.length, '| chat0 keys', Object.keys(back.db?.characters?.[0]?.chats?.[0] || {}).join(','));
})().catch(e => { console.error('FAILED', e); process.exit(1); });
