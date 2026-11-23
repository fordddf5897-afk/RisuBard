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

    // 시험용 화면. 본 화면(SPA)과 따로 열리며, 본 화면이 안 열려도 쓸 수 있다.
    const testPagePath = path.join(__dirname, 'archive-test-page.html');
    app.get('/bangju/archive', (req, res) => {
        res.set('Cache-Control', 'no-store').type('html').send(fs.readFileSync(testPagePath));
    });

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
        try {
            await queue(async () => {
                const timings = {};
                if (isBlocked()) {
                    return res.status(409).json({ code: 'BANGJU_ARCHIVE_BUSY', error: 'Storage is busy; try again shortly' });
                }
                let startedAt = performance.now();
                // Edits the browser already sent must reach the bot folders before they move.
                await flush();
                timings.flushMs = elapsed(startedAt);
                if (isBlocked() || hasExternalChanges()) {
                    return res.status(409).json({ code: 'BANGJU_ARCHIVE_BUSY', error: 'Files changed outside the app; review them first' });
                }
                startedAt = performance.now();
                const listed = repository.loadSidebarIndex().characters || [];
                const result = archive.move({
                    ids, direction,
                    sidebarOf: id => {
                        const position = listed.findIndex(character => character.id === id);
                        return position < 0 ? null : { position, entry: listed[position] };
                    },
                });
                if (direction === 'restore' && result.restoredSidebar.length) restoreListOrder(result.restoredSidebar);
                timings.moveMs = elapsed(startedAt);
                let adopted = null;
                if (result.moved.length) {
                    startedAt = performance.now();
                    adopted = await adopt();
                    timings.adoptMs = elapsed(startedAt);
                    // Every open tab still holds the old list.
                    revokeSessions();
                    logger?.info?.(`[Bangju archive] ${direction} ${result.moved.length} bot(s)`);
                }
                res.json({
                    direction, moved: result.moved, failed: result.failed, assets: result.assets,
                    adopted: Boolean(adopted), etag: adopted?.etag ?? null,
                    databaseBytes: databaseBytes(), timings,
                });
            });
        } catch (error) {
            logger?.error?.('[Bangju archive] Move failed', error);
            if (!res.headersSent) {
                res.status(500).json({ code: 'BANGJU_ARCHIVE_FAILED', error: String(error?.message || error) });
            }
        }
    });

    return archive;
}

module.exports = { registerBangjuArchiveRoutes };
