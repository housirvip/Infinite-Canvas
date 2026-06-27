import { nanoid } from "nanoid";

// ========== 参数角色 ==========

export type RunningHubParamRole = "prompt" | "image" | "video" | "audio" | "boolean" | "number" | "string" | "fixed" | "ignore";

export type RunningHubParam = {
    nodeId: string;
    fieldName: string;
    role: RunningHubParamRole;
    label: string;
    defaultValue?: string;
    description?: string;
    enumOptions?: string[];
    order: number;
};

export type RunningHubParamValues = {
    texts: Record<string, string>;
    images: Record<string, string>;
    videos: Record<string, string>;
    audios: Record<string, string>;
    booleans: Record<string, string>;
};

export function paramKey(p: Pick<RunningHubParam, "nodeId" | "fieldName">): string {
    return `${p.nodeId}:${p.fieldName}`;
}

// ========== 工作流 ==========

export type RunningHubWorkflow = {
    id: string;
    name: string;
    workflowId: string;
    outputType: "image" | "video" | "audio" | "auto";
    instanceType: "default" | "plus";
    params: RunningHubParam[];
};

// ========== API 类型 ==========

export type RunningHubNodeInfo = {
    nodeId: string;
    fieldName: string;
    fieldValue: string;
    fieldData?: string;
    description?: string;
};

export type RunningHubTaskResult = {
    url: string;
    nodeId: string;
    outputType: string;
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
export const RUNNINGHUB_DEFAULT_TIMEOUT_S = 600;

export const RUNNINGHUB_TIMEOUT_OPTIONS = [
    { value: 300, label: "5 分钟" },
    { value: 600, label: "10 分钟" },
    { value: 900, label: "15 分钟" },
    { value: 1200, label: "20 分钟" },
    { value: 1800, label: "30 分钟" },
];

export const PARAM_ROLE_OPTIONS: Array<{ label: string; value: RunningHubParamRole }> = [
    { label: "提示词", value: "prompt" },
    { label: "图片输入", value: "image" },
    { label: "视频输入", value: "video" },
    { label: "音频输入", value: "audio" },
    { label: "布尔开关", value: "boolean" },
    { label: "数字", value: "number" },
    { label: "字符串", value: "string" },
    { label: "固定参数", value: "fixed" },
    { label: "忽略", value: "ignore" },
];

const IMAGE_OUTPUT_TYPES = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);
const VIDEO_OUTPUT_TYPES = new Set(["mp4", "mov", "avi", "webm"]);

// ========== 工厂函数 ==========

export function createRunningHubWorkflow(partial?: Partial<RunningHubWorkflow>): RunningHubWorkflow {
    return {
        id: partial?.id || nanoid(),
        name: partial?.name || "新工作流",
        workflowId: partial?.workflowId || "",
        outputType: partial?.outputType || "auto",
        instanceType: partial?.instanceType || "default",
        params: partial?.params || [],
    };
}

// ========== 输出类型判断 ==========

export function isImageOutput(outputType: string): boolean {
    return IMAGE_OUTPUT_TYPES.has(outputType.toLowerCase());
}

export function isVideoOutput(outputType: string): boolean {
    return VIDEO_OUTPUT_TYPES.has(outputType.toLowerCase());
}

export function isTextOutput(outputType: string): boolean {
    return outputType.toLowerCase() === "txt";
}

// ========== 参数组装 ==========

export function buildNodeInfoList(workflow: RunningHubWorkflow, values: RunningHubParamValues): RunningHubNodeInfo[] {
    const list: RunningHubNodeInfo[] = [];
    for (const param of workflow.params || []) {
        if (param.role === "ignore") continue;
        const key = paramKey(param);
        if (param.role === "prompt") {
            const text = values.texts[key];
            if (text) list.push({ nodeId: param.nodeId, fieldName: param.fieldName, fieldValue: text });
        } else if (param.role === "image") {
            const url = values.images[key];
            if (url) list.push({ nodeId: param.nodeId, fieldName: param.fieldName, fieldValue: url });
        } else if (param.role === "video") {
            const url = values.videos[key];
            if (url) list.push({ nodeId: param.nodeId, fieldName: param.fieldName, fieldValue: url });
        } else if (param.role === "audio") {
            const url = values.audios[key];
            if (url) list.push({ nodeId: param.nodeId, fieldName: param.fieldName, fieldValue: url });
        } else if (param.role === "boolean") {
            list.push({ nodeId: param.nodeId, fieldName: param.fieldName, fieldValue: values.booleans[key] ?? param.defaultValue ?? "false" });
        } else if (param.role === "number" || param.role === "string") {
            const val = values.texts[key] ?? param.defaultValue ?? "";
            if (val) list.push({ nodeId: param.nodeId, fieldName: param.fieldName, fieldValue: val });
        } else if (param.role === "fixed" && param.defaultValue) {
            list.push({ nodeId: param.nodeId, fieldName: param.fieldName, fieldValue: param.defaultValue });
        }
    }
    return list;
}

// ========== curl 命令解析 ==========

export type ParsedCurlNode = {
    nodeId: string;
    fieldName: string;
    fieldValue: string;
    fieldData?: string;
    description?: string;
    enumOptions?: string[];
};

export type ParsedCurlResult = {
    workflowId: string;
    instanceType: "default" | "plus";
    rawNodes: ParsedCurlNode[];
};

export function parseRunningHubEnumOptions(fieldData?: string): string[] {
    if (!fieldData) return [];

    try {
        const parsed = JSON.parse(fieldData);
        if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) return [];

        return parsed[0].filter((option): option is string => typeof option === "string" && option.length > 0);
    } catch {
        return [];
    }
}

export function parseCurlCommand(curl: string): ParsedCurlResult | null {
    const workflowIdMatch = curl.match(/\/run\/ai-app\/(\d+)/);
    if (!workflowIdMatch) return null;

    const workflowId = workflowIdMatch[1];
    let body: { nodeInfoList?: RunningHubNodeInfo[]; instanceType?: string } = {};

    const dataMatch = curl.match(/--data(?:-raw)?\s+'([\s\S]*?)'\s*$/m) || curl.match(/--data(?:-raw)?\s+"([\s\S]*?)"\s*$/m);
    if (dataMatch) {
        try {
            body = JSON.parse(dataMatch[1]);
        } catch {
            const joined = curl.replace(/\\\n/g, " ");
            const fallback = joined.match(/--data(?:-raw)?\s+'([\s\S]*?)'/m) || joined.match(/--data(?:-raw)?\s+"([\s\S]*?)"/m);
            if (fallback) {
                try { body = JSON.parse(fallback[1]); } catch { /* ignore */ }
            }
        }
    }

    if (!body.nodeInfoList && curl.includes('"nodeInfoList"')) {
        const jsonMatch = curl.match(/\{[\s\S]*"nodeInfoList"[\s\S]*\}/);
        if (jsonMatch) {
            try { body = JSON.parse(jsonMatch[0]); } catch { /* ignore */ }
        }
    }

    const rawNodes: ParsedCurlNode[] = (body.nodeInfoList || []).map((n) => ({
        nodeId: n.nodeId,
        fieldName: n.fieldName,
        fieldValue: n.fieldValue || "",
        fieldData: n.fieldData,
        description: n.description,
        enumOptions: parseRunningHubEnumOptions(n.fieldData),
    }));
    const instanceType = body.instanceType === "plus" ? ("plus" as const) : ("default" as const);

    return { workflowId, instanceType, rawNodes };
}

export function suggestParamRole(node: ParsedCurlNode): RunningHubParamRole {
    const field = node.fieldName?.toLowerCase() || "";
    const desc = (node.description || "").toLowerCase();
    if (field === "text" || field === "prompt" || desc.includes("提示词") || desc.includes("prompt")) return "prompt";
    if (field === "image" || desc.includes("图像") || desc.includes("图片") || desc.includes("upload") || desc.includes("上传")) return "image";
    if (field === "video" || desc.includes("视频") || desc.includes("video")) return "video";
    if (node.enumOptions?.length) return "string";
    if (node.fieldValue === "true" || node.fieldValue === "false") return "boolean";
    if (node.fieldValue && !isNaN(Number(node.fieldValue))) return "number";
    return "fixed";
}

export function suggestParamLabel(node: ParsedCurlNode, role: RunningHubParamRole): string {
    if (node.description) {
        const clean = node.description.replace(/[💗❤️🔥⭐✨➻→]/g, "").trim();
        if (clean) return clean;
    }
    if (role === "prompt") return "提示词";
    if (role === "image") return "图片输入";
    if (role === "video") return "视频输入";
    if (role === "boolean") return node.fieldName || "开关";
    if (role === "number") return node.fieldName || "数值";
    if (role === "string") return node.fieldName || "文本";
    return node.fieldName || "参数";
}
