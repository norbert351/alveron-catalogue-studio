// Proves the private store is found regardless of the process working directory.
// Usage: node --conditions=react-server --env-file-if-exists=.env.local --import tsx scripts/check-storage-root.mts
import { resolve } from 'node:path';
import { STORAGE_ROOT } from '../src/lib/config';

const expected = resolve(import.meta.dirname, '..', '.local-data', 'private');
console.log(`process.cwd()      = ${process.cwd()}`);
console.log(`STORAGE_ROOT       = ${STORAGE_ROOT}`);
console.log(`expected (project) = ${expected}`);
if (STORAGE_ROOT !== expected) {
  console.error('FAIL: storage root does not point at the project data directory.');
  process.exit(1);
}
if (STORAGE_ROOT.includes('/tmp/') || STORAGE_ROOT.includes('/.next/') || STORAGE_ROOT.includes('/public/')) {
  console.error('FAIL: storage root is inside a disposable or public location.');
  process.exit(1);
}
console.log('PASS: storage root is absolute and independent of the working directory.');
