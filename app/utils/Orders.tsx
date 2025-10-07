import axios from "axios";

type CreateOrderRestArgs = {
  shop: string; // e.g. "my-shop.myshopify.com"
  accessToken: string; // Admin API access token
  apiVersion?: string; // default "2024-10"
  firstName: string;
  lastName: string;
  streetAddress: string;
  postCode: string;
  email: string;
  productId: string; // Product GID/ID or Variant GID/ID
};

const gidToNumeric = (id: string) => {
  // Accept "gid://shopify/Resource/123456789" or "123456789"
  const m = id.match(/\/(\d+)$/);
  return Number(m ? m[1] : id);
};

export async function CreateOrderREST({
  shop,
  accessToken,
  apiVersion = "2024-10",
  firstName,
  lastName,
  streetAddress,
  postCode,
  email,
  productId,
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

  // Resolve a variant_id
  let variantId: number | null = null;

  // If a Variant GID/ID was passed, use it directly
  if (/ProductVariant/i.test(productId)) {
    variantId = gidToNumeric(productId);
  } else {
    // Assume Product GID/ID. Fetch first variant.
    const productNumericId = gidToNumeric(productId);
    const { data } = await client.get<{
      product: { variants: { id: number }[] };
    }>(`/products/${productNumericId}.json`);
    variantId = data?.product?.variants?.[0]?.id ?? null;
  }

  if (!variantId) throw new Error("No variant found for productId");

  // Build REST order payload
  const payload = {
    order: {
      email,
      line_items: [{ variant_id: variantId, quantity: 1 }],
      shipping_address: {
        first_name: firstName,
        last_name: lastName,
        address1: streetAddress,
        zip: postCode,
      },
      // Optional: financial_status: "pending" | "paid" | "authorized"
      // Optional: tags, note, billing_address, customer, send_receipt: true
    },
  };

  // Create order
  const res = await client.post("/orders.json", payload);
  return { success: true, order: res.data.order };
}
