import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputNumber } from "@/components/ui/input-number";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { message } from "@/lib/message";
import { LoaderCircle, Play, RefreshCw, Square } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { RUNNINGHUB_DEFAULT_TIMEOUT_S, RUNNINGHUB_TIMEOUT_OPTIONS, paramKey } from "@/lib/runninghub";
import { useRunningHubStore } from "@/stores/use-runninghub-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "../types";

export type UpstreamNode = { id: string; title: string; type: CanvasNodeType; content?: string };

function upstreamLabel(node: UpstreamNode, index: number): string {
    if (node.type === CanvasNodeType.Text) return `文本${index + 1}`;
    if (node.type === CanvasNodeType.Image) return `图片${index + 1}`;
    if (node.type === CanvasNodeType.Video) return `视频${index + 1}`;
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
    const workflows = useRunningHubStore((state) => state.workflows);
    const hasApiKey = useRunningHubStore((state) => state.hasApiKey);
    const openRunningHubDialog = useRunningHubStore((state) => state.openDialog);
    const selectedWorkflowId = node.metadata?.runninghubWorkflowId || "";
    const timeout = node.metadata?.runninghubTimeout || RUNNINGHUB_DEFAULT_TIMEOUT_S;
    const instanceType = (node.metadata?.runninghubInstanceType || "default") as string;
    const workflow = workflows.find((w) => w.id === selectedWorkflowId);
    const paramValues = node.metadata?.runninghubParamValues || {};

    const promptParams = (workflow?.params || []).filter((p) => p.role === "prompt").sort((a, b) => a.order - b.order);
    const booleanParams = (workflow?.params || []).filter((p) => p.role === "boolean").sort((a, b) => a.order - b.order);
    const numberParams = (workflow?.params || []).filter((p) => p.role === "number").sort((a, b) => a.order - b.order);
    const stringParams = (workflow?.params || []).filter((p) => p.role === "string").sort((a, b) => a.order - b.order);
    const imageParams = (workflow?.params || []).filter((p) => p.role === "image").sort((a, b) => a.order - b.order);
    const videoParams = (workflow?.params || []).filter((p) => p.role === "video").sort((a, b) => a.order - b.order);

    const upstreamTextNodes = upstreamNodes.filter((n) => n.type === CanvasNodeType.Text);
    const upstreamImageNodes = upstreamNodes.filter((n) => n.type === CanvasNodeType.Image);
    const upstreamVideoNodes = upstreamNodes.filter((n) => n.type === CanvasNodeType.Video);

    const workflowOptions = workflows.map((w) => ({ label: w.name, value: w.id }));

    const handleExecute = () => {
        if (!hasApiKey) {
            message.warning("请先配置 RunningHub API Key");
            openRunningHubDialog();
            return;
        }
        if (!workflows.length) {
            message.warning("请先配置 RunningHub 工作流");
            openRunningHubDialog();
            return;
        }
        if (!selectedWorkflowId) {
            message.warning("请先选择工作流");
            return;
        }
        if (!workflow) {
            message.warning("当前工作流不存在，请重新配置");
            openRunningHubDialog();
            return;
        }
        onExecute(node.id);
    };

    const sourceKey = (pKey: string) => `@source:${pKey}`;

    return (
        <div
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
        >
            {/* Workflow selector */}
            <div className="mb-2">
                <Select
                    value={selectedWorkflowId || undefined}
                    onValueChange={(value) => onConfigChange(node.id, { runninghubWorkflowId: value, runninghubParamValues: {} })}
                >
                    <SelectTrigger className="h-8 w-full text-sm">
                        <SelectValue placeholder="选择工作流" />
                    </SelectTrigger>
                    <SelectContent>
                        {workflowOptions.length ? (
                            workflowOptions.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))
                        ) : (
                            <div className="py-2 text-center text-xs text-stone-400">
                                暂无工作流，
                                <Button variant="link" size="sm" className="px-0 text-xs" onClick={() => openRunningHubDialog()}>
                                    去配置
                                </Button>
                            </div>
                        )}
                    </SelectContent>
                </Select>
            </div>

            {workflow ? (
                <div className="thin-scrollbar max-h-64 space-y-2 overflow-y-auto">
                    {/* Prompt params */}
                    {promptParams.map((param) => {
                        const key = paramKey(param);
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
                                            const label = idx >= 0 ? upstreamLabel(upstreamTextNodes[idx], idx) : "文本节点";
                                            const content = idx >= 0 ? upstreamTextNodes[idx].content : undefined;
                                            const maxLen = 80;
                                            const preview = content ? (content.length > maxLen ? content.slice(0, maxLen) + "..." : content) : undefined;
                                            return preview ? (
                                                <span className="line-clamp-2" title={content}>{preview}</span>
                                            ) : (
                                                <span>来自: {label}</span>
                                            );
                                        })()}
                                    </div>
                                ) : selectedSource === "__auto__" && upstreamTextNodes.length > 0 ? (
                                    <div
                                        className="rounded-md border px-2 py-1.5 text-xs opacity-60"
                                        style={{ background: theme.node.fill, borderColor: theme.node.stroke }}
                                    >
                                        {(() => {
                                            const paramIdx = promptParams.indexOf(param);
                                            const autoNode = upstreamTextNodes[paramIdx];
                                            if (!autoNode) return <span className="text-stone-400">等待上游文本节点</span>;
                                            const content = autoNode.content;
                                            const maxLen = 80;
                                            const preview = content ? (content.length > maxLen ? content.slice(0, maxLen) + "..." : content) : undefined;
                                            return preview ? (
                                                <span className="line-clamp-2" title={content}>{preview}</span>
                                            ) : (
                                                <span>来自: {upstreamLabel(autoNode, paramIdx)}</span>
                                            );
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

                    {/* Upstream text hint (no prompt params but has text connections) */}
                    {promptParams.length > 0 && upstreamTextNodes.length > 0 && promptParams.every((p) => !paramValues[sourceKey(paramKey(p))]) ? (
                        <div className="text-xs text-stone-400">
                            未指定来源的提示词将按顺序从上游文本节点自动填充
                        </div>
                    ) : null}

                    {/* Boolean params */}
                    {booleanParams.length > 0 ? (
                        <div className="flex flex-wrap gap-3">
                            {booleanParams.map((param) => {
                                const key = paramKey(param);
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

                    {/* Number + String params in 2-col grid */}
                    {(numberParams.length > 0 || stringParams.length > 0) ? (
                        <div className="grid grid-cols-2 gap-2">
                            {numberParams.map((param) => {
                                const key = paramKey(param);
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
                                const key = paramKey(param);
                                const value = paramValues[key] ?? param.defaultValue;
                                const enumOptions = (param.enumOptions || []).map((option) => ({ label: option, value: option }));
                                return (
                                    <div key={key}>
                                        <div className="mb-1 text-xs text-stone-500">{param.label}</div>
                                        {enumOptions.length > 0 ? (
                                            <Select
                                                value={value}
                                                onValueChange={(selectedValue) => onParamChange(node.id, key, selectedValue)}
                                            >
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
                        const key = paramKey(param);
                        const sKey = sourceKey(key);
                        const selectedSource = paramValues[sKey] || "__auto__";
                        const matchedNode = upstreamImageNodes.find((n) => n.id === selectedSource);
                        return (
                            <div key={key} className="flex items-center gap-1.5">
                                <span className="shrink-0 text-xs text-stone-500">{param.label}:</span>
                                {upstreamImageNodes.length > 0 ? (
                                    <Select
                                        value={selectedSource}
                                        onValueChange={(v) => onParamChange(node.id, sKey, v === "__auto__" ? "" : v)}
                                    >
                                        <SelectTrigger className="h-7 min-w-0 flex-1 text-xs">
                                            <SelectValue placeholder="自动（按顺序）" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__auto__">自动（按顺序）</SelectItem>
                                            {upstreamImageNodes.map((n, i) => (
                                                <SelectItem key={n.id} value={n.id}>{upstreamLabel(n, i)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <span className="text-xs text-amber-500">未连接图片节点</span>
                                )}
                                {selectedSource && selectedSource !== "__auto__" && !matchedNode ? <span className="text-[10px] text-red-400">节点已断开</span> : null}
                            </div>
                        );
                    })}

                    {/* Image auto-fill hint */}
                    {imageParams.length > 0 && upstreamImageNodes.length > 0 && imageParams.every((p) => !paramValues[sourceKey(paramKey(p))]) ? (
                        <div className="text-xs text-stone-400">
                            图片输入: {Math.min(upstreamImageNodes.length, imageParams.length)}/{imageParams.length} 按顺序自动匹配
                        </div>
                    ) : null}

                    {/* Video params with source selector */}
                    {videoParams.map((param) => {
                        const key = paramKey(param);
                        const sKey = sourceKey(key);
                        const selectedSource = paramValues[sKey] || "__auto__";
                        const matchedNode = upstreamVideoNodes.find((n) => n.id === selectedSource);
                        return (
                            <div key={key} className="flex items-center gap-1.5">
                                <span className="shrink-0 text-xs text-stone-500">{param.label}:</span>
                                {upstreamVideoNodes.length > 0 ? (
                                    <Select
                                        value={selectedSource}
                                        onValueChange={(v) => onParamChange(node.id, sKey, v === "__auto__" ? "" : v)}
                                    >
                                        <SelectTrigger className="h-7 min-w-0 flex-1 text-xs">
                                            <SelectValue placeholder="自动（按顺序）" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__auto__">自动（按顺序）</SelectItem>
                                            {upstreamVideoNodes.map((n, i) => (
                                                <SelectItem key={n.id} value={n.id}>{upstreamLabel(n, i)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <span className="text-xs text-amber-500">未连接视频节点</span>
                                )}
                                {selectedSource && selectedSource !== "__auto__" && !matchedNode ? <span className="text-[10px] text-red-400">节点已断开</span> : null}
                            </div>
                        );
                    })}

                    {/* Video auto-fill hint */}
                    {videoParams.length > 0 && upstreamVideoNodes.length > 0 && videoParams.every((p) => !paramValues[sourceKey(paramKey(p))]) ? (
                        <div className="text-xs text-stone-400">
                            视频输入: {Math.min(upstreamVideoNodes.length, videoParams.length)}/{videoParams.length} 按顺序自动匹配
                        </div>
                    ) : null}
                </div>
            ) : null}

            {/* Settings row */}
            <div className="mt-2 flex items-center gap-2">
                <Select value={instanceType} onValueChange={(value) => onConfigChange(node.id, { runninghubInstanceType: value as "default" | "plus" })}>
                    <SelectTrigger className="h-8 w-28 text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="default">24G</SelectItem>
                        <SelectItem value="plus">48G</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={String(timeout)} onValueChange={(value) => onConfigChange(node.id, { runninghubTimeout: Number(value) })}>
                    <SelectTrigger className="h-8 w-24 text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {RUNNINGHUB_TIMEOUT_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <div className="flex-1" />

                {!isRunning && hasTaskId && node.metadata?.status === "error" ? (
                    <Button size="sm" className="rounded-full" onClick={() => onResume(node.id)}>
                        <RefreshCw className="size-3.5" />
                        重新查询
                    </Button>
                ) : null}

                <Button size="sm" className="rounded-full px-4" variant={isRunning ? "destructive" : "default"} disabled={!isRunning && !selectedWorkflowId} onClick={() => (isRunning ? onStop(node.id) : handleExecute())}>
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
