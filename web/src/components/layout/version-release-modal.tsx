import type { CSSProperties } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tag } from "@/components/ui/tag";
import { useVersionCheck } from "@/hooks/use-version-check";
import { APP_VERSION } from "@/constant/env";

function getTagVariant(type: string): "default" | "primary" | "destructive" | "secondary" {
    if (type === "新增") return "primary";
    if (type === "修复") return "destructive";
    if (type === "调整") return "secondary";
    if (type === "文档") return "secondary";
    return "default";
}

function getReleaseTitle(version: string) {
    return version === "Unreleased" ? "未发布" : version;
}

type VersionReleaseModalProps = {
    className?: string;
    style?: CSSProperties;
};

export function VersionReleaseModal({ className, style }: VersionReleaseModalProps) {
    const { open, setOpen, openReleaseModal, latestVersion, releases, checking, hasNewVersion, checkLatestRelease } = useVersionCheck();

    return (
        <>
            <button
                type="button"
                className={className || "shrink-0 cursor-pointer text-xs font-medium text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white"}
                style={style}
                onClick={openReleaseModal}
                title="查看版本更新"
            >
                <span className="relative inline-flex">
                    {APP_VERSION}
                    {hasNewVersion ? <span className="absolute -right-1.5 -top-1 size-1.5 rounded-full bg-green-500" /> : null}
                </span>
            </button>
            <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
                <DialogContent className="max-w-[680px]">
                    <DialogHeader>
                        <DialogTitle>版本更新</DialogTitle>
                    </DialogHeader>
                    <div className="mb-5 grid grid-cols-2 gap-3">
                        <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <div className="text-xs text-stone-500 dark:text-stone-400">当前版本</div>
                            <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{APP_VERSION}</div>
                        </div>
                        <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-xs text-stone-500 dark:text-stone-400">最新版本</div>
                                <button
                                    type="button"
                                    className="cursor-pointer bg-transparent p-0 text-[11px] font-normal text-stone-400 underline-offset-2 transition hover:text-stone-700 hover:underline dark:text-stone-500 dark:hover:text-stone-300"
                                    onClick={() => void checkLatestRelease(true)}
                                >
                                    {checking ? "检查中..." : "检查更新"}
                                </button>
                            </div>
                            <div className="mt-1 text-base font-semibold text-stone-950 dark:text-stone-100">{latestVersion}</div>
                        </div>
                    </div>
                    <div className="max-h-[56vh] overflow-y-auto pr-2">
                        <div className="space-y-4 border-l-2 border-border pl-4">
                            {releases.map((release) => (
                                <div key={release.version} className="relative">
                                    <div className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-primary" />
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-semibold text-stone-950 dark:text-stone-100">{getReleaseTitle(release.version)}</span>
                                            <span className="text-xs text-stone-500 dark:text-stone-400">{release.date}</span>
                                            <div className="flex min-w-0 items-center gap-1.5">
                                                {release.version === latestVersion ? <Tag variant="primary">最新</Tag> : null}
                                                {release.version === APP_VERSION ? <Tag>当前</Tag> : null}
                                            </div>
                                        </div>
                                        <div className="mt-2 space-y-1.5">
                                            {release.items.map((item, index) => (
                                                <div key={`${release.version}-${index}`} className="flex items-start gap-2 text-sm leading-6 text-stone-700 dark:text-stone-300">
                                                    <Tag variant={getTagVariant(item.type)} className="mt-0.5 shrink-0 whitespace-nowrap">
                                                        {item.type}
                                                    </Tag>
                                                    <span className="min-w-0 flex-1">{item.content}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
