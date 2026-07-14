/* ------------------------------------------------------------------ *
 *  shopifyClient.ts  (Remix side)
 *
 *  ⚠⚠  BUG #2 WAS HERE: `findShopifyOrderByTag` was a STUB.  ⚠⚠
 *
 *      export async function findShopifyOrderByTag(...) {
 *        // TODO: query Shopify by tag `dbid:<orderId>[;cycle:<cycle>]`
 *        return null;                        // <-- ALWAYS null
 *      }
 *
 *  Every "heal instead of duplicate" path in the app called this, got
 *  `null`, concluded "Shopify doesn't have it", and created a new order.
 *  Combined with Orders.tsx dropping the `dbid:` tag entirely, retries
 *  could not possibly de-duplicate. That is your multiple-orders bug.
 *
 *  ⚠⚠  BUG #3 WAS ALSO HERE (indirectly).  ⚠⚠
 *  is429(err) reads `err.response.status`. But CreateOrderREST's catch
 *  block re-threw a bare `new Error(message)`, which has NO `.response`.
 *  So is429() was ALWAYS false and this file's 429 backoff — the whole
 *  point of the file — never ran once. Fixed in Orders.tsx by preserving
 *  `.response` on the rethrown error.
 *
 *  ---------------------------------------------------------------
 *  WHY THE LOOKUP NEEDS TWO STRATEGIES
 *
 *  Shopify's REST /orders.json cannot filter by tag at all — tag search
 *  only exists in GraphQL (`orders(query: "tag:...")`). But GraphQL tag
 *  search hits a SEARCH INDEX, and that index lags behind writes by a
 *  second or three. On a fast retry the order can exist and still not be
 *  findable by tag yet — which would hand us a false "not found" and we'd
 *  duplicate anyway.
 *
 *  So:
 *    1. Try `tag:'dbid:<id>'`   (cheap, exact, usually instant)
 *    2. If empty, list this customer's recent orders by EMAIL and match
 *       the tag CLIENT-SIDE on the returned nodes. Email is indexed on
 *       the order record itself, so this path does not depend on the tag
 *       index at all. It is the one that saves us during a retry storm.
 * ------------------------------------------------------------------ */

import { CreateOrderREST } from "app/utils/Orders";

const MIN_INTERVAL_MS = Number(process.env.SHOPIFY_PACE_MS || 550);
const MAX_RETRIES = Number(process.env.SHOPIFY_MAX_RETRIES || 5);
const MAX_BACKOFF_MS = Number(process.env.SHOPIFY_MAX_BACKOFF_MS || 30_000);

/* ------------------------------------------------------------------ *
 *  ⚠ THE ORDER-CAP RETRY BUDGET IS SEPARATE, AND IT IS SMALL. ⚠
 *
 *  My first version slept 61s and allowed all 5 retries — a worst case of
 *  305 seconds inside a single HTTP request. But the caller (reconcileCron
 *  / cron.js) only waits 45s. So Node ABANDONED the request 260 seconds
 *  before Remix finished, logged a timeout, and burned an attempt. The
 *  RenewalLog just sat there at status:"processing" forever.
 *
 *  The fix isn't a bigger timeout — it's realising we never needed to
 *  sleep in the first place:
 *
 *      the dev-store cap window resets in    60 seconds
 *      reconcileCron comes back every        10 minutes
 *
 *  By the time the reconciler returns, the window is long clear. So we try
 *  ONCE more after a minute (cheap, often enough), and if that still fails
 *  we hand it straight back. The reconciler will pick it up with a fresh
 *  window. Worst case inside the request: ~65s — comfortably under the
 *  caller's timeout.
 * ------------------------------------------------------------------ */
const ORDER_LIMIT_MAX_RETRIES = Number(
  process.env.SHOPIFY_ORDER_LIMIT_RETRIES || 1,
);

/* ---- process-wide pacing queue (serializes + spaces calls) ---- */
let chain: Promise<unknown> = Promise.resolve();
let lastRunAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = Math.max(0, lastRunAt + MIN_INTERVAL_MS - Date.now());
    if (wait) await sleep(wait);
    lastRunAt = Date.now();
    return fn();
  };
  const next = chain.then(run, run);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next as Promise<T>;
}

function is429(err: any) {
  return err?.response?.status === 429 || err?.status === 429;
}

/* ------------------------------------------------------------------ *
 *  ⚠ THERE ARE **TWO** DIFFERENT 429s AND THEY NEED DIFFERENT BACKOFFS.
 *
 *  (1) THE LEAKY BUCKET — the normal REST limit. 40 burst, leaks 2/sec.
 *      When you trip it, the header shows a FULL bucket:
 *          x-shopify-shop-api-call-limit: 40/40
 *      Sub-second backoff clears it. This is what everyone means by
 *      "Shopify rate limit".
 *
 *  (2) THE ORDER-CREATION CAP — dev/trial stores ONLY. Roughly 3-5 new
 *      orders per MINUTE. It is a completely separate limiter, and the
 *      giveaway is that the bucket is nearly EMPTY when it fires:
 *
 *          x-shopify-shop-api-call-limit: 1/40      <-- 1 of 40 used!
 *          errors: "Exceeded order API rate limit, please try again in a
 *                   minute. Upgrade to a paid account to remove this limit."
 *
 *      Exponential backoff from 500ms gives you 0.5+1+2+4+8 = ~15s across
 *      5 retries. The window is SIXTY seconds. You will always exhaust
 *      your retries and lose the order — which is exactly what happened.
 *
 *      So when we see this one, we wait out the full minute instead.
 *
 *  Production (a paid plan) has limiter (1) only. Limiter (2) is a
 *  dev-store artifact — don't tune the whole system around it, just
 *  survive it while testing.
 * ------------------------------------------------------------------ */
function isOrderCreationLimit(err: any) {
  if (!is429(err)) return false;
  const body = err?.response?.data;
  const text = typeof body === "string" ? body : JSON.stringify(body ?? {});
  return /exceeded order api rate limit/i.test(text);
}

/* ------------------------------------------------------------------ *
 *  ⚠ THE MOST IMPORTANT DISTINCTION IN THIS FILE ⚠
 *
 *  Not every failure is safe to retry. There are two very different kinds:
 *
 *  SAFE (429)  — Shopify DEFINITIVELY rejected the request. The rate
 *                limiter answered before the order was ever created.
 *                Nothing exists on their side. Retrying is free.
 *
 *  AMBIGUOUS   — timeout, dropped socket (ECONNRESET), 5xx. We do NOT
 *  (everything    know whether Shopify created the order. It very often
 *   else)         DID, and only the *response* was lost.
 *
 *                 Blind-retrying an ambiguous error is itself a
 *                 duplicate-order bug — it's how you get two shipments
 *                 to the same person. So we never do it. We throw, and
 *                 let the reconciler retry ~10 minutes later, by which
 *                 point Shopify's search index has definitely caught up
 *                 and findShopifyOrderByTag() can tell us the truth.
 *                 That 10-minute delay is a FEATURE, not laziness.
 * ------------------------------------------------------------------ */
function isAmbiguous(err: any) {
  const s = err?.response?.status ?? err?.status;
  if (typeof s === "number" && s >= 500) return true;
  const c = err?.code;
  if (c === "ECONNRESET" || c === "ETIMEDOUT" || c === "ECONNABORTED")
    return true;
  // axios surfaces a killed socket as a message, not always a code
  return /socket hang up|timeout|network error|aborted/i.test(
    String(err?.message || ""),
  );
}

function retryAfterMs(err: any, attempt: number) {
  /* The dev-store order cap is a ONE-MINUTE window. Shopify literally says
     "please try again in a minute". Backing off 500ms and burning a retry
     is pointless — wait the minute out. */
  if (isOrderCreationLimit(err)) {
    const base = Number(process.env.SHOPIFY_ORDER_LIMIT_BACKOFF_MS || 61_000);
    return base + Math.floor(Math.random() * 3000); // jitter
  }

  const header = err?.response?.headers?.["retry-after"];
  const fromHeader = header ? Number(header) * 1000 : 0;
  const backoff = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
  const jitter = Math.floor(Math.random() * 250);
  return Math.max(fromHeader, backoff) + jitter;
}

export interface ShopifyOrderInput {
  accessToken: string;
  shop: string;
  apiVersion: string;
  orderId: string; // DB id — used for the idempotency tag
  cycle?: string; // present for renewals
  firstName: string;
  lastName: string;
  streetAddress: string;
  streetAddress2?: string;
  postCode: string;
  email: string;
  productId: string;
  flag: string;
  age?: string;
  gender?: string;
  identity?: string;
  household_size?: string;
  ethnicity?: string;
  household_language?: string;
  identifyAsLGBTQ?: string;
  wehoHearAboutUs?: string;
}

/** The stable idempotency tag for one (order, cycle). */
export function idempotencyTag(orderId: string, cycle?: string) {
  return `dbid:${orderId}${cycle ? `;cycle:${cycle}` : ""}`;
}

/**
 * Create a Shopify order with pacing + SAFE retry.
 *
 * Retry policy:
 *   429       -> back off and retry (Shopify rejected it; nothing exists)
 *   ambiguous -> do ONE heal check; if Shopify already has the order, adopt
 *                it. Otherwise THROW — never blind-retry. The reconciler
 *                picks it up after ≥10 min, when the search index is
 *                guaranteed fresh, and either heals or creates. Exactly one
 *                order either way.
 */
export async function createShopifyOrder(input: ShopifyOrderInput) {
  const tag = idempotencyTag(input.orderId, input.cycle);

  return paced(async () => {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await CreateOrderREST({ ...input, tags: tag } as any);
      } catch (err) {
        /* ---- SAFE: rate-limited. Shopify created nothing. ---- */
        if (is429(err)) {
          const orderCap = isOrderCreationLimit(err);
          const budget = orderCap ? ORDER_LIMIT_MAX_RETRIES : MAX_RETRIES;
          const bucket =
            err?.response?.headers?.["x-shopify-shop-api-call-limit"];

          if (attempt < budget) {
            const wait = retryAfterMs(err, attempt);

            if (orderCap) {
              console.warn(
                `[shopify] DEV-STORE ORDER CAP (bucket=${bucket}, ~5 orders/min) — ` +
                  `waiting ${Math.round(wait / 1000)}s, retry ${attempt + 1}/${budget}. ` +
                  `This limit does NOT exist on a paid store.`,
              );
            } else {
              console.warn(
                `[shopify] 429 leaky-bucket (bucket=${bucket}) — retry ${attempt + 1}/${budget} in ${wait}ms`,
              );
            }

            await sleep(wait);
            attempt += 1;
            continue;
          }

          /* Budget spent. HAND IT BACK IMMEDIATELY — do not sit here
             sleeping. The caller has a timeout, and the reconciler will
             retry in ~10 minutes with a completely fresh rate-limit window.
             Waiting here just guarantees the caller gives up on us. */
          if (orderCap) {
            console.warn(
              `[shopify] order cap still hit after ${budget} retry — handing back. ` +
                `reconcileCron will retry in ~10 min (window will be clear by then). ` +
                `Raise SHOPIFY_PACE_MS (e.g. 15000) to stop tripping this while testing.`,
            );
          }
          throw err;
        }

        /* ---- AMBIGUOUS: Shopify may hold the order already. ---- */
        if (isAmbiguous(err)) {
          console.warn(
            `[shopify] ambiguous failure (${err?.code || err?.response?.status || err?.message}) — checking whether the order was actually created`,
          );

          // Give Shopify's read path a moment to become consistent.
          await sleep(2000);

          const existing = await findShopifyOrderByTag({
            accessToken: input.accessToken,
            shop: input.shop,
            apiVersion: input.apiVersion,
            orderId: input.orderId,
            cycle: input.cycle,
            email: input.email,
          });

          if (existing) {
            console.log(
              `[shopify] it WAS created — adopting ${existing}, not duplicating`,
            );
            // Shape matches CreateOrderREST's return so callers are unchanged.
            return {
              success: true,
              healed: true,
              order: { id: Number(existing) },
            };
          }

          /* Not found. That could mean (a) it truly wasn't created, or
             (b) the index simply hasn't caught up. We cannot tell these
             apart yet, and guessing wrong duplicates a shipment — so we
             refuse to guess. Throw; the reconciler re-checks in 10 min
             with a fresh index and does the right thing. */
          console.warn(
            "[shopify] not found yet — deferring to the reconciler (no blind retry)",
          );
        }

        throw err;
      }
    }
  });
}

/* ------------------------------------------------------------------ *
 *  GraphQL helper
 * ------------------------------------------------------------------ */
async function graphql(
  {
    shop,
    accessToken,
    apiVersion,
  }: { shop: string; accessToken: string; apiVersion: string },
  query: string,
  variables: Record<string, unknown> = {},
) {
  const res = await fetch(
    `https://${shop}/admin/api/${apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  if (!res.ok) {
    const err: any = new Error(`Shopify GraphQL HTTP ${res.status}`);
    err.response = { status: res.status };
    throw err;
  }

  const json = await res.json();
  // GraphQL returns 200 even for errors — you must read the errors array.
  if (json?.errors?.length) {
    throw new Error(
      `Shopify GraphQL: ${json.errors.map((e: any) => e.message).join("; ")}`,
    );
  }
  return json?.data;
}

/** gid://shopify/Order/12345  ->  "12345"  (matches the REST id we store) */
function gidToNumeric(gid?: string | null): string | null {
  if (!gid) return null;
  const m = String(gid).match(/\/(\d+)(?:\?.*)?$/);
  return m ? m[1] : null;
}

const ORDERS_BY_QUERY = `
  query FindOrders($q: String!, $n: Int!) {
    orders(first: $n, query: $q, sortKey: CREATED_AT, reverse: true) {
      nodes { id tags createdAt }
    }
  }
`;

/**
 * Look for an order we ALREADY created for this (orderId, cycle).
 *
 * Returns the numeric Shopify order id, or null if it genuinely does not
 * exist. Never throws — a lookup failure must not block the create path,
 * it just degrades us to the old (duplicating) behaviour for that one
 * call, which is still better than dropping the customer's order.
 */
export async function findShopifyOrderByTag(args: {
  accessToken: string;
  shop: string;
  apiVersion: string;
  orderId: string;
  cycle?: string;
  email?: string; // strongly recommended — enables the index-lag fallback
}): Promise<string | null> {
  const { accessToken, shop, apiVersion, orderId, cycle, email } = args;
  if (!orderId) return null;

  const want = `dbid:${orderId}`;
  const wantCycle = cycle ? `cycle:${cycle}` : null;

  /* A node matches only if it carries our dbid AND (for renewals) the same
     cycle. Without the cycle check, July's renewal would "heal" onto June's
     order and the customer would silently never get July's shipment. */
  const matches = (node: any) => {
    const tags: string[] = (node?.tags || []).map((t: string) =>
      String(t).trim(),
    );
    if (!tags.includes(want)) return false;
    if (wantCycle && !tags.includes(wantCycle)) return false;
    if (!wantCycle && tags.some((t) => t.startsWith("cycle:"))) return false;
    return true;
  };

  const ctx = { shop, accessToken, apiVersion };

  /* ---- strategy 1: direct tag search (fast path) ---- */
  try {
    const q = wantCycle
      ? `tag:'${want}' AND tag:'${wantCycle}'`
      : `tag:'${want}'`;
    const data = await graphql(ctx, ORDERS_BY_QUERY, { q, n: 10 });
    const hit = (data?.orders?.nodes || []).find(matches);
    if (hit) {
      const id = gidToNumeric(hit.id);
      console.log(`[shopify] healed via tag search: ${want} -> ${id}`);
      return id;
    }
  } catch (e: any) {
    console.warn("[shopify] tag search failed:", e?.message);
  }

  /* ---- strategy 2: email + client-side tag match ----
     Shopify's tag SEARCH INDEX lags writes by a few seconds. During a
     fast retry the order exists but `tag:` can't see it yet. Querying by
     email reads the order record itself (no tag index involved), so this
     is the strategy that actually catches the dangerous case: "Shopify
     created it, then our request timed out". */
  if (!email) return null;
  try {
    const safeEmail = String(email).replace(/['"\\]/g, "");
    const data = await graphql(ctx, ORDERS_BY_QUERY, {
      q: `email:${safeEmail}`,
      n: 30,
    });
    const hit = (data?.orders?.nodes || []).find(matches);
    if (hit) {
      const id = gidToNumeric(hit.id);
      console.log(`[shopify] healed via email scan: ${want} -> ${id}`);
      return id;
    }
  } catch (e: any) {
    console.warn("[shopify] email scan failed:", e?.message);
  }

  return null;
}
