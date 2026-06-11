/* ------------------------------------------------------------------ *
 *  shopifyClient.ts  (Remix side)
 *
 *  Fixes the 429s you hit on bulk renewals:
 *   1) PACING: a process-wide queue spaces Shopify calls to ~2/sec so we
 *      mostly stay under the REST Admin bucket and never burst.
 *   2) BACKOFF: on a 429, we read the `Retry-After` header and wait that
 *      long (with exponential fallback), then retry up to MAX_RETRIES.
 *   3) IDEMPOTENCY: every order is tagged with its DB id (+cycle for
 *      renewals). `findShopifyOrderByTag` lets the reconciler detect an
 *      order that was already created before a crash — so retries heal
 *      instead of duplicating.
 * ------------------------------------------------------------------ */

import { CreateOrderREST } from "app/utils/Orders";

const MIN_INTERVAL_MS = 550; // ~2 req/sec
const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 30_000;

/* ---- process-wide pacing queue (serializes + spaces calls) ---- */
let chain: Promise<unknown> = Promise.resolve();
let lastRunAt = 0;

function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = Math.max(0, lastRunAt + MIN_INTERVAL_MS - Date.now());
    if (wait) await sleep(wait);
    lastRunAt = Date.now();
    return fn();
  };
  const next = chain.then(run, run);
  // keep the chain alive regardless of this call's outcome
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next as Promise<T>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function is429(err: any) {
  return err?.response?.status === 429;
}
function retryAfterMs(err: any, attempt: number) {
  const header = err?.response?.headers?.["retry-after"];
  const fromHeader = header ? Number(header) * 1000 : 0;
  const backoff = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
  return Math.max(fromHeader, backoff);
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
  // demographics passthrough
  age?: string;
  gender?: string;
  identity?: string;
  household_size?: string;
  ethnicity?: string;
  household_language?: string;
  identifyAsLGBTQ?: string;
  wehoHearAboutUs?: string;
}

/**
 * Create a Shopify order with pacing + 429 retry.
 * Returns the created order (whatever CreateOrderREST returns).
 *
 * ⚠ INTEGRATION: ensure CreateOrderREST attaches `tags` to the order
 *    payload. Pass the tag through so reconciliation can find it later:
 *      tags: `dbid:${orderId}${cycle ? `;cycle:${cycle}` : ""}`
 */
export async function createShopifyOrder(input: ShopifyOrderInput) {
  const tag = `dbid:${input.orderId}${input.cycle ? `;cycle:${input.cycle}` : ""}`;

  return paced(async () => {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await CreateOrderREST({ ...input, tags: tag } as any);
      } catch (err) {
        if (is429(err) && attempt < MAX_RETRIES) {
          const wait = retryAfterMs(err, attempt);
          console.warn(
            `[shopify] 429 — retry ${attempt + 1}/${MAX_RETRIES} in ${wait}ms`,
          );
          await sleep(wait);
          attempt += 1;
          continue;
        }
        throw err;
      }
    }
  });
}

/**
 * OPTIONAL idempotency check. Before (re)creating on the reconcile path,
 * look for an existing order carrying our tag. If found, we heal by
 * confirming the existing id instead of creating a duplicate.
 *
 * ⚠ INTEGRATION: implement with your Shopify GraphQL/REST search, e.g.
 *    GET /admin/api/<v>/orders.json?status=any&query=tag:'dbid:<id>'
 * Return the shopify order id string or null.
 */
export async function findShopifyOrderByTag(_args: {
  accessToken: string;
  shop: string;
  apiVersion: string;
  orderId: string;
  cycle?: string;
}): Promise<string | null> {
  // TODO: query Shopify by tag `dbid:<orderId>[;cycle:<cycle>]`
  return null;
}
