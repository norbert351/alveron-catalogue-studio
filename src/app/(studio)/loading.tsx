export default function StudioLoading() {
  return <div role="status" aria-live="polite" className="animate-pulse">
    <span className="sr-only">Loading studio page…</span>
    <div className="mb-4 h-3 w-28 bg-[#e1dbd2]" />
    <div className="h-10 w-72 max-w-full bg-[#e1dbd2]" />
    <div className="mt-3 h-3 w-[min(520px,90%)] bg-[#e7e2da]" />
    <div className="mt-8 grid gap-4 md:grid-cols-3"><div className="h-32 border border-[#e3ded6] bg-white" /><div className="h-32 border border-[#e3ded6] bg-white" /><div className="h-32 border border-[#e3ded6] bg-white" /></div>
  </div>;
}
