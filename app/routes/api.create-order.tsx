import { ActionFunctionArgs } from "@remix-run/node";
import { apiVersion } from "app/shopify.server";
import { CreateOrderREST } from "app/utils/Orders";
import db from "../db.server";
import axios from "axios";

export const action = async ({ request }: ActionFunctionArgs) => {
  const ct = request.headers.get("content-type") || "";

  let payload: any;
  if (ct.includes("application/json")) {
    payload = await request.json();
  } else {
    const fd = await request.formData();
    payload = Object.fromEntries(fd as any);
  }

  const { shop, accessToken } = await db.session.findFirst({
    where: {
      shop: "defent.myshopify.com",
    },
  });
  const { firstName, lastName, streetAddress, postCode, email, productId } =
    payload;
  try {
    const { data } = await axios.post(
      `${import.meta.env.VITE_BASE_URL}/order`,
      {
        firstName,
        lastName,
        streetAddress,
        postCode,
        email,
        productId,
      },
    );
    if (data?.statusCode !== 200 || !data?.success)
      return {
        success: false,
        message: data?.message || "Something went wrong",
      };
    const order = await CreateOrderREST({
      accessToken,
      shop,
      apiVersion: apiVersion || "2024-10",
      firstName,
      lastName,
      streetAddress,
      postCode,
      email,
      productId,
    });
    return {
      success: true,
      order,
    };
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "Something went wrong",
    };
  }
};
