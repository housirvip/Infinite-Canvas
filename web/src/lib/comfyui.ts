import { nanoid } from "nanoid";

// ========== 参数角色 ==========

export type ComfyUIParamRole = "prompt" | "image" | "video" | "audio" | "number" | "string" | "boolean" | "fixed" | "ignore";

export type ComfyUIParam = {
    nodeId: string;
    fieldName: string;
    role: ComfyUIParamRole;
    label: string;
    defaultValue?: string;
    description?: string;
    enumOptions?: string[];
    order: number;
};

export function comfyuiParamKey(p: Pick<ComfyUIParam, "nodeId" | "fieldName">): string {
    return `${p.nodeId}:${p.fieldName}`;
}

// ========== 预设 ==========

export type ComfyUIPreset = {
    id: string;
    name: string;
    workflowJson: string;
    outputType: "image" | "video" | "audio" | "auto";
    params: ComfyUIParam[];
};

export const COMFYUI_TIMEOUT_OPTIONS = [
    { value: 300, label: "5 分钟" },
    { value: 600, label: "10 分钟" },
    { value: 900, label: "15 分钟" },
    { value: 1200, label: "20 分钟" },
    { value: 1800, label: "30 分钟" },
];

export const COMFYUI_PARAM_ROLE_OPTIONS: Array<{ label: string; value: ComfyUIParamRole }> = [
    { label: "提示词", value: "prompt" },
    { label: "图片输入", value: "image" },
    { label: "视频输入", value: "video" },
    { label: "音频输入", value: "audio" },
    { label: "数字", value: "number" },
    { label: "字符串", value: "string" },
    { label: "布尔开关", value: "boolean" },
    { label: "固定参数", value: "fixed" },
    { label: "忽略", value: "ignore" },
];

export function createComfyUIPreset(partial?: Partial<ComfyUIPreset>): ComfyUIPreset {
    return {
        id: partial?.id || nanoid(),
        name: partial?.name || "新预设",
        workflowJson: partial?.workflowJson || "",
        outputType: partial?.outputType || "auto",
        params: partial?.params || [],
    };
}

// ========== 格式检测 ==========

type WebUINode = {
    id: number;
    type: string;
    title?: string;
    inputs?: Array<{ name: string; type: string; link: number | null }>;
    outputs?: Array<{ name: string; type: string; links: number[] | null; slot_index?: number }>;
    widgets_values?: unknown[];
};

type WebUIWorkflow = {
    nodes: WebUINode[];
    links: Array<[number, number, number, number, number, string]>;
    last_node_id?: number;
};

type APIWorkflow = Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;

export type ComfyUIWorkflowFormat = "api" | "webui";

export function detectWorkflowFormat(jsonStr: string): ComfyUIWorkflowFormat {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed.nodes) && Array.isArray(parsed.links)) return "webui";
    return "api";
}

// ========== 工作流解析 ==========

export type ParsedComfyUINode = {
    nodeId: string;
    fieldName: string;
    fieldValue: string;
    classType: string;
    valueType: "string" | "number" | "boolean";
};

export function parseComfyUIWorkflow(jsonStr: string): ParsedComfyUINode[] {
    const format = detectWorkflowFormat(jsonStr);
    return format === "webui" ? parseWebUIFormat(jsonStr) : parseAPIFormat(jsonStr);
}

function parseAPIFormat(jsonStr: string): ParsedComfyUINode[] {
    const workflow = JSON.parse(jsonStr) as APIWorkflow;
    const result: ParsedComfyUINode[] = [];
    for (const [nodeId, nodeData] of Object.entries(workflow)) {
        const classType = nodeData.class_type || "Unknown";
        const inputs = nodeData.inputs || {};
        for (const [fieldName, value] of Object.entries(inputs)) {
            if (Array.isArray(value)) continue;
            if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
                result.push({ nodeId, fieldName, fieldValue: String(value), classType, valueType: typeof value as "string" | "number" | "boolean" });
            }
        }
    }
    return result;
}

function parseWebUIFormat(jsonStr: string): ParsedComfyUINode[] {
    const workflow = JSON.parse(jsonStr) as WebUIWorkflow;
    const result: ParsedComfyUINode[] = [];

    for (const node of workflow.nodes) {
        if (!node.widgets_values?.length) continue;
        const classType = node.type;
        const nodeId = String(node.id);

        for (let i = 0; i < node.widgets_values.length; i++) {
            const value = node.widgets_values[i];
            if (value === null || value === undefined) continue;
            if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
                result.push({
                    nodeId,
                    fieldName: `widget_${i}`,
                    fieldValue: String(value),
                    classType,
                    valueType: typeof value as "string" | "number" | "boolean",
                });
            }
        }
    }
    return result;
}

// ========== Web UI → API 格式转换 ==========

export function convertWebUIToAPI(jsonStr: string): string {
    const workflow = JSON.parse(jsonStr) as WebUIWorkflow;
    const api: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {};

    const linkMap = new Map<number, { sourceNodeId: number; sourceSlot: number }>();
    for (const link of workflow.links) {
        const [linkId, sourceNodeId, sourceSlot] = link;
        linkMap.set(linkId, { sourceNodeId, sourceSlot });
    }

    for (const node of workflow.nodes) {
        const inputs: Record<string, unknown> = {};

        if (node.inputs) {
            for (const inp of node.inputs) {
                if (inp.link != null) {
                    const src = linkMap.get(inp.link);
                    if (src) {
                        inputs[inp.name] = [String(src.sourceNodeId), src.sourceSlot];
                    }
                }
            }
        }

        if (node.widgets_values?.length) {
            for (let i = 0; i < node.widgets_values.length; i++) {
                const value = node.widgets_values[i];
                if (value === null || value === undefined) continue;
                inputs[`widget_${i}`] = value;
            }
        }

        api[String(node.id)] = { class_type: node.type, inputs };
    }

    return JSON.stringify(api);
}

// ========== 角色推断 ==========

export function suggestComfyUIParamRole(node: ParsedComfyUINode): ComfyUIParamRole {
    const classLower = node.classType.toLowerCase();
    const fieldLower = node.fieldName.toLowerCase();

    if ((classLower.includes("cliptextencode") || classLower.includes("textencoder")) && (fieldLower.includes("widget_0") || fieldLower === "text")) return "prompt";
    if (fieldLower === "prompt" || fieldLower === "text_positive" || fieldLower === "text_negative" || fieldLower === "text_g" || fieldLower === "text_l") return "prompt";

    if (node.valueType === "boolean") return "boolean";
    if (node.valueType === "number") return "number";
    if (node.valueType === "string") return "string";
    return "fixed";
}

export function suggestComfyUIParamLabel(node: ParsedComfyUINode, role: ComfyUIParamRole): string {
    const nodeName = node.classType;
    if (role === "prompt") return `${nodeName} - 提示词`;
    if (node.fieldName.startsWith("widget_")) return `${nodeName} - 值${node.fieldName.slice(7)}`;
    return `${nodeName} - ${node.fieldName}`;
}

// ========== 参数注入 ==========

export function buildComfyUIWorkflowWithParams(
    workflowJsonStr: string,
    params: ComfyUIParam[],
    paramValues: Record<string, string>,
): string {
    const format = detectWorkflowFormat(workflowJsonStr);
    if (format === "webui") {
        return buildWebUIWithParams(workflowJsonStr, params, paramValues);
    }
    return buildAPIWithParams(workflowJsonStr, params, paramValues);
}

function buildAPIWithParams(workflowJsonStr: string, params: ComfyUIParam[], paramValues: Record<string, string>): string {
    const workflow = JSON.parse(workflowJsonStr) as APIWorkflow;
    for (const param of params) {
        if (param.role === "ignore") continue;
        const key = comfyuiParamKey(param);
        const value = paramValues[key] ?? param.defaultValue;
        if (value === undefined || value === "") continue;
        const node = workflow[param.nodeId];
        if (!node?.inputs) continue;
        const original = node.inputs[param.fieldName];
        if (typeof original === "number") {
            node.inputs[param.fieldName] = Number(value);
        } else if (typeof original === "boolean") {
            node.inputs[param.fieldName] = value === "true";
        } else {
            node.inputs[param.fieldName] = value;
        }
    }
    return JSON.stringify(workflow);
}

function buildWebUIWithParams(workflowJsonStr: string, params: ComfyUIParam[], paramValues: Record<string, string>): string {
    const workflow = JSON.parse(workflowJsonStr) as WebUIWorkflow;
    for (const param of params) {
        if (param.role === "ignore") continue;
        const key = comfyuiParamKey(param);
        const value = paramValues[key] ?? param.defaultValue;
        if (value === undefined || value === "") continue;

        if (!param.fieldName.startsWith("widget_")) continue;
        const widgetIndex = parseInt(param.fieldName.slice(7), 10);
        if (isNaN(widgetIndex)) continue;

        const node = workflow.nodes.find((n) => String(n.id) === param.nodeId);
        if (!node?.widgets_values || widgetIndex >= node.widgets_values.length) continue;

        const original = node.widgets_values[widgetIndex];
        if (typeof original === "number") {
            node.widgets_values[widgetIndex] = Number(value);
        } else if (typeof original === "boolean") {
            node.widgets_values[widgetIndex] = value === "true";
        } else {
            node.widgets_values[widgetIndex] = value;
        }
    }
    return JSON.stringify(workflow);
}

// ========== 执行前格式准备 ==========

export function prepareWorkflowForExecution(workflowJsonStr: string): string {
    const format = detectWorkflowFormat(workflowJsonStr);
    if (format === "webui") {
        return convertWebUIToAPI(workflowJsonStr);
    }
    return workflowJsonStr;
}
