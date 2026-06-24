import axios from "axios";
import { nanoid } from "nanoid";

import { RUNNINGHUB_BASE_URL, RUNNINGHUB_POLL_DELAY_MS, RUNNINGHUB_DEFAULT_TIMEOUT_S, buildNodeInfoList, isImageOutput, isVideoOutput, paramKey, type RunningHubWorkflow, type RunningHubTaskResponse, type RunningHubTaskResult, type RunningHubParamValues } from "@/lib/runninghub";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";

type RequestOptions = { signal?: AbortSignal };
type StatusCallback = (status: string, detail?: string) => void;

export type RunningHubExecuteResult = {
    type: "image" | "video" | "text";
    id: string;
    dataUrl?: string;
    storageKey?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
    url?: string;
    durationMs?: number;
    text?: string;
};

// ========== 核心 API ==========

export async function pollRunningHubTask(apiKey: string, taskId: string, options?: RequestOptions): Promise<RunningHubTaskResponse> {
    try {
        const response = await axios.post<RunningHubTaskResponse>(`${RUNNINGHUB_BASE_URL}/openapi/v2/query`, { taskId }, { headers: runninghubHeaders(apiKey), signal: options?.signal });
        return response.data;
    } catch (error) {
        throw new Error(readError(error, "RunningHub 任务查询失败"));
    }
}

export async function uploadRunningHubFile(apiKey: string, blob: Blob, options?: RequestOptions): Promise<string> {
    const formData = new FormData();
    formData.append("file", blob);
    try {
        const response = await axios.post<{ code: number; message?: string; data?: { download_url?: string } }>(`${RUNNINGHUB_BASE_URL}/openapi/v2/media/upload/binary`, formData, { headers: { Authorization: `Bearer ${apiKey}` }, signal: options?.signal });
        const url = response.data?.data?.download_url;
        if (!url) throw new Error(response.data?.message || "文件上传失败");
        return url;
    } catch (error) {
        throw new Error(readError(error, "RunningHub 文件上传失败"));
    }
}

// ========== 完整执行流程 ==========

export async function executeRunningHubWorkflow(apiKey: string, workflow: RunningHubWorkflow, values: RunningHubParamValues, mediaBlobs: Map<string, Blob>, timeoutSeconds: number = RUNNINGHUB_DEFAULT_TIMEOUT_S, onStatus?: StatusCallback, options?: RequestOptions): Promise<RunningHubExecuteResult[]> {
    // 1. 上传媒体 Blob → URL
    if (mediaBlobs.size > 0) {
        onStatus?.("uploading", "上传媒体文件...");
        for (const [key, blob] of mediaBlobs.entries()) {
            if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
            const url = await uploadRunningHubFile(apiKey, blob, options);
            if (blob.type.startsWith("video/")) {
                values = { ...values, videos: { ...values.videos, [key]: url } };
            } else {
                values = { ...values, images: { ...values.images, [key]: url } };
            }
        }
    }

    // 2. 组装 nodeInfoList 并提交
    const nodeInfoList = buildNodeInfoList(workflow, values);
    onStatus?.("submitting", "提交任务...");

    let taskId: string;
    try {
        const response = await axios.post<RunningHubTaskResponse>(
            `${RUNNINGHUB_BASE_URL}/openapi/v2/run/ai-app/${workflow.workflowId}`,
            { nodeInfoList, instanceType: workflow.instanceType || "default" },
            { headers: runninghubHeaders(apiKey), signal: options?.signal },
        );
        if (!response.data.taskId) throw new Error(response.data.errorMessage || "任务创建失败");
        taskId = response.data.taskId;
    } catch (error) {
        throw new Error(readError(error, "RunningHub 任务创建失败"));
    }

    // 3. 轮询
    return await pollUntilComplete(apiKey, taskId, timeoutSeconds, onStatus, options);
}

// 恢复轮询
export async function resumeRunningHubPoll(apiKey: string, taskId: string, timeoutSeconds: number = RUNNINGHUB_DEFAULT_TIMEOUT_S, onStatus?: StatusCallback, options?: RequestOptions): Promise<RunningHubExecuteResult[]> {
    onStatus?.("polling", "恢复查询...");
    return await pollUntilComplete(apiKey, taskId, timeoutSeconds, onStatus, options);
}

// ========== 超时错误 ==========

export class RunningHubTimeoutError extends Error {
    constructor(
        public taskId: string,
        public timeoutSeconds: number,
    ) {
        super(`查询超时（${Math.round(timeoutSeconds / 60)} 分钟），任务可能仍在运行`);
        this.name = "RunningHubTimeoutError";
    }
}

// ========== 内部工具 ==========

async function pollUntilComplete(apiKey: string, taskId: string, timeoutSeconds: number, onStatus?: StatusCallback, options?: RequestOptions): Promise<RunningHubExecuteResult[]> {
    onStatus?.("polling", "排队中...");
    const maxAttempts = Math.ceil((timeoutSeconds * 1000) / RUNNINGHUB_POLL_DELAY_MS);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        await delay(RUNNINGHUB_POLL_DELAY_MS, options?.signal);

        const result = await pollRunningHubTask(apiKey, taskId, options);

        if (result.status === "RUNNING") {
            onStatus?.("running", `运行中... (${Math.round(((attempt + 1) * RUNNINGHUB_POLL_DELAY_MS) / 1000)}s)`);
        }
        if (result.status === "SUCCESS") {
            onStatus?.("downloading", "下载结果...");
            return await downloadResults(result.results || [], options);
        }
        if (result.status === "FAILED") {
            throw new Error(result.errorMessage || "RunningHub 工作流执行失败");
        }
    }

    throw new RunningHubTimeoutError(taskId, timeoutSeconds);
}

async function downloadResults(results: RunningHubTaskResult[], options?: RequestOptions): Promise<RunningHubExecuteResult[]> {
    const outputs: RunningHubExecuteResult[] = [];

    for (const result of results) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

        if (isImageOutput(result.outputType)) {
            const blob = await downloadBlob(result.url, options);
            const stored = await uploadImage(blob);
            outputs.push({ type: "image", id: nanoid(), dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType });
        } else if (isVideoOutput(result.outputType)) {
            const blob = await downloadBlob(result.url, options);
            const stored = await uploadMediaFile(blob, "video");
            outputs.push({ type: "video", id: nanoid(), url: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType, durationMs: stored.durationMs });
        } else if (result.text) {
            outputs.push({ type: "text", id: nanoid(), text: result.text });
        }
    }

    return outputs;
}

async function downloadBlob(url: string, options?: RequestOptions): Promise<Blob> {
    const response = await axios.get(url, { responseType: "blob", signal: options?.signal });
    return response.data;
}

function runninghubHeaders(apiKey: string) {
    return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

function readError(error: unknown, fallback: string): string {
    if (axios.isCancel(error)) return "请求已取消";
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    if (axios.isAxiosError(error)) {
        const data = error.response?.data as { errorMessage?: string; msg?: string; message?: string } | undefined;
        return data?.errorMessage || data?.msg || data?.message || (error.response?.status ? `${fallback}：${error.response.status}` : fallback);
    }
    return error instanceof Error ? error.message : fallback;
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    });
}
