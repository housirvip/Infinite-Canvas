import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";

const BASE_URL = "/api/v1";

let accessToken = "";
let refreshToken = "";
let onAuthFailed: (() => void) | null = null;
let refreshPromise: Promise<string> | null = null;

export function setTokens(access: string, refresh: string) {
    accessToken = access;
    refreshToken = refresh;
}

export function getAccessToken() {
    return accessToken;
}

export function clearTokens() {
    accessToken = "";
    refreshToken = "";
}

export function setOnAuthFailed(fn: () => void) {
    onAuthFailed = fn;
}

async function doRefresh(): Promise<string> {
    if (!refreshToken) throw new Error("no refresh token");
    const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
    const tokens = res.data.tokens as { accessToken: string; refreshToken: string };
    accessToken = tokens.accessToken;
    refreshToken = tokens.refreshToken;
    return accessToken;
}

function ensureRefresh(): Promise<string> {
    if (!refreshPromise) {
        refreshPromise = doRefresh().finally(() => {
            refreshPromise = null;
        });
    }
    return refreshPromise;
}

const client: AxiosInstance = axios.create({ baseURL: BASE_URL });

client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    if (accessToken) {
        config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
});

client.interceptors.response.use(undefined, async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && refreshToken) {
        original._retry = true;
        try {
            const newToken = await ensureRefresh();
            original.headers.Authorization = `Bearer ${newToken}`;
            return client(original);
        } catch {
            clearTokens();
            onAuthFailed?.();
            return Promise.reject(error);
        }
    }
    if (error.response?.status === 401) {
        clearTokens();
        onAuthFailed?.();
    }
    return Promise.reject(error);
});

export default client;
