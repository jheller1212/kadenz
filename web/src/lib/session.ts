// Uses Web Crypto API — compatible with both Edge Runtime (proxy) and Node.js runtime (API routes).

const COOKIE_NAME = "session";
const SESSION_VALUE = "authenticated";

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET env var is not set");
  return secret;
}

async function hmacSign(value: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function hmacVerify(value: string, signature: string, secret: string): Promise<boolean> {
  const expected = await hmacSign(value, secret);
  if (expected.length !== signature.length) return false;
  // Constant-time compare via XOR
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export async function makeSessionCookie(): Promise<string> {
  const secret = getSecret();
  const sig = await hmacSign(SESSION_VALUE, secret);
  const signed = `${SESSION_VALUE}.${sig}`;
  // HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=30 days
  return `${COOKIE_NAME}=${signed}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`;
}

/** Expired cookie header that clears the session (logout). */
export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function validateSessionCookie(cookieHeader: string | null): Promise<boolean> {
  if (!cookieHeader) return false;
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k.trim(), v.join("=").trim()];
    })
  );
  const signed = cookies[COOKIE_NAME];
  if (!signed) return false;

  const dotIndex = signed.lastIndexOf(".");
  if (dotIndex === -1) return false;
  const value = signed.slice(0, dotIndex);
  const signature = signed.slice(dotIndex + 1);

  try {
    const secret = getSecret();
    return await hmacVerify(value, signature, secret);
  } catch {
    return false;
  }
}
