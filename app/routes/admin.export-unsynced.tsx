import type { LoaderFunctionArgs } from "@remix-run/node";

/* Same base convention as the dashboard (VITE_BASE_URL ends in /api/v1). */
const NODE_BASE =
  (import.meta.env.VITE_BASE_URL as string) ||
  (typeof process !== "undefined" ? process.env.VITE_BASE_URL : "") ||
  "";
const ADMIN = `${NODE_BASE}/admin`;

/* ------------------------------------------------------------------ *
 *  Resource route → URL: /admin/export-unsynced
 *  File name: app/routes/admin.export-unsynced.tsx
 *
 *  No dot in the URL on purpose — the earlier `/admin/unsynced.csv`
 *  needed an escaped filename ([.]) that didn't register ("No route
 *  matches"). The download still arrives as unsynced-orders.csv because
 *  the Content-Disposition header sets the name, not the URL.
 *
 *  This route has NO default export, so Remix treats it as a resource
 *  route and returns the Response as-is. It proxies the Node CSV so the
 *  download is same-origin (a cross-origin <a> gets blocked in the
 *  embedded Shopify app iframe).
 * ------------------------------------------------------------------ */
export async function loader(_args: LoaderFunctionArgs) {
  const upstream = await fetch(`${ADMIN}/export/unsynced.csv`);

  if (!upstream.ok) {
    const detail = (await upstream.text()).slice(0, 200);
    return new Response(
      `Could not generate CSV (backend ${upstream.status}). ${detail}`,
      {
        status: 502,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  }

  const csv = await upstream.text();
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="unsynced-orders.csv"',
      "Cache-Control": "no-store",
    },
  });
}
