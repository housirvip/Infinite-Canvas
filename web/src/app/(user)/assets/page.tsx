import { Copy, Download, PencilLine, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { saveAs } from "file-saver";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tag } from "@/components/ui/tag";
import { Empty } from "@/components/ui/empty";
import { Card, CardContent } from "@/components/ui/card";
import { message } from "@/lib/message";
import { useCopyText } from "@/hooks/use-copy-text";
import { formatBytes, readFileAsDataUrl } from "@/lib/image-utils";
import { uploadImage } from "@/services/image-storage";
import { cn } from "@/lib/utils";
import { useAssetStore, type Asset, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
};

type ImageDraft = ImageAsset["data"] | null;

const kindOptions = [
    { label: "全部", value: "all" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
];

export default function AssetsPage() {
    const copyText = useCopyText();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);

    // Form field states (replacing Form.useWatch / Form.useForm)
    const [formTitle, setFormTitle] = useState("");
    const [formCoverUrl, setFormCoverUrl] = useState("");
    const [formTags, setFormTags] = useState<string[]>([]);
    const [formSource, setFormSource] = useState("");
    const [formNote, setFormNote] = useState("");
    const [formContent, setFormContent] = useState("");
    const [formTagInput, setFormTagInput] = useState("");

    const validAssets = useMemo(() => assets.filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video"), [assets]);

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return validAssets.filter((asset) => {
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        });
    }, [validAssets, keyword, kindFilter]);

    const visibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [filteredAssets.length, pageSize]);

    const resetForm = (values: AssetFormValues) => {
        setFormKind(values.kind);
        setFormTitle(values.title);
        setFormCoverUrl(values.coverUrl);
        setFormTags(values.tags);
        setFormSource(values.source || "");
        setFormNote(values.note || "");
        setFormContent(values.content || "");
        setFormTagInput("");
    };

    const openCreate = () => {
        setEditingAsset(null);
        setImageDraft(null);
        resetForm({ kind: "text", title: "", coverUrl: "", tags: [], source: "手动添加", note: "", content: "" });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setImageDraft(asset.kind === "image" ? asset.data : null);
        resetForm({
            kind: asset.kind,
            title: asset.title,
            coverUrl: asset.coverUrl,
            tags: asset.tags || [],
            source: asset.source,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setIsAssetOpen(true);
    };

    const saveAsset = async () => {
        // Validate
        if (!formTitle.trim()) {
            message.error("请输入标题");
            return;
        }
        if (formKind === "text" && !formContent.trim()) {
            message.error("请输入文本内容");
            return;
        }

        const base = {
            title: formTitle.trim(),
            coverUrl: formCoverUrl?.trim() || (formKind === "image" && imageDraft ? imageDraft.dataUrl : ""),
            tags: formTags || [],
            source: formSource?.trim(),
            note: formNote?.trim(),
            metadata: editingAsset?.metadata || { source: "manual" },
        };

        if (formKind === "text") {
            const asset = { ...base, kind: "text" as const, data: { content: formContent.trim() } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else {
            if (!imageDraft) {
                message.error("请选择图片文件");
                return;
            }
            const asset = { ...base, kind: "image" as const, data: imageDraft };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        }

        message.success(editingAsset ? "素材已更新" : "素材已保存");
        setIsAssetOpen(false);
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        setFormCoverUrl(dataUrl);
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith("image/")) return;
        const image = await uploadImage(file);
        const draft = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
        setImageDraft(draft);
        if (!formCoverUrl) setFormCoverUrl(draft.dataUrl);
        if (!formTitle) setFormTitle(file.name);
    };

    const copyAssetText = async (asset: Asset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, "文本已复制");
    };

    const downloadImage = (asset: Asset) => {
        if (asset.kind !== "image" && asset.kind !== "video") return;
        saveAs(asset.kind === "video" ? asset.data.url : asset.data.dataUrl, `${asset.title || "asset"}.${asset.data.mimeType.split("/")[1] || "png"}`);
    };

    const exportAllAssets = async () => {
        if (!validAssets.length) {
            message.warning("暂无素材可导出");
            return;
        }
        await exportAssets(validAssets);
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        try {
            const importedAssets = await readAssetPackage(file);
            importedAssets.forEach((asset) => {
                const payload = { ...asset } as Record<string, unknown>;
                delete payload.id;
                delete payload.createdAt;
                delete payload.updatedAt;
                addAsset(payload as Parameters<typeof addAsset>[0]);
            });
            message.success(`已导入 ${importedAssets.length} 个素材`);
        } catch {
            message.error("导入失败，请选择有效的素材压缩包");
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const confirmDelete = () => {
        if (!deletingAsset) return;
        removeAsset(deletingAsset.id);
        message.success("素材已删除");
        setDeletingAsset(null);
    };

    const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" || e.key === "," || e.key === "，") {
            e.preventDefault();
            const value = formTagInput.trim().replace(/[,，]/g, "");
            if (value && !formTags.includes(value)) {
                setFormTags([...formTags, value]);
            }
            setFormTagInput("");
        }
    };

    const removeTag = (tagToRemove: string) => {
        setFormTags(formTags.filter((t) => t !== tagToRemove));
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-900 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto bg-dot-grid px-6 py-8">
                <div className="pb-8">
                    <div className="mx-auto max-w-6xl text-center">
                        <h1 className="text-4xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">我的素材</h1>
                        <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">收藏常用文本和图片，按类型、标题和标签快速查找。</p>
                    </div>

                    <div className="mx-auto mt-8 w-full max-w-2xl">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                            <Input
                                className="h-10 pl-9"
                                value={keyword}
                                placeholder="搜索标题、内容、标签或来源"
                                onChange={(event) => {
                                    setPage(1);
                                    setKeyword(event.target.value);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        setPage(1);
                                        setKeyword((event.target as HTMLInputElement).value);
                                    }
                                }}
                            />
                        </div>
                    </div>

                    <div className="mx-auto mt-6 grid max-w-6xl gap-3 text-left">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="grid gap-2 sm:grid-cols-[56px_minmax(0,1fr)] sm:items-center">
                                <div className="text-xs font-medium text-stone-500 dark:text-stone-400">类型</div>
                                <div className="flex flex-wrap gap-2">
                                    {kindOptions.map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            className={cn(
                                                "prompt-filter-tag cursor-pointer",
                                                kindFilter === option.value && "is-active",
                                            )}
                                            onClick={() => {
                                                setPage(1);
                                                setKindFilter(option.value as AssetKind | "all");
                                            }}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-4">
                                <button
                                    type="button"
                                    className="cursor-pointer text-sm font-medium text-stone-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline dark:text-stone-300"
                                    onClick={() => void exportAllAssets()}
                                >
                                    导出素材
                                </button>
                                <button
                                    type="button"
                                    className="cursor-pointer text-sm font-medium text-stone-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline dark:text-stone-300"
                                    onClick={() => assetInputRef.current?.click()}
                                >
                                    导入素材
                                </button>
                                <button
                                    type="button"
                                    className="cursor-pointer text-sm font-medium text-stone-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline dark:text-stone-300"
                                    onClick={openCreate}
                                >
                                    新增素材
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mx-auto flex max-w-7xl flex-col gap-5">
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {visibleAssets.map((asset, index) => (
                            <motion.div
                                key={asset.id}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3, delay: index * 0.04, ease: "easeOut" }}
                            >
                                <AssetCard asset={asset} onOpen={() => setPreviewAsset(asset)} onEdit={() => openEdit(asset)} onCopy={copyAssetText} onDownload={downloadImage} onDelete={() => setDeletingAsset(asset)} />
                            </motion.div>
                        ))}
                    </div>

                    {!visibleAssets.length ? <Empty description="没有找到素材" className="py-20" /> : null}

                    <div className="flex items-center justify-center gap-2">
                        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
                        <span className="text-sm text-muted-foreground">{page} / {Math.ceil(filteredAssets.length / pageSize) || 1}</span>
                        <Button variant="outline" size="sm" disabled={page >= Math.ceil(filteredAssets.length / pageSize)} onClick={() => setPage(page + 1)}>下一页</Button>
                        <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                            <SelectTrigger className="w-[80px] h-8">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="10">10</SelectItem>
                                <SelectItem value="20">20</SelectItem>
                                <SelectItem value="50">50</SelectItem>
                                <SelectItem value="100">100</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </main>

            <Dialog open={isAssetOpen} onOpenChange={(v) => !v && setIsAssetOpen(false)}>
                <DialogContent className="max-w-[980px]">
                    <DialogHeader>
                        <DialogTitle>{editingAsset ? "编辑素材" : "新增素材"}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label>类型</Label>
                                <Select value={formKind} onValueChange={(value) => setFormKind(value as AssetKind)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="text">文本</SelectItem>
                                        <SelectItem value="image">图片</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>标题 <span className="text-destructive">*</span></Label>
                                <Input className="h-10" placeholder="给素材起一个容易检索的名字" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label>封面 URL</Label>
                                <div className="flex">
                                    <Input className="rounded-r-none" placeholder="可粘贴图片 URL，也可以上传本地封面" value={formCoverUrl} onChange={(e) => setFormCoverUrl(e.target.value)} />
                                    <Button variant="outline" className="rounded-l-none border-l-0" onClick={() => coverInputRef.current?.click()}>
                                        <Upload className="size-3.5 mr-1" />
                                        上传
                                    </Button>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>标签</Label>
                                <div className="flex flex-wrap gap-1.5 rounded-md border border-input p-2 min-h-[38px]">
                                    {formTags.map((tag) => (
                                        <span key={tag} className="inline-flex items-center gap-1 rounded bg-stone-100 px-2 py-0.5 text-xs dark:bg-stone-800">
                                            {tag}
                                            <button type="button" className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200" onClick={() => removeTag(tag)}>&times;</button>
                                        </span>
                                    ))}
                                    <input
                                        className="flex-1 min-w-[80px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                                        placeholder="输入标签后回车"
                                        value={formTagInput}
                                        onChange={(e) => setFormTagInput(e.target.value)}
                                        onKeyDown={handleTagInputKeyDown}
                                    />
                                </div>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>来源</Label>
                                    <Input placeholder="手动添加 / 画布 / 提示词库" value={formSource} onChange={(e) => setFormSource(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label>备注</Label>
                                    <Input placeholder="可选" value={formNote} onChange={(e) => setFormNote(e.target.value)} />
                                </div>
                            </div>
                            {formKind === "text" ? (
                                <div className="space-y-2">
                                    <Label>文本内容 <span className="text-destructive">*</span></Label>
                                    <textarea
                                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 min-h-[200px] resize-y"
                                        rows={8}
                                        placeholder="保存提示词、说明文案、参考描述等文本素材"
                                        value={formContent}
                                        onChange={(e) => setFormContent(e.target.value)}
                                    />
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <Label>图片内容 <span className="text-destructive">*</span></Label>
                                    <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                        <Button variant="outline" onClick={() => imageInputRef.current?.click()}>
                                            <Upload className="size-4 mr-1" />
                                            选择图片文件
                                        </Button>
                                        {imageDraft ? (
                                            <span className="ml-3 text-xs text-muted-foreground">
                                                {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)}
                                            </span>
                                        ) : (
                                            <span className="ml-3 text-xs text-muted-foreground">
                                                未选择图片
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950">
                            <p className="font-semibold text-sm">预览</p>
                            <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
                                {formCoverUrl || imageDraft?.dataUrl ? (
                                    <img src={formCoverUrl || imageDraft?.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                                ) : (
                                    <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{formContent || "暂无封面"}</div>
                                )}
                                <div className="p-4">
                                    <p className="font-semibold text-sm truncate">
                                        {formTitle || "未命名素材"}
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {formTags.length ? (
                                            formTags.map((tag) => (
                                                <Tag key={tag} className="m-0">
                                                    {tag}
                                                </Tag>
                                            ))
                                        ) : (
                                            <Tag className="m-0">未打标签</Tag>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <input
                        ref={coverInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                            void readCoverFile(event.target.files?.[0]);
                            event.target.value = "";
                        }}
                    />
                    <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                            void readImageFile(event.target.files?.[0]);
                            event.target.value = "";
                        }}
                    />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAssetOpen(false)}>取消</Button>
                        <Button onClick={() => void saveAsset()}>保存</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AssetDrawer asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadImage} />

            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />

            <Dialog open={Boolean(deletingAsset)} onOpenChange={(v) => !v && setDeletingAsset(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>删除素材</DialogTitle>
                    </DialogHeader>
                    <p>确定删除「{deletingAsset?.title}」吗？删除后会从我的素材中移除。</p>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeletingAsset(null)}>取消</Button>
                        <Button variant="destructive" onClick={confirmDelete}>删除</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function AssetCard({ asset, onOpen, onEdit, onCopy, onDownload, onDelete }: { asset: Asset; onOpen: () => void; onEdit: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void; onDelete: () => void }) {
    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    const summary = assetSummary(asset);
    return (
        <Card className="overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
            <CardContent className="p-0">
                <button type="button" className="block w-full text-left" onClick={onOpen}>
                    {cover ? (
                        <img src={cover} alt={asset.title} className="aspect-[4/3] w-full object-cover" />
                    ) : (
                        <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm leading-6 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{asset.kind === "text" ? asset.data.content : "暂无封面"}</div>
                    )}
                </button>
                <button type="button" className="block w-full text-left" onClick={onOpen}>
                    <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{asset.title}</h2>
                                <span className="mt-1 block text-xs text-muted-foreground">
                                    {asset.source || "未标注来源"}
                                </span>
                            </div>
                            <Tag className="m-0 shrink-0 text-[11px]">{asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : "文本"}</Tag>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-muted-foreground line-clamp-3">
                            {summary}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                            {(asset.tags || []).slice(0, 3).map((tag) => (
                                <Tag key={tag} className="m-0 text-[11px]">
                                    {tag}
                                </Tag>
                            ))}
                            {!asset.tags?.length ? <Tag className="m-0 text-[11px]">无标签</Tag> : null}
                        </div>
                    </div>
                </button>
                <div className="flex items-center gap-2 px-4 pb-4">
                    <Button variant="outline" size="sm" onClick={onOpen}>
                        查看
                    </Button>
                    {asset.kind !== "video" ? (
                        <Button variant="outline" size="sm" onClick={onEdit}>
                            <PencilLine className="size-3.5 mr-1" />
                            编辑
                        </Button>
                    ) : null}
                    {asset.kind === "text" ? (
                        <Button variant="outline" size="sm" onClick={() => void onCopy(asset)}>
                            <Copy className="size-3.5 mr-1" />
                            复制
                        </Button>
                    ) : null}
                    {asset.kind === "image" || asset.kind === "video" ? (
                        <Button variant="outline" size="sm" onClick={() => onDownload(asset)}>
                            <Download className="size-3.5 mr-1" />
                            下载
                        </Button>
                    ) : null}
                    <Button variant="destructive" size="sm" onClick={onDelete}>
                        <Trash2 className="size-3.5 mr-1" />
                        删除
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: Asset | null; onClose: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void }) {
    const cover = asset ? asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "") : "";
    return (
        <Sheet open={Boolean(asset)} onOpenChange={(v) => !v && onClose()}>
            <SheetContent side="right" className="w-[720px] overflow-y-auto">
                <SheetHeader>
                    <SheetTitle>素材详情</SheetTitle>
                </SheetHeader>
                {asset ? (
                    <div className="space-y-5 mt-4">
                        {cover ? (
                            <img src={cover} alt={asset.title} className="rounded-lg max-w-full" />
                        ) : (
                            <div className="rounded-lg border border-stone-200 bg-stone-50 p-5 text-sm leading-6 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">{asset.kind === "text" ? asset.data.content : "暂无封面"}</div>
                        )}
                        <div>
                            <h4 className="text-lg font-semibold mb-2">
                                {asset.title}
                            </h4>
                            <div className="flex flex-wrap gap-1">
                                <Tag>{asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : "文本"}</Tag>
                                {(asset.tags || []).map((tag) => (
                                    <Tag key={tag}>{tag}</Tag>
                                ))}
                            </div>
                        </div>
                        <div className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                            <span className="block text-xs text-muted-foreground">
                                内容
                            </span>
                            {asset.kind === "text" ? (
                                <p className="mt-2 whitespace-pre-wrap">{asset.data.content}</p>
                            ) : asset.kind === "video" ? (
                                <video src={asset.data.url} controls className="mt-2 aspect-video w-full rounded-lg bg-black" />
                            ) : (
                                <span className="mt-2 block">
                                    {asset.data.width}x{asset.data.height} · {formatBytes(asset.data.bytes)} · {asset.data.mimeType}
                                </span>
                            )}
                        </div>
                        {asset.note ? (
                            <div>
                                <span className="text-sm text-muted-foreground">备注</span>
                                <p className="mt-1">{asset.note}</p>
                            </div>
                        ) : null}
                        <div className="flex items-center gap-2">
                            {asset.kind === "text" ? (
                                <Button onClick={() => onCopy(asset)}>
                                    <Copy className="size-4 mr-1" />
                                    复制文本
                                </Button>
                            ) : null}
                            {asset.kind === "image" || asset.kind === "video" ? (
                                <Button onClick={() => onDownload(asset)}>
                                    <Download className="size-4 mr-1" />
                                    {asset.kind === "video" ? "下载视频" : "下载图片"}
                                </Button>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </SheetContent>
        </Sheet>
    );
}

function assetSummary(asset: Asset) {
    if (asset.kind === "text") return asset.data.content;
    return `${asset.data.width}x${asset.data.height} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
}

function assetSearchText(asset: Asset) {
    return [asset.title, asset.source || "", asset.note || "", (asset.tags || []).join(" "), asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}
