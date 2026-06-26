import { create } from "zustand";

import type { RunningHubWorkflow } from "@/lib/runninghub";
import * as backendRunningHub from "@/services/backend-runninghub";

type RunningHubStore = {
    workflows: RunningHubWorkflow[];
    comfyuiWorkflows: RunningHubWorkflow[];
    hasApiKey: boolean;
    baseUrl: string;
    isOpen: boolean;
    hydrated: boolean;
    setOpen: (isOpen: boolean) => void;
    openDialog: () => void;
    fetchConfigFromServer: () => Promise<void>;
    saveConfig: (payload: { apiKey?: string; baseUrl?: string; workflows?: RunningHubWorkflow[]; comfyuiWorkflows?: RunningHubWorkflow[] }) => Promise<void>;
    setWorkflows: (workflows: RunningHubWorkflow[]) => void;
    setComfyuiWorkflows: (comfyuiWorkflows: RunningHubWorkflow[]) => void;
};

export const useRunningHubStore = create<RunningHubStore>()((set) => ({
    workflows: [],
    comfyuiWorkflows: [],
    hasApiKey: false,
    baseUrl: "",
    isOpen: false,
    hydrated: false,

    setOpen: (isOpen) => set({ isOpen }),
    openDialog: () => set({ isOpen: true }),
    fetchConfigFromServer: async () => {
        try {
            const config = await backendRunningHub.getRunningHubConfig();
            set({ workflows: config.workflows, comfyuiWorkflows: config.comfyuiWorkflows || [], hasApiKey: config.hasApiKey, baseUrl: config.baseUrl || "", hydrated: true });
        } catch {
            set({ hydrated: true });
        }
    },
    saveConfig: async (payload) => {
        const config = await backendRunningHub.updateRunningHubConfig(payload);
        set({ workflows: config.workflows, comfyuiWorkflows: config.comfyuiWorkflows || [], hasApiKey: config.hasApiKey, baseUrl: config.baseUrl || "" });
    },
    setWorkflows: (workflows) => set({ workflows }),
    setComfyuiWorkflows: (comfyuiWorkflows) => set({ comfyuiWorkflows }),
}));
