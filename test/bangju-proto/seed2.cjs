'use strict';
// Like seed.cjs, plus one bot (Bot 0012) whose chat message uses an image that appears nowhere else.
const { client, fakeDb } = require('./h.cjs');
const [base, count = '12'] = process.argv.slice(2);
(async () => {
    const c = await client(base).login();
    const png = Buffer.from('89504e470d0a1a0a' + '00'.repeat(64), 'hex');
    const n = Number(count);
    const db = fakeDb(n, { per: i => ({ cardBytes: 20000 + (i % 5) * 30000, chats: 2, messages: 6, assetName: i % 3 === 0 ? `bot${i}.png` : null }) });
    for (let i = 3; i <= n; i += 3) {
        await c.writeKey(`assets/bot${i}.png`, Buffer.concat([png, Buffer.from(`bot${i}`)]));
        await c.writeKey(`assets/extra-bot${i}.png`, Buffer.concat([png, Buffer.from(`extra${i}`)]));
    }
    await c.writeKey('assets/chatonly-12.png', Buffer.concat([png, Buffer.from('chat12')]));
    db.characters[11].chats[0].message.push({ role: 'char', data: '그림을 그렸어: ![그림](assets/chatonly-12.png) 어때?', time: 1700000999999 });
    const first = await c.readDb();
    const w = await c.writeDb(db, first.etag);
    const back = await c.readDb();
    console.log('seeded:', w.status, 'characters', back.db?.characters?.length);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
