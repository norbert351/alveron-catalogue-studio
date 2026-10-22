import 'server-only';
import { env } from '../config';
import { createFalKontextProvider } from './providers/fal-kontext';

export type GenerationRequest = {
  prompt: string;
  sourceImages: Array<{
    productId: string;
    imageId: string;
    bytes: Buffer;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
    sha256: string;
  }>;
  /** Optional already-extracted identifying details the prompt must preserve. */
  preservedDetails?: string[];
  style: string;
  occasion: string;
  width: number;
  height: number;
  signal: AbortSignal;
};

export type GeneratedImage = {
  bytes: Buffer;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  /** Provider-side request id, recorded so a failed job names what failed remotely. */
  providerRequestId?: string;
};

export interface ImageGenerationProvider {
  readonly id: string;
  readonly model: string;
  generate(request: GenerationRequest): Promise<GeneratedImage>;
}

/**
 * Provider registry.
 *
 * Only providers whose capability has been verified by a real request against a real
 * product image are listed here. A vision-only model must never be listed: an
 * endpoint that 404s on /v1/images/* cannot synthesise an image, and treating one as
 * a generator would produce jobs that fail after the user has waited.
 *
 * Verified inventory (2026-10-22):
 *   fal-kontext        -> fal-ai/flux-pro/kontext          image-to-image, 7/8 fidelity
 *   fal-kontext-max    -> fal-ai/flux-pro/kontext/max      image-to-image, untested variant
 */
export const IMAGE_PROVIDERS = [
  { id: 'fal-kontext', label: 'FAL · FLUX Kontext', model: 'flux-pro-kontext', source: 'FAL (queue.fal.run)', supportsReference: true, tested: '7/8 garment details preserved in controlled test' },
  { id: 'fal-kontext-max', label: 'FAL · FLUX Kontext Max', model: 'flux-pro-kontext-max', source: 'FAL (queue.fal.run)', supportsReference: true, tested: 'not measured yet — same family, higher cost' },
] as const;

export type ProviderAvailability = {
  configured: boolean;
  id: string;
  model: string | null;
  reason: string | null;
};

/** Whether the configured provider has everything it needs to run. Never throws. */
export function providerAvailability(): ProviderAvailability {
  const requested = env.IMAGE_GENERATION_PROVIDER;
  if (!requested || requested === 'none') {
    return { configured: false, id: 'none', model: null, reason: 'No image-generation provider is selected (IMAGE_GENERATION_PROVIDER=none).' };
  }
  const known = IMAGE_PROVIDERS.find((provider) => provider.id === requested);
  if (!known) {
    return { configured: false, id: requested, model: null, reason: `Unknown provider "${requested}". Known providers: ${IMAGE_PROVIDERS.map((provider) => provider.id).join(', ')}.` };
  }
  if (!env.FAL_KEY) {
    return { configured: false, id: requested, model: known.model, reason: 'FAL_KEY is not set on the server, so the provider cannot authenticate.' };
  }
  return { configured: true, id: requested, model: known.model, reason: null };
}

export function getImageGenerationProvider(): ImageGenerationProvider | null {
  const availability = providerAvailability();
  if (!availability.configured || !env.FAL_KEY) return null;
  return createFalKontextProvider({
    apiKey: env.FAL_KEY,
    model: availability.model ?? 'flux-pro-kontext',
    maxPollMs: Number(env.IMAGE_GENERATION_TIMEOUT_SECONDS || '180') * 1000,
  });
}
