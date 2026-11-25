'use strict';
// 방주: 내용이 똑같은 봇 찾기.
// 쓰는 봇과 보관된 봇의 카드 내용(metadata.json)으로 지문을 만들어, 양쪽에 같은 지문이 있으면 알려 준다.
// 읽기만 한다. 적는 것은 자기 계산 결과 파일(content-prints.json) 하나뿐이고, 지워도 다시 만들어진다.
//
// "똑같다"의 뜻: 카드에 적힌 내용이 전부 같다(이름, 설명, 첫 메시지, 로어북, 정규식, 트리거, 그림 목록 등).
// 쓰다 보면 바뀌는 값과 가져올 때마다 새로 붙는 번호는 내용으로 치지 않는다. 채팅도 견주지 않는다.
// 한 글자라도 다르면 같다고 하지 않는다(놓치는 쪽으로 틀리지, 다른 봇을 같다고 하지는 않는다).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Not content: state that changes with use, and ids given anew at every import.
const NOT_CONTENT = new Set([
    'chaId', 'chats', 'chatPage', 'chatFolders', 'lastInteraction', 'reloadKeys', 'firstMsgIndex',
    'trashTime', 'scriptstate', 'coldstorage', 'coldStoragedChats', 'modules',
]);

// An absent field and an empty one are the same content (newer app versions add empty defaults).
const isEmpty = value => value === null || value === undefined || value === '' || value === false
    || (Array.isArray(value) && value.length === 0)
    || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        const sorted = {};
        for (const key of Object.keys(value).sort()) {
            const inner = canonical(value[key]);
            if (!isEmpty(inner)) sorted[key] = inner;
        }
        return sorted;
    }
    return value;
}

// '' when the card says too little to compare (two blank new bots are not "the same bot").
function contentPrint(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '';
    const text = value => (typeof value === 'string' ? value.trim() : '');
    if (!text(metadata.name) || (!text(metadata.desc) && !text(metadata.firstMessage))) return '';
    const content = {};
    for (const key of Object.keys(metadata)) if (!NOT_CONTENT.has(key)) content[key] = metadata[key];
    // Imported voice data gets a random id each time.
    if (content.vits && typeof content.vits === 'object' && !Array.isArray(content.vits)) {
        const { id: _id, ...rest } = content.vits;
        content.vits = rest;
    }
    return crypto.createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex').slice(0, 32);
}

// cacheFile: where the prints are kept between restarts.
// Each bot is read once and again only when its file changes (size and time).
function createTwins({ cacheFile, logger = console } = {}) {
    let prints = null;          // key ('a:<id>' in use, 'r:<id>' archived) -> { stamp, print }
    const waiting = [];         // [key, file]
    const waitingKeys = new Set();
    let working = false;
    let dirty = false;
    let lastLook = 0;

    function known() {
        if (!prints) {
            prints = new Map();
            try {
                const stored = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                if (stored?.schemaVersion === 1) for (const [key, value] of Object.entries(stored.prints || {})) prints.set(key, value);
            } catch { /* nothing kept yet */ }
        }
        return prints;
    }
    function keep() {
        if (!dirty) return;
        dirty = false;
        try {
            fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
            const temporary = `${cacheFile}.tmp`;
            fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, prints: Object.fromEntries(known()) }));
            fs.renameSync(temporary, cacheFile);
        } catch (error) { logger.warn?.('[bangju] could not keep the content prints:', error?.message || error); }
    }
    function work() {
        if (working) return;
        working = true;
        (async () => {
            let read = 0;
            while (waiting.length) {
                const [key, file] = waiting.shift();
                waitingKeys.delete(key);
                try {
                    const stat = fs.statSync(file);
                    const print = contentPrint(JSON.parse(fs.readFileSync(file, 'utf8')));
                    known().set(key, { stamp: `${stat.size}:${Math.round(stat.mtimeMs)}`, print });
                } catch {
                    // The bot left or cannot be read: it has no print.
                    known().delete(key);
                }
                dirty = true;
                read += 1;
                // One file at a time, with room for other requests in between.
                await new Promise(resolve => setTimeout(resolve, read % 20 === 0 ? 30 : 0));
            }
            keep();
        })().catch(error => logger.warn?.('[bangju] content prints stopped:', error?.message || error)).finally(() => { working = false; });
    }

    // active: [{ id, file }], archived: [{ id, file }] - the metadata.json of every bot on each side.
    // Looks at the files at most once every few seconds; `force` after bots were moved.
    function look(active, archived, { force = false, now = Date.now() } = {}) {
        if (!force && now - lastLook < 5000) return;
        lastLook = now;
        const map = known();
        const present = new Set();
        for (const [side, list] of [['a', active], ['r', archived]]) {
            for (const { id, file } of list) {
                const key = `${side}:${id}`;
                present.add(key);
                let stamp = '';
                try { const stat = fs.statSync(file); stamp = `${stat.size}:${Math.round(stat.mtimeMs)}`; } catch { /* gone */ }
                if (!stamp) { if (map.delete(key)) dirty = true; continue; }
                if (map.get(key)?.stamp === stamp || waitingKeys.has(key)) continue;
                waitingKeys.add(key);
                waiting.push([key, file]);
            }
        }
        for (const key of [...map.keys()]) if (!present.has(key)) { map.delete(key); dirty = true; }
        if (waiting.length) work(); else keep();
    }

    const pending = () => waiting.length + (working ? 1 : 0);

    // { active: { <id in use>: [archived ids with the same content] }, archived: { <archived id>: [ids in use] } }
    function twins() {
        const sides = new Map();   // print -> { a: [ids], r: [ids] }
        for (const [key, value] of known()) {
            if (!value?.print) continue;
            const group = sides.get(value.print) || { a: [], r: [] };
            group[key[0]].push(key.slice(2));
            sides.set(value.print, group);
        }
        const active = {};
        const archived = {};
        for (const group of sides.values()) {
            if (!group.a.length || !group.r.length) continue;
            for (const id of group.a) active[id] = group.r;
            for (const id of group.r) archived[id] = group.a;
        }
        return { active, archived };
    }

    return { look, pending, twins };
}

module.exports = { contentPrint, createTwins };
