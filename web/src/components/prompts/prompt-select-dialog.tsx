import { Check, Search } from "lucide-react";
import { type UIEvent, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Spin } from "@/components/ui/spin";
import { message } from "@/lib/message";

import { ALL_PROMPTS_OPTION } from "@/services/api/prompts";
import { cn } from "@/lib/utils";
import { PromptCard } from "./prompt-card";
import { usePromptList } from "./use-prompt-list";

export function PromptSelectDialog({ open, onOpenChange, onSelect }: { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (prompt: string) => void }) {
    const [keyword, setKeyword] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const { query, items, tags: promptTags, categories: promptCategories } = usePromptList({ keyword, tags: selectedTags, category: selectedCategory, enabled: open });
    const toggleTag = (tag: string) => {
        if (tag === ALL_PROMPTS_OPTION) return setSelectedTags([]);
        setSelectedTags((items) => (items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]));
    };
    const selectPrompt = (prompt: string) => {
        onSelect(prompt);
        onOpenChange(false);
    };

    useEffect(() => {
        if (query.isError) message.error(query.error instanceof Error ? query.error.message : "获取提示词失败");
    }, [query.error, query.isError]);

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[1040px]">
                <DialogHeader>
                    <DialogTitle>提示词库</DialogTitle>
                </DialogHeader>
                <div data-canvas-no-zoom onWheelCapture={(event) => event.stopPropagation()}>
                    <div className="mx-auto max-w-2xl">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                            <Input className="pl-9" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="按标题查询" />
                        </div>
                    </div>
                    <div className="mt-5 grid gap-3">
                        <div className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-start">
                            <div className="pt-2 text-xs font-medium text-stone-500 dark:text-stone-400">分类</div>
                            <div className="flex flex-wrap gap-2">
                                {promptCategories.map((category) => (
                                    <button
                                        key={category}
                                        type="button"
                                        className={cn(
                                            "cursor-pointer rounded-md border px-2.5 py-1 text-xs transition",
                                            selectedCategory === category
                                                ? "border-primary bg-primary/10 text-primary"
                                                : "border-stone-200 text-stone-600 hover:border-stone-300 hover:text-stone-900 dark:border-stone-700 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:text-stone-200"
                                        )}
                                        onClick={() => setSelectedCategory(category)}
                                    >
                                        {category}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-start">
                            <div className="pt-2 text-xs font-medium text-stone-500 dark:text-stone-400">标签</div>
                            <div className="flex flex-wrap gap-2">
                                {promptTags.map((tag) => {
                                    const active = tag === ALL_PROMPTS_OPTION ? selectedTags.length === 0 : selectedTags.includes(tag);
                                    return (
                                        <button
                                            key={tag}
                                            type="button"
                                            className={cn(
                                                "cursor-pointer rounded-md border px-2.5 py-1 text-xs transition",
                                                active
                                                    ? "border-primary bg-primary/10 text-primary"
                                                    : "border-stone-200 text-stone-600 hover:border-stone-300 hover:text-stone-900 dark:border-stone-700 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:text-stone-200"
                                            )}
                                            onClick={() => toggleTag(tag)}
                                        >
                                            {tag}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                    <div className="thin-scrollbar mt-6 max-h-[520px] overflow-y-auto pr-2" data-canvas-no-zoom onScroll={handleListScroll} onWheelCapture={(event) => event.stopPropagation()}>
                        {query.isLoading ? (
                            <div className="flex h-40 items-center justify-center">
                                <Spin />
                            </div>
                        ) : null}
                        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                            {items.map((item) => (
                                <PromptCard key={item.id} item={item} onOpen={() => selectPrompt(item.prompt)} onCopy={() => selectPrompt(item.prompt)} actionLabel="使用此提示词" actionIcon={<Check className="size-3.5" />} actionType="primary" />
                            ))}
                        </div>
                        {!query.isLoading && items.length === 0 ? <Empty description="没有找到匹配的提示词" className="py-8" /> : null}
                        {query.isFetchingNextPage ? (
                            <div className="py-4 text-center">
                                <Spin size="sm" />
                            </div>
                        ) : null}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
