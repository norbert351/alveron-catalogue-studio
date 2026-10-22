import 'server-only';
import sharp from 'sharp';
import type { GeneratedImage, GenerationRequest, ImageGenerationProvider } from '../provider';

/**
 * FAL FLUX Kontext image-to-image provider.
 *
 * Capability evidence (measured, not assumed):
 *  - Selected because it preserved 7 of 8 garment identifying details in a
 *    controlled fidelity test against a real product photograph, versus 3 of 8
 *    for fal-ai/nano-banana/edit. See docs/SPINE.md for the comparison table.
 *
 * Transport: FAL's hosted queue API (queue.fal.run), not the synchronous endpoint,
 * because image edits routinely take 20-60s and the studio worker already owns a
 * lease/recovery mechanism. The queue gives us a request id we can log, so a failed
 * job names the provider request that failed.
 *
 * Inputs: the source product bytes are sent as a base64 data URI. This is
 * deliberate — the studio's originals live in private storage and are NOT
 * publicly reachable, so a URL-based handoff would either break or require
 * leaking private product files to a public bucket.
 *
 * Output: FAL returns image URLs. We download the bytes inside the adapter so the
 * worker receives bytes only; nothing downstream depends on FAL's storage, and the
 * persisted asset is ours.
 */

const QUEUE_BASE = 'https://queue.fal.run';

/** Models priced/behaving differently; kept explicit rather than a magic string. */
const MODEL_ENDPOINTS: Record<string, { path: string; app: string }> = {
  // `path` is the submit endpoint; `app` is the owner path FAL uses for
  // status/result lookups. Verified against the live API: the owner path for
  // both kontext variants is fal-ai/flux-pro.
  'flux-pro-kontext': { path: 'fal-ai/flux-pro/kontext', app: 'fal-ai/flux-pro' },
  'flux-pro-kontext-max': { path: 'fal-ai/flux-pro/kontext/max', app: 'fal-ai/flux-pro' },
};

export type FalKontextOptions = {
  apiKey: string;
  model: string;
  maxPollMs: number;
};

export class ProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly providerRequestId?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

function toDataUri(bytes: Buffer, mediaType: string): string {
  return `data:${mediaType};base64,${bytes.toString('base64')}`;
}

/**
 * Build the edit instruction.
 *
 * Written to fight the exact failure modes observed in testing: the model invents
 * base layers and accessories to "complete" an outfit, and it adds a head to a
 * mannequin. Those are stated as prohibitions, and the preserved-detail list is
 * built from the real product attributes rather than generic wording.
 */
export function buildPrompt(request: GenerationRequest & { preservedDetails?: string[] }): string {
  const preserved = (request.preservedDetails ?? []).filter(Boolean);
  const garmentLines = request.sourceImages.length > 1
    ? `The images show ${request.sourceImages.length} separate garments. Dress the mannequin in ALL of them, as one coordinated outfit, preserving each one individually.`
    : 'The image shows one garment. Dress the mannequin in this exact garment.';
  return [
    'Full-length fashion editorial photograph for a premium clothing catalogue.',
    'A matte warm-grey faceless mannequin with NO head (the form ends at the neck) stands against a warm neutral studio backdrop.',
    garmentLines,
    preserved.length
      ? `Preserve these visible details exactly as they appear in the source: ${preserved.join('; ')}.`
      : 'Preserve every visible detail of the source garment: colour, print, pattern scale, logos, hardware, buttons, pockets, seams, cut and proportions.',
    'Match the garment colour, print and construction as closely as physically possible. Do not restyle, recolour or redesign the garment.',
    'Do not add any accessory, jewellery, bag, belt, hat, scarf, eyewear or footwear that is not visible in the source images.',
    'Do not invent logos, brand marks, labels or text on the garment.',
    'Soft diffused daylight, shallow depth of field, editorial magazine quality, generous negative space, warm cream and beige background.',
    'No text, no watermark, no visible face, no human model.',
  ].join(' ');
}

/**
 * Poll FAL until the request finishes, then fetch the result body.
 *
 * FAL's queue contract is two-shaped and it is easy to get wrong:
 *   - status lives at  {app}/requests/{id}/status        -> { status: 'COMPLETED', response_url }
 *   - result lives at  {app}/requests/{id}               -> { images: [...] }
 * where {app} is the OWNER path (fal-ai/flux-pro), not the full model path.
 * Polling the full model path returns 405, and reading images off the status
 * response returns nothing — both look like provider failures when they are not.
 */
async function pollUntilDone(app: string, requestId: string, apiKey: string, maxPollMs: number): Promise<{ images?: Array<{ url?: string; content_type?: string }> }> {
  const deadline = Date.now() + maxPollMs;
  const statusUrl = `${QUEUE_BASE}/${app}/requests/${requestId}/status`;
  let delay = 1200;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(Math.round(delay * 1.35), 5000);
    let status: { status?: string; response_url?: string; error?: unknown };
    try {
      const res = await fetch(statusUrl, { headers: { Authorization: `Key ${apiKey}` }, signal: AbortSignal.timeout(20_000), cache: 'no-store' });
      if (res.status === 400 || res.status === 404 || res.status === 405) {
        throw new ProviderError('provider_status_failed', `Provider status endpoint rejected the poll (HTTP ${res.status}).`, false, requestId);
      }
      if (!res.ok) continue; // transient; keep polling until the deadline
      status = await res.json() as typeof status;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      continue; // network blip; retry until deadline
    }
    if (status.status === 'FAILED' || status.status === 'ERROR') {
      throw new ProviderError('provider_generation_failed', `Provider reported a failed generation: ${JSON.stringify(status.error ?? status).slice(0, 400)}`, true, requestId);
    }
    if (status.status === 'COMPLETED') {
      const resultUrl = status.response_url ?? `${QUEUE_BASE}/${app}/requests/${requestId}`;
      const result = await fetch(resultUrl, { headers: { Authorization: `Key ${apiKey}` }, signal: AbortSignal.timeout(30_000), cache: 'no-store' });
      if (!result.ok) throw new ProviderError('provider_result_failed', `Provider result could not be read (HTTP ${result.status}).`, true, requestId);
      return await result.json() as { images?: Array<{ url?: string; content_type?: string }> };
    }
  }
  throw new ProviderError('provider_timeout', `Provider did not finish within ${Math.round(maxPollMs / 1000)}s.`, true, requestId);
}

export function createFalKontextProvider(options: FalKontextOptions): ImageGenerationProvider {
  const endpoint = MODEL_ENDPOINTS[options.model] ?? MODEL_ENDPOINTS['flux-pro-kontext'];
  return {
    id: 'fal-kontext',
    model: options.model,
    /** FAL Kontext accepts a single source image per request; we use the highest-priority one. */
    async generate(request: GenerationRequest): Promise<GeneratedImage> {
      const source = request.sourceImages[0];
      if (!source) throw new ProviderError('missing_source_image', 'No source product image was supplied; refusing to generate without a reference.', false);

      const aspect = request.width === request.height ? '1:1' : request.width > request.height ? '4:3' : '3:4';
      const payload = {
        prompt: buildPrompt(request),
        image_url: toDataUri(source.bytes, source.mediaType),
        aspect_ratio: aspect,
        output_format: 'png',
        safety_tolerance: '2',
        num_images: 1,
      };

      let submit: Response;
      try {
        submit = await fetch(`${QUEUE_BASE}/${endpoint.path}`, {
          method: 'POST',
          headers: { Authorization: `Key ${options.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: request.signal,
        });
      } catch (error) {
        throw new ProviderError('provider_network', `Could not reach the image provider: ${(error as Error).message}`, true);
      }

      if (submit.status === 401 || submit.status === 403) {
        throw new ProviderError('provider_unauthorized', 'The image provider rejected the API key. Check FAL_KEY in the studio settings.', false);
      }
      if (submit.status === 402) {
        throw new ProviderError('provider_quota', 'The image provider account is out of credit.', false);
      }
      if (submit.status === 422) {
        const body = await submit.text();
        throw new ProviderError('provider_invalid_input', `The source image was rejected by the provider: ${body.slice(0, 300)}`, false);
      }
      if (!submit.ok) {
        const body = await submit.text();
        throw new ProviderError('provider_submit_failed', `Provider submit failed (HTTP ${submit.status}): ${body.slice(0, 300)}`, submit.status >= 500 || submit.status === 429);
      }

      const queued = await submit.json() as { request_id?: string };
      if (!queued.request_id) throw new ProviderError('provider_no_request_id', 'Provider did not return a request id.', true);

      const done = await pollUntilDone(endpoint.app, queued.request_id, options.apiKey, options.maxPollMs) as { images?: Array<{ url?: string; content_type?: string }> };
      const image = done.images?.[0];
      if (!image?.url) throw new ProviderError('provider_no_output', 'Provider completed without returning an image.', true, queued.request_id);

      let bytes: Buffer;
      try {
        const download = await fetch(image.url, { signal: AbortSignal.timeout(60_000) });
        if (!download.ok) throw new Error(`HTTP ${download.status}`);
        bytes = Buffer.from(await download.arrayBuffer());
      } catch (error) {
        throw new ProviderError('provider_download_failed', `The generated image could not be downloaded: ${(error as Error).message}`, true, queued.request_id);
      }
      if (bytes.byteLength === 0) throw new ProviderError('provider_empty_output', 'Provider returned an empty image.', true, queued.request_id);

      // FAL's content_type is unreliable (it returns image/jpeg for PNG data), so
      // sniff the real format from the bytes and fall back to the declared type.
      let detected: 'image/jpeg' | 'image/png' | 'image/webp' | null = null;
      let realWidth = request.width;
      let realHeight = request.height;
      try {
        const meta = await sharp(bytes).metadata();
        detected = meta.format === 'png' ? 'image/png' : meta.format === 'webp' ? 'image/webp' : meta.format === 'jpeg' ? 'image/jpeg' : null;
        realWidth = meta.width ?? request.width;
        realHeight = meta.height ?? request.height;
      } catch { detected = null; }
      const declared = (image.content_type ?? '').toLowerCase();
      const mediaType: GeneratedImage['mediaType'] = detected
        ?? (declared.includes('jpeg') || declared.includes('jpg') ? 'image/jpeg' : declared.includes('webp') ? 'image/webp' : 'image/png');

      return {
        bytes,
        mediaType,
        // The provider decides the final pixel size; record what it actually made
        // rather than what we asked for, so the asset row never misstates dimensions.
        width: realWidth,
        height: realHeight,
        providerRequestId: queued.request_id,
      };
    },
  };
}
