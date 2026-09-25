"use client";

import { useState, useRef } from "react";
import { api } from "@/lib/lp/api";
import { KpiCard, SectionTitle, GoldButton, GhostButton, StatusPill } from "./bits";

type ParsedRow = {
  rowNumber: number; values: Record<string, string>; warnings: string[]; errors: string[];
  email: string | null; whatsapp: { e164: string | null; valid: boolean; raw: string };
  duplicate: "file" | "db" | null; valid: boolean; inferredCountry: string | null;
};
type Preview = {
  headers: string[]; mapping: Record<string, string | null>;
  totalRows: number; validRows: number; invalidRows: number;
  duplicatesInFile: number; duplicatesInDb: number;
  missingPhone: number; missingWhatsapp: number; missingEmail: number;
  rows: ParsedRow[]; errorSamples: { row: number; error: string }[];
};

export default function ImportView({ onImported }: { onImported: () => void }) {
  const [csvText, setCsvText] = useState("");
  const [filename, setFilename] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = (file: File) => {
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result || ""));
      setPreview(null);
      setResult(null);
    };
    reader.readAsText(file);
  };

  const runPreview = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ preview: Preview }>("/api/lp/leads/import/preview", {
        method: "POST", body: JSON.stringify({ csv: csvText }),
      });
      setPreview(data.preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ imported: number; skipped: number }>("/api/lp/leads/import/commit", {
        method: "POST", body: JSON.stringify({ csv: csvText, importValidOnly: true }),
      });
      setResult(data);
      setPreview(null);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const sample = `First Name,Last Name,Company,Country,WhatsApp,Phone,Email,Industry,Lead Source,Lead Score,Tags
Bilal,Hassan,StreamFlix PK,PK,+92 321 4567890,bilal@streamflix.pk,Media,Website,72,hot
Ayesha,Malik,GameHub AE,AE,+971 50 123 4567,ayesha@gamehub.ae,Gaming,Referral,85,enterprise
Bad Row,Missing Phone,,,not-an-email,,,,,`;

  return (
    <div className="space-y-5">
      <SectionTitle>CSV Lead Import</SectionTitle>

      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) readFile(f); }}
        className={`rounded-xl border-2 border-dashed p-8 text-center transition ${dragOver ? "border-[#3d7ff7]/60 bg-[#3d7ff7]/[0.06]" : "border-slate-300 bg-slate-50"}`}
      >
        <div className="text-sm text-slate-600">Drag & drop your CSV here, or</div>
        <div className="flex items-center justify-center gap-2 mt-3">
          <GoldButton onClick={() => fileRef.current?.click()}>Browse Files</GoldButton>
          <GhostButton onClick={() => { setCsvText(sample); setFilename("sample-leads.csv"); setPreview(null); setResult(null); }}>Load Sample CSV</GhostButton>
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }} />
        {filename && <div className="text-[11px] text-slate-400 mt-3">Loaded: {filename} ({(csvText.length / 1024).toFixed(1)} KB)</div>}
      </div>

      {csvText && !result && (
        <div className="flex gap-2">
          <GoldButton disabled={busy} onClick={runPreview}>{busy ? "Validating…" : "Validate & Preview"}</GoldButton>
          {preview && preview.validRows > 0 && (
            <GhostButton disabled={busy} onClick={commit} className="border-emerald-400/40 text-emerald-600">
              Import {preview.validRows} Valid Records
            </GhostButton>
          )}
        </div>
      )}

      {error && <div className="text-xs text-rose-600 bg-rose-500/10 border border-rose-400/20 rounded-lg px-3 py-2">{error}</div>}

      {result && (
        <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/[0.06] p-4">
          <div className="text-sm font-semibold text-emerald-600">Import complete</div>
          <div className="text-xs text-slate-600 mt-1">{result.imported} leads imported · {result.skipped} skipped (invalid/duplicates) · every lead got a permanent timeline entry.</div>
          <GhostButton className="mt-3" onClick={() => { setResult(null); setCsvText(""); setFilename(""); }}>Import another file</GhostButton>
        </div>
      )}

      {preview && !result && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <KpiCard label="Total Records" value={preview.totalRows} />
            <KpiCard label="Valid Records" value={preview.validRows} tone="success" />
            <KpiCard label="Invalid Records" value={preview.invalidRows} tone={preview.invalidRows ? "danger" : "default"} />
            <KpiCard label="Duplicates" value={preview.duplicatesInFile + preview.duplicatesInDb} />
            <KpiCard label="Missing Phone" value={preview.missingPhone} />
            <KpiCard label="Missing WhatsApp" value={preview.missingWhatsapp} />
            <KpiCard label="Missing Email" value={preview.missingEmail} />
          </div>

          {/* Column mapping */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">Detected column mapping</div>
            <div className="flex flex-wrap gap-2">
              {preview.headers.map((h) => (
                <span key={h} className="text-[10px] px-2 py-1 rounded border border-slate-200 bg-white">
                  <span className="text-slate-600">{h}</span>
                  <span className="mx-1 text-slate-400">→</span>
                  <span className={preview.mapping[h] ? "text-[#2563eb]" : "text-rose-600"}>{preview.mapping[h] || "ignored"}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Row preview */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">Row validation preview (first {Math.min(preview.rows.length, 50)} rows)</div>
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#ffffff]">
                  <tr className="text-left text-[10px] uppercase text-slate-400 border-b border-slate-200">
                    <th className="px-3 py-2">#</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Company</th>
                    <th className="px-3 py-2">WhatsApp (normalized)</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 50).map((r) => (
                    <tr key={r.rowNumber} className={`border-b border-slate-100 ${r.valid ? "" : "bg-rose-500/[0.04]"}`}>
                      <td className="px-3 py-1.5 text-slate-400">{r.rowNumber}</td>
                      <td className="px-3 py-1.5 text-slate-800">{[r.values.firstName, r.values.lastName].filter(Boolean).join(" ") || "—"}</td>
                      <td className="px-3 py-1.5 text-slate-600">{r.values.company || "—"}</td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {r.whatsapp.e164 ? (
                          <span className={r.whatsapp.valid ? "text-emerald-600" : "text-amber-600"}>{r.whatsapp.e164}{!r.whatsapp.valid && " (unverified)"}</span>
                        ) : <span className="text-rose-600">{r.whatsapp.raw || "missing"}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">{r.email || <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-1.5">
                        {r.valid ? <StatusPill status="queued" /> : r.duplicate ? <span className="text-[10px] text-amber-600">duplicate ({r.duplicate})</span> : <span className="text-[10px] text-rose-600">{r.errors[0]}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Error samples */}
          {preview.errorSamples.length > 0 && (
            <div className="rounded-xl border border-rose-400/20 bg-rose-500/[0.04] p-4">
              <div className="text-[10px] uppercase tracking-wider text-rose-600/80 mb-2">Validation errors (first 50)</div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {preview.errorSamples.map((e, i) => (
                  <div key={i} className="text-[11px] text-slate-500">Row {e.row}: <span className="text-rose-600">{e.error}</span></div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
