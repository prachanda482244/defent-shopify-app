import axios from "axios";

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_BASE_URL,
  //   withCredentials: true,
  timeout: 120000,
});

export default apiClient;
