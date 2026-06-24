import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useUserStore } from "@/stores/use-user-store";

export function AuthGuard() {
    const user = useUserStore((s) => s.user);
    const location = useLocation();

    if (!user) {
        return <Navigate to="/login" state={{ from: location.pathname }} replace />;
    }

    return <Outlet />;
}
