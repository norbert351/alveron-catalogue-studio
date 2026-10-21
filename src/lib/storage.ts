import 'server-only';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from './config';
import { readPrivateFile, removePrivateFile, storeImmutableFile } from './storage-files';
import { mkdir, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';

export interface PrivateStorage {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  head(key: string): Promise<{ byteSize: number; sha256?: string }>;
  health(): Promise<void>;
}

class LocalPrivateStorage implements PrivateStorage {
  private readonly root = env.LOCAL_STORAGE_DIR;

  async put(key: string, bytes: Buffer): Promise<void> {
    await storeImmutableFile(this.root, key, bytes);
  }

  async get(key: string): Promise<Buffer> {
    return readPrivateFile(this.root, key);
  }

  async remove(key: string): Promise<void> {
    await removePrivateFile(this.root, key);
  }

  async head(key: string) {
    // Read through the guarded resolver so head() can never touch a path outside
    // the private root; key validation is applied by resolvePrivatePath.
    const file = await readPrivateFile(this.root, key);
    return { byteSize: file.length, sha256: createHash('sha256').update(file).digest('hex') };
  }

  async health(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await stat(this.root);
    const key = `healthchecks/${randomUUID()}.png`;
    const probe = Buffer.from('Alveron private storage health check');
    await storeImmutableFile(this.root, key, probe);
    await removePrivateFile(this.root, key);
  }
}

class S3PrivateStorage implements PrivateStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    if (!env.S3_BUCKET || !env.S3_REGION) throw new Error('S3_BUCKET and S3_REGION are required for S3 storage.');
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
      credentials: env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
        : undefined,
    });
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType, Metadata: { sha256 }, IfNoneMatch: '*' }));
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error('Private image object is missing.');
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async head(key: string) {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key, ChecksumMode: 'ENABLED' }));
    return { byteSize: Number(result.ContentLength ?? 0), sha256: result.Metadata?.sha256 };
  }

  async health(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}

const instances = new Map<string, PrivateStorage>();
export function getPrivateStorage(provider: 'local' | 's3' = env.STORAGE_PROVIDER, allowLocalMigration = false): PrivateStorage {
  if (env.NODE_ENV === 'production' && provider === 'local' && !allowLocalMigration) throw new Error('Local filesystem storage is development-only. Configure a private S3 bucket before production.');
  let storage = instances.get(provider);
  if (!storage) {
    storage = provider === 's3' ? new S3PrivateStorage() : new LocalPrivateStorage();
    instances.set(provider, storage);
  }
  return storage;
}

export function configuredStorageProvider(): 'local' | 's3' { return env.STORAGE_PROVIDER; }
