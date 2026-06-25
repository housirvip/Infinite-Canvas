"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brush, Eraser, Redo2, RotateCcw, Save, Undo2, X } from "lucide-react";
import { ReactSketchCanvas, type ReactSketchCanvasRef } from "react-sketch-canvas";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { readImageMeta } from "@/lib/image-utils";

const COLOR_PRESETS = ["#000000", "#ffffff", "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899"];

export function CanvasNodeDrawEditDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (blob: Blob) => void }) {
    const canvasRef = useRef<ReactSketchCanvasRef>(null);
    const canvasAreaRef = useRef<HTMLDivElement>(null);

    const [imageMeta, setImageMeta] = useState<{ width: number; height: number } | null>(null);
    const [displaySize, setDisplaySize] = useState<{ width: number; height: number } | null>(null);
    const [isErasing, setIsErasing] = useState(false);
    const [color, setColor] = useState("#ef4444");
    const [brushSize, setBrushSize] = useState(6);

    useEffect(() => {
        if (!open) return;
        setIsErasing(false);
        setColor("#ef4444");
        setBrushSize(6);
        setImageMeta(null);
        setDisplaySize(null);
        void readImageMeta(dataUrl).then(setImageMeta);
    }, [dataUrl, open]);

    useEffect(() => {
        if (!imageMeta || !canvasAreaRef.current) return;
        const maxW = canvasAreaRef.current.clientWidth - 16;
        const maxH = window.innerHeight * 0.68;
        const scale = Math.min(1, maxW / imageMeta.width, maxH / imageMeta.height);
        setDisplaySize({
            width: Math.round(imageMeta.width * scale),
            height: Math.round(imageMeta.height * scale),
        });
    }, [imageMeta]);

    const toggleEraser = useCallback(() => {
        setIsErasing((prev) => {
            const next = !prev;
            canvasRef.current?.eraseMode(next);
            return next;
        });
    }, []);

    const switchToDraw = useCallback(() => {
        setIsErasing(false);
        canvasRef.current?.eraseMode(false);
    }, []);

    const handleUndo = useCallback(() => canvasRef.current?.undo(), []);
    const handleRedo = useCallback(() => canvasRef.current?.redo(), []);
    const handleClear = useCallback(() => canvasRef.current?.clearCanvas(), []);

    const handleSave = useCallback(async () => {
        if (!canvasRef.current || !imageMeta) return;
        const dataURL = await canvasRef.current.exportImage("png", {
            width: imageMeta.width,
            height: imageMeta.height,
        });
        const res = await fetch(dataURL);
        const blob = await res.blob();
        onConfirm(blob);
    }, [imageMeta, onConfirm]);

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) { e.preventDefault(); handleUndo(); }
            if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); handleRedo(); }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [open, handleUndo, handleRedo]);

    return (
        <Dialog open={open && Boolean(dataUrl)} onOpenChange={(v) => { if (!v) onClose(); }}>
            <DialogContent className="max-w-[980px]" aria-describedby={undefined} onPointerDownOutside={(e) => e.preventDefault()}>
                <DialogTitle className="sr-only">编辑绘图</DialogTitle>
                <div className="grid gap-5 lg:grid-cols-[minmax(360px,1fr)_240px]">
                    {/* Canvas area */}
                    <div ref={canvasAreaRef} className="flex min-h-[360px] items-center justify-center rounded-xl border border-black/10 bg-neutral-100 p-2 dark:border-white/10 dark:bg-neutral-900">
                        {displaySize ? (
                            <ReactSketchCanvas
                                ref={canvasRef}
                                width={`${displaySize.width}px`}
                                height={`${displaySize.height}px`}
                                strokeWidth={brushSize}
                                eraserWidth={brushSize}
                                strokeColor={color}
                                canvasColor="transparent"
                                backgroundImage={dataUrl}
                                exportWithBackgroundImage
                                preserveBackgroundImageAspectRatio="none"
                                style={{ borderRadius: 8 }}
                            />
                        ) : null}
                    </div>

                    {/* Toolbar */}
                    <div className="flex min-h-[360px] flex-col gap-4">
                        <div>
                            <h2 className="text-xl font-semibold" aria-hidden="true">编辑绘图</h2>
                            <div className="mt-1 text-sm opacity-60">{imageMeta ? `${imageMeta.width} x ${imageMeta.height}px` : "读取中"}</div>
                        </div>

                        {/* Draw / Erase toggle */}
                        <div className="grid grid-cols-2 gap-2">
                            <Button size="sm" variant={!isErasing ? "default" : "outline"} onClick={switchToDraw}>
                                <Brush className="size-4" />
                                画笔
                            </Button>
                            <Button size="sm" variant={isErasing ? "default" : "outline"} onClick={toggleEraser}>
                                <Eraser className="size-4" />
                                橡皮
                            </Button>
                        </div>

                        {/* Color picker */}
                        <div className="space-y-2">
                            <div className="text-sm font-medium opacity-75">颜色</div>
                            <div className="flex flex-wrap gap-1.5">
                                {COLOR_PRESETS.map((c) => (
                                    <button
                                        key={c}
                                        className="size-6 rounded-full border-2 transition-transform hover:scale-110"
                                        style={{
                                            backgroundColor: c,
                                            borderColor: color === c ? "#3b82f6" : c === "#ffffff" ? "#d4d4d4" : "transparent",
                                        }}
                                        onClick={() => setColor(c)}
                                    />
                                ))}
                                <label className="flex size-6 cursor-pointer items-center justify-center rounded-full border-2 border-dashed border-neutral-300 text-[10px] dark:border-neutral-600">
                                    <input type="color" className="invisible absolute size-0" value={color} onChange={(e) => setColor(e.target.value)} />
                                    <span className="pointer-events-none">+</span>
                                </label>
                            </div>
                        </div>

                        {/* Brush size */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-medium opacity-75">笔刷大小</span>
                                <span className="font-semibold">{brushSize}px</span>
                            </div>
                            <Slider min={2} max={80} step={1} value={[brushSize]} onValueChange={([v]) => setBrushSize(v)} />
                        </div>

                        {/* Undo / Redo / Clear */}
                        <div className="grid grid-cols-3 gap-2">
                            <Button size="sm" variant="outline" onClick={handleUndo} title="撤销 (Ctrl+Z)">
                                <Undo2 className="size-4" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={handleRedo} title="重做 (Ctrl+Y)">
                                <Redo2 className="size-4" />
                            </Button>
                            <Button size="sm" variant="outline" onClick={handleClear} title="清空全部">
                                <RotateCcw className="size-4" />
                            </Button>
                        </div>

                        {/* Save / Cancel */}
                        <div className="mt-auto flex items-center justify-end gap-2">
                            <Button variant="outline" onClick={onClose}>
                                <X className="size-4" />
                                取消
                            </Button>
                            <Button onClick={handleSave}>
                                <Save className="size-4" />
                                保存
                            </Button>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
