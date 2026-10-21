import { Check, CircleHelp, Database, HardDrive, KeyRound, Sparkles } from 'lucide-react';
import { PageHeading } from '@/components/page-heading';
import { Eyebrow } from '@/components/page-heading';
import { env } from '@/lib/config';
import { checkDatabase } from '@/lib/db';
import type { LucideIcon } from 'lucide-react';
import { SettingsHealthCheck } from '@/components/settings-health-check';
import { loadDurabilitySnapshot } from '@/lib/durability';

export const dynamic = 'force-dynamic';

function SettingRow({ icon: Icon, title, detail, state, ready }: { icon: LucideIcon; title: string; detail: string; state: string; ready: boolean }) {
  return <div className="flex flex-col gap-3 border-b border-[#eee9e1] py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><Icon size={15} className="mt-0.5 shrink-0 text-[#b6222b]" /><div><p className="text-[11px] font-medium">{title}</p><p className="mt-1 text-[9px] leading-relaxed text-[#938e86]">{detail}</p></div></div><span className={`flex w-fit items-center gap-1.5 text-[8px] uppercase tracking-[0.12em] ${ready ? 'text-[#477047]' : 'text-[#987b4d]'}`}><span className={`size-1.5 rounded-full ${ready ? 'bg-[#62946a]' : 'bg-[#c29c5f]'}`} />{state}</span></div>;
}

export default async function SettingsPage() {
  const database = await checkDatabase();
  const storageReady = env.STORAGE_PROVIDER === 'local' || Boolean(env.S3_BUCKET && env.S3_REGION);
  const durability = database ? await loadDurabilitySnapshot().catch(() => null) : null;
  return <>
    <PageHeading eyebrow="Private studio · configuration" title="Studio settings" description="Review the local connections and safety gates. Credentials remain server-side and are never echoed into this page." />
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <section className="border border-[#e3ded6] bg-white px-5 sm:px-7"><div className="border-b border-[#eee9e1] py-5"><Eyebrow>Runtime connections</Eyebrow><h2 className="display-serif mt-2 text-[22px]">Environment status</h2></div>
        <SettingRow icon={Database} title="PostgreSQL" detail="Private product, image, session and catalogue metadata." state={database ? 'Connected' : 'Unavailable'} ready={database} />
        <SettingRow icon={HardDrive} title="Private image storage" detail={env.STORAGE_PROVIDER === 'local' ? 'Persistent local filesystem under the configured data directory; back up .local-data/private with PostgreSQL.' : 'S3-compatible private bucket. Public ACLs are never requested.'} state={storageReady ? (env.STORAGE_PROVIDER === 'local' ? 'Local mode' : 'Configured') : 'Needs bucket settings'} ready={storageReady} />
        <SettingRow icon={KeyRound} title="Session signing secret" detail="Used to hash and validate server-side session tokens; value is never displayed." state={env.SESSION_SECRET && !env.SESSION_SECRET.startsWith('replace-') ? 'Configured' : 'Missing'} ready={Boolean(env.SESSION_SECRET && !env.SESSION_SECRET.startsWith('replace-'))} />
        <SettingRow icon={Sparkles} title="Image generation" detail="No provider adapter is connected. Catalogue generation is disabled." state="Disabled · no provider" ready={false} />
        <SettingRow icon={Check} title="Owner approval before export" detail="PNG, JPEG and PDF exports require an active approval for the exact output checksum and source revision. Nothing is published." state="Server enforced" ready />
        {durability && <div className="border-b border-[#eee9e1] py-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] font-medium">Original photo durability</p><span className={`flex w-fit items-center gap-1.5 text-[8px] uppercase tracking-[0.12em] ${durability.failingIntegrity > 0 ? 'text-[#962a2e]' : 'text-[#477047]'}`}><span className={`size-1.5 rounded-full ${durability.failingIntegrity > 0 ? 'bg-[#b6222b]' : 'bg-[#62946a]'}`} />{durability.failingIntegrity > 0 ? `${durability.failingIntegrity} need attention` : 'Originals retained'}</span></div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Originals stored', String(durability.originals)],
              ['With thumbnail', `${durability.withThumbnail} / ${durability.originals}`],
              ['With preview', `${durability.withPreview} / ${durability.originals}`],
              ['Archive size', `${(durability.originalBytes / 1024 / 1024).toFixed(1)} MB`],
            ].map(([label, value]) => <div key={label} className="border border-[#eee9e1] bg-[#faf9f6] px-3 py-2"><p className="text-[8px] uppercase tracking-[0.12em] text-[#938e86]">{label}</p><p className="mt-1 font-mono text-[13px] text-[#171717]">{value}</p></div>)}
          </div>
          <p className="mt-3 text-[9px] leading-relaxed text-[#938e86]">
            Retention policy: <span className="font-medium text-[#504b46]">{durability.retentionMode === 'retain-all' ? 'retain every original indefinitely' : 'manual review before any deletion'}</span>
            {' · '}{durability.pendingDeletions} pending deletion {durability.pendingDeletions === 1 ? 'request' : 'requests'}
            {' · '}{durability.neverVerified === 0 ? 'all images checksum-verified' : `${durability.neverVerified} not yet verified`}
            {durability.lastCheckedAt ? ` · last verified ${new Date(durability.lastCheckedAt).toLocaleString()}` : ''}
          </p>
          <p className="mt-2 text-[9px] leading-relaxed text-[#938e86]">Originals are immutable and are never overwritten by a thumbnail, preview, edit or catalogue layout. Run <span className="font-mono text-[8px]">npm run storage:verify</span> to re-check every stored file against its recorded SHA-256.</p>
          {durability.failingIntegrity > 0 && <p className="mt-2 border border-[#e8c8c8] bg-[#fff8f6] p-3 text-[9px] text-[#962a2e]">At least one image did not match its recorded checksum or size during the last verification. Do not edit or export from those images until storage health is reviewed.</p>}
        </div>}
        <div className="py-4"><p className="text-[11px] font-medium">Upload and catalogue defaults</p><p className="mt-2 text-[9px] leading-relaxed text-[#938e86]">JPEG, PNG, WebP · 15 MB each · maximum 5 photos per request. Default catalogue layout: original-photo editorial, 1080 × 1350. Local filesystem storage and PostgreSQL are persistent across ordinary app rebuilds.</p><p className="mt-2 text-[9px] leading-relaxed text-[#938e86]">Session lifetime: 12 hours · HttpOnly, SameSite=Strict cookie. Owner account: one-time bootstrap; no default password.</p><SettingsHealthCheck /></div>
      </section>
      <aside className="h-fit border border-[#e3ded6] bg-white p-5"><CircleHelp size={16} className="text-[#b6222b]" /><h2 className="display-serif mt-4 text-[22px]">Local setup</h2><p className="mt-3 text-[10px] leading-[1.8] text-[#77736d]">Use the Docker PostgreSQL service and local private file storage during development. To use S3 in a deployed environment, set the server-side bucket settings in the host environment—never in browser-exposed variables.</p><div className="mt-4 border-t border-[#eee9e1] pt-4 text-[9px] leading-relaxed text-[#938e86]">Storage provider: <span className="font-medium text-[#504b46]">{env.STORAGE_PROVIDER}</span><br />Generation adapter: <span className="font-medium text-[#504b46]">none</span><br />Project setup: see README.md</div></aside>
    </div>
  </>;
}
