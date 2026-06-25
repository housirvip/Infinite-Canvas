import type { ReactNode } from "react";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

import { ClientRootInit } from "@/components/layout/client-root-init";
import { backendWs } from "@/services/backend-ws";
import { useConfigStore } from "@/stores/use-config-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useRunningHubStore } from "@/stores/use-runninghub-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
        },
    },
});

export function AppProviders({ children }: { children: ReactNode }) {
    const theme = useThemeStore((state) => state.theme);
    const accent = useThemeStore((state) => state.accent);
    const dark = theme === "dark";
    const userId = useUserStore((state) => state.user?.id ?? null);
    const authReady = useUserStore((state) => state.authReady);
    const assetsHydrated = useAssetStore((state) => state.hydrated);
    const fetchAssets = useAssetStore((state) => state.fetchAssets);
    const fetchConfigFromServer = useConfigStore((state) => state.fetchConfigFromServer);
    const fetchRunningHubConfigFromServer = useRunningHubStore((state) => state.fetchConfigFromServer);

    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle("dark", dark);
        root.style.colorScheme = theme;
        if (accent === "neutral") {
            delete root.dataset.accent;
        } else {
            root.dataset.accent = accent;
        }
    }, [dark, theme, accent]);

    useEffect(() => {
        if (!authReady || !userId) {
            backendWs.disconnect();
            return;
        }
        backendWs.connect();
        return () => backendWs.disconnect();
    }, [authReady, userId]);

    useEffect(() => {
        if (!authReady || !userId) return;
        void Promise.all([fetchConfigFromServer(), fetchRunningHubConfigFromServer()]);
    }, [authReady, fetchConfigFromServer, fetchRunningHubConfigFromServer, userId]);

    useEffect(() => {
        if (!authReady || !userId || assetsHydrated) return;
        void fetchAssets();
    }, [assetsHydrated, authReady, fetchAssets, userId]);

    return (
        <TooltipProvider>
            <QueryClientProvider client={queryClient}>
                <ClientRootInit>{children}</ClientRootInit>
            </QueryClientProvider>
            <Toaster position="top-center" richColors />
        </TooltipProvider>
    );
}
