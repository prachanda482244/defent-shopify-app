import { ActionFunctionArgs } from "@remix-run/node";
import axios from "axios";
import { accessToken } from "app/constant";
import {
  createShopifyOrder,
  findShopifyOrderByTag,
} from "app/utils/shopifyClient";

/* ------------------------------------------------------------------ *
 *  Single entry point for BOTH real users (WordPress) and the cron.
 *
 *  Modes:
 *   - normal first-time : Node creates the order, we create Shopify,
 *                         then confirm.
 *   - renewal (cron)    : Node claims the cycle, we create Shopify,
 *                         then confirm (which advances lastRenewAt).
 *   - retry (reconcile) : skip Node /order; (re)create Shopify for an
 *                         existing order id, healing via tag lookup.
 *
 *  Guarantee: Shopify is only created AFTER Node has a record, and the
 *  order/cycle is only finalized AFTER Shopify confirms. A failure at
 *  any step leaves a retryable state — nothing is silently lost.
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

  /* helper to build the Shopify input from whatever fields we have */
  const shopifyInput = (id: string, cyc?: string) => ({
    accessToken,
    shop: SHOP,
    apiVersion: API_VERSION,
    orderId: id,
    cycle: cyc,
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
  });

  /* helper: tell Node the outcome */
  const confirm = async (
    id: string,
    status: "synced" | "failed",
    shopifyOrderId: string | null,
    error = "",
  ) => {
    await axios.post(`${baseURL}/order/confirm`, {
      orderId: id,
      cycle,
      isRenewal,
      status,
      shopifyOrderId,
      error,
    });
  };

  try {
    /* =========================================================== *
     *  RETRY / RECONCILE MODE — skip Node /order entirely.
     * =========================================================== */
    if (retry) {
      if (!orderId)
        return { success: false, message: "orderId required for retry" };

      // Heal: if Shopify already has this order (crash after create), reuse it.
      const existingId = await findShopifyOrderByTag({
        accessToken,
        shop: SHOP,
        apiVersion: API_VERSION,
        orderId,
        cycle,
      });
      if (existingId) {
        await confirm(orderId, "synced", existingId);
        return { success: true, healed: true, shopifyOrderId: existingId };
      }

      try {
        const created: any = await createShopifyOrder(
          shopifyInput(orderId, cycle),
        );
        const newId =
          created?.id?.toString?.() || created?.order?.id?.toString?.() || null;
        await confirm(orderId, "synced", newId);
        return { success: true, retried: true, shopifyOrderId: newId };
      } catch (e: any) {
        await confirm(orderId, "failed", null, e?.message);
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
        context: {
          email,
          productId,
          flag,
          isRenewal,
        },
      });
      return { success: false, message: data?.message || "Order rejected" };
    }

    const nodeData = data?.data || {};
    const realOrderId: string = nodeData.orderId || orderId;
    const realCycle: string | undefined = nodeData.cycle || cycle;

    // Renewal cycle already in flight elsewhere -> nothing to do.
    if (nodeData.alreadyClaimed) {
      return { success: true, alreadyClaimed: true };
    }

    /* ---- create the Shopify order (throttled + 429-safe) ---- */
    try {
      const created: any = await createShopifyOrder(
        shopifyInput(realOrderId, realCycle),
      );
      const shopifyOrderId =
        created?.id?.toString?.() || created?.order?.id?.toString?.() || null;

      // confirm needs the (possibly server-assigned) cycle
      await axios.post(`${baseURL}/order/confirm`, {
        orderId: realOrderId,
        cycle: realCycle,
        isRenewal,
        status: "synced",
        shopifyOrderId,
      });

      return { success: true, shopifyOrderId };
    } catch (e: any) {
      // Shopify failed -> mark retryable (renewal cycle is released for next run)
      await axios.post(`${baseURL}/order/confirm`, {
        orderId: realOrderId,
        cycle: realCycle,
        isRenewal,
        status: "failed",
        shopifyOrderId: null,
        error: e?.message,
      });
      await sendErrorLog({
        source: "shopify-app",
        module: "order-action",
        stage: "shopify_create",
        level: "error",
        message: e?.message,
        statusCode: e?.response?.status,
        context: {
          orderId: realOrderId,
          email,
          productId,
          flag,
          isRenewal,
        },
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
      context: {
        email,
        productId,
        flag,
        isRenewal,
      },
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
