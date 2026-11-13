import axios from "axios";

/* ================================================================== *
 *  Orders.tsx
 *
 *  ⚠⚠  THIS FILE CONTAINED THE DUPLICATE-ORDER BUG.  ⚠⚠
 *
 *  shopifyClient.ts does this:
 *      const tag = `dbid:${orderId};cycle:${cycle}`;
 *      return CreateOrderREST({ ...input, tags: tag });
 *
 *  ...and the OLD CreateOrderREST destructured its args and never read
 *  `tags`. It then built its own:
 *      const orderTag = getOrderTag(flag);      // -> "WEHO" | "LA"
 *      tags: orderTag
 *
 *  So the `dbid:` idempotency tag was NEVER written to Shopify. Which
 *  means findShopifyOrderByTag() had nothing to find, which means every
 *  retry after a 429 / timeout created a BRAND NEW ORDER instead of
 *  recognising the one Shopify had already made. That is your duplicate.
 *
 *  FIX: honour the incoming `tags` and MERGE it with the WEHO/LA tag, so
 *  the store keeps its existing tagging AND we get a stable idempotency
 *  key on every order. Nothing else about the tags changes.
 *
 *  ---- three other things fixed here ----
 *
 *  (2) 9 API CALLS PER ORDER -> 1.
 *      The old code created the order (1 POST), then looped 8 metafields
 *      with a POST each. Shopify REST is a leaky bucket: ~2 req/sec, 40
 *      burst. At 9 calls/order the bucket is empty after ~4 orders and
 *      everything after that 429s. Shopify's Order resource accepts
 *      metafields INLINE on create, so we now send them with the order.
 *      (With an automatic fallback to the old loop — see below — so this
 *      can never make an order fail that used to succeed.)
 *
 *  (3) LA ORDERS SHIPPED TO THE WRONG CITY.
 *      `city: "West Hollywood."` was hardcoded (trailing full-stop and
 *      all) for EVERY order, including Defent LA. Now derived from flag.
 *
 *  (4) TIMEOUT 20s -> 30s. A 20s timeout on order create is how you get
 *      "Shopify made the order but we never heard back", i.e. the exact
 *      state that used to duplicate.
 * ================================================================== */

type CreateOrderRestArgs = {
  shop: string;
  accessToken: string;
  apiVersion?: string;
  firstName: string;
  lastName: string;
  streetAddress: string;
  streetAddress2?: string;
  postCode: string;
  mailingCity?: string; // true USPS city from the backend (spec 4b)
  email: string;
  age?: string;
  gender?: string;
  identity?: string;
  household_size?: string;
  identifyAsLGBTQ?: boolean | string;
  ethnicity?: string[] | string;
  household_language?: string[] | string;
  wehoHearAboutUs?: string;
  productId: string;
  flag?: "defentWeho" | "defentLA";
  /** ++ NOW ACTUALLY USED ++ idempotency tag, e.g. "dbid:<id>;cycle:<c>" */
  tags?: string;
  /** Plan from WordPress/DB: "one_time" | "monthly" | "quarterly" | "recurring" */
  subscription?: string;
  /** true when the renewal cron sent this (a repeat order, not the first one) */
  isRenewal?: boolean;
};

/* Plan label for tags and the note, using the real stored value.
   Unknown/empty values get no label rather than a guessed one. */
function getPlanLabel(subscription?: string): { tag: string; text: string } | null {
  switch (String(subscription || "").trim().toLowerCase()) {
    case "one_time":
    case "one-time":
    case "onetime":
      return { tag: "ONE-TIME", text: "One-time" };
    case "monthly":
      return { tag: "MONTHLY", text: "Monthly" };
    case "quarterly":
      return { tag: "QUARTERLY", text: "Quarterly" };
    case "recurring":
      return { tag: "RECURRING", text: "Recurring" };
    default:
      return null;
  }
}

/* e.g. "Defent Weho · Monthly · Renewal" */
function getOrderNote(
  flag?: "defentWeho" | "defentLA",
  subscription?: string,
  isRenewal?: boolean,
) {
  const site =
    flag === "defentWeho" ? "Defent Weho" : flag === "defentLA" ? "Defent LA" : "";
  const plan = getPlanLabel(subscription)?.text;
  return [site, plan, isRenewal ? "Renewal" : ""].filter(Boolean).join(" · ");
}

function getOrderTag(flag?: "defentWeho" | "defentLA"): string {
  switch (flag) {
    case "defentWeho":
      return "WEHO";
    case "defentLA":
      return "LA";
    default:
      return "";
  }
}

/** Units per order. Each order now takes 5 units out of inventory (client
 *  request; it used to be 1). Change it with ORDER_QUANTITY on the service. */
function getOrderQuantity(): number {
  const n = parseInt(process.env.ORDER_QUANTITY || "", 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/** City must follow the flag, not be hardcoded to WeHo. */
function getCity(flag?: "defentWeho" | "defentLA"): string {
  return flag === "defentLA" ? "Los Angeles" : "West Hollywood";
}

/**
 * Merge the site tag (WEHO / LA) with the idempotency tag(s).
 *
 * Shopify treats `tags` as a comma-separated string, and our idempotency
 * tag internally uses ';' as its own separator ("dbid:x;cycle:y") — that
 * would be ONE tag containing a semicolon, which is legal but not
 * searchable per-part. So we split it into separate comma tags:
 *     "WEHO, dbid:68f..., cycle:2026-07-01"
 * Now `tag:'dbid:68f...'` is an exact, indexable match in GraphQL.
 */
function buildTags(
  flag: CreateOrderRestArgs["flag"],
  extra?: string,
  subscription?: string,
  isRenewal?: boolean,
): string {
  const parts: string[] = [];
  const site = getOrderTag(flag);
  if (site) parts.push(site);

  // Plan tags: ONE-TIME / MONTHLY / QUARTERLY / RECURRING, plus RENEWAL on
  // repeat orders. None start with "dbid:" or "cycle:", so the duplicate
  // check in shopifyClient.ts is unaffected.
  const plan = getPlanLabel(subscription);
  if (plan) parts.push(plan.tag);
  if (isRenewal) parts.push("RENEWAL");

  if (extra) {
    for (const raw of extra.split(";")) {
      const t = raw.trim();
      if (t) parts.push(t);
    }
  }
  // de-dupe, preserve order
  return Array.from(new Set(parts)).join(", ");
}

/** Shopify metafield `value` must be a string. */
function toJsonValue(v: string[] | string | undefined): string {
  if (Array.isArray(v)) return JSON.stringify(v.filter(Boolean));
  if (typeof v === "string" && v.length) {
    // The Node backend joins multi-selects into "A, B" before sending.
    // Split it back out so the metafield stays a real JSON array.
    return JSON.stringify(
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return JSON.stringify([]);
}

function buildMetafields(args: CreateOrderRestArgs) {
  const {
    age,
    gender,
    identity,
    household_size,
    identifyAsLGBTQ,
    wehoHearAboutUs,
    ethnicity,
    household_language,
  } = args;

  const lgbtq =
    typeof identifyAsLGBTQ === "string"
      ? identifyAsLGBTQ
      : identifyAsLGBTQ
        ? "Yes"
        : "No";

  return (
    [
      { key: "age", type: "single_line_text_field", value: age || "" },
      { key: "gender", type: "single_line_text_field", value: gender || "" },
      {
        key: "identity",
        type: "single_line_text_field",
        value: identity || "",
      },
      {
        key: "household_size",
        type: "single_line_text_field",
        value: household_size || "",
      },
      { key: "identifyAsLGBTQ", type: "single_line_text_field", value: lgbtq },
      {
        key: "wehoHearAboutUs",
        type: "single_line_text_field",
        value: wehoHearAboutUs || "",
      },
      { key: "ethnicity", type: "json", value: toJsonValue(ethnicity) },
      {
        key: "household_language",
        type: "json",
        value: toJsonValue(household_language),
      },
    ]
      // Shopify rejects a metafield with an empty value — drop them instead
      // of letting one blank demographic field 422 the whole order.
      .filter((m) => m.value !== "" && m.value !== undefined)
      .map((m) => ({ namespace: "demographics", ...m }))
  );
}

export async function CreateOrderREST(args: CreateOrderRestArgs) {
  const {
    shop,
    accessToken,
    apiVersion = "2024-10",
    firstName,
    lastName,
    streetAddress,
    streetAddress2,
    postCode,
    email,
    productId,
    mailingCity,
    flag,
    tags, // ++ the idempotency tag from shopifyClient.ts ++
    subscription,
    isRenewal,
  } = args;

  if (!shop || !accessToken) throw new Error("shop and accessToken required");
  if (!productId) throw new Error("productId required");

  const base = `https://${shop}/admin/api/${apiVersion}`;
  const client = axios.create({
    baseURL: base,
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 30000, // was 20s — see note (4) at the top of this file
  });

  try {
    // ----------------------------
    // 1. Resolve product variant
    // ----------------------------
    const gidToNumeric = (id: string) =>
      Number((id.match(/\/(\d+)$/) || [])[1] || id);

    let variantId: number | null = null;

    if (/ProductVariant/i.test(productId)) {
      variantId = gidToNumeric(productId);
    } else {
      const { data } = await client.get<{
        product: { variants: { id: number }[] };
      }>(`/products/${gidToNumeric(productId)}.json`);

      variantId = data?.product?.variants?.[0]?.id ?? null;
    }

    if (!variantId) throw new Error("No variant found for productId");

    // ----------------------------
    // 2. Construct order payload
    // ----------------------------
    const addr = {
      first_name: firstName,
      last_name: lastName,
      address1: streetAddress,
      address2: streetAddress2,
      country: "United States",
      zip: postCode,
      city: mailingCity || getCity(flag), // ++ SPEC 4b: TRUE USPS city from the DB
      //    ("Van Nuys", "San Pedro", ...). Forcing "Los Angeles" misaddresses
      //    the Valley/Harbor. Flag city is only the fallback for legacy docs. ++
      province: "California",
      country_code: "US",
      province_code: "CA",
    };

    const orderTags = buildTags(flag, tags, subscription, isRenewal);
    const metafields = buildMetafields(args);

    const orderBody: Record<string, unknown> = {
      email,
      note: getOrderNote(flag, subscription, isRenewal),
      tags: orderTags,
      line_items: [{ variant_id: variantId, quantity: getOrderQuantity() }],
      shipping_address: addr,
      billing_address: addr,
      customer: { first_name: firstName, last_name: lastName, email },
    };

    // ----------------------------
    // 3. Create order on Shopify (metafields INLINE -> 1 call, not 9)
    // ----------------------------
    let res;
    try {
      res = await client.post("/orders.json", {
        order: { ...orderBody, metafields },
      });
    } catch (err: any) {
      /* SAFETY NET: inline metafields turn a metafield validation error
         into an order-create failure, where the old code just swallowed it.
         So if the create 422s, retry WITHOUT metafields and fall back to
         the original write-them-afterwards loop. Net effect: we can never
         fail an order that used to succeed. */
      const status = err?.response?.status;
      const isValidation = status === 422 || status === 400;
      if (!isValidation || !metafields.length) throw err;

      console.warn(
        "[CreateOrderREST] inline metafields rejected — retrying without them",
        err?.response?.data,
      );
      res = await client.post("/orders.json", { order: orderBody });

      const created = res.data.order as { id: number };
      try {
        for (const m of metafields) {
          await client.post(`/orders/${created.id}/metafields.json`, {
            metafield: m,
          });
        }
      } catch (metaErr: any) {
        // Same as the original: metafields are nice-to-have, not fatal.
        console.error("Metafield write failed:", {
          message: metaErr?.message,
          response: metaErr?.response?.data,
        });
      }
    }

    const order = res.data.order as { id: number; tags?: string };
    console.log("Order created:", order?.id, "tags:", orderTags);

    return { success: true, order: res.data.order };
  } catch (error: any) {
    // ----------------------------
    // 4. Structured error logging
    // ----------------------------
    const log = {
      date: new Date().toISOString(),
      message: error?.message,
      status: error?.response?.status,
      responseData: error?.response?.data,
      headers: error?.response?.headers,
      stack: error?.stack,
      args: { ...args, accessToken: "***redacted***" },
    };

    console.error("CreateOrderREST FAILED:", log);

    /* IMPORTANT: preserve the original error object's `response` so the
       caller's is429() check still works. The old code threw a bare
       `new Error(msg)`, which DESTROYED err.response — meaning
       shopifyClient's `is429(err)` was always false and the 429 retry
       logic in createShopifyOrder() never actually fired. */
    const wrapped: any = new Error(
      error?.response?.data?.error ||
        error?.response?.data?.errors ||
        error?.response?.data?.message ||
        error?.message ||
        "Shopify order creation failed",
    );
    wrapped.response = error?.response;
    wrapped.status = error?.response?.status;
    wrapped.code = error?.code;
    throw wrapped;
  }
}
