import { createHash } from 'node:crypto';

/**
 * Shared read-only client for the Alveron library HTTP API.
 *
 * Used by the stdio MCP bridge and the private Responses API vision bridge.
 * The bearer token never leaves this process; callers only receive metadata
 * and verified bytes.
 */

export const DEFAULT_LIBRARY_BASE_URL = 'http://127.0.0.1:3001';
export const DEFAULT_LIBRARY_TIMEOUT_MS = 45_000;
export const DEFAULT_LIBRARY_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const IMAGE_MEDIA_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const IMAGE_TYPE_SET = new Set(IMAGE_MEDIA_TYPES);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function detectImageMediaType(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function redactText(value, secrets = []) {
  let text = value instanceof Error ? value.message : String(value ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8) {
      text = text.split(secret).join('[redacted]');
    }
  }
  return text
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/gi, '[redacted image data]')
    .replace(/\balv_lib_[A-Za-z0-9_-]{8,}\b/g, '[redacted library token]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted API key]');
}

export function createLibraryClient({
  baseUrl = DEFAULT_LIBRARY_BASE_URL,
  token,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_LIBRARY_TIMEOUT_MS,
  maxImageBytes = DEFAULT_LIBRARY_MAX_IMAGE_BYTES,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  if (typeof token !== 'string' || !token.trim().startsWith('alv_lib_')) {
    throw new Error('ALVERON_LIBRARY_TOKEN is missing or is not a library token (alv_lib_...).');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Library timeout must be a positive integer.');
  if (!Number.isSafeInteger(maxImageBytes) || maxImageBytes <= 0) throw new Error('Image size limit must be a positive integer.');

  let parsedBase;
  try {
    parsedBase = new URL(baseUrl);
  } catch {
    throw new Error('ALVERON_LIBRARY_BASE_URL is not a valid URL.');
  }
  if (!['http:', 'https:'].includes(parsedBase.protocol)) {
    throw new Error('ALVERON_LIBRARY_BASE_URL must use http or https.');
  }

  const base = parsedBase.href.replace(/\/+$/, '');
  const bearer = token.trim();
  const redact = (value) => redactText(value, [bearer]);

  async function call(path, { accept = 'application/json' } = {}) {
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        headers: { Authorization: `Bearer ${bearer}`, Accept: accept },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Error(`Could not reach the Alveron library at ${base}: ${redact(error?.message ?? error)}`, { cause: error });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Alveron library returned ${response.status} for ${path}: ${redact(detail.slice(0, 400))}`,
      );
    }
    return response;
  }

  async function getJson(path) {
    const response = await call(path);
    try {
      return await response.json();
    } catch {
      throw new Error('The Alveron library returned an invalid JSON response.');
    }
  }

  async function getProduct(productId) {
    if (!isUuid(productId)) throw new Error('That is not a valid product id.');
    const product = await getJson(`/api/library/products/${encodeURIComponent(productId)}`);
    if (!product || product.id !== productId) throw new Error('The Alveron library returned an unexpected product.');
    return product;
  }

  async function downloadVerifiedImage(product, image) {
    if (!product || !isUuid(product.id)) throw new Error('A valid product record is required.');
    if (!image || !isUuid(image.imageId)) throw new Error('That is not a valid image id.');
    if (!IMAGE_TYPE_SET.has(image.mediaType)) throw new Error(`Unsupported media type: ${image.mediaType}`);

    const declaredSize = Number(image.byteSize);
    if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0) {
      throw new Error('The stored image has an invalid declared size.');
    }
    if (declaredSize > maxImageBytes) {
      throw new Error(`Original is larger than the ${maxImageBytes}-byte limit.`);
    }
    if (!SHA256_PATTERN.test(image.sha256 ?? '')) throw new Error('The stored image has an invalid SHA-256.');

    const path = `/api/library/products/${encodeURIComponent(product.id)}/images/${encodeURIComponent(image.imageId)}/original`;
    const response = await call(path, { accept: image.mediaType });

    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) {
      const length = Number(contentLength);
      if (!Number.isSafeInteger(length) || length !== declaredSize) {
        throw new Error('The original response length does not match the stored record.');
      }
    }

    const responseType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (responseType && responseType !== image.mediaType) {
      throw new Error(`The original response type ${responseType} does not match the stored type ${image.mediaType}.`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxImageBytes) {
      throw new Error(`Original is larger than the ${maxImageBytes}-byte limit.`);
    }
    if (bytes.length !== declaredSize) {
      throw new Error('Original size does not match the stored record.');
    }

    const detectedType = detectImageMediaType(bytes);
    if (detectedType !== image.mediaType) {
      throw new Error(`The original bytes are not a valid ${image.mediaType} image.`);
    }

    const digest = createHash('sha256').update(bytes).digest('hex');
    const responseDigest = response.headers.get('x-original-sha256')?.trim().toLowerCase();
    if (responseDigest && responseDigest !== digest) {
      throw new Error('The original response checksum does not match the bytes received.');
    }
    if (digest !== image.sha256.toLowerCase()) {
      throw new Error('Original failed its SHA-256 check; refusing to send it.');
    }

    return { product, image, bytes, sha256: digest, mediaType: image.mediaType, byteSize: bytes.length };
  }

  async function getVerifiedImage(productId, imageId) {
    if (!isUuid(imageId)) throw new Error('That is not a valid image id.');
    const product = await getProduct(productId);
    const image = (product.images ?? []).find((candidate) => candidate?.imageId === imageId);
    if (!image) throw new Error('No such image on that product.');
    return downloadVerifiedImage(product, image);
  }

  return {
    baseUrl: base,
    redact,
    call,
    getJson,
    getProduct,
    downloadVerifiedImage,
    getVerifiedImage,
  };
}
