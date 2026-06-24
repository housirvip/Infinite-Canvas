import { Outlet } from "react-router-dom";

import { AppTopNav } from "@/components/layout/app-top-nav";

export default function UserLayout() {
    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            <AppTopNav />
            <div className="min-h-0 flex-1 overflow-hidden">
                <Outlet />
            </div>
        </div>
    );
}
