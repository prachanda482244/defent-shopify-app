import { ActionFunctionArgs } from "@remix-run/node";
import { CreateOrderREST } from "app/utils/Orders";
import db from "../db.server";
import axios from "axios";
import { accessToken } from "app/constant";

export const action = async ({ request }: ActionFunctionArgs) => {
  const ct = request.headers.get("content-type") || "";

  let payload: any;
  if (ct.includes("application/json")) {
    payload = await request.json();
  } else {
    const fd = await request.formData();
    payload = Object.fromEntries(fd as any);
  }

  const shop = "defent.myshopify.com";
  if (!shop || !accessToken) {
    return { success: false, message: "Shop or access token missing" };
  }
  console.log("APi hit");
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
    },
  } = payload;
  console.log({ payload });
  try {
    const { data } = await axios.post(
      `${import.meta.env.VITE_BASE_URL}/order`,
      // `http://localhost:5000/api/v1/order`,
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
    if (data?.statusCode !== 200 || !data?.success)
      return {
        success: false,
        message: data?.message || "Something went wrong",
      };
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
    return {
      success: true,
      order,
    };
  } catch (error: any) {
    console.log(error, "errr");
    return {
      success: false,
      message: error?.message || "Something went wrong",
    };
  }
};
