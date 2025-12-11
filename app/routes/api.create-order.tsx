import { ActionFunctionArgs } from "@remix-run/node";
import { CreateOrderREST } from "app/utils/Orders";
import db from "../db.server";
import axios from "axios";
import { accessToken } from "app/constant";

export const action = async ({ request }: ActionFunctionArgs) => {
  const ct = request.headers.get("content-type") || "";
  let payload: any;

  try {
    if (ct.includes("application/json")) {
      payload = await request.json();
    } else {
      const fd = await request.formData();
      payload = Object.fromEntries(fd as any);
    }
  } catch (err) {
    console.error("Failed to parse request payload:", err);
    return { success: false, message: "Invalid request payload" };
  }

  const shop = "defent.myshopify.com";
  if (!shop || !accessToken) {
    console.error("Missing credentials", { shop, accessToken });
    return { success: false, message: "Shop or access token missing" };
  }

  const {
    firstName,
    lastName,
    streetAddress,
    streetAddress2,
    postCode,
    email,
    productId,
    subscription,
    demographics: {
      age,
      gender,
      identity,
      household_size,
      ethnicity,
      household_language,
    } = {},
  } = payload;

  try {
    const { data } = await axios.post(
      `${import.meta.env.VITE_BASE_URL}/order`,
      {
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
      },
    );

    if (data?.statusCode !== 200 || !data?.success) {
      console.error("Backend returned failure:", data);
      return {
        success: false,
        message: data?.message || "Order creation failed",
      };
    }

    const order = await CreateOrderREST({
      accessToken,
      shop,
      apiVersion: "2025-10",
      firstName,
      lastName,
      streetAddress,
      streetAddress2,
      age,
      gender,
      identity,
      household_size,
      ethnicity,
      household_language,
      postCode,
      email,
      productId,
    });

    return { success: true, order };
  } catch (error: any) {
    const errorInfo = {
      date: new Date().toISOString(),
      message: error?.message,
      status: error?.response?.status,
      responseData: error?.response?.data,
      stack: error?.stack,
    };

    console.error("Order creation failed:", errorInfo);

    return {
      success: false,
      message:
        error?.response?.data?.message ||
        error?.message ||
        "Something went wrong",
    };
  }
};
