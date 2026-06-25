import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type TaskProgressProps = {
    progress?: number;
    progressText?: string;
    compact?: boolean;
    className?: string;
};

export function TaskProgress({ progress, progressText, compact = false, className }: TaskProgressProps) {
    if (progress === undefined) {
        return (
            <div className={cn("flex flex-col items-center justify-center gap-2", className)}>
                <LoaderCircle className={cn("animate-spin text-stone-500 dark:text-stone-400", compact ? "size-5" : "size-6")} />
                <span className={cn("text-stone-500 dark:text-stone-400", compact ? "text-[10px]" : "text-sm")}>
                    {progressText || "生成中"}
                </span>
            </div>
        );
    }

    const clamped = Math.min(100, Math.max(0, progress));

    return (
        <div className={cn("flex w-full flex-col items-center justify-center", compact ? "gap-1.5 px-3" : "gap-2 px-4", className)}>
            <LoaderCircle className={cn("animate-spin text-stone-500 dark:text-stone-400", compact ? "size-4" : "size-5")} />
            <div className={cn("w-full", compact ? "max-w-[120px]" : "max-w-[200px]")}>
                <div className={cn("rounded-full bg-stone-200 dark:bg-stone-700", compact ? "h-1" : "h-1.5")}>
                    <div
                        className={cn("rounded-full bg-stone-800 transition-all duration-300 dark:bg-stone-200", compact ? "h-1" : "h-1.5")}
                        style={{ width: `${clamped}%` }}
                    />
                </div>
            </div>
            <div className={cn("flex items-center gap-1.5 text-stone-500 dark:text-stone-400", compact ? "text-[10px]" : "text-xs")}>
                <span>{clamped}%</span>
                {progressText && <span className="truncate">{progressText}</span>}
            </div>
        </div>
    );
}
