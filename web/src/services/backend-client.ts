import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";

const BASE_URL = "/api/v1";

let accessToken = "";
let refreshToken = "";
let tokenVersion = 0;
let onAuthFailed: (() => void) | null = null;
let onTokensRefreshed: ((access: string, refresh: string) => void) | null = null;
let refreshPromise: Promise<string> | null = null;
let isApplyingRefresh = false;

function applyTokens(access: string, refresh: string) {
    tokenVersion += 1;
    accessToken = access;
    refreshToken = refresh;
    if (isApplyingRefresh) onTokensRefreshed?.(access, refresh);
}

export function setTokens(access: string, refresh: string) {
    applyTokens(access, refresh);
}

export function getAccessToken() {
    return accessToken;
}

export function clearTokens() {
    tokenVersion += 1;
    accessToken = "";
    refreshToken = "";
}

export function setOnAuthFailed(fn: () => void) {
    onAuthFailed = fn;
}

export function setOnTokensRefreshed(fn: (access: string, refresh: string) => void) {
    onTokensRefreshed = fn;
}

async function doRefresh(): Promise<string> {
    if (!refreshToken) throw new Error("no refresh token");
    const sessionVersion = tokenVersion;
    const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
    if (sessionVersion !== tokenVersion) throw new Error("stale refresh");
    const tokens = res.data.tokens as { accessToken: string; refreshToken: string };
    isApplyingRefresh = true;
    applyTokens(tokens.accessToken, tokens.refreshToken);
    isApplyingRefresh = false;
    return accessToken;
}

function ensureRefresh(): Promise<string> {
    if (!refreshPromise) {
        refreshPromise = doRefresh().finally(() => {
            refreshPromise = null;
            isApplyingRefresh = false;
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
        } catch (refreshError) {
            if (refreshError instanceof Error && refreshError.message === "stale refresh") {
                return Promise.reject(error);
            }
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
