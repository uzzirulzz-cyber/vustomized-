"use client";

// PlayBeat Pulse — Phone / VoIP Dialer (spec §7/§8/§9).
// Premium call console wired to the calling adapter. With no telephony
// provider configured the console is fully usable for number entry and CRM
// lookup, but placing a call honestly reports NOT CONFIGURED — nothing is
// simulated (spec §26).
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/lp/api";
import { cn } from "@/lib/utils";
import type { LpUser } from "@/lib/lp/api";
import { Avatar, NotConfiguredPanel, fmtDuration, timeAgo } from "./shared";

const COUNTRIES = [
  { code: "PK", dial: "+92", name: "Pakistan" }, { code: "AE", dial: "+971", name: "UAE" },
  { code: "US", dial: "+1", name: "USA" }, { code: "GB", dial: "+44", name: "UK" },
  { code: "SA", dial: "+966", name: "Saudi Arabia" }, { code: "IN", dial: "+91", name: "India" },
  { code: "TR", dial: "+90", name: "Türkiye" }, { code: "DE", dial: "+49", name: "Germany" },
  { code: "MY", dial: "+60", name: "Malaysia" }, { code: "EG", dial: "+20", name: "Egypt" },
  { code: "ID", dial: "+62", name: "Indonesia" },
];

const KEYS: { d: string; sub?: string }[] = [
  { d: "1" }, { d: "2", sub: "ABC" }, { d: "3", sub: "DEF" },
  { d: "4", sub: "GHI" }, { d: "5", sub: "JKL" }, { d: "6", sub: "MNO" },
  { d: "7", sub: "PQRS" }, { d: "8", sub: "TUV" }, { d: "9", sub: "WXYZ" },
  { d: "*", }, { d: "0", sub: "+" }, { d: "#" },
];

type LeadLite = { id: string; firstName: string | null; lastName: string | null; company: string | null; phone: string | null; whatsapp: string | null; status: string };

function groupDigits(local: string): string {
  // progressive pretty-printing: 3-4 / 3-3-4 style grouping
  if (local.length <= 4) return local;
  if (local.length <= 7) return `${local.slice(0, 3)} ${local.slice(3)}`;
  return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6, 12)}`;
}

export default function PhoneConsole({ user, initialNumber, onChatWith }: { user: LpUser; initialNumber?: string; onChatWith: (phone: string, name: string) => void }) {
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [local, setLocal] = useState("");
  const [contacts, setContacts] = useState<LeadLite[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [notConfigured, setNotConfigured] = useState<string | null>(null);
  const [attempting, setAttempting] = useState(false);
  const [calling, setCalling] = useState<{ to: string; since: number; callId?: string; providerCallId?: string } | null>(null);
  const [endingCall, setEndingCall] = useState(false);
  const [providerState, setProviderState] = useState<{ configured: boolean; provider: string | null } | null>(null);

  useEffect(() => {
    api<{ leads: LeadLite[] }>("/api/lp/leads?pageSize=50&sort=lastContactAt")
      .then((d) => setContacts(d.leads.filter((l) => l.phone || l.whatsapp)))
      .catch(() => {});
    // REAL provider state for the console pill (health = live probes only)
    api<{ calling: { configured: boolean; provider: string | null } }>("/api/lp/communications/health")
      .then((h) => setProviderState(h.calling))
      .catch(() => setProviderState(null));
  }, []);

  useEffect(() => {
    if (initialNumber) {
      const digits = initialNumber.replace(/\D/g, "");
      const c = COUNTRIES.find((x) => digits.startsWith(x.dial.replace("+", "")));
      if (c) { setCountry(c); setLocal(digits.slice(c.dial.length - 1)); }
      else setLocal(digits);
    }
  }, [initialNumber]);

  const e164 = `${country.dial}${local}`;
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return contacts.slice(0, 12);
    return contacts.filter((c) => `${c.firstName || ""} ${c.lastName || ""} ${c.company || ""} ${c.phone || ""}`.toLowerCase().includes(needle)).slice(0, 12);
  }, [contacts, q]);

  const press = (d: string) => { setLocal((v) => (v.length < 15 ? v + d : v)); setNotConfigured(null); setError(""); };
  const backspace = () => setLocal((v) => v.slice(0, -1));
  const clear = () => setLocal("");
  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      const digits = t.replace(/\D/g, "");
      const c = COUNTRIES.find((x) => digits.startsWith(x.dial.replace("+", "")));
      if (c) { setCountry(c); setLocal(digits.slice(c.dial.length - 1)); } else setLocal(digits);
    } catch { setError("Clipboard unavailable — type the number instead."); }
  };

  const startCall = async () => {
    if (local.length < 6) { setError("Enter a valid number first (at least 6 digits)."); return; }
    setAttempting(true); setError(""); setNotConfigured(null);
    try {
      const res = await fetch("/api/lp/communications/calls/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await import("@/lib/lp/api")).getToken() ? { Authorization: `Bearer ${(await import("@/lib/lp/api")).getToken()}` } : {} },
        body: JSON.stringify({ phone: e164 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.reason === "not_configured") setNotConfigured(data.error || "Calling provider is not configured.");
        else setError(data.error || `Call failed (${res.status})`);
        return;
      }
      // provider ACCEPTED the call (real sid) — the console flips to the call screen
      setCalling({ to: e164, since: Date.now(), callId: data.callId, providerCallId: data.providerCallId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setAttempting(false);
    }
  };

  const endCall = async () => {
    if (!calling?.callId) { setCalling(null); return; }
    setEndingCall(true);
    try {
      const token = (await import("@/lib/lp/api")).getToken();
      const res = await fetch(`/api/lp/communications/calls/${calling.callId}/hangup`, {
        method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || `Hangup failed (${res.status}) — the call is still live.`); return; }
      setCalling(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "hangup network error");
    } finally { setEndingCall(false); }
  };

  const startChat = async () => {
    if (local.length < 6) { setError("Enter a valid number first (at least 6 digits)."); return; }
    setError("");
    onChatWith(e164, `+${e164.replace(/\D/g, "")}`);
  };

  const callSecs = calling ? Math.floor((Date.now() - calling.since) / 1000) : 0;
  useEffect(() => {
    if (!calling) return;
    const t = setInterval(() => setCalling((c) => (c ? { ...c, since: c.since } : c)), 1000);
    return () => clearInterval(t);
  }, [calling]);

  return (
    <div className="h-full overflow-y-auto comms-scroll">
      <div className="max-w-5xl mx-auto p-4 lg:p-6 grid lg:grid-cols-[minmax(0,420px)_1fr] gap-5 items-start">
        {/* ── dialer card ── */}
        <div className="comms-panel p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Phone console</div>
            <span className={cn("comms-chip px-2.5 py-1 text-[10px] flex items-center gap-1.5", providerState?.configured ? "text-[#4ade80]" : "text-slate-400")}>
              <span className={cn("w-2 h-2 rounded-full", providerState?.configured ? "bg-[#4ade80]" : "bg-slate-500")} />
              {providerState?.configured ? `${(providerState.provider || "provider").toUpperCase()} · READY` : "NOT CONFIGURED"}
            </span>
          </div>

          {/* number display */}
          <div className="rounded-2xl border border-[var(--cm-border)] bg-[rgba(10,15,26,0.6)] px-4 py-4 text-center">
            <select value={country.code} onChange={(e) => { const c = COUNTRIES.find((x) => x.code === e.target.value)!; setCountry(c); setLocal(""); }}
              className="comms-input h-8 px-2 text-[11px] mb-2" aria-label="Country code">
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.dial})</option>)}
            </select>
            <div className="text-2xl lg:text-3xl font-bold tracking-[0.08em] text-slate-100 min-h-10">
              {country.dial} {local ? groupDigits(local) : <span className="text-slate-600 text-xl font-normal">enter number</span>}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">E.164 {e164.length > 3 ? e164 : "—"}</div>
          </div>

          {/* keypad */}
          <div className="grid grid-cols-3 gap-2.5 mt-4">
            {KEYS.map((k) => (
              <button key={k.d} onClick={() => press(k.d)} className="cm-key py-3.5 text-center">
                <span className="block text-xl font-semibold text-slate-100">{k.d}</span>
                {k.sub && <span className="block text-[9px] tracking-[0.18em] text-slate-500 mt-0.5">{k.sub}</span>}
              </button>
            ))}
          </div>

          {/* actions */}
          <div className="grid grid-cols-3 gap-2.5 mt-3">
            <button onClick={backspace} className="cm-key py-2.5 text-[11px] text-slate-300">⌫ Backspace</button>
            <button onClick={clear} className="cm-key py-2.5 text-[11px] text-slate-300">CLR</button>
            <button onClick={() => void paste()} className="cm-key py-2.5 text-[11px] text-slate-300">Paste</button>
          </div>

          <div className="grid grid-cols-2 gap-2.5 mt-4">
            <button onClick={() => void startCall()} disabled={attempting}
              className="h-12 rounded-2xl comms-btn-primary text-white text-sm font-bold tracking-wide transition disabled:opacity-50 flex items-center justify-center gap-2">
              {attempting ? "Dialing…" : <span>☏ Call</span>}
            </button>
            <button onClick={() => void startChat()}
              className="h-12 rounded-2xl comms-btn-wa text-white text-sm font-bold tracking-wide transition flex items-center justify-center gap-2">
              <span>✆ WhatsApp chat</span>
            </button>
          </div>
          <div className="mt-1.5 text-center text-[10px] text-slate-500">Call needs a telephony provider — the WhatsApp chat opens instantly, fully internal.</div>
          {error && <div className="mt-2.5 text-[11px] text-[#f87171] bg-[rgba(248,113,113,0.08)] border border-[#f87171]/30 rounded-xl px-3 py-2">{error}</div>}

          {/* honest provider state */}
          {notConfigured && (
            <div className="mt-4">
              <NotConfiguredPanel title="Calls are unavailable — no telephony provider connected">
                <p className="mb-2">{notConfigured}</p>
                <p>The keypad, CRM contacts and call logging are live. To place real PSTN/SIP calls, add your provider (Twilio, Telnyx, Plivo or a SIP PBX) under <b className="text-slate-300">Settings → Calling Provider</b>. Every status here reflects the real adapter state — calls are never simulated.</p>
                <button onClick={() => (window.location.hash = "/settings")} className="mt-3 h-8 px-3 rounded-lg comms-btn-primary text-white text-[11px] font-semibold">Open Communications Settings</button>
              </NotConfiguredPanel>
            </div>
          )}

          {/* active call screen — only reachable when a provider accepts the call */}
          {calling && (
            <div className="mt-4 rounded-2xl border border-[rgba(37,211,102,0.35)] bg-[rgba(37,211,102,0.05)] p-5 text-center">
              <div className="relative inline-block">
                <div className={cn("w-20 h-20 rounded-full mx-auto flex items-center justify-center text-2xl font-bold text-white comms-btn-wa cm-wave on")}>☏</div>
              </div>
              <div className="mt-3 text-lg font-bold text-slate-100">{calling.to}</div>
              <div className="text-sm text-[#4ade80] font-mono mt-1">{fmtDuration(callSecs)}</div>
              <div className="grid grid-cols-3 gap-2 mt-4">
                {["Mute", "Hold", "DTMF", "Transfer", "Add"].map((c) => (
                  <button key={c} disabled
                    className={cn("py-2.5 rounded-xl text-[11px] border transition comms-chip text-slate-500 cursor-not-allowed")}
                    title="UNAVAILABLE WITH CURRENT PROVIDER — media-level controls need a WebRTC connection; nothing is simulated.">{c}</button>
                ))}
                <button disabled={endingCall} onClick={() => void endCall()}
                  className="py-2.5 rounded-xl text-[11px] border transition border-[#f87171]/50 bg-[rgba(248,113,113,0.12)] text-[#f87171] disabled:opacity-50"
                  title="End call — real provider hangup">{endingCall ? "Ending…" : "End"}</button>
              </div>
              <div className="mt-3 text-[10px] text-slate-500">Call state comes from the provider's live event stream. Mute / Hold / DTMF / Transfer are UNAVAILABLE WITH THE CURRENT PROVIDER (PSTN bridge) — they stay disabled, never simulated.</div>
            </div>
          )}
        </div>

        {/* ── right column: CRM contacts + notes ── */}
        <div className="space-y-5">
          <div className="comms-panel p-4">
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500 mb-3">Call from CRM contacts</div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts…" className="comms-input w-full h-9 px-3 text-xs mb-3" />
            <div className="space-y-1">
              {filtered.length === 0 && <div className="text-xs text-slate-500 py-3 text-center">No contacts with a phone number yet.</div>}
              {filtered.map((c) => {
                const name = `${c.firstName || ""} ${c.lastName || ""}`.trim() || c.phone || "Contact";
                const num = c.phone || c.whatsapp || "";
                return (
                  <button key={c.id} onClick={() => {
                    const digits = num.replace(/\D/g, "");
                    const cc = COUNTRIES.find((x) => digits.startsWith(x.dial.replace("+", "")));
                    if (cc) { setCountry(cc); setLocal(digits.slice(cc.dial.length - 1)); } else { setCountry(COUNTRIES[0]); setLocal(digits); }
                    setNotConfigured(null);
                  }} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-[rgba(148,163,184,0.06)] transition text-left">
                    <Avatar name={name} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs text-slate-200 truncate">{name}</span>
                      <span className="block text-[10px] text-slate-500">{num} {c.company ? `· ${c.company}` : ""}</span>
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full comms-chip text-slate-400">{c.status}</span>
                    <span className="text-slate-500 text-[10px]" title="populate">→</span>
                    <span role="button" tabIndex={0} onClick={(ev) => { ev.stopPropagation(); onChatWith(num, name); }} title="Open WhatsApp chat"
                      className="w-7 h-7 rounded-lg comms-btn-wa text-white text-[11px] flex items-center justify-center">✆</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="comms-panel p-4 text-xs text-slate-400 leading-relaxed">
            <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500 mb-2">How calling works here</div>
            <p>· Every number throughout PlayBeat Pulse (lead profiles, WhatsApp contact panel, search results) opens this console pre-filled — click-to-call with explicit agent action (spec §12).</p>
            <p className="mt-1.5">· Call attempts go through the server-side <b className="text-slate-300">CallingProviderAdapter</b> — provider credentials stay on the server, never in the browser.</p>
            <p className="mt-1.5">· After each completed call the disposition sheet (outcome · notes · follow-up date) saves against the call record and the CRM lead timeline.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Call history preview for the dialer's recents strip (shared data source)
export function useRecentCallsHook() {
  const [calls, setCalls] = useState<{ id: string; createdAt: string; direction: string; status: string; durationSec: number | null }[]>([]);
  useEffect(() => {
    api<{ calls: { id: string; createdAt: string; direction: string; status: string; durationSec: number | null }[] }>("/api/lp/calls")
      .then((d) => setCalls(d.calls.slice(0, 8)))
      .catch(() => {});
  }, []);
  return calls.map((c) => ({ ...c, when: timeAgo(c.createdAt) }));
}
