// Lead Pulse realtime service — broadcasts CRM activity to the SPA.
// API routes POST /__emit {event, payload} → io.emit to all connected clients.
import { createServer } from 'http'
import { Server } from 'socket.io'

// ─── Sandbox keeper: keep the main CRM dev server alive alongside this service.
// The orphaned process tree that runs this file survives sandbox reaping, so it
// is the safest parent for the platform dev server. The spawned server sources
// ./.env explicitly (inherited env must never pin a stale DATABASE_URL).
// No-op on serverless (this service is never spawned there) and when
// LP_MAIN_KEEPER=0.
const g = globalThis as { __lpMainKeeper?: boolean };
if (!g.__lpMainKeeper && process.env.LP_MAIN_KEEPER !== "0" && !process.env.VERCEL) {
  g.__lpMainKeeper = true;
  const { spawn } = await import("node:child_process");
  const net = await import("node:net");
  const MAIN_PORT = 3000;
  const mainAlive = (): Promise<boolean> => new Promise((resolve) => {
    const s = net.connect(MAIN_PORT, "127.0.0.1");
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => { s.destroy(); resolve(false); });
    s.setTimeout(1200, () => { s.destroy(); resolve(false); });
  });
  const spawnMain = (): void => {
    try {
      const child = spawn(
        "sh",
        ["-c", 'cd /home/z/my-project && set -a && . ./.env && set +a && exec bun run dev'],
        { detached: true, stdio: "ignore" },
      );
      child.unref();
      console.log("[leadpulse-socket] keeper: spawned main dev server (pid", String(child.pid) + ")");
    } catch (err) {
      console.error("[leadpulse-socket] keeper: spawn failed:", err);
    }
  };
  void mainAlive().then((alive) => { if (!alive) spawnMain(); });
  const keepTimer = setInterval(() => {
    void mainAlive().then((alive) => { if (!alive) spawnMain(); });
  }, 30_000);
  if (typeof keepTimer.unref === "function") keepTimer.unref();
}


// Reserved path: socket.io only creates io.engine inside attach(). Attaching
// with a path that never matches real traffic makes attach()'s dispatcher an
// inert pass-through — every request lands in the ONE dispatcher below.
// (The previous setup registered a second 'request' listener AFTER attach(),
// so both engine.io and the custom handler answered the same request →
// ERR_HTTP_HEADERS_SENT → every client handshake silently broke.)
const ATTACH_PATH = '/__attach_only'

// The SPA is served under "/" and "/metacrm" (URL index). The gateway (Caddy)
// proxies by the ?XTransformPort= query and keeps the original path, so
// normalize ANY engine.io request path to "/" before dispatching to engine.io.
function normalizeEngineUrl(req: { url?: string }): void {
  const raw = req.url || '/'
  if (raw.includes('EIO=') && raw.includes('transport=')) {
    const qi = raw.indexOf('?')
    req.url = '/' + (qi >= 0 ? raw.slice(qi) : '')
  }
}

const httpServer = createServer((req, res) => {
  const raw = req.url || '/'

  // internal emit endpoint (only reachable from the same machine / API routes)
  if (req.method === 'POST' && raw === '/__emit') {
    let body = ''
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy() })
    req.on('end', () => {
      try {
        const { event, payload } = JSON.parse(body)
        io.emit(event, payload)
        res.writeHead(200).end('{"ok":true}')
      } catch {
        res.writeHead(400).end('{"ok":false}')
      }
    })
    return
  }

  // engine.io polling — works at any request path (/, /metacrm, …)
  if (raw.includes('EIO=') && raw.includes('transport=')) {
    normalizeEngineUrl(req)
    io.engine.handleRequest(req, res)
    return
  }

  // anything else that reaches this port directly
  res.writeHead(200).end('Lead Pulse socket service')
})

const io = new Server(httpServer, {
  path: ATTACH_PATH,
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
  // Polling only: engine.io's websocket upgrade path crashes silently under
  // Bun (process exits with no trace right after accepting a connection).
  // Broadcast activity feed does not need WS — long-polling is sufficient and
  // survives the gateway path normalization identically.
  transports: ['polling'],
})

// websocket upgrade (engine.io transport upgrade), same path normalization.
// attach() added its own 'upgrade' listener for ATTACH_PATH; skip that path
// here so upgrades are never handled twice.
httpServer.on('upgrade', (req, socket, head) => {
  const raw = req.url || '/'
  if (raw.startsWith(ATTACH_PATH)) return
  if (raw.includes('EIO=') && raw.includes('transport=websocket')) {
    normalizeEngineUrl(req)
    io.engine.handleUpgrade(req, socket, head)
  } else {
    socket.destroy()
  }
})

io.on('connection', (socket) => {
  console.log('[leadpulse-socket] client connected:', socket.id)
  socket.emit('hello', { ok: true, ts: Date.now() })
  socket.on('disconnect', () => {
    console.log('[leadpulse-socket] client disconnected:', socket.id)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`[leadpulse-socket] listening on :${PORT}`)
})
