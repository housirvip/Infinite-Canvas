# RunningHub 工作流节点对接实现方案

> 创建时间: 2026-06-23

## 1. 背景与目标

### 1.1 现状

项目当前支持 5 种画布节点类型 (image/text/config/video/audio)，生成能力通过 Config 节点调用 OpenAI/Gemini/Seedance 接口实现。

### 1.2 目标

新增 **RunningHub 专属画布节点**，让用户可以直接在画布上调用 RunningHub 云端 ComfyUI 工作流，支持：
- 文生图、图生图、文生视频、图生视频等各种工作流
- 单次执行返回多个结果（多图、图+视频混合）
- 异步任务执行 + 自动轮询 + 超时重试
- 结果自动下载到本地并创建标准画布节点

### 1.3 RunningHub API 概要

| 接口 | 端点 | 说明 |
|------|------|------|
| 提交任务 | `POST /openapi/v2/run/ai-app/{workflowId}` | 返回 taskId |
| 查询结果 | `POST /openapi/v2/query` | 返回 status + results |
| 上传文件 | `POST /openapi/v2/media/upload/binary` | 返回 download_url |

认证：`Authorization: Bearer {API_KEY}`
任务状态：`QUEUED → RUNNING → SUCCESS / FAILED`
结果：`results[]: { url, nodeId, outputType, text }`（URL 24h 有效）

---

## 2. 架构设计

### 2.1 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 节点方式 | 新增专属 RunningHub 节点类型 | 工作流参数模型与现有 prompt+model 差异大 |
| 配置管理 | API Key + 工作流列表在全局设置 | 工作流配置是稳定的，不应重复配置 |
| 结果展示 | 自动创建输出节点并连线 | 与现有 Config 节点行为一致 |
| 结果存储 | 立即下载到本地 IndexedDB | URL 24h 过期，必须持久化 |
| 多结果处理 | 每个 result 创建独立节点 | 支持混合输出（图+视频+文本） |

### 2.2 用户交互流程

```
全局设置中配置:
  ├── RunningHub API Key
  └── 工作流列表
       ├── "文生图" → workflowId + promptNode 映射
       ├── "图生视频" → workflowId + imageNode 映射
       └── ...

画布操作:
  1. 用户添加 RunningHub 节点
  2. 选择工作流（从全局列表）
  3. 输入提示词 / 连线参考图片
  4. 设置超时时间（可选，默认10min）
  5. 点击"执行工作流"
  6. 节点进入 loading 状态，显示轮询进度
  7. 完成后自动在右侧创建输出节点（image/video/text）并连线
```

### 2.3 数据流

```
┌─────────────────┐     连线输入      ┌──────────────────┐     自动创建       ┌─────────────┐
│  Image 节点      │ ────────────────→ │  RunningHub 节点  │ ────────────────→ │ Image 节点   │
│  (参考图)        │                   │                  │                   │ (生成结果1)  │
└─────────────────┘                   │  - 工作流选择     │                   └─────────────┘
                                      │  - 提示词输入     │                   ┌─────────────┐
┌─────────────────┐                   │  - 实例类型      │ ────────────────→ │ Video 节点   │
│  Text 节点       │ ────────────────→ │  - 超时设置      │                   │ (生成结果2)  │
│  (补充文本)      │                   │  - [执行]按钮    │                   └─────────────┘
└─────────────────┘                   └──────────────────┘
```

---

## 3. 详细实现方案

### 3.1 类型系统变更

#### `web/src/app/(user)/canvas/types.ts`

```typescript
// 扩展节点类型枚举
export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Video = "video",
    Audio = "audio",
    RunningHub = "runninghub",  // 新增
}

// 扩展节点 Metadata
export type CanvasNodeMetadata = {
    // ... 现有字段保持不变

    // RunningHub 专用
    runninghubWorkflowId?: string;       // 关联的全局工作流配置 ID
    runninghubTaskId?: string;           // 当前/最近一次任务 ID
    runninghubInstanceType?: "default" | "plus";
    runninghubTimeout?: number;          // 超时时间（秒），默认 600
    runninghubLastError?: string;        // 最近一次错误信息
};
```

#### `canvas-agent/src/types.ts`

```typescript
export type CanvasNodeType = "image" | "text" | "config" | "video" | "audio" | "runninghub";
```

#### `canvas-agent/src/schemas.ts`

```typescript
const nodeTypeSchema = z.enum(["image", "text", "config", "video", "audio", "runninghub"]);
```

#### `web/src/app/(user)/canvas/constants.ts`

```typescript
[CanvasNodeType.RunningHub]: { width: 360, height: 280, title: "RunningHub" },
// NODE_SPECS 中:
[CanvasNodeType.RunningHub]: {
    ...NODE_DEFAULT_SIZE[CanvasNodeType.RunningHub],
    metadata: { status: "idle" },
},
```

### 3.2 RunningHub 核心模块

#### 新建 `web/src/lib/runninghub.ts`

```typescript
import { nanoid } from "nanoid";

// ========== 类型 ==========

export type RunningHubWorkflow = {
    id: string;                    // 内部 ID (nanoid)
    name: string;                  // 展示名称，如 "FLUX文生图"
    workflowId: string;            // RunningHub 工作流 ID (长数字串)
    outputType: "image" | "video" | "auto";
    instanceType: "default" | "plus";
    // 预设节点映射 —— 基础模式
    promptNodeId?: string;         // 提示词文本对应的 nodeId
    promptFieldName?: string;      // 默认 "text"
    imageNodeId?: string;          // 图片输入对应的 nodeId
    imageFieldName?: string;       // 默认 "image"
    // 高级模式 —— 完整自定义 nodeInfoList
    customNodes?: RunningHubNodeInfo[];
};

export type RunningHubNodeInfo = {
    nodeId: string;
    fieldName: string;
    fieldValue: string;   // 固定值，或模板变量 {{prompt}} / {{image}}
    description?: string; // 可选描述，方便用户理解
};

export type RunningHubTaskResult = {
    url: string;
    nodeId: string;
    outputType: string;   // "png", "jpg", "webp", "mp4", "txt" 等
    text?: string | null;
};

export type RunningHubTaskResponse = {
    taskId: string;
    status: "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED";
    errorCode?: string;
    errorMessage?: string;
    results?: RunningHubTaskResult[] | null;
    clientId?: string;
    promptTips?: string;
    usage?: {
        consumeMoney?: string | null;
        consumeCoins?: string | null;
        taskCostTime?: string;
    };
};

// ========== 常量 ==========

export const RUNNINGHUB_BASE_URL = "https://www.runninghub.cn";
export const RUNNINGHUB_POLL_DELAY_MS = 4000;
export const RUNNINGHUB_DEFAULT_TIMEOUT_S = 600;     // 10 分钟
export const RUNNINGHUB_TIMEOUT_OPTIONS = [
    { value: 300, label: "5 分钟" },
    { value: 600, label: "10 分钟" },
    { value: 900, label: "15 分钟" },
    { value: 1200, label: "20 分钟" },
    { value: 1800, label: "30 分钟" },
];

// 图片类输出扩展名
export const IMAGE_OUTPUT_TYPES = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);
// 视频类输出扩展名
export const VIDEO_OUTPUT_TYPES = new Set(["mp4", "mov", "avi", "webm"]);

// ========== 工具函数 ==========

export function createRunningHubWorkflow(partial?: Partial<RunningHubWorkflow>): RunningHubWorkflow {
    return {
        id: partial?.id || nanoid(),
        name: partial?.name || "新工作流",
        workflowId: partial?.workflowId || "",
        outputType: partial?.outputType || "auto",
        instanceType: partial?.instanceType || "default",
        promptNodeId: partial?.promptNodeId || "",
        promptFieldName: partial?.promptFieldName || "text",
        imageNodeId: partial?.imageNodeId || "",
        imageFieldName: partial?.imageFieldName || "image",
        customNodes: partial?.customNodes || [],
    };
}

export function isImageOutput(outputType: string): boolean {
    return IMAGE_OUTPUT_TYPES.has(outputType.toLowerCase());
}

export function isVideoOutput(outputType: string): boolean {
    return VIDEO_OUTPUT_TYPES.has(outputType.toLowerCase());
}

export function isTextOutput(outputType: string): boolean {
    return outputType.toLowerCase() === "txt";
}

export function buildNodeInfoList(
    workflow: RunningHubWorkflow,
    prompt: string,
    imageUrls: string[]
): RunningHubNodeInfo[] {
    const list: RunningHubNodeInfo[] = [];

    // 预设映射
    if (workflow.promptNodeId && prompt) {
        list.push({
            nodeId: workflow.promptNodeId,
            fieldName: workflow.promptFieldName || "text",
            fieldValue: prompt,
        });
    }
    if (workflow.imageNodeId && imageUrls.length > 0) {
        list.push({
            nodeId: workflow.imageNodeId,
            fieldName: workflow.imageFieldName || "image",
            fieldValue: imageUrls[0], // 主图
        });
    }

    // 高级自定义节点 —— 模板变量替换
    for (const node of workflow.customNodes || []) {
        let value = node.fieldValue;
        value = value.replace(/\{\{prompt\}\}/g, prompt);
        value = value.replace(/\{\{image\}\}/g, imageUrls[0] || "");
        list.push({ nodeId: node.nodeId, fieldName: node.fieldName, fieldValue: value });
    }

    return list;
}
```

### 3.3 RunningHub API 服务

#### 新建 `web/src/services/api/runninghub.ts`

```typescript
import axios from "axios";
import { nanoid } from "nanoid";
import {
    RUNNINGHUB_BASE_URL,
    RUNNINGHUB_POLL_DELAY_MS,
    RUNNINGHUB_DEFAULT_TIMEOUT_S,
    buildNodeInfoList,
    isImageOutput,
    isVideoOutput,
    type RunningHubWorkflow,
    type RunningHubTaskResponse,
    type RunningHubTaskResult,
} from "@/lib/runninghub";
import { uploadImage } from "@/services/image-storage";
import { uploadMediaFile } from "@/services/file-storage";

type RequestOptions = { signal?: AbortSignal };
type StatusCallback = (status: string, detail?: string) => void;

export type RunningHubExecuteResult = {
    type: "image" | "video" | "text";
    id: string;
    // 图片
    dataUrl?: string;
    storageKey?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
    // 视频
    url?: string;
    durationMs?: number;
    // 文本
    text?: string;
};

// ========== 核心 API ==========

export async function createRunningHubTask(
    apiKey: string,
    workflow: RunningHubWorkflow,
    prompt: string,
    imageUrls: string[],
    options?: RequestOptions
): Promise<{ taskId: string; status: string }> {
    const nodeInfoList = buildNodeInfoList(workflow, prompt, imageUrls);
    if (!nodeInfoList.length && !prompt) {
        throw new Error("请输入提示词或连接参考图片");
    }
    const response = await axios.post<RunningHubTaskResponse>(
        `${RUNNINGHUB_BASE_URL}/openapi/v2/run/ai-app/${workflow.workflowId}`,
        {
            nodeInfoList,
            instanceType: workflow.instanceType || "default",
        },
        {
            headers: runninghubHeaders(apiKey),
            signal: options?.signal,
        }
    );
    const data = response.data;
    if (!data.taskId) throw new Error(data.errorMessage || "RunningHub 任务创建失败");
    return { taskId: data.taskId, status: data.status || "QUEUED" };
}

export async function pollRunningHubTask(
    apiKey: string,
    taskId: string,
    options?: RequestOptions
): Promise<RunningHubTaskResponse> {
    const response = await axios.post<RunningHubTaskResponse>(
        `${RUNNINGHUB_BASE_URL}/openapi/v2/query`,
        { taskId },
        {
            headers: runninghubHeaders(apiKey),
            signal: options?.signal,
        }
    );
    return response.data;
}

export async function uploadRunningHubFile(
    apiKey: string,
    blob: Blob,
    options?: RequestOptions
): Promise<string> {
    const formData = new FormData();
    formData.append("file", blob);
    const response = await axios.post<{ code: number; data?: { download_url?: string } }>(
        `${RUNNINGHUB_BASE_URL}/openapi/v2/media/upload/binary`,
        formData,
        {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: options?.signal,
        }
    );
    const url = response.data?.data?.download_url;
    if (!url) throw new Error("RunningHub 文件上传失败");
    return url;
}

// ========== 完整执行流程 ==========

export async function executeRunningHubWorkflow(
    apiKey: string,
    workflow: RunningHubWorkflow,
    prompt: string,
    referenceImageBlobs: Blob[],
    timeoutSeconds: number = RUNNINGHUB_DEFAULT_TIMEOUT_S,
    onStatus?: StatusCallback,
    options?: RequestOptions
): Promise<RunningHubExecuteResult[]> {
    // 1. 上传参考图片
    onStatus?.("uploading", "上传参考图片...");
    const imageUrls: string[] = [];
    for (const blob of referenceImageBlobs) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const url = await uploadRunningHubFile(apiKey, blob, options);
        imageUrls.push(url);
    }

    // 2. 提交任务
    onStatus?.("submitting", "提交任务...");
    const { taskId } = await createRunningHubTask(apiKey, workflow, prompt, imageUrls, options);

    // 3. 轮询
    onStatus?.("polling", "排队中...");
    const maxAttempts = Math.ceil((timeoutSeconds * 1000) / RUNNINGHUB_POLL_DELAY_MS);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        await delay(RUNNINGHUB_POLL_DELAY_MS, options?.signal);

        const result = await pollRunningHubTask(apiKey, taskId, options);

        if (result.status === "RUNNING") {
            onStatus?.("running", `运行中... (${Math.round((attempt * RUNNINGHUB_POLL_DELAY_MS) / 1000)}s)`);
        }
        if (result.status === "SUCCESS") {
            onStatus?.("downloading", "下载结果...");
            return await downloadResults(result.results || [], options);
        }
        if (result.status === "FAILED") {
            throw new Error(result.errorMessage || "RunningHub 工作流执行失败");
        }
    }

    // 超时 — 不抛错，返回特殊状态让调用方决策
    throw new RunningHubTimeoutError(taskId, timeoutSeconds);
}

// 手动恢复轮询 —— 用于超时后重试查询
export async function resumeRunningHubPoll(
    apiKey: string,
    taskId: string,
    timeoutSeconds: number = RUNNINGHUB_DEFAULT_TIMEOUT_S,
    onStatus?: StatusCallback,
    options?: RequestOptions
): Promise<RunningHubExecuteResult[]> {
    onStatus?.("polling", "恢复查询...");
    const maxAttempts = Math.ceil((timeoutSeconds * 1000) / RUNNINGHUB_POLL_DELAY_MS);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const result = await pollRunningHubTask(apiKey, taskId, options);

        if (result.status === "SUCCESS") {
            onStatus?.("downloading", "下载结果...");
            return await downloadResults(result.results || [], options);
        }
        if (result.status === "FAILED") {
            throw new Error(result.errorMessage || "任务已失败");
        }
        onStatus?.("running", `查询中... (${Math.round((attempt * RUNNINGHUB_POLL_DELAY_MS) / 1000)}s)`);
        await delay(RUNNINGHUB_POLL_DELAY_MS, options?.signal);
    }
    throw new RunningHubTimeoutError(taskId, timeoutSeconds);
}

// ========== 内部工具 ==========

export class RunningHubTimeoutError extends Error {
    constructor(public taskId: string, public timeoutSeconds: number) {
        super(`查询超时（${Math.round(timeoutSeconds / 60)} 分钟），任务可能仍在运行`);
        this.name = "RunningHubTimeoutError";
    }
}

async function downloadResults(
    results: RunningHubTaskResult[],
    options?: RequestOptions
): Promise<RunningHubExecuteResult[]> {
    const outputs: RunningHubExecuteResult[] = [];

    for (const result of results) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

        if (isImageOutput(result.outputType)) {
            // 下载图片 → 存入 IndexedDB
            const blob = await downloadBlob(result.url, options);
            const stored = await uploadImage(blob);
            outputs.push({
                type: "image",
                id: nanoid(),
                dataUrl: stored.url,
                storageKey: stored.storageKey,
                width: stored.width,
                height: stored.height,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
            });
        } else if (isVideoOutput(result.outputType)) {
            // 下载视频 → 存入 IndexedDB
            const blob = await downloadBlob(result.url, options);
            const stored = await uploadMediaFile(blob, "video");
            outputs.push({
                type: "video",
                id: nanoid(),
                url: stored.url,
                storageKey: stored.storageKey,
                width: stored.width,
                height: stored.height,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
                durationMs: stored.durationMs,
            });
        } else if (result.text) {
            outputs.push({
                type: "text",
                id: nanoid(),
                text: result.text,
            });
        }
    }

    return outputs;
}

async function downloadBlob(url: string, options?: RequestOptions): Promise<Blob> {
    const response = await axios.get(url, {
        responseType: "blob",
        signal: options?.signal,
    });
    return response.data;
}

function runninghubHeaders(apiKey: string) {
    return {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
    };
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
    });
}
```

### 3.4 全局配置 Store 变更

#### `web/src/stores/use-config-store.ts`

在 `AiConfig` 类型中新增：
```typescript
export type AiConfig = {
    // ... 现有字段不动
    runninghubApiKey: string;
    runninghubWorkflows: RunningHubWorkflow[];
};
```

在 `defaultConfig` 中补充默认值：
```typescript
runninghubApiKey: "",
runninghubWorkflows: [],
```

### 3.5 画布节点组件

#### 新建 `web/src/app/(user)/canvas/components/canvas-runninghub-node.tsx`

RunningHub 节点内容渲染器（在 `nodeContentRenderers` 中注册）：

**就绪状态**：
- 顶部：RunningHub 品牌色图标 + 工作流名称（如未选择显示"未配置工作流"）
- 中部：提示词预览（截断显示）
- 底部：实例类型标签 + 超时设置标签

**执行中状态**（替代 `LoadingContent`，因为需要更多信息）：
- 动画进度指示
- 当前状态文字（排队中 / 运行中 / 下载结果...）
- 已用时间

**完成状态**：
- 显示"已完成"标记 + 输出数量摘要（如 "3 张图片, 1 个视频"）

**失败状态**：
- 错误信息
- "重试"按钮 + "重新查询"按钮（如果有 taskId）

#### 新建 `web/src/app/(user)/canvas/components/canvas-runninghub-panel.tsx`

选中 RunningHub 节点后在下方显示的操作面板：

```
┌─────────────────────────────────────────────────────┐
│ [工作流选择器 ▼]                                     │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐ │
│ │ 提示词输入框 (支持 @mention 引用上游节点)        │ │
│ └─────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│ 实例: [default ▼]    超时: [10分钟 ▼]               │
├─────────────────────────────────────────────────────┤
│            [ 🚀 执行工作流 ]  /  [ ⏹ 停止 ]          │
│            [ 🔄 重新查询 ]  (仅超时后显示)            │
└─────────────────────────────────────────────────────┘
```

### 3.6 执行与输出逻辑

#### `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`

新增 `handleRunningHubExecute` 回调函数：

```typescript
const handleRunningHubExecute = useCallback(async (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    const workflow = config.runninghubWorkflows.find(w => w.id === node?.metadata?.runninghubWorkflowId);
    if (!workflow || !config.runninghubApiKey) {
        // 提示配置
        return;
    }

    const abortController = new AbortController();
    // 保存到 ref 以支持停止

    // 1. 收集上游参考图片
    const upstreamImages = await collectUpstreamImages(nodeId, nodes, connections);

    // 2. 设置节点为 loading
    updateNodeMetadata(nodeId, { status: "loading", runninghubLastError: undefined });

    try {
        // 3. 执行工作流
        const results = await executeRunningHubWorkflow(
            config.runninghubApiKey,
            workflow,
            node.metadata?.prompt || "",
            upstreamImages,
            node.metadata?.runninghubTimeout || RUNNINGHUB_DEFAULT_TIMEOUT_S,
            (status, detail) => {
                // 更新节点状态文字（可选）
            },
            { signal: abortController.signal }
        );

        // 4. 根据结果创建输出节点
        const outputNodes = [];
        let offsetX = node.position.x + node.width + 80;
        let offsetY = node.position.y;

        for (const result of results) {
            if (result.type === "image") {
                const imageNode = createImageNode(result, offsetX, offsetY);
                outputNodes.push(imageNode);
                offsetY += imageNode.height + 40;
            } else if (result.type === "video") {
                const videoNode = createVideoNode(result, offsetX, offsetY);
                outputNodes.push(videoNode);
                offsetY += videoNode.height + 40;
            } else if (result.type === "text") {
                const textNode = createTextNode(result, offsetX, offsetY);
                outputNodes.push(textNode);
                offsetY += textNode.height + 40;
            }
        }

        // 5. 添加节点到画布 + 创建连线
        addNodes(outputNodes);
        addConnections(outputNodes.map(n => ({ fromNodeId: nodeId, toNodeId: n.id })));

        // 6. 更新源节点状态
        updateNodeMetadata(nodeId, { status: "success" });

    } catch (error) {
        if (error instanceof RunningHubTimeoutError) {
            updateNodeMetadata(nodeId, {
                status: "error",
                runninghubTaskId: error.taskId,
                runninghubLastError: error.message,
            });
        } else {
            updateNodeMetadata(nodeId, {
                status: "error",
                runninghubLastError: error instanceof Error ? error.message : "执行失败",
            });
        }
    }
}, [nodes, connections, config]);
```

**重新查询（超时恢复）**：

```typescript
const handleRunningHubResume = useCallback(async (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    const taskId = node?.metadata?.runninghubTaskId;
    if (!taskId || !config.runninghubApiKey) return;

    updateNodeMetadata(nodeId, { status: "loading", runninghubLastError: undefined });

    try {
        const results = await resumeRunningHubPoll(
            config.runninghubApiKey,
            taskId,
            node.metadata?.runninghubTimeout || RUNNINGHUB_DEFAULT_TIMEOUT_S,
            (status, detail) => { /* 状态回调 */ },
            { signal: abortController.signal }
        );
        // 同上创建输出节点...
    } catch (error) {
        // 同上错误处理...
    }
}, [nodes, config]);
```

### 3.7 全局设置 UI

#### `web/src/components/layout/app-config-modal.tsx`

在 Tabs 中新增 "RunningHub" 标签页：

```
┌───────────────────────────────────────────────────────────┐
│ [渠道] [模型] [RunningHub] [WebDAV 同步]                    │
├───────────────────────────────────────────────────────────┤
│                                                           │
│  API Key: [••••••••••••••••••••]                           │
│                                                           │
│  工作流列表:                                     [+ 新增]  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ 📋 FLUX文生图                              [编辑][删除] │  │
│  │    工作流 ID: 2061806559944073217                    │  │
│  │    输出: 图片 | 实例: default                        │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │ 📋 图生视频                                [编辑][删除] │  │
│  │    工作流 ID: 3072...                               │  │
│  │    输出: 视频 | 实例: plus                           │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

#### 新建 `web/src/components/layout/runninghub-workflow-editor.tsx`

工作流编辑弹窗/面板：

```
┌─────────────────────────────────────────────────────────┐
│ 编辑工作流                                               │
├─────────────────────────────────────────────────────────┤
│ 名称:       [FLUX文生图                        ]         │
│ 工作流 ID:  [2061806559944073217               ]         │
│ 输出类型:   [图片 ▼]  (图片 / 视频 / 自动识别)           │
│ 实例类型:   [default ▼]  (default 24G / plus 48G)        │
├─────────────────────────────────────────────────────────┤
│ 节点映射 (基础模式):                                     │
│                                                         │
│ 提示词节点:  Node ID [89   ]  Field [text  ]            │
│ 图片节点:    Node ID [415  ]  Field [image ]            │
├─────────────────────────────────────────────────────────┤
│ ▶ 高级模式 (自定义 nodeInfoList)                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [CodeMirror JSON 编辑器]                            │ │
│ │ [                                                   │ │
│ │   { "nodeId": "374",                                │ │
│ │     "fieldName": "value",                           │ │
│ │     "fieldValue": "true" }                          │ │
│ │ ]                                                   │ │
│ └─────────────────────────────────────────────────────┘ │
│ 支持模板变量: {{prompt}} = 提示词, {{image}} = 图片URL    │
├─────────────────────────────────────────────────────────┤
│                              [取消]  [保存]              │
└─────────────────────────────────────────────────────────┘
```

### 3.8 画布入口集成

#### `canvas-client-page.tsx` 中的添加节点入口

1. **底部工具栏**：新增 RunningHub 图标按钮
2. **ConnectionCreateMenu**：新增 RunningHub 选项
3. **右键菜单**：对 RunningHub 节点增加"执行"/"重新查询"/"修改配置"

### 3.9 多结果输出布局

执行完成后，输出节点布局策略：

```typescript
// 输出节点排列在 RunningHub 节点右侧
// 多个输出纵向排列，间距 40px
function layoutOutputNodes(
    sourceNode: CanvasNodeData,
    results: RunningHubExecuteResult[]
): Array<{ position: Position; width: number; height: number }> {
    const startX = sourceNode.position.x + sourceNode.width + 80;
    let y = sourceNode.position.y;
    const layouts = [];

    for (const result of results) {
        const width = result.type === "video" ? 420 : 340;
        const height = result.type === "video"
            ? 236
            : result.type === "text"
                ? 240
                : computeImageHeight(result.width, result.height, 340);
        layouts.push({ position: { x: startX, y }, width, height });
        y += height + 40;
    }

    return layouts;
}
```

---

## 4. 关键文件清单

### 新建文件

| 文件路径 | 说明 |
|---------|------|
| `web/src/lib/runninghub.ts` | 类型定义、常量、工具函数 |
| `web/src/services/api/runninghub.ts` | RunningHub API 调用（创建/轮询/上传/执行） |
| `web/src/app/(user)/canvas/components/canvas-runninghub-node.tsx` | 节点内容渲染组件 |
| `web/src/app/(user)/canvas/components/canvas-runninghub-panel.tsx` | 节点操作面板 |
| `web/src/components/layout/runninghub-workflow-editor.tsx` | 全局设置中的工作流编辑器 |

### 修改文件

| 文件路径 | 改动 |
|---------|------|
| `web/src/app/(user)/canvas/types.ts` | CanvasNodeType 新增 RunningHub + metadata 扩展 |
| `web/src/app/(user)/canvas/constants.ts` | NODE_DEFAULT_SIZE + NODE_SPECS 新增条目 |
| `web/src/stores/use-config-store.ts` | AiConfig 新增 runninghubApiKey + runninghubWorkflows |
| `web/src/app/(user)/canvas/components/canvas-node.tsx` | nodeContentRenderers 注册 + ConnectionHandleDot 配置 |
| `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx` | 添加节点入口 + 执行/恢复逻辑 + 工具栏 |
| `web/src/components/layout/app-config-modal.tsx` | 新增 RunningHub Tab |
| `canvas-agent/src/types.ts` | CanvasNodeType 增加 "runninghub" |
| `canvas-agent/src/schemas.ts` | nodeTypeSchema 增加 "runninghub" |

### 可复用（无需修改）

| 模块 | 用途 |
|------|------|
| `web/src/services/image-storage.ts` — `uploadImage()` | 图片结果存入 IndexedDB |
| `web/src/services/file-storage.ts` — `uploadMediaFile()` | 视频结果存入 IndexedDB |
| `web/src/services/image-storage.ts` — `imageToDataUrl()` | 参考图格式转换 |
| `@uiw/react-codemirror` + `@codemirror/lang-json` | 高级模式 JSON 编辑器 |
| Seedance 异步轮询模式 (`video.ts`) | 作为架构参考 |

---

## 5. 实现顺序

```
Phase 1 (Day 1-2): 基础模块
  ├── web/src/lib/runninghub.ts
  ├── web/src/services/api/runninghub.ts
  ├── web/src/app/(user)/canvas/types.ts (扩展)
  ├── web/src/app/(user)/canvas/constants.ts (扩展)
  └── 单元验证: 手动调用 API 确认通信

Phase 2 (Day 2-3): 全局配置
  ├── web/src/stores/use-config-store.ts (扩展)
  ├── web/src/components/layout/app-config-modal.tsx (新Tab)
  ├── web/src/components/layout/runninghub-workflow-editor.tsx
  └── 验证: 添加工作流 → 刷新 → 数据持久化

Phase 3 (Day 3-4): 节点渲染
  ├── web/src/app/(user)/canvas/components/canvas-runninghub-node.tsx
  ├── web/src/app/(user)/canvas/components/canvas-runninghub-panel.tsx
  ├── web/src/app/(user)/canvas/components/canvas-node.tsx (注册渲染器)
  └── 验证: 画布上添加节点 → 选择工作流 → UI 正确

Phase 4 (Day 4-5): 执行逻辑
  ├── web/src/app/(user)/canvas/[id]/canvas-client-page.tsx (执行+输出)
  ├── canvas-agent/src/types.ts (类型同步)
  ├── canvas-agent/src/schemas.ts (schema 同步)
  └── 验证: 端到端执行 → 结果节点出现

Phase 5 (Day 5): 完善交互
  ├── 超时恢复功能
  ├── 停止/中止功能
  ├── 右键菜单
  ├── 错误状态 UI
  └── 验证: 超时后重试查询 → 结果恢复
```

---

## 6. 验证方案

### 6.1 API 层验证
- 用真实 RunningHub API Key + 工作流 ID 调用 `createRunningHubTask`
- 确认 taskId 返回
- 轮询直到 SUCCESS，确认 results 格式正确

### 6.2 配置持久化
- 全局设置中添加工作流 → 保存
- 刷新页面 → 确认数据保留
- 修改/删除工作流 → 确认操作生效

### 6.3 节点创建与渲染
- 画布工具栏添加 RunningHub 节点
- 选择工作流 → 确认 UI 正确显示名称
- 输入提示词 → 确认保存到 metadata

### 6.4 单图执行
- 配置文生图工作流 → 输入提示词 → 执行
- 确认：loading 状态 → 轮询进度 → 图片节点自动创建 → 连线正确

### 6.5 多结果执行
- 配置工作流（返回多张图片）→ 执行
- 确认：多个 Image 节点纵向排列 → 全部正确连线

### 6.6 混合输出
- 配置工作流（返回图片+视频）→ 执行
- 确认：Image 节点 + Video 节点混合创建 → 各自类型正确

### 6.7 参考图输入
- 创建 Image 节点 → 连线到 RunningHub 节点 → 执行
- 确认：图片被上传到 RunningHub 并传入 nodeInfoList

### 6.8 超时与恢复
- 设置超时为最短（5min）→ 执行长任务
- 超时后确认：error 状态 + "重新查询"按钮出现
- 点击"重新查询" → 确认恢复轮询 → 最终获取结果

### 6.9 中止功能
- 执行中点击"停止"
- 确认：节点恢复就绪状态，无残留

### 6.10 错误处理
- 无 API Key → 提示"请先在设置中配置 RunningHub API Key"
- 无工作流 → 提示"请先选择工作流"
- 工作流 ID 错误 → 显示 RunningHub 返回的 errorMessage
- 网络中断 → 友好错误提示
