import { Check, Moon, Sun } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { accentColors } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { type ThemeAccent, type ThemeMode, useThemeStore } from "@/stores/use-theme-store";

const ACCENTS: { key: ThemeAccent; label: string }[] = [
    { key: "neutral", label: "经典" },
    { key: "blue", label: "蓝色" },
    { key: "purple", label: "紫色" },
    { key: "rose", label: "玫红" },
];

export function ThemePicker({ children, className }: { children: React.ReactNode; className?: string }) {
    const mode = useThemeStore((s) => s.theme);
    const accent = useThemeStore((s) => s.accent);
    const setMode = useThemeStore((s) => s.setTheme);
    const setAccent = useThemeStore((s) => s.setAccent);

    return (
        <Popover>
            <PopoverTrigger asChild>
                {children}
            </PopoverTrigger>
            <PopoverContent side="bottom" align="center" sideOffset={8} className={cn("w-52 p-3", className)}>
                <div className="space-y-3">
                    <ModeToggle mode={mode} onChange={setMode} />
                    <div className="h-px bg-border" />
                    <AccentPicker accent={accent} onChange={setAccent} />
                </div>
            </PopoverContent>
        </Popover>
    );
}

function ModeToggle({ mode, onChange }: { mode: ThemeMode; onChange: (m: ThemeMode) => void }) {
    return (
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            <button
                type="button"
                onClick={() => onChange("light")}
                className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                    mode === "light" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
            >
                <Sun className="size-3.5" />
                浅色
            </button>
            <button
                type="button"
                onClick={() => onChange("dark")}
                className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                    mode === "dark" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
            >
                <Moon className="size-3.5" />
                深色
            </button>
        </div>
    );
}

function AccentPicker({ accent, onChange }: { accent: ThemeAccent; onChange: (a: ThemeAccent) => void }) {
    return (
        <div className="space-y-1.5">
            <span className="text-xs text-muted-foreground">主题色</span>
            <div className="flex items-center gap-2">
                {ACCENTS.map(({ key, label }) => (
                    <button
                        key={key}
                        type="button"
                        title={label}
                        onClick={() => onChange(key)}
                        className={cn(
                            "relative flex size-7 items-center justify-center rounded-full transition-all",
                            accent === key ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : "hover:scale-110",
                        )}
                        style={{ backgroundColor: accentColors[key].swatch }}
                    >
                        {accent === key && <Check className="size-3.5 text-white" />}
                    </button>
                ))}
            </div>
        </div>
    );
}
