#!/usr/bin/env node
'use strict';
// "미리 합쳐 보기": looks whether a newer RisuBard exists, merges it in the working tree only
// (nothing is committed or pushed), optionally runs the checks on the merged code, and writes
// what it found as JSON for the update screen. The tree is put back as it was, unless
// --keep-merge is given (the workflow then builds a trial image from the merged code).
//
//   node deploy/bangju/update-check.cjs --out result.json [--checks] [--keep-merge]
//        [--upstream-url URL] [--upstream-branch main] [--previous earlier-result.json]
//
// Exit code 0 whenever a result was written (also for a conflict); 1 when it could not look.
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { assessRisk, storageFiles, dependencyFiles } = require('./update-risk.cjs');

const DEFAULT_UPSTREAM = 'https://github.com/rpaddict/RisuBard.git';

function git(cwd, args, options = {}) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}
function tryGit(cwd, args) {
    const done = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { ok: done.status === 0, out: (done.stdout || '').trim(), err: (done.stderr || '').trim() };
}
const lines = text => text.split('\n').map(line => line.trim()).filter(Boolean);
function versionAt(cwd, ref) {
    try { return String(JSON.parse(git(cwd, ['show', `${ref}:package.json`])).version || ''); } catch { return ''; }
}

// Compares with upstream and tries the merge. Leaves the merged (uncommitted) tree in place
// when it merged cleanly; the caller aborts it or keeps it.
// syncToken: the merge workflow has a token that may push workflow-file changes (EASY_SYNC_TOKEN).
function inspect(cwd, { upstreamUrl = DEFAULT_UPSTREAM, upstreamBranch = 'main', now = new Date(), syncToken = false } = {}) {
    if (git(cwd, ['status', '--porcelain', '--untracked-files=no'])) throw new Error('커밋하지 않은 변경이 있어 살펴보지 않습니다.');
    const baseSha = git(cwd, ['rev-parse', 'HEAD']);
    git(cwd, ['fetch', '--no-tags', '--quiet', upstreamUrl, upstreamBranch]);
    const upstreamSha = git(cwd, ['rev-parse', 'FETCH_HEAD']);
    const result = {
        schemaVersion: 1,
        checkedAt: now.toISOString(),
        repository: process.env.GITHUB_REPOSITORY || '',
        base: { sha: baseSha, version: versionAt(cwd, 'HEAD') },
        upstream: { url: upstreamUrl.replace(/\.git$/, ''), branch: upstreamBranch, sha: upstreamSha, version: versionAt(cwd, upstreamSha) },
        status: 'up-to-date',
        commits: { total: 0, list: [] },
        files: { total: 0, storage: [], dependencies: [], overlap: [], workflows: [] },
        conflicts: [],
        checks: { easy: 'skipped', bangju: 'skipped' },
        mergeByButton: true,
        merged: false,
    };
    if (tryGit(cwd, ['merge-base', '--is-ancestor', upstreamSha, 'HEAD']).ok) return finish(result);

    const mergeBase = tryGit(cwd, ['merge-base', 'HEAD', upstreamSha]);
    if (!mergeBase.ok || !mergeBase.out) throw new Error('원본과 이어지는 지점을 찾지 못했습니다(기록이 잘려 있으면 전체 기록을 받아야 합니다).');
    result.commits.total = Number(git(cwd, ['rev-list', '--count', '--no-merges', `HEAD..${upstreamSha}`]));
    result.commits.list = lines(git(cwd, ['log', '--no-merges', '--max-count=200', '--format=%h%x09%cI%x09%s', `HEAD..${upstreamSha}`]))
        .map(line => { const [sha, date, ...title] = line.split('\t'); return { sha, date, title: title.join('\t') }; });
    const theirs = lines(git(cwd, ['diff', '--name-only', mergeBase.out, upstreamSha]));
    const ours = new Set(lines(git(cwd, ['diff', '--name-only', mergeBase.out, 'HEAD'])));
    result.files = {
        total: theirs.length,
        storage: storageFiles(theirs),
        dependencies: dependencyFiles(theirs),
        overlap: theirs.filter(file => ours.has(file)),
        workflows: [],
        all: theirs,
    };

    const merge = tryGit(cwd, ['-c', 'user.name=update-check', '-c', 'user.email=update-check@localhost', 'merge', '--no-commit', '--no-ff', upstreamSha]);
    if (merge.ok) {
        result.status = 'clean';
        result.merged = true;
        // Workflow files that would differ from ours after the merge. GitHub refuses a push that changes
        // them unless the token may, so the merge workflow cannot publish such a merge with its default token.
        result.files.workflows = lines(tryGit(cwd, ['diff', '--cached', '--name-only', 'HEAD', '--', '.github/workflows']).out);
        result.mergeByButton = !result.files.workflows.length || Boolean(syncToken);
    } else {
        result.conflicts = lines(tryGit(cwd, ['diff', '--name-only', '--diff-filter=U']).out);
        abortMerge(cwd);
        if (!result.conflicts.length) throw new Error(`합쳐 보는 중 실패했습니다: ${merge.err.split('\n')[0]}`);
        result.status = 'conflict';
    }
    return finish(result);
}

function abortMerge(cwd) {
    if (tryGit(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).ok) git(cwd, ['merge', '--abort']);
}

// Risk and the lists the screen shows; the full file list is only for the rules.
function finish(result) {
    const { risk, reasons } = assessRisk({ status: result.status, conflicts: result.conflicts, checks: result.checks, files: result.files.all || [], overlap: result.files.overlap,
        workflows: result.files.workflows, mergeByButton: result.mergeByButton });
    const { all, ...files } = result.files;
    return { ...result, files, risk, reasons, ...(all ? { allFiles: all } : {}) };
}

// The checks that gate the real image, run on the merged tree.
function runChecks(cwd, result, { log = console.log } = {}) {
    const run = (label, command, args) => {
        log(`--- ${label}`);
        const done = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ONNXRUNTIME_NODE_INSTALL_CUDA: 'skip' } });
        return done.status === 0;
    };
    const checks = { easy: 'failed', bangju: 'skipped' };
    if (run('의존성 설치', 'pnpm', ['install', '--frozen-lockfile'])) {
        checks.easy = run('간편 모드 검사', 'bash', ['deploy/easy-ci-check.sh']) ? 'passed' : 'failed';
        checks.bangju = run('방주 전체 점검', 'bash', ['test/bangju-proto/run-all.sh']) ? 'passed' : 'failed';
    }
    return finish({ ...result, files: { ...result.files, all: result.allFiles || [] }, checks });
}

// The same pair was checked before: its check results still stand.
function reusePrevious(result, previous) {
    if (!previous || previous.schemaVersion !== 1 || result.status !== 'clean') return null;
    if (previous.base?.sha !== result.base.sha || previous.upstream?.sha !== result.upstream.sha) return null;
    if (!['passed', 'failed'].includes(previous.checks?.easy) || !['passed', 'failed'].includes(previous.checks?.bangju)) return null;
    return finish({ ...result, files: { ...result.files, all: result.allFiles || [] }, checks: previous.checks, ...(previous.trialImage ? { trialImage: previous.trialImage } : {}) });
}

function main(argv) {
    const args = new Map();
    for (let i = 0; i < argv.length; i++) {
        const name = argv[i];
        if (!name.startsWith('--')) continue;
        const takesValue = ['--out', '--upstream-url', '--upstream-branch', '--previous'].includes(name);
        args.set(name, takesValue ? argv[++i] : true);
    }
    const out = args.get('--out');
    if (!out) { console.error('--out <file> 이 필요합니다.'); return 1; }
    const cwd = process.cwd();
    let result;
    try {
        result = inspect(cwd, {
            upstreamUrl: args.get('--upstream-url') || process.env.UPSTREAM_URL || DEFAULT_UPSTREAM,
            upstreamBranch: args.get('--upstream-branch') || process.env.UPSTREAM_BRANCH || 'main',
            syncToken: process.env.HAS_SYNC_TOKEN === 'true',
        });
    } catch (error) {
        abortMerge(cwd);
        console.error(String(error.message || error));
        return 1;
    }
    let reused = false;
    try {
        if (result.status === 'clean') {
            let previous = null;
            try { previous = args.get('--previous') ? JSON.parse(fs.readFileSync(args.get('--previous'), 'utf8')) : null; } catch { previous = null; }
            const kept = reusePrevious(result, previous);
            if (kept) { result = kept; reused = true; }
            else if (args.get('--checks')) result = runChecks(cwd, result);
        }
    } finally {
        if (!args.get('--keep-merge') || result.status !== 'clean') abortMerge(cwd);
    }
    const { allFiles, merged, ...published } = result;
    published.runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(published, null, 2)}\n`);
    console.log(`status=${published.status} risk=${published.risk} upstream=${published.upstream.version} (${published.upstream.sha.slice(0, 7)}) commits=${published.commits.total}${reused ? ' (검사 결과는 지난번 것을 그대로 씀)' : ''}`);
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `status=${published.status}\nrisk=${published.risk}\nupstream_sha=${published.upstream.sha}\nupstream_version=${published.upstream.version}\nchecks_ok=${published.checks.easy === 'passed' && published.checks.bangju === 'passed'}\nreused=${reused}\n`);
    }
    return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { inspect, abortMerge, runChecks, reusePrevious, finish };
