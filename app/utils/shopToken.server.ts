import { sessionStorage } from "app/shopify.server";

/* ------------------------------------------------------------------ *
 *  Finds an Admin API token for a store, so nobody has to paste one.
 *
 *  Tried in this order:
 *   1. The token Shopify gave the app when it was installed/opened in
 *      that store's admin (saved as the "offline" session). Permanent.
 *   2. Client credentials (client id + secret). Only works for stores in
 *      the same Shopify organization as the app. Lasts 24h, so we cache
 *      it and fetch a new one shortly before it runs out.
 *   3. VITE_SHOPIFY_ACCESS_TOKEN from .env (old pasted shpat_ token).
 * ------------------------------------------------------------------ */

const cache = new Map<string, { token: string; expiresAt: number }>();

async function fromSavedSession(shop: string) {
  try {
    const session = await sessionStorage.loadSession(`offline_${shop}`);
    if (!session?.accessToken) return null;
    if (session.expires && session.expires.getTime() < Date.now()) return null;
    return session.accessToken;
  } catch (e: any) {
    console.warn("[shopToken] could not read saved session:", e?.message);
    return null;
  }
}

async function fromClientCredentials(shop: string) {
  const cached = cache.get(shop);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const clientId = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    // e.g. 400 shop_not_permitted when the store is in another organization
    console.warn(`[shopToken] client credentials failed for ${shop}: HTTP ${res.status}`);
    return null;
  }

  const json: any = await res.json();
  if (!json?.access_token) return null;

  // Renew 5 minutes before Shopify's expiry.
  const lifetimeMs = ((json.expires_in ?? 86399) - 300) * 1000;
  cache.set(shop, { token: json.access_token, expiresAt: Date.now() + lifetimeMs });
  return json.access_token as string;
}

export async function getShopToken(shop: string): Promise<string | null> {
  return (
    (await fromSavedSession(shop)) ||
    (await fromClientCredentials(shop)) ||
    (import.meta.env.VITE_SHOPIFY_ACCESS_TOKEN as string) ||
    null
  );
}
