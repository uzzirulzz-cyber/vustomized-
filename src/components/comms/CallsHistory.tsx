"use client";

// PlayBeat Pulse — Call History (spec §10) + post-call disposition (spec §11).
// Records are real: logged calls and (once a provider is connected) provider
// events. Empty states are honest.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/lp/api";
import { cn } from "@/lib/utils";
import type { LpUser } from "@/lib/lp/api";
import { Avatar, fmtDuration, timeAgo } from "./shared";

type Call = {
  id: string; leadId: string; direction: string; method: string; provider: string | null;
  status: string; outcome: string | null; durationSec: number | null; notes: string | null;
  scheduledFor: string | null; startedAt: string | null; endedAt: string | null; createdAt: string;
  lead: { id: string; firstName: string | null; lastName: string | null; company: string | null; phone: string | null; whatsapp: string | null; country: string | null } | null;
  employee: { id: string; name: string } | null;
};

const TABS = [
  { key: "all", label: "All" }, { key: "inbound", label: "Incoming" }, { key: "outbound", label: "Outgoing" },
  { key: "missed", label: "Missed" }, { key: "answered", label: "Answered" }, { key: "voicemail", label: "Voicemail" },
];

const OUTCOMES = ["interested", "follow_up", "qualified", "not_interested", "no_answer", "busy", "wrong_number", "converted", "other"];

function statusBadge(s: string): { color: string; label: string } {
  const map: Record<string, { color: string; label: string }> = {
    completed: { color: "#25d366", label: "answered" },
    missed: { color: "#f87171", label: "missed" },
    no_answer: { color: "#fbbf24", label: "no answer" },
    busy: { color: "#f97316", label: "busy" },
    failed: { color: "#f87171", label: "failed" },
    scheduled: { color: "#3d7ff7", label: "scheduled" },
  };
  return map[s] || { color: "#94a3b8", label: s };
}

export default function CallsHistory({ user }: { user: LpUser }) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [tab, setTab] = useState("all");
  const [selected, setSelected] = useState<Call | null>(null);
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<{ calls: Call[] }>("/api/lp/calls");
      setCalls(d.calls);
    } catch { /* keep */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    return calls.filter((c) => {
      if (tab === "all") return true;
      if (tab === "inbound") return c.direction === "inbound";
      if (tab === "outbound") return c.direction === "outbound";
      if (tab === "missed") return ["missed", "no_answer", "busy"].includes(c.status);
      if (tab === "answered") return c.status === "completed";
      if (tab === "voicemail") return false; // voicemail requires a provider that records it — honest empty
      return true;
    });
  }, [calls, tab]);

  const openDetail = (c: Call) => {
    setSelected(c);
    setOutcome(c.outcome || "");
    setNotes(c.notes || "");
    setFollowUpAt("");
    setSavedMsg("");
  };

  const saveDisposition = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api(`/api/lp/communications/calls/${selected.id}/note`, {
        method: "POST",
        body: JSON.stringify({ outcome: outcome || undefined, notes: notes || undefined, followUpAt: followUpAt || undefined }),
      });
      setSavedMsg("Saved to the call record and the lead timeline.");
      await load();
    } catch (e) {
      setSavedMsg(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex min-h-0">
      {/* list */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="shrink-0 px-4 pt-4 pb-2 flex items-center gap-1.5 flex-wrap">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn("text-[11px] px-3 py-1.5 rounded-full border transition", tab === t.key ? "bg-[rgba(61,127,247,0.2)] border-[#3d7ff7]/50 text-[#bcd2ff] font-medium" : "comms-chip text-slate-400 hover:text-slate-200")}>
              {t.label}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-slate-500">{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex-1 overflow-y-auto comms-scroll px-4 pb-4">
          {filtered.length === 0 && (
            <div className="comms-panel p-8 text-center mt-6 max-w-lg mx-auto">
              <div className="text-sm text-slate-300 font-medium">{tab === "voicemail" ? "Voicemail is unavailable with the current provider" : "No call records yet"}</div>
              <div className="mt-2 text-xs text-slate-500 leading-relaxed">
                {tab === "voicemail"
                  ? "Voicemail recording and playback require a telephony provider — it activates automatically once provider credentials are configured under Settings."
                  : "Calls logged from the dialer (and, once a provider is connected, real provider call events) appear here with duration, disposition and the CRM lead."}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            {filtered.map((c) => {
              const name = c.lead ? `${c.lead.firstName || ""} ${c.lead.lastName || ""}`.trim() || c.lead.phone || "Unknown" : "Unknown";
              const badge = statusBadge(c.status);
              return (
                <button key={c.id} onClick={() => openDetail(c)}
                  className={cn("w-full comms-panel p-3 flex items-center gap-3 text-left transition hover:border-[var(--cm-border-strong)]", selected?.id === c.id && "border-[#3d7ff7]/50")}>
                  <div className={cn("w-9 h-9 rounded-full flex items-center justify-center text-sm shrink-0", c.direction === "inbound" ? "text-[#8db1ff]" : "text-[#4ade80]")}
                    style={{ background: c.direction === "inbound" ? "rgba(61,127,247,0.12)" : "rgba(37,211,102,0.12)" }}>
                    {c.direction === "inbound" ? "↙" : "↗"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-100 truncate">{name}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full border" style={{ color: badge.color, borderColor: `${badge.color}55` }}>{badge.label}</span>
                      {c.outcome && <span className="text-[9px] text-slate-500">· {c.outcome.replace(/_/g, " ")}</span>}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate mt-0.5">
                      {c.lead?.phone || c.lead?.whatsapp || "—"} · via {c.method.replace(/_/g, " ")}{c.employee ? ` · ${c.employee.name}` : ""} · {timeAgo(c.createdAt)} ago
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-slate-300 font-mono">{c.durationSec != null ? fmtDuration(c.durationSec) : "—"}</div>
                    <div className="text-[9px] text-slate-500">{c.provider || c.method.replace(/_/g, " ")}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* detail + disposition */}
      <div className={cn("w-[320px] shrink-0 border-l border-[var(--cm-border)] bg-[rgba(8,12,22,0.45)] overflow-y-auto comms-scroll", selected ? "hidden md:block" : "hidden")}>
        {selected && (
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-3">
              <Avatar name={selected.lead ? `${selected.lead.firstName || ""} ${selected.lead.lastName || ""}`.trim() || "?" : "?"} size={44} />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-100 truncate">{selected.lead ? `${selected.lead.firstName || ""} ${selected.lead.lastName || ""}`.trim() : "Unknown"}</div>
                <div className="text-[11px] text-slate-500">{selected.lead?.company || "—"} · {selected.lead?.country || "—"}</div>
              </div>
              <button onClick={() => setSelected(null)} className="ml-auto text-slate-500 hover:text-slate-300 md:hidden">✕</button>
            </div>

            <div className="rounded-xl border border-[var(--cm-border)] divide-y divide-[rgba(148,163,184,0.08)] text-[11px]">
              {[
                ["Number", selected.lead?.phone || selected.lead?.whatsapp || "—"],
                ["Direction", selected.direction],
                ["Placed via", selected.method === "provider" ? `provider: ${selected.provider}` : selected.method.replace(/_/g, " ")],
                ["Started", selected.startedAt ? new Date(selected.startedAt).toLocaleString() : "—"],
                ["Duration", selected.durationSec != null ? fmtDuration(selected.durationSec) : "unknown"],
                ["Status", statusBadge(selected.status).label],
                ["Agent", selected.employee?.name || "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 px-3 py-2">
                  <span className="text-slate-500">{k}</span><span className="text-slate-200 text-right">{v}</span>
                </div>
              ))}
            </div>

            {/* disposition */}
            <div className="rounded-xl border border-[var(--cm-border)] p-3 space-y-2.5">
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Call disposition</div>
              <div className="grid grid-cols-3 gap-1.5">
                {OUTCOMES.map((o) => (
                  <button key={o} onClick={() => setOutcome(o)}
                    className={cn("text-[10px] py-1.5 rounded-lg border transition capitalize", outcome === o ? "bg-[rgba(61,127,247,0.18)] border-[#3d7ff7]/50 text-[#bcd2ff] font-semibold" : "comms-chip text-slate-400 hover:text-slate-200")}>
                    {o.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Call notes…" className="comms-input w-full px-2.5 py-2 text-[11px] resize-none" />
              <div className="flex items-center gap-2">
                <input type="datetime-local" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} className="comms-input flex-1 h-8 px-2 text-[11px]" />
                <span className="text-[9px] text-slate-500 shrink-0">follow-up</span>
              </div>
              <button onClick={() => void saveDisposition()} disabled={saving}
                className="w-full h-9 rounded-xl comms-btn-primary text-white text-xs font-semibold transition disabled:opacity-50">
                {saving ? "Saving…" : "Save call"}
              </button>
              {savedMsg && <div className="text-[10px] text-center text-[#4ade80]">{savedMsg}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
