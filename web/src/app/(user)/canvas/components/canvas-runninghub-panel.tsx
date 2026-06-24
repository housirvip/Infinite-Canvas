import { App, Button, Input, InputNumber, Select, Switch } from "antd";
import { LoaderCircle, Play, RefreshCw, Square } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { RUNNINGHUB_DEFAULT_TIMEOUT_S, RUNNINGHUB_TIMEOUT_OPTIONS, paramKey } from "@/lib/runninghub";
import { useConfigStore } from "@/stores/use-config-store";
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
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const workflows = config.runninghubWorkflows;
    const selectedWorkflowId = node.metadata?.runninghubWorkflowId || "";
    const timeout = node.metadata?.runninghubTimeout || RUNNINGHUB_DEFAULT_TIMEOUT_S;
    const instanceType = node.metadata?.runninghubInstanceType || "default";
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
        if (!config.runninghubApiKey) {
            message.warning("请先在设置中配置 RunningHub API Key");
            openConfigDialog();
            return;
        }
        if (!selectedWorkflowId) {
            message.warning("请先选择工作流");
            return;
        }
        onExecute(node.id);
    };

    const sourceKey = (pKey: string) => `@source:${pKey}`;

    const buildSourceOptions = (candidates: UpstreamNode[]) => [
        { label: "自动（按顺序）", value: "" },
        ...candidates.map((n, i) => ({ label: upstreamLabel(n, i), value: n.id })),
    ];

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
                    className="w-full"
                    size="small"
                    placeholder="选择工作流"
                    value={selectedWorkflowId || undefined}
                    options={workflowOptions}
                    onChange={(value) => onConfigChange(node.id, { runninghubWorkflowId: value, runninghubParamValues: {} })}
                    notFoundContent={
                        <div className="py-2 text-center text-xs text-stone-400">
                            暂无工作流，
                            <Button type="link" size="small" className="!px-0 !text-xs" onClick={() => openConfigDialog()}>
                                去设置
                            </Button>
                        </div>
                    }
                />
            </div>

            {workflow ? (
                <div className="thin-scrollbar max-h-64 space-y-2 overflow-y-auto">
                    {/* Prompt params */}
                    {promptParams.map((param) => {
                        const key = paramKey(param);
                        const sKey = sourceKey(key);
                        const selectedSource = paramValues[sKey] || "";
                        const hasSource = Boolean(selectedSource && upstreamTextNodes.some((n) => n.id === selectedSource));
                        return (
                            <div key={key}>
                                <div className="mb-1 flex items-center gap-1.5">
                                    <span className="text-xs text-stone-500">{param.label}</span>
                                    {upstreamTextNodes.length > 0 ? (
                                        <Select
                                            size="small"
                                            className="!min-w-0 flex-1"
                                            variant="borderless"
                                            value={selectedSource}
                                            options={buildSourceOptions(upstreamTextNodes)}
                                            onChange={(v) => onParamChange(node.id, sKey, v)}
                                        />
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
                                ) : (
                                    <Input.TextArea
                                        rows={2}
                                        value={paramValues[key] || ""}
                                        placeholder={param.description || param.label}
                                        className="!text-sm"
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
                                        <Switch size="small" checked={checked} onChange={(v) => onParamChange(node.id, key, v ? "true" : "false")} />
                                        <span>{param.label}</span>
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}

                    {/* Number params */}
                    {numberParams.map((param) => {
                        const key = paramKey(param);
                        return (
                            <div key={key}>
                                <div className="mb-1 text-xs text-stone-500">{param.label}</div>
                                <InputNumber
                                    size="small"
                                    className="!w-full"
                                    value={paramValues[key] !== undefined ? Number(paramValues[key]) : param.defaultValue !== undefined ? Number(param.defaultValue) : undefined}
                                    placeholder={param.description || param.label}
                                    style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                                    onChange={(v) => onParamChange(node.id, key, v !== null ? String(v) : "")}
                                />
                            </div>
                        );
                    })}

                    {/* String params */}
                    {stringParams.map((param) => {
                        const key = paramKey(param);
                        return (
                            <div key={key}>
                                <div className="mb-1 text-xs text-stone-500">{param.label}</div>
                                <Input
                                    size="small"
                                    value={paramValues[key] ?? param.defaultValue ?? ""}
                                    placeholder={param.description || param.label}
                                    style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                                    onChange={(e) => onParamChange(node.id, key, e.target.value)}
                                />
                            </div>
                        );
                    })}

                    {/* Image params with source selector */}
                    {imageParams.map((param) => {
                        const key = paramKey(param);
                        const sKey = sourceKey(key);
                        const selectedSource = paramValues[sKey] || "";
                        const matchedNode = upstreamImageNodes.find((n) => n.id === selectedSource);
                        return (
                            <div key={key} className="flex items-center gap-1.5">
                                <span className="shrink-0 text-xs text-stone-500">{param.label}:</span>
                                {upstreamImageNodes.length > 0 ? (
                                    <Select
                                        size="small"
                                        className="!min-w-0 flex-1"
                                        value={selectedSource}
                                        options={buildSourceOptions(upstreamImageNodes)}
                                        onChange={(v) => onParamChange(node.id, sKey, v)}
                                    />
                                ) : (
                                    <span className="text-xs text-amber-500">未连接图片节点</span>
                                )}
                                {selectedSource && !matchedNode ? <span className="text-[10px] text-red-400">节点已断开</span> : null}
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
                        const selectedSource = paramValues[sKey] || "";
                        const matchedNode = upstreamVideoNodes.find((n) => n.id === selectedSource);
                        return (
                            <div key={key} className="flex items-center gap-1.5">
                                <span className="shrink-0 text-xs text-stone-500">{param.label}:</span>
                                {upstreamVideoNodes.length > 0 ? (
                                    <Select
                                        size="small"
                                        className="!min-w-0 flex-1"
                                        value={selectedSource}
                                        options={buildSourceOptions(upstreamVideoNodes)}
                                        onChange={(v) => onParamChange(node.id, sKey, v)}
                                    />
                                ) : (
                                    <span className="text-xs text-amber-500">未连接视频节点</span>
                                )}
                                {selectedSource && !matchedNode ? <span className="text-[10px] text-red-400">节点已断开</span> : null}
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
                <Select size="small" className="w-28" value={instanceType} onChange={(value) => onConfigChange(node.id, { runninghubInstanceType: value })} options={[{ label: "24G", value: "default" }, { label: "48G", value: "plus" }]} />
                <Select size="small" className="w-24" value={timeout} onChange={(value) => onConfigChange(node.id, { runninghubTimeout: value })} options={RUNNINGHUB_TIMEOUT_OPTIONS} />
                <div className="flex-1" />

                {!isRunning && hasTaskId && node.metadata?.status === "error" ? (
                    <Button size="small" icon={<RefreshCw className="size-3.5" />} className="!rounded-full" onClick={() => onResume(node.id)}>
                        重新查询
                    </Button>
                ) : null}

                <Button type="primary" size="small" className="!rounded-full !px-4" danger={isRunning} disabled={!isRunning && !selectedWorkflowId} onClick={() => (isRunning ? onStop(node.id) : handleExecute())}>
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
