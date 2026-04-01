import { ActionFunctionArgs } from "@remix-run/node";
import { CreateOrderREST } from "app/utils/Orders";
import db from "../db.server";
import axios from "axios";
import { accessToken } from "app/constant";

export const action = async ({ request }: ActionFunctionArgs) => {
  const ct = request.headers.get("content-type") || "";
  let payload: any;
  const baseURL = import.meta.env.VITE_BASE_URL;

  const sendErrorLog = async (body: any) => {
    try {
      await axios.post(`${baseURL}/error`, body);
    } catch (e: any) {
      console.error("Error logging failed:", e?.message);
    }
  };

  try {
    if (ct.includes("application/json")) {
      payload = await request.json();
    } else {
      const fd = await request.formData();
      payload = Object.fromEntries(fd as any);
    }
  } catch (err: any) {
    console.error("Failed to parse request payload:", err);
    await sendErrorLog({
      source: "shopify-app",
      module: "order-action",
      stage: "request_parse",
      level: "error",
      message: err?.message || "Failed to parse request payload",
      stack: err,
      request: {
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers.entries()),
      },
    });
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

  try {
    const { data } = await axios.post(`${baseURL}/order`, {
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
    });

    if (data?.statusCode !== 200 || !data?.success) {
      console.error("Backend returned failure:", data);
      await sendErrorLog({
        source: "shopify-app",
        module: "order-action",
        stage: "backend_response",
        level: "error",
        message: data?.message || "Backend returned failure",
        statusCode: data?.statusCode,
        response: {
          data,
        },
        context: {
          email,
          productId,
          flag,
        },
        externalService: {
          name: "orders-backend",
          endpoint: `${baseURL}/order`,
          method: "POST",
        },
      });
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
      identifyAsLGBTQ,
      postCode,
      email,
      productId,
      wehoHearAboutUs,
      flag,
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

    await sendErrorLog({
      source: "shopify-app",
      module: "order-action",
      stage: "catch_block",
      level: "error",
      message: error?.message || "Order creation failed",
      statusCode: error?.response?.status,
      stack: error?.stack,
      request: {
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers.entries()),
        body: payload,
      },
      response: {
        data: error?.response?.data,
        headers: error?.response?.headers,
      },
      context: {
        email,
        productId,
        flag,
      },
      externalService: {
        name: error?.config?.baseURL?.includes("shopify")
          ? "shopify"
          : "orders-backend",
        endpoint: error?.config?.url,
        method: error?.config?.method,
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
