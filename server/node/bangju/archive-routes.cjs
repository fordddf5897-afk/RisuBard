'use strict';
// 방주 보관함 (B1 검증용 시험판): 서버 주소.
//
// 브라우저의 저장 경로(/api/patch, /api/write)를 타지 않는다. 폴더를 옮긴 뒤
// 서버가 파일에서 목록을 다시 읽고(adopt), 열려 있던 탭은 전부 낡은 것으로
// 만들어(revokeSessions) 옛 목록을 다시 올리지 못하게 한다.

const fs = require('node:fs');
const path = require('node:path');
const { createBangjuArchive } = require('./archive.cjs');
const { stableId } = require('../user-data-repository.cjs');
const { collectDatabaseAssetReferences, collectNestedAssetReferences } = require('../orphan-cleanup.cjs');
const { atomicWriteJson } = require('../file-store.cjs');

// The asset file names one bot's metadata refers to, found the way the app's
// own image cleanup finds them.
function botAssetReferences(metadata) {
    const references = collectDatabaseAssetReferences({ characters: [metadata] });
    collectNestedAssetReferences(metadata, references);
    return references;
}

function registerBangjuArchiveRoutes(app, {
    auth, queue, repository, dataRoot, isBlocked, flush, hasExternalChanges, adopt,
    revokeSessions, databaseBytes, kv, logger,
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
        if (recovered.interrupted) logger?.warn?.('[Bangju archive] A move was interrupted; the index was rebuilt from the folders');
    } catch (error) {
        logger?.error?.('[Bangju archive] Recovery failed', error);
    }

    const elapsed = startedAt => Math.round(performance.now() - startedAt);

    function listActive() {
        const sidebar = repository.loadSidebarIndex();
        return (sidebar.characters || []).map(character => {
            let cardBytes = 0;
            try {
                cardBytes = fs.statSync(path.join(dataRoot, repository.characterDirectoryPath(character.id), 'metadata.json')).size;
            } catch { /* Listed but unreadable: shown with size 0. */ }
            return { id: character.id, name: character.name || '', cardBytes, chats: (character.chats || []).length, updatedAt: character.updatedAt || 0 };
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

    // 어느 시험판이 돌고 있는지 알려 준다(로그인 불필요). build-info.json은 시험용
    // 설치본을 만들 때 워크플로가 넣는다.
    app.get('/api/bangju/version', (req, res) => {
        let build = { commit: 'dev', builtAt: null };
        try { build = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8')); } catch { /* local run */ }
        res.set('Cache-Control', 'no-store').json({ prototype: 'bangju-archive', ...build });
    });

    // 시험용 화면. 본 화면(SPA)과 따로 열리며, 본 화면이 안 열려도 쓸 수 있다.
    const testPagePath = path.join(__dirname, 'archive-test-page.html');
    app.get('/bangju/archive', (req, res) => {
        res.set('Cache-Control', 'no-store').type('html').send(fs.readFileSync(testPagePath));
    });

    // 마지막으로 옮긴 결과를 남겨 둔다. 오래 걸려서 화면과의 연결이 끊기거나 창을
    // 닫아도, 다시 열면 결과(걸린 시간 등)를 볼 수 있다.
    const lastRunPath = path.join(archive.archiveRoot, 'last-run.json');
    let running = null;
    let queued = 0;
    function rememberRun(run) {
        try {
            fs.mkdirSync(archive.archiveRoot, { recursive: true });
            fs.writeFileSync(lastRunPath, JSON.stringify(run));
        } catch (error) {
            logger?.warn?.('[Bangju archive] Could not record the last run', error);
        }
    }
    function readLastRun() {
        try { return JSON.parse(fs.readFileSync(lastRunPath, 'utf8')); } catch { return null; }
    }
    const activeCount = () => (repository.loadSidebarIndex().characters || []).length;

    // Not queued on purpose: it must answer while a move is waiting in the queue.
    app.get('/api/bangju/archive/status', async (req, res) => {
        if (!await auth(req, res)) return;
        res.set('Cache-Control', 'no-store').json({ running, queued, last: readLastRun() });
    });

    // Moves folders one way and keeps the list order information in step.
    function moveFolders(ids, direction) {
        const listed = repository.loadSidebarIndex().characters || [];
        const result = archive.move({
            ids, direction,
            sidebarOf: id => {
                const position = listed.findIndex(character => character.id === id);
                return position < 0 ? null : { position, entry: listed[position] };
            },
        });
        if (direction === 'restore' && result.restoredSidebar.length) restoreListOrder(result.restoredSidebar);
        return result;
    }

    app.get('/api/bangju/archive', async (req, res, next) => {
        if (!await auth(req, res)) return;
        try {
            await queue(async () => {
                const startedAt = performance.now();
                const active = listActive();
                // The stored entries also carry what a restore needs; the list shows the basics.
                const archived = archive.listArchived().map(entry => ({
                    id: entry.id, name: entry.name, cardBytes: entry.cardBytes, chats: entry.chats,
                    assetCount: entry.assetCount, archivedAt: entry.archivedAt,
                }));
                const sum = list => list.reduce((total, item) => total + (item.cardBytes || 0), 0);
                res.json({
                    active, archived,
                    totals: {
                        active: active.length, activeCardBytes: sum(active),
                        archived: archived.length, archivedCardBytes: sum(archived),
                        databaseBytes: databaseBytes(),
                    },
                    listMs: elapsed(startedAt),
                });
            });
        } catch (error) { next(error); }
    });

    app.post('/api/bangju/archive/move', async (req, res) => {
        if (!await auth(req, res)) return;
        const { ids, direction } = req.body || {};
        if (!Array.isArray(ids) || !ids.length || ids.length > 5000 || (direction !== 'archive' && direction !== 'restore')) {
            return res.status(400).json({ error: 'ids and direction (archive or restore) are required' });
        }
        // The page names each request, so it can find this run's result again after a lost connection.
        const runId = typeof req.body.runId === 'string' && req.body.runId.length <= 80 ? req.body.runId : null;
        const receivedAt = performance.now();
        let mine = null;
        queued += 1;
        // Answers the browser and records the same thing as the last run.
        const finish = (status, body) => {
            const run = { runId, direction, requested: ids.length, ...body, totalMs: elapsed(receivedAt), finishedAt: new Date().toISOString() };
            rememberRun(run);
            if (!res.headersSent) res.status(status).json(run);
        };
        try {
            await queue(async () => {
                const timings = {};
                if (isBlocked()) {
                    return res.status(409).json({ code: 'BANGJU_ARCHIVE_BUSY', error: 'Storage is busy; try again shortly' });
                }
                mine = { runId, direction, requested: ids.length, startedAt: new Date().toISOString() };
                running = mine;
                let startedAt = performance.now();
                // Edits the browser already sent must reach the bot folders before they move.
                await flush();
                timings.flushMs = elapsed(startedAt);
                if (isBlocked() || hasExternalChanges()) {
                    return res.status(409).json({ code: 'BANGJU_ARCHIVE_BUSY', error: 'Files changed outside the app; review them first' });
                }
                const before = { databaseBytes: databaseBytes(), active: activeCount() };
                startedAt = performance.now();
                const result = moveFolders(ids, direction);
                timings.moveMs = elapsed(startedAt);
                let adopted = null;
                if (result.moved.length) {
                    startedAt = performance.now();
                    try {
                        // 검증 스크립트가 되돌리기 경로를 시험할 때만 쓰는 스위치.
                        if (process.env.BANGJU_ARCHIVE_TEST_FAIL_RELOAD === '1') throw new Error('injected reload failure (test)');
                        adopted = await adopt();
                    } catch (error) {
                        // The server could not reload its list: put every folder back where it was.
                        const back = moveFolders(result.moved, direction === 'archive' ? 'restore' : 'archive');
                        try { await adopt(); } catch { /* the next page load reloads the list again */ }
                        logger?.error?.('[Bangju archive] Reload failed; folders were moved back', error);
                        return finish(500, {
                            status: 'rolled-back',
                            code: 'BANGJU_ARCHIVE_ROLLED_BACK',
                            error: `목록을 다시 읽지 못해 원래대로 되돌렸습니다: ${String(error?.message || error)}`,
                            rolledBack: back.moved.length, notRolledBack: back.failed,
                        });
                    }
                    timings.adoptMs = elapsed(startedAt);
                    // Every open tab still holds the old list.
                    revokeSessions();
                }
                const after = { databaseBytes: databaseBytes(), active: activeCount() };
                logger?.info?.(`[Bangju archive] ${direction} ${result.moved.length} bot(s), failed ${result.failed.length}; `
                    + `flush ${timings.flushMs}ms, move ${timings.moveMs}ms, reload ${timings.adoptMs || 0}ms; `
                    + `opened file ${before.databaseBytes} -> ${after.databaseBytes} bytes; active ${before.active} -> ${after.active}`);
                finish(200, {
                    status: 'done',
                    moved: result.moved, failed: result.failed, assets: result.assets,
                    adopted: Boolean(adopted), etag: adopted?.etag ?? null,
                    databaseBytes: after.databaseBytes, before, after, timings,
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
