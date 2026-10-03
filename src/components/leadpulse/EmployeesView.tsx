"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/lp/api";
import { SectionTitle, StatusPill, GoldButton, GhostButton, EmptyState } from "./bits";

type Employee = {
  id: string; email: string; name: string; phone: string | null; role: string;
  department: string | null; status: string; createdAt: string;
  stats: { assignedLeads: number; calls: number; messages: number; conversations: number; conversions: number; followupsCompleted: number };
};

const ROLES = ["super_admin", "admin", "manager", "employee", "viewer"];

export default function EmployeesView({ user }: { user: { id: string; role: string } }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "employee", department: "Sales", phone: "" });
  const canManage = ["super_admin", "admin"].includes(user.role);

  const load = useCallback(async () => {
    try {
      const data = await api<{ employees: Employee[] }>("/api/lp/employees");
      setEmployees(data.employees);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setBusy(true); setError("");
    try {
      await api("/api/lp/employees", { method: "POST", body: JSON.stringify(form) });
      setCreating(false);
      setForm({ name: "", email: "", password: "", role: "employee", department: "Sales", phone: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally { setBusy(false); }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      await api(`/api/lp/employees/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <SectionTitle right={canManage ? <GoldButton onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "Create Employee"}</GoldButton> : undefined}>
        Employee Management
      </SectionTitle>

      {error && <div className="text-xs text-rose-600 bg-rose-500/10 border border-rose-400/20 rounded-lg px-3 py-2">{error}</div>}

      {creating && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Full name" className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-900" />
            <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="email@playbeat.live" className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-900" />
            <input value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="Password (8+ chars)" type="password" className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-900" />
            <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-800">
              {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
            </select>
            <select value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-800">
              {["Sales", "Support", "Marketing", "Operations", "Management"].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Phone (optional)" className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-900" />
          </div>
          <div className="flex justify-end"><GoldButton disabled={busy || !form.name || !form.email || form.password.length < 8} onClick={create}>Create Employee</GoldButton></div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400">
                <th className="px-3 py-2.5">Employee</th><th className="px-3 py-2.5">Role</th><th className="px-3 py-2.5">Department</th>
                <th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Leads</th><th className="px-3 py-2.5">Calls</th>
                <th className="px-3 py-2.5">Messages</th><th className="px-3 py-2.5">Conversations</th><th className="px-3 py-2.5">Conversions</th><th className="px-3 py-2.5">Follow-ups Done</th>
                {canManage && <th className="px-3 py-2.5 text-right">Manage</th>}
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr><td colSpan={11}><EmptyState title="No employees" /></td></tr>
              ) : (
                employees.map((e) => (
                  <tr key={e.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <div className="text-slate-900 font-medium">{e.name}{e.id === user.id && <span className="text-slate-400 font-normal"> (you)</span>}</div>
                      <div className="text-[10px] text-slate-400">{e.email}</div>
                    </td>
                    <td className="px-3 py-2">
                      {canManage && e.id !== user.id ? (
                        <select value={e.role} disabled={busy} onChange={(ev) => patch(e.id, { role: ev.target.value })} className="h-7 rounded bg-slate-50 border border-slate-200 px-1.5 text-[10px] text-slate-800">
                          {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
                        </select>
                      ) : <span className="text-slate-600">{e.role.replace(/_/g, " ")}</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{e.department || "—"}</td>
                    <td className="px-3 py-2"><StatusPill status={e.status === "active" ? "running" : "cancelled"} /></td>
                    <td className="px-3 py-2 text-slate-800 tabular-nums">{e.stats.assignedLeads}</td>
                    <td className="px-3 py-2 text-slate-800 tabular-nums">{e.stats.calls}</td>
                    <td className="px-3 py-2 text-slate-800 tabular-nums">{e.stats.messages}</td>
                    <td className="px-3 py-2 text-slate-800 tabular-nums">{e.stats.conversations}</td>
                    <td className="px-3 py-2 text-[#2563eb] tabular-nums font-semibold">{e.stats.conversions}</td>
                    <td className="px-3 py-2 text-slate-800 tabular-nums">{e.stats.followupsCompleted}</td>
                    {canManage && (
                      <td className="px-3 py-2 text-right">
                        {e.id !== user.id && (
                          <GhostButton
                            disabled={busy}
                            onClick={() => patch(e.id, { status: e.status === "active" ? "disabled" : "active" })}
                            className={`!h-7 !px-2 ${e.status === "active" ? "text-rose-600 border-rose-400/40" : "text-emerald-600 border-emerald-400/40"}`}>
                            {e.status === "active" ? "Disable" : "Enable"}
                          </GhostButton>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[10px] text-slate-400 leading-relaxed">
        <span className="text-[#2563eb] font-semibold">Roles:</span> Super Admin — full system · Admin — CRM & campaigns · Manager — team & lead management · Employee — assigned leads & communication · Viewer — read-only.
        All counters are computed live from real activity records.
      </div>
    </div>
  );
}
