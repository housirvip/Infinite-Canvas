import { ArrowRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { message } from "@/lib/message";
import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { navigationTools } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";

function Highlighter({ action, color, children }: { action: "highlight" | "underline"; color: string; children: ReactNode }) {
    return (
        <span className="relative inline-block px-1">
            {action === "highlight" ? (
                <span className="absolute inset-x-0 bottom-0 top-1 rounded-sm opacity-45" style={{ backgroundColor: color }} />
            ) : (
                <span className="absolute inset-x-0 bottom-0 h-1 rounded-full opacity-80" style={{ backgroundColor: color }} />
            )}
            <span className="relative font-medium text-foreground">{children}</span>
        </span>
    );
}

export default function IndexPage() {
    const [primaryTool] = navigationTools;
    const [promptShowcase, setPromptShowcase] = useState<Prompt[]>([]);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);

    useEffect(() => {
        void fetchPrompts({ pageSize: 12 })
            .then((data) => setPromptShowcase(data.items))
            .catch((error) => message.error(error instanceof Error ? error.message : "获取提示词失败"));
    }, []);

    return (
        <main className="relative h-full overflow-y-auto bg-background bg-dot-grid text-stone-950 dark:text-stone-100">
            <section className="relative mx-auto min-h-[calc(100vh-4rem)] max-w-7xl overflow-hidden px-6">
                <div className="relative flex min-h-[620px] flex-col items-center justify-center pt-10 text-center">
                    <motion.h1
                        className="ai-title-aurora max-w-5xl text-balance text-5xl font-semibold leading-tight tracking-normal sm:text-7xl lg:text-8xl"
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                    >
                        无限画布
                    </motion.h1>
                    <motion.p
                        className="mt-8 max-w-3xl text-balance text-lg leading-8 text-stone-500 dark:text-stone-400"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
                    >
                        在
                        <Highlighter action="underline" color="#78716c">
                            无限画布
                        </Highlighter>
                        中生成、连接和重组
                        <Highlighter action="highlight" color="#d6d3d1">
                            图片、文字与图形
                        </Highlighter>
                        ，让创作从单次生成变成连续推演。
                    </motion.p>
                    <motion.div
                        className="mt-10 flex flex-wrap items-center justify-center gap-3"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: 0.3, ease: "easeOut" }}
                    >
                        <Button variant="brand" size="lg" asChild>
                            <a href={`/${primaryTool.slug}`}>
                                开始使用 <ArrowRight className="size-4" />
                            </a>
                        </Button>
                        <Button variant="outline" size="lg" asChild>
                            <a href="/canvas">打开画布</a>
                        </Button>
                    </motion.div>
                </div>

                <section className="relative mx-auto mb-20 max-w-6xl border-t border-stone-200 pt-12 dark:border-stone-800">
                    <div className="mb-8 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-start">
                        <div />
                        <div className="max-w-2xl text-center">
                            <h2 className="text-3xl font-semibold text-stone-950 dark:text-stone-100">沉淀每一次好结果</h2>
                            <p className="mt-3 text-base leading-7 text-stone-500 dark:text-stone-400">收藏稳定出图的提示词、参考风格和结果图片，让下一次创作从已有经验开始。</p>
                        </div>
                        <Button variant="link" className="justify-self-center md:justify-self-end" asChild>
                            <a href="/prompts">
                                查看提示词库 <ArrowRight className="size-4" />
                            </a>
                        </Button>
                    </div>
                    <div className="grid auto-rows-[210px] gap-4 md:grid-cols-4">
                        {promptShowcase.map((item, index) => (
                            <motion.button
                                key={item.id}
                                type="button"
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.35, delay: index * 0.04, ease: "easeOut" }}
                                onClick={() => {
                                    setPreviewIndex(index);
                                    setPreviewOpen(true);
                                }}
                                className={cn(
                                    "group relative cursor-pointer overflow-hidden rounded-lg border border-stone-200 bg-stone-100 text-left transition-shadow duration-200 hover:shadow-lg hover:ring-2 hover:ring-stone-400/40 dark:border-stone-800 dark:bg-stone-900",
                                    index === 0 && "md:col-span-2 md:row-span-2",
                                    index === 3 && "md:col-span-2",
                                )}
                            >
                                <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent p-4 text-white">
                                    <div className="mb-2 flex flex-wrap gap-1.5">
                                        {item.tags.slice(0, 2).map((tag) => (
                                            <Tag key={tag} className="m-0 bg-white/15 text-[11px] text-white backdrop-blur">
                                                {tag}
                                            </Tag>
                                        ))}
                                    </div>
                                    <h3 className="text-sm font-medium">{item.title}</h3>
                                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/75">{item.prompt}</p>
                                </div>
                            </motion.button>
                        ))}
                    </div>
                </section>
            </section>
            {previewOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setPreviewOpen(false)}>
                    <img src={promptShowcase[previewIndex]?.coverUrl} alt="" className="max-h-[90vh] max-w-[90vw] object-contain" />
                </div>
            )}
        </main>
    );
}
