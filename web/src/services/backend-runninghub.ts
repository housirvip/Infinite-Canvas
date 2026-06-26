import client from "@/services/backend-client";
import type { RunningHubWorkflow } from "@/lib/runninghub";

export type RunningHubConfigResponse = {
    hasApiKey: boolean;
    baseUrl: string;
    workflows: RunningHubWorkflow[];
    updatedAt?: string;
};

export type UpdateRunningHubConfigPayload = {
    apiKey?: string;
    baseUrl?: string;
    workflows?: RunningHubWorkflow[];
};

export async function getRunningHubConfig(): Promise<RunningHubConfigResponse> {
    const res = await client.get("/runninghub/config");
    return res.data.config || { hasApiKey: false, workflows: [] };
}

export async function updateRunningHubConfig(payload: UpdateRunningHubConfigPayload): Promise<RunningHubConfigResponse> {
    const res = await client.put("/runninghub/config", payload);
    return res.data.config;
}
