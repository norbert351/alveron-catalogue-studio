'use client';

import { useCallback, useEffect, useState } from 'react';

type Token = { id: string; label: string; scope: string; created_at: string; last_used_at: string | null; use_count: number; revoked_at: string | null };

/**
 * ChatGPT access tokens.
 *
 * The plaintext token is shown ONCE after creation, in a copy box, because it is
 * not recoverable from the database. The UI says that plainly rather than letting
 * the owner navigate away and lose it.
 */
export function LibraryTokens() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [label, setLabel] = useState('ChatGPT connector');
  const [issued, setIssued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/tokens', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not load tokens (${response.status}).`);
      const body = await response.json() as { tokens: Token[] };
      setTokens(body.tokens);
    } catch (cause) { setError((cause as Error).message); }
  }, []);

  useEffect(() => {
    // Kick the fetch on the next tick: calling load() directly inside the effect
    // body sets state synchronously during render commit, which React flags as a
    // cascading render. A cancelled flag keeps a late response from landing after
    // unmount.
    let cancelled = false;
    const timer = setTimeout(() => { if (!cancelled) void load(); }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [load]);

  async function create() {
    setBusy(true); setError(null); setIssued(null);
    try {
      const response = await fetch('/api/settings/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not create a token.');
      setIssued(body.token);
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    if (!window.confirm('Revoke this token? Any connected system using it will stop working immediately.')) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/settings/tokens?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json()).error ?? 'Could not revoke the token.');
      await load();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="border border-[#e3ded6] bg-white">
      <div className="border-b border-[#eee9e1] px-5 py-4 sm:px-7">
        <p className="text-[9px] uppercase tracking-[0.2em] text-[#b6222b]">External access</p>
        <h2 className="display-serif mt-2 text-[22px]">ChatGPT retrieval tokens</h2>
        <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-[#938e86]">
          A token lets ChatGPT search this library and download original product images. It is
          read-only: it cannot upload, edit or delete anything. Revoke it any time and access stops
          immediately.
        </p>
      </div>

      <div className="px-5 py-4 sm:px-7">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Token label"
            className="min-h-10 flex-1 border border-[#ded7cc] bg-[#faf9f6] px-3 text-[11px] outline-none focus:border-[#b6222b]"
          />
          <button
            type="button"
            onClick={create}
            disabled={busy || !label.trim()}
            className="min-h-10 bg-[#171717] px-5 text-[10px] uppercase tracking-[0.14em] text-white disabled:opacity-40"
          >
            {busy ? 'Working…' : 'Create token'}
          </button>
        </div>

        {error && <p className="mt-3 border-l-2 border-[#b6222b] pl-3 text-[10px] text-[#962a2e]">{error}</p>}

        {issued && (
          <div className="mt-4 border border-[#b6222b]/30 bg-[#fdf7f5] p-3">
            <p className="text-[10px] font-medium text-[#962a2e]">Copy this now — it is not stored and cannot be shown again.</p>
            <code className="mt-2 block break-all bg-white px-2 py-2 font-mono text-[10px] text-[#171717]">{issued}</code>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(issued)}
              className="mt-2 text-[9px] uppercase tracking-[0.12em] text-[#b6222b] underline"
            >
              Copy token
            </button>
          </div>
        )}

        <div className="mt-5">
          <p className="text-[10px] font-medium">Issued tokens</p>
          {tokens.length === 0 ? (
            <p className="mt-2 text-[10px] text-[#938e86]">No tokens yet. ChatGPT cannot reach the library until you create one.</p>
          ) : (
            <div className="mt-2 divide-y divide-[#eee9e1] border border-[#eee9e1]">
              {tokens.map((token) => (
                <div key={token.id} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-medium">{token.label}</p>
                    <p className="text-[8px] uppercase tracking-[0.1em] text-[#938e86]">
                      {token.scope} · used {token.use_count}× {token.last_used_at ? `· last ${new Date(token.last_used_at).toLocaleDateString()}` : '· never'}
                      {token.revoked_at ? ' · REVOKED' : ''}
                    </p>
                  </div>
                  {!token.revoked_at && (
                    <button
                      type="button"
                      onClick={() => void revoke(token.id)}
                      disabled={busy}
                      className="text-[9px] uppercase tracking-[0.12em] text-[#962a2e] underline disabled:opacity-40"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
