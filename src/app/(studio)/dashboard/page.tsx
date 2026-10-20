import Link from 'next/link';
import { ArrowRight, ArrowUpRight, BadgeCheck, Boxes, Images, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { Eyebrow, PageHeading } from '@/components/page-heading';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  let stats = { products: 0, images: 0, drafts: 0, pendingReview: 0 };
  let databaseReady = true;
  try {
    const [products, images, drafts, pending] = await Promise.all([
      getPool().query('SELECT count(*)::int AS count FROM products'),
      getPool().query('SELECT count(*)::int AS count FROM product_images'),
      getPool().query("SELECT count(*)::int AS count FROM catalogues WHERE status IN ('draft','queued','review')"),
      getPool().query('SELECT count(*)::int AS count FROM product_images i LEFT JOIN product_image_reviews r ON r.product_image_id=i.id WHERE r.product_image_id IS NULL'),
    ]);
    stats = { products: products.rows[0].count, images: images.rows[0].count, drafts: drafts.rows[0].count, pendingReview: pending.rows[0].count };
  } catch { databaseReady = false; }
  return <>
    <PageHeading eyebrow="Private workspace · Alveron Fashion" title="A catalogue, considered." description="Build premium menswear editorials from the pieces you actually have. Every garment starts with your original product photographs." action={<Link href="/products" className="flex h-10 items-center gap-2 bg-[#171717] px-4 text-[10px] font-medium text-white hover:bg-[#b6222b]"><Plus size={14} /> Add products</Link>} />
    {!databaseReady && <div role="alert" className="mb-6 border border-[#e8d7bb] bg-[#fffaf1] p-4 text-[11px] leading-relaxed text-[#856d43]">The studio database is unavailable. Start the local PostgreSQL service and run the migration steps in README.md.</div>}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[[Boxes, 'Product records', stats.products], [Images, 'Original product views', stats.images], [Sparkles, 'Outfit drafts', stats.drafts], [ShieldCheck, 'Images to review', stats.pendingReview]].map(([Icon, label, value]) => { const Component = Icon as typeof Boxes; return <div key={label as string} className="border border-[#e3ded6] bg-white p-5"><div className="flex items-center justify-between"><Eyebrow>{label as string}</Eyebrow><Component size={15} className="text-[#b6222b]" /></div><p className="display-serif mt-6 text-[34px]">{value as number}</p></div>; })}
    </section>
    <section className="mt-8 grid gap-6 xl:grid-cols-[1fr_340px]">
      <div className="overflow-hidden border border-[#e3ded6] bg-white">
        <div className="flex items-end justify-between border-b border-[#eee9e1] p-5"><div><Eyebrow>Creation desk</Eyebrow><h2 className="display-serif mt-2 text-[24px]">From inventory to editorial.</h2></div><Link href="/outfits" className="hidden items-center gap-2 text-[10px] text-[#b6222b] sm:flex">Open outfit builder <ArrowRight size={13} /></Link></div>
        <div className="grid min-h-[300px] items-center gap-8 bg-[#eae5dd] p-6 sm:grid-cols-[0.9fr_1.1fr] sm:p-9">
          <div className="relative mx-auto flex aspect-[0.76] w-full max-w-[220px] items-center justify-center overflow-hidden border border-[#d7d0c6] bg-[#f3f0eb]">
            <span className="absolute left-3 top-3 text-[8px] uppercase tracking-[0.18em] text-[#928b81]">Layout study · empty</span>
            <svg aria-label="Blank faceless mannequin layout placeholder" role="img" viewBox="0 0 210 280" className="h-[78%] w-[78%] text-[#c8c1b7]" fill="none"><circle cx="105" cy="37" r="22" stroke="currentColor" strokeWidth="1.5"/><path d="M83 68c-19 3-32 12-38 29l-22 69m104-98c19 3 32 12 38 29l22 69M73 97l8 65-8 91m64-156-8 65 8 91M82 75l23-9 23 9 18 70-20 12H84l-20-12 18-70Z" stroke="currentColor" strokeWidth="1.5"/><path d="M105 66v91m-21-47 21 14 21-14M82 232h46" stroke="currentColor" strokeWidth="1" strokeDasharray="3 4"/></svg>
            <span className="absolute bottom-3 left-3 right-3 border-t border-[#d7d0c6] pt-2 text-center text-[7px] uppercase tracking-[0.2em] text-[#a19a90]">No garment or output generated</span>
          </div>
          <div><p className="text-[9px] uppercase tracking-[0.22em] text-[#b6222b]">The Alveron standard</p><h3 className="display-serif mt-3 text-3xl leading-tight">Every detail begins<br className="hidden sm:block" /> with the source.</h3><p className="mt-4 max-w-[350px] text-[11px] leading-[1.8] text-[#746f69]">Review all product views, choose a single outfit direction, and keep the original product photography beside the editorial composition.</p><Link href={stats.products ? '/outfits' : '/products'} className="mt-6 inline-flex h-9 items-center gap-2 border border-[#171717] px-3 text-[9px] font-semibold">{stats.products ? 'Build an outfit' : 'Add first products'} <ArrowUpRight size={12} /></Link></div>
        </div>
      </div>
      <aside className="border border-[#e3ded6] bg-white p-5">
        <Eyebrow>Studio sequence</Eyebrow><h2 className="display-serif mt-2 text-[22px]">A clear review path.</h2>
        <ol className="mt-6 space-y-5">{[['01', 'Review the library', 'Inspect each original image, old and new alike.'], ['02', 'Compose one look', 'Select verified pieces, role by role.'], ['03', 'Review the draft', 'Compare the catalogue with its sources.'], ['04', 'Approve to export', 'Nothing leaves the studio automatically.']].map(([number, title, detail]) => <li key={number} className="flex gap-3"><span className="pt-0.5 text-[9px] tracking-[0.15em] text-[#b6222b]">{number}</span><div><p className="text-[11px] font-medium">{title}</p><p className="mt-1 text-[9px] leading-relaxed text-[#938e86]">{detail}</p></div></li>)}</ol>
        <Link href="/products" className="mt-7 flex items-center justify-between border-t border-[#eee9e1] pt-4 text-[10px] font-medium">Product Library <ArrowRight size={13} className="text-[#b6222b]" /></Link>
      </aside>
    </section>
    <div className="mt-7 flex items-start gap-3 border border-[#e3ded6] bg-[#faf9f6] p-4"><BadgeCheck size={15} className="mt-0.5 shrink-0 text-[#b6222b]" /><p className="text-[10px] leading-relaxed text-[#77736d]">Studio safeguard: image generation and catalogue export are disabled until their required setup and human review are complete. This screen is a layout placeholder, not a generated catalogue.</p></div>
  </>;
}
