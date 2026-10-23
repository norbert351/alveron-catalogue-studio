import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  createLibraryClient,
  detectImageMediaType,
} from '../mcp/library-client.mjs';
import {
  buildOpenAIPayload,
  createRateLimiter,
  extractOutputText,
  loadVisionConfig,
  main,
  parseCliArgs,
  runVisionBridge,
  VISION_INSTRUCTIONS,
} from '../scripts/vision-bridge.mjs';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const IMAGE_ID = '22222222-2222-4222-8222-222222222222';
const LIBRARY_TOKEN = 'alv_lib_test_1234567890';
const API_KEY = 'sk-test-1234567890';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BYTES = Buffer.concat([PNG_SIGNATURE, Buffer.from('vision-bridge-fixture')]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function product(overrides = {}) {
  return {
    id: PRODUCT_ID,
    name: 'Navy Oxford Shirt',
    sku: 'SH-NAVY-1',
    category: 'shirt',
    colour: 'navy',
    tags: ['cotton'],
    images: [{
      imageId: IMAGE_ID,
      filename: 'navy-front.png',
      mediaType: 'image/png',
      byteSize: PNG_BYTES.length,
      width: 1,
      height: 1,
      viewLabel: 'front',
      sha256: sha256(PNG_BYTES),
      originalUrl: 'https://example.invalid/original?signature=secret',
    }],
    ...overrides,
  };
}

function config(overrides = {}) {
  return {
    ...loadVisionConfig({
      OPENAI_API_KEY: API_KEY,
      OPENAI_VISION_MODEL: 'vision-test-model',
      ALVERON_LIBRARY_TOKEN: LIBRARY_TOKEN,
    }),
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function openAIResponse(text = 'A navy button-down shirt.', overrides = {}) {
  return jsonResponse({
    id: 'resp_test_1',
    output_text: text,
    usage: { input_tokens: 10, output_tokens: 12, total_tokens: 22 },
    ...overrides,
  });
}

function verified(overrides = {}) {
  return {
    product: product(),
    image: product().images[0],
    bytes: PNG_BYTES,
    mediaType: 'image/png',
    sha256: sha256(PNG_BYTES),
    ...overrides,
  };
}

function libraryClient(overrides = {}) {
  return {
    getProduct: async () => product(),
    downloadVerifiedImage: async () => verified(),
    ...overrides,
  };
}

function imageSelection() {
  return [{ productId: PRODUCT_ID, imageId: IMAGE_ID }];
}

test('buildOpenAIPayload sends the actual verified bytes as a data URL and a separate question', () => {
  const payload = buildOpenAIPayload({
    model: 'vision-test-model',
    question: 'What colour is the shirt?',
    images: [{ bytes: PNG_BYTES, mediaType: 'image/png' }],
    maxOutputTokens: 321,
    imageDetail: 'original',
  });

  assert.equal(payload.model, 'vision-test-model');
  assert.equal(payload.store, false);
  assert.equal(payload.max_output_tokens, 321);
  assert.equal(payload.instructions, VISION_INSTRUCTIONS);
  assert.match(payload.instructions, /untrusted data/i);

  const content = payload.input[0].content;
  assert.deepEqual(content[0], { type: 'input_text', text: 'What colour is the shirt?' });
  assert.equal(content[1].type, 'input_image');
  assert.equal(content[1].detail, 'original');
  assert.match(content[1].image_url, /^data:image\/png;base64,/);
  const sent = Buffer.from(content[1].image_url.split(',')[1], 'base64');
  assert.deepEqual(sent, PNG_BYTES);
  assert.ok(!content[1].image_url.includes('example.invalid'));
});

test('valid retrieval returns the answer, verified metadata and no signed URL', async () => {
  let payload;
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    payload = JSON.parse(init.body);
    return openAIResponse();
  };

  const result = await runVisionBridge({
    question: 'What colour is the shirt?',
    selections: imageSelection(),
    config: config(),
    fetchImpl,
    libraryClient: libraryClient(),
  });

  assert.equal(result.answer, 'A navy button-down shirt.');
  assert.equal(result.model, 'vision-test-model');
  assert.equal(result.responseId, 'resp_test_1');
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 12, totalTokens: 22 });
  assert.equal(result.images.length, 1);
  assert.deepEqual(result.images[0], {
    productId: PRODUCT_ID,
    productName: 'Navy Oxford Shirt',
    imageId: IMAGE_ID,
    filename: 'navy-front.png',
    mediaType: 'image/png',
    byteSize: PNG_BYTES.length,
    width: 1,
    height: 1,
    viewLabel: 'front',
    sha256: sha256(PNG_BYTES),
    verified: true,
  });
  assert.ok(!JSON.stringify(result).includes('example.invalid'));
  assert.ok(!JSON.stringify(result).includes('alv_lib_'));
  assert.ok(!JSON.stringify(result).includes(API_KEY));
  assert.ok(!JSON.stringify(payload).includes(LIBRARY_TOKEN));
});

test('a SHA-256 mismatch stops the request before OpenAI is called', async () => {
  let openAICalls = 0;
  let originalCalls = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith(`/api/library/products/${PRODUCT_ID}`)) {
      return jsonResponse(product({
        images: [{ ...product().images[0], sha256: '0'.repeat(64) }],
      }));
    }
    originalCalls += 1;
    return new Response(PNG_BYTES, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(PNG_BYTES.length),
        'X-Original-SHA256': sha256(PNG_BYTES),
      },
    });
  };
  const client = createLibraryClient({
    baseUrl: 'http://127.0.0.1:3001',
    token: LIBRARY_TOKEN,
    fetchImpl,
  });

  await assert.rejects(
    runVisionBridge({
      question: 'What is shown?',
      selections: imageSelection(),
      config: config(),
      fetchImpl: async () => {
        openAICalls += 1;
        return openAIResponse();
      },
      libraryClient: client,
    }),
    /SHA-256/,
  );
  assert.equal(originalCalls, 1);
  assert.equal(openAICalls, 0);
});

test('unsupported media types are rejected without downloading or calling OpenAI', async () => {
  let originalCalls = 0;
  let openAICalls = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith(`/api/library/products/${PRODUCT_ID}`)) {
      return jsonResponse(product({
        images: [{ ...product().images[0], mediaType: 'image/gif' }],
      }));
    }
    originalCalls += 1;
    return new Response(PNG_BYTES);
  };
  const client = createLibraryClient({ token: LIBRARY_TOKEN, fetchImpl });

  await assert.rejects(
    runVisionBridge({
      question: 'What is shown?',
      selections: imageSelection(),
      config: config(),
      fetchImpl: async () => {
        openAICalls += 1;
        return openAIResponse();
      },
      libraryClient: client,
    }),
    /Unsupported media type/,
  );
  assert.equal(originalCalls, 0);
  assert.equal(openAICalls, 0);
});

test('oversized originals are rejected before download', async () => {
  let originalCalls = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith(`/api/library/products/${PRODUCT_ID}`)) {
      return jsonResponse(product({
        images: [{ ...product().images[0], byteSize: 900_000 }],
      }));
    }
    originalCalls += 1;
    return new Response(PNG_BYTES);
  };
  const client = createLibraryClient({ token: LIBRARY_TOKEN, fetchImpl, maxImageBytes: 1_000 });

  await assert.rejects(
    client.getVerifiedImage(PRODUCT_ID, IMAGE_ID),
    /larger than the 1000-byte limit/,
  );
  assert.equal(originalCalls, 0);
});

test('declared size and content-type mismatches are rejected', async () => {
  const baseProduct = product();
  const cases = [
    {
      response: () => new Response(PNG_BYTES, {
        headers: { 'Content-Type': 'image/png', 'Content-Length': '999' },
      }),
      pattern: /response length/,
    },
    {
      response: () => new Response(PNG_BYTES, {
        headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(PNG_BYTES.length) },
      }),
      pattern: /response type/,
    },
    {
      response: () => new Response(Buffer.from('not an image'), {
        headers: { 'Content-Type': 'image/png', 'Content-Length': String(PNG_BYTES.length) },
      }),
      pattern: /size does not match/,
    },
  ];

  for (const scenario of cases) {
    const fetchImpl = async (url) => (
      url.endsWith(`/api/library/products/${PRODUCT_ID}`)
        ? jsonResponse(baseProduct)
        : scenario.response()
    );
    const client = createLibraryClient({ token: LIBRARY_TOKEN, fetchImpl });
    await assert.rejects(client.getVerifiedImage(PRODUCT_ID, IMAGE_ID), scenario.pattern);
  }
});

test('invalid library credentials fail before OpenAI', async () => {
  let openAICalls = 0;
  const fetchImpl = async () => jsonResponse({ error: 'unauthorized' }, 401);
  const client = createLibraryClient({ token: LIBRARY_TOKEN, fetchImpl });

  await assert.rejects(
    runVisionBridge({
      question: 'What is shown?',
      selections: imageSelection(),
      config: config(),
      fetchImpl: async () => {
        openAICalls += 1;
        return openAIResponse();
      },
      libraryClient: client,
    }),
    /returned 401/,
  );
  assert.equal(openAICalls, 0);
});

test('OpenAI errors and timeouts are sanitized', async () => {
  const client = libraryClient();

  await assert.rejects(
    runVisionBridge({
      question: 'What is shown?',
      selections: imageSelection(),
      config: config(),
      fetchImpl: async () => jsonResponse({ error: { message: `bad key ${API_KEY}` } }, 500),
      libraryClient: client,
    }),
    (error) => {
      assert.match(error.message, /OpenAI returned 500/);
      assert.ok(!error.message.includes(API_KEY));
      assert.ok(!error.message.includes('data:image'));
      return true;
    },
  );

  await assert.rejects(
    runVisionBridge({
      question: 'What is shown?',
      selections: imageSelection(),
      config: config(),
      fetchImpl: async () => {
        throw Object.assign(new Error(`timeout ${API_KEY}`), { name: 'TimeoutError' });
      },
      libraryClient: client,
    }),
    (error) => {
      assert.equal(error.message, 'The OpenAI request timed out.');
      assert.ok(!error.message.includes(API_KEY));
      return true;
    },
  );
});

test('OpenAI responses with no text are rejected', async () => {
  await assert.rejects(
    runVisionBridge({
      question: 'What is shown?',
      selections: imageSelection(),
      config: config(),
      fetchImpl: async () => jsonResponse({ id: 'resp_empty', output: [] }),
      libraryClient: libraryClient(),
    }),
    /no text output/,
  );
});

test('output_text fallback parses message output items', () => {
  assert.equal(extractOutputText({
    output: [{
      type: 'message',
      content: [
        { type: 'output_text', text: 'first' },
        { type: 'output_text', text: 'second' },
      ],
    }],
  }), 'first\nsecond');
});

test('image count, question length and local rate limits are enforced', async () => {
  await assert.rejects(
    runVisionBridge({
      question: 'What is shown?',
      selections: [{ productId: PRODUCT_ID }],
      config: config({ maxImages: 4 }),
      fetchImpl: async () => openAIResponse(),
      libraryClient: libraryClient({
        getProduct: async () => product({
          images: Array.from({ length: 5 }, (_, index) => ({
            ...product().images[0],
            imageId: `2222222${index}-2222-4222-8222-222222222222`,
          })),
        }),
      }),
    }),
    /Too many images/,
  );

  await assert.rejects(
    runVisionBridge({
      question: 'x'.repeat(11),
      selections: imageSelection(),
      config: config({ maxQuestionChars: 10 }),
      fetchImpl: async () => openAIResponse(),
      libraryClient: libraryClient(),
    }),
    /longer than VISION_MAX_QUESTION_CHARS/,
  );

  const limiter = createRateLimiter({ maxCalls: 1, now: () => 0 });
  assert.equal(limiter.take(), true);
  assert.equal(limiter.take(), false);
});

test('CLI parsing rejects malformed identifiers and missing values', () => {
  assert.deepEqual(parseCliArgs([
    '--question', 'What is this?',
    '--image', `${PRODUCT_ID}:${IMAGE_ID}`,
    '--product', PRODUCT_ID,
  ]), {
    question: 'What is this?',
    selections: [
      { productId: PRODUCT_ID, imageId: IMAGE_ID },
      { productId: PRODUCT_ID },
    ],
    help: false,
  });

  assert.throws(() => parseCliArgs(['--image', 'not-a-product:not-an-image']), /product UUID and image UUID/);
  assert.throws(() => parseCliArgs(['--product', 'nope']), /product UUID/);
  assert.throws(() => parseCliArgs(['--question']), /requires a value/);
  assert.throws(() => parseCliArgs(['--wat']), /Unknown argument/);
});

test('configuration rejects an invalid image detail level', () => {
  assert.throws(() => loadVisionConfig({
    OPENAI_API_KEY: API_KEY,
    OPENAI_VISION_MODEL: 'vision-test-model',
    ALVERON_LIBRARY_TOKEN: LIBRARY_TOKEN,
    VISION_IMAGE_DETAIL: 'ultra',
  }), /VISION_IMAGE_DETAIL/);
});

test('CLI errors do not echo the library token or API key', async () => {
  let stderr = '';
  const code = await main([
    '--question', 'What is shown?',
    '--image', `${PRODUCT_ID}:${IMAGE_ID}`,
  ], {
    env: {
      OPENAI_API_KEY: API_KEY,
      OPENAI_VISION_MODEL: 'vision-test-model',
      ALVERON_LIBRARY_TOKEN: LIBRARY_TOKEN,
    },
    stdout: { write: () => true },
    stderr: { write: (chunk) => { stderr += chunk; return true; } },
    libraryClient: {
      getProduct: async () => {
        throw new Error(`library failed for ${LIBRARY_TOKEN} and ${API_KEY}`);
      },
    },
  });

  assert.equal(code, 1);
  assert.match(stderr, /library failed/);
  assert.ok(!stderr.includes(LIBRARY_TOKEN));
  assert.ok(!stderr.includes(API_KEY));
});

test('detectImageMediaType recognizes JPEG, PNG and WebP magic bytes', () => {
  assert.equal(detectImageMediaType(PNG_BYTES), 'image/png');
  assert.equal(detectImageMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(detectImageMediaType(Buffer.from('RIFF0000WEBP', 'ascii')), 'image/webp');
  assert.equal(detectImageMediaType(Buffer.from('plain text')), null);
});
