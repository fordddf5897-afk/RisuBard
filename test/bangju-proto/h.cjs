'use strict';
// Test helpers for the archive prototype. Talks to a locally running server over HTTP
// the way the browser does (login, session, database read/write, patch).
const path = require('node:path');
const crypto = require('node:crypto');
const REPO = process.env.REPO || path.resolve(__dirname, '../..');
const { decodeRisuSave, encodeRisuSaveLegacyBuffer, createCachedHash, normalizeJSON } = require(path.join(REPO, 'server/node/utils.cjs'));

const hex = s => Buffer.from(s, 'utf-8').toString('hex');
// The server closes idle keep-alive sockets; a request written to one fails before it is processed.
async function rfetch(url, init) {
    for (let attempt = 0; ; attempt++) {
        try { return await fetch(url, init); }
        catch (error) {
            if (attempt >= 3 || !(error instanceof TypeError)) throw error;
            await new Promise(r => setTimeout(r, 200));
        }
    }
}
const DB_KEY = 'database/database.bin';

function client(base, password = 'test1234') {
    let token = null;
    let cookie = '';
    const sessionId = crypto.randomUUID();
    const headers = (extra = {}) => ({ 'risu-auth': token, 'x-session-id': sessionId, 'x-user-active': '1', ...extra });
    const api = {
        sessionId,
        async login() {
            // A server restart leaves dead pooled connections behind; the first call may hit one.
            for (let attempt = 0; attempt < 5; attempt++) {
                try { await rfetch(`${base}/api/test_auth`); break; } catch { await new Promise(r => setTimeout(r, 300)); }
            }
            // Like the app: the password is sent as the digest the server computes for it.
            const digest = await (await rfetch(`${base}/api/crypto`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: password }) })).text();
            await rfetch(`${base}/api/set_password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: digest }) });
            const r = await rfetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: digest }) });
            token = (await r.json()).token;
            if (!token) throw new Error('login failed');
            const session = await rfetch(`${base}/api/session`, { method: 'POST', headers: headers() });
            cookie = (session.headers.get('set-cookie') || '').split(';')[0];
            return api;
        },
        async readDb() {
            const r = await rfetch(`${base}/api/read`, { headers: headers({ 'file-path': hex(DB_KEY) }) });
            const etag = r.headers.get('x-db-etag');
            const buf = Buffer.from(await r.arrayBuffer());
            if (r.status !== 200) return { status: r.status, body: buf.toString('utf-8').slice(0, 300) };
            if (buf.length === 0) return { status: r.status, etag, db: null, bytes: 0 };
            return { status: r.status, etag, db: await decodeRisuSave(buf), bytes: buf.length };
        },
        async writeDb(db, etag) {
            const body = encodeRisuSaveLegacyBuffer(db);
            const r = await rfetch(`${base}/api/write`, {
                method: 'POST',
                headers: headers({ 'file-path': hex(DB_KEY), 'content-type': 'application/octet-stream', ...(etag ? { 'x-if-match': etag } : {}) }),
                body,
            });
            const text = await r.text();
            let json = null; try { json = JSON.parse(text); } catch {}
            return { status: r.status, json, text: text.slice(0, 300), bytes: body.length };
        },
        async writeKey(key, buffer) {
            const r = await rfetch(`${base}/api/write`, {
                method: 'POST',
                headers: headers({ 'file-path': hex(key), 'content-type': 'application/octet-stream' }),
                body: buffer,
            });
            return r.status;
        },
        async patchDb(patch, expectedHash) {
            const r = await rfetch(`${base}/api/patch`, {
                method: 'POST',
                headers: headers({ 'file-path': hex(DB_KEY), 'content-type': 'application/json' }),
                body: JSON.stringify({ patch, expectedHash }),
            });
            const text = await r.text();
            let json = null; try { json = JSON.parse(text); } catch {}
            return { status: r.status, json, text: text.slice(0, 300) };
        },
        // Images are fetched the way an <img> tag does: with the session cookie.
        async asset(key) {
            const r = await rfetch(`${base}/api/asset/${hex(key)}`, { headers: { cookie } });
            const buf = Buffer.from(await r.arrayBuffer());
            return { status: r.status, bytes: buf.length, tail: buf.subarray(-8).toString('utf8') };
        },
        async get(url) {
            const r = await rfetch(`${base}${url}`, { headers: headers() });
            const text = await r.text();
            let json = null; try { json = JSON.parse(text); } catch {}
            return { status: r.status, json, text: text.slice(0, 500) };
        },
        async post(url, body) {
            const r = await rfetch(`${base}${url}`, { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(body ?? {}) });
            const text = await r.text();
            let json = null; try { json = JSON.parse(text); } catch {}
            return { status: r.status, json, text: text.slice(0, 800) };
        },
    };
    return api;
}

// Deterministic filler text of roughly `bytes` bytes.
function filler(seed, bytes) {
    const words = ['숲', '바다', '달빛', '검', '마법', '도시', '기억', '약속', '비밀', '여행', 'alpha', 'beta', 'gamma'];
    let out = '';
    let i = seed;
    while (out.length < bytes) { out += words[i % words.length] + ' '; i = (i * 7 + 3) % 9973; }
    return out;
}

function fakeCharacter(index, { cardBytes = 20000, chats = 2, messages = 6, assetName = null } = {}) {
    const chaId = crypto.createHash('sha1').update(`char-${index}`).digest('hex').slice(0, 8)
        + '-' + crypto.createHash('sha1').update(`c2-${index}`).digest('hex').slice(0, 4)
        + '-4' + crypto.createHash('sha1').update(`c3-${index}`).digest('hex').slice(0, 3)
        + '-a' + crypto.createHash('sha1').update(`c4-${index}`).digest('hex').slice(0, 3)
        + '-' + crypto.createHash('sha1').update(`c5-${index}`).digest('hex').slice(0, 12);
    const character = {
        type: 'character',
        chaId,
        name: `Bot ${String(index).padStart(4, '0')}`,
        desc: filler(index, cardBytes),
        firstMessage: `안녕, 나는 봇 ${index}야.`,
        notes: '',
        chatPage: 0,
        image: assetName ? `assets/${assetName}` : '',
        emotionImages: [],
        additionalAssets: assetName ? [['extra', `assets/extra-${assetName}`, 'png']] : [],
        globalLore: [{ key: 'k', comment: 'lore', content: `봇 ${index}의 로어`, mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false }],
        customscript: [],
        triggerscript: [],
        chats: Array.from({ length: chats }, (_, c) => ({
            name: `Chat ${c + 1}`,
            note: '',
            localLore: [],
            message: Array.from({ length: messages }, (_, m) => ({
                role: m % 2 === 0 ? 'user' : 'char',
                data: `봇 ${index} 채팅 ${c + 1} 메시지 ${m + 1}: ${filler(index + c + m, 200)}`,
                time: 1700000000000 + index * 1000 + c * 100 + m,
            })),
        })),
    };
    return character;
}

function fakeDb(count, options = {}) {
    return {
        formatversion: 5,
        characters: Array.from({ length: count }, (_, i) => fakeCharacter(i + 1, typeof options.per === 'function' ? options.per(i + 1) : options)),
        modules: [],
        botPresets: [],
        personas: [{ name: 'User', icon: '', personaPrompt: '', id: 'persona-1' }],
        loreBook: [],
        characterOrder: [],
        username: 'User',
        plugins: [],
        pluginCustomStorage: {},
    };
}

const serverHash = db => createCachedHash()(normalizeJSON(db)).toString(16);

module.exports = { client, fakeDb, fakeCharacter, filler, hex, DB_KEY, serverHash, decodeRisuSave, encodeRisuSaveLegacyBuffer, normalizeJSON };
