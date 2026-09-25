"use client";

import { useState } from "react";
import { login } from "@/lib/lp/api";
import { GoldButton } from "./bits";

export default function LoginView({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#e8f0fe] via-[#eef1f7] to-[#eef1f7] p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img
            src="/assets/images/playbeat/playbeat-3d-mark-light.png"
            alt="PlayBeat Digital — Lead Pulse CRM"
            width={767}
            height={472}
            className="mx-auto w-52 sm:w-60 h-auto object-contain drop-shadow-[0_12px_32px_rgba(37,99,235,0.28)] animate-[crmLogoFloat_6s_ease-in-out_infinite]"
          />
          <h1 className="mt-2 text-sm font-bold text-slate-900 tracking-[0.24em] uppercase">
            Lead <span className="text-[#2563eb]">Pulse</span> CRM
          </h1>
          <p className="text-[11px] text-slate-400 mt-1 tracking-wider uppercase">WhatsApp Dialer · Bulk Messaging · CRM</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white shadow-xl shadow-[#3d7ff7]/10 p-6 space-y-4">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-slate-500 block mb-1.5">Work Email</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full h-10 rounded-lg bg-slate-50 border border-slate-200 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#3d7ff7]/60"
              placeholder="you@playbeat.live"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-slate-500 block mb-1.5">Password</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="w-full h-10 rounded-lg bg-slate-50 border border-slate-200 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#3d7ff7]/60"
              placeholder="••••••••"
            />
          </div>
          {error && <div className="text-xs text-rose-600 bg-rose-500/10 border border-rose-400/20 rounded-lg px-3 py-2">{error}</div>}
          <GoldButton type="submit" disabled={busy} className="w-full justify-center h-10">
            {busy ? "Signing in…" : "Sign In"}
          </GoldButton>
          <p className="text-[10px] text-slate-400 text-center">
            JWT session · 30-min access tokens · rotating refresh cookie
          </p>
        </form>
      </div>
    </div>
  );
}
