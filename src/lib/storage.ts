import 'server-only';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from './config';
import { readPrivateFile, removePrivateFile, storeImmutableFile } from './storage-files';

export interface PrivateStorage {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
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
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }));
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error('Private image object is missing.');
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let storage: PrivateStorage | undefined;
export function getPrivateStorage(): PrivateStorage {
  if (env.NODE_ENV === 'production' && env.STORAGE_PROVIDER === 'local') throw new Error('Local filesystem storage is development-only. Configure a private S3 bucket before production.');
  storage ??= env.STORAGE_PROVIDER === 's3' ? new S3PrivateStorage() : new LocalPrivateStorage();
  return storage;
}
