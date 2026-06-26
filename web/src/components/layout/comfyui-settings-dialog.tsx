import { useRef, useState } from "react";
import { nanoid } from "nanoid";
import { ArrowDown, ArrowUp, Download, Plus, Search, Settings2, Trash2, Upload as UploadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { message } from "@/lib/message";
import { COMFYUI_PARAM_ROLE_OPTIONS, detectWorkflowFormat, parseComfyUIWorkflow, suggestComfyUIParamLabel, suggestComfyUIParamRole, type ComfyUIParam, type ComfyUIParamRole, type ComfyUIPreset, type ParsedComfyUINode } from "@/lib/comfyui";
import { useComfyUIStore } from "@/stores/use-comfyui-store";

export function ComfyUIConfigModal() {
    const [editingPreset, setEditingPreset] = useState<ComfyUIPreset | null>(null);
    const [apiKeyDraft, setApiKeyDraft] = useState("");
    const [serverUrlDraft, setServerUrlDraft] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isOpen = useComfyUIStore((state) => state.isOpen);
    const setOpen = useComfyUIStore((state) => state.setOpen);
    const presets = useComfyUIStore((state) => state.presets);
    const hasApiKey = useComfyUIStore((state) => state.hasApiKey);
    const serverUrl = useComfyUIStore((state) => state.serverUrl);
    const saveConfig = useComfyUIStore((state) => state.saveConfig);
    const setPresets = useComfyUIStore((state) => state.setPresets);
    const fetchConfigFromServer = useComfyUIStore((state) => state.fetchConfigFromServer);

    const updatePresets = async (nextPresets: ComfyUIPreset[]) => {
        setPresets(nextPresets);
        try {
            await saveConfig({ presets: nextPresets });
            return true;
        } catch {
            message.error("预设保存失败");
            await fetchConfigFromServer();
            return false;
        }
    };

    const addPreset = () => {
        setEditingPreset({ id: nanoid(), name: "新预设", workflowJson: "", outputType: "auto", params: [] });
    };

    const deletePreset = async (id: string) => {
        const ok = await updatePresets(presets.filter((p) => p.id !== id));
        if (ok) message.success("预设已删除");
    };

    const savePreset = async (preset: ComfyUIPreset) => {
        const exists = presets.some((p) => p.id === preset.id);
        const nextPresets = exists ? presets.map((p) => (p.id === preset.id ? preset : p)) : [...presets, preset];
        const ok = await updatePresets(nextPresets);
        if (ok) {
            setEditingPreset(null);
            message.success(exists ? "预设已更新" : "预设已添加");
        }
    };

    const handleExport = () => {
        const data = { comfyuiPresets: presets };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "comfyui-config.json";
        link.click();
        URL.revokeObjectURL(url);
        message.success("配置已导出");
    };

    const handleImport = (file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result as string);
                if (Array.isArray(data.comfyuiPresets)) {
                    const valid = data.comfyuiPresets.filter(
                        (p: unknown) => p && typeof p === "object" && "id" in p && "workflowJson" in p,
                    );
                    void (async () => {
                        const ok = await updatePresets(valid);
                        if (ok) message.success(`已导入 ${valid.length} 个预设`);
                    })();
                } else {
                    message.warning("配置文件中未找到预设数据");
                }
            } catch {
                message.error("配置文件格式错误");
            }
        };
        reader.readAsText(file);
    };

    const handleSaveServerUrl = async () => {
        const nextUrl = (serverUrlDraft ?? serverUrl).trim();
        await saveConfig({ serverUrl: nextUrl });
        setServerUrlDraft(null);
        message.success("ComfyUI 服务器地址已保存");
    };

    const handleSaveApiKey = async () => {
        const nextApiKey = apiKeyDraft.trim();
        if (!nextApiKey && !hasApiKey) {
            message.warning("请输入 API Key");
            return;
        }
        await saveConfig({ apiKey: nextApiKey });
        setApiKeyDraft("");
        message.success(nextApiKey ? "API Key 已保存" : "API Key 已清除");
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={(v) => !v && setOpen(false)}>
                <DialogContent className="max-w-[860px]">
                    <DialogHeader>
                        <DialogTitle>ComfyUI 配置</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-sm font-semibold">服务器配置</div>
                                    <div className="mt-1 text-xs text-stone-500">连接到自建的 ComfyUI 服务器，直接提交工作流 JSON 执行。</div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" onClick={handleExport} disabled={!presets.length}>
                                        <Download className="size-3.5" />
                                        导出
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                                        <UploadIcon className="size-3.5" />
                                        导入
                                    </Button>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".json"
                                        className="hidden"
                                        onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            if (file) handleImport(file);
                                            event.target.value = "";
                                        }}
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>服务器地址</Label>
                                <div className="flex gap-2">
                                    <Input
                                        value={serverUrlDraft ?? serverUrl}
                                        placeholder="http://localhost:8188"
                                        onChange={(event) => setServerUrlDraft(event.target.value)}
                                        onKeyDown={(event) => { if (event.key === "Enter") void handleSaveServerUrl(); }}
                                    />
                                    <Button onClick={() => void handleSaveServerUrl()}>
                                        保存
                                    </Button>
                                </div>
                            </div>
                            <div className="mt-3 space-y-2">
                                <Label>API Key（可选）</Label>
                                <div className="flex gap-2">
                                    <Input
                                        type="password"
                                        value={apiKeyDraft}
                                        placeholder={hasApiKey ? "已保存（输入新值覆盖，留空不修改）" : "如果 ComfyUI 启用了认证，输入 API Key"}
                                        onChange={(event) => setApiKeyDraft(event.target.value)}
                                        onKeyDown={(event) => { if (event.key === "Enter") void handleSaveApiKey(); }}
                                    />
                                    <Button onClick={() => void handleSaveApiKey()}>
                                        保存 Key
                                    </Button>
                                </div>
                            </div>
                        </section>

                        <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <div className="mb-3 flex items-center justify-between">
                                <div>
                                    <div className="text-sm font-semibold">工作流预设</div>
                                    <div className="mt-1 text-xs text-stone-500">保存常用的 ComfyUI 工作流 JSON，在画布节点中快速选择执行。请使用 ComfyUI 的「Export (API Format)」导出的 JSON。</div>
                                </div>
                                <Button size="sm" onClick={addPreset}>
                                    <Plus className="size-3.5" />
                                    新增
                                </Button>
                            </div>

                            {presets.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-stone-300 py-8 text-center text-xs text-stone-400 dark:border-stone-700">暂无预设，点击"新增"添加</div>
                            ) : (
                                <div className="space-y-2">
                                    {presets.map((preset) => (
                                        <div key={preset.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-medium">{preset.name}</div>
                                                <div className="mt-0.5 text-xs text-stone-500">
                                                    输出: {preset.outputType === "image" ? "图片" : preset.outputType === "video" ? "视频" : preset.outputType === "audio" ? "音频" : "自动"} · {preset.params?.length || 0} 参数 · JSON: {preset.workflowJson.length} 字符
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button variant="outline" size="sm" onClick={() => setEditingPreset({ ...preset, params: preset.params?.map((p) => ({ ...p })) || [] })}>
                                                    <Settings2 className="size-3.5" />
                                                    编辑
                                                </Button>
                                                <Button variant="destructive" size="sm" onClick={() => void deletePreset(preset.id)}>
                                                    <Trash2 className="size-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    </div>
                    <DialogFooter>
                        <Button onClick={() => setOpen(false)}>
                            完成
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {editingPreset ? <PresetEditorModal preset={editingPreset} onSave={(p) => void savePreset(p)} onCancel={() => setEditingPreset(null)} /> : null}
        </>
    );
}

type PendingComfyUIImportRow = ParsedComfyUINode & { role: ComfyUIParamRole; label: string };

function PresetEditorModal({ preset, onSave, onCancel }: { preset: ComfyUIPreset; onSave: (preset: ComfyUIPreset) => void; onCancel: () => void }) {
    const [draft, setDraft] = useState<ComfyUIPreset>({ ...preset, params: preset.params?.map((p) => ({ ...p })) || [] });
    const [pendingImport, setPendingImport] = useState<PendingComfyUIImportRow[] | null>(null);
    const jsonFileRef = useRef<HTMLInputElement>(null);

    const updateParam = (index: number, patch: Partial<ComfyUIParam>) => {
        const params = [...draft.params];
        params[index] = { ...params[index], ...patch };
        setDraft((d) => ({ ...d, params }));
    };

    const addParam = () => {
        setDraft((d) => ({ ...d, params: [...d.params, { nodeId: "", fieldName: "", role: "fixed", label: "新参数", order: d.params.length, defaultValue: "" }] }));
    };

    const removeParam = (index: number) => {
        setDraft((d) => ({ ...d, params: d.params.filter((_, i) => i !== index) }));
    };

    const moveParam = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= draft.params.length) return;
        const params = [...draft.params];
        [params[index], params[target]] = [params[target], params[index]];
        params.forEach((p, i) => { p.order = i; });
        setDraft((d) => ({ ...d, params }));
    };

    const handleParseWorkflow = () => {
        if (!draft.workflowJson.trim()) {
            message.warning("请先粘贴工作流 JSON");
            return;
        }
        try {
            const nodes = parseComfyUIWorkflow(draft.workflowJson);
            if (!nodes.length) {
                message.warning("未解析到可编辑的节点参数");
                return;
            }
            const rows: PendingComfyUIImportRow[] = nodes.map((node) => {
                const role = suggestComfyUIParamRole(node);
                return { ...node, role, label: suggestComfyUIParamLabel(node, role) };
            });
            setPendingImport(rows);
        } catch {
            message.error("JSON 解析失败");
        }
    };

    const handleConfirmImport = () => {
        if (!pendingImport) return;
        const params: ComfyUIParam[] = pendingImport.map((row, index) => ({
            nodeId: row.nodeId,
            fieldName: row.fieldName,
            role: row.role,
            label: row.label,
            defaultValue: row.role !== "ignore" ? row.fieldValue : undefined,
            description: `${row.classType}.${row.fieldName}`,
            order: index,
        }));
        setDraft((d) => ({ ...d, params }));
        setPendingImport(null);
        const counts = { prompt: 0, image: 0, video: 0, audio: 0, number: 0, string: 0, boolean: 0, fixed: 0, ignore: 0 };
        params.forEach((p) => counts[p.role]++);
        message.success(`已导入 ${params.length} 个参数：${counts.prompt} 提示词、${counts.image} 图片、${counts.video} 视频、${counts.audio} 音频、${counts.number} 数字、${counts.string} 字符串、${counts.boolean} 开关、${counts.fixed} 固定、${counts.ignore} 忽略`);
    };

    const updateImportRow = (index: number, patch: Partial<PendingComfyUIImportRow>) => {
        if (!pendingImport) return;
        const rows = [...pendingImport];
        rows[index] = { ...rows[index], ...patch };
        if (patch.role && !patch.label) {
            rows[index].label = suggestComfyUIParamLabel(rows[index], patch.role);
        }
        setPendingImport(rows);
    };

    const handleSave = () => {
        if (!draft.name.trim()) {
            message.warning("请输入预设名称");
            return;
        }
        if (!draft.workflowJson.trim()) {
            message.warning("请粘贴工作流 JSON");
            return;
        }
        try {
            JSON.parse(draft.workflowJson);
        } catch {
            message.error("工作流 JSON 格式无效");
            return;
        }
        onSave(draft);
    };

    const handleFileImport = (file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            const content = reader.result as string;
            try {
                JSON.parse(content);
                setDraft((d) => ({ ...d, workflowJson: content }));
                message.success("已导入工作流 JSON");
            } catch {
                message.error("文件内容不是有效的 JSON");
            }
        };
        reader.readAsText(file);
    };

    return (
        <Dialog open onOpenChange={(v) => !v && onCancel()}>
            <DialogContent className="max-w-[800px]" style={{ maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
                <DialogHeader>
                    <DialogTitle>编辑预设</DialogTitle>
                </DialogHeader>
                <div className="thin-scrollbar flex-1 space-y-4 overflow-y-auto" style={{ maxHeight: "70vh" }}>
                    {/* Basic info */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label>预设名称</Label>
                            <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="例如：文生图 SDXL" />
                        </div>
                        <div className="space-y-2">
                            <Label>输出类型</Label>
                            <Select value={draft.outputType} onValueChange={(v) => setDraft((d) => ({ ...d, outputType: v as ComfyUIPreset["outputType"] }))}>
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="auto">自动检测</SelectItem>
                                    <SelectItem value="image">图片</SelectItem>
                                    <SelectItem value="video">视频</SelectItem>
                                    <SelectItem value="audio">音频</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Workflow JSON */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label>工作流 JSON</Label>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={() => jsonFileRef.current?.click()}>
                                    <UploadIcon className="size-3.5" />
                                    从文件导入
                                </Button>
                                <Button variant="outline" size="sm" onClick={handleParseWorkflow} disabled={!draft.workflowJson.trim()}>
                                    <Search className="size-3.5" />
                                    解析节点
                                </Button>
                                <input
                                    ref={jsonFileRef}
                                    type="file"
                                    accept=".json"
                                    className="hidden"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) handleFileImport(file);
                                        event.target.value = "";
                                    }}
                                />
                            </div>
                        </div>
                        <textarea
                            className="h-40 w-full resize-none rounded-md border bg-stone-50 px-3 py-2 font-mono text-xs dark:bg-stone-900"
                            placeholder="粘贴 ComfyUI 工作流 JSON（支持 Web UI 保存格式和 API 格式）..."
                            value={draft.workflowJson}
                            onChange={(e) => setDraft((d) => ({ ...d, workflowJson: e.target.value }))}
                        />
                        {draft.workflowJson.trim() ? (
                            <div className="text-xs text-stone-400">
                                {(() => {
                                    try {
                                        const parsed = JSON.parse(draft.workflowJson);
                                        const format = detectWorkflowFormat(draft.workflowJson);
                                        const nodeCount = format === "webui" ? parsed.nodes?.length || 0 : Object.keys(parsed).length;
                                        const formatLabel = format === "webui" ? "Web UI 格式" : "API 格式";
                                        return `有效 JSON · ${formatLabel} · ${nodeCount} 个节点`;
                                    } catch {
                                        return <span className="text-red-500">JSON 格式无效</span>;
                                    }
                                })()}
                            </div>
                        ) : null}
                    </div>

                    {/* Pending import review */}
                    {pendingImport ? (
                        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-800 dark:bg-blue-950/20">
                            <div className="mb-2 flex items-center justify-between">
                                <div className="text-sm font-semibold">解析到 {pendingImport.length} 个参数</div>
                                <div className="flex gap-2">
                                    <Button variant="outline" size="sm" onClick={() => setPendingImport(null)}>取消</Button>
                                    <Button size="sm" onClick={handleConfirmImport}>确认导入</Button>
                                </div>
                            </div>
                            <div className="text-xs text-stone-500 mb-2">请确认每个参数的角色和标签，然后点击"确认导入"。</div>
                            <div className="thin-scrollbar max-h-48 space-y-1.5 overflow-y-auto">
                                {pendingImport.map((row, index) => (
                                    <div key={`${row.nodeId}-${row.fieldName}`} className="flex items-center gap-2 rounded border border-stone-200 bg-white px-2 py-1.5 text-xs dark:border-stone-700 dark:bg-stone-900">
                                        <span className="w-8 shrink-0 text-stone-400" title={`节点 ${row.nodeId}`}>#{row.nodeId}</span>
                                        <span className="w-24 shrink-0 truncate text-stone-500" title={row.classType}>{row.classType}</span>
                                        <span className="w-20 shrink-0 truncate font-mono" title={row.fieldName}>{row.fieldName}</span>
                                        <span className="w-20 shrink-0 truncate text-stone-400" title={row.fieldValue}>
                                            {row.fieldValue.length > 15 ? row.fieldValue.slice(0, 15) + "…" : row.fieldValue}
                                        </span>
                                        <Select value={row.role} onValueChange={(v) => updateImportRow(index, { role: v as ComfyUIParamRole })}>
                                            <SelectTrigger className="h-7 w-24 text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {COMFYUI_PARAM_ROLE_OPTIONS.map((opt) => (
                                                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Input
                                            className="h-7 min-w-0 flex-1 text-xs"
                                            value={row.label}
                                            onChange={(e) => updateImportRow(index, { label: e.target.value })}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {/* Params editor */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label>参数列表 ({draft.params.length})</Label>
                            <Button variant="outline" size="sm" onClick={addParam}>
                                <Plus className="size-3.5" />
                                手动添加
                            </Button>
                        </div>
                        {draft.params.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-stone-300 py-4 text-center text-xs text-stone-400 dark:border-stone-700">
                                暂无参数，点击上方"解析节点"从工作流 JSON 中提取，或"手动添加"
                            </div>
                        ) : (
                            <div className="thin-scrollbar max-h-56 space-y-1.5 overflow-y-auto">
                                {draft.params.map((param, index) => (
                                    <div key={index} className="flex items-center gap-1.5 rounded border border-stone-200 px-2 py-1.5 text-xs dark:border-stone-800">
                                        <Input className="h-7 w-14 text-xs" placeholder="节点ID" value={param.nodeId} onChange={(e) => updateParam(index, { nodeId: e.target.value })} />
                                        <Input className="h-7 w-20 text-xs" placeholder="字段名" value={param.fieldName} onChange={(e) => updateParam(index, { fieldName: e.target.value })} />
                                        <Select value={param.role} onValueChange={(v) => updateParam(index, { role: v as ComfyUIParamRole })}>
                                            <SelectTrigger className="h-7 w-24 text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {COMFYUI_PARAM_ROLE_OPTIONS.map((opt) => (
                                                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Input className="h-7 w-24 text-xs" placeholder="标签" value={param.label} onChange={(e) => updateParam(index, { label: e.target.value })} />
                                        {param.role === "fixed" || param.role === "boolean" || param.role === "number" || param.role === "string" ? (
                                            <Input className="h-7 w-20 text-xs" placeholder="默认值" value={param.defaultValue || ""} onChange={(e) => updateParam(index, { defaultValue: e.target.value })} />
                                        ) : (
                                            <div className="w-20" />
                                        )}
                                        <Button variant="ghost" size="icon" className="!size-7" disabled={index === 0} onClick={() => moveParam(index, -1)}>
                                            <ArrowUp className="size-3" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="!size-7" disabled={index === draft.params.length - 1} onClick={() => moveParam(index, 1)}>
                                            <ArrowDown className="size-3" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="!size-7 text-red-400 hover:text-red-500" onClick={() => removeParam(index)}>
                                            <Trash2 className="size-3" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onCancel}>取消</Button>
                    <Button onClick={handleSave}>保存</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
