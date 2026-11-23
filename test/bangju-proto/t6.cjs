'use strict';
// Is the "startup read unavailable" warning caused by the archive, or by my synthetic "add a bot" request alone?
const { client, serverHash, fakeCharacter } = require('./h.cjs');
const [base, withArchive] = process.argv.slice(2);
(async () => {
    let tab = await client(base).login();
    let db = (await tab.readDb()).db;
    if (withArchive === 'archive') {
        const list = (await tab.get('/api/bangju/archive')).json;
        await tab.post('/api/bangju/archive/move', { ids: list.active.slice(6).map(c => c.id), direction: 'archive' });
        tab = await client(base).login();
        db = (await tab.readDb()).db;
    }
    const added = fakeCharacter(9001, { cardBytes: 2000, chats: 1, messages: 2 });
    const p = await tab.patchDb([{ op: 'replace', path: '/characters', value: [...db.characters, added] }], serverHash(db));
    console.log('add-a-bot request:', p.status);
    await new Promise(r => setTimeout(r, 3000));
    tab = await client(base).login();
    const after = await tab.readDb();
    console.log('read after:', after.status, 'characters', after.db.characters.length);
})();
