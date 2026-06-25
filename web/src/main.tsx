import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppProviders } from "@/components/layout/app-providers";
import { AppRouter } from "./router";
import "./app/globals.css";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter>
            <AppProviders>
                <AppRouter />
            </AppProviders>
        </BrowserRouter>
    </StrictMode>,
);
