import { Boxes, Images, ShieldCheck } from 'lucide-react';
import { PageHeading } from '@/components/page-heading';
import { ProductUploadForm } from '@/components/product-upload-form';
import { ProductImageTile } from '@/components/product-image-tile';
import { ProductManagementControls } from '@/components/product-management-controls';
import { ProductLibraryFilters } from '@/components/product-library-filters';
import { ProductImageUpload } from '@/components/product-image-upload';
import { Pagination } from '@/components/pagination';
import { listProductsPaged } from '@/lib/products';
import { countUnreviewedImages, parsePageRequest } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const single = (key: string): string | undefined => { const value = params[key]; return Array.isArray(value) ? value[0] : value; };
  const paging = parsePageRequest({ page: single('page'), pageSize: single('pageSize') });
  const filters = {
    page: paging.page,
    pageSize: paging.pageSize,
    availability: single('availability') || undefined,
    uploadedFrom: single('uploadedFrom') || undefined,
    uploadedThrough: single('uploadedThrough') || undefined,
  };

  const result = await listProductsPaged(filters).catch(() => null);
  const products = result?.products ?? null;
  const total = result?.total ?? 0;
  // Counts are global, not per page: the review gate must reflect the whole library.
  const pendingReviews = await countUnreviewedImages().catch(() => 0);
  const imageCount = products?.reduce((sum, product) => sum + product.images.length, 0) ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / paging.pageSize));
  const hasFilters = Boolean(filters.availability || filters.uploadedFrom || filters.uploadedThrough);
  return <>
    <PageHeading eyebrow="Alveron inventory · private" title="Product library" description="A picture-first source of truth for every garment in the catalogue. Original uploads stay unchanged." />
    <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
      <div className="border border-[#e3ded6] bg-white p-4 sm:p-5"><Boxes size={15} className="mb-4 text-[#b6222b]" /><p className="display-serif text-2xl">{result ? total : '—'}</p><p className="mt-1 text-[9px] uppercase tracking-[0.14em] text-[#938e86]">{hasFilters ? 'Matching products' : 'Products'}</p></div>
      <div className="border border-[#e3ded6] bg-white p-4 sm:p-5"><Images size={15} className="mb-4 text-[#b6222b]" /><p className="display-serif text-2xl">{imageCount}</p><p className="mt-1 text-[9px] uppercase tracking-[0.14em] text-[#938e86]">Original views {totalPages > 1 ? '(this page)' : ''}</p></div>
      <div className="border border-[#e3ded6] bg-white p-4 sm:p-5"><ShieldCheck size={15} className="mb-4 text-[#b6222b]" /><p className="display-serif text-2xl">{pendingReviews}</p><p className="mt-1 text-[9px] uppercase tracking-[0.14em] text-[#938e86]">Images to review (all pages)</p></div>
    </div>
    <ProductUploadForm />
    {products && total > 0 && <ProductLibraryFilters />}
    {products === null ? <div role="alert" className="mt-6 border border-[#e8c8c8] bg-[#fff8f6] p-5 text-[12px] text-[#8d3030]">The product library could not load. Check PostgreSQL, migrations, and storage configuration, then refresh.</div> : products.length === 0 ? (hasFilters
      ? <div className="mt-6 border border-dashed border-[#d7d0c6] bg-[#f8f6f2] px-6 py-14 text-center"><p className="display-serif text-2xl">No products match these filters.</p><p className="mx-auto mt-3 max-w-[420px] text-[11px] leading-relaxed text-[#77736d]">Nothing is hidden permanently — clearing the filters restores the full library.</p><a href="/products" className="mt-5 inline-flex items-center gap-2 border border-[#171717] px-3 py-2 text-[9px]">Clear filters</a></div>
      : <div className="mt-6 border border-dashed border-[#d7d0c6] bg-[#f8f6f2] px-6 py-16 text-center"><p className="display-serif text-2xl">Start with your own inventory.</p><p className="mx-auto mt-3 max-w-[420px] text-[11px] leading-relaxed text-[#77736d]">No products have been added yet. Upload Alveron product photos to begin. Demonstration garments are not included.</p></div>) : <div className="mt-8 space-y-8">
      {products.map((product) => <section key={product.id} data-product-card data-status={product.availability} data-created={product.created_at.slice(0, 10)} className="border-t border-[#ded8cf] pt-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ProductManagementControls product={product} />
          <span className="w-fit border border-[#e2ddd5] px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-[#77736d]">{product.images.length} {product.images.length === 1 ? 'view' : 'views'}</span>
        </div>
        {product.images.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{product.images.map((image) => <ProductImageTile key={image.id} productId={product.id} imageId={image.id} width={image.width} height={image.height} label={image.view_label} filename={image.original_filename} mediaType={image.media_type} byteSize={image.byte_size} sha256={image.sha256} hasThumbnail={image.has_thumbnail} />)}</div> : <p className="border border-dashed border-[#ded8cf] p-5 text-[10px] text-[#938e86]">This product has no viewable image.</p>}
        <ProductImageUpload product={product} />
      </section>)}
      <Pagination page={paging.page} totalPages={totalPages} total={total} pageSize={paging.pageSize} query={{ availability: filters.availability, uploadedFrom: filters.uploadedFrom, uploadedThrough: filters.uploadedThrough }} />
    </div>}
    <div className="mt-8 flex gap-3 border-t border-[#e3ded6] pt-5 text-[9px] leading-relaxed text-[#938e86]"><ShieldCheck size={14} className="shrink-0 text-[#b6222b]" /><p>Every accessible product image is shown in upload order and must be reviewed before outfit selection.</p></div>
  </>;
}
