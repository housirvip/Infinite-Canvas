import { type CSSProperties, type ReactNode, useState } from "react";
import { BookOpen, Keyboard, Settings2 } from "lucide-react";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { GitHubLink } from "@/components/layout/github-link";
import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DOCS_URL } from "@/constant/env";
import { cn } from "@/lib/utils";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useRunningHubStore } from "@/stores/use-runninghub-store";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
};

const btnBase = "inline-flex shrink-0 items-center justify-center rounded-lg text-sm font-medium transition-all outline-none select-none active:translate-y-px [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4 !h-8 !w-8 !min-w-8 !p-0";

function StatusButton({ label, hovered, onHover, style, hoverStyle, className, onClick, href, children }: {
    label: string;
    hovered: string | null;
    onHover: (id: string | null) => void;
    style: CSSProperties;
    hoverStyle: CSSProperties;
    className?: string;
    onClick?: () => void;
    href?: string;
    children: ReactNode;
}) {
    const isHovered = hovered === label;
    const currentStyle = isHovered ? hoverStyle : style;
    const props = {
        className: cn(btnBase, className),
        style: currentStyle,
        onMouseEnter: () => onHover(label),
        onMouseLeave: () => onHover(null),
        "aria-label": label,
    };

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                {href ? (
                    <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                ) : (
                    <button type="button" {...props} onClick={onClick}>{children}</button>
                )}
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>{label}</TooltipContent>
        </Tooltip>
    );
}

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts }: UserStatusActionsProps) {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const openRunningHubDialog = useRunningHubStore((state) => state.openDialog);
    const canvasTheme = canvasThemes[theme];
    const [hovered, setHovered] = useState<string | null>(null);

    const baseStyle: CSSProperties = variant === "canvas" ? { color: canvasTheme.toolbar.item } : {};
    const hoverStyle: CSSProperties = variant === "canvas"
        ? { color: canvasTheme.toolbar.activeText, background: canvasTheme.toolbar.itemHover }
        : { background: "var(--color-muted)" };

    return (
        <div className="inline-flex shrink-0 items-center gap-0.5">
            <StatusButton label="文档" hovered={hovered} onHover={setHovered} style={baseStyle} hoverStyle={hoverStyle} href={DOCS_URL}>
                <BookOpen className="size-4" />
            </StatusButton>
            {showConfig ? (
                <StatusButton label="配置" hovered={hovered} onHover={setHovered} style={baseStyle} hoverStyle={hoverStyle} onClick={() => openConfigDialog(false)}>
                    <Settings2 className="size-4" />
                </StatusButton>
            ) : null}
            <StatusButton label="RunningHub" hovered={hovered} onHover={setHovered} style={baseStyle} hoverStyle={hoverStyle} onClick={openRunningHubDialog}>
                <span className="text-xs font-bold leading-none" aria-hidden="true">RH</span>
            </StatusButton>
            <Tooltip>
                <TooltipTrigger asChild>
                    <AnimatedThemeToggler
                        theme={theme}
                        onThemeChange={setTheme}
                        className={btnBase}
                        style={hovered === "theme" ? hoverStyle : baseStyle}
                        onMouseEnter={() => setHovered("theme")}
                        onMouseLeave={() => setHovered(null)}
                        aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
                    />
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>{theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        onMouseEnter={() => setHovered("version")}
                        onMouseLeave={() => setHovered(null)}
                    >
                        <VersionReleaseModal className={cn(btnBase, "!w-auto !min-w-8 !px-2 text-xs")} style={hovered === "version" ? hoverStyle : baseStyle} />
                    </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>查看版本更新</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        onMouseEnter={() => setHovered("github")}
                        onMouseLeave={() => setHovered(null)}
                    >
                        <GitHubLink className={cn(btnBase, "!rounded-lg")} style={hovered === "github" ? hoverStyle : baseStyle} />
                    </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>GitHub</TooltipContent>
            </Tooltip>
            {onOpenShortcuts ? (
                <StatusButton label="快捷键" hovered={hovered} onHover={setHovered} style={baseStyle} hoverStyle={hoverStyle} onClick={onOpenShortcuts}>
                    <Keyboard className="size-4" />
                </StatusButton>
            ) : null}
        </div>
    );
}
