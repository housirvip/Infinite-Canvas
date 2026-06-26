import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputNumber } from "@/components/ui/input-number";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { message } from "@/lib/message";
import { LoaderCircle, Play, Settings2, Square } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { COMFYUI_TIMEOUT_OPTIONS, comfyuiParamKey } from "@/lib/comfyui";
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

type ComfyUIPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    upstreamNodes: UpstreamNode[];
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onParamChange: (nodeId: string, paramKey: string, value: string) => void;
    onExecute: (nodeId: string) => void;
    onStop: (nodeId: string) => void;
};

export function CanvasComfyUIPanel({ node, isRunning, upstreamNodes, onConfigChange, onParamChange, onExecute, onStop }: ComfyUIPanelProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const presets = useComfyUIStore((state) => state.presets);
    const serverUrl = useComfyUIStore((state) => state.serverUrl);
    const openComfyUIDialog = useComfyUIStore((state) => state.openDialog);
    const workflowSource = node.metadata?.comfyuiWorkflowSource || "preset";
    const selectedPresetId = node.metadata?.comfyuiPresetId || "";
    const timeout = node.metadata?.comfyuiTimeout || 600;
    const preset = presets.find((p) => p.id === selectedPresetId);
    const paramValues = node.metadata?.comfyuiParamValues || {};

    const upstreamTextNodes = upstreamNodes.filter((n) => n.type === CanvasNodeType.Text);
    const upstreamImageNodes = upstreamNodes.filter((n) => n.type === CanvasNodeType.Image);
    const upstreamVideoNodes = upstreamNodes.filter((n) => n.type === CanvasNodeType.Video);
    const upstreamAudioNodes = upstreamNodes.filter((n) => n.type === CanvasNodeType.Audio);
    const upstreamTextContent = upstreamTextNodes[0]?.content || "";

    const promptParams = (preset?.params || []).filter((p) => p.role === "prompt").sort((a, b) => a.order - b.order);
    const booleanParams = (preset?.params || []).filter((p) => p.role === "boolean").sort((a, b) => a.order - b.order);
    const numberParams = (preset?.params || []).filter((p) => p.role === "number").sort((a, b) => a.order - b.order);
    const stringParams = (preset?.params || []).filter((p) => p.role === "string").sort((a, b) => a.order - b.order);
    const imageParams = (preset?.params || []).filter((p) => p.role === "image").sort((a, b) => a.order - b.order);
    const videoParams = (preset?.params || []).filter((p) => p.role === "video").sort((a, b) => a.order - b.order);
    const audioParams = (preset?.params || []).filter((p) => p.role === "audio").sort((a, b) => a.order - b.order);
    const hasParams = promptParams.length > 0 || booleanParams.length > 0 || numberParams.length > 0 || stringParams.length > 0 || imageParams.length > 0 || videoParams.length > 0 || audioParams.length > 0;

    const handleExecute = () => {
        if (!serverUrl) {
            message.warning("请先配置 ComfyUI 服务器地址");
            openComfyUIDialog();
            return;
        }
        if (workflowSource === "preset") {
            if (!selectedPresetId || !preset) {
                message.warning("请先选择工作流预设");
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

    return (
        <div
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            data-canvas-no-zoom
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
        >
            {/* Workflow source toggle */}
            <div className="mb-2 flex gap-1 rounded-lg p-0.5 text-xs" style={{ background: theme.toolbar.itemHover }}>
                <button
                    className="flex-1 rounded-md px-2 py-1 transition-colors"
                    style={workflowSource === "preset" ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.toolbar.item }}
                    onClick={() => onConfigChange(node.id, { comfyuiWorkflowSource: "preset" })}
                >
                    预设工作流
                </button>
                <button
                    className="flex-1 rounded-md px-2 py-1 transition-colors"
                    style={workflowSource === "upstream" ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.toolbar.item }}
                    onClick={() => onConfigChange(node.id, { comfyuiWorkflowSource: "upstream" })}
                >
                    上游文本
                </button>
            </div>

            {/* Content based on source */}
            {workflowSource === "preset" ? (
                <div className="mb-2">
                    <Select
                        value={selectedPresetId || undefined}
                        onValueChange={(value) => onConfigChange(node.id, { comfyuiPresetId: value, comfyuiParamValues: {} })}
                    >
                        <SelectTrigger className="h-8 w-full text-sm">
                            <SelectValue placeholder="选择预设工作流" />
                        </SelectTrigger>
                        <SelectContent>
                            {presets.length ? (
                                presets.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))
                            ) : (
                                <div className="py-2 text-center text-xs text-stone-400">
                                    暂无预设，
                                    <Button variant="link" size="sm" className="px-0 text-xs" onClick={() => openComfyUIDialog()}>
                                        去配置
                                    </Button>
                                </div>
                            )}
                        </SelectContent>
                    </Select>
                </div>
            ) : (
                <div className="mb-2">
                    {upstreamTextNodes.length > 0 ? (
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
                    )}
                </div>
            )}

            {/* Dynamic param inputs */}
            {workflowSource === "preset" && preset && hasParams ? (
                <div className="thin-scrollbar mb-2 max-h-64 space-y-2 overflow-y-auto">
                    {/* Prompt params */}
                    {promptParams.map((param) => {
                        const key = comfyuiParamKey(param);
                        const sKey = sourceKey(key);
                        const selectedSource = paramValues[sKey] || "__auto__";
                        const hasSource = Boolean(selectedSource && selectedSource !== "__auto__" && upstreamTextNodes.some((n) => n.id === selectedSource));
                        return (
                            <div key={key}>
                                <div className="mb-1 flex items-center gap-1.5">
                                    <span className="text-xs text-stone-500">{param.label}</span>
                                    {upstreamTextNodes.length > 0 ? (
                                        <Select
                                            value={selectedSource}
                                            onValueChange={(v) => onParamChange(node.id, sKey, v === "__auto__" ? "" : v)}
                                        >
                                            <SelectTrigger className="h-7 min-w-0 flex-1 border-0 text-xs shadow-none">
                                                <SelectValue placeholder="自动（按顺序）" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="__auto__">自动（按顺序）</SelectItem>
                                                {upstreamTextNodes.map((n, i) => (
                                                    <SelectItem key={n.id} value={n.id}>{upstreamLabel(n, i)}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : null}
                                </div>
                                {hasSource ? (
                                    <div
                                        className="rounded-md border px-2 py-1.5 text-xs opacity-60"
                                        style={{ background: theme.node.fill, borderColor: theme.node.stroke }}
                                    >
                                        {(() => {
                                            const idx = upstreamTextNodes.findIndex((n) => n.id === selectedSource);
                                            const content = idx >= 0 ? upstreamTextNodes[idx].content : undefined;
                                            const maxLen = 80;
                                            const preview = content ? (content.length > maxLen ? content.slice(0, maxLen) + "..." : content) : undefined;
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

                    {/* Boolean params */}
                    {booleanParams.length > 0 ? (
                        <div className="flex flex-wrap gap-3">
                            {booleanParams.map((param) => {
                                const key = comfyuiParamKey(param);
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

                    {/* Number + String params */}
                    {(numberParams.length > 0 || stringParams.length > 0) ? (
                        <div className="grid grid-cols-2 gap-2">
                            {numberParams.map((param) => {
                                const key = comfyuiParamKey(param);
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
                                const key = comfyuiParamKey(param);
                                const value = paramValues[key] ?? param.defaultValue;
                                const enumOptions = (param.enumOptions || []).map((option) => ({ label: option, value: option }));
                                return (
                                    <div key={key}>
                                        <div className="mb-1 text-xs text-stone-500">{param.label}</div>
                                        {enumOptions.length > 0 ? (
                                            <Select value={value} onValueChange={(v) => onParamChange(node.id, key, v)}>
                                                <SelectTrigger className="h-7 w-full text-xs">
                                                    <SelectValue placeholder={param.description || param.label} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {enumOptions.map((opt) => (
                                                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <Input
                                                className="h-7 text-xs"
                                                value={value ?? ""}
                                                placeholder={param.description || param.label}
                                                style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                                                onChange={(e) => onParamChange(node.id, key, e.target.value)}
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}

                    {/* Image params with source selector */}
                    {imageParams.map((param) => {
                        const key = comfyuiParamKey(param);
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
                                ) : (
                                    <span className="text-xs text-amber-500">未连接图片节点</span>
                                )}
                                {selectedSource && selectedSource !== "__auto__" && !matchedNode ? <span className="text-[10px] text-red-400">节点已断开</span> : null}
                            </div>
                        );
                    })}

                    {/* Video params with source selector */}
                    {videoParams.map((param) => {
                        const key = comfyuiParamKey(param);
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
                                ) : (
                                    <span className="text-xs text-amber-500">未连接视频节点</span>
                                )}
                                {selectedSource && selectedSource !== "__auto__" && !matchedNode ? <span className="text-[10px] text-red-400">节点已断开</span> : null}
                            </div>
                        );
                    })}

                    {/* Audio params with source selector */}
                    {audioParams.map((param) => {
                        const key = comfyuiParamKey(param);
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
                                ) : (
                                    <span className="text-xs text-amber-500">未连接音频节点</span>
                                )}
                                {selectedSource && selectedSource !== "__auto__" && !matchedNode ? <span className="text-[10px] text-red-400">节点已断开</span> : null}
                            </div>
                        );
                    })}
                </div>
            ) : null}

            {/* Settings row */}
            <div className="flex items-center gap-2">
                <Select value={String(timeout)} onValueChange={(value) => onConfigChange(node.id, { comfyuiTimeout: Number(value) })}>
                    <SelectTrigger className="h-8 w-24 text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {COMFYUI_TIMEOUT_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Button variant="outline" size="sm" onClick={() => openComfyUIDialog()}>
                    <Settings2 className="size-3.5" />
                    配置
                </Button>

                <div className="flex-1" />

                <Button size="sm" className="rounded-full px-4" variant={isRunning ? "destructive" : "default"} onClick={() => (isRunning ? onStop(node.id) : handleExecute())}>
                    {isRunning ? (
                        <span className="flex items-center gap-1.5">
                            <LoaderCircle className="size-3.5 animate-spin" />
                            <Square className="size-3 fill-current" />
                            <span>停止</span>
                        </span>
                    ) : (
                        <span className="flex items-center gap-1.5">
                            <Play className="size-3.5 fill-current" />
                            <span>执行</span>
                        </span>
                    )}
                </Button>
            </div>
        </div>
    );
}
