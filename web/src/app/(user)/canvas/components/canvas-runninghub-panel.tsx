import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputNumber } from "@/components/ui/input-number";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { message } from "@/lib/message";
import { LoaderCircle, Play, RefreshCw, Square } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { COMFYUI_TIMEOUT_OPTIONS, comfyuiParamKey } from "@/lib/comfyui";
import { RUNNINGHUB_TIMEOUT_OPTIONS, paramKey } from "@/lib/runninghub";
import { useRunningHubStore } from "@/stores/use-runninghub-store";
import { useComfyUIStore } from "@/stores/use-comfyui-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "../types";

export type UpstreamNode = { id: string; title: string; type: CanvasNodeType; content?: string };

function upstreamLabel(node: UpstreamNode, index: number): string {
    if (node.type === CanvasNodeType.Text) return `文本${index + 1}`;
    if (node.type === CanvasNodeType.Image) return `图片${index + 1}`;
    if (node.type === CanvasNodeType.Video) return `视频${index + 1}`;
    if (node.type === CanvasNodeType.Audio) return `音频${index + 1}`;
    return node.title || node.id.slice(0, 8);
}

type RunningHubPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    hasTaskId: boolean;
    upstreamNodes: UpstreamNode[];
    onParamChange: (nodeId: string, paramKey: string, value: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onExecute: (nodeId: string) => void;
    onResume: (nodeId: string) => void;
    onStop: (nodeId: string) => void;
};

export function CanvasRunningHubPanel({ node, isRunning, hasTaskId, upstreamNodes, onParamChange, onConfigChange, onExecute, onResume, onStop }: RunningHubPanelProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const appWorkflows = useRunningHubStore((state) => state.workflows);
    const hasApiKey = useRunningHubStore((state) => state.hasApiKey);
    const openRunningHubDialog = useRunningHubStore((state) => state.openDialog);
    const comfyuiPresets = useComfyUIStore((state) => state.presets);
    const openComfyUIDialog = useComfyUIStore((state) => state.openDialog);

    const rhMode = node.metadata?.rhMode || "app";
    const selectedWorkflowId = node.metadata?.rhWorkflowId || "";
    const selectedPresetId = node.metadata?.rhPresetId || "";
    const workflowSource = node.metadata?.rhWorkflowSource || "preset";
    const instanceType = node.metadata?.rhInstanceType || "default";
    const timeout = node.metadata?.rhTimeout || 600;
    const paramValues = node.metadata?.rhParamValues || {};

    const appWorkflow = appWorkflows.find((w) => w.id === selectedWorkflowId);
    const cuPreset = comfyuiPresets.find((p) => p.id === selectedPresetId);

    const upstreamTextNodes = upstreamNodes.filter((n) => n.type === CanvasNodeType.Text);
    const upstreamTextContent = upstreamTextNodes[0]?.content || "";
    const upstreamImageNodes = upstreamNodes.filter((n) => n.type === CanvasNodeType.Image);
    const upstreamVideoNodes = upstreamNodes.filter((n) => n.type === CanvasNodeType.Video);
    const upstreamAudioNodes = upstreamNodes.filter((n) => n.type === CanvasNodeType.Audio);

    // Resolve active params based on mode
    const resolveActiveParams = () => {
        if (rhMode === "app") {
            return (appWorkflow?.params || []).filter((p) => p.role !== "fixed" && p.role !== "ignore").sort((a, b) => a.order - b.order);
        }
        if (workflowSource === "preset") {
            return (cuPreset?.params || []).filter((p) => p.role !== "fixed" && p.role !== "ignore").sort((a, b) => a.order - b.order);
        }
        return [];
    };

    const activeParams = resolveActiveParams();
    const promptParams = activeParams.filter((p) => p.role === "prompt");
    const booleanParams = activeParams.filter((p) => p.role === "boolean");
    const numberParams = activeParams.filter((p) => p.role === "number");
    const stringParams = activeParams.filter((p) => p.role === "string");
    const imageParams = activeParams.filter((p) => p.role === "image");
    const videoParams = activeParams.filter((p) => p.role === "video");
    const audioParams = activeParams.filter((p) => p.role === "audio");
    const hasParams = activeParams.length > 0;

    const getParamKey = (param: { nodeId: string; fieldName: string }) => {
        if (rhMode === "comfyui") return comfyuiParamKey(param);
        return paramKey(param);
    };

    const handleExecute = () => {
        if (!hasApiKey) {
            message.warning("请先配置 RunningHub API Key");
            openRunningHubDialog();
            return;
        }
        if (rhMode === "app") {
            if (!selectedWorkflowId || !appWorkflow) {
                message.warning("请先选择 App 工作流");
                openRunningHubDialog();
                return;
            }
        } else if (workflowSource === "preset") {
            if (!selectedPresetId || !cuPreset) {
                message.warning("请先选择 ComfyUI 预设工作流");
                openComfyUIDialog();
                return;
            }
        } else {
            if (!upstreamTextContent.trim()) {
                message.warning("未检测到上游文本节点的工作流 JSON");
                return;
            }
            try {
                JSON.parse(upstreamTextContent);
            } catch {
                message.error("上游文本节点内容不是有效的 JSON");
                return;
            }
        }
        onExecute(node.id);
    };

    const sourceKey = (pKey: string) => `@source:${pKey}`;

    const timeoutOptions = rhMode === "app" ? RUNNINGHUB_TIMEOUT_OPTIONS : COMFYUI_TIMEOUT_OPTIONS;

    return (
        <div
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            data-canvas-no-zoom
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
        >
            {/* Mode toggle: App / ComfyUI */}
            <div className="mb-2 flex gap-1 rounded-lg p-0.5 text-xs" style={{ background: theme.toolbar.itemHover }}>
                <button
                    className="flex-1 rounded-md px-2 py-1 transition-colors"
                    style={rhMode === "app" ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.toolbar.item }}
                    onClick={() => onConfigChange(node.id, { rhMode: "app", rhWorkflowId: undefined, rhPresetId: undefined, rhParamValues: {} })}
                >
                    WebApp
                </button>
                <button
                    className="flex-1 rounded-md px-2 py-1 transition-colors"
                    style={rhMode === "comfyui" ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.toolbar.item }}
                    onClick={() => onConfigChange(node.id, { rhMode: "comfyui", rhWorkflowId: undefined, rhPresetId: undefined, rhParamValues: {} })}
                >
                    ComfyUI
                </button>
            </div>

            {/* ComfyUI sub-mode toggle */}
            {rhMode === "comfyui" ? (
                <div className="mb-2 flex gap-1 rounded-lg p-0.5 text-xs" style={{ background: theme.toolbar.itemHover }}>
                    <button
                        className="flex-1 rounded-md px-2 py-1 transition-colors"
                        style={workflowSource === "preset" ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.toolbar.item }}
                        onClick={() => onConfigChange(node.id, { rhWorkflowSource: "preset", rhParamValues: {} })}
                    >
                        预设工作流
                    </button>
                    <button
                        className="flex-1 rounded-md px-2 py-1 transition-colors"
                        style={workflowSource === "upstream" ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.toolbar.item }}
                        onClick={() => onConfigChange(node.id, { rhWorkflowSource: "upstream", rhParamValues: {} })}
                    >
                        上游文本输入
                    </button>
                </div>
            ) : null}

            {/* Workflow / preset selector */}
            <div className="mb-2">
                {rhMode === "app" ? (
                    <Select value={selectedWorkflowId || undefined} onValueChange={(value) => onConfigChange(node.id, { rhWorkflowId: value, rhParamValues: {} })}>
                        <SelectTrigger className="h-8 w-full text-sm"><SelectValue placeholder="选择 App 工作流" /></SelectTrigger>
                        <SelectContent>
                            {appWorkflows.length ? appWorkflows.map((w) => (
                                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                            )) : (
                                <div className="py-2 text-center text-xs text-stone-400">
                                    暂无工作流，<Button variant="link" size="sm" className="px-0 text-xs" onClick={() => openRunningHubDialog()}>去配置</Button>
                                </div>
                            )}
                        </SelectContent>
                    </Select>
                ) : workflowSource === "preset" ? (
                    <Select value={selectedPresetId || undefined} onValueChange={(value) => onConfigChange(node.id, { rhPresetId: value, rhParamValues: {} })}>
                        <SelectTrigger className="h-8 w-full text-sm"><SelectValue placeholder="选择预设工作流" /></SelectTrigger>
                        <SelectContent>
                            {comfyuiPresets.length ? comfyuiPresets.map((p) => (
                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            )) : (
                                <div className="py-2 text-center text-xs text-stone-400">
                                    暂无预设，<Button variant="link" size="sm" className="px-0 text-xs" onClick={() => openComfyUIDialog()}>去配置</Button>
                                </div>
                            )}
                        </SelectContent>
                    </Select>
                ) : (
                    upstreamTextNodes.length > 0 ? (
                        <div
                            className="thin-scrollbar max-h-24 overflow-y-auto rounded-md border px-2 py-1.5 text-xs"
                            style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.muted }}
                        >
                            {upstreamTextContent.trim() ? (
                                <pre className="whitespace-pre-wrap break-all font-mono text-[10px] leading-tight">
                                    {upstreamTextContent.length > 500 ? upstreamTextContent.slice(0, 500) + "..." : upstreamTextContent}
                                </pre>
                            ) : (
                                <span className="text-stone-400">上游文本节点内容为空</span>
                            )}
                        </div>
                    ) : (
                        <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-stone-400" style={{ borderColor: theme.node.stroke }}>
                            请连接一个文本节点，将 ComfyUI 工作流 JSON 粘贴到文本节点中
                        </div>
                    )
                )}
            </div>

            {/* Dynamic param inputs */}
            {hasParams ? (
                <div className="thin-scrollbar mb-2 max-h-64 space-y-2 overflow-y-auto">
                    {promptParams.map((param) => {
                        const key = getParamKey(param);
                        const sKey = sourceKey(key);
                        const selectedSource = paramValues[sKey] || "__auto__";
                        const hasSource = Boolean(selectedSource && selectedSource !== "__auto__" && upstreamTextNodes.some((n) => n.id === selectedSource));
                        return (
                            <div key={key}>
                                <div className="mb-1 flex items-center gap-1.5">
                                    <span className="text-xs text-stone-500">{param.label}</span>
                                    {upstreamTextNodes.length > 0 ? (
                                        <Select value={selectedSource} onValueChange={(v) => onParamChange(node.id, sKey, v === "__auto__" ? "" : v)}>
                                            <SelectTrigger className="h-7 min-w-0 flex-1 border-0 text-xs shadow-none"><SelectValue placeholder="自动（按顺序）" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="__auto__">自动（按顺序）</SelectItem>
                                                {upstreamTextNodes.map((n, i) => (<SelectItem key={n.id} value={n.id}>{upstreamLabel(n, i)}</SelectItem>))}
                                            </SelectContent>
                                        </Select>
                                    ) : null}
                                </div>
                                {hasSource ? (
                                    <div className="rounded-md border px-2 py-1.5 text-xs opacity-60" style={{ background: theme.node.fill, borderColor: theme.node.stroke }}>
                                        {(() => {
                                            const idx = upstreamTextNodes.findIndex((n) => n.id === selectedSource);
                                            const content = idx >= 0 ? upstreamTextNodes[idx].content : undefined;
                                            const preview = content ? (content.length > 80 ? content.slice(0, 80) + "..." : content) : undefined;
                                            return preview ? <span className="line-clamp-2" title={content}>{preview}</span> : <span>来自: {upstreamLabel(upstreamTextNodes[idx], idx)}</span>;
                                        })()}
                                    </div>
                                ) : (
                                    <textarea
                                        rows={2}
                                        value={paramValues[key] || ""}
                                        placeholder={param.description || param.label}
                                        className="w-full resize-none rounded-md border px-2 py-1.5 text-sm outline-none"
                                        style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                                        onChange={(e) => onParamChange(node.id, key, e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleExecute(); }}
                                    />
                                )}
                            </div>
                        );
                    })}

                    {booleanParams.length > 0 ? (
                        <div className="flex flex-wrap gap-3">
                            {booleanParams.map((param) => {
                                const key = getParamKey(param);
                                const checked = (paramValues[key] ?? param.defaultValue ?? "false") === "true";
                                return (
                                    <div key={key} className="flex items-center gap-1.5 text-xs">
                                        <Switch className="scale-75" checked={checked} onCheckedChange={(v) => onParamChange(node.id, key, v ? "true" : "false")} />
                                        <span>{param.label}</span>
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}

                    {(numberParams.length > 0 || stringParams.length > 0) ? (
                        <div className="grid grid-cols-2 gap-2">
                            {numberParams.map((param) => {
                                const key = getParamKey(param);
                                return (
                                    <div key={key}>
                                        <div className="mb-1 text-xs text-stone-500">{param.label}</div>
                                        <InputNumber
                                            size="sm"
                                            value={paramValues[key] !== undefined ? Number(paramValues[key]) : param.defaultValue !== undefined ? Number(param.defaultValue) : undefined}
                                            placeholder={param.description || param.label}
                                            onChange={(v) => onParamChange(node.id, key, v !== null ? String(v) : "")}
                                        />
                                    </div>
                                );
                            })}
                            {stringParams.map((param) => {
                                const key = getParamKey(param);
                                const value = paramValues[key] ?? param.defaultValue;
                                const enumOptions = (param.enumOptions || []).map((o) => ({ label: o, value: o }));
                                return (
                                    <div key={key}>
                                        <div className="mb-1 text-xs text-stone-500">{param.label}</div>
                                        {enumOptions.length > 0 ? (
                                            <Select value={value} onValueChange={(v) => onParamChange(node.id, key, v)}>
                                                <SelectTrigger className="h-7 w-full text-xs"><SelectValue placeholder={param.label} /></SelectTrigger>
                                                <SelectContent>{enumOptions.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent>
                                            </Select>
                                        ) : (
                                            <Input className="h-7 text-xs" value={value ?? ""} placeholder={param.label} onChange={(e) => onParamChange(node.id, key, e.target.value)} />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}

                    {imageParams.map((param) => {
                        const key = getParamKey(param);
                        const sKey = sourceKey(key);
                        const selectedSource = paramValues[sKey] || "__auto__";
                        const matchedNode = upstreamImageNodes.find((n) => n.id === selectedSource);
                        return (
                            <div key={key} className="flex items-center gap-1.5">
                                <span className="shrink-0 text-xs text-stone-500">{param.label}:</span>
                                {upstreamImageNodes.length > 0 ? (
                                    <Select value={selectedSource} onValueChange={(v) => onParamChange(node.id, sKey, v === "__auto__" ? "" : v)}>
                                        <SelectTrigger className="h-7 min-w-0 flex-1 text-xs"><SelectValue placeholder="自动（按顺序）" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__auto__">自动（按顺序）</SelectItem>
                                            {upstreamImageNodes.map((n, i) => (<SelectItem key={n.id} value={n.id}>{upstreamLabel(n, i)}</SelectItem>))}
                                        </SelectContent>
                                    </Select>
                                ) : (<span className="text-xs text-amber-500">未连接图片节点</span>)}
                                {selectedSource && selectedSource !== "__auto__" && !matchedNode ? <span className="text-[10px] text-red-400">节点已断开</span> : null}
                            </div>
                        );
                    })}

                    {videoParams.map((param) => {
                        const key = getParamKey(param);
                        const sKey = sourceKey(key);
                        const selectedSource = paramValues[sKey] || "__auto__";
                        const matchedNode = upstreamVideoNodes.find((n) => n.id === selectedSource);
                        return (
                            <div key={key} className="flex items-center gap-1.5">
                                <span className="shrink-0 text-xs text-stone-500">{param.label}:</span>
                                {upstreamVideoNodes.length > 0 ? (
                                    <Select value={selectedSource} onValueChange={(v) => onParamChange(node.id, sKey, v === "__auto__" ? "" : v)}>
                                        <SelectTrigger className="h-7 min-w-0 flex-1 text-xs"><SelectValue placeholder="自动（按顺序）" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__auto__">自动（按顺序）</SelectItem>
                                            {upstreamVideoNodes.map((n, i) => (<SelectItem key={n.id} value={n.id}>{upstreamLabel(n, i)}</SelectItem>))}
                                        </SelectContent>
                                    </Select>
                                ) : (<span className="text-xs text-amber-500">未连接视频节点</span>)}
                                {selectedSource && selectedSource !== "__auto__" && !matchedNode ? <span className="text-[10px] text-red-400">节点已断开</span> : null}
                            </div>
                        );
                    })}

                    {audioParams.map((param) => {
                        const key = getParamKey(param);
                        const sKey = sourceKey(key);
                        const selectedSource = paramValues[sKey] || "__auto__";
                        const matchedNode = upstreamAudioNodes.find((n) => n.id === selectedSource);
                        return (
                            <div key={key} className="flex items-center gap-1.5">
                                <span className="shrink-0 text-xs text-stone-500">{param.label}:</span>
                                {upstreamAudioNodes.length > 0 ? (
                                    <Select value={selectedSource} onValueChange={(v) => onParamChange(node.id, sKey, v === "__auto__" ? "" : v)}>
                                        <SelectTrigger className="h-7 min-w-0 flex-1 text-xs"><SelectValue placeholder="自动（按顺序）" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__auto__">自动（按顺序）</SelectItem>
                                            {upstreamAudioNodes.map((n, i) => (<SelectItem key={n.id} value={n.id}>{upstreamLabel(n, i)}</SelectItem>))}
                                        </SelectContent>
                                    </Select>
                                ) : (<span className="text-xs text-amber-500">未连接音频节点</span>)}
                                {selectedSource && selectedSource !== "__auto__" && !matchedNode ? <span className="text-[10px] text-red-400">节点已断开</span> : null}
                            </div>
                        );
                    })}
                </div>
            ) : null}

            {/* Settings row */}
            <div className="flex items-center gap-2">
                <Select value={instanceType} onValueChange={(value) => onConfigChange(node.id, { rhInstanceType: value as "default" | "plus" })}>
                    <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="default">24G</SelectItem>
                        <SelectItem value="plus">48G</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={String(timeout)} onValueChange={(value) => onConfigChange(node.id, { rhTimeout: Number(value) })}>
                    <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {timeoutOptions.map((opt) => (
                            <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <div className="flex-1" />

                {rhMode === "app" && !isRunning && hasTaskId && node.metadata?.status === "error" ? (
                    <Button size="sm" className="rounded-full" onClick={() => onResume(node.id)}>
                        <RefreshCw className="size-3.5" />
                        重新查询
                    </Button>
                ) : null}

                <Button size="sm" className="rounded-full px-4" variant={isRunning ? "destructive" : "default"} onClick={() => (isRunning ? onStop(node.id) : handleExecute())}>
                    {isRunning ? (
                        <span className="flex items-center gap-1.5"><LoaderCircle className="size-3.5 animate-spin" /><Square className="size-3 fill-current" /><span>停止</span></span>
                    ) : (
                        <span className="flex items-center gap-1.5"><Play className="size-3.5 fill-current" /><span>执行</span></span>
                    )}
                </Button>
            </div>
        </div>
    );
}
