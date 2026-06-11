import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  useNavigation,
  useRevalidator,
  Form,
} from "@remix-run/react";

/* Node backend base.
 * NOTE: this assumes VITE_BASE_URL already ends in /api/v1
 *       (so `${NODE_BASE}/admin/unsynced` -> /api/v1/admin/unsynced).
 *       If VITE_BASE_URL is just the host, change ADMIN to
 *       `${NODE_BASE}/api/v1/admin`. */
const NODE_BASE =
  (import.meta.env.VITE_BASE_URL as string) ||
  (typeof process !== "undefined" ? process.env.VITE_BASE_URL : "") ||
  "";
const ADMIN = `${NODE_BASE}/admin`;

/* Turns a 404 / HTML response (wrong path, unmounted route, or a frontend
 * catch-all serving index.html) into a clear error instead of the opaque
 * "Unexpected token '<', '<!DOCTYPE'...". */
async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const ct = res.headers.get("content-type") || "";
  if (!res.ok || !ct.includes("application/json")) {
    const snippet = (await res.text())
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    throw new Error(
      `Backend ${res.status} at ${url} — expected JSON, got ${ct || "no content-type"}: ${snippet || "(empty)"}`,
    );
  }
  return res.json();
}

type SyncState = { status?: string; attempts?: number; lastError?: string };
type OrderRow = {
  _id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  streetAddress?: string;
  streetAddress2?: string;
  productId?: string;
  subscription?: string;
  source?: string;
  createdAt?: string;
  shopifyOrderId?: string | null;
  shopifySync?: SyncState;
  sheetSync?: SyncState;
};
type RenewalRow = {
  _id: string;
  cycle?: string;
  status?: string;
  shopifyOrderId?: string | null;
  shopifySync?: SyncState;
  sheetSync?: SyncState;
  orderId?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    source?: string;
  } | null;
  createdAt?: string;
};

/* ----------------------------- loader ----------------------------- */
export async function loader(_args: LoaderFunctionArgs) {
  try {
    const body = await fetchJson(`${ADMIN}/unsynced`);
    const data = body?.data || { counts: {}, orders: [], renewals: [] };
    return { ok: true, data, adminBase: ADMIN };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || "Could not reach the backend",
      data: { counts: {}, orders: [], renewals: [] },
      adminBase: ADMIN,
    };
  }
}

/* ----------------------------- action ----------------------------- */
export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  const post = (path: string, payload?: unknown) =>
    fetchJson(`${ADMIN}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });

  try {
    if (intent === "sync-one") {
      const orderId = String(form.get("orderId") || "");
      const target = String(form.get("target") || "both");
      const r = await post("sync-one", { orderId, target });
      return { intent, result: r?.data || null, message: r?.message || "Done" };
    }
    if (intent === "reconcile") {
      const r = await post("reconcile", {});
      return {
        intent,
        result: r?.data || null,
        message: r?.message || "Reconcile complete",
      };
    }
    if (intent === "flush-sheets") {
      const r = await post("flush-sheets", {});
      return {
        intent,
        result: r?.data || null,
        message: r?.message || "Sheets flushed",
      };
    }
    return { intent, message: "Unknown action", error: true };
  } catch (e: any) {
    return { intent, message: e?.message || "Request failed", error: true };
  }
}

/* ----------------------------- helpers ---------------------------- */
const ACTIONABLE = ["pending", "failed"];
const isActionable = (s?: SyncState) => ACTIONABLE.includes(s?.status || "");
const cityOf = (source?: string) =>
  source === "Defent La" ? "Los Angeles" : "West Hollywood";
const fmtDate = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function Pill({ label, state }: { label: string; state?: SyncState }) {
  const s = state?.status || "pending";
  return (
    <span className={`sc-pill sc-pill--${s}`} title={state?.lastError || s}>
      <span className="sc-dot" />
      {label}
      <span className="sc-pill__state">{s}</span>
    </span>
  );
}

/* Source tag (LA / WeHo). Exact-match on "Defent La" — same logic the
 * backend uses to pick which sheet a row goes to. Tooltip shows the raw
 * source so you can spot any mis-spelled value that would route wrong. */
function SourceBadge({ source }: { source?: string }) {
  const la = source === "Defent La";
  return (
    <span
      className={`sc-src sc-src--${la ? "la" : "weho"}`}
      title={source || "unknown source"}
    >
      {la ? "LA" : "WeHo"}
    </span>
  );
}

/* --------------------------- component ---------------------------- */
export default function SyncedStatus() {
  const { ok, error, data, adminBase } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const revalidator = useRevalidator();

  const submitting = nav.state === "submitting";
  const subIntent = nav.formData?.get("intent");
  const subOrderId = nav.formData?.get("orderId");
  const subTarget = nav.formData?.get("target");

  const orders: OrderRow[] = data?.orders || [];
  const renewals: RenewalRow[] = data?.renewals || [];

  // Only show orders with a genuinely broken channel (skip intentional "skipped").
  const actionable = orders.filter(
    (o) => isActionable(o.shopifySync) || isActionable(o.sheetSync),
  );
  const renewalsActionable = renewals.filter(
    (r) =>
      isActionable(r.shopifySync) ||
      isActionable(r.sheetSync) ||
      r.status === "processing",
  );

  const allClear = actionable.length === 0 && renewalsActionable.length === 0;

  return (
    <div className="sync-console">
      <style>{css}</style>

      <header className="sc-header">
        <div>
          <h1 className="sc-title">Order sync</h1>
          <p className="sc-sub">
            Find orders that didn’t reach Shopify or the sheet, and re-push
            them.
          </p>
        </div>
        <div className="sc-counts">
          <span className="sc-count">
            <b>{actionable.length}</b> orders
          </span>
          <span className="sc-dotsep" />
          <span className="sc-count">
            <b>{renewalsActionable.length}</b> renewals
          </span>
        </div>
      </header>

      <div className="sc-bar">
        <Form method="post">
          <input type="hidden" name="intent" value="reconcile" />
          <button className="sc-btn sc-btn--primary" disabled={submitting}>
            {submitting && subIntent === "reconcile"
              ? "Syncing all…"
              : "Sync all unsynced"}
          </button>
        </Form>
        <Form method="post">
          <input type="hidden" name="intent" value="flush-sheets" />
          <button className="sc-btn sc-btn--ghost" disabled={submitting}>
            {submitting && subIntent === "flush-sheets"
              ? "Flushing…"
              : "Flush sheet queue"}
          </button>
        </Form>
        <a
          className="sc-btn sc-btn--ghost"
          href="/admin/export-unsynced"
          download
        >
          Export CSV
        </a>
        <button
          className="sc-btn sc-btn--ghost sc-btn--icon"
          onClick={() => revalidator.revalidate()}
          disabled={revalidator.state === "loading"}
          title="Refresh"
        >
          {revalidator.state === "loading" ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {!ok && (
        <div className="sc-banner sc-banner--err">
          <span>{error}</span>
          <span className="sc-banner__detail">
            Calling{" "}
            <code>{adminBase || "(empty — VITE_BASE_URL not set)"}</code>. Open{" "}
            <code>{adminBase}/unsynced</code> in a browser tab — if it returns
            HTML, the route isn’t mounted there.
          </span>
        </div>
      )}

      {actionData?.message && (
        <div className={`sc-banner ${bannerTone(actionData)}`}>
          <span>{actionData.message}</span>
          {actionData.result && (
            <span className="sc-banner__detail">{summarize(actionData)}</span>
          )}
        </div>
      )}

      {allClear ? (
        <div className="sc-empty">
          <div className="sc-empty__mark" />
          <h2>Everything’s synced</h2>
          <p>
            No orders are waiting on Shopify or the sheet. New misses will show
            up here.
          </p>
        </div>
      ) : (
        <>
          {actionable.length > 0 && (
            <section className="sc-card">
              <div className="sc-section-title">Orders</div>
              <table className="sc-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Address</th>
                    <th>Order</th>
                    <th>Created</th>
                    <th>Channels</th>
                    <th className="sc-th-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {actionable.map((o) => {
                    const needShopify = isActionable(o.shopifySync);
                    const needSheet = isActionable(o.sheetSync);
                    const rowBusy = submitting && subOrderId === o._id;
                    const err =
                      o.shopifySync?.lastError || o.sheetSync?.lastError;
                    return (
                      <tr key={o._id}>
                        <td>
                          <div className="sc-cust">
                            <span>
                              {[o.firstName, o.lastName]
                                .filter(Boolean)
                                .join(" ") || "—"}
                            </span>
                            <SourceBadge source={o.source} />
                          </div>
                          <div className="sc-mono sc-muted">{o.email}</div>
                        </td>
                        <td>
                          <div>
                            {o.streetAddress}
                            {o.streetAddress2 ? `, ${o.streetAddress2}` : ""}
                          </div>
                          <div className="sc-muted">{cityOf(o.source)}</div>
                        </td>
                        <td>
                          <div className="sc-tag">{o.subscription}</div>
                          <div className="sc-mono sc-muted sc-trunc">
                            {o.productId}
                          </div>
                        </td>
                        <td className="sc-muted">{fmtDate(o.createdAt)}</td>
                        <td>
                          <div className="sc-channels">
                            <Pill label="Shopify" state={o.shopifySync} />
                            <Pill label="Sheet" state={o.sheetSync} />
                          </div>
                          {err && (
                            <div className="sc-rowerr" title={err}>
                              {err}
                            </div>
                          )}
                        </td>
                        <td>
                          <Form method="post" className="sc-actions">
                            <input
                              type="hidden"
                              name="intent"
                              value="sync-one"
                            />
                            <input type="hidden" name="orderId" value={o._id} />
                            {needSheet && (
                              <button
                                name="target"
                                value="sheet"
                                className="sc-btn sc-btn--sm"
                                disabled={submitting}
                              >
                                {rowBusy && subTarget === "sheet"
                                  ? "Adding…"
                                  : "Add to sheet"}
                              </button>
                            )}
                            {needShopify && (
                              <button
                                name="target"
                                value="shopify"
                                className="sc-btn sc-btn--sm"
                                disabled={submitting}
                              >
                                {rowBusy && subTarget === "shopify"
                                  ? "Sending…"
                                  : "Send to Shopify"}
                              </button>
                            )}
                            {needSheet && needShopify && (
                              <button
                                name="target"
                                value="both"
                                className="sc-btn sc-btn--sm sc-btn--primary"
                                disabled={submitting}
                              >
                                {rowBusy && subTarget === "both"
                                  ? "Syncing…"
                                  : "Sync both"}
                              </button>
                            )}
                          </Form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {renewalsActionable.length > 0 && (
            <section className="sc-card">
              <div className="sc-section-title">
                Renewals
                <span className="sc-section-note">
                  Handled by “Sync all unsynced” + “Flush sheet queue”.
                </span>
              </div>
              <table className="sc-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Cycle</th>
                    <th>State</th>
                    <th>Created</th>
                    <th>Channels</th>
                  </tr>
                </thead>
                <tbody>
                  {renewalsActionable.map((r) => (
                    <tr key={r._id}>
                      <td>
                        <div className="sc-cust">
                          <span>
                            {[r.orderId?.firstName, r.orderId?.lastName]
                              .filter(Boolean)
                              .join(" ") || "—"}
                          </span>
                          <SourceBadge source={r.orderId?.source} />
                        </div>
                        <div className="sc-mono sc-muted">
                          {r.orderId?.email}
                        </div>
                      </td>
                      <td className="sc-mono">{r.cycle}</td>
                      <td>
                        <span className={`sc-tag sc-tag--${r.status}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="sc-muted">{fmtDate(r.createdAt)}</td>
                      <td>
                        <div className="sc-channels">
                          <Pill label="Shopify" state={r.shopifySync} />
                          <Pill label="Sheet" state={r.sheetSync} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/* --------------------------- banner utils ------------------------- */
function bannerTone(a: any) {
  if (a?.error) return "sc-banner--err";
  const r = a?.result;
  if (
    r &&
    (String(r.sheet || "").startsWith("failed") ||
      String(r.shopify || "").startsWith("failed"))
  ) {
    return "sc-banner--warn";
  }
  return "sc-banner--ok";
}
function summarize(a: any) {
  const r = a?.result;
  if (!r) return "";
  if (a.intent === "sync-one")
    return `Shopify: ${r.shopify} · Sheet: ${r.sheet}`;
  if (a.intent === "reconcile")
    return `Shopify retried: ${r.firstTimeRetried ?? 0} · Renewals: ${r.renewalsRetried ?? 0} · Sheet rows: ${(r.sheet?.firstTime ?? 0) + (r.sheet?.renewals ?? 0)}`;
  if (a.intent === "flush-sheets")
    return `First-time: ${r.firstTime ?? 0} · Renewals: ${r.renewals ?? 0}`;
  return "";
}

/* ------------------------------- css ------------------------------ */
const css = `
.sync-console{
  --ink:#14181f; --muted:#6b7280; --line:#e6e8eb; --bg:#f6f7f9; --surface:#fff;
  --primary:#2b50ec; --primary-ink:#fff;
  --green:#15784c; --green-bg:#e7f4ee; --amber:#9a6700; --amber-bg:#fdf3df;
  --red:#c02b2b; --red-bg:#fbeaea; --slate:#7a828c; --slate-bg:#eef0f2;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color:var(--ink); background:var(--bg); min-height:100vh;
  padding:28px clamp(16px,4vw,40px); -webkit-font-smoothing:antialiased;
}
.sync-console *{box-sizing:border-box;}
.sc-mono{font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size:12px;}
.sc-muted{color:var(--muted);}
.sc-trunc, .sc-rowerr{max-width:170px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}

.sc-header{display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:18px; flex-wrap:wrap;}
.sc-title{font-size:24px; font-weight:680; letter-spacing:-.02em; margin:0;}
.sc-sub{margin:4px 0 0; color:var(--muted); font-size:14px;}
.sc-counts{display:flex; align-items:center; gap:12px; font-size:14px; color:var(--muted);}
.sc-count b{color:var(--ink); font-weight:650;}
.sc-dotsep{width:4px; height:4px; border-radius:50%; background:var(--line);}

.sc-bar{display:flex; gap:10px; flex-wrap:wrap; margin-bottom:18px;}
.sc-btn{
  appearance:none; border:1px solid var(--line); background:var(--surface); color:var(--ink);
  font:inherit; font-size:13px; font-weight:560; padding:9px 14px; border-radius:9px; cursor:pointer;
  transition:background .12s ease, border-color .12s ease, transform .04s ease; text-decoration:none; display:inline-flex; align-items:center;
}
.sc-btn:hover{background:#fafbfc; border-color:#d6d9dd;}
.sc-btn:active{transform:translateY(1px);}
.sc-btn:disabled{opacity:.55; cursor:default;}
.sc-btn--primary{background:var(--primary); border-color:var(--primary); color:var(--primary-ink);}
.sc-btn--primary:hover{background:#2244d6; border-color:#2244d6;}
.sc-btn--ghost{background:transparent;}
.sc-btn--sm{padding:6px 11px; font-size:12px; border-radius:8px;}

.sc-banner{display:flex; gap:14px; align-items:center; padding:11px 14px; border-radius:10px; font-size:13.5px; margin-bottom:16px; border:1px solid transparent;}
.sc-banner__detail{color:var(--muted); font-size:12.5px;}
.sc-banner--ok{background:var(--green-bg); border-color:#cfe8da; color:#0f5c3a;}
.sc-banner--warn{background:var(--amber-bg); border-color:#f2e2b8; color:#7a5200;}
.sc-banner--err{background:var(--red-bg); border-color:#f1cccc; color:#9a1f1f;}
.sc-banner code{font-family:ui-monospace,monospace; font-size:12px;}

.sc-card{background:var(--surface); border:1px solid var(--line); border-radius:14px; margin-bottom:18px; overflow:hidden;}
.sc-section-title{display:flex; align-items:baseline; gap:10px; font-size:13px; font-weight:640; letter-spacing:.02em; text-transform:uppercase; color:var(--muted); padding:14px 18px; border-bottom:1px solid var(--line);}
.sc-section-note{text-transform:none; letter-spacing:0; font-weight:450; font-size:12px;}

.sc-table{width:100%; border-collapse:collapse; font-size:13.5px;}
.sc-table th{text-align:left; font-weight:560; color:var(--muted); font-size:12px; padding:10px 18px; border-bottom:1px solid var(--line); background:#fcfcfd;}
.sc-th-actions{text-align:right;}
.sc-table td{padding:14px 18px; border-bottom:1px solid var(--line); vertical-align:top;}
.sc-table tr:last-child td{border-bottom:none;}
.sc-table tbody tr:hover{background:#fcfcfd;}
.sc-cust{font-weight:560; display:flex; align-items:center; gap:8px;}
.sc-src{display:inline-block; font-size:10px; font-weight:680; letter-spacing:.04em; padding:1px 6px; border-radius:5px; text-transform:uppercase; flex:none;}
.sc-src--la{background:#ece6fb; color:#4a2fb0;}
.sc-src--weho{background:#e2f0fb; color:#1f5d9a;}

.sc-tag{display:inline-block; font-size:11.5px; padding:2px 8px; border-radius:6px; background:var(--slate-bg); color:#3f464e; font-weight:560;}
.sc-tag--processing{background:var(--amber-bg); color:#7a5200;}
.sc-tag--failed{background:var(--red-bg); color:#9a1f1f;}

.sc-channels{display:flex; flex-direction:column; gap:6px; align-items:flex-start;}
.sc-pill{display:inline-flex; align-items:center; gap:7px; font-size:12px; font-weight:560; padding:3px 9px 3px 8px; border-radius:999px; border:1px solid transparent;}
.sc-pill__state{font-weight:450; opacity:.7; font-size:11px;}
.sc-dot{width:7px; height:7px; border-radius:50%; background:currentColor;}
.sc-pill--synced{background:var(--green-bg); color:var(--green); border-color:#cfe8da;}
.sc-pill--pending{background:var(--amber-bg); color:var(--amber); border-color:#f2e2b8;}
.sc-pill--failed{background:var(--red-bg); color:var(--red); border-color:#f1cccc;}
.sc-pill--skipped{background:var(--slate-bg); color:var(--slate); border-color:#dfe3e6;}
.sc-rowerr{margin-top:6px; font-size:11.5px; color:var(--red);}

.sc-actions{display:flex; gap:7px; justify-content:flex-end; flex-wrap:wrap;}

.sc-empty{background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:56px 24px; text-align:center;}
.sc-empty__mark{width:34px; height:34px; border-radius:50%; margin:0 auto 14px; background:var(--green-bg); position:relative;}
.sc-empty__mark:after{content:""; position:absolute; left:12px; top:9px; width:7px; height:13px; border:solid var(--green); border-width:0 2px 2px 0; transform:rotate(40deg);}
.sc-empty h2{margin:0 0 6px; font-size:18px; font-weight:640;}
.sc-empty p{margin:0; color:var(--muted); font-size:14px;}

@media (max-width:720px){
  .sc-table thead{display:none;}
  .sc-table, .sc-table tbody, .sc-table tr, .sc-table td{display:block; width:100%;}
  .sc-table tr{border-bottom:1px solid var(--line); padding:6px 0;}
  .sc-table td{border:none; padding:6px 18px;}
  .sc-actions{justify-content:flex-start;}
}
`;
