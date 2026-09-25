"use client";

// Contacts (spec §6 spirit — CRM directory with communication actions).
// Click-to-chat opens the WhatsApp console with the conversation; click-to-call
// opens the Phone console with the number pre-filled (spec §12).
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/lp/api";
import { cn } from "@/lib/utils";
import { Avatar } from "./shared";

type Lead = {
  id: string; firstName: string | null; lastName: string | null; company: string | null;
  email: string | null; whatsapp: string | null; phone: string | null; country: string | null;
  city: string | null; status: string; score: number; source: string;
  assignedTo: { id: string; name: string } | null; lastContactAt: string | null;
};

export default function ContactsView({ onChat, onCall }: { onChat: (phone: string, name: string) => void; onCall: (phone: string, name: string) => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ total: number; leads: Lead[] }>(`/api/lp/leads?pageSize=25&page=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}${status ? `&status=${status}` : ""}&sort=lastContactAt`);
      setLeads(d.leads);
      setTotal(d.total);
    } catch { /* keep */ } finally { setLoading(false); }
  }, [q, status, page]);
  useEffect(() => { void load(); }, [load]);

  const nameOf = (l: Lead) => `${l.firstName || ""} ${l.lastName || ""}`.trim() || l.company || l.phone || "Contact";

  return (
    <div className="h-full overflow-y-auto comms-scroll p-4 lg:p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search contacts — name, company, number…" className="comms-input flex-1 min-w-56 h-9 px-3 text-xs" />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="comms-input h-9 px-2 text-xs">
            <option value="">All statuses</option>
            {["new", "contacted", "qualified", "converted", "do_not_contact"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
          <span className="text-[10px] text-slate-500">{total} contact{total !== 1 ? "s" : ""}</span>
        </div>

        <div className="comms-panel overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-[var(--cm-border)]">
                <th className="text-left px-4 py-2.5 font-medium">Contact</th>
                <th className="text-left px-3 py-2.5 font-medium">Company</th>
                <th className="text-left px-3 py-2.5 font-medium">WhatsApp / Phone</th>
                <th className="text-left px-3 py-2.5 font-medium">Stage</th>
                <th className="text-left px-3 py-2.5 font-medium">Agent</th>
                <th className="text-right px-4 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading…</td></tr>}
              {!loading && leads.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No contacts match.</td></tr>}
              {leads.map((l) => (
                <tr key={l.id} className="border-b border-[rgba(148,163,184,0.06)] hover:bg-[rgba(148,163,184,0.04)] transition">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={nameOf(l)} size={32} />
                      <div className="min-w-0">
                        <div className="text-slate-100 font-medium truncate max-w-40">{nameOf(l)}</div>
                        <div className="text-[10px] text-slate-500">{l.email || l.country || "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">{l.company || "—"}</td>
                  <td className="px-3 py-2.5 text-slate-300 font-mono text-[11px]">
                    <button onClick={() => l.whatsapp && onChat(l.whatsapp, nameOf(l))} className={cn("hover:text-[#4ade80] transition", !l.whatsapp && "opacity-40 cursor-default")} title={l.whatsapp ? "Open WhatsApp chat" : "no WhatsApp"}>
                      {l.whatsapp || "—"}
                    </button>
                    {l.phone && l.phone !== l.whatsapp && <span className="block text-slate-500">{l.phone}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-[10px] px-2 py-0.5 rounded-full comms-chip text-slate-300">{l.status.replace(/_/g, " ")}{l.score >= 70 ? " · hot" : ""}</span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">{l.assignedTo?.name || <span className="text-amber-400/80">unassigned</span>}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button disabled={!l.whatsapp} onClick={() => l.whatsapp && onChat(l.whatsapp, nameOf(l))}
                      className="h-7 px-2.5 rounded-lg comms-chip text-[10px] text-[#4ade80] hover:border-[#25d366]/50 transition disabled:opacity-30">Chat</button>
                    <button disabled={!l.phone && !l.whatsapp} onClick={() => onCall(l.phone || l.whatsapp || "", nameOf(l))}
                      className="ml-1.5 h-7 px-2.5 rounded-lg comms-chip text-[10px] text-[#8db1ff] hover:border-[#3d7ff7]/50 transition disabled:opacity-30">Call</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>Page {page} · {total ? Math.ceil(total / 25) : 1}</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="comms-chip px-3 py-1 disabled:opacity-30 hover:text-slate-200 transition">← Prev</button>
            <button disabled={page >= Math.ceil(total / 25)} onClick={() => setPage((p) => p + 1)} className="comms-chip px-3 py-1 disabled:opacity-30 hover:text-slate-200 transition">Next →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
