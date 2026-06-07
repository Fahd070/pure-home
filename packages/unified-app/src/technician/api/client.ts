import axios from "axios";
import { getAuthState } from "../store/authStore";
import { useAppStore } from "../../store/appStore";

const instance = axios.create({ timeout: 30000 });
instance.interceptors.request.use(config => {
  const { token, serverUrl } = getAuthState();
  config.baseURL = serverUrl + "/api";
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
instance.interceptors.response.use(r => r, err => {
  if (err.response?.status === 401) {
    const s = useAppStore.getState();
    if (Date.now() - (s.technicianLoginTime || 0) > 15000) s.clearTechnicianAuth();
  }
  return Promise.reject(err);
});
export const api = instance;