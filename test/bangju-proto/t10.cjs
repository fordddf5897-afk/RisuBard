'use strict';
// 그림을 어디서 찾는지(모듈만 따로 시험, 서버 없이): 그림 창고 목록, '은퇴' 목록, 봇 폴더 안, 어디에도 없음.
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const { createBangjuArchive } = require('../../server/node/bangju/archive.cjs');
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bangju-unit-'));
    const write = (relative, data) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); return file; };
    const object = text => { const hash = crypto.createHash('sha256').update(text).digest('hex'); write(`kv/objects/${hash}`, text); return hash; };
    const inManifest = object('listed in the manifest');
    const retiredObject = object('only in the retired list');
    const storeBytes = 'kept in the asset store';
    const storeName = `${crypto.createHash('sha256').update(storeBytes).digest('hex')}.png`;
    write(`asset-store/${storeName.slice(0, 2)}/${storeName}`, storeBytes);
    write('kv/manifest.json', JSON.stringify({ schemaVersion: 1, entries: { 'assets/listed.png': { object: inManifest, size: 22 } } }));
    write('kv/retired-assets.json', JSON.stringify({ schemaVersion: 1, characters: { bot1: { 'assets/retired.png': { object: retiredObject, size: 24 } } } }));
    write('index/character-asset-replicas.json', JSON.stringify({ schemaVersion: 1, characters: { bot1: { enabled: true, entries: [{ key: 'assets/own.png', filename: 'own.png', hash: 'x', size: 1 }] } } }));
    write('characters/bot1/metadata.json', JSON.stringify({ chaId: 'bot1', name: 'Bot One', image: 'assets/listed.png',
        additionalAssets: [['a', 'assets/retired.png', 'png'], ['b', `assets/${storeName}`, 'png'], ['c', 'assets/own.png', 'png'], ['d', 'assets/gone.png', 'png']] }));
    write('characters/bot1/assets/own.png', 'travels with the folder');
    const names = metadata => new Set([metadata.image, ...(metadata.additionalAssets || []).map(asset => asset[1])].filter(Boolean).map(key => key.slice('assets/'.length)));
    const returned = [];
    const present = new Set(['assets/listed.png', 'assets/retired.png', `assets/${storeName}`]);
    const archive = createBangjuArchive({
        dataRoot: root, resolveActiveDirectory: id => path.join('characters', id), collectAssetReferences: names,
        collectNestedReferences: null, toStableId: id => id, kv: { has: key => present.has(key), set: (key, bytes) => { returned.push([key, String(bytes)]); present.add(key); } },
    });
    const progress = [];
    let pauses = 0;
    const moved = await archive.move({ ids: ['bot1'], direction: 'archive', onProgress: p => progress.push(p), pause: async () => { pauses += 1; } });
    ok('moved with a progress report', moved.moved.length === 1 && progress.length === 1 && progress[0].done === 1 && progress[0].total === 1 && progress[0].name === 'Bot One', JSON.stringify(progress));
    ok('manifest, retired and asset-store images got an archive name; the own-folder image is counted; the lost one is reported',
        moved.assets.protected === 3 && moved.assets.inFolder === 1 && moved.assets.missing === 1 && moved.assets.copied === 0
        && moved.missing.length === 1 && moved.missing[0].examples[0] === 'gone.png' && moved.missing[0].name === 'Bot One', JSON.stringify({ assets: moved.assets, missing: moved.missing }));
    const kept = fs.readdirSync(path.join(root, 'bangju/archive/assets/bot1')).sort();
    ok('archive names are links to the same files', kept.length === 3 && kept.includes('retired.png')
        && fs.statSync(path.join(root, 'bangju/archive/assets/bot1/retired.png')).ino === fs.statSync(path.join(root, 'kv/objects', retiredObject)).ino, kept.join(', '));
    const listed = archive.listArchived()[0];
    const references = JSON.parse(fs.readFileSync(path.join(root, 'risubard/bangju-archive/references/bot1.json'), 'utf8'));
    ok('the list and the reference file remember what was not found', listed.missingAssets === 1 && references.missing[0] === 'gone.png' && references.assets.length === 5);
    ok('the image inside the bot folder moved with it', fs.readFileSync(path.join(root, 'risubard/bangju-archive/characters/bot1/assets/own.png'), 'utf8') === 'travels with the folder');

    // A bot archived by the earlier version: the retired image has no archive name. Recheck adds it and changes nothing else.
    fs.rmSync(path.join(root, 'bangju/archive/assets/bot1/retired.png'));
    const checked = await archive.recheck();
    ok('recheck gives the unprotected image its archive name', checked.totals.bots === 1 && checked.totals.images === 5 && checked.totals.alreadyKept === 2 && checked.totals.added === 1
        && checked.totals.inFolder === 1 && checked.totals.missing === 1 && checked.missing[0].examples[0] === 'gone.png'
        && fs.statSync(path.join(root, 'bangju/archive/assets/bot1/retired.png')).ino === fs.statSync(path.join(root, 'kv/objects', retiredObject)).ino, JSON.stringify(checked.totals));
    const again = await archive.recheck();
    ok('a second recheck finds nothing new to add', again.totals.added === 0 && again.totals.alreadyKept === 3 && again.totals.missing === 1, JSON.stringify(again.totals));

    // The app drops the retired entry and deletes the object while the bot is archived.
    present.delete('assets/retired.png');
    fs.rmSync(path.join(root, 'kv/objects', retiredObject));
    const back = await archive.move({ ids: ['bot1'], direction: 'restore' });
    ok('restore gives the dropped image back to the app', back.moved.length === 1 && back.assets.returned === 1 && returned.length === 1
        && returned[0][0] === 'assets/retired.png' && returned[0][1] === 'only in the retired list', JSON.stringify(returned));
    ok('nothing left in the archive', archive.listArchived().length === 0 && !fs.existsSync(path.join(root, 'bangju/archive/assets/bot1')) && archive.pendingBatch() === null);
    fs.rmSync(root, { recursive: true, force: true });
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });
