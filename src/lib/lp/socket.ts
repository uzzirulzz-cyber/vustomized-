// Internal emitter → Lead Pulse socket.io mini-service (port 3003).
// API routes call this fire-and-forget; the mini-service broadcasts to the SPA.
const SOCKET_PORT = process.env.LP_SOCKET_PORT || 3003;

export function emitToSocket(event: string, payload: unknown): void {
  const url = `http://127.0.0.1:${SOCKET_PORT}/__emit`;
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, payload }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {
    /* socket service down — never block the API */
  });
}
