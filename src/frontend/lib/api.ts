import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('vustb_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('vustb_token');
    }
    return Promise.reject(err);
  }
);

export const skinApi = axios.create({
  baseURL: '/api/yggdrasil',
  timeout: 15000,
});

export const rawApi = axios.create({
  timeout: 15000,
  withCredentials: true,
});

rawApi.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('vustb_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
