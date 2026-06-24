import { Routes, Route } from "react-router-dom";

import { AuthGuard } from "@/components/layout/auth-guard";
import UserLayout from "./app/(user)/layout";
import IndexPage from "./app/(user)/page";
import CanvasListPage from "./app/(user)/canvas/page";
import CanvasClientPage from "./app/(user)/canvas/[id]/canvas-client-page";
import ImagePage from "./app/(user)/image/page";
import VideoPage from "./app/(user)/video/page";
import AssetsPage from "./app/(user)/assets/page";
import PromptsPage from "./app/(user)/prompts/page";
import LoginPage from "./app/login/page";
import RegisterPage from "./app/register/page";
import NotFoundPage from "./app/not-found";

export function AppRouter() {
    return (
        <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route element={<AuthGuard />}>
                <Route element={<UserLayout />}>
                    <Route index element={<IndexPage />} />
                    <Route path="canvas" element={<CanvasListPage />} />
                    <Route path="canvas/:id" element={<CanvasClientPage />} />
                    <Route path="image" element={<ImagePage />} />
                    <Route path="video" element={<VideoPage />} />
                    <Route path="assets" element={<AssetsPage />} />
                    <Route path="prompts" element={<PromptsPage />} />
                </Route>
            </Route>
            <Route path="*" element={<NotFoundPage />} />
        </Routes>
    );
}
