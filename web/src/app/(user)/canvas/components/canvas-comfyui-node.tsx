import { AlertCircle, CheckCircle2, Clock, Box } from "lucide-react";

import { TaskProgress } from "@/components/task-progress";
import { useComfyUIStore } from "@/stores/use-comfyui-store";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "../types";

export function ComfyUINodeContent({ node, theme }: { node: CanvasNodeData; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const presets = useComfyUIStore((state) => state.presets);
    const serverUrl = useComfyUIStore((state) => state.serverUrl);
    const workflowSource = node.metadata?.comfyuiWorkflowSource || "preset";
    const preset = presets.find((p) => p.id === node.metadata?.comfyuiPresetId);
    const status = node.metadata?.status || "idle";
    const progressText = typeof node.metadata?.progressText === "string" ? node.metadata.progressText : "";
    const progress = typeof node.metadata?.progress === "number" ? node.metadata.progress : undefined;

    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4" style={{ color: theme.node.text }}>
            {/* Header */}
            <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg" style={{ background: "#10b981", color: "#fff" }}>
                    <Box className="size-4" />
                </div>
                <span className="text-sm font-semibold">ComfyUI</span>
            </div>

            {/* Workflow source */}
            <div className="w-full truncate text-center text-xs" style={{ color: theme.node.muted }}>
                {workflowSource === "upstream" ? "上游文本传入" : preset ? preset.name : "未选择预设"}
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
                    <span className="line-clamp-2">{node.metadata?.comfyuiLastError || "执行失败"}</span>
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

            {/* Param preview */}
            {(() => {
                const pv = node.metadata?.comfyuiParamValues;
                if (!pv) return null;
                const previewText = Object.entries(pv)
                    .filter(([k, v]) => !k.startsWith("@source:") && v?.trim())
                    .map(([, v]) => v)
                    .find(Boolean);
                return previewText ? (
                    <div className="line-clamp-2 w-full text-center text-xs opacity-60">
                        {previewText.length > 50 ? previewText.slice(0, 50) + "..." : previewText}
                    </div>
                ) : null;
            })()}

            {/* Server URL + output type + param count badges */}
            <div className="flex flex-wrap justify-center gap-2 text-[10px]" style={{ color: theme.node.muted }}>
                {serverUrl ? (
                    <span className="rounded border px-1.5 py-0.5" style={{ borderColor: theme.node.stroke }}>
                        {serverUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                    </span>
                ) : null}
                {preset ? (
                    <span className="rounded border px-1.5 py-0.5" style={{ borderColor: theme.node.stroke }}>
                        {preset.outputType === "image" ? "图片" : preset.outputType === "video" ? "视频" : preset.outputType === "audio" ? "音频" : "自动"}
                    </span>
                ) : null}
                {preset?.params?.length ? (
                    <span className="rounded border px-1.5 py-0.5" style={{ borderColor: theme.node.stroke }}>
                        {preset.params.filter((p) => p.role !== "ignore" && p.role !== "fixed").length} 参数
                    </span>
                ) : null}
            </div>
        </div>
    );
}
