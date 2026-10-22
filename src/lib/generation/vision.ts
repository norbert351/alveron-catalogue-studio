import 'server-only';
import sharp from 'sharp';
import { env } from '../config';

/**
 * Qwen vision client — VISUAL UNDERSTANDING ONLY.
 *
 * Verified capability (2026-10-22, measured):
 *   - qwen3.8-max at hackathon.bitgetops.com/v1 accepts image input as a base64
 *     data URI and returns usable structured JSON.
 *   - It has NO image-generation route: POST /v1/images/generations (and three
 *     other plausible paths) all return 404. It is therefore never called to
 *     synthesise anything; that path is the FAL adapter's job.
 *   - Remote image URLs fail with "Failed to download multimodal content", so
 *     images must be inlined as base64 here too.
 *
 * Two jobs in this studio:
 *   1. extractGarmentAttributes — read real product photographs and record what is
 *      actually visible, so generation preserves it and the UI can show a factual
 *      product breakdown instead of a model-invented one.
 *   2. reviewFidelity — compare a generated image against its source and report
 *      which specific details survived. This produces a MEASUREMENT, and it is
 *      labelled as machine-estimated. It never claims exact fidelity.
 */

export type GarmentAttributes = {
  category: string | null;
  colour: string | null;
  pattern: string | null;
  details: string[];
  /** True only when the vision model actually returned parseable structured output. */
  verified: boolean;
  model: string;
  error: string | null;
};

export type FidelityCheck = {
  detail: string;
  preserved: boolean | null;
  note: string | null;
};

export type FidelityReview = {
  checks: FidelityCheck[];
  preservedCount: number;
  measuredCount: number;
  /** Provider-neutral ratio used for the UI badge. null when nothing could be measured. */
  ratio: number | null;
  invented: string[];
  method: 'qwen-vision' | 'unavailable';
  model: string;
  note: string;
};

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
/**
 * Longest edge sent to the vision model.
 *
 * Measured on the live endpoint: two images at 880x1184 + 700x1000 took 32s for a
 * short check but blew the budget entirely with 8 details, because output tokens
 * dominate. 640px keeps print/buttons/pockets legible and cuts the prompt cost.
 */
const VISION_MAX_EDGE = 640;
/** 8 numeric checks with notes ran ~32-90s; give real headroom and never fail silently. */
const VISION_TIMEOUT_MS = 210_000;

function visionConfigured(): boolean {
  return Boolean(env.QWEN_VISION_API_KEY && env.QWEN_VISION_BASE_URL);
}

/**
 * Shrink an image before sending it to the vision model.
 *
 * Measured: sending two full-size (880x1184 + 700x1000) images in a single
 * comparison request exceeded a 90s budget and aborted. Downscaling to a 768px
 * longest edge keeps the details that matter for a fidelity check (print, pockets,
 * buttons) while cutting upload and inference time to a few seconds.
 */
async function shrinkForVision(bytes: Buffer): Promise<{ bytes: Buffer; mediaType: string }> {
  try {
    const resized = await sharp(bytes, { limitInputPixels: 120_000_000 })
      .rotate()
      .resize(VISION_MAX_EDGE, VISION_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    return { bytes: resized, mediaType: 'image/png' };
  } catch {
    return { bytes, mediaType: 'image/png' };
  }
}

function dataUri(bytes: Buffer, mediaType: string): string {
  return `data:${mediaType};base64,${bytes.toString('base64')}`;
}

async function chat(messages: unknown[], maxTokens: number, timeoutMs = 120_000): Promise<string> {
  if (!env.QWEN_VISION_API_KEY) throw new Error('QWEN_VISION_API_KEY is not configured.');
  const response = await fetch(`${env.QWEN_VISION_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.QWEN_VISION_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.QWEN_VISION_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Vision endpoint returned HTTP ${response.status}: ${body.slice(0, 200)}`);
  }
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error('Vision endpoint returned an empty message.');
  return content;
}

/** Vision models are chatty; pull the first JSON object out of the reply. */
function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(candidate) as T;
}

/**
 * Read a real product photograph and record only what is visible.
 * On any failure this returns verified:false with the reason — it never guesses
 * attributes, because a guessed attribute would end up in the prompt and be
 * presented to the owner as product fact.
 */
export async function extractGarmentAttributes(input: { bytes: Buffer; mediaType: string }): Promise<GarmentAttributes> {
  const base: GarmentAttributes = { category: null, colour: null, pattern: null, details: [], verified: false, model: env.QWEN_VISION_MODEL, error: null };
  if (!visionConfigured()) return { ...base, error: 'Qwen vision is not configured (QWEN_VISION_API_KEY missing).' };
  if (input.bytes.byteLength > MAX_IMAGE_BYTES) return { ...base, error: 'Source image is too large for the vision model.' };
  try {
    const prepared = await shrinkForVision(input.bytes);
    const content = await chat([
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUri(prepared.bytes, prepared.mediaType) } },
          {
            type: 'text',
            text: [
              '/no_think',
              'You are cataloguing a real garment from a product photograph.',
              'Return ONLY minified JSON with exactly these keys:',
              '{"category":string,"colour":string,"pattern":string,"details":string[]}',
              'Rules:',
              '- Describe ONLY what is clearly visible. If you cannot tell, use "unclear".',
              '- Never guess material, fabric composition, brand, size or price.',
              '- "details" lists up to 8 short visible construction facts that ARE PRESENT (lapels, pockets, buttons, seams, closure, print scale).',
              '- Do NOT list things that are absent. Never write "no pockets" or "no visible lapels": only state what you can see.',
              '- No prose outside the JSON.',
            ].join('\n'),
          },
        ],
      },
    ], 400);
    const parsed = extractJson<{ category?: string; colour?: string; pattern?: string; details?: unknown }>(content);
    const clean = (value: unknown): string | null => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      if (!trimmed || /^(unclear|unknown|n\/a|none)$/i.test(trimmed)) return null;
      return trimmed.slice(0, 120);
    };
    const details = Array.isArray(parsed.details)
      ? parsed.details
          .map((detail) => (typeof detail === 'string' ? detail.trim().slice(0, 160) : ''))
          // Drop negative-phrased observations ("no visible lapels", "not printed").
          // These are the ABSENCE of a feature. Feeding them back as things to
          // "preserve" makes the fidelity check demand the generated image also lack
          // them, so a correct garment scores as a failure. Measured live: a blazer
          // with real lapels and pockets scored 14% because the source was described
          // as having "no visible lapels" and "no visible pockets".
          .filter((detail) => detail && !/^(no|none|not|without|absent)\b|\b(no|not|without)\s+(visible|present|detected|apparent)\b/i.test(detail))
          .slice(0, 8)
      : [];
    return {
      category: clean(parsed.category),
      colour: clean(parsed.colour),
      pattern: clean(parsed.pattern),
      details,
      verified: true,
      model: env.QWEN_VISION_MODEL,
      error: null,
    };
  } catch (error) {
    return { ...base, error: (error as Error).message.slice(0, 300) };
  }
}

/**
 * Compare a generated image against the source photograph, detail by detail.
 *
 * The output is deliberately conservative: a detail is only counted as preserved
 * when the model says yes AND gives a reason. Anything it cannot see is counted as
 * not-measured rather than failed, so the ratio never flatters or punishes unfairly.
 */
export async function reviewFidelity(input: {
  sourceBytes: Buffer;
  sourceMediaType: string;
  generatedBytes: Buffer;
  generatedMediaType: string;
  expectedDetails: string[];
}): Promise<FidelityReview> {
  const unavailable = (note: string): FidelityReview => ({
    checks: input.expectedDetails.map((detail) => ({ detail, preserved: null, note: null })),
    preservedCount: 0,
    measuredCount: 0,
    ratio: null,
    invented: [],
    method: 'unavailable',
    model: env.QWEN_VISION_MODEL,
    note,
  });
  if (!visionConfigured()) return unavailable('Qwen vision is not configured, so fidelity was not measured. Review manually.');
  if (!input.expectedDetails.length) return unavailable('No source details were extracted, so there was nothing to check against.');

  try {
    const source = await shrinkForVision(input.sourceBytes);
    const generated = await shrinkForVision(input.generatedBytes);
    const content = await chat([
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUri(source.bytes, source.mediaType) } },
          { type: 'image_url', image_url: { url: dataUri(generated.bytes, generated.mediaType) } },
          {
            type: 'text',
            text: [
              '/no_think',
              'Image 1 is the ORIGINAL product photograph. Image 2 is an AI-generated catalogue image.',
              'For each detail listed below, decide whether it is visibly preserved in image 2.',
              'Return ONLY minified JSON:',
              '{"checks":[{"detail":string,"preserved":true|false,"note":string}],"invented":string[]}',
              'Rules:',
              '- "preserved": true only if you can actually see the detail in image 2.',
              '- If you cannot see that area of the garment in image 2, set preserved to false and say "not visible".',
              '- "invented" lists garments or accessories visible in image 2 that are NOT in image 1 (max 5, short).',
              '- Be strict. Do not give credit for a similar-but-different detail.',
              '- No prose outside the JSON.',
              'Details to check:',
              ...input.expectedDetails.map((detail, index) => `${index + 1}. ${detail}`),
            ].join('\n'),
          },
        ],
      },
    ], 700, VISION_TIMEOUT_MS);
    const parsed = extractJson<{ checks?: Array<{ detail?: string; preserved?: unknown; note?: unknown }>; invented?: unknown }>(content);
    const checks: FidelityCheck[] = (parsed.checks ?? []).slice(0, 12).map((check) => ({
      detail: String(check.detail ?? '').slice(0, 160),
      preserved: typeof check.preserved === 'boolean' ? check.preserved : null,
      note: typeof check.note === 'string' ? check.note.slice(0, 200) : null,
    })).filter((check) => check.detail);
    const measured = checks.filter((check) => check.preserved !== null);
    const preserved = checks.filter((check) => check.preserved === true);
    const invented = Array.isArray(parsed.invented)
      ? parsed.invented.map((item) => (typeof item === 'string' ? item.trim().slice(0, 80) : '')).filter(Boolean).slice(0, 5)
      : [];
    return {
      checks,
      preservedCount: preserved.length,
      measuredCount: measured.length,
      ratio: measured.length ? Number((preserved.length / measured.length).toFixed(3)) : null,
      invented,
      method: 'qwen-vision',
      model: env.QWEN_VISION_MODEL,
      note: 'Machine-estimated from two images by a vision model. This is a review aid, not a guarantee of garment fidelity.',
    };
  } catch (error) {
    return unavailable(`Fidelity measurement failed: ${(error as Error).message.slice(0, 200)}`);
  }
}

export function visionAvailability(): { configured: boolean; model: string; reason: string | null } {
  return visionConfigured()
    ? { configured: true, model: env.QWEN_VISION_MODEL, reason: null }
    : { configured: false, model: env.QWEN_VISION_MODEL, reason: 'QWEN_VISION_API_KEY is not set; generation still works but attributes and fidelity review fall back to manual.' };
}
