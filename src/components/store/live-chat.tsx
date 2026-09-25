"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Headset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { timeAgo } from "@/lib/format";

type Convo = {
  id: string;
  subject: string;
  status: string;
  lastMessageAt: string;
  unread: number;
  messages: { id?: string; senderType: string; senderName: string; body: string; createdAt: string; mine: boolean }[];
};

type Me = { kind: string; customer?: { name: string } } | null;

export function LiveChat() {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<Me>(null);
  const [convos, setConvos] = useState<Convo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const active = convos.find((c) => c.id === activeId) ?? null;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (res.status === 401) {
        setMe(null);
        setConvos([]);
        return;
      }
      const data = await res.json();
      setConvos(data.conversations ?? []);
      setActiveId((cur) => cur ?? data.conversations?.[0]?.id ?? null);
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then(setMe).catch(() => {});
  }, []);

  // poll while the widget is open
  useEffect(() => {
    if (open) {
      load();
      pollRef.current = setInterval(load, 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [open, load]);

  // mark read when opening a thread
  useEffect(() => {
    if (open && activeId) {
      fetch(`/api/conversations/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read" }),
      }).catch(() => {});
    }
  }, [open, activeId, convos.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length, open]);

  const startChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setStarting(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, email,
          message: "👋 Hello! I'd like some help.",
          subject: "Live chat request",
          source: "LIVE_CHAT",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMe({ kind: "customer", customer: { name } });
        await load();
        setActiveId(data.conversationId);
      }
    } finally {
      setStarting(false);
    }
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText("");
    setLoading(true);
    try {
      const url = active ? `/api/conversations/${active.id}/messages` : "/api/conversations";
      const payload = active
        ? { body }
        : { message: body, subject: body.slice(0, 60), source: "LIVE_CHAT" };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        // session only had a guest cookie that expired — ask identity again
        setMe(null);
        return;
      }
      const data = await res.json();
      if (!active && data.conversationId) setActiveId(data.conversationId);
      await load();
    } finally {
      setLoading(false);
    }
  };

  const signedIn = !!me?.customer;
  const totalUnread = convos.reduce((s, c) => s + (c.unread > 0 ? 1 : 0), 0);

  return (
    <>
      {/* Floating launcher */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close live support" : "Open live support"}
        className={`fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full pb-gradient glow-blue flex items-center justify-center transition-transform hover:scale-105 ${!open ? "animate-pulse-ring" : ""}`}
      >
        {open ? <X className="h-6 w-6 text-[#04121f]" /> : <Headset className="h-6 w-6 text-[#04121f]" />}
        {!open && totalUnread > 0 && (
          <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center">
            {totalUnread}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-24 right-5 z-50 w-[min(92vw,380px)] rounded-2xl glass-strong shadow-2xl overflow-hidden flex flex-col max-h-[70vh]">
          <div className="p-4 border-b bg-gradient-to-r from-sky-500/15 to-cyan-500/10">
            <div className="flex items-center gap-2.5">
              <span className="pb-gradient rounded-full p-1.5">
                <MessageCircle className="h-4 w-4 text-[#04121f]" />
              </span>
              <div>
                <h3 className="text-sm font-bold">PlayBeat Live Support</h3>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Online — avg reply under 5 minutes
                </p>
              </div>
            </div>
          </div>

          {!signedIn && convos.length === 0 ? (
            <form onSubmit={startChat} className="p-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Hi there 👋 Tell us who you are and we&apos;ll open a private support chat with our team.
              </p>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required className="bg-input/40" />
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" type="email" required className="bg-input/40" />
              <Button type="submit" disabled={starting} className="w-full pb-gradient border-0 text-[#04121f] font-semibold hover:opacity-90">
                {starting ? "Opening chat…" : "Start live chat"}
              </Button>
            </form>
          ) : (
            <>
              {convos.length > 1 && (
                <div className="flex gap-1.5 overflow-x-auto nice-scroll px-3 pt-3 pb-1">
                  {convos.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setActiveId(c.id)}
                      className={`shrink-0 max-w-40 px-2.5 py-1.5 rounded-lg text-[11px] border truncate ${
                        c.id === activeId ? "border-sky-500/60 text-sky-300 bg-sky-500/10" : "border-border text-muted-foreground"
                      }`}
                    >
                      {c.unread > 0 && <span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-500 mr-1" />}
                      {c.subject}
                    </button>
                  ))}
                </div>
              )}

              <div ref={scrollRef} className="flex-1 overflow-y-auto nice-scroll p-4 space-y-3 min-h-56">
                {!active && (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    Send us a message and our support team will reply right here.
                  </p>
                )}
                {active?.messages.map((m, i) => (
                  <div key={m.id ?? i} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        m.mine
                          ? "pb-gradient text-[#04121f] rounded-br-sm font-medium"
                          : "bg-secondary border border-border rounded-bl-sm"
                      }`}
                    >
                      {!m.mine && <div className="text-[10px] font-semibold text-sky-400 mb-0.5">{m.senderName} · Support</div>}
                      {m.body}
                      <div className={`text-[9px] mt-1 ${m.mine ? "text-[#04121f]/60" : "text-muted-foreground"}`}>
                        {timeAgo(m.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <form onSubmit={send} className="p-3 border-t flex gap-2">
                <Input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Type your message..."
                  className="flex-1 bg-input/40 text-sm"
                />
                <Button type="submit" size="icon" disabled={loading} className="pb-gradient border-0 text-[#04121f] hover:opacity-90 shrink-0" aria-label="Send">
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}
