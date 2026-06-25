import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Minus, Plus, SplitSquareHorizontal, X } from "lucide-react";
import { ReactCompareSlider, ReactCompareSliderImage } from "react-compare-slider";

import type { CanvasNodeData } from "../types";

type CanvasImageViewerProps = {
    node: CanvasNodeData;
    inputImageUrl?: string;
    onClose: () => void;
};

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;

export function CanvasImageViewer({ node, inputImageUrl, onClose }: CanvasImageViewerProps) {
    const [scale, setScale] = useState(1);
    const [comparing, setComparing] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const imageUrl = node.metadata?.content || "";

    const zoomIn = () => setScale((s) => Math.min(ZOOM_MAX, s + ZOOM_STEP));
    const zoomOut = () => setScale((s) => Math.max(ZOOM_MIN, s - ZOOM_STEP));
    const resetZoom = () => setScale(1);

    const handleWheel = useCallback((e: WheelEvent) => {
        e.preventDefault();
        setScale((s) => {
            const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
            return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s + delta));
        });
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        container.addEventListener("wheel", handleWheel, { passive: false });
        return () => container.removeEventListener("wheel", handleWheel);
    }, [handleWheel]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            if (e.key === "=" || e.key === "+") zoomIn();
            if (e.key === "-") zoomOut();
            if (e.key === "0") resetZoom();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    const handleDownload = () => {
        const a = document.createElement("a");
        a.href = imageUrl;
        a.download = node.title || "image";
        a.click();
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    };

    const zoomPercent = Math.round(scale * 100);

    return (
        <div
            ref={containerRef}
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/80"
            onClick={handleBackdropClick}
        >
            {/* Image area — no overflow-hidden so zoom doesn't clip */}
            <div
                className="relative rounded-xl border border-white/20 shadow-2xl"
                style={{
                    transform: `scale(${scale})`,
                    transformOrigin: "center center",
                    transition: "transform 150ms ease",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {comparing && inputImageUrl ? (
                    <ReactCompareSlider
                        itemOne={
                            <ReactCompareSliderImage
                                src={inputImageUrl}
                                alt="输入"
                                style={{ width: "100%", height: "100%", objectFit: "contain" }}
                            />
                        }
                        itemTwo={
                            <ReactCompareSliderImage
                                src={imageUrl}
                                alt="输出"
                                style={{ width: "100%", height: "100%", objectFit: "contain" }}
                            />
                        }
                        style={{
                            width: "min(90vw, 1200px)",
                            height: "75vh",
                            borderRadius: "0.75rem",
                        }}
                    />
                ) : (
                    <img
                        src={imageUrl}
                        alt={node.title || "图片"}
                        className="block rounded-xl"
                        style={{
                            maxWidth: "90vw",
                            maxHeight: "75vh",
                            objectFit: "contain",
                        }}
                        draggable={false}
                    />
                )}
            </div>

            {/* Bottom toolbar */}
            <div
                className="mt-4 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1.5 backdrop-blur-sm"
                onClick={(e) => e.stopPropagation()}
            >
                <ToolbarButton onClick={zoomOut} disabled={scale <= ZOOM_MIN} title="缩小">
                    <Minus className="size-4" />
                </ToolbarButton>
                <button
                    className="min-w-[48px] rounded px-2 py-1 text-xs font-medium text-white/80 hover:bg-white/10"
                    onClick={resetZoom}
                    title="重置缩放"
                >
                    {zoomPercent}%
                </button>
                <ToolbarButton onClick={zoomIn} disabled={scale >= ZOOM_MAX} title="放大">
                    <Plus className="size-4" />
                </ToolbarButton>

                <Divider />

                <ToolbarButton onClick={handleDownload} title="下载">
                    <Download className="size-4" />
                </ToolbarButton>
                <ToolbarButton
                    onClick={() => setComparing((v) => !v)}
                    disabled={!inputImageUrl}
                    active={comparing}
                    title={inputImageUrl ? "对比" : "无前置图片可对比"}
                >
                    <SplitSquareHorizontal className="size-4" />
                </ToolbarButton>

                <Divider />

                <ToolbarButton onClick={onClose} title="关闭">
                    <X className="size-4" />
                </ToolbarButton>
            </div>
        </div>
    );
}

function ToolbarButton({ children, onClick, disabled, active, title }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; active?: boolean; title?: string }) {
    return (
        <button
            className={`flex size-8 items-center justify-center rounded-full transition-colors ${active ? "bg-white/25 text-white" : "text-white/75 hover:bg-white/15 hover:text-white"} ${disabled ? "pointer-events-none opacity-30" : ""}`}
            onClick={onClick}
            disabled={disabled}
            title={title}
        >
            {children}
        </button>
    );
}

function Divider() {
    return <div className="mx-1 h-4 w-px bg-white/20" />;
}
