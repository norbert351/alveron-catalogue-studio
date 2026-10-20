import 'server-only';

export type GenerationRequest = {
  prompt: string;
  sourceImages: Array<{
    productId: string;
    imageId: string;
    bytes: Buffer;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
    sha256: string;
  }>;
  style: string;
  occasion: string;
};

export type GeneratedImage = {
  bytes: Buffer;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
};

export interface ImageGenerationProvider {
  readonly id: string;
  generate(request: GenerationRequest): Promise<GeneratedImage>;
}

export function getImageGenerationProvider(): ImageGenerationProvider | null {
  // No provider is implemented or configured. Keep this explicit instead of returning demo art.
  return null;
}
