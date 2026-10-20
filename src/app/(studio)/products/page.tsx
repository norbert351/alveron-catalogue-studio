import { Boxes, Images, ShieldCheck } from 'lucide-react';
import { PageHeading } from '@/components/page-heading';
import { ProductUploadForm } from '@/components/product-upload-form';
import { ProductImageReview } from '@/components/product-image-review';
import { ProductManagementControls } from '@/components/product-management-controls';
import { ProductLibraryFilters } from '@/components/product-library-filters';
import { ProductImageUpload } from '@/components/product-image-upload';
import { listProducts } from '@/lib/products';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const products = await listProducts().catch(() => null);
  const imageCount = products?.reduce((sum, product) => sum + product.images.length, 0) ?? 0;
  const pendingReviews = products?.reduce((sum, product) => sum + product.images.filter((image) => !image.reviewed).length, 0) ?? 0;
  return <>
    <PageHeading eyebrow="Alveron inventory · private" title="Product library" description="The source of truth for every garment in a catalogue. Original uploads stay unchanged; only owner-uploaded products are available for styling." />
    <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
      <div className="border border-[#e3ded6] bg-white p-4 sm:p-5"><Boxes size={15} className="mb-4 text-[#b6222b]" /><p className="display-serif text-2xl">{products?.length ?? '—'}</p><p className="mt-1 text-[9px] uppercase tracking-[0.14em] text-[#938e86]">Products</p></div>
      <div className="border border-[#e3ded6] bg-white p-4 sm:p-5"><Images size={15} className="mb-4 text-[#b6222b]" /><p className="display-serif text-2xl">{imageCount}</p><p className="mt-1 text-[9px] uppercase tracking-[0.14em] text-[#938e86]">Original views</p></div>
      <div className="border border-[#e3ded6] bg-white p-4 sm:p-5"><ShieldCheck size={15} className="mb-4 text-[#b6222b]" /><p className="display-serif text-2xl">{pendingReviews}</p><p className="mt-1 text-[9px] uppercase tracking-[0.14em] text-[#938e86]">Images to review</p></div>
    </div>
    <ProductUploadForm />
    {products && products.length > 0 && <ProductLibraryFilters />}
    {products === null ? <div role="alert" className="mt-6 border border-[#e8c8c8] bg-[#fff8f6] p-5 text-[12px] text-[#8d3030]">The product library could not load. Check PostgreSQL, migrations, and storage configuration, then refresh.</div> : products.length === 0 ? <div className="mt-6 border border-dashed border-[#d7d0c6] bg-[#f8f6f2] px-6 py-16 text-center"><p className="display-serif text-2xl">Start with your own inventory.</p><p className="mx-auto mt-3 max-w-[420px] text-[11px] leading-relaxed text-[#77736d]">No products have been added yet. Upload Alveron product photos to begin. Demonstration garments are not included.</p></div> : <div className="mt-8 space-y-8">
      {products.map((product) => <section key={product.id} data-product-card data-search={`${product.name} ${product.category} ${product.color ?? ''} ${product.tags.join(' ')} ${product.sku ?? ''}`} data-category={product.category} data-status={product.availability} data-created={product.created_at.slice(0, 10)} className="border-t border-[#ded8cf] pt-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><div className="flex items-center gap-2"><h2 className="text-[14px] font-semibold">{product.name}</h2>{product.sku && <span className="text-[9px] text-[#938e86]">SKU {product.sku}</span>}</div><p className="mt-1 text-[10px] capitalize text-[#77736d]">{product.category} · {product.color || 'Colour unverified'}{product.fabric ? ` · ${product.fabric}` : ''}</p>{product.tags.length > 0 && <p className="mt-2 text-[9px] text-[#938e86]">Tags: {product.tags.join(', ')}</p>}{product.notes && <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-[#77736d]">{product.notes}</p>}<ProductManagementControls product={product} /></div>
          <span className="w-fit border border-[#e2ddd5] px-2 py-1 text-[8px] uppercase tracking-[0.12em] text-[#77736d]">{product.images.length} {product.images.length === 1 ? 'view' : 'views'}</span>
        </div>
        {product.images.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{product.images.map((image) => <ProductImageReview key={image.id} productId={product.id} imageId={image.id} width={image.width} height={image.height} label={image.view_label} initialReviewed={image.reviewed} filename={image.original_filename} mediaType={image.media_type} byteSize={image.byte_size} sha256={image.sha256} createdAt={image.created_at} current={image.current} />)}</div> : <p className="border border-dashed border-[#ded8cf] p-5 text-[10px] text-[#938e86]">This product has no accessible image views and cannot be selected for a catalogue.</p>}
        <ProductImageUpload product={product} />
      </section>)}
    </div>}
    <div className="mt-8 flex gap-3 border-t border-[#e3ded6] pt-5 text-[9px] leading-relaxed text-[#938e86]"><ShieldCheck size={14} className="shrink-0 text-[#b6222b]" /><p>Every accessible product image is shown in upload order and must be reviewed before outfit selection. Unverified garment details remain blank.</p></div>
  </>;
}
