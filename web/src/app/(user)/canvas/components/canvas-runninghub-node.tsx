import { AlertCircle, CheckCircle2, Clock } from "lucide-react";

import { TaskProgress } from "@/components/task-progress";
import { useRunningHubStore } from "@/stores/use-runninghub-store";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "../types";

export function RunningHubNodeContent({ node, theme }: { node: CanvasNodeData; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const workflows = useRunningHubStore((state) => state.workflows);
    const workflow = workflows.find((w) => w.id === node.metadata?.runninghubWorkflowId);
    const status = node.metadata?.status || "idle";
    const progressText = typeof node.metadata?.progressText === "string" ? node.metadata.progressText : (node.metadata?.runninghubStatus || "");
    const progress = typeof node.metadata?.progress === "number" ? node.metadata.progress : undefined;

    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4" style={{ color: theme.node.text }}>
            {/* Header */}
            <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg" style={{ background: "#6366f1", color: "#fff" }}>
                    <span className="text-xs font-semibold leading-none" aria-hidden="true">RH</span>
                </div>
                <span className="text-sm font-semibold">RunningHub</span>
            </div>

            {/* Workflow name */}
            <div className="w-full truncate text-center text-xs" style={{ color: theme.node.muted }}>
                {workflow ? workflow.name : "未选择工作流"}
            </div>

            {/* Status */}
            {status === "loading" ? (
                <TaskProgress
                    progress={progress}
                    progressText={progressText || "执行中..."}
                    compact
                />
            ) : status === "error" ? (
                <div className="flex max-w-full items-start gap-2 text-xs text-red-500">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                    <span className="line-clamp-2">{node.metadata?.runninghubLastError || "执行失败"}</span>
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

            {/* Prompt preview */}
            {(() => {
                const paramValues = node.metadata?.runninghubParamValues;
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

            {/* Instance type badge */}
            {workflow ? (
                <div className="flex gap-2 text-[10px]" style={{ color: theme.node.muted }}>
                    <span className="rounded border px-1.5 py-0.5" style={{ borderColor: theme.node.stroke }}>
                        {node.metadata?.runninghubInstanceType === "plus" ? "48G" : "24G"}
                    </span>
                    <span className="rounded border px-1.5 py-0.5" style={{ borderColor: theme.node.stroke }}>
                        {workflow.outputType === "image" ? "图片" : workflow.outputType === "video" ? "视频" : "自动"}
                    </span>
                </div>
            ) : null}
        </div>
    );
}
