import { create } from "zustand";
import { persist } from "zustand/middleware";

import client, { clearTokens, setOnAuthFailed, setOnTokensRefreshed, setTokens } from "@/services/backend-client";
import { useAssetStore } from "@/stores/use-asset-store";

export type AuthUser = {
    id: number;
    username: string;
    displayName: string;
    role: string;
    maxConcurrency: number;
    avatarUrl?: string;
};

export type LocalUser = AuthUser;

type UserStore = {
    user: AuthUser | null;
    accessToken: string;
    refreshToken: string;
    authReady: boolean;
    login: (username: string, password: string) => Promise<void>;
    register: (username: string, password: string, displayName?: string) => Promise<void>;
    logout: () => void;
    fetchMe: () => Promise<void>;
    hydrateTokens: () => void;
    restoreAuth: () => Promise<void>;
    setRefreshedTokens: (accessToken: string, refreshToken: string) => void;
};

let restoreAuthPromise: Promise<void> | null = null;
let authSessionVersion = 0;

export const useUserStore = create<UserStore>()(
    persist(
        (set, get) => ({
            user: null,
            accessToken: "",
            refreshToken: "",
            authReady: false,

            login: async (username, password) => {
                authSessionVersion += 1;
                const res = await client.post("/auth/login", { username, password });
                const { user, tokens } = res.data;
                setTokens(tokens.accessToken, tokens.refreshToken);
                useAssetStore.getState().reset();
                set({ user, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, authReady: true });
            },

            register: async (username, password, displayName) => {
                authSessionVersion += 1;
                const res = await client.post("/auth/register", { username, password, displayName });
                const { user, tokens } = res.data;
                setTokens(tokens.accessToken, tokens.refreshToken);
                useAssetStore.getState().reset();
                set({ user, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, authReady: true });
            },

            logout: () => {
                authSessionVersion += 1;
                clearTokens();
                useAssetStore.getState().reset();
                set({ user: null, accessToken: "", refreshToken: "", authReady: true });
            },

            fetchMe: async () => {
                const res = await client.get("/auth/me");
                set({ user: res.data.user });
            },

            hydrateTokens: () => {
                const { accessToken, refreshToken } = get();
                if (accessToken || refreshToken) setTokens(accessToken, refreshToken);
            },

            restoreAuth: async () => {
                if (restoreAuthPromise) return restoreAuthPromise;
                const { user, accessToken, refreshToken } = get();
                if (!user && !accessToken && !refreshToken) {
                    set({ authReady: true });
                    return;
                }
                get().hydrateTokens();
                const sessionVersion = authSessionVersion;
                restoreAuthPromise = client
                    .get("/auth/me")
                    .then((res) => {
                        if (authSessionVersion === sessionVersion) {
                            set({ user: res.data.user });
                        }
                    })
                    .catch(() => {})
                    .finally(() => {
                        restoreAuthPromise = null;
                        if (authSessionVersion === sessionVersion && !get().authReady) set({ authReady: true });
                    });
                return restoreAuthPromise;
            },

            setRefreshedTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
        }),
        {
            name: "infinite-canvas:auth",
            partialize: (state) => ({
                user: state.user,
                accessToken: state.accessToken,
                refreshToken: state.refreshToken,
            }),
            onRehydrateStorage: () => (state) => {
                state?.hydrateTokens();
                void state?.restoreAuth();
            },
        },
    ),
);

setOnTokensRefreshed((accessToken, refreshToken) => {
    useUserStore.getState().setRefreshedTokens(accessToken, refreshToken);
});

setOnAuthFailed(() => {
    useUserStore.getState().logout();
});
