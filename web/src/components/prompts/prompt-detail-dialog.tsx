import { Copy, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tag } from "@/components/ui/tag";

import { formatPromptDate, type Prompt } from "@/services/api/prompts";

export function PromptDetailDialog({ prompt, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    return (
        <Dialog open={Boolean(prompt)} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-[860px]">
                <DialogHeader>
                    <DialogTitle>{prompt?.title}</DialogTitle>
                </DialogHeader>
                {prompt ? (
                    <div className="grid gap-5 md:grid-cols-[300px_minmax(0,1fr)]">
                        <div className="space-y-3">
                            <img src={prompt.coverUrl} alt={prompt.title} className="aspect-[4/3] w-full rounded-lg object-cover" />
                            {prompt.preview ? <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{prompt.preview}</pre> : null}
                        </div>
                        <div className="min-w-0">
                            <div className="flex flex-wrap gap-1.5">
                                {prompt.tags.map((tag) => (
                                    <Tag key={tag}>
                                        {tag}
                                    </Tag>
                                ))}
                            </div>
                            <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-stone-800 dark:text-stone-300">{prompt.prompt}</p>
                            <div className="mt-4 text-xs text-stone-500 dark:text-stone-400">
                                创建：{formatPromptDate(prompt.createdAt)} · 更新：{formatPromptDate(prompt.updatedAt)}
                            </div>
                            <div className="mt-5 flex flex-wrap items-center gap-2">
                                <Button onClick={() => onCopy(prompt.prompt)}>
                                    <Copy className="size-4" />
                                    复制提示词
                                </Button>
                                {onSaveAsset ? (
                                    <Button variant="outline" onClick={() => onSaveAsset(prompt)}>
                                        <FolderPlus className="size-4" />
                                        加入我的素材
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
