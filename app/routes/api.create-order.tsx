import { ActionFunctionArgs } from "@remix-run/node";
import axios from "axios";
import { accessToken, INTERNAL_API_KEY } from "app/constant";
import {
  createShopifyOrder,
  findShopifyOrderByTag,
} from "app/utils/shopifyClient";

/* ------------------------------------------------------------------ *
 *  Single entry point for BOTH real users (WordPress) and the crons.
 *
 *  Modes:
 *   - normal first-time : Node creates the order, we create Shopify,
 *                         then confirm.
 *   - renewal (cron)    : Node claims the cycle, we create Shopify,
 *                         then confirm (which advances lastRenewAt).
 *   - retry (reconcile) : skip Node /order; (re)create Shopify for an
 *                         existing order id, healing via tag lookup.
 *
 *  ++ WHAT CHANGED ++
 *
 *  1. `email` is now passed to findShopifyOrderByTag. Without it the
 *     lookup can only use Shopify's tag search index, which lags a few
 *     seconds behind writes — exactly the window in which a retry
 *     duplicates an order. With the email we can scan that customer's
 *     recent orders and match the tag ourselves, no index involved.
 *
 *  2. The NORMAL path now also heals. Previously only `retry:true` looked
 *     for an existing order. But the cron's own axios call has a timeout:
 *     if Shopify created the order and the response was slow, the cron
 *     sees a failure, and the NEXT nightly run comes back through the
 *     normal path with a fresh claim... and made a second order. Now both
 *     paths check first. Belt and braces — the cost is one GraphQL call.
 *
 *  3. On a *renewal* the heal check runs BEFORE createShopifyOrder rather
 *     than after a failure, because the renewal is the one that gets
 *     retried on a schedule and is therefore the one that duplicates.
 * ------------------------------------------------------------------ */

const SHOP = "defent.myshopify.com";
// const SHOP = "prachanda-test.myshopify.com";
const API_VERSION = "2025-10";

export const action = async ({ request }: ActionFunctionArgs) => {
  const ct = request.headers.get("content-type") || "";
  const baseURL = import.meta.env.VITE_BASE_URL; // Node backend

  const sendErrorLog = async (body: any) => {
    try {
      await axios.post(`${baseURL}/error`, body);
    } catch (e: any) {
      console.error("Error logging failed:", e?.message);
    }
  };

  /* ---- parse payload ---- */
  let payload: any;
  try {
    payload = ct.includes("application/json")
      ? await request.json()
      : Object.fromEntries((await request.formData()) as any);
  } catch (err: any) {
    await sendErrorLog({
      source: "shopify-app",
      module: "order-action",
      stage: "request_parse",
      level: "error",
      message: err?.message || "parse failed",
      stack: err?.stack,
    });
    return { success: false, message: "Invalid request payload" };
  }

  if (!SHOP || !accessToken) {
    return { success: false, message: "Shop or access token missing" };
  }

  const {
    orderId = "",
    cycle,
    isRenewal = false,
    retry = false,
    firstName,
    lastName,
    streetAddress,
    streetAddress2,
    postCode,
    email,
    productId,
    subscription,
    flag,
    demographics: {
      age,
      gender,
      identity,
      household_size,
      ethnicity,
      household_language,
      identifyAsLGBTQ,
      wehoHearAboutUs,
    } = {},
  } = payload;

  /* ================================================================ *
   *  ++ THE SHOPIFY ORDER IS BUILT FROM THE DATABASE, NOT THE PAYLOAD ++
   *
   *  Node returns the full order document (`data.data.order`) on BOTH the
   *  first-time and the renewal path. We build the Shopify order from THAT,
   *  falling back to the request payload only for a first-time order that
   *  somehow didn't come back with a doc.
   *
   *  Why this matters for renewals:
   *
   *    - The product shipped is `dbOrder.productId` — the product the
   *      customer actually subscribed to ON THIS ORDER. It can no longer be
   *      inherited from a stale payload or from a different order.
   *
   *    - Same for the address. The DB holds the Census-normalised, service-
   *      area-validated address. The payload does not.
   *
   *    - It closes a real hole: previously anyone could POST
   *      { isRenewal: true, orderId: <someone's id>, productId: <anything> }
   *      and Node would claim the cycle for that order while Remix happily
   *      created a Shopify order for a completely different product.
   * ================================================================ */
  const fromDb = (db: any) => {
    if (!db) return null;
    const dem = db.demographics || {};
    return {
      firstName: db.firstName,
      lastName: db.lastName,
      streetAddress: db.streetAddress,
      streetAddress2: db.streetAddress2 || "",
      postCode: db.postCode,
      mailingCity: db.mailingCity || "", // true USPS city (spec 4b)
      email: db.email,
      productId: db.productId, // <- the subscribed product
      flag: db.source === "Defent La" ? "defentLA" : "defentWeho",
      age: dem.age,
      gender: dem.gender,
      identity: dem.identity,
      household_size: dem.household_size,
      ethnicity: dem.ethnicity,
      household_language: dem.household_language,
      identifyAsLGBTQ: dem.identifyAsLGBTQ,
      wehoHearAboutUs: dem.wehoHearAboutUs,
    };
  };

  /* Fields as they arrived in the request — the fallback only. */
  const fromPayload = {
    firstName,
    lastName,
    streetAddress,
    streetAddress2: streetAddress2 || "",
    postCode,
    email,
    productId,
    flag,
    age,
    gender,
    identity,
    household_size,
    ethnicity,
    household_language,
    identifyAsLGBTQ,
    wehoHearAboutUs,
  };

  /* helper to build the Shopify input. `dbOrder` wins when we have it. */
  const shopifyInput = (id: string, cyc?: string, dbOrder?: any) => ({
    accessToken,
    shop: SHOP,
    apiVersion: API_VERSION,
    orderId: id,
    cycle: cyc,
    ...fromPayload,
    ...(fromDb(dbOrder) || {}),
  });

  /* ++ heal check: has Shopify ALREADY got this exact (order, cycle)? ++ */
  const findExisting = (id: string, cyc?: string) =>
    findShopifyOrderByTag({
      accessToken,
      shop: SHOP,
      apiVersion: API_VERSION,
      orderId: id,
      cycle: cyc,
      email, // <- the bit that makes this actually reliable
    });

  /* helper: tell Node the outcome */
  const confirm = async (
    id: string,
    status: "synced" | "failed",
    shopifyOrderId: string | null,
    cyc?: string,
    error = "",
    orderName: string | null = null, // Shopify's human number, e.g. "#4232"
  ) => {
    await axios.post(
      `${baseURL}/order/confirm`,
      {
        orderId: id,
        cycle: cyc,
        isRenewal,
        status,
        shopifyOrderId,
        orderName,
        error,
      },
      {
        headers: { "x-internal-key": INTERNAL_API_KEY || "" },
      },
    );
  };

  try {
    /* =========================================================== *
     *  RETRY / RECONCILE MODE — skip Node /order entirely.
     * =========================================================== */
    if (retry) {
      if (!orderId)
        return { success: false, message: "orderId required for retry" };

      // Heal: if Shopify already has this order (crash/timeout after
      // create), adopt it instead of creating a twin.
      const existingId = await findExisting(orderId, cycle);
      if (existingId) {
        await confirm(orderId, "synced", existingId, cycle);
        return { success: true, healed: true, shopifyOrderId: existingId };
      }

      try {
        const created: any = await createShopifyOrder(
          shopifyInput(orderId, cycle),
        );
        const newId =
          created?.id?.toString?.() || created?.order?.id?.toString?.() || null;
        const newName = created?.order?.name || created?.name || null;
        await confirm(orderId, "synced", newId, cycle, "", newName);
        return { success: true, retried: true, shopifyOrderId: newId };
      } catch (e: any) {
        await confirm(orderId, "failed", null, cycle, e?.message);
        return { success: false, message: e?.message || "retry failed" };
      }
    }

    /* =========================================================== *
     *  NORMAL MODE — Node first, then Shopify, then confirm.
     * =========================================================== */
    const { data } = await axios.post(`${baseURL}/order`, {
      orderId,
      firstName,
      lastName,
      streetAddress,
      streetAddress2,
      postCode,
      subscription,
      email,
      productId,
      age,
      gender,
      identity,
      household_size,
      ethnicity,
      household_language,
      identifyAsLGBTQ,
      wehoHearAboutUs,
      flag,
      isRenewal,
    });

    // Node rejected (validation / dedup / not-due / already-claimed): stop, no Shopify.
    if (data?.statusCode !== 200 || !data?.success) {
      await sendErrorLog({
        source: "shopify-app",
        module: "order-action",
        stage: "node_rejected",
        level: "warning",
        message: data?.message,
        statusCode: data?.statusCode,
        context: { email, productId, flag, isRenewal },
      });
      return { success: false, message: data?.message || "Order rejected" };
    }

    const nodeData = data?.data || {};
    const realOrderId: string = nodeData.orderId || orderId;
    const realCycle: string | undefined = nodeData.cycle || cycle;

    /* The authoritative order document. Node returns it on BOTH paths:
       first-time (the doc it just created) and renewal (the doc it looked
       up by id). Everything we send to Shopify comes from here. */
    const dbOrder = nodeData.order || null;

    // Renewal cycle already in flight elsewhere -> nothing to do.
    if (nodeData.alreadyClaimed) {
      return { success: true, alreadyClaimed: true };
    }

    /* ++ Sanity check for renewals: does the product the cron asked for
       actually match the subscription in the database? If they diverge,
       the DB always wins — but log it, because it means something upstream
       is out of step. */
    if (
      isRenewal &&
      dbOrder?.productId &&
      productId &&
      dbOrder.productId !== productId
    ) {
      await sendErrorLog({
        source: "shopify-app",
        module: "order-action",
        stage: "renewal_product_mismatch",
        level: "warning",
        message:
          "Renewal payload productId != the subscription's productId. Using the database value.",
        context: {
          orderId: realOrderId,
          payloadProductId: productId,
          dbProductId: dbOrder.productId,
          email,
        },
      });
    }

    /* ++ HEAL BEFORE CREATE (renewals only) ++
       A renewal is retried on a schedule, so it's the one that can arrive
       twice for the same cycle. If Shopify already has this cycle's order,
       adopt it. We skip this for genuine first-time orders — they're new by
       definition, and it would add a GraphQL round-trip to the hot path
       that every WordPress checkout waits on. */
    if (isRenewal) {
      const existingId = await findExisting(realOrderId, realCycle);
      if (existingId) {
        await confirm(realOrderId, "synced", existingId, realCycle);
        return { success: true, healed: true, shopifyOrderId: existingId };
      }
    }

    /* ---- create the Shopify order (paced + 429-safe) ---- */
    try {
      const created: any = await createShopifyOrder(
        shopifyInput(realOrderId, realCycle, dbOrder),
      );
      const shopifyOrderId =
        created?.id?.toString?.() || created?.order?.id?.toString?.() || null;
      const shopifyOrderName = created?.order?.name || created?.name || null;

      await confirm(
        realOrderId,
        "synced",
        shopifyOrderId,
        realCycle,
        "",
        shopifyOrderName,
      );
      return { success: true, shopifyOrderId };
    } catch (e: any) {
      /* Shopify failed -> mark retryable.
         The order is NOT lost: Node marks shopifySync.status = "failed"
         (and, for a renewal, the RenewalLog row survives as "failed"), and
         reconcileCron retries it within ~10 minutes — healing via the tag
         lookup above, so the retry can never create a second order. */
      await confirm(realOrderId, "failed", null, realCycle, e?.message);

      await sendErrorLog({
        source: "shopify-app",
        module: "order-action",
        stage: "shopify_create",
        level: "error",
        message: e?.message,
        statusCode: e?.response?.status,
        context: { orderId: realOrderId, email, productId, flag, isRenewal },
        externalService: {
          name: "shopify",
          endpoint: "createShopifyOrder",
          method: "POST",
        },
      });
      return {
        success: false,
        message: e?.message || "Shopify order creation failed",
      };
    }
  } catch (error: any) {
    await sendErrorLog({
      source: "shopify-app",
      module: "order-action",
      stage: "catch_block",
      level: "error",
      message: error?.message,
      statusCode: error?.response?.status,
      stack: error?.stack,
      context: { email, productId, flag, isRenewal },
    });
    return {
      success: false,
      message:
        error?.response?.data?.message ||
        error?.message ||
        "Something went wrong",
    };
  }
};
