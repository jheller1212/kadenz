// Lightweight session probe. The proxy (src/proxy.ts) gates every /api/* route
// behind a valid session cookie, so this returns 200 only when authenticated —
// the client uses it to decide whether to show the Connect screen.
export async function GET() {
  return Response.json({ authenticated: true });
}
