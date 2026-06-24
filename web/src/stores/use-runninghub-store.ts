import { create } from "zustand";

import type { RunningHubWorkflow } from "@/lib/runninghub";
import * as backendRunningHub from "@/services/backend-runninghub";

type RunningHubStore = {
    workflows: RunningHubWorkflow[];
    hasApiKey: boolean;
    isOpen: boolean;
    hydrated: boolean;
    setOpen: (isOpen: boolean) => void;
    openDialog: () => void;
    fetchConfigFromServer: () => Promise<void>;
    saveConfig: (payload: { apiKey?: string; workflows?: RunningHubWorkflow[] }) => Promise<void>;
    setWorkflows: (workflows: RunningHubWorkflow[]) => void;
};

export const useRunningHubStore = create<RunningHubStore>()((set) => ({
    workflows: [],
    hasApiKey: false,
    isOpen: false,
    hydrated: false,

    setOpen: (isOpen) => set({ isOpen }),
    openDialog: () => set({ isOpen: true }),
    fetchConfigFromServer: async () => {
        try {
            const config = await backendRunningHub.getRunningHubConfig();
            set({ workflows: config.workflows, hasApiKey: config.hasApiKey, hydrated: true });
        } catch {
            set({ hydrated: true });
        }
    },
    saveConfig: async (payload) => {
        const config = await backendRunningHub.updateRunningHubConfig(payload);
        set({ workflows: config.workflows, hasApiKey: config.hasApiKey });
    },
    setWorkflows: (workflows) => set({ workflows }),
}));
