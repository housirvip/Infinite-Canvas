import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useUserStore } from "@/stores/use-user-store";

export function AuthGuard() {
    const user = useUserStore((s) => s.user);
    const authReady = useUserStore((s) => s.authReady);
    const location = useLocation();

    if (!authReady) {
        return <main className="flex h-full items-center justify-center bg-background text-sm text-stone-500">正在验证登录状态...</main>;
    }

    if (!user) {
        return <Navigate to="/login" state={{ from: location.pathname }} replace />;
    }

    return <Outlet />;
}
