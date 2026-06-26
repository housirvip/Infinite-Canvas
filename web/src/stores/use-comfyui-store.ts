import { create } from "zustand";

import type { ComfyUIPreset } from "@/lib/comfyui";
import * as backendComfyUI from "@/services/backend-comfyui";

type ComfyUIStore = {
    presets: ComfyUIPreset[];
    hasApiKey: boolean;
    serverUrl: string;
    isOpen: boolean;
    hydrated: boolean;
    setOpen: (isOpen: boolean) => void;
    openDialog: () => void;
    fetchConfigFromServer: () => Promise<void>;
    saveConfig: (payload: { apiKey?: string; serverUrl?: string; presets?: ComfyUIPreset[] }) => Promise<void>;
    setPresets: (presets: ComfyUIPreset[]) => void;
};

export const useComfyUIStore = create<ComfyUIStore>()((set) => ({
    presets: [],
    hasApiKey: false,
    serverUrl: "",
    isOpen: false,
    hydrated: false,

    setOpen: (isOpen) => set({ isOpen }),
    openDialog: () => set({ isOpen: true }),
    fetchConfigFromServer: async () => {
        try {
            const config = await backendComfyUI.getComfyUIConfig();
            set({ presets: config.presets, hasApiKey: config.hasApiKey, serverUrl: config.serverUrl || "", hydrated: true });
        } catch {
            set({ hydrated: true });
        }
    },
    saveConfig: async (payload) => {
        const config = await backendComfyUI.updateComfyUIConfig(payload);
        set({ presets: config.presets, hasApiKey: config.hasApiKey, serverUrl: config.serverUrl || "" });
    },
    setPresets: (presets) => set({ presets }),
}));
