import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tag } from "@/components/ui/tag";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Ellipsis, Image as ImageIcon, Settings2 } from "lucide-react";

import type { ImageQuickToolId } from "./canvas-image-toolbar-tools";

export type ImageToolbarSettingsTool = {
    id: ImageQuickToolId;
    title: string;
    label: string;
    icon: ReactNode;
    active?: boolean;
    danger?: boolean;
};

type PreviewTool = ImageToolbarSettingsTool | {
    id: "more";
    title: string;
    label: string;
    icon: ReactNode;
    active?: boolean;
    danger?: boolean;
};

type PreviewScroll = {
    left: number;
    max: number;
    viewport: number;
    content: number;
};

export function ImageToolSettingsModal({
    open,
    tools,
    selectedIds,
    showLabels,
    onToggle,
    onShowLabelsChange,
    onCancel,
    onSave,
}: {
    open: boolean;
    tools: ImageToolbarSettingsTool[];
    selectedIds: ImageQuickToolId[];
    showLabels: boolean;
    onToggle: (id: ImageQuickToolId, visible: boolean) => void;
    onShowLabelsChange: (value: boolean) => void;
    onCancel: () => void;
    onSave: () => void;
}) {
    const previewToolbarRef = useRef<HTMLDivElement>(null);
    const scrollbarTrackRef = useRef<HTMLInputElement>(null);
    const [previewScroll, setPreviewScroll] = useState<PreviewScroll>({ left: 0, max: 0, viewport: 1, content: 1 });
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
    const selectedTools = tools.filter((tool) => selected.has(tool.id));
    const previewTools: PreviewTool[] = [
        ...selectedTools,
        { id: "more", title: "配置快捷工具", label: "更多", icon: <Ellipsis className="size-4" />, active: true },
    ];

    const syncPreviewScroll = useCallback(() => {
        const toolbar = previewToolbarRef.current;
        if (!toolbar) return;
        setPreviewScroll({
            left: toolbar.scrollLeft,
            max: Math.max(0, toolbar.scrollWidth - toolbar.clientWidth),
            viewport: Math.max(1, toolbar.clientWidth),
            content: Math.max(1, toolbar.scrollWidth),
        });
    }, []);

    const setPreviewScrollLeft = useCallback(
        (left: number) => {
            const toolbar = previewToolbarRef.current;
            if (!toolbar) return;
            toolbar.scrollLeft = left;
            syncPreviewScroll();
        },
        [syncPreviewScroll],
    );

    useEffect(() => {
        if (!open) return;
        const toolbar = previewToolbarRef.current;
        const sync = () => syncPreviewScroll();
        const frames: number[] = [];
        const firstFrame = window.requestAnimationFrame(() => {
            sync();
            frames.push(window.requestAnimationFrame(sync));
        });
        frames.push(firstFrame);
        const timer = window.setTimeout(sync, 120);
        const resizeObserver = typeof ResizeObserver !== "undefined" && toolbar ? new ResizeObserver(sync) : null;
        if (resizeObserver && toolbar) {
            resizeObserver.observe(toolbar);
            toolbar.childNodes.forEach((child) => {
                if (child instanceof Element) resizeObserver.observe(child);
            });
        }
        sync();
        window.addEventListener("resize", syncPreviewScroll);
        return () => {
            frames.forEach((frame) => window.cancelAnimationFrame(frame));
            window.clearTimeout(timer);
            resizeObserver?.disconnect();
            window.removeEventListener("resize", syncPreviewScroll);
        };
    }, [open, selectedIds, showLabels, previewTools.length, syncPreviewScroll]);

    const scrollbarWidth = scrollbarTrackRef.current?.clientWidth || previewScroll.viewport;
    const scrollbarThumbWidth = previewScroll.max > 0 ? Math.min(scrollbarWidth, Math.max(64, (previewScroll.viewport / previewScroll.content) * scrollbarWidth)) : scrollbarWidth;

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
            <DialogContent className="max-w-[760px]">
                <DialogHeader><DialogTitle>自定义工具栏</DialogTitle></DialogHeader>

                <p className="mb-4 text-sm text-muted-foreground">
                    选择你想在图片节点编辑栏中使用的快捷工具。
                </p>

                <Card className="mb-4">
                    <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-1.5 text-sm">
                            <Settings2 className="size-4" />
                            节点预览
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="relative flex min-h-[300px] w-full justify-center pt-20 pb-9">
                            <div
                                ref={previewToolbarRef}
                                className="hide-scrollbar absolute left-2 right-2 top-3 z-10 flex h-12 items-center overflow-x-auto rounded-[18px] border bg-popover px-1 text-[13px] shadow-sm"
                                onScroll={syncPreviewScroll}
                            >
                                {previewTools.map((tool) => (
                                    <PreviewToolbarItem key={tool.id} tool={tool} showLabels={showLabels} />
                                ))}
                            </div>
                            <div
                                className="flex h-48 w-full max-w-[360px] flex-col items-center justify-center rounded-xl border bg-muted text-muted-foreground"
                            >
                                <ImageIcon className="mb-2 size-8" />
                                <span className="text-sm text-muted-foreground">图片节点</span>
                            </div>
                            <input
                                ref={scrollbarTrackRef}
                                type="range"
                                min={0}
                                max={Math.max(previewScroll.max, 1)}
                                value={Math.min(previewScroll.left, Math.max(previewScroll.max, 1))}
                                disabled={previewScroll.max <= 0}
                                className="absolute bottom-4 left-10 right-10 h-2.5 cursor-pointer appearance-none bg-transparent disabled:cursor-default [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-[var(--preview-scrollbar-thumb-width)] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[#8d9498] [&::-moz-range-track]:h-2.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[#bdc4c8] [&::-webkit-slider-runnable-track]:h-2.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[#bdc4c8] [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-[var(--preview-scrollbar-thumb-width)] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#8d9498]"
                                style={{ "--preview-scrollbar-thumb-width": `${scrollbarThumbWidth}px` } as CSSProperties}
                                onInput={(event) => setPreviewScrollLeft(Number(event.currentTarget.value))}
                                onChange={(event) => setPreviewScrollLeft(Number(event.target.value))}
                            />
                        </div>
                    </CardContent>
                </Card>

                <div className="mb-4">
                    <div className="mb-2 flex items-center gap-2">
                        <span className="text-sm font-medium">快捷工具</span>
                        <Tag>{selectedTools.length}/{tools.length}</Tag>
                    </div>
                    <div className="grid w-full gap-3 md:grid-cols-3">
                        {tools.map((tool) => (
                            <div key={tool.id} className="flex items-center gap-2">
                                <Checkbox
                                    id={`tool-${tool.id}`}
                                    checked={selected.has(tool.id)}
                                    onCheckedChange={(checked) => onToggle(tool.id, Boolean(checked))}
                                />
                                <label htmlFor={`tool-${tool.id}`} className="inline-flex items-center gap-2 text-sm">
                                    {tool.icon}
                                    {tool.label}
                                </label>
                            </div>
                        ))}
                    </div>
                </div>

                <DialogFooter className="flex-row items-center justify-between gap-3 sm:justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-sm">显示按钮文字</span>
                        <Switch checked={showLabels} onCheckedChange={onShowLabelsChange} />
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={onCancel}>取消</Button>
                        <Button onClick={onSave}>保存</Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function PreviewToolbarItem({ tool, showLabels }: { tool: PreviewTool; showLabels: boolean }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="flex h-12 shrink-0 items-center px-1.5" style={{ color: tool.danger ? "#ef4444" : undefined }}>
                    <span className={`flex h-9 items-center rounded-lg px-2 ${showLabels ? "gap-2" : "justify-center"}`}>
                        {tool.icon}
                        {showLabels ? <span className="whitespace-nowrap">{tool.label}</span> : null}
                    </span>
                </span>
            </TooltipTrigger>
            <TooltipContent>{tool.title}</TooltipContent>
        </Tooltip>
    );
}
