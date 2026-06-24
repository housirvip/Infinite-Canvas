import { create } from "zustand";
import { persist } from "zustand/middleware";

import client, { setTokens, clearTokens, setOnAuthFailed } from "@/services/backend-client";

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
    login: (username: string, password: string) => Promise<void>;
    register: (username: string, password: string, displayName?: string) => Promise<void>;
    logout: () => void;
    fetchMe: () => Promise<void>;
    hydrateTokens: () => void;
};

export const useUserStore = create<UserStore>()(
    persist(
        (set, get) => ({
            user: null,
            accessToken: "",
            refreshToken: "",

            login: async (username, password) => {
                const res = await client.post("/auth/login", { username, password });
                const { user, tokens } = res.data;
                setTokens(tokens.accessToken, tokens.refreshToken);
                set({ user, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
            },

            register: async (username, password, displayName) => {
                const res = await client.post("/auth/register", { username, password, displayName });
                const { user, tokens } = res.data;
                setTokens(tokens.accessToken, tokens.refreshToken);
                set({ user, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
            },

            logout: () => {
                clearTokens();
                set({ user: null, accessToken: "", refreshToken: "" });
            },

            fetchMe: async () => {
                const res = await client.get("/auth/me");
                set({ user: res.data.user });
            },

            hydrateTokens: () => {
                const { accessToken, refreshToken } = get();
                if (accessToken) setTokens(accessToken, refreshToken);
            },
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
            },
        },
    ),
);

setOnAuthFailed(() => {
    useUserStore.getState().logout();
});
