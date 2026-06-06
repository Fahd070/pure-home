import axios from 'axios';
import { useAuthStore } from '../store/authStore';

export function createApiClient() {
  const store = useAuthStore.getState();
  const instance = axios.create({ baseURL: store.serverUrl + '/api' });
  instance.interceptors.request.use(config => {
    const token = useAuthStore.getState().token;
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });
  instance.interceptors.response.use(
    r => r,
    err => {
      if (err.response?.status === 401) useAuthStore.getState().logout();
      return Promise.reject(err);
    }
  );
  return instance;
}

export const api = createApiClient();
