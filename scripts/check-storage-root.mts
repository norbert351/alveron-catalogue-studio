// Proves the private store resolves to a real, dedicated, absolute directory and
// rejects disposable or public locations.
//
//   npm run storage:root
//
// Run it from anywhere; it also reports the effective base directory so a
// cwd-related misconfiguration is visible before it causes missing images.
import { resolve } from 'node:path';
import { STORAGE_ROOT, env } from '../src/lib/config';

const base = process.env.ALVERON_PROJECT_ROOT ? resolve(process.env.ALVERON_PROJECT_ROOT) : process.cwd();
console.log(`process.cwd()             = ${process.cwd()}`);
console.log(`base for relative paths   = ${base}${process.env.ALVERON_PROJECT_ROOT ? ' (ALVERON_PROJECT_ROOT)' : ''}`);
console.log(`LOCAL_STORAGE_DIR (config)= ${env.LOCAL_STORAGE_DIR}`);
console.log(`STORAGE_ROOT (resolved)   = ${STORAGE_ROOT}`);

let failed = false;
if (!STORAGE_ROOT.startsWith('/')) { console.error('FAIL: storage root is not absolute.'); failed = true; }
for (const fragment of ['/.next/', '/public/', '/tmp/', '/node_modules/']) {
  if (`${STORAGE_ROOT}/`.includes(fragment)) { console.error(`FAIL: storage root is inside ${fragment}`); failed = true; }
}
if (STORAGE_ROOT === '/') { console.error('FAIL: storage root is the filesystem root.'); failed = true; }

if (failed) process.exit(1);
console.log('PASS: storage root is an absolute, dedicated directory outside build output and temp paths.');
console.log('Back this directory up together with the PostgreSQL database.');
