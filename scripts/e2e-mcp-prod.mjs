/**
 * Orchestrates the MCP bridge end-to-end against the production-mode app:
 * creates a real 3-image product and a read-only token, runs mcp/test/e2e.mjs
 * as a child (which returns real image content blocks), then cleans up.
 *
 * Run from the deployment directory:
 *   node --conditions=react-server --env-file-if-exists=.env.local \
 *     scripts/e2e-mcp-prod.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import sharp from 'sharp';

const base = (process.env.ALVERON_E2E_BASE ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sameOrigin = { Origin: base };
const api = (path, options = {}) => fetch(`${base}${path}`, options);

async function garment(index, colour) {
  const svg = `<svg width="640" height="800" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#e8e2d6"/>
    <path d="M200 120 L440 120 L470 200 L560 250 L540 340 L500 320 L505 700 L135 700 L140 320 L100 340 L80 250 L170 200 Z" fill="${colour}"/>
    <text x="240" y="760" font-family="Arial" font-size="28" fill="#222">MCP ${index}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function form(files) {
  const data = new FormData();
  data.set('name', 'MCP E2E Shirt');
  data.set('category', 'shirt');
  data.set('color', 'assorted');
  data.set('tags', 'e2e,mcp');
  for (const file of files) {
    data.append('images', new Blob([file.bytes], { type: 'image/png' }), file.name);
    data.append('viewLabels', file.view);
  }
  return data;
}

let cookie;
let productId;
let tokenId;
try {
  for (const key of ['DATABASE_URL', 'AUTH_BOOTSTRAP_EMAIL', 'AUTH_BOOTSTRAP_PASSWORD']) {
    if (!process.env[key]) throw new Error(`${key} is required (use --env-file-if-exists=.env.local).`);
  }

  const login = await api('/api/auth/login', {
    method: 'POST', headers: { ...sameOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.AUTH_BOOTSTRAP_EMAIL, password: process.env.AUTH_BOOTSTRAP_PASSWORD }),
  });
  assert.equal(login.status, 200, await login.clone().text());
  cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);

  const files = [
    { bytes: await garment(1, '#7a1f2b'), name: 'mcp-front.png', view: 'front' },
    { bytes: await garment(2, '#22303f'), name: 'mcp-back.png', view: 'back' },
    { bytes: await garment(3, '#4a4a2f'), name: 'mcp-detail.png', view: 'detail' },
  ];
  const created = await api('/api/products', {
    method: 'POST',
    headers: { Cookie: cookie, ...sameOrigin, 'Idempotency-Key': `mcp-e2e-${Date.now()}` },
    body: form(files),
  });
  const createdBody = await created.json();
  assert.equal(created.status, 201, JSON.stringify(createdBody));
  productId = createdBody.id ?? createdBody.productId;
  assert.ok(productId);

  const tokenResponse = await api('/api/settings/tokens', {
    method: 'POST', headers: { Cookie: cookie, ...sameOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'MCP E2E' }),
  });
  const tokenBody = await tokenResponse.json();
  assert.equal(tokenResponse.status, 201, JSON.stringify(tokenBody));
  const token = tokenBody.token;
  tokenId = tokenBody.id;

  console.log('Running MCP stdio bridge against a real product…');
  execFileSync(process.execPath, ['mcp/test/e2e.mjs'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      ALVERON_LIBRARY_BASE_URL: base,
      ALVERON_LIBRARY_TOKEN: token,
      ALVERON_TEST_PRODUCT_ID: productId,
    },
  });

  console.log('MCP bridge verification passed.');
} finally {
  if (productId && cookie) {
    await api(`/api/products/${productId}`, { method: 'DELETE', headers: { Cookie: cookie, ...sameOrigin } }).catch(() => undefined);
  }
  if (tokenId && cookie) {
    await api(`/api/settings/tokens?id=${tokenId}`, { method: 'DELETE', headers: { Cookie: cookie, ...sameOrigin } }).catch(() => undefined);
  }
  await pool.end().catch(() => undefined);
}
