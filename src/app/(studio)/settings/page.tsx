import { Check, CircleHelp, Database, HardDrive, KeyRound, Sparkles } from 'lucide-react';
import { PageHeading } from '@/components/page-heading';
import { Eyebrow } from '@/components/page-heading';
import { env } from '@/lib/config';
import { checkDatabase } from '@/lib/db';
import type { LucideIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

function SettingRow({ icon: Icon, title, detail, state, ready }: { icon: LucideIcon; title: string; detail: string; state: string; ready: boolean }) {
  return <div className="flex flex-col gap-3 border-b border-[#eee9e1] py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><Icon size={15} className="mt-0.5 shrink-0 text-[#b6222b]" /><div><p className="text-[11px] font-medium">{title}</p><p className="mt-1 text-[9px] leading-relaxed text-[#938e86]">{detail}</p></div></div><span className={`flex w-fit items-center gap-1.5 text-[8px] uppercase tracking-[0.12em] ${ready ? 'text-[#477047]' : 'text-[#987b4d]'}`}><span className={`size-1.5 rounded-full ${ready ? 'bg-[#62946a]' : 'bg-[#c29c5f]'}`} />{state}</span></div>;
}

export default async function SettingsPage() {
  const database = await checkDatabase();
  const storageReady = env.STORAGE_PROVIDER === 'local' || Boolean(env.S3_BUCKET && env.S3_REGION);
  return <>
    <PageHeading eyebrow="Private studio · configuration" title="Studio settings" description="Review the local connections and safety gates. Credentials remain server-side and are never echoed into this page." />
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <section className="border border-[#e3ded6] bg-white px-5 sm:px-7"><div className="border-b border-[#eee9e1] py-5"><Eyebrow>Runtime connections</Eyebrow><h2 className="display-serif mt-2 text-[22px]">Environment status</h2></div>
        <SettingRow icon={Database} title="PostgreSQL" detail="Private product, image, session and catalogue metadata." state={database ? 'Connected' : 'Unavailable'} ready={database} />
        <SettingRow icon={HardDrive} title="Private image storage" detail={env.STORAGE_PROVIDER === 'local' ? 'Local private filesystem; files are excluded from Git and public routes.' : 'S3-compatible private bucket. Public ACLs are never requested.'} state={storageReady ? (env.STORAGE_PROVIDER === 'local' ? 'Local mode' : 'Configured') : 'Needs bucket settings'} ready={storageReady} />
        <SettingRow icon={KeyRound} title="Session signing secret" detail="Used to hash and validate server-side session tokens; value is never displayed." state={env.SESSION_SECRET && !env.SESSION_SECRET.startsWith('replace-') ? 'Configured' : 'Missing'} ready={Boolean(env.SESSION_SECRET && !env.SESSION_SECRET.startsWith('replace-'))} />
        <SettingRow icon={Sparkles} title="Image generation" detail="No provider adapter is connected. Catalogue generation is disabled." state="Disabled · no provider" ready={false} />
        <SettingRow icon={Check} title="Owner approval before export" detail="There is no automatic storefront publish path. Export controls remain disabled until review is implemented." state="Required gate" ready />
      </section>
      <aside className="h-fit border border-[#e3ded6] bg-white p-5"><CircleHelp size={16} className="text-[#b6222b]" /><h2 className="display-serif mt-4 text-[22px]">Local setup</h2><p className="mt-3 text-[10px] leading-[1.8] text-[#77736d]">Use the Docker PostgreSQL service and local private file storage during development. To use S3 in a deployed environment, set the server-side bucket settings in the host environment—never in browser-exposed variables.</p><div className="mt-4 border-t border-[#eee9e1] pt-4 text-[9px] leading-relaxed text-[#938e86]">Storage provider: <span className="font-medium text-[#504b46]">{env.STORAGE_PROVIDER}</span><br />Generation adapter: <span className="font-medium text-[#504b46]">none</span><br />Project setup: see README.md</div></aside>
    </div>
  </>;
}
