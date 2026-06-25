import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark";
export type ThemeAccent = "neutral" | "blue" | "purple" | "rose";

type ThemeStore = {
    theme: ThemeMode;
    accent: ThemeAccent;
    setTheme: (theme: ThemeMode) => void;
    setAccent: (accent: ThemeAccent) => void;
    toggleTheme: () => void;
};

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set, get) => ({
            theme: "dark",
            accent: "neutral",
            setTheme: (theme) => set({ theme }),
            setAccent: (accent) => set({ accent }),
            toggleTheme: () => set({ theme: get().theme === "dark" ? "light" : "dark" }),
        }),
        { name: "infinite-canvas:theme_store" },
    ),
);
