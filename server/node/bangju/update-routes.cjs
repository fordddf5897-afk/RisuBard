'use strict';

// 방주 업데이트 확인(U2, 안 A). 이 서버는 스스로 업데이트하지 않는다. 화면이 보여 줄 것만 알려 준다:
// 지금 돌고 있는 설치본이 무엇인지, 그리고 이 NAS에서 돌았던 이전 설치본들.
// 새 버전이 있는지와 위험도, 본 코드의 가장 새 설치본은 화면이 GitHub에서 직접 읽는다
// (공개 저장소의 bangju-status 가지에 작업들이 적어 둔 파일. 비밀 값이 필요 없다).
//
//   GET /bangju/update            화면
//   GET /api/bangju/update/info   지금 설치본과 이전 설치본 기록 (로그인 필요)

const fs = require('node:fs');
const path = require('node:path');

const HISTORY_FILE = 'bangju/update/history.json';
const HISTORY_LIMIT = 20;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;

// build-info.json is written by the image workflows; a build without it predates this screen.
function readBuildInfo(file) {
    try {
        const info = JSON.parse(fs.readFileSync(file, 'utf8'));
        const text = value => (typeof value === 'string' ? value : '');
        return {
            commit: text(info.commit),
            builtAt: text(info.builtAt),
            repository: REPOSITORY.test(text(info.repository)) ? info.repository : '',
            tag: text(info.tag),
            kind: ['main', 'test', 'trial'].includes(info.kind) ? info.kind : (info.commit ? 'test' : ''),
        };
    } catch { return null; }
}

function readAppVersion() {
    try { return String(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version || ''); } catch { return ''; }
}

// Every image that ran on this data folder, newest last, so a rollback can name the image it goes back to.
function recordInstall(dataRoot, build, appVersion, now = new Date()) {
    const file = path.join(dataRoot, HISTORY_FILE);
    let history = [];
    try {
        const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(stored?.installs)) history = stored.installs.filter(item => item && typeof item.tag === 'string');
    } catch { /* first run with this feature */ }
    if (!build?.tag || history.at(-1)?.tag === build.tag) return history;
    history.push({ tag: build.tag, commit: build.commit, kind: build.kind, appVersion, builtAt: build.builtAt, firstRunAt: now.toISOString() });
    history = history.slice(-HISTORY_LIMIT);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, installs: history }, null, 2)}\n`);
    fs.renameSync(temporary, file);
    return history;
}

function registerBangjuUpdateRoutes(app, { auth, dataRoot, logger }) {
    // 검증 스크립트용: 다른 지은 정보 파일을 읽게 한다.
    const buildInfoPath = process.env.BANGJU_BUILD_INFO || path.join(__dirname, 'build-info.json');
    const build = readBuildInfo(buildInfoPath);
    const appVersion = readAppVersion();
    let history = [];
    try { history = recordInstall(dataRoot, build, appVersion); }
    catch (error) { logger?.warn?.('[Bangju update] Could not record this install', error); }

    const pagePath = path.join(__dirname, 'update-page.html');
    app.get('/bangju/update', (req, res) => {
        res.set('Cache-Control', 'no-store').type('html').send(fs.readFileSync(pagePath));
    });

    app.get('/api/bangju/update/info', async (req, res) => {
        if (!await auth(req, res)) return;
        res.set('Cache-Control', 'no-store').json({
            appVersion,
            build,
            // Where the screen looks: the fork this image was built from, and the files the workflows leave there.
            repository: build?.repository || '',
            statusBranch: 'bangju-status',
            statusFile: 'update-check.json',
            imageFile: 'main-image.json',
            checkWorkflow: 'bangju-update-check.yml',
            mergeWorkflow: 'easy-mode-sync.yml',
            history,
        });
    });
}

module.exports = { registerBangjuUpdateRoutes, readBuildInfo, recordInstall };
