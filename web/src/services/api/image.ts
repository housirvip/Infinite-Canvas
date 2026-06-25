import { resolveModelRequestConfig, useConfigStore, type AiConfig } from "@/stores/use-config-store";
import { getAccessToken } from "@/services/backend-client";
import { nanoid } from "nanoid";

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

export type ResponseToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    thoughtSignature?: string;
};

export type ResponseInputMessage =
    | AiTextMessage
    | { type: "function_call"; call_id: string; name: string; arguments: string; thoughtSignature?: string }
    | { role: "tool"; tool_call_id: string; content: string };

export type ResponseFunctionTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
    };
};

export type ToolResponseResult = {
    content: string;
    toolCalls: ResponseToolCall[];
};

type ToolChoice = "auto" | "required" | { type: "function"; name: string };
type ResponseMessageContent = AiTextMessage["content"] | string;
type ResponseInputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
type ResponseInputItem =
    | { role: "system" | "user" | "assistant"; content: string | ResponseInputContent[] }
    | { type: "function_call"; call_id: string; name: string; arguments: string }
    | { type: "function_call_output"; call_id: string; output: string };
type ResponseApiToolDefinition = {
    type: "function";
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
};
type ResponseApiOutputItem =
    | { type?: "message"; content?: Array<{ type?: string; text?: string }> }
    | { type?: "function_call"; id?: string; call_id?: string; name?: string; arguments?: string };
type ResponseApiPayload = {
    id?: string;
    output?: ResponseApiOutputItem[];
    output_text?: string;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ResponseStreamState = { buffer: string; text: string; payload?: ResponseApiPayload; error?: string };

type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    inline_data?: { mime_type?: string; mimeType?: string; data?: string };
    fileData?: { mimeType?: string; fileUri?: string };
    functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
    functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
    thoughtSignature?: string;
    thought_signature?: string;
};
type GeminiContent = { role?: "user" | "model"; parts: GeminiPart[] };
type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
};
type GeminiStreamState = { buffer: string; text: string; toolCalls: ResponseToolCall[]; error?: string };
type RequestOptions = { signal?: AbortSignal };

function readStatusError(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}：${status}` : fallback;
}

function readError(error: unknown, fallback: string) {
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? error.message : fallback;
}

function withSystemMessage<T extends ResponseInputMessage>(config: AiConfig, messages: T[]): ResponseInputMessage[] {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

function toResponseInput(messages: ResponseInputMessage[]): ResponseInputItem[] {
    return messages.flatMap((message): ResponseInputItem[] => {
        if ("type" in message) return [message];
        if (message.role === "tool") return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }];
        return [{ role: message.role, content: toResponseContent(message.content || "") }];
    });
}

function toResponseContent(content: ResponseMessageContent): string | ResponseInputContent[] {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? { type: "input_text" as const, text: item.text } : { type: "input_image" as const, image_url: item.image_url.url }));
}

function toResponseTool(tool: ResponseFunctionTool): ResponseApiToolDefinition {
    return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: tool.function.strict,
    };
}

function parseToolResponse(payload: ResponseApiPayload): ToolResponseResult {
    const output = payload.output || [];
    const content =
        payload.output_text ||
        output
            .flatMap((item) => (item.type === "message" ? item.content || [] : []))
            .map((item) => item.text || "")
            .join("");
    const toolCalls = output
        .filter((item): item is Extract<ResponseApiOutputItem, { type?: "function_call" }> => item.type === "function_call")
        .map((item) => ({
            id: item.call_id || item.id || "",
            type: "function" as const,
            function: { name: item.name || "", arguments: item.arguments || "{}" },
        }))
        .filter((item) => item.id && item.function.name);
    return { content, toolCalls };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function responseErrorMessage(value: unknown) {
    if (!isRecord(value)) return "";
    const error = isRecord(value.error) ? value.error : undefined;
    const response = isRecord(value.response) ? value.response : undefined;
    const responseError = response && isRecord(response.error) ? response.error : undefined;
    return stringValue(value.msg) || stringValue(error?.message) || stringValue(responseError?.message);
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

function validateResponsePayload(payload: ResponseApiPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "请求失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function validateGeminiPayload(payload: GeminiPayload) {
    if (payload.error?.message) throw new Error(payload.error.message);
    if (payload.promptFeedback?.blockReason) throw new Error(`Gemini 拒绝了本次请求：${payload.promptFeedback.blockReason}`);
}

async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return readStatusError(response.status, fallback);
    try {
        return responseErrorMessage(JSON.parse(text)) || readStatusError(response.status, fallback);
    } catch {
        return text.slice(0, 300) || readStatusError(response.status, fallback);
    }
}

function consumeResponseStreamBlock(block: string, state: ResponseStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as Record<string, unknown>;
    const type = stringValue(event.type);
    const errorMessage = responseErrorMessage(event);
    if (errorMessage) state.error = errorMessage;
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
        state.text += event.delta;
        onDelta?.(state.text);
    }
    if (type === "response.output_text.done" && !state.text && typeof event.text === "string") {
        state.text = event.text;
        onDelta?.(state.text);
    }
    if (type === "response.completed" && isRecord(event.response)) {
        state.payload = event.response as ResponseApiPayload;
    } else if (Array.isArray(event.output)) {
        state.payload = event as ResponseApiPayload;
    }
}

function consumeResponseStreamText(state: ResponseStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const matchIndex = match.index ?? 0;
        consumeResponseStreamBlock(state.buffer.slice(0, matchIndex), state, onDelta);
        state.buffer = state.buffer.slice(matchIndex + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeResponseStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

function chatStreamUrl(config: AiConfig & { _channelLocalId?: string }) {
    const params = new URLSearchParams({ apiFormat: config.apiFormat, model: config.model });
    if (config._channelLocalId) {
        const serverId = useConfigStore.getState().getServerChannelId(config._channelLocalId);
        if (serverId) params.set("channelId", String(serverId));
    }
    return `/api/v1/chat/stream?${params}`;
}

function chatStreamHeaders() {
    return { "Content-Type": "application/json", Accept: "text/event-stream", Authorization: `Bearer ${getAccessToken()}` };
}

async function requestStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const url = chatStreamUrl(config);
    const response = await fetch(url, {
        method: "POST",
        headers: chatStreamHeaders(),
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as ResponseApiPayload;
        validateResponsePayload(payload);
        return parseToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ResponseStreamState = { buffer: "", text: "" };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeResponseStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeResponseStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    if (!state.payload) return { content: state.text, toolCalls: [] };
    validateResponsePayload(state.payload);
    const result = parseToolResponse(state.payload);
    return { ...result, content: state.text || result.content };
}

function toGeminiBody(config: AiConfig, messages: ResponseInputMessage[], extra?: Record<string, unknown>) {
    const systemText = [
        config.systemPrompt.trim(),
        ...messages.flatMap((message) => (!("type" in message) && message.role === "system" ? [geminiTextContent(message.content)] : [])),
    ]
        .filter(Boolean)
        .join("\n\n");
    const contents = toGeminiContents(messages.filter((message) => ("type" in message ? true : message.role !== "system")));
    return {
        contents,
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        ...extra,
    };
}

function toGeminiContents(messages: ResponseInputMessage[]): GeminiContent[] {
    const callNameById = new Map<string, string>();
    return messages.flatMap((message): GeminiContent[] => {
        if ("type" in message) {
            callNameById.set(message.call_id, message.name);
            return [{ role: "model", parts: [{ functionCall: { id: message.call_id, name: message.name, args: jsonObject(message.arguments) }, ...(message.thoughtSignature ? { thoughtSignature: message.thoughtSignature } : {}) }] }];
        }
        if (message.role === "tool") {
            const name = callNameById.get(message.tool_call_id) || "tool_result";
            return [{ role: "user", parts: [{ functionResponse: { id: message.tool_call_id, name, response: { result: jsonValue(message.content) } } }] }];
        }
        return [{ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) }];
    });
}

function toGeminiParts(content: ResponseMessageContent): GeminiPart[] {
    if (!Array.isArray(content)) return [{ text: String(content || "") }];
    return content.map((item) => (item.type === "text" ? { text: item.text } : toGeminiImagePart(item.image_url.url)));
}

function toGeminiImagePart(url: string): GeminiPart {
    const match = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url, mimeType: "image/png" } };
}

function geminiTextContent(content: ResponseMessageContent) {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? item.text : item.image_url.url)).join("\n");
}

function jsonObject(value: string): Record<string, unknown> {
    const parsed = jsonValue(value);
    return isRecord(parsed) ? parsed : {};
}

function jsonValue(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function toGeminiToolOptions(tools: ResponseFunctionTool[], toolChoice: ToolChoice) {
    if (!tools.length) return {};
    const functionDeclarations = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
    }));
    const functionCallingConfig =
        typeof toolChoice === "object"
            ? { mode: "ANY", allowedFunctionNames: [toolChoice.name] }
            : { mode: toolChoice === "required" ? "ANY" : "AUTO" };
    return {
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig },
    };
}

async function requestGeminiStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const url = chatStreamUrl({ ...config, apiFormat: "gemini" });
    const response = await fetch(url, {
        method: "POST",
        headers: chatStreamHeaders(),
        body: JSON.stringify(body),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as GeminiPayload;
        return parseGeminiToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: GeminiStreamState = { buffer: "", text: "", toolCalls: [] };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeGeminiStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeGeminiStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    return { content: state.text, toolCalls: state.toolCalls };
}

function consumeGeminiStreamText(state: GeminiStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const matchIndex = match.index ?? 0;
        consumeGeminiStreamBlock(state.buffer.slice(0, matchIndex), state, onDelta);
        state.buffer = state.buffer.slice(matchIndex + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeGeminiStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

function consumeGeminiStreamBlock(block: string, state: GeminiStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const result = parseGeminiToolResponse(JSON.parse(data) as GeminiPayload);
    if (result.content) {
        state.text += result.content;
        onDelta?.(state.text);
    }
    state.toolCalls.push(...result.toolCalls);
}

function parseGeminiToolResponse(payload: GeminiPayload): ToolResponseResult {
    validateGeminiPayload(payload);
    const parts = payload.candidates?.flatMap((candidate) => candidate.content?.parts || []) || [];
    const content = parts.map((part) => part.text || "").join("");
    const toolCalls = parts
        .map((part) => part.functionCall)
        .filter((call): call is NonNullable<GeminiPart["functionCall"]> => Boolean(call?.name))
        .map((call) => {
            const part = parts.find((item) => item.functionCall === call);
            const thoughtSignature = part?.thoughtSignature || part?.thought_signature;
            return {
                id: call.id || nanoid(),
                type: "function" as const,
                function: { name: call.name || "", arguments: JSON.stringify(call.args || {}) },
                ...(thoughtSignature ? { thoughtSignature } : {}),
            };
        });
    return { content, toolCalls };
}

// --- Chat Completions API (openai-completion) ---

type CompletionChoice = {
    delta?: { role?: string; content?: string; tool_calls?: Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }> };
    finish_reason?: string | null;
};
type CompletionChunk = { choices?: CompletionChoice[]; error?: { message?: string }; code?: number; msg?: string };
type CompletionStreamState = { buffer: string; text: string; toolCallMap: Map<number, { id: string; name: string; args: string }>; error?: string };

function toCompletionMessages(messages: ResponseInputMessage[]): Array<Record<string, unknown>> {
    return messages.flatMap((message): Array<Record<string, unknown>> => {
        if ("type" in message) {
            if (message.type === "function_call") {
                return [{ role: "assistant", tool_calls: [{ id: message.call_id, type: "function", function: { name: message.name, arguments: message.arguments } }] }];
            }
            return [];
        }
        if (message.role === "tool") {
            return [{ role: "tool", tool_call_id: message.tool_call_id, content: message.content }];
        }
        return [{ role: message.role, content: message.content }];
    });
}

function toCompletionToolChoice(toolChoice: ToolChoice) {
    if (typeof toolChoice === "object") return { type: "function", function: { name: toolChoice.name } };
    return toolChoice;
}

function consumeCompletionStreamBlock(block: string, state: CompletionStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const chunk = JSON.parse(data) as CompletionChunk;
    if (chunk.error?.message) { state.error = chunk.error.message; return; }
    if (typeof chunk.code === "number" && chunk.code !== 0) { state.error = chunk.msg || "请求失败"; return; }
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === "string") {
        state.text += delta.content;
        onDelta?.(state.text);
    }
    if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = state.toolCallMap.get(idx);
            if (!existing) {
                state.toolCallMap.set(idx, { id: tc.id || "", name: tc.function?.name || "", args: tc.function?.arguments || "" });
            } else {
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name += tc.function.name;
                if (tc.function?.arguments) existing.args += tc.function.arguments;
            }
        }
    }
}

function consumeCompletionStreamText(state: CompletionStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const matchIndex = match.index ?? 0;
        consumeCompletionStreamBlock(state.buffer.slice(0, matchIndex), state, onDelta);
        state.buffer = state.buffer.slice(matchIndex + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeCompletionStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

async function requestCompletionStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const url = chatStreamUrl(config);
    const response = await fetch(url, {
        method: "POST",
        headers: chatStreamHeaders(),
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = await response.json();
        const content = payload.choices?.[0]?.message?.content || "";
        const toolCalls = (payload.choices?.[0]?.message?.tool_calls || []).map((tc: any) => ({
            id: tc.id || "", type: "function" as const, function: { name: tc.function?.name || "", arguments: tc.function?.arguments || "{}" },
        }));
        return { content, toolCalls };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: CompletionStreamState = { buffer: "", text: "", toolCallMap: new Map() };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeCompletionStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeCompletionStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    const toolCalls: ResponseToolCall[] = Array.from(state.toolCallMap.values())
        .filter((tc) => tc.id && tc.name)
        .map((tc) => ({ id: tc.id, type: "function" as const, function: { name: tc.name, arguments: tc.args || "{}" } }));
    return { content: state.text, toolCalls };
}

// --- Anthropic Messages API (anthropic) ---

type AnthropicStreamState = { buffer: string; text: string; toolUseBlocks: Map<number, { id: string; name: string; input: string }>; error?: string };

function toAnthropicBody(config: AiConfig, messages: ResponseInputMessage[], extra?: Record<string, unknown>) {
    const systemParts: string[] = [];
    if (config.systemPrompt.trim()) systemParts.push(config.systemPrompt.trim());

    const rawMessages: Array<{ role: string; content: unknown }> = [];
    for (const message of messages) {
        if ("type" in message) {
            if (message.type === "function_call") {
                rawMessages.push({ role: "assistant", content: [{ type: "tool_use", id: message.call_id, name: message.name, input: jsonObject(message.arguments) }] });
            }
            continue;
        }
        if (message.role === "system") {
            const text = typeof message.content === "string" ? message.content : message.content.map((c) => (c.type === "text" ? c.text : "")).join("");
            if (text) systemParts.push(text);
            continue;
        }
        if (message.role === "tool") {
            rawMessages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: message.tool_call_id, content: message.content }] });
            continue;
        }
        rawMessages.push({ role: message.role, content: toAnthropicContent(message.content) });
    }

    const merged: Array<{ role: string; content: unknown }> = [];
    for (const msg of rawMessages) {
        const last = merged[merged.length - 1];
        if (last && last.role === msg.role) {
            const prev = Array.isArray(last.content) ? last.content : typeof last.content === "string" && last.content ? [{ type: "text", text: last.content }] : [];
            const next = Array.isArray(msg.content) ? msg.content : typeof msg.content === "string" && msg.content ? [{ type: "text", text: msg.content }] : [];
            last.content = [...prev, ...next];
        } else {
            merged.push({ ...msg });
        }
    }

    const system = systemParts.join("\n\n");
    return { ...(system ? { system } : {}), messages: merged, ...extra };
}

function toAnthropicContent(content: ResponseMessageContent): string | Array<Record<string, unknown>> {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => {
        if (item.type === "text") return { type: "text", text: item.text };
        const match = item.image_url.url.match(/^data:([^;,]+);base64,(.+)$/);
        if (match) return { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } };
        return { type: "image", source: { type: "url", url: item.image_url.url } };
    });
}

function toAnthropicTools(tools: ResponseFunctionTool[]) {
    return tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters }));
}

function toAnthropicToolChoice(toolChoice: ToolChoice) {
    if (typeof toolChoice === "object") return { type: "tool", name: toolChoice.name };
    if (toolChoice === "required") return { type: "any" };
    return { type: "auto" };
}

function consumeAnthropicStreamBlock(block: string, state: AnthropicStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as Record<string, unknown>;
    const type = stringValue(event.type);

    if (type === "error") {
        const error = isRecord(event.error) ? event.error : undefined;
        state.error = stringValue(error?.message) || "请求失败";
        return;
    }
    if (type === "content_block_start") {
        const index = typeof event.index === "number" ? event.index : 0;
        const cb = isRecord(event.content_block) ? event.content_block : undefined;
        if (stringValue(cb?.type) === "tool_use") {
            state.toolUseBlocks.set(index, { id: stringValue(cb?.id), name: stringValue(cb?.name), input: "" });
        }
        return;
    }
    if (type === "content_block_delta") {
        const index = typeof event.index === "number" ? event.index : 0;
        const delta = isRecord(event.delta) ? event.delta : undefined;
        const deltaType = stringValue(delta?.type);
        if (deltaType === "text_delta" && typeof delta?.text === "string") {
            state.text += delta.text;
            onDelta?.(state.text);
        }
        if (deltaType === "input_json_delta" && typeof delta?.partial_json === "string") {
            const toolBlock = state.toolUseBlocks.get(index);
            if (toolBlock) toolBlock.input += delta.partial_json;
        }
        return;
    }
    if (type === "message_start") {
        const message = isRecord(event.message) ? event.message : undefined;
        const error = isRecord(message?.error) ? message.error : undefined;
        if (error) state.error = stringValue(error.message) || "请求失败";
    }
}

function consumeAnthropicStreamText(state: AnthropicStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const matchIndex = match.index ?? 0;
        consumeAnthropicStreamBlock(state.buffer.slice(0, matchIndex), state, onDelta);
        state.buffer = state.buffer.slice(matchIndex + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeAnthropicStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

async function requestAnthropicStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const url = chatStreamUrl(config);
    const response = await fetch(url, {
        method: "POST",
        headers: chatStreamHeaders(),
        body: JSON.stringify({ ...body, model: config.model, max_tokens: 8192, stream: true }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as Record<string, unknown>;
        const content = Array.isArray(payload.content)
            ? (payload.content as Array<Record<string, unknown>>).filter((b) => stringValue(b.type) === "text").map((b) => stringValue(b.text)).join("")
            : "";
        const toolCalls: ResponseToolCall[] = Array.isArray(payload.content)
            ? (payload.content as Array<Record<string, unknown>>)
                  .filter((b) => stringValue(b.type) === "tool_use")
                  .map((b) => ({ id: stringValue(b.id), type: "function" as const, function: { name: stringValue(b.name), arguments: JSON.stringify(b.input || {}) } }))
            : [];
        return { content, toolCalls };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: AnthropicStreamState = { buffer: "", text: "", toolUseBlocks: new Map() };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeAnthropicStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeAnthropicStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    const toolCalls: ResponseToolCall[] = Array.from(state.toolUseBlocks.values())
        .filter((tc) => tc.id && tc.name)
        .map((tc) => ({ id: tc.id, type: "function" as const, function: { name: tc.name, arguments: tc.input || "{}" } }));
    return { content: state.text, toolCalls };
}

export async function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    try {
        if (requestConfig.apiFormat === "gemini") {
            const answer = (await requestGeminiStreamingResponse(requestConfig, toGeminiBody(requestConfig, messages), onDelta, options)).content || "没有返回内容";
            if (answer === "没有返回内容") onDelta(answer);
            return answer;
        }
        if (requestConfig.apiFormat === "anthropic") {
            const answer = (await requestAnthropicStreamingResponse(requestConfig, toAnthropicBody(requestConfig, messages), onDelta, options)).content || "没有返回内容";
            if (answer === "没有返回内容") onDelta(answer);
            return answer;
        }
        if (requestConfig.apiFormat === "openai-completion") {
            const answer = (await requestCompletionStreamingResponse(requestConfig, {
                model: requestConfig.model,
                messages: toCompletionMessages(withSystemMessage(requestConfig, messages)),
            }, onDelta, options)).content || "没有返回内容";
            if (answer === "没有返回内容") onDelta(answer);
            return answer;
        }
        const answer = (await requestStreamingResponse(requestConfig, {
            model: requestConfig.model,
            input: toResponseInput(withSystemMessage(requestConfig, messages)),
        }, onDelta, options)).content || "没有返回内容";
        if (answer === "没有返回内容") onDelta(answer);
        return answer;
    } catch (error) {
        throw new Error(readError(error, "请求失败"));
    }
}

export async function requestToolResponse(config: AiConfig, messages: ResponseInputMessage[], tools: ResponseFunctionTool[], toolChoice: ToolChoice = "auto", onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    try {
        if (requestConfig.apiFormat === "gemini") {
            return await requestGeminiStreamingResponse(requestConfig, toGeminiBody(requestConfig, messages, toGeminiToolOptions(tools, toolChoice)), onDelta, options);
        }
        if (requestConfig.apiFormat === "anthropic") {
            return await requestAnthropicStreamingResponse(requestConfig, toAnthropicBody(requestConfig, messages, {
                tools: toAnthropicTools(tools),
                ...(tools.length ? { tool_choice: toAnthropicToolChoice(toolChoice) } : {}),
            }), onDelta, options);
        }
        if (requestConfig.apiFormat === "openai-completion") {
            return await requestCompletionStreamingResponse(requestConfig, {
                model: requestConfig.model,
                messages: toCompletionMessages(withSystemMessage(requestConfig, messages)),
                tools: tools.map(toResponseTool),
                tool_choice: toCompletionToolChoice(toolChoice),
                parallel_tool_calls: false,
            }, onDelta, options);
        }
        return await requestStreamingResponse(requestConfig, {
            model: requestConfig.model,
            input: toResponseInput(withSystemMessage(requestConfig, messages)),
            tools: tools.map(toResponseTool),
            tool_choice: toolChoice,
            parallel_tool_calls: false,
        }, onDelta, options);
    } catch (error) {
        throw new Error(readError(error, "请求失败"));
    }
}
