"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/lp/api";
import { SectionTitle, StatusPill, GoldButton, GhostButton, EmptyState } from "./bits";

type Template = {
  id: string; name: string; category: string; language: string; kind: string;
  bodyText: string; variables: string; approvalStatus: string; archived: boolean; createdAt: string;
};

export default function TemplatesView({ user }: { user: { id: string; role: string } }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", category: "utility", language: "en", kind: "whatsapp_template", bodyText: "" });
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const canManage = ["super_admin", "admin", "manager"].includes(user.role);
  const canApprove = ["super_admin", "admin"].includes(user.role);

  const load = useCallback(async () => {
    const data = await api<{ templates: Template[] }>("/api/lp/templates");
    setTemplates(data.templates);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setBusy(true); setError("");
    try {
      await api("/api/lp/templates", { method: "POST", body: JSON.stringify(form) });
      setCreating(false);
      setForm({ name: "", category: "utility", language: "en", kind: "whatsapp_template", bodyText: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally { setBusy(false); }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(true); setError(""); setSyncingId(id);
    try {
      await api(`/api/lp/templates/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally { setBusy(false); setSyncingId(null); }
  };

  return (
    <div className="space-y-4">
      <SectionTitle right={canManage ? <GoldButton onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "New Template"}</GoldButton> : undefined}>
        Message Templates
      </SectionTitle>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500 leading-relaxed">
        <span className="text-[#2563eb] font-semibold">Meta approval rule (§7):</span> WhatsApp <b>template</b> messages sent OUTSIDE the 24h service window must be approved by Meta first — campaigns only accept <span className="text-emerald-600">meta_approved</span> templates.
        <b> Free-form</b> templates need no approval and are used for replies inside an open customer-service window.
      </div>

      {error && <div className="text-xs text-rose-600 bg-rose-500/10 border border-rose-400/20 rounded-lg px-3 py-2">{error}</div>}

      {creating && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div><label className="text-[10px] uppercase text-slate-400 block mb-1">Name</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-900" /></div>
            <div><label className="text-[10px] uppercase text-slate-400 block mb-1">Type</label>
              <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} className="w-full h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-800">
                <option value="whatsapp_template">WhatsApp template (needs Meta approval)</option>
                <option value="free_form">Free-form (24h window replies)</option>
              </select></div>
            <div><label className="text-[10px] uppercase text-slate-400 block mb-1">Category</label>
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="w-full h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-800">
                {["marketing", "utility", "authentication"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select></div>
            <div><label className="text-[10px] uppercase text-slate-400 block mb-1">Language</label>
              <select value={form.language} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))} className="w-full h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-800">
                {["en", "ur", "ar", "hi"].map((l) => <option key={l} value={l}>{l}</option>)}
              </select></div>
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-400 block mb-1">
              Body — variables: {"{{first_name}} {{last_name}} {{company}} {{country}} {{city}} {{employee_name}} {{phone}} {{email}}"}
            </label>
            <textarea value={form.bodyText} onChange={(e) => setForm((f) => ({ ...f, bodyText: e.target.value }))} rows={4}
              className="w-full rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-900" placeholder={"Hello {{first_name}},\n\nThank you for your interest in {{company_name}}…"} />
          </div>
          <div className="flex justify-end"><GoldButton disabled={busy || !form.name || !form.bodyText} onClick={create}>Create Template</GoldButton></div>
        </div>
      )}

      {templates.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50"><EmptyState title="No templates" hint="Create a reusable template with {{variables}}." /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="text-xs font-semibold text-slate-900">{t.name}</div>
                  <div className="text-[10px] text-slate-400">{t.kind === "free_form" ? "free-form" : "WhatsApp template"} · {t.category} · {t.language}</div>
                </div>
                <StatusPill status={t.approvalStatus} />
              </div>
              <pre className="text-[11px] text-slate-600 whitespace-pre-wrap bg-white rounded-lg p-3 border border-slate-100 max-h-32 overflow-y-auto">{t.bodyText}</pre>
              <div className="flex flex-wrap items-center justify-between gap-2 mt-2.5">
                <div className="flex flex-wrap gap-1">
                  {(JSON.parse(t.variables || "[]") as string[]).map((v) => (
                    <span key={v} className="text-[9px] px-1.5 py-0.5 rounded bg-[#3d7ff7]/10 border border-[#3d7ff7]/25 text-[#2563eb]">{`{{${v}}}`}</span>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  {canApprove && t.kind === "whatsapp_template" && (
                    <GhostButton disabled={busy} onClick={() => patch(t.id, { approvalStatus: "sync_meta" })} className="!h-7 !px-2">
                      {syncingId === t.id ? "Syncing…" : "Sync Meta status"}
                    </GhostButton>
                  )}
                  {canApprove && t.kind === "whatsapp_template" && (
                    <select
                      value={t.approvalStatus} disabled={busy}
                      onChange={(e) => patch(t.id, { approvalStatus: e.target.value })}
                      className="h-7 rounded bg-slate-50 border border-slate-200 px-1.5 text-[10px] text-slate-800">
                      <option value="meta_pending">mark: pending</option>
                      <option value="meta_approved">mark: approved</option>
                      <option value="meta_rejected">mark: rejected</option>
                    </select>
                  )}
                  {canManage && <GhostButton disabled={busy} onClick={() => patch(t.id, { archived: true })} className="!h-7 !px-2">Archive</GhostButton>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
