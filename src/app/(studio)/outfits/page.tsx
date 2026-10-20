import { PageHeading } from '@/components/page-heading';
import { OutfitBuilder } from '@/components/outfit-builder';
import { allImagesReviewed, listProducts } from '@/lib/products';
import { listCatalogues } from '@/lib/catalogues';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export default async function OutfitPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const params = await searchParams;
  const [products, allReviewed, catalogues] = await Promise.all([listProducts().catch(() => []), allImagesReviewed().catch(() => false), listCatalogues().catch(() => [])]);
  const draft = z.uuid().safeParse(params.draft).success ? catalogues.find((catalogue) => catalogue.id === params.draft && ['draft', 'rejected', 'failed'].includes(catalogue.status)) : undefined;
  return <>
    <PageHeading eyebrow="Studio workflow · 02" title="Outfit builder" description="Select exact products from the reviewed inventory. Build one coherent look in one style and occasion, with the source image attached to each piece." />
    <OutfitBuilder products={products} allReviewed={allReviewed} initialDraft={draft} />
  </>;
}
