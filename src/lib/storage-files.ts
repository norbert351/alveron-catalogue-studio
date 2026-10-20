import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { isSafeObjectKey } from './security-rules';

function resolvePrivatePath(root: string, key: string): string {
  if (!isSafeObjectKey(key)) throw new Error('Invalid storage key.');
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, key);
  if (!target.startsWith(`${absoluteRoot}${sep}`)) throw new Error('Storage path is outside the private root.');
  return target;
}

export async function storeImmutableFile(root: string, key: string, bytes: Buffer): Promise<void> {
  const target = resolvePrivatePath(root, key);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const handle = await open(target, 'wx', 0o600);
  try { await handle.writeFile(bytes); }
  finally { await handle.close(); }
}

export async function readPrivateFile(root: string, key: string): Promise<Buffer> {
  return readFile(resolvePrivatePath(root, key));
}

export async function removePrivateFile(root: string, key: string): Promise<void> {
  await unlink(resolvePrivatePath(root, key)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
