'use strict';
// 업데이트 확인 화면(U2, 안 A)을 실제 브라우저로 본다. GitHub의 답은 가짜로 끼워 넣는다
// (새 버전 있음·중간, 복사본용 설치본 있음, 부딪침·높음, 최신, 기록 없음, 만드는 중, 본 코드가 바뀐 뒤의 낡은 확인,
// 며칠째 멈춘 자동 확인, 만들기 실패, 횟수 초과, 깨진 기록, 시험용 설치본, 지은 정보가 없는 설치본).
// 사용: node page-update.cjs <base> <root> <port> <log>   (서버를 지은 정보 파일과 함께 스스로 다시 켠다)
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { execSync } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const [base, root, port, log] = process.argv.slice(2);
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bangju-update-page-'));
const REPO = 'someone/Some-Fork';
const MAIN = 'bbbbbbb1234567890abcdef1234567890abcdef0';
const INSTALLED = 'aaaaaaa';
function restart(build) {
    const file = path.join(work, 'build-info.json');
    if (build) fs.writeFileSync(file, JSON.stringify(build)); else fs.rmSync(file, { force: true });
    execSync(`${path.join(__dirname, 'srv.sh')} ${port} ${root} ${log}`, { stdio: 'pipe', env: { ...process.env, BANGJU_BUILD_INFO: file } });
}
const build = tag => ({ commit: tag.replace(/^sha-/, ''), builtAt: '2026-11-24T05:00:00Z', repository: REPO, tag, kind: 'main' });
const run = (sha, status = 'completed', conclusion = 'success') => ({ head_branch: 'main', head_sha: sha, status, conclusion, created_at: '2026-11-24T06:00:00Z', updated_at: '2026-11-24T06:12:00Z', html_url: 'https://github.com/' + REPO + '/actions/runs/1' });
const mainImage = sha => ({ schemaVersion: 1, tag: 'sha-' + sha.slice(0, 7), commit: sha, version: '0.9.104', builtAt: '2026-11-24T06:12:00Z', runUrl: '' });
const INSTALLED_SHA = INSTALLED + '0'.repeat(33);
const soon = new Date(Date.now() - 3600 * 1000).toISOString();
const check = extra => ({
    schemaVersion: 1, checkedAt: soon, repository: REPO,
    base: { sha: MAIN, version: '0.9.104' }, upstream: { url: 'https://github.com/rpaddict/RisuBard', branch: 'main', sha: 'c'.repeat(40), version: '0.9.105' },
    status: 'clean', commits: { total: 3, list: [{ sha: 'c1', date: '2026-11-23T10:00:00+09:00', title: 'fix: <b>굵게</b> 보이면 안 되는 제목' }, { sha: 'c2', date: '2026-11-22T10:00:00+09:00', title: 'feat: 둘째' }] },
    files: { total: 12, storage: ['server/node/asset-store.cjs'], dependencies: [], overlap: [] }, conflicts: [],
    checks: { easy: 'passed', bangju: 'passed' }, risk: 'medium', reasons: ['저장에 닿는 코드 1개가 바뀝니다: server/node/asset-store.cjs'], runUrl: 'https://github.com/' + REPO + '/actions/runs/2', ...extra,
});
const found = body => ({ status: 200, body });
const none = { status: 404, body: {} };

(async () => {
    restart(build('sha-' + INSTALLED));
    // the info is only given to someone signed in
    const anonymous = await fetch(`${base}/api/bangju/update/info`);
    ok('the install information needs a sign-in', anonymous.status === 401 || anonymous.status === 400 || anonymous.status === 403, `status ${anonymous.status}`);

    const shots = process.env.SHOTS || '';
    const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    // What "GitHub" answers in each scenario: the recorded newest image, the check result, the run list.
    let answers = { image: none, status: none, runs: found({ workflow_runs: [] }) };
    const asked = [];
    await page.setRequestInterception(true);
    page.on('request', request => {
        const url = request.url();
        const reply = url.startsWith('https://api.github.com/') ? answers.runs
            : url.startsWith('https://raw.githubusercontent.com/') ? (url.endsWith('/main-image.json') ? answers.image : answers.status) : null;
        if (!reply) return request.continue();
        asked.push(url);
        request.respond({ status: reply.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(reply.body) });
    });
    async function open(next) {
        answers = { image: none, status: none, runs: found({ workflow_runs: [] }), ...next };
        asked.length = 0;
        await page.goto(`${base}/bangju/update`, { waitUntil: 'domcontentloaded' });
        await page.type('#password', 'test1234');
        // The server allows ten sign-ins in thirty seconds; this test signs in once per scenario, so it waits when refused.
        for (let attempt = 0; attempt < 12; attempt++) {
            await page.click('#loginButton');
            const signedIn = await page.waitForFunction(() => !document.getElementById('main').classList.contains('hidden'), { timeout: 3000 }).then(() => true, () => false);
            if (signedIn) break;
            await sleep(4000);
        }
        await page.waitForFunction(() => !document.getElementById('main').classList.contains('hidden') && !/읽는 중/.test(document.getElementById('upstream').innerText + document.getElementById('image').innerText), { timeout: 15000 });
        await sleep(100);
    }
    const text = id => page.$eval('#' + id, element => element.innerText.replace(/\s+/g, ' ').trim());
    const has = selector => page.$(selector).then(Boolean);
    const hidden = id => page.$eval('#' + id, element => element.classList.contains('hidden'));

    // 1. a new version (medium), and a newer main image than the installed one
    await open({ image: found(mainImage(MAIN)), status: found(check({})), runs: found({ workflow_runs: [run(MAIN)] }) });
    ok('it reads the fork named in the image, from its public status files and run list', asked.length === 3
        && asked.includes(`https://raw.githubusercontent.com/${REPO}/bangju-status/main-image.json`)
        && asked.includes(`https://raw.githubusercontent.com/${REPO}/bangju-status/update-check.json`)
        && asked.includes(`https://api.github.com/repos/${REPO}/actions/workflows/easy-mode-sync.yml/runs?branch=main&per_page=5`), asked.join(' '));
    const current = await text('current');
    ok('it shows the installed version and image', current.includes('v0.9.104') && await text('currentTag') === 'sha-aaaaaaa' && !current.includes('시험용'), current);
    const image = await text('image');
    ok('a newer main image is offered with the NAS steps and the exact image line', await text('latestTag') === 'sha-bbbbbbb' && image.includes('갱신할 것 있음') && image.includes('묻는 창에서 "빌드하고 시작"이 아니라 변경 사항만 저장') && image.includes('정리')
        && image.includes('스냅샷을 찍어 두세요') && await page.$eval('#image pre.copy', element => element.textContent) === 'image: ghcr.io/someone/some-fork:sha-bbbbbbb', image.slice(0, 120));
    const upstream = await text('upstream');
    // the list of changes is folded away until asked for, so it is read from the page's text content
    const changes = await page.$eval('#upstream details', element => element.textContent.replace(/\s+/g, ' '));
    ok('the new version is shown with its risk, reasons and changes', upstream.includes('RisuBard 0.9.105 버전이 나와 있습니다') && upstream.includes('변경 3개') && await text('risk') === '중간'
        && (await text('reasons')).includes('저장에 닿는 코드 1개') && changes.includes('바뀐 내용 3개 보기') && changes.includes('feat: 둘째') && changes.includes('그 밖에 1개'), upstream.slice(0, 160));
    ok('a commit title is shown as text, not as markup', await page.$eval('#upstream .changes', list => list.querySelector('b') === null && list.textContent.includes('<b>굵게</b>')));
    ok('a fresh check against the current main code carries no warning', !(await has('#stale')) && !(await has('#old')));
    ok('the merge and NAS steps stay hidden until the snapshot is ticked', await hidden('mergeStep') && await hidden('nasStep') && !(await hidden('snapshotNote')));
    await page.click('#snapshotDone');
    const merge = await text('mergeStep');
    ok('ticking it shows them, with the link to the merge workflow and the box to tick there', !(await hidden('mergeStep')) && !(await hidden('nasStep')) && await hidden('snapshotNote')
        && merge.includes('RisuBard 새 버전 합치기') && merge.includes('Sync fork') && await page.$eval('#mergeStep a', link => link.href) === `https://github.com/${REPO}/actions/workflows/easy-mode-sync.yml`, merge.slice(0, 140));
    ok('without a trial image it says how to get one', upstream.includes('복사본용 설치본이 아직 없습니다') && upstream.includes('복사본에서 먼저 해 볼 설치본도 만들기') && !(await has('#trialTag')));
    const history = await text('history');
    ok('the installed image is in the install history', (await text('installs')).includes('sha-aaaaaaa') && history.includes('설치본 기록') && history.includes('지금') && history.includes('되돌리는 법'), history.slice(0, 120));

    // 2. a trial image exists
    await open({ image: found(mainImage(MAIN)), status: found(check({ trialImage: { tag: 'bangju-test-up-ccccccc-bbbbbbb', builtAt: '2026-11-24T06:40:00Z' } })) });
    if (shots) { await page.click('#snapshotDone'); await page.screenshot({ path: path.join(shots, 'update-page.png'), fullPage: true }); }
    ok('a trial image is shown with the steps for the copy', await text('trialTag') === 'bangju-test-up-ccccccc-bbbbbbb'
        && await page.$eval('#upstream pre.copy', element => element.textContent) === 'image: ghcr.io/someone/some-fork:bangju-test-up-ccccccc-bbbbbbb' && (await text('upstream')).includes('복사본 프로젝트'));
    ok('the run list is only a hint: without it the newest image is still known', await text('latestTag') === 'sha-bbbbbbb' && !(await has('#building')) && !(await has('#buildFailed')));

    // 2b. the merge button cannot publish this version (it changes workflow files)
    await open({ image: found(mainImage(MAIN)), status: found(check({ mergeByButton: false, files: { total: 12, storage: [], dependencies: [], overlap: [], workflows: ['.github/workflows/build.yml'] },
        reasons: ["GitHub 작업 파일 1개가 바뀌어, GitHub가 '합치기' 버튼으로 올리는 것을 막습니다. 합치는 일은 Claude에게 맡기면 됩니다: .github/workflows/build.yml"] })) });
    await page.click('#snapshotDone');
    const byClaude = await text('mergeStep');
    ok('when the button cannot publish the merge, the step says to ask Claude and offers no workflow link', byClaude.includes('Claude에게 맡깁니다') && byClaude.includes('RisuBard 0.9.105 합쳐 줘') && byClaude.includes('Sync fork')
        && !(await has('#mergeStep a')) && (await text('nasStep')).includes('합친 뒤'), byClaude.slice(0, 160));

    // 2c. changes arrived without a new version number: it must not say that "0.9.104 is out" to someone on 0.9.104
    await open({ image: found(mainImage(MAIN)), status: found(check({ upstream: { url: '', branch: 'main', sha: 'c'.repeat(40), version: '0.9.104' }, commits: { total: 5, list: [] } })) });
    const sameNumber = await text('upstreamState');
    ok('changes without a new version number are described as changes, not as a version', sameNumber.includes('새 변경 5개가 올라와 있습니다') && sameNumber.includes('버전 번호는 그대로 0.9.104입니다') && !sameNumber.includes('버전이 나와 있습니다'), sameNumber);

    // 3. it does not merge
    await open({ image: found(mainImage(MAIN)), status: found(check({ status: 'conflict', risk: 'high', conflicts: ['server/node/server.cjs', 'src/App.svelte'], reasons: ['합칠 때 파일 2개가 부딪칩니다: server/node/server.cjs, src/App.svelte'], checks: { easy: 'skipped', bangju: 'skipped' } })) });
    const high = await text('upstream');
    ok('a collision is shown as high: do not update, the files, and no merge step', await text('risk') === '높음' && high.includes('지금은 받지 마세요') && (await text('conflicts')).includes('src/App.svelte')
        && !(await has('#mergeStep')) && !(await has('#snapshotDone')) && high.includes('Claude'), high.slice(0, 160));

    // 4. nothing new, and the installed image is the newest
    await open({ image: found(mainImage(INSTALLED_SHA)), status: found(check({ base: { sha: INSTALLED_SHA, version: '0.9.104' }, upstream: { url: '', branch: 'main', sha: 'd'.repeat(40), version: '0.9.104' }, status: 'up-to-date', risk: 'none', reasons: [], commits: { total: 0, list: [] } })) });
    ok('when everything is current it says so twice and offers no steps', (await text('imageState')).includes('지금 설치본이 가장 새 것') && (await text('upstreamState')).includes('새 버전이 없습니다')
        && !(await has('#image ol')) && !(await has('#upstream ol')) && !(await has('#stale')));

    // 5. never checked, nothing recorded yet, and an image is being built
    await open({ runs: found({ workflow_runs: [run(MAIN, 'in_progress', null), run(INSTALLED_SHA)] }) });
    ok('a build in progress is announced, and a missing record is said plainly', (await text('building')).includes('만드는 중') && (await text('imageState')).includes('아직 적혀 있지 않습니다') && !(await has('#latestTag')));
    ok('without a check result it explains how to run the check', (await text('upstream')).includes('아직 확인한 기록이 없습니다') && await page.$eval('#upstream a', link => link.href) === `https://github.com/${REPO}/actions/workflows/bangju-update-check.yml`);

    // 6. the main code moved after the check (a merge made by the workflow shows only in the recorded image, not in the run list)
    await open({ image: found(mainImage('e'.repeat(40))), status: found(check({})), runs: found({ workflow_runs: [run(MAIN)] }) });
    ok('a check made before the main code changed is marked as outdated', (await text('stale')).includes('확인한 뒤에 본 코드가 바뀌었습니다') && await text('latestTag') === 'sha-eeeeeee');

    // 7. the daily check stopped
    await open({ image: found(mainImage(MAIN)), status: found(check({ checkedAt: new Date(Date.now() - 5 * 86400000).toISOString() })) });
    ok('a check that is days old says the daily check seems to have stopped', (await text('old')).includes('5일 전') && (await text('old')).includes('멈춘 것 같습니다') && (await text('old')).includes('Enable workflow'));

    // 8. a failed build, GitHub refusing for a while, and a record that is not what it should be
    await open({ image: found(mainImage(INSTALLED_SHA)), status: { status: 403, body: {} }, runs: found({ workflow_runs: [run(MAIN, 'completed', 'failure'), run(INSTALLED_SHA)] }) });
    ok('a failed image build and a refused request are both said plainly', (await text('buildFailed')).includes('끝까지 가지 못했습니다') && (await text('imageState')).includes('가장 새 것') && (await text('upstream')).includes('GitHub가 잠시 답하지 않습니다'));
    await open({ image: found({ schemaVersion: 1, tag: 'sha-x"><img src=x onerror=alert(1)>', commit: 'x' }), status: found({ schemaVersion: 7 }), runs: { status: 403, body: {} } });
    ok('a malformed record is not shown as an image name', !(await has('#latestTag')) && !(await has('#image img')) && (await text('image')).includes('읽지 못했습니다') && (await text('upstream')).includes('확인 결과를 읽지 못했습니다'));

    // a second image on the same data: the history keeps both, newest first; a test image is marked and not told to update
    restart({ commit: 'fffffff', builtAt: '2026-11-25T05:00:00Z', repository: REPO, tag: 'bangju-test-fffffff', kind: 'test' });
    await open({ image: found(mainImage(MAIN)), runs: found({ workflow_runs: [run(MAIN)] }) });
    const installs = await page.$$eval('#installs li', list => list.map(item => item.innerText.replace(/\s+/g, ' ').trim()));
    ok('the install history keeps earlier images, newest first, and marks a test image', installs.length === 2 && installs[0].startsWith('bangju-test-fffffff') && installs[0].includes('지금') && installs[0].includes('시험용')
        && installs[1].startsWith('sha-aaaaaaa') && (await text('current')).includes('시험용 설치본'), installs.join(' / '));
    ok('a test install is not told to update: the steps are folded away', (await text('imageState')).includes('견주지 않음') && await text('latestTag') === 'sha-bbbbbbb'
        && await page.$eval('#image details', element => !element.open && element.textContent.includes('image: ghcr.io/someone/some-fork:sha-bbbbbbb')) && !(await text('image')).includes('갱신할 것 있음'));
    const stored = JSON.parse(fs.readFileSync(path.join(root, 'bangju/update/history.json'), 'utf8'));
    ok('restarting the same image does not add a line', (restart({ commit: 'fffffff', builtAt: '2026-11-25T05:00:00Z', repository: REPO, tag: 'bangju-test-fffffff', kind: 'test' }),
        JSON.parse(fs.readFileSync(path.join(root, 'bangju/update/history.json'), 'utf8')).installs.length === stored.installs.length && stored.installs.length === 2));

    // an image built before this screen existed
    restart(null);
    await open({});
    ok('an image without build information says so and asks GitHub nothing', (await text('current')).includes('지은 정보가 없습니다') && (await text('image')).includes('적혀 있지 않아') && asked.length === 0);

    ok('the page ran without script errors', errors.length === 0, errors.slice(0, 3).join(' ; '));
    await browser.close();
    fs.rmSync(work, { recursive: true, force: true });
})().catch(e => { console.error('PAGE TEST FAILED', e); process.exit(1); });
