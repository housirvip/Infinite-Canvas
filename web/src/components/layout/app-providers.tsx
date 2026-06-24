import type { ReactNode } from "react";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

import { ClientRootInit } from "@/components/layout/client-root-init";
import { getAntThemeConfig } from "@/lib/app-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { useConfigStore } from "@/stores/use-config-store";
import { backendWs } from "@/services/backend-ws";

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
    const dark = theme === "dark";
    const user = useUserStore((state) => state.user);
    const fetchConfigFromServer = useConfigStore((state) => state.fetchConfigFromServer);

    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
    }, [dark, theme]);

    useEffect(() => {
        if (user) {
            backendWs.connect();
            fetchConfigFromServer();
        } else {
            backendWs.disconnect();
        }
        return () => backendWs.disconnect();
    }, [user, fetchConfigFromServer]);

    return (
        <ConfigProvider locale={zhCN} theme={getAntThemeConfig(dark)}>
            <App>
                <QueryClientProvider client={queryClient}>
                    <ClientRootInit>{children}</ClientRootInit>
                </QueryClientProvider>
            </App>
        </ConfigProvider>
    );
}
