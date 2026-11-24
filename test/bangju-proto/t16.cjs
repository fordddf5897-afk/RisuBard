'use strict';
// 업데이트 미리 합쳐 보기(U2): 새 버전이 있는지, 합쳐지는지, 위험도를 어떻게 매기는지.
// 임시 저장소 두 개(원본 역할, 우리 역할)로 실제 git을 돌려 본다. 서버는 필요 없다.
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { assessRisk } = require('../../deploy/bangju/update-risk.cjs');
const { inspect, abortMerge, reusePrevious } = require('../../deploy/bangju/update-check.cjs');
const SCRIPT = path.join(__dirname, '../../deploy/bangju/update-check.cjs');
const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`); if (!pass) process.exitCode = 1; };

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bangju-update-'));
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (repo, file, text) => { const target = path.join(repo, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
const commit = (repo, message, files) => { for (const [file, text] of Object.entries(files)) write(repo, file, text); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', message); };
const tree = repo => git(repo, 'status', '--porcelain') + '|' + git(repo, 'rev-parse', 'HEAD') + '|' + String(fs.existsSync(path.join(repo, '.git/MERGE_HEAD')));

const upstream = path.join(work, 'upstream');
const ours = path.join(work, 'ours');
fs.mkdirSync(upstream);
git(upstream, 'init', '-q', '-b', 'main');
commit(upstream, 'release: 1.0.0', {
    'package.json': '{ "name": "app", "version": "1.0.0" }\n',
    'src/lib/Screen.svelte': 'line one\nline two\nline three\n',
    'server/node/server.cjs': 'const a = 1;\n\n\n\n\nconst z = 26;\n',
    'docs/readme.md': 'hello\n',
});
git(work, 'clone', '-q', upstream, ours);
commit(ours, 'our feature', { 'server/node/server.cjs': 'const a = 1;\n\n\n\n\nconst z = 26;\nrequire("./bangju/x.cjs");\n', 'server/node/bangju/x.cjs': '// ours\n' });
const options = { upstreamUrl: upstream, upstreamBranch: 'main' };

// nothing new
const same = inspect(ours, options);
ok('nothing new upstream: reported as up to date, nothing merged', same.status === 'up-to-date' && same.risk === 'none' && same.commits.total === 0 && same.merged === false
    && same.base.version === '1.0.0' && same.upstream.version === '1.0.0', JSON.stringify({ status: same.status, risk: same.risk }));

// a new version that only touches a screen
commit(upstream, 'fix: a screen', { 'src/lib/Screen.svelte': 'line one\nline two changed\nline three\n' });
commit(upstream, 'docs: next version 1.0.1', { 'package.json': '{ "name": "app", "version": "1.0.1" }\n' });
const before = tree(ours);
const screen = inspect(ours, options);
ok('a new version is found with its changes listed, newest first', screen.status === 'clean' && screen.upstream.version === '1.0.1' && screen.commits.total === 2
    && screen.commits.list.map(item => item.title).join('|') === 'docs: next version 1.0.1|fix: a screen' && screen.files.total === 2, JSON.stringify(screen.commits.list.map(item => item.title)));
ok('the trial merge is left uncommitted for the caller, and aborting puts everything back', screen.merged === true && fs.existsSync(path.join(ours, '.git/MERGE_HEAD'))
    && (abortMerge(ours), tree(ours) === before), tree(ours));
ok('checks not run yet: medium, and it says which checks are missing', screen.risk === 'medium' && screen.reasons.length === 1 && screen.reasons[0].includes('아직 돌리지 않은 검사'), screen.reasons.join(' / '));
const passed = assessRisk({ status: 'clean', checks: { easy: 'passed', bangju: 'passed' }, files: ['src/lib/Screen.svelte', 'package.json'], overlap: [] });
ok('with both checks passed and nothing near stored data: low', passed.risk === 'low' && passed.reasons.length === 1, passed.reasons.join(' / '));

// code that touches stored data, and a file we changed too (other lines, so it merges)
commit(upstream, 'feat: storage', { 'server/node/asset-store.cjs': '// store\n', 'server/node/asset-store.test.ts': '// test\n', 'server/node/server.cjs': 'const a = 2;\n\n\n\n\nconst z = 26;\n', 'pnpm-lock.yaml': 'lock\n' });
const storage = inspect(ours, options);
abortMerge(ours);
ok('storage code and dependencies are picked out; test files are not counted', storage.status === 'clean' && storage.files.storage.join() === 'server/node/asset-store.cjs,server/node/server.cjs'
    && storage.files.dependencies.join() === 'pnpm-lock.yaml' && storage.files.overlap.join() === 'server/node/server.cjs', JSON.stringify(storage.files));
const storageChecked = assessRisk({ status: 'clean', checks: { easy: 'passed', bangju: 'passed' }, files: ['server/node/asset-store.cjs', 'server/node/asset-store.test.ts', 'server/node/server.cjs', 'pnpm-lock.yaml'], overlap: storage.files.overlap });
ok('that is medium even with the checks passed, with the reasons spelled out', storageChecked.risk === 'medium' && storageChecked.reasons.length === 3
    && storageChecked.reasons[0].startsWith('저장에 닿는 코드 2개') && storageChecked.reasons[1].startsWith('의존성') && storageChecked.reasons[2].startsWith('우리가 고친 파일 1개'), storageChecked.reasons.join(' / '));
ok('a failed check makes it high', assessRisk({ status: 'clean', checks: { easy: 'passed', bangju: 'failed' }, files: [], overlap: [] }).risk === 'high');

// the same pair checked before: the earlier check results are reused
const earlier = { schemaVersion: 1, base: { sha: storage.base.sha }, upstream: { sha: storage.upstream.sha }, checks: { easy: 'passed', bangju: 'passed' }, trialImage: { tag: 'bangju-test-up-abc' } };
const reused = reusePrevious(storage, earlier);
ok('an earlier result for the same two versions is reused, a result for other versions is not', reused && reused.checks.bangju === 'passed' && reused.trialImage.tag === 'bangju-test-up-abc'
    && reused.reasons.every(reason => !reason.includes('아직 돌리지 않은')) && reusePrevious(storage, { ...earlier, upstream: { sha: 'other' } }) === null);

// a change that collides with ours
commit(upstream, 'feat: collide', { 'server/node/server.cjs': 'const a = 2;\n\n\n\n\nconst z = 26;\nrequire("./theirs.cjs");\n' });
const untouched = tree(ours);
const collide = inspect(ours, options);
ok('a collision is reported as high with the file, and the tree is put back', collide.status === 'conflict' && collide.risk === 'high' && collide.conflicts.join() === 'server/node/server.cjs'
    && collide.merged === false && tree(ours) === untouched && collide.reasons[0].includes('server/node/server.cjs'), JSON.stringify({ status: collide.status, conflicts: collide.conflicts }));

// the command line: writes the result file and leaves nothing behind
const out = path.join(work, 'result.json');
const run = spawnSync('node', [SCRIPT, '--out', out, '--upstream-url', upstream], { cwd: ours, encoding: 'utf8' });
const written = JSON.parse(fs.readFileSync(out, 'utf8'));
ok('the command writes the result file and exits 0 for a collision too', run.status === 0 && written.status === 'conflict' && written.schemaVersion === 1 && written.allFiles === undefined && written.merged === undefined
    && tree(ours) === untouched && /status=conflict risk=high/.test(run.stdout), run.stdout.trim() + run.stderr.trim());

// uncommitted work is never touched
write(ours, 'server/node/server.cjs', 'edited\n');
const dirty = spawnSync('node', [SCRIPT, '--out', out, '--upstream-url', upstream], { cwd: ours, encoding: 'utf8' });
ok('with uncommitted changes it refuses to look', dirty.status === 1 && /커밋하지 않은 변경/.test(dirty.stderr) && fs.readFileSync(path.join(ours, 'server/node/server.cjs'), 'utf8') === 'edited\n', dirty.stderr.trim());
// the status branch: a file is published without removing the other workflow's file, and the branch keeps one commit
const PUBLISH = path.join(__dirname, '../../deploy/bangju/publish-status.sh');
const remote = path.join(work, 'status.git');
git(work, 'init', '-q', '--bare', remote);
const publish = (message, ...files) => spawnSync('bash', [PUBLISH, message, ...files], { cwd: work, encoding: 'utf8', env: { ...process.env, STATUS_REMOTE: remote, GH_TOKEN: '', GITHUB_REPOSITORY: '' } });
const shown = file => git(remote, 'show', `bangju-status:${file}`);
fs.writeFileSync(path.join(work, 'update-check.json'), '{"n":1}\n');
fs.writeFileSync(path.join(work, 'main-image.json'), '{"tag":"sha-1"}\n');
const first = publish('check', path.join(work, 'update-check.json'));
const second = publish('image', path.join(work, 'main-image.json'));
fs.writeFileSync(path.join(work, 'update-check.json'), '{"n":2}\n');
const third = publish('check again', 'update-check.json');
ok('publishing one status file keeps the other, and the branch keeps a single commit', first.status === 0 && second.status === 0 && third.status === 0
    && shown('update-check.json') === '{"n":2}' && shown('main-image.json') === '{"tag":"sha-1"}' && git(remote, 'rev-list', '--count', 'bangju-status') === '1'
    && git(remote, 'ls-tree', '--name-only', 'bangju-status').split('\n').sort().join() === 'README.md,main-image.json,update-check.json', first.stderr + second.stderr + third.stderr);
const absent = publish('nothing', path.join(work, 'no-such.json'));
ok('a missing file is refused and the branch is left as it was', absent.status !== 0 && /파일이 없습니다/.test(absent.stderr) && shown('update-check.json') === '{"n":2}');

fs.rmSync(work, { recursive: true, force: true });
