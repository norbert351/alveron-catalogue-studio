#!/usr/bin/env node
/**
 * Opt-in live test for the private vision bridge.
 *
 * This makes one paid OpenAI Responses API call and sends one generated image
 * to OpenAI. It refuses to run unless VISION_LIVE_APPROVED=yes.
 *
 *   VISION_LIVE_APPROVED=yes \
 *   node --env-file-if-exists=.env.local scripts/vision-bridge-live.mjs
 *
 * Required: OPENAI_API_KEY, OPENAI_VISION_MODEL,
 *           AUTH_BOOTSTRAP_EMAIL, AUTH_BOOTSTRAP_PASSWORD.
 * Optional: ALVERON_E2E_BASE (default http://127.0.0.1:3001).
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { createLibraryClient } from '../mcp/library-client.mjs';
import {
  loadVisionConfig,
  redactText,
  runVisionBridge,
} from './vision-bridge.mjs';

const base = (process.env.ALVERON_E2E_BASE ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');
const sameOrigin = { Origin: base };
const api = (path, options = {}) => fetch(`${base}${path}`, options);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

let cookie;
let productId;
let token;
let tokenId;
let marker;

async function markerImage(text) {
  const svg = `<svg width="900" height="400" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#111111"/>
    <text x="450" y="225" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif"
      font-size="72" font-weight="bold" fill="#ffffff">${text}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  if (process.env.VISION_LIVE_APPROVED !== 'yes') {
    console.error('Refusing live test: set VISION_LIVE_APPROVED=yes after approving the OpenAI cost.');
    return 2;
  }
  for (const key of ['OPENAI_API_KEY', 'OPENAI_VISION_MODEL', 'AUTH_BOOTSTRAP_EMAIL', 'AUTH_BOOTSTRAP_PASSWORD']) {
    if (!process.env[key]) throw new Error(`${key} is required.`);
  }

  marker = `ALVERON-${randomBytes(4).toString('hex').toUpperCase()}`;
  const bytes = await markerImage(marker);
  const imageSha = sha256(bytes);

  const login = await api('/api/auth/login', {
    method: 'POST',
    headers: { ...sameOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.AUTH_BOOTSTRAP_EMAIL,
      password: process.env.AUTH_BOOTSTRAP_PASSWORD,
    }),
  });
  assert.equal(login.status, 200, await login.clone().text());
  cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'owner login must issue a session cookie');

  const form = new FormData();
  form.set('name', `Vision live marker ${marker}`);
  form.set('category', 'shirt');
  form.set('color', 'black');
  form.set('tags', 'vision-live,marker');
  form.append('images', new Blob([bytes], { type: 'image/png' }), 'vision-marker.png');
  form.append('viewLabels', 'front');

  const created = await api('/api/products', {
    method: 'POST',
    headers: { Cookie: cookie, ...sameOrigin, 'Idempotency-Key': `vision-live-${Date.now()}` },
    body: form,
  });
  const createdBody = await created.json();
  assert.equal(created.status, 201, JSON.stringify(createdBody));
  productId = createdBody.id ?? createdBody.productId;
  assert.ok(productId);

  const tokenResponse = await api('/api/settings/tokens', {
    method: 'POST',
    headers: { Cookie: cookie, ...sameOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: `Vision live ${marker}` }),
  });
  const tokenBody = await tokenResponse.json();
  assert.equal(tokenResponse.status, 201, JSON.stringify(tokenBody));
  token = tokenBody.token;
  tokenId = tokenBody.id;
  assert.ok(token.startsWith('alv_lib_'));

  const config = loadVisionConfig({
    ...process.env,
    ALVERON_LIBRARY_TOKEN: token,
    ALVERON_LIBRARY_BASE_URL: base,
    VISION_MAX_IMAGES: process.env.VISION_MAX_IMAGES ?? '1',
  });
  const client = createLibraryClient({
    baseUrl: base,
    token,
    timeoutMs: config.libraryTimeoutMs,
    maxImageBytes: config.maxImageBytes,
  });
  const product = await client.getProduct(productId);
  assert.equal(product.images?.length, 1, 'the live product must have exactly one image');
  const imageId = product.images[0].imageId;

  console.log('Sending one generated image to the configured OpenAI vision model...');
  const result = await runVisionBridge({
    question: 'Read the large text printed in the image. Reply with exactly that text and nothing else.',
    selections: [{ productId, imageId }],
    config,
    libraryClient: client,
  });

  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].productId, productId);
  assert.equal(result.images[0].imageId, imageId);
  assert.equal(result.images[0].sha256, imageSha);
  assert.equal(result.images[0].verified, true);
  assert.ok(
    result.answer.toUpperCase().includes(marker),
    'the model answer did not contain the unique image marker',
  );

  console.log(`PASS live vision bridge: marker ${marker} verified, response ${result.responseId ?? '(no id)'}.`);
  return 0;
}

try {
  const code = await main();
  process.exitCode = code;
} catch (error) {
  console.error(`vision-bridge-live: ${redactText(error?.message ?? error, [process.env.OPENAI_API_KEY, token])}`);
  process.exitCode = 1;
} finally {
  if (productId && cookie) {
    await api(`/api/products/${productId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie, ...sameOrigin },
    }).catch(() => undefined);
  }
  if (tokenId && cookie) {
    await api(`/api/settings/tokens?id=${tokenId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie, ...sameOrigin },
    }).catch(() => undefined);
  }
  await delay(0);
}
