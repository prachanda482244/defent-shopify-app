import axios from "axios";

// add these fields to your args
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

export async function CreateOrderREST({
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
}: CreateOrderRestArgs) {
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

  // resolve variant_id
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

  const addr = {
    first_name: firstName,
    last_name: lastName,
    address1: streetAddress,
    address2: streetAddress2,
    country: "United States", // "US", "CA", etc.
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
      customer: {
        first_name: firstName,
        last_name: lastName,
        email,
      },
      note_attributes: [
        //   { name: "Age", value: age },
        //   { name: "Gender", value: gender },
        //   { name: "Identity", value: identity },
        //   { name: "Household Size", value: household_size },
        //   { name: "Ethnicity", value: joinMulti(ethnicity) },
        //   { name: "Household Language", value: joinMulti(household_language) },
        { name: "Street Address 2", value: streetAddress2 || "" },
      ],
      // note: "any freeform note",
      // tags: "web,demographics",
      // send_receipt: false,
    },
  };

  const res = await client.post("/orders.json", payload);
  const order = res.data.order as { id: number };

  // OPTIONAL: also write structured metafields on the order
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
  } catch (_) {
    // ignore metafield errors if not critical
  }

  return { success: true, order: res.data.order };
}
