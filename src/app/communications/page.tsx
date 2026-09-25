"use client";

// PlayBeat Pulse — Communications Console (dedicated route, spec §1).
// /communications — dark enterprise workspace combining the WhatsApp Business
// Inbox and the VoIP/Phone Dialer with full CRM context. Auth-gated by the
// same JWT session as the CRM (transparent refresh).
import { useCallback, useEffect, useState } from "react";
import { api, tryRestore, type LpUser } from "@/lib/lp/api";
import CommsShell, { type CommsView } from "@/components/comms/CommsShell";
import { CommsDashboard, CommsAnalytics } from "@/components/comms/CommsDashboard";
import WaInbox from "@/components/comms/WaInbox";
import PhoneConsole from "@/components/comms/PhoneConsole";
import CallsHistory from "@/components/comms/CallsHistory";
import ContactsView from "@/components/comms/ContactsView";
import VoicemailView from "@/components/comms/VoicemailView";
import TemplatesManager from "@/components/comms/TemplatesManager";
import BroadcastsView from "@/components/comms/BroadcastsView";
import TeamInbox from "@/components/comms/TeamInbox";
import CommsSettings from "@/components/comms/CommsSettings";

type Employee = { id: string; name: string };

const VALID: CommsView[] = ["dashboard", "whatsapp", "phone", "calls", "contacts", "leads", "voicemail", "templates", "broadcasts", "team", "analytics", "settings"];

export default function CommunicationsPage() {
  const [booted, setBooted] = useState(false);
  const [user, setUser] = useState<LpUser | null>(null);
  const [view, setView] = useState<CommsView>("dashboard");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [dialNumber, setDialNumber] = useState<string>("");
  const [chatTarget, setChatTarget] = useState<{ phone: string; name: string; convId?: string } | null>(null);
  const [inboxTick, setInboxTick] = useState(0);

  // session
  useEffect(() => {
    tryRestore()
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setBooted(true));
  }, []);

  // hash router
  useEffect(() => {
    const apply = () => {
      const h = window.location.hash.replace("#/", "").split("?")[0] as CommsView;
      if (VALID.includes(h)) setView(h);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const go = useCallback((v: CommsView) => {
    setView(v);
    window.location.hash = `/${v}`;
  }, []);

  // employees for assignment
  useEffect(() => {
    if (!user) return;
    api<{ employees: Employee[] }>("/api/lp/employees").then((d) => setEmployees(d.employees)).catch(() => {});
  }, [user, view]);

  // click-to-chat from contacts: find-or-create the conversation, then open WhatsApp view
  const chatWith = useCallback(async (phone: string, name: string) => {
    if (!phone) return;
    try {
      const d = await api<{ conversation: { id: string } }>("/api/lp/conversations/find-or-create", {
        method: "POST",
        body: JSON.stringify({ phone, name }),
      });
      setChatTarget({ phone, name, convId: d.conversation.id });
      go("whatsapp");
      setInboxTick((t) => t + 1); // WaInbox remounts and picks up the latest conversation order
    } catch { /* surfaced inside the inbox */ }
  }, [go]);

  // click-to-call from anywhere
  const callWith = useCallback((phone: string, _name: string) => {
    setDialNumber(phone);
    go("phone");
  }, [go]);

  if (!booted) {
    return (
      <div className="comms-root min-h-screen flex items-center justify-center">
        <div className="text-xs text-slate-500 tracking-[0.2em] uppercase">PlayBeat Pulse · loading…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="comms-root min-h-screen flex items-center justify-center p-4">
        <div className="comms-panel p-8 max-w-sm w-full text-center">
          <div className="w-12 h-12 rounded-2xl comms-btn-primary mx-auto flex items-center justify-center text-white text-lg font-black">P</div>
          <div className="mt-3 text-sm font-bold text-slate-100">PlayBeat Pulse — Communications</div>
          <div className="mt-1 text-xs text-slate-500 leading-relaxed">Sign in through the CRM workspace, then return here. Your session carries over.</div>
          <a href="/metacrm" className="mt-4 inline-block h-9 px-4 leading-9 rounded-xl comms-btn-primary text-white text-xs font-semibold">Go to CRM sign-in →</a>
        </div>
      </div>
    );
  }

  return (
    <CommsShell user={user} view={view} setView={go}>
      {view === "dashboard" && <CommsDashboard />}
      {view === "whatsapp" && (
        <WaInbox key={inboxTick} user={user} employees={employees} onCallCustomer={callWith} autoOpenPhone={chatTarget?.phone || null} />
      )}
      {view === "phone" && <PhoneConsole user={user} initialNumber={dialNumber} onChatWith={(p) => void chatWith(p, p)} />}
      {view === "calls" && <CallsHistory user={user} />}
      {view === "contacts" && <ContactsView onChat={(p, n) => void chatWith(p, n)} onCall={callWith} />}
      {view === "leads" && <ContactsView onChat={(p, n) => void chatWith(p, n)} onCall={callWith} />}
      {view === "voicemail" && <VoicemailView />}
      {view === "templates" && <TemplatesManager user={user} />}
      {view === "broadcasts" && <BroadcastsView user={user} />}
      {view === "team" && <TeamInbox user={user} />}
      {view === "analytics" && <CommsAnalytics />}
      {view === "settings" && <CommsSettings user={user} />}
    </CommsShell>
  );
}
