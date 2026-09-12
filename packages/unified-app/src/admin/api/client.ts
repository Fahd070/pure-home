import axios from "axios";
import { getAuthState } from "../store/authStore";
import { useAppStore } from "../../store/appStore";
import { endApplicationSession } from "../../session";

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
    // v4 Requirement #13: an expired or revoked token ends the session just as
    // surely as pressing Logout, so it gets the SAME global teardown -- every
    // department's socket, token and cached private data. Clearing only this
    // department's token used to leave the previous user's cached work queue
    // readable by whoever signed in next on a shared machine, and left another
    // department's stale token able to satisfy a route guard behind the
    // selector. The guards then land the user on the Department Selector.
    if (Date.now() - (s.adminLoginTime || 0) > 15000) endApplicationSession();
  }
  return Promise.reject(err);
});
export const api = instance;