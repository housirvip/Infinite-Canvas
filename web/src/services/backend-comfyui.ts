import client from "@/services/backend-client";
import type { ComfyUIPreset } from "@/lib/comfyui";

export type ComfyUIConfigResponse = {
    hasApiKey: boolean;
    serverUrl: string;
    presets: ComfyUIPreset[];
    updatedAt?: string;
};

export type UpdateComfyUIConfigPayload = {
    apiKey?: string;
    serverUrl?: string;
    presets?: ComfyUIPreset[];
};

export async function getComfyUIConfig(): Promise<ComfyUIConfigResponse> {
    const res = await client.get("/comfyui/config");
    return res.data.config || { hasApiKey: false, serverUrl: "", presets: [] };
}

export async function updateComfyUIConfig(payload: UpdateComfyUIConfigPayload): Promise<ComfyUIConfigResponse> {
    const res = await client.put("/comfyui/config", payload);
    return res.data.config;
}
