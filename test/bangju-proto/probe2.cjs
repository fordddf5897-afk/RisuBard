'use strict';
const { listCanonicalBackupEntries } = require(require('node:path').resolve(__dirname, '../../server/node/canonical-backup-inventory.cjs'));
(async () => {
    const entries = await listCanonicalBackupEntries(process.argv[2]);
    const tops = {};
    for (const e of entries) { const top = e.sortKey.split('/')[1]; tops[top] = (tops[top] || 0) + 1; }
    console.log('files a full in-app backup would include, by top folder:', JSON.stringify(tops));
    console.log('any file from the archive folder included:', entries.some(e => e.sortKey.includes('bangju')));
})();
