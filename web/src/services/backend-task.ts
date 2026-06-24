import client from "@/services/backend-client";

export type TaskResponse = {
    taskId: string;
    userId: number;
    type: string;
    provider: string;
    status: string;
    channelId: number;
    model: string;
    prompt: string;
    params: string;
    progress: number;
    progressText: string;
    resultData?: string;
    errorMessage?: string;
    fileIds?: string;
    createdAt: string;
    updatedAt: string;
};

type SubmitParams = {
    type: string;
    channelId?: number;
    model: string;
    prompt: string;
    params?: Record<string, any>;
    workflowId?: string;
};

export async function submitTask(params: SubmitParams): Promise<TaskResponse> {
    const res = await client.post("/tasks", params);
    return res.data.task;
}

export async function listTasks(options?: {
    page?: number;
    pageSize?: number;
    type?: string;
    status?: string;
}): Promise<{ tasks: TaskResponse[]; total: number }> {
    const res = await client.get("/tasks", { params: options });
    return res.data;
}

export async function getTask(taskId: string): Promise<TaskResponse> {
    const res = await client.get(`/tasks/${taskId}`);
    return res.data.task;
}

export async function cancelTask(taskId: string): Promise<void> {
    await client.post(`/tasks/${taskId}/cancel`);
}

export async function uploadFile(file: Blob, filename?: string): Promise<{ fileId: string; url: string; mimeType: string; size: number }> {
    const formData = new FormData();
    formData.append("file", file, filename);
    const res = await client.post("/files/upload", formData);
    return res.data;
}

export function fileUrl(fileId: string): string {
    return `/api/v1/files/${fileId}`;
}

export async function submitImageGeneration(params: {
    channelId?: number;
    model: string;
    prompt: string;
    n?: number;
    quality?: string;
    size?: string;
    systemPrompt?: string;
    refFileIds?: string[];
}): Promise<TaskResponse> {
    return submitTask({
        type: "image_generation",
        channelId: params.channelId,
        model: params.model,
        prompt: params.prompt,
        params: {
            n: params.n,
            quality: params.quality,
            size: params.size,
            systemPrompt: params.systemPrompt,
            refFileIds: params.refFileIds,
        },
    });
}

export async function submitImageEdit(params: {
    channelId?: number;
    model: string;
    prompt: string;
    n?: number;
    quality?: string;
    size?: string;
    refFileIds?: string[];
    maskFileId?: string;
}): Promise<TaskResponse> {
    return submitTask({
        type: "image_edit",
        channelId: params.channelId,
        model: params.model,
        prompt: params.prompt,
        params: {
            n: params.n,
            quality: params.quality,
            size: params.size,
            refFileIds: params.refFileIds,
            maskFileId: params.maskFileId,
        },
    });
}

export async function submitVideoGeneration(params: {
    channelId?: number;
    model: string;
    prompt: string;
    refFileIds?: string[];
    seconds?: number;
    quality?: string;
    generateAudio?: boolean;
    watermark?: boolean;
}): Promise<TaskResponse> {
    return submitTask({
        type: "video_generation",
        channelId: params.channelId,
        model: params.model,
        prompt: params.prompt,
        params: {
            refFileIds: params.refFileIds,
            seconds: params.seconds,
            quality: params.quality,
            generateAudio: params.generateAudio,
            watermark: params.watermark,
        },
    });
}

export async function submitAudioGeneration(params: {
    channelId?: number;
    model: string;
    prompt: string;
    voice?: string;
    format?: string;
    speed?: number;
    instructions?: string;
}): Promise<TaskResponse> {
    return submitTask({
        type: "audio_generation",
        channelId: params.channelId,
        model: params.model,
        prompt: params.prompt,
        params: {
            voice: params.voice,
            format: params.format,
            speed: params.speed,
            instructions: params.instructions,
        },
    });
}

export async function submitRunningHubTask(params: {
    channelId?: number;
    model?: string;
    prompt?: string;
    workflowId: string;
    nodeInfoList?: any[];
    mediaFileIds?: Record<string, string>;
}): Promise<TaskResponse> {
    return submitTask({
        type: "runninghub",
        channelId: params.channelId,
        model: params.model || "",
        prompt: params.prompt || "",
        workflowId: params.workflowId,
        params: {
            workflowId: params.workflowId,
            nodeInfoList: params.nodeInfoList,
            mediaFileIds: params.mediaFileIds,
        },
    });
}
