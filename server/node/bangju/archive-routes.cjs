'use strict';
// 방주 보관함 (B1): 서버 주소.
//
// 브라우저의 저장 경로(/api/patch, /api/write)를 타지 않는다. 순서는 이렇다.
//   1. 폴더를 옮긴다(빠름). 열려 있던 탭은 전부 낡은 것으로 만들어(revokeSessions)
//      옛 목록을 다시 올리지 못하게 한다. 여기서 바로 답한다.
//   2. 조금 뒤 서버가 파일에서 목록을 다시 읽는다(adopt, 느림). 이것을 '정리'라고
//      부른다. 잇달아 옮기면 마지막에 한 번만 한다. 그 사이에 앱이 열리면 서버가
//      스스로 다시 읽으므로 결과는 같다.
//   3. 다시 읽기가 실패하면, 아직 정리되지 않은 묶음을 전부 제자리로 되돌린다.

const fs = require('node:fs');
const path = require('node:path');
const { createBangjuArchive } = require('./archive.cjs');
const { stableId } = require('../user-data-repository.cjs');
const { collectDatabaseAssetReferences, collectNestedAssetReferences } = require('../orphan-cleanup.cjs');
const { atomicWriteJson } = require('../file-store.cjs');

// 봇을 넣거나 지울 때 앱이 한 번에 서버로 보낼 수 있는 한도(server.cjs의 express.json 한도).
const SERVER_REQUEST_LIMIT_BYTES = 100 * 1024 * 1024;

// The asset file names one bot's metadata refers to, found the way the app's
// own image cleanup finds them.
function botAssetReferences(metadata) {
    const references = collectDatabaseAssetReferences({ characters: [metadata] });
    collectNestedAssetReferences(metadata, references);
    return references;
}

function registerBangjuArchiveRoutes(app, {
    auth, queue, repository, dataRoot, isBlocked, flush, hasExternalChanges, adopt,
    revokeSessions, databaseBytes, kv, activeDatabase, logger,
}) {
    const archive = createBangjuArchive({
        dataRoot,
        resolveActiveDirectory: id => repository.characterDirectoryPath(id),
        collectAssetReferences: botAssetReferences,
        collectNestedReferences: collectNestedAssetReferences,
        toStableId: chaId => stableId(chaId, 'character'),
        kv,
    });
    try {
        const recovered = archive.recover();
        if (recovered.migrated?.length) logger?.info?.(`[Bangju archive] Moved ${recovered.migrated.join(', ')} to risubard/bangju-archive so backups carry the archive`);
        if (recovered.interrupted) {
            logger?.warn?.(`[Bangju archive] A move was interrupted; the index was rebuilt from the folders (${recovered.remaining} bot(s) of that batch still wait)`);
        }
    } catch (error) {
        logger?.error?.('[Bangju archive] Recovery failed', error);
    }

    const elapsed = startedAt => Math.round(performance.now() - startedAt);
    // 옮겼지만 서버가 아직 다시 읽지 않은 묶음들. 다시 읽기가 실패하면 이것을 되돌린다.
    let unsettled = [];
    const opposite = direction => (direction === 'archive' ? 'restore' : 'archive');
    // 검증 스크립트용: 'now'이면 옮긴 요청 안에서 정리까지 끝내고 답한다.
    const settleNowByDefault = process.env.BANGJU_ARCHIVE_SETTLE === 'now';
    const settleDelayMs = Math.max(0, Number(process.env.BANGJU_ARCHIVE_SETTLE_DELAY_MS ?? 5000) || 0);

    // --- 앱의 폴더 ---
    // 앱의 봇 목록 순서(settings/app.json의 characterOrder)는 봇 ID 또는 폴더({ id, name, data: [봇 ID] })로
    // 되어 있다. 봇이 목록에서 사라지면 앱이 폴더에서도 그 ID를 지우므로, 보관할 때 자리를 적어 두었다가
    // 불러올 때 같은 폴더의 같은 자리에 다시 넣는다.
    const SETTINGS_FILE = 'settings/app.json';
    function readSettings() {
        try { return JSON.parse(fs.readFileSync(path.join(dataRoot, SETTINGS_FILE), 'utf8')); } catch { return null; }
    }
    // What the app shows right now. The server's memory is newer than the file while a save is
    // waiting; after our own move the file is newer until the server has reloaded (which the app
    // opening can do before our own tidy-up runs).
    function currentSettings() {
        let memory = null;
        try { memory = activeDatabase ? activeDatabase() : null; } catch { /* read the file */ }
        if (!Array.isArray(memory?.characterOrder)) return readSettings();
        let stale = false;
        try { stale = unsettled.length > 0 && hasExternalChanges(); } catch { stale = unsettled.length > 0; }
        return stale ? readSettings() : memory;
    }
    function folderMap(settings = currentSettings()) {
        const folders = [];
        const where = new Map();
        const order = Array.isArray(settings?.characterOrder) ? settings.characterOrder : [];
        order.forEach((item, index) => {
            if (typeof item === 'string') where.set(item, { index });
            else if (item && typeof item === 'object' && Array.isArray(item.data)) {
                const folder = { id: String(item.id ?? ''), name: String(item.name ?? '') };
                folders.push(folder);
                item.data.forEach((chaId, at) => {
                    if (typeof chaId === 'string') where.set(chaId, { folderId: folder.id, folderName: folder.name, index: at });
                });
            }
        });
        return { folders, where };
    }

    // Puts restored bots back into the folders they were in. Runs before the server reloads.
    function restoreFolders(entries) {
        const settings = readSettings();
        if (!settings || !Array.isArray(settings.characterOrder)) return 0;
        const { where } = folderMap(settings);
        let placed = 0;
        // Lowest place first, so several bots of one folder come back in their old order.
        const sorted = entries.filter(entry => entry?.order).sort((a, b) => (a.order.index | 0) - (b.order.index | 0));
        for (const { chaId, order } of sorted) {
            // Still listed (the app was not opened in between): it never left its place.
            if (typeof chaId !== 'string' || !order || where.has(chaId)) continue;
            if (order.folderId) {
                const folder = settings.characterOrder.find(item => item && typeof item === 'object' && String(item.id ?? '') === order.folderId && Array.isArray(item.data));
                // The folder was deleted meanwhile: the app lists the bot outside folders.
                if (!folder) continue;
                folder.data.splice(Math.min(Math.max(order.index | 0, 0), folder.data.length), 0, chaId);
            } else {
                settings.characterOrder.splice(Math.min(Math.max(order.index | 0, 0), settings.characterOrder.length), 0, chaId);
            }
            where.set(chaId, order);
            placed += 1;
        }
        if (placed) atomicWriteJson(dataRoot, SETTINGS_FILE, settings);
        return placed;
    }

    // --- 쓰는 봇의 태그와 표지 ---
    // 서버가 목록을 메모리에 들고 있으면(앱이 한 번이라도 열렸으면) 거기서 읽는다. 아니면 봇의
    // metadata.json에서 읽어야 하는데, 봇이 많으면 오래 걸리므로 뒤에서 조금씩 읽어 적어 둔다.
    const FACTS_FILE = 'active-facts.json';
    let factsCache = null;
    const factsQueue = [];
    const factsQueued = new Set();
    let factsBusy = false;
    function cachedFacts() {
        if (!factsCache) {
            factsCache = new Map();
            try {
                const stored = JSON.parse(fs.readFileSync(path.join(archive.archiveRoot, FACTS_FILE), 'utf8'));
                for (const [id, value] of Object.entries(stored?.bots || {})) factsCache.set(id, value);
            } catch { /* nothing cached yet */ }
        }
        return factsCache;
    }
    function readFactsFromDisk(id) {
        const file = path.join(dataRoot, repository.characterDirectoryPath(id), 'metadata.json');
        const stat = fs.statSync(file);
        return { stamp: `${stat.size}:${Math.round(stat.mtimeMs)}`, ...archive.listFacts(JSON.parse(fs.readFileSync(file, 'utf8'))) };
    }
    function queueFacts(id) {
        if (factsQueued.has(id)) return;
        factsQueued.add(id);
        factsQueue.push(id);
        if (factsBusy) return;
        factsBusy = true;
        (async () => {
            let read = 0;
            while (factsQueue.length) {
                const next = factsQueue.shift();
                try { cachedFacts().set(next, readFactsFromDisk(next)); } catch { /* the bot left or is unreadable */ }
                factsQueued.delete(next);
                read += 1;
                // One bot's file at a time, with room for other requests in between.
                await new Promise(resolve => setTimeout(resolve, read % 20 === 0 ? 30 : 0));
            }
            try {
                fs.mkdirSync(archive.archiveRoot, { recursive: true });
                fs.writeFileSync(path.join(archive.archiveRoot, FACTS_FILE), JSON.stringify({ schemaVersion: 1, bots: Object.fromEntries(cachedFacts()) }));
            } catch { /* kept in memory only */ }
        })().finally(() => { factsBusy = false; });
    }
    const factsPending = () => factsQueue.length + (factsBusy ? 1 : 0);

    // Until the server reloads, its list index still names archived bots; leave them out.
    function activeEntries(archivedEntries = archive.listArchived()) {
        const archivedIds = new Set(archivedEntries.map(entry => entry.id));
        return (repository.loadSidebarIndex().characters || []).filter(character => !archivedIds.has(character.id));
    }

    // The last time a bot was talked to, from the list index entry (its chats carry their last date).
    const lastChatAt = entry => Math.max(0, entry?.updatedAt || 0, ...(entry?.chats || []).map(chat => chat?.lastDate || 0));

    // Tags and cover of the bots in use, from the list the server holds in memory (null when it holds none yet).
    function memoryFacts() {
        try {
            const characters = activeDatabase ? activeDatabase()?.characters : null;
            if (!Array.isArray(characters) || !characters.length) return null;
            const facts = new Map();
            for (const character of characters) {
                if (typeof character?.chaId === 'string') facts.set(stableId(character.chaId, 'character'), archive.listFacts(character));
            }
            return facts;
        } catch { return null; }
    }

    // One bot's tags and cover name, wherever they can be had right now.
    function factsOf(id) {
        const known = memoryFacts()?.get(id) || cachedFacts().get(id);
        if (known) return known;
        try {
            const read = readFactsFromDisk(id);
            cachedFacts().set(id, read);
            return read;
        } catch { return null; }
    }

    function listActive(archivedEntries, placement = folderMap()) {
        const memory = memoryFacts();
        const cache = memory ? null : cachedFacts();
        const folderOf = new Map();
        for (const [chaId, place] of placement.where) folderOf.set(stableId(chaId, 'character'), place.folderId || '');
        return activeEntries(archivedEntries).map(character => {
            let cardBytes = 0;
            let stamp = '';
            try {
                const stat = fs.statSync(path.join(dataRoot, repository.characterDirectoryPath(character.id), 'metadata.json'));
                cardBytes = stat.size;
                stamp = `${stat.size}:${Math.round(stat.mtimeMs)}`;
            } catch { /* Listed but unreadable: shown with size 0. */ }
            let known = memory?.get(character.id);
            if (!known && cache) {
                const cached = cache.get(character.id);
                if (cached && cached.stamp === stamp) known = cached;
                // Not read yet (or the bot changed): read it in the background; the page asks again.
                else if (stamp) queueFacts(character.id);
            }
            return {
                id: character.id, name: character.name || '', cardBytes, chats: (character.chats || []).length,
                lastChatAt: lastChatAt(character), tags: known?.tags || [], hasCover: Boolean(known?.image),
                folderId: folderOf.get(character.id) || '',
            };
        });
    }

    // The server orders bots and their chats by its list index and puts anything
    // it does not find there at the end. Put the remembered entries back first,
    // so the reload that follows restores the old order.
    function restoreListOrder(entries) {
        const sidebar = repository.loadSidebarIndex();
        const characters = Array.isArray(sidebar.characters) ? sidebar.characters.slice() : [];
        const present = new Set(characters.map(character => character.id));
        for (const { position, entry } of entries.slice().sort((a, b) => a.position - b.position)) {
            if (!entry?.id || present.has(entry.id)) continue;
            characters.splice(Math.min(position, characters.length), 0, entry);
            present.add(entry.id);
        }
        atomicWriteJson(dataRoot, 'index/sidebar.json', { ...sidebar, characters });
    }

    // 어느 설치본이 돌고 있는지 알려 준다(로그인 불필요). build-info.json은 시험용
    // 설치본을 만들 때 워크플로가 넣는다.
    app.get('/api/bangju/version', (req, res) => {
        let build = { commit: 'dev', builtAt: null };
        try { build = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8')); } catch { /* local run */ }
        res.set('Cache-Control', 'no-store').json({ feature: 'bangju-archive', ...build });
    });

    // 보관함 화면. 본 화면(SPA)과 따로 열리며, 본 화면이 안 열려도 쓸 수 있다.
    const pagePath = path.join(__dirname, 'archive-page.html');
    app.get('/bangju/archive', (req, res) => {
        res.set('Cache-Control', 'no-store').type('html').send(fs.readFileSync(pagePath));
    });

    // 마지막 결과를 남겨 둔다. 오래 걸려서 화면과의 연결이 끊기거나 창을 닫아도,
    // 다시 열면 결과(걸린 시간 등)를 볼 수 있다.
    function remember(file, value) {
        try {
            fs.mkdirSync(archive.archiveRoot, { recursive: true });
            fs.writeFileSync(path.join(archive.archiveRoot, file), JSON.stringify(value));
        } catch (error) {
            logger?.warn?.('[Bangju archive] Could not record a result', error);
        }
    }
    function recall(file) {
        try { return JSON.parse(fs.readFileSync(path.join(archive.archiveRoot, file), 'utf8')); } catch { return null; }
    }

    let running = null;
    let queued = 0;
    let settleTimer = null;
    let settleState = { state: 'idle' };

    // Not queued on purpose: it must answer while a move holds the queue.
    app.get('/api/bangju/archive/status', async (req, res) => {
        if (!await auth(req, res)) return;
        let interrupted = null;
        if (!running) {
            try {
                const pending = archive.pendingBatch();
                if (pending) interrupted = { direction: pending.direction, total: pending.total, remaining: pending.remaining.length, startedAt: pending.startedAt };
            } catch { /* shown on the next poll */ }
        }
        res.set('Cache-Control', 'no-store').json({
            running, queued,
            settle: { ...settleState, bots: unsettled.reduce((total, batch) => total + batch.ids.length, 0) },
            last: recall('last-run.json'),
            lastSettle: recall('last-settle.json'),
            lastRecheck: recall('last-recheck.json'),
            interrupted,
        });
    });

    // Moves folders one way and keeps the list order information in step.
    async function moveFolders(ids, direction, onProgress) {
        const listed = repository.loadSidebarIndex().characters || [];
        const positions = new Map(listed.map((character, position) => [character.id, position]));
        const placement = direction === 'archive' ? folderMap() : null;
        const result = await archive.move({
            ids, direction, onProgress,
            sidebarOf: id => (positions.has(id) ? { position: positions.get(id), entry: listed[positions.get(id)] } : null),
            orderOf: chaId => placement?.where.get(chaId) || null,
            pause: () => new Promise(resolve => setImmediate(resolve)),
        });
        if (direction === 'restore' && result.restoredSidebar.length) restoreListOrder(result.restoredSidebar);
        if (direction === 'restore' && result.restoredOrder.length) {
            try { result.foldersRestored = restoreFolders(result.restoredOrder); }
            catch (error) { logger?.warn?.('[Bangju archive] Could not put restored bots back into their folders', error); }
        }
        return result;
    }

    // 정리: 서버가 파일에서 목록을 다시 읽게 한다. 저장 대기줄 안에서만 부른다.
    async function settleWithinQueue() {
        if (!unsettled.length) return { status: 'nothing' };
        if (isBlocked()) return { status: 'postponed' };
        const startedAt = performance.now();
        const batches = unsettled;
        const bots = batches.reduce((total, batch) => total + batch.ids.length, 0);
        const finish = result => {
            const settled = { ...result, bots, totalMs: elapsed(startedAt), finishedAt: new Date().toISOString() };
            remember('last-settle.json', settled);
            return settled;
        };
        try {
            // 검증 스크립트가 되돌리기 경로를 시험할 때만 쓰는 스위치.
            if (process.env.BANGJU_ARCHIVE_TEST_FAIL_RELOAD === '1') throw new Error('injected reload failure (test)');
            // If the app was opened in between, the server has already reloaded on its own.
            const adopted = hasExternalChanges() ? await adopt() : null;
            unsettled = [];
            logger?.info?.(`[Bangju archive] settled ${bots} bot(s) in ${elapsed(startedAt)}ms`);
            return finish({ status: 'done', adopted: Boolean(adopted), etag: adopted?.etag ?? null, storedCopyBytes: databaseBytes() });
        } catch (error) {
            // The server could not reload its list: put every unsettled folder back, newest batch first.
            let rolledBack = 0;
            const notRolledBack = [];
            for (const batch of batches.slice().reverse()) {
                try {
                    const back = await moveFolders(batch.ids, opposite(batch.direction));
                    rolledBack += back.moved.length;
                    notRolledBack.push(...back.failed);
                } catch (rollbackError) {
                    notRolledBack.push(...batch.ids.map(id => ({ id, error: String(rollbackError?.message || rollbackError) })));
                }
            }
            unsettled = [];
            try { if (hasExternalChanges()) await adopt(); } catch { /* the next page load reloads the list again */ }
            logger?.error?.('[Bangju archive] Reload failed; folders were moved back', error);
            return finish({
                status: 'rolled-back',
                code: 'BANGJU_ARCHIVE_ROLLED_BACK',
                error: `목록을 다시 읽지 못해 원래대로 되돌렸습니다: ${String(error?.message || error)}`,
                rolledBack, notRolledBack,
            });
        }
    }

    function scheduleSettle() {
        clearTimeout(settleTimer);
        settleState = { state: 'pending', since: new Date().toISOString() };
        settleTimer = setTimeout(() => {
            settleTimer = null;
            queue(async () => {
                settleState = { state: 'running', since: new Date().toISOString() };
                try {
                    const settled = await settleWithinQueue();
                    if (settled.status === 'postponed') scheduleSettle();
                } finally {
                    if (settleState.state === 'running') settleState = { state: 'idle' };
                }
            }).catch(error => {
                settleState = { state: 'idle' };
                logger?.error?.('[Bangju archive] Settle failed', error);
            });
        }, settleDelayMs);
        settleTimer.unref?.();
    }

    app.get('/api/bangju/archive', async (req, res, next) => {
        if (!await auth(req, res)) return;
        try {
            await queue(async () => {
                const startedAt = performance.now();
                const stored = archive.listArchived();
                const placement = folderMap();
                const folderIds = new Set(placement.folders.map(folder => folder.id));
                const active = listActive(stored, placement);
                // The stored entries also carry what a restore needs; the list shows the basics.
                const archived = stored.map(entry => ({
                    id: entry.id, name: entry.name, cardBytes: entry.cardBytes, chats: entry.chats,
                    assetCount: entry.assetCount, archivedAt: entry.archivedAt,
                    lastChatAt: lastChatAt(entry.sidebar), tags: entry.tags || [], hasCover: Boolean(entry.image),
                    // The app folder it was in. A folder deleted since then is shown by its old name.
                    folderId: entry.order?.folderId || '',
                    ...(entry.order?.folderId && !folderIds.has(entry.order.folderId) ? { folderName: entry.order.folderName || '' } : {}),
                    ...(entry.missingAssets ? { missingAssets: entry.missingAssets } : {}),
                }));
                const sum = list => list.reduce((total, item) => total + (item.cardBytes || 0), 0);
                res.json({
                    active, archived,
                    folders: placement.folders,
                    // 쓰는 봇 가운데 태그·표지를 아직 읽지 못한 수. 화면이 조금 뒤 /facts로 다시 묻는다.
                    factsPending: factsPending(),
                    totals: {
                        active: active.length, activeCardBytes: sum(active),
                        archived: archived.length, archivedCardBytes: sum(archived),
                        // 그림 이름표가 아직 없는 보관 봇(백업을 되돌린 직후 등). 화면이 '다시 확인'을 권한다.
                        unprotectedBots: archive.unprotectedCount(stored),
                        // 서버가 보관하는 전체 사본(채팅 포함). 앱이 열 때 받는 양이 아니다.
                        storedCopyBytes: databaseBytes(),
                        serverRequestLimitBytes: SERVER_REQUEST_LIMIT_BYTES,
                    },
                    listMs: elapsed(startedAt),
                });
            });
        } catch (error) { next(error); }
    });

    // 쓰는 봇의 태그·표지 여부(뒤에서 읽고 있는 것의 진행 상황). 목록을 통째로 다시 받지 않게 따로 준다.
    app.get('/api/bangju/archive/facts', async (req, res) => {
        if (!await auth(req, res)) return;
        const facts = {};
        const memory = memoryFacts();
        for (const [id, value] of memory || cachedFacts()) facts[id] = { tags: value.tags || [], hasCover: Boolean(value.image) };
        res.set('Cache-Control', 'no-store').json({ pending: memory ? 0 : factsPending(), facts });
    });

    // 표지 그림. 보관된 봇은 보관함이 지키고 있는 그림에서, 쓰는 봇은 앱의 그림 창고에서 준다.
    // 원본 크기 그대로라서 화면은 '표지 보기'를 켰을 때 보이는 줄만 받아 간다.
    const COVER_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
    app.get('/api/bangju/archive/cover/:id', async (req, res) => {
        if (!await auth(req, res)) return;
        try {
            const id = String(req.params.id || '');
            let bytes = null;
            let name = '';
            const kept = archive.archivedCoverPath(id);
            if (kept) {
                bytes = fs.readFileSync(kept);
                name = kept;
            } else {
                const stored = archive.listArchived().find(entry => entry.id === id);
                name = stored ? (stored.image || '') : (factsOf(id)?.image || '');
                if (name && kv?.get) bytes = kv.get(`assets/${name}`);
            }
            if (!bytes || !bytes.length) return res.status(404).json({ error: 'No cover image' });
            const type = COVER_TYPES[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';
            res.set('Cache-Control', 'private, max-age=86400').set('X-Content-Type-Options', 'nosniff').type(type).send(Buffer.from(bytes));
        } catch (error) {
            logger?.warn?.('[Bangju archive] Cover unavailable', error);
            res.status(404).json({ error: 'No cover image' });
        }
    });

    // 정리를 지금 한다(기다리는 중이면 앞당긴다). 화면과 검증 스크립트가 쓴다.
    app.post('/api/bangju/archive/settle', async (req, res) => {
        if (!await auth(req, res)) return;
        try {
            clearTimeout(settleTimer);
            settleTimer = null;
            const settled = await queue(async () => {
                settleState = { state: 'running', since: new Date().toISOString() };
                try { return await settleWithinQueue(); }
                finally { settleState = { state: 'idle' }; }
            });
            if (settled.status === 'postponed') scheduleSettle();
            res.status(settled.status === 'rolled-back' ? 500 : 200).json(settled);
        } catch (error) {
            logger?.error?.('[Bangju archive] Settle failed', error);
            res.status(500).json({ status: 'failed', error: String(error?.message || error) });
        }
    });

    // 보관된 봇의 그림 가운데 아직 보관함 이름표가 없는 것을 다시 찾아본다. 이름표를
    // 더할 뿐이고 아무것도 옮기거나 지우지 않는다. 예전 버전으로 보관한 봇을 위한 것.
    app.post('/api/bangju/archive/recheck', async (req, res) => {
        if (!await auth(req, res)) return;
        const receivedAt = performance.now();
        let mine = null;
        queued += 1;
        try {
            const checked = await queue(async () => {
                mine = { direction: 'recheck', total: 0, done: 0, current: '', startedAt: new Date().toISOString() };
                running = mine;
                const placement = folderMap();
                return archive.recheck({
                    orderOf: chaId => placement.where.get(chaId) || null,
                    onProgress: progress => { mine.total = progress.total; mine.done = progress.done; mine.current = progress.name; },
                    pause: () => new Promise(resolve => setImmediate(resolve)),
                });
            });
            const result = { ...checked, totalMs: elapsed(receivedAt), finishedAt: new Date().toISOString() };
            remember('last-recheck.json', result);
            logger?.info?.(`[Bangju archive] recheck ${JSON.stringify(result.totals)} in ${result.totalMs}ms`);
            res.json(result);
        } catch (error) {
            logger?.error?.('[Bangju archive] Recheck failed', error);
            res.status(500).json({ error: String(error?.message || error) });
        } finally {
            queued -= 1;
            if (mine && running === mine) running = null;
        }
    });

    // 중간에 끊긴 묶음을 잇지 않고 잊는다(이미 옮겨진 봇은 그대로 둔다).
    app.post('/api/bangju/archive/dismiss-interrupted', async (req, res) => {
        if (!await auth(req, res)) return;
        if (running) return res.status(409).json({ error: 'A move is running' });
        archive.clearPendingBatch();
        res.json({ ok: true });
    });

    app.post('/api/bangju/archive/move', async (req, res) => {
        if (!await auth(req, res)) return;
        const body = req.body || {};
        let { ids, direction } = body;
        if (body.resume === true) {
            // 중간에 끊긴 묶음을 이어서 한다.
            const pending = archive.pendingBatch();
            if (!pending) return res.status(409).json({ code: 'BANGJU_ARCHIVE_NOTHING_TO_RESUME', error: 'No interrupted batch to continue' });
            ids = pending.remaining;
            direction = pending.direction;
        }
        if (!Array.isArray(ids) || !ids.length || ids.length > 5000 || (direction !== 'archive' && direction !== 'restore')) {
            return res.status(400).json({ error: 'ids and direction (archive or restore) are required' });
        }
        const settleNow = body.settle === 'now' || (settleNowByDefault && body.settle !== 'later');
        // The page names each request, so it can find this run's result again after a lost connection.
        const runId = typeof body.runId === 'string' && body.runId.length <= 80 ? body.runId : null;
        const receivedAt = performance.now();
        let mine = null;
        queued += 1;
        // Answers the browser and records the same thing as the last run.
        const finish = (status, result) => {
            const run = { runId, direction, requested: ids.length, ...result, totalMs: elapsed(receivedAt), finishedAt: new Date().toISOString() };
            remember('last-run.json', run);
            if (!res.headersSent) res.status(status).json(run);
        };
        try {
            await queue(async () => {
                const timings = {};
                if (isBlocked()) {
                    return res.status(409).json({ code: 'BANGJU_ARCHIVE_BUSY', error: 'Storage is busy; try again shortly' });
                }
                mine = { runId, direction, total: ids.length, done: 0, current: '', startedAt: new Date().toISOString() };
                running = mine;
                let startedAt = performance.now();
                // Our own earlier move, not yet reloaded: every tab was made stale then, and a tab that
                // reloads makes the server reload first, so no edit can be waiting. Skip straight to the move.
                const continuing = unsettled.length > 0 && hasExternalChanges();
                if (!continuing) {
                    // The server has reloaded on its own since our last move (or there was none).
                    unsettled = [];
                    // Edits the browser already sent must reach the bot folders before they move.
                    await flush();
                    if (isBlocked() || hasExternalChanges()) {
                        return res.status(409).json({ code: 'BANGJU_ARCHIVE_BUSY', error: 'Files changed outside the app; review them first' });
                    }
                }
                timings.flushMs = elapsed(startedAt);
                const before = { active: activeEntries().length };
                startedAt = performance.now();
                const result = await moveFolders(ids, direction, progress => {
                    mine.done = progress.done;
                    mine.current = progress.name;
                });
                timings.moveMs = elapsed(startedAt);
                let settled = null;
                if (result.moved.length) {
                    // Every open tab still holds the old list.
                    revokeSessions();
                    unsettled.push({ direction, ids: result.moved });
                    if (settleNow) {
                        clearTimeout(settleTimer);
                        settleTimer = null;
                        startedAt = performance.now();
                        settled = await settleWithinQueue();
                        timings.adoptMs = elapsed(startedAt);
                        if (settled.status === 'postponed') scheduleSettle();
                    } else {
                        scheduleSettle();
                    }
                }
                if (settled?.status === 'rolled-back') {
                    return finish(500, {
                        status: 'rolled-back', code: settled.code, error: settled.error,
                        rolledBack: settled.rolledBack, notRolledBack: settled.notRolledBack,
                    });
                }
                const after = { active: activeEntries().length };
                logger?.info?.(`[Bangju archive] ${direction} ${result.moved.length} bot(s), failed ${result.failed.length}; `
                    + `flush ${timings.flushMs}ms, move ${timings.moveMs}ms${settled ? `, reload ${timings.adoptMs}ms` : ''}; `
                    + `active ${before.active} -> ${after.active}; images ${JSON.stringify(result.assets)}`);
                finish(200, {
                    status: 'done',
                    moved: result.moved, failed: result.failed, assets: result.assets, missing: result.missing,
                    ...(result.foldersRestored ? { foldersRestored: result.foldersRestored } : {}),
                    before, after, timings,
                    // 'pending': 목록 다시 읽기는 조금 뒤(또는 앱이 열릴 때) 한다.
                    settle: settled ? settled.status : (result.moved.length ? 'pending' : 'nothing'),
                    adopted: Boolean(settled?.adopted), etag: settled?.etag ?? null,
                    databaseBytes: databaseBytes(),
                });
            });
        } catch (error) {
            logger?.error?.('[Bangju archive] Move failed', error);
            finish(500, { status: 'failed', code: 'BANGJU_ARCHIVE_FAILED', error: String(error?.message || error) });
        } finally {
            queued -= 1;
            if (mine && running === mine) running = null;
        }
    });

    return archive;
}

module.exports = { registerBangjuArchiveRoutes };
