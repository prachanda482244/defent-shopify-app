import axios from "axios";

type CreateOrderRestArgs = {
  shop: string;
  accessToken: string;
  apiVersion?: string;
  firstName: string;
  lastName: string;
  streetAddress: string;
  streetAddress2?: string;
  // e.g. "US"
  postCode: string;
  email: string;
  age: string;
  gender: string;
  identity: string;
  household_size: string;
  ethnicity: string[]; // allow multiple
  household_language: string[]; // allow multiple
  productId: string;
};

const joinMulti = (a?: string[]) => (a && a.length ? a.join(", ") : "");

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
    age,
    gender,
    identity,
    household_size,
    ethnicity,
    household_language,
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
    timeout: 20000,
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
      city: "West Hollywood.",
      province: "California",
      country_code: "US",
      province_code: "CA",
    };

    const payload = {
      order: {
        email,
        line_items: [{ variant_id: variantId, quantity: 1 }],
        shipping_address: addr,
        billing_address: addr,
        customer: { first_name: firstName, last_name: lastName, email },
      },
    };

    // ----------------------------
    // 3. Create order on Shopify
    // ----------------------------
    const res = await client.post("/orders.json", payload);
    console.log("Order created:", res.data.order);

    const order = res.data.order as { id: number };

    // ----------------------------
    // 4. Save metafields (optional)
    // ----------------------------
    try {
      const metas = [
        { key: "age", type: "single_line_text_field", value: age },
        { key: "gender", type: "single_line_text_field", value: gender },
        { key: "identity", type: "single_line_text_field", value: identity },
        {
          key: "household_size",
          type: "single_line_text_field",
          value: household_size,
        },
        {
          key: "ethnicity",
          type: "json",
          value: JSON.stringify(ethnicity || []),
        },
        {
          key: "household_language",
          type: "json",
          value: JSON.stringify(household_language || []),
        },
      ];

      for (const m of metas) {
        await client.post(`/orders/${order.id}/metafields.json`, {
          metafield: { namespace: "demographics", ...m },
        });
      }
    } catch (metaErr: any) {
      console.error("Metafield write failed:", {
        message: metaErr?.message,
        response: metaErr?.response?.data,
      });
    }

    return { success: true, order: res.data.order };
  } catch (error: any) {
    // ----------------------------
    // 5. Structured error logging
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

    throw new Error(
      error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        "Shopify order creation failed",
    );
  }
}
