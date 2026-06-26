import { AlertCircle, CheckCircle2, Clock } from "lucide-react";

import { TaskProgress } from "@/components/task-progress";
import { useRunningHubStore } from "@/stores/use-runninghub-store";
import { useComfyUIStore } from "@/stores/use-comfyui-store";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "../types";

export function RunningHubNodeContent({ node, theme }: { node: CanvasNodeData; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const appWorkflows = useRunningHubStore((state) => state.workflows);
    const comfyuiPresets = useComfyUIStore((state) => state.presets);

    const rhMode = node.metadata?.rhMode || "app";
    const status = node.metadata?.status || "idle";
    const progressText = typeof node.metadata?.progressText === "string" ? node.metadata.progressText : (node.metadata?.rhStatus || "");
    const progress = typeof node.metadata?.progress === "number" ? node.metadata.progress : undefined;

    let workflowLabel = "未选择工作流";
    if (rhMode === "app") {
        const workflow = appWorkflows.find((w) => w.id === node.metadata?.rhWorkflowId);
        workflowLabel = workflow ? workflow.name : "未选择工作流";
    } else {
        const source = node.metadata?.rhWorkflowSource || "preset";
        if (source === "preset") {
            const preset = comfyuiPresets.find((p) => p.id === node.metadata?.rhPresetId);
            workflowLabel = preset ? preset.name : "未选择预设";
        } else {
            workflowLabel = "上游文本输入";
        }
    }

    const iconColor = rhMode === "app" ? "#6366f1" : "#8b5cf6";

    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4" style={{ color: theme.node.text }}>
            <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg" style={{ background: iconColor, color: "#fff" }}>
                    <span className="text-xs font-semibold leading-none" aria-hidden="true">RH</span>
                </div>
                <span className="text-sm font-semibold">RunningHub</span>
            </div>

            <div className="w-full truncate text-center text-xs" style={{ color: theme.node.muted }}>
                {workflowLabel}
            </div>

            {status === "loading" ? (
                <TaskProgress progress={progress} progressText={progressText || "执行中..."} compact />
            ) : status === "error" ? (
                <div className="flex max-w-full items-start gap-2 text-xs text-red-500">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                    <span className="line-clamp-2">{node.metadata?.rhLastError || "执行失败"}</span>
                </div>
            ) : status === "success" ? (
                <div className="flex items-center gap-2 text-xs text-green-600">
                    <CheckCircle2 className="size-3.5" />
                    <span>已完成</span>
                </div>
            ) : (
                <div className="flex items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                    <Clock className="size-3.5" />
                    <span>就绪</span>
                </div>
            )}

            {(() => {
                const paramValues = node.metadata?.rhParamValues;
                if (!paramValues) return null;
                const previewText = Object.entries(paramValues)
                    .filter(([k, v]) => !k.startsWith("@source:") && v?.trim())
                    .map(([, v]) => v)
                    .find(Boolean);
                return previewText ? (
                    <div className="line-clamp-2 w-full text-center text-xs opacity-60">
                        {previewText.length > 50 ? previewText.slice(0, 50) + "..." : previewText}
                    </div>
                ) : null;
            })()}

            <div className="flex flex-wrap justify-center gap-2 text-[10px]" style={{ color: theme.node.muted }}>
                <span className="rounded border px-1.5 py-0.5" style={{ borderColor: theme.node.stroke }}>
                    {rhMode === "app" ? "WebApp" : "ComfyUI"}
                </span>
                <span className="rounded border px-1.5 py-0.5" style={{ borderColor: theme.node.stroke }}>
                    {node.metadata?.rhInstanceType === "plus" ? "48G" : "24G"}
                </span>
            </div>
        </div>
    );
}
