'use strict';
// 방주 보관함 (B1)
//
// 봇 하나는 characters/<폴더> 하나다. 보관은 그 폴더를 같은 디스크의
// bangju/archive/characters/<폴더>로 옮기는 일이고, 불러오기는 되돌리는 일이다.
// 폴더 이름 바꾸기(rename)는 한 번에 끝나므로 봇은 언제나 둘 중 한 곳에만 있다.
// 서버의 목록을 다시 읽게 하는 일은 archive-routes.cjs가 맡는다.
//
// 봇 폴더 밖에 있는 것:
// - 그림(assets/…)은 앱의 공용 그림 창고에 있다. 아래 '그림 보호'가 지킨다.
// - 세이브 슬롯, BardWiki, 원고는 risubard/characters/<봇 ID>/… 에 있다. 앱에는
//   봇이 목록에서 빠졌다고 이것을 지우는 코드가 없어서 그 자리에 그대로 둔다.
//   불러오면 같은 ID로 다시 이어진다.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ARCHIVE_DIRECTORY = path.join('bangju', 'archive');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);

function fsyncDirectory(directory) {
    try {
        const descriptor = fs.openSync(directory, 'r');
        try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    } catch { /* Directory fsync is unavailable on some platforms. */ }
}

function atomicWriteJson(target, value) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const descriptor = fs.openSync(temp, 'w');
    try {
        fs.writeFileSync(descriptor, JSON.stringify(value));
        fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    fs.renameSync(temp, target);
    fsyncDirectory(path.dirname(target));
}

function readJson(target) {
    try { return JSON.parse(fs.readFileSync(target, 'utf8')); }
    catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

function isDirectory(target) {
    try { return fs.lstatSync(target).isDirectory(); } catch { return false; }
}

// `resolveActiveDirectory(id)`: the bot's current folder relative to the data
// root (characters/<folder>). `collectAssetReferences(value)`: asset file names
// a bot's metadata refers to; kept so image cleanup can spare archived bots.
// `collectNestedReferences(value)`: the same for any parsed JSON (chat files).
// `toStableId(chaId)`: the ID the server lists a bot under.
// `kv`: the shared asset store ({ has, set }), used to give images back on restore.
function createBangjuArchive({ dataRoot, resolveActiveDirectory, collectAssetReferences, collectNestedReferences, toStableId, kv }) {
    const root = path.resolve(dataRoot);
    const archiveRoot = path.join(root, ARCHIVE_DIRECTORY);
    const archivedCharacters = path.join(archiveRoot, 'characters');
    const referencesRoot = path.join(archiveRoot, 'references');
    const indexPath = path.join(archiveRoot, 'index.json');
    const journalPath = path.join(archiveRoot, 'journal.json');
    const activeCharacters = path.join(root, 'characters');

    function inside(parent, child) {
        const relative = path.relative(parent, child);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) {
            throw new Error('Unsafe archive folder name');
        }
        return child;
    }

    // What the archive list shows for one bot, read from its own folder.
    function summarize(directory, folderName) {
        const metadataPath = path.join(directory, 'metadata.json');
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        let chats = 0;
        try {
            chats = fs.readdirSync(path.join(directory, 'chats'), { withFileTypes: true })
                .filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).length;
        } catch { /* A bot without chats has no chats folder. */ }
        const references = new Set(collectAssetReferences ? collectAssetReferences(metadata) : []);
        if (collectNestedReferences) {
            // Images used only inside chat messages count too.
            let chatFolders = [];
            try {
                chatFolders = fs.readdirSync(path.join(directory, 'chats'), { withFileTypes: true })
                    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
            } catch { /* no chats */ }
            for (const chat of chatFolders) {
                const chatDirectory = path.join(directory, 'chats', chat.name);
                const chatMetadata = readJson(path.join(chatDirectory, 'metadata.json'));
                if (chatMetadata) collectNestedReferences(chatMetadata, references);
                let lines = '';
                try { lines = fs.readFileSync(path.join(chatDirectory, 'messages.jsonl'), 'utf8'); } catch { /* no messages */ }
                for (const line of lines.split('\n')) {
                    if (!line.includes('assets/')) continue;
                    try { collectNestedReferences(JSON.parse(line), references); } catch { /* skip a damaged line */ }
                }
            }
        }
        const assets = [...references].filter(name => /^[A-Za-z0-9._-]+$/.test(name)).sort();
        return {
            summary: {
                directory: folderName,
                chaId: typeof metadata.chaId === 'string' ? metadata.chaId : '',
                name: typeof metadata.name === 'string' ? metadata.name : '',
                cardBytes: fs.statSync(metadataPath).size,
                chats,
                assetCount: assets.length,
            },
            assets,
        };
    }

    function loadIndex() {
        const value = readJson(indexPath);
        if (value?.schemaVersion === 1 && Array.isArray(value.characters)) return value;
        return { schemaVersion: 1, updatedAt: 0, characters: [] };
    }

    function archivedFolders() {
        try {
            return fs.readdirSync(archivedCharacters, { withFileTypes: true })
                .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
                .map(entry => entry.name);
        } catch (error) {
            if (error?.code === 'ENOENT') return [];
            throw error;
        }
    }

    // --- 그림 보호 ---
    // 앱의 그림 정리는 "지금 쓰는 봇이 가리키지 않는 그림"을 지운다. 보관된 봇의
    // 그림이 거기에 걸리지 않도록, 보관할 때 그림 파일마다 보관함 쪽에 이름을
    // 하나 더 만든다(하드링크). 같은 디스크의 같은 내용을 가리키므로 공간과
    // 시간이 들지 않고, 앱이 원래 이름을 지워도 내용은 남는다.
    const assetLinks = id => path.join(archiveRoot, 'assets', id);
    const STORE_FILE = /^([a-f0-9]{64})\.([a-z0-9]{1,16})$/;
    const OBJECT = /^[a-f0-9]{64}$/;

    // The app's own lists of where image bytes live. They can be large, so they
    // are read once per batch and dropped a little after the last use.
    let lookup = null;
    let lookupTimer = null;
    function assetLookup() {
        if (!lookup) {
            const retired = new Map();
            const retiredIndex = readJson(path.join(root, 'kv', 'retired-assets.json'));
            for (const keys of Object.values(retiredIndex?.characters || {})) {
                for (const [key, entry] of Object.entries(keys || {})) {
                    if (!retired.has(key) && OBJECT.test(entry?.object)) retired.set(key, entry.object);
                }
            }
            lookup = {
                manifest: readJson(path.join(root, 'kv', 'manifest.json'))?.entries || {},
                retired,
                replicas: readJson(path.join(root, 'index', 'character-asset-replicas.json'))?.characters || {},
            };
        }
        clearTimeout(lookupTimer);
        lookupTimer = setTimeout(() => { lookup = null; }, 60000);
        lookupTimer.unref?.();
        return lookup;
    }
    function dropAssetLookup() {
        clearTimeout(lookupTimer);
        lookup = null;
    }

    // Where the app keeps the bytes of assets/<name>: the asset store keeps a
    // file named after its content; older assets are objects listed in the
    // manifest, or in the retired list once a folder-style bot took its own copy.
    function assetSourcePath(name) {
        const stored = STORE_FILE.exec(name);
        if (stored) {
            const file = path.join(root, 'asset-store', stored[1].slice(0, 2), name);
            if (fs.existsSync(file)) return file;
        }
        const { manifest, retired } = assetLookup();
        for (const object of [manifest[`assets/${name}`]?.object, retired.get(`assets/${name}`)]) {
            if (typeof object !== 'string' || !OBJECT.test(object)) continue;
            const file = path.join(root, 'kv', 'objects', object);
            if (fs.existsSync(file)) return file;
        }
        return null;
    }

    // Images a folder-style (V3) bot keeps inside its own folder travel with it.
    function ownFolderAssets(id) {
        const entries = assetLookup().replicas[id]?.entries;
        return new Set(Array.isArray(entries) ? entries.map(entry => entry?.key).filter(Boolean) : []);
    }

    function protectAssets(id, assets) {
        const folder = assetLinks(id);
        let saved = 0;
        let copied = 0;
        let inFolder = 0;
        const missing = [];
        let own = null;
        for (const name of assets) {
            const source = assetSourcePath(name);
            if (!source) {
                own ||= ownFolderAssets(id);
                if (own.has(`assets/${name}`)) inFolder += 1;
                else missing.push(name);
                continue;
            }
            fs.mkdirSync(folder, { recursive: true });
            const target = path.join(folder, name);
            try { fs.linkSync(source, target); }
            catch (error) {
                if (error?.code === 'EEXIST') { /* kept from an earlier, interrupted try */ }
                else if (['EXDEV', 'EPERM', 'ENOTSUP', 'EMLINK'].includes(error?.code)) { fs.copyFileSync(source, target); copied += 1; }
                else throw error;
            }
            saved += 1;
        }
        return { protected: saved, missing, copied, inFolder };
    }

    // Gives back any image the app's cleanup removed while the bot was archived.
    function returnAssets(id) {
        const folder = assetLinks(id);
        let names;
        try { names = fs.readdirSync(folder); } catch { return { returned: 0 }; }
        let returned = 0;
        for (const name of names) {
            const key = `assets/${name}`;
            if (kv && !kv.has(key)) {
                kv.set(key, fs.readFileSync(path.join(folder, name)));
                returned += 1;
            }
        }
        fs.rmSync(folder, { recursive: true, force: true });
        return { returned };
    }

    // The folders are the truth. The index is a small list for fast display and
    // is rebuilt from the folders whenever the two disagree.
    function reconcileIndex() {
        const index = loadIndex();
        const folders = new Set(archivedFolders());
        const kept = index.characters.filter(entry => folders.has(entry.directory));
        const known = new Set(kept.map(entry => entry.directory));
        let changed = kept.length !== index.characters.length;
        for (const folderName of folders) {
            if (known.has(folderName)) continue;
            let details;
            try { details = summarize(path.join(archivedCharacters, folderName), folderName); }
            catch { continue; } // An unreadable folder stays where it is and is left out of the list.
            const { summary, assets } = details;
            const id = toStableId && summary.chaId ? toStableId(summary.chaId) : folderName;
            kept.push({ id, ...summary, archivedAt: Date.now() });
            atomicWriteJson(path.join(referencesRoot, `${id}.json`), { schemaVersion: 1, assets });
            changed = true;
        }
        if (changed) atomicWriteJson(indexPath, { schemaVersion: 1, updatedAt: Date.now(), characters: kept });
        return { schemaVersion: 1, updatedAt: index.updatedAt, characters: kept };
    }

    // A journal left behind means the server stopped during a move. Every
    // folder is already in exactly one place, so only the index needs repair.
    function recover() {
        const journal = readJson(journalPath);
        const index = reconcileIndex();
        // Kept image names whose bot is not archived (a move stopped half way):
        // give the images back to the app and drop the extra names.
        let returned = 0;
        const archivedIds = new Set(index.characters.map(entry => entry.id));
        let kept = [];
        try { kept = fs.readdirSync(path.join(archiveRoot, 'assets')); } catch { /* nothing kept */ }
        for (const id of kept) {
            if (!archivedIds.has(id)) returned += returnAssets(id).returned;
        }
        dropAssetLookup();
        // The journal stays while some bots of that batch still wait, so the batch can be continued.
        const pending = pendingBatch();
        if (journal && !pending) fs.rmSync(journalPath, { force: true });
        return { interrupted: Boolean(journal), remaining: pending?.remaining.length ?? 0, archived: index.characters.length, returnedAssets: returned };
    }

    // A batch that stopped half way (the server went down): the bots that had not moved yet.
    function pendingBatch() {
        const journal = readJson(journalPath);
        if (!journal || !Array.isArray(journal.entries)) return null;
        const source = journal.direction === 'archive' ? activeCharacters : archivedCharacters;
        const remaining = journal.entries
            .filter(entry => validId(entry?.id) && typeof entry.directory === 'string' && isDirectory(path.join(source, path.basename(entry.directory))))
            .map(entry => entry.id);
        if (!remaining.length) return null;
        return { direction: journal.direction, startedAt: journal.startedAt, total: journal.entries.length, remaining };
    }

    function clearPendingBatch() {
        fs.rmSync(journalPath, { force: true });
    }

    function listArchived() {
        return reconcileIndex().characters;
    }

    // `sidebarOf(id)`: the bot's entry in the server's list index and its
    // position there ({ position, entry }), remembered so a restore can put the
    // bot and its chats back in the same order.
    // `onProgress({ done, total, name })` after each bot; `pause()` lets other
    // requests (such as the progress display) be answered between bots.
    async function move({ ids, direction, sidebarOf, onProgress, pause }) {
        if (direction !== 'archive' && direction !== 'restore') throw new Error('direction must be archive or restore');
        if (!Array.isArray(ids) || ids.some(id => !validId(id))) throw new Error('Invalid bot ID');
        const unique = [...new Set(ids)];
        const index = reconcileIndex();
        const byId = new Map(index.characters.map(entry => [entry.id, entry]));
        const plan = [];
        const failed = [];
        for (const id of unique) {
            try {
                if (direction === 'archive') {
                    const relative = resolveActiveDirectory(id);
                    const from = inside(activeCharacters, path.join(root, relative));
                    const folderName = path.basename(from);
                    const to = inside(archivedCharacters, path.join(archivedCharacters, folderName));
                    if (!isDirectory(from)) throw new Error('Bot folder not found');
                    if (fs.existsSync(to)) throw new Error('A folder with this name is already archived');
                    plan.push({ id, folderName, from, to });
                } else {
                    const entry = byId.get(id);
                    if (!entry) throw new Error('Bot is not in the archive');
                    const from = inside(archivedCharacters, path.join(archivedCharacters, entry.directory));
                    const to = inside(activeCharacters, path.join(activeCharacters, entry.directory));
                    if (!isDirectory(from)) throw new Error('Archived folder not found');
                    if (fs.existsSync(to)) throw new Error('A bot folder with this name already exists');
                    plan.push({ id, folderName: entry.directory, from, to });
                }
            } catch (error) {
                failed.push({ id, error: String(error?.message || error) });
            }
        }
        if (!plan.length) return { moved: [], failed, restoredSidebar: [], assets: { protected: 0, missing: 0, copied: 0, inFolder: 0, returned: 0 }, missing: [] };

        fs.mkdirSync(archivedCharacters, { recursive: true });
        fs.mkdirSync(activeCharacters, { recursive: true });
        atomicWriteJson(journalPath, {
            schemaVersion: 1, direction, startedAt: Date.now(),
            entries: plan.map(entry => ({ id: entry.id, directory: entry.folderName })),
        });
        dropAssetLookup();
        const moved = [];
        const restoredSidebar = [];
        const assetTotals = { protected: 0, missing: 0, copied: 0, inFolder: 0, returned: 0 };
        // Images that could not be found anywhere, by bot (kept short for the report).
        const missingReport = [];
        const characters = index.characters.slice();
        const saveIndex = () => atomicWriteJson(indexPath, { schemaVersion: 1, updatedAt: Date.now(), characters });
        let step = 0;
        for (const entry of plan) {
            step += 1;
            let shownName = entry.folderName;
            try {
                let details = null;
                let listed = null;
                if (direction === 'archive') {
                    details = summarize(entry.from, entry.folderName);
                    listed = sidebarOf ? sidebarOf(entry.id) : null;
                    // Before the folder moves: an interruption leaves only spare names behind.
                    shownName = details.summary.name || entry.folderName;
                    const kept = protectAssets(entry.id, details.assets);
                    assetTotals.protected += kept.protected;
                    assetTotals.missing += kept.missing.length;
                    assetTotals.copied += kept.copied;
                    assetTotals.inFolder += kept.inFolder;
                    if (kept.missing.length) {
                        details.missing = kept.missing;
                        if (missingReport.length < 200) missingReport.push({ id: entry.id, name: shownName, count: kept.missing.length, examples: kept.missing.slice(0, 5) });
                    }
                }
                fs.renameSync(entry.from, entry.to);
                if (direction === 'archive') {
                    characters.push({
                        id: entry.id, ...details.summary, archivedAt: Date.now(),
                        ...(details.missing ? { missingAssets: details.missing.length } : {}),
                        ...(listed ? { position: listed.position, sidebar: listed.entry } : {}),
                    });
                    atomicWriteJson(path.join(referencesRoot, `${entry.id}.json`), {
                        schemaVersion: 1, assets: details.assets, ...(details.missing ? { missing: details.missing } : {}),
                    });
                } else {
                    const at = characters.findIndex(item => item.id === entry.id);
                    if (at >= 0) {
                        const [removed] = characters.splice(at, 1);
                        shownName = removed.name || entry.folderName;
                        if (removed.sidebar) restoredSidebar.push({ position: removed.position ?? Infinity, entry: removed.sidebar });
                    }
                    fs.rmSync(path.join(referencesRoot, `${entry.id}.json`), { force: true });
                    assetTotals.returned += returnAssets(entry.id).returned;
                }
                moved.push(entry.id);
            } catch (error) {
                failed.push({ id: entry.id, error: String(error?.message || error) });
            }
            // A long batch keeps its list on disk as it goes, so an interruption loses no order information.
            if (step % 25 === 0 && step < plan.length) saveIndex();
            if (onProgress) onProgress({ done: step, total: plan.length, name: shownName });
            if (pause && step < plan.length) await pause();
        }
        fsyncDirectory(activeCharacters);
        fsyncDirectory(archivedCharacters);
        saveIndex();
        fs.rmSync(journalPath, { force: true });
        dropAssetLookup();
        return { moved, failed, restoredSidebar, assets: assetTotals, missing: missingReport };
    }

    // Asset file names that archived bots still need.
    function referencedAssets() {
        const names = new Set();
        for (const entry of reconcileIndex().characters) {
            const references = readJson(path.join(referencesRoot, `${entry.id}.json`));
            for (const name of references?.assets || []) names.add(name);
        }
        return names;
    }

    return { archiveRoot, listArchived, move, recover, pendingBatch, clearPendingBatch, referencedAssets };
}

module.exports = { ARCHIVE_DIRECTORY, createBangjuArchive };
