"use client";

// WhatsApp templates manager (spec §5) — synchronize REAL approved templates
// from the WABA, show name/category/language/status/variables/last-sync.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/lp/api";
import { cn } from "@/lib/utils";
import type { LpUser } from "@/lib/lp/api";

type Tpl = {
  id: string; name: string; category: string; language: string; kind: string;
  bodyText: string; variables: string; approvalStatus: string; metaTemplateId: string | null; updatedAt: string;
};

function varsOf(t: Tpl): string[] {
  try { const v = JSON.parse(t.variables || "[]"); if (Array.isArray(v) && v.length) return v.map(String); } catch { /* fall through */ }
  return [...t.bodyText.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
}

export default function TemplatesManager({ user }: { user: LpUser }) {
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [preview, setPreview] = useState<Tpl | null>(null);

  const load = useCallback(async () => {
    try { const d = await api<{ templates: Tpl[] }>("/api/lp/templates"); setTpls(d.templates); } catch { /* keep */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const sync = async () => {
    setSyncing(true); setSyncMsg("");
    try {
      const d = await api<{ metaCount: number; created: string[]; updated: string[]; demoted: string[] }>("/api/lp/templates/sync-meta", { method: "POST" });
      setSyncMsg(`Meta returned ${d.metaCount} templates — ${d.created.length} newly mirrored, ${d.updated.length} refreshed, ${d.demoted.length} local-only demoted to pending (they would fail sends).`);
      await load();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : "sync failed");
    } finally { setSyncing(false); }
  };

  const statusStyle = (s: string) => ({
    meta_approved: { c: "#25d366", label: "APPROVED" },
    meta_pending: { c: "#fbbf24", label: "PENDING" },
    meta_rejected: { c: "#f87171", label: "REJECTED" },
    free_form: { c: "#94a3b8", label: "FREE-FORM (internal)" },
  }[s] || { c: "#94a3b8", label: s });

  return (
    <div className="h-full overflow-y-auto comms-scroll p-4 lg:p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-base font-bold text-slate-100">WhatsApp message templates</div>
            <div className="text-[11px] text-slate-500">Mirror of your Meta WhatsApp Business Account — only Meta-approved templates deliver business-initiated messages.</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {syncMsg && <span className="text-[10px] text-slate-400 max-w-md truncate" title={syncMsg}>{syncMsg}</span>}
            <button onClick={() => void sync()} disabled={syncing}
              className="h-9 px-4 rounded-xl comms-btn-primary text-white text-xs font-semibold transition disabled:opacity-50">
              {syncing ? "Syncing from Meta…" : "⟳ Synchronize approved templates"}
            </button>
          </div>
        </div>

        <div className="comms-panel overflow-hidden">
          <div className="grid grid-cols-[1fr_90px_70px_110px_1fr_80px] gap-2 px-4 py-2.5 border-b border-[var(--cm-border)] text-[10px] uppercase tracking-wider text-slate-500">
            <span>Template name</span><span>Category</span><span>Language</span><span>Status</span><span>Variables</span><span className="text-right">Preview</span>
          </div>
          {tpls.length === 0 && <div className="px-4 py-8 text-center text-xs text-slate-500">No templates yet — press “Synchronize” to pull the real templates from your WABA.</div>}
          {tpls.map((t) => {
            const st = statusStyle(t.approvalStatus);
            const vars = varsOf(t);
            return (
              <div key={t.id} className="grid grid-cols-[1fr_90px_70px_110px_1fr_80px] gap-2 px-4 py-3 border-b border-[rgba(148,163,184,0.06)] items-center text-xs hover:bg-[rgba(148,163,184,0.03)] transition">
                <span className="font-medium text-slate-100 truncate">{t.name}<span className="ml-1.5 text-[9px] text-slate-600 uppercase">{t.kind === "free_form" ? "internal" : "meta"}</span></span>
                <span className="text-slate-400">{t.category}</span>
                <span className="text-slate-400">{t.language}</span>
                <span className="text-[10px] font-semibold" style={{ color: st.c }}>{st.label}</span>
                <span className="text-[10px] text-slate-500 truncate">{vars.length ? vars.map((v) => `{{${v}}}`).join(" ") : "—"}</span>
                <button onClick={() => setPreview(t)} className="justify-self-end text-[10px] comms-chip px-2.5 py-1 text-slate-300 hover:text-white transition">View</button>
              </div>
            );
          })}
        </div>

        <div className="text-[10px] text-slate-600 leading-relaxed">
          Sync is honest: local templates that do NOT exist on the connected WABA are demoted to PENDING — sending them would fail with Meta error #132001, and the CRM refuses to pretend otherwise. Templates are never sent bypassing WhatsApp Business messaging policies.
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="comms-panel p-5 max-w-md w-full shadow-2xl" style={{ background: "var(--cm-panel-solid)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-bold text-slate-100">{preview.name}</div>
              <button onClick={() => setPreview(null)} className="text-slate-500 hover:text-slate-300">✕</button>
            </div>
            <div className="rounded-2xl bg-[#0b141a] border border-[var(--cm-border)] p-3">
              <div className="comms-bubble-out px-3 py-2 inline-block max-w-full">
                <div className="text-[13px] text-slate-100 whitespace-pre-wrap">{preview.bodyText}</div>
                <div className="text-[9px] text-right text-slate-400/70 mt-1">template · {preview.language}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg border border-[var(--cm-border)] px-3 py-2"><span className="text-slate-500">Category</span> <span className="text-slate-200 float-right">{preview.category}</span></div>
              <div className="rounded-lg border border-[var(--cm-border)] px-3 py-2"><span className="text-slate-500">Status</span> <span className="text-slate-200 float-right">{statusStyle(preview.approvalStatus).label}</span></div>
              <div className="rounded-lg border border-[var(--cm-border)] px-3 py-2 col-span-2"><span className="text-slate-500">Meta template ID</span> <span className="text-slate-400 float-right font-mono text-[10px]">{preview.metaTemplateId || "—"}</span></div>
              <div className="rounded-lg border border-[var(--cm-border)] px-3 py-2 col-span-2"><span className="text-slate-500">Last sync</span> <span className="text-slate-400 float-right">{new Date(preview.updatedAt).toLocaleString()}</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
