import { Check, Database, HardDrive, KeyRound } from 'lucide-react';
import { PageHeading, Eyebrow } from '@/components/page-heading';
import { env } from '@/lib/config';
import { checkDatabase, getPool } from '@/lib/db';
import { SettingsHealthCheck } from '@/components/settings-health-check';
import { LibraryTokens } from '@/components/library-tokens';

export const dynamic = 'force-dynamic';

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function Row({ icon: Icon, title, detail, state, ready }: { icon: typeof Check; title: string; detail: string; state: string; ready: boolean }) {
  return <div className="flex flex-col gap-3 border-b border-[#eee9e1] py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex gap-3">
      <Icon size={15} className="mt-0.5 shrink-0 text-[#b6222b]" />
      <div><p className="text-[11px] font-medium">{title}</p><p className="mt-1 text-[9px] leading-relaxed text-[#938e86]">{detail}</p></div>
    </div>
    <span className={`flex w-fit items-center gap-1.5 text-[8px] uppercase tracking-[0.12em] ${ready ? 'text-[#477047]' : 'text-[#987b4d]'}`}>
      <span className={`size-1.5 rounded-full ${ready ? 'bg-[#62946a]' : 'bg-[#c29c5f]'}`} />{state}
    </span>
  </div>;
}

export default async function SettingsPage() {
  const database = await checkDatabase();
  const storageReady = env.STORAGE_PROVIDER === 'local' || Boolean(env.S3_BUCKET && env.S3_REGION);

  let library = { products: 0, images: 0, originalBytes: 0, derivativeBytes: 0, pendingUploads: 0, failedUploads: 0 };
  let disk: { totalBytes: number; freeBytes: number } | null = null;
  if (database) {
    const counts = await getPool().query(`
      SELECT (SELECT count(*) FROM products WHERE availability <> 'archived')::int AS products,
             (SELECT count(*) FROM product_images)::int AS images,
             (SELECT COALESCE(sum(byte_size),0) FROM product_images)::bigint AS original_bytes,
             (SELECT COALESCE(sum(byte_size),0) FROM product_image_derivatives)::bigint AS derivative_bytes`).catch(() => null);
    if (counts?.rows[0]) {
      library = {
        products: Number(counts.rows[0].products ?? 0), images: Number(counts.rows[0].images ?? 0),
        originalBytes: Number(counts.rows[0].original_bytes ?? 0), derivativeBytes: Number(counts.rows[0].derivative_bytes ?? 0),
        pendingUploads: 0, failedUploads: 0,
      };
    }
    if (env.STORAGE_PROVIDER === 'local') {
      try {
        const { statfs } = await import('node:fs/promises');
        const stats = await statfs(process.cwd());
        disk = { totalBytes: Number(stats.blocks) * Number(stats.bsize), freeBytes: Number(stats.bavail) * Number(stats.bsize) };
      } catch { disk = null; }
    }
  }

  return <>
    <PageHeading eyebrow="Private library · configuration" title="Settings & access" description="Storage health, capacity and the read-only token ChatGPT uses to retrieve original images. Credentials stay server-side and are never shown." />
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-6">
        <section className="border border-[#e3ded6] bg-white px-5 sm:px-7">
          <div className="border-b border-[#eee9e1] py-5"><Eyebrow>Runtime</Eyebrow><h2 className="display-serif mt-2 text-[22px]">Storage and database</h2></div>
          <Row icon={Database} title="PostgreSQL" detail="Product records, image metadata and sessions." state={database ? 'Connected' : 'Unavailable'} ready={database} />
          <Row icon={HardDrive} title="Private image storage" detail={env.STORAGE_PROVIDER === 'local' ? 'Originals on the local disk, outside public/. Back this up together with PostgreSQL.' : 'Private S3-compatible bucket. Public access stays blocked.'} state={storageReady ? (env.STORAGE_PROVIDER === 'local' ? 'Local, private' : 'S3, private') : 'Incomplete settings'} ready={storageReady} />
          <Row icon={KeyRound} title="Owner login" detail="Required. Uploads, edits and deletes are only possible after signing in, so the library cannot be changed by an unauthorised visitor." state="Enforced" ready />

          <div className="border-b border-[#eee9e1] py-5">
            <p className="text-[11px] font-medium">Library capacity</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Products', String(library.products)],
                ['Images', String(library.images)],
                ['Originals', bytes(library.originalBytes)],
                ['Previews', bytes(library.derivativeBytes)],
              ].map(([label, value]) => <div key={label} className="border border-[#eee9e1] bg-[#faf9f6] px-3 py-2">
                <p className="text-[7px] uppercase tracking-[0.1em] text-[#938e86]">{label}</p>
                <p className="mt-1 font-mono text-[12px]">{value}</p>
              </div>)}
            </div>
            {disk ? <p className="mt-3 text-[9px] leading-relaxed text-[#938e86]">
              Disk: <span className="font-mono">{bytes(disk.freeBytes)}</span> free of <span className="font-mono">{bytes(disk.totalBytes)}</span>.
              Per-file limit 15 MB, up to 5 images per upload. There is no cap on the number of products — the only limit is the free space above.
            </p> : <p className="mt-3 text-[9px] leading-relaxed text-[#938e86]">
              Per-file limit 15 MB, up to 5 images per upload. No product-count cap. Free space is not reported for this storage backend.
            </p>}
          </div>

          <Row icon={Check} title="Original preservation" detail="Every upload is stored under its own immutable key and re-checksummed (SHA-256) on every read. Thumbnails live under a separate derivatives/ prefix, so they can never overwrite an original." state="Server enforced" ready />
        </section>

        <LibraryTokens />
      </div>

      <div className="flex flex-col gap-6">
        <SettingsHealthCheck />
        <section className="border border-[#e3ded6] bg-white p-5">
          <Eyebrow>How ChatGPT connects</Eyebrow>
          <ol className="mt-3 flex flex-col gap-3 text-[10px] leading-relaxed text-[#5c5850]">
            <li><span className="font-medium text-[#171717]">1.</span> Create a token above and copy it.</li>
            <li><span className="font-medium text-[#171717]">2.</span> In ChatGPT, add a connector / custom action pointing at this server&apos;s public URL.</li>
            <li><span className="font-medium text-[#171717]">3.</span> Set the Authorization header to <code className="bg-[#f4f1ea] px-1 font-mono text-[9px]">Bearer alv_lib_…</code></li>
            <li><span className="font-medium text-[#171717]">4.</span> ChatGPT calls <code className="bg-[#f4f1ea] px-1 font-mono text-[9px]">/api/library/search</code>, then the <code className="bg-[#f4f1ea] px-1 font-mono text-[9px]">originalUrl</code> it returns.</li>
          </ol>
          <p className="mt-3 border-t border-[#eee9e1] pt-3 text-[9px] leading-relaxed text-[#938e86]">
            ChatGPT needs a reachable HTTPS address. It cannot read localhost, a LAN address or files on this machine, so the server must be exposed through a tunnel or a deployment before the connector will work.
          </p>
        </section>
      </div>
    </div>
  </>;
}
