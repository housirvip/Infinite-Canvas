import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";

import { AppTopNav } from "@/components/layout/app-top-nav";

export default function UserLayout() {
    const { pathname } = useLocation();

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            <AppTopNav />
            <AnimatePresence mode="wait" initial={false}>
                <motion.div
                    key={pathname}
                    className="min-h-0 flex-1 overflow-hidden"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                >
                    <Outlet />
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
