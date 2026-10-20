import { PageHeading } from '@/components/page-heading';
import { OutfitBuilder } from '@/components/outfit-builder';
import { allImagesReviewed, listProducts } from '@/lib/products';

export const dynamic = 'force-dynamic';

export default async function OutfitPage() {
  const [products, allReviewed] = await Promise.all([listProducts().catch(() => []), allImagesReviewed().catch(() => false)]);
  return <>
    <PageHeading eyebrow="Studio workflow · 02" title="Outfit builder" description="Select exact products from the reviewed inventory. Build one coherent look in one style and occasion, with the source image attached to each piece." />
    <OutfitBuilder products={products} allReviewed={allReviewed} />
  </>;
}
