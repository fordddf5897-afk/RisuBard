'use strict';
// How risky taking a new RisuBard version is, judged from a trial merge.
// Used by deploy/bangju/update-check.cjs; the update screen only shows the result.
//
//   high    it does not merge, or it merges but a check fails. Do not update; the files are shown.
//   medium  it merges and the checks pass, but code that touches stored data (or a dependency)
//           changes. Take a snapshot first and try it on the copy before the real data.
//   low     it merges, the checks pass, and nothing near stored data changes.
//   none    there is nothing new.

const TEST_FILE = /\.test\.[cm]?[jt]s$/;
const STORAGE = [/^server\/node\//, /^src\/ts\/storage\//, /^src\/ts\/globalApi\.svelte\.ts$/];
const DEPENDENCIES = [/^pnpm-lock\.yaml$/, /^pnpm-workspace\.yaml$/, /^patches\//];

const matching = (files, patterns) => (files || []).filter(file => !TEST_FILE.test(file) && patterns.some(pattern => pattern.test(file)));
const storageFiles = files => matching(files, STORAGE);
const dependencyFiles = files => matching(files, DEPENDENCIES);

const CHECK_NAMES = { easy: '간편 모드 검사', bangju: '방주 전체 점검' };
const some = (list, limit = 5) => list.slice(0, limit).join(', ') + (list.length > limit ? ` 외 ${list.length - limit}개` : '');

// status: 'up-to-date' | 'clean' | 'conflict'. checks: { easy, bangju } each 'passed' | 'failed' | 'skipped'.
// workflows: workflow files of this repository the merge would change; mergeByButton: whether the merge
// workflow can push that (GitHub refuses workflow changes pushed without a token that may make them).
function assessRisk({ status, conflicts = [], checks = {}, files = [], overlap = [], workflows = [], mergeByButton = true }) {
    if (status === 'up-to-date') return { risk: 'none', reasons: [] };
    if (status === 'conflict') {
        return { risk: 'high', reasons: [`합칠 때 파일 ${conflicts.length}개가 부딪칩니다: ${some(conflicts)}`] };
    }
    const failed = Object.keys(CHECK_NAMES).filter(name => checks[name] === 'failed');
    if (failed.length) {
        return { risk: 'high', reasons: [`부딪치지 않고 합쳐지지만 검사가 실패했습니다: ${failed.map(name => CHECK_NAMES[name]).join(', ')}`] };
    }
    const reasons = [];
    const storage = storageFiles(files);
    const dependencies = dependencyFiles(files);
    const unchecked = Object.keys(CHECK_NAMES).filter(name => checks[name] !== 'passed');
    if (storage.length) reasons.push(`저장에 닿는 코드 ${storage.length}개가 바뀝니다: ${some(storage)}`);
    if (dependencies.length) reasons.push(`의존성이 바뀝니다: ${some(dependencies)}`);
    if (unchecked.length) reasons.push(`아직 돌리지 않은 검사가 있습니다: ${unchecked.map(name => CHECK_NAMES[name]).join(', ')}`);
    const risk = reasons.length ? 'medium' : 'low';
    if (risk === 'low') reasons.push('부딪치는 곳이 없고 검사를 통과했습니다. 저장에 닿는 코드와 의존성은 바뀌지 않습니다.');
    if (overlap.length) reasons.push(`우리가 고친 파일 ${overlap.length}개도 바뀌지만 부딪치지 않고 합쳐집니다: ${some(overlap)}`);
    if (workflows.length && !mergeByButton) reasons.push(`GitHub 작업 파일 ${workflows.length}개가 바뀌어, GitHub가 '합치기' 버튼으로 올리는 것을 막습니다. 합치는 일은 Claude에게 맡기면 됩니다: ${some(workflows)}`);
    else if (workflows.length) reasons.push(`GitHub 작업 파일 ${workflows.length}개도 바뀝니다: ${some(workflows)}`);
    return { risk, reasons };
}

module.exports = { assessRisk, storageFiles, dependencyFiles };
