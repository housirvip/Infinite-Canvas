import client from "@/services/backend-client";

export type ChannelResponse = {
    id: number;
    userId: number;
    name: string;
    provider: string;
    baseUrl: string;
    apiFormat: string;
    models: string;
    maxConcurrency: number;
    enabled: boolean;
    hasApiKey: boolean;
    createdAt: string;
    updatedAt: string;
};

export type CreateChannelPayload = {
    name: string;
    provider: string;
    baseUrl: string;
    apiKey: string;
    apiFormat?: string;
    models?: string[];
    maxConcurrency?: number;
};

export type UpdateChannelPayload = {
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    apiFormat?: string;
    models?: string[];
    maxConcurrency?: number;
    enabled?: boolean;
};

export async function listChannels(): Promise<ChannelResponse[]> {
    const res = await client.get("/channels");
    return res.data.channels;
}

export async function createChannel(payload: CreateChannelPayload): Promise<ChannelResponse> {
    const res = await client.post("/channels", payload);
    return res.data.channel;
}

export async function updateChannel(id: number, payload: UpdateChannelPayload): Promise<ChannelResponse> {
    const res = await client.put(`/channels/${id}`, payload);
    return res.data.channel;
}

export async function deleteChannel(id: number): Promise<void> {
    await client.delete(`/channels/${id}`);
}

export async function listChannelModels(id: number): Promise<string[]> {
    const res = await client.get(`/channels/${id}/models`);
    return res.data.models || [];
}
