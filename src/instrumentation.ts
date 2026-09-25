// Next.js instrumentation hook — runs once per server process start.
// Spawns + babysits the leadpulse-socket realtime mini-service (port 3003).
//
// Why here: sandbox-managed background processes started from ad-hoc shells
// are reaped shortly after the spawning shell exits. The main Next.js server
// is platform-owned and persistent, so the mini-service is spawned as its
// child and inherits that lifetime. If it ever dies, a 60s health check
// respawns it — "keep it on" by construction.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Serverless (Vercel): no persistent process tree, no bindable TCP port and
  // no client that could reach one — the keeper is a sandbox-only facility.
  if (process.env.VERCEL) return;

  const g = globalThis as { __lpSocketKeeper?: boolean };
  if (g.__lpSocketKeeper) return;
  g.__lpSocketKeeper = true;

  const { spawn } = await import("node:child_process");
  const net = await import("node:net");
  const fs = await import("node:fs");
  const path = await import("node:path");

  const PORT = 3003;
  const cwd = path.join(process.cwd(), "mini-services", "leadpulse-socket");
  let logFd: number | null = null;

  function isAlive(): Promise<boolean> {
    return new Promise((resolve) => {
      const s = net.connect(PORT, "127.0.0.1");
      s.once("connect", () => { s.destroy(); resolve(true); });
      s.once("error", () => { s.destroy(); resolve(false); });
      s.setTimeout(1500, () => { s.destroy(); resolve(false); });
    });
  }

  async function ensureService(): Promise<void> {
    try {
      if (await isAlive()) return;
      if (logFd === null) {
        logFd = fs.openSync(path.join(cwd, "dev.log"), "a");
      }
      const child = spawn("bun", ["run", "dev"], {
        cwd,
        env: process.env,
        stdio: ["ignore", logFd, logFd],
      });
      child.unref();
      console.log(
        `[lp-socket-keeper] spawned leadpulse-socket (pid ${String(child.pid)})`
      );
    } catch (err) {
      console.error("[lp-socket-keeper] spawn failed:", err);
    }
  }

  await ensureService();
  // periodic health check — never holds the event loop open
  const timer = setInterval(() => { void ensureService(); }, 60_000);
  if (typeof timer.unref === "function") timer.unref();
}
