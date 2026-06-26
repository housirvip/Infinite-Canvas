import { ArrowDown, ArrowUp, ClipboardPaste, Download, Plus, Settings2, Trash2, Upload as UploadIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { message } from "@/lib/message";
import { createRunningHubWorkflow, parseCurlCommand, suggestParamLabel, suggestParamRole, PARAM_ROLE_OPTIONS, type ParsedCurlNode, type RunningHubParam, type RunningHubParamRole, type RunningHubWorkflow } from "@/lib/runninghub";
import { useRunningHubStore } from "@/stores/use-runninghub-store";

type PendingImportRow = ParsedCurlNode & { role: RunningHubParamRole; label: string };

export function RunningHubConfigModal() {
    const [editingWorkflow, setEditingWorkflow] = useState<RunningHubWorkflow | null>(null);
    const [editingTarget, setEditingTarget] = useState<"app" | "comfyui">("app");
    const [workflowTab, setWorkflowTab] = useState<"app" | "comfyui">("app");
    const [apiKeyDraft, setApiKeyDraft] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isOpen = useRunningHubStore((state) => state.isOpen);
    const setOpen = useRunningHubStore((state) => state.setOpen);
    const workflows = useRunningHubStore((state) => state.workflows);
    const comfyuiWorkflows = useRunningHubStore((state) => state.comfyuiWorkflows);
    const hasApiKey = useRunningHubStore((state) => state.hasApiKey);
    const baseUrl = useRunningHubStore((state) => state.baseUrl);
    const saveConfig = useRunningHubStore((state) => state.saveConfig);
    const setWorkflows = useRunningHubStore((state) => state.setWorkflows);
    const setComfyuiWorkflows = useRunningHubStore((state) => state.setComfyuiWorkflows);
    const fetchConfigFromServer = useRunningHubStore((state) => state.fetchConfigFromServer);

    const activeWorkflows = workflowTab === "app" ? workflows : comfyuiWorkflows;

    const updateWorkflows = async (nextWorkflows: RunningHubWorkflow[]) => {
        if (workflowTab === "app") {
            setWorkflows(nextWorkflows);
            try {
                await saveConfig({ workflows: nextWorkflows });
                return true;
            } catch {
                message.error("工作流保存失败");
                await fetchConfigFromServer();
                return false;
            }
        } else {
            setComfyuiWorkflows(nextWorkflows);
            try {
                await saveConfig({ comfyuiWorkflows: nextWorkflows });
                return true;
            } catch {
                message.error("工作流保存失败");
                await fetchConfigFromServer();
                return false;
            }
        }
    };

    const addWorkflow = () => {
        setEditingTarget(workflowTab);
        setEditingWorkflow(createRunningHubWorkflow());
    };

    const deleteWorkflow = async (id: string) => {
        const ok = await updateWorkflows(activeWorkflows.filter((workflow) => workflow.id !== id));
        if (ok) {
            message.success("工作流已删除");
        }
    };

    const saveWorkflow = async (workflow: RunningHubWorkflow) => {
        const targetList = editingTarget === "app" ? workflows : comfyuiWorkflows;
        const exists = targetList.some((item) => item.id === workflow.id);
        const nextWorkflows = exists ? targetList.map((item) => (item.id === workflow.id ? workflow : item)) : [...targetList, workflow];
        const prevTab = workflowTab;
        setWorkflowTab(editingTarget);
        if (editingTarget === "app") {
            setWorkflows(nextWorkflows);
            try {
                await saveConfig({ workflows: nextWorkflows });
                setEditingWorkflow(null);
                message.success(exists ? "工作流已更新" : "工作流已添加");
            } catch {
                message.error("工作流保存失败");
                await fetchConfigFromServer();
                setWorkflowTab(prevTab);
            }
        } else {
            setComfyuiWorkflows(nextWorkflows);
            try {
                await saveConfig({ comfyuiWorkflows: nextWorkflows });
                setEditingWorkflow(null);
                message.success(exists ? "工作流已更新" : "工作流已添加");
            } catch {
                message.error("工作流保存失败");
                await fetchConfigFromServer();
                setWorkflowTab(prevTab);
            }
        }
    };

    const handleExport = () => {
        const data = { runninghubWorkflows: activeWorkflows };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "runninghub-config.json";
        link.click();
        URL.revokeObjectURL(url);
        message.success("配置已导出");
    };

    const handleImport = (file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result as string);
                if (Array.isArray(data.runninghubWorkflows)) {
                    const valid = data.runninghubWorkflows.filter(
                        (workflow: unknown) => workflow && typeof workflow === "object" && "id" in workflow && "workflowId" in workflow && Array.isArray((workflow as Record<string, unknown>).params),
                    );
                    void (async () => {
                        const ok = await updateWorkflows(valid);
                        if (ok) {
                            message.success(`已导入 ${valid.length} 个工作流${valid.length < data.runninghubWorkflows.length ? `（${data.runninghubWorkflows.length - valid.length} 个格式异常已跳过）` : ""}`);
                        }
                    })();
                } else {
                    message.warning("配置文件中未找到工作流数据");
                }
            } catch {
                message.error("配置文件格式错误");
            }
        };
        reader.readAsText(file);
    };

    const handleSaveApiKey = async () => {
        const nextApiKey = apiKeyDraft.trim();
        if (!nextApiKey && !hasApiKey) {
            message.warning("请输入 RunningHub API Key");
            return;
        }
        await saveConfig({ apiKey: nextApiKey });
        setApiKeyDraft("");
        message.success(nextApiKey ? "RunningHub API Key 已保存" : "RunningHub API Key 已清除");
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={(v) => !v && setOpen(false)}>
                <DialogContent className="max-w-[860px]">
                    <DialogHeader>
                        <DialogTitle>RunningHub 工作流</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-sm font-semibold">RunningHub 配置</div>
                                    <div className="mt-1 text-xs text-stone-500">独立管理 RunningHub API Key 和 ComfyUI 工作流，画布 RunningHub 节点会读取这里的配置。</div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" onClick={handleExport} disabled={!activeWorkflows.length}>
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
                                <Label>API Key</Label>
                                <div className="flex gap-2">
                                    <Input
                                        type="password"
                                        value={apiKeyDraft}
                                        placeholder={hasApiKey ? "已保存（输入新值覆盖，留空不修改）" : "输入 RunningHub API Key"}
                                        onChange={(event) => setApiKeyDraft(event.target.value)}
                                        onKeyDown={(event) => { if (event.key === "Enter") void handleSaveApiKey(); }}
                                    />
                                    <Button onClick={() => void handleSaveApiKey()}>
                                        保存 Key
                                    </Button>
                                </div>
                            </div>
                            <div className="mt-3 space-y-2">
                                <Label>服务版本</Label>
                                <Select
                                    value={baseUrl || "https://www.runninghub.cn"}
                                    onValueChange={(value) => void saveConfig({ baseUrl: value })}
                                >
                                    <SelectTrigger className="h-8 w-full text-sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="https://www.runninghub.cn">国内版 (runninghub.cn)</SelectItem>
                                        <SelectItem value="https://www.runninghub.ai">国际版 (runninghub.ai)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </section>

                        <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <div className="mb-3 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <button
                                        className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${workflowTab === "app" ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "text-stone-500 hover:text-stone-700 dark:hover:text-stone-300"}`}
                                        onClick={() => setWorkflowTab("app")}
                                    >
                                        App 工作流
                                    </button>
                                    <button
                                        className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${workflowTab === "comfyui" ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "text-stone-500 hover:text-stone-700 dark:hover:text-stone-300"}`}
                                        onClick={() => setWorkflowTab("comfyui")}
                                    >
                                        ComfyUI 工作流
                                    </button>
                                </div>
                                <Button size="sm" onClick={addWorkflow}>
                                    <Plus className="size-3.5" />
                                    新增
                                </Button>
                            </div>

                            <div className="mb-2 text-xs text-stone-500">
                                {workflowTab === "app"
                                    ? "App 工作流使用 RunningHub Webapp ID 调用已发布的 AI 应用。"
                                    : "ComfyUI 工作流使用 RunningHub 工作流 ID 直接执行 ComfyUI 工作流。"}
                            </div>

                            {activeWorkflows.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-stone-300 py-8 text-center text-xs text-stone-400 dark:border-stone-700">暂无工作流，点击"新增"添加</div>
                            ) : (
                                <div className="space-y-2">
                                    {activeWorkflows.map((workflow) => {
                                        const promptCount = workflow.params.filter((param) => param.role === "prompt").length;
                                        const imageCount = workflow.params.filter((param) => param.role === "image").length;
                                        const videoCount = workflow.params.filter((param) => param.role === "video").length;
                                        const boolCount = workflow.params.filter((param) => param.role === "boolean").length;
                                        const numCount = workflow.params.filter((param) => param.role === "number").length;
                                        const strCount = workflow.params.filter((param) => param.role === "string").length;
                                        return (
                                            <div key={workflow.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800">
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-medium">{workflow.name}</div>
                                                    <div className="mt-0.5 text-xs text-stone-500">
                                                        ID: {workflow.workflowId || "未配置"} · {promptCount} 提示词 · {imageCount} 图片 · {videoCount} 视频 · {boolCount} 开关 · {numCount} 数字 · {strCount} 字符串 · {workflow.instanceType}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Button variant="outline" size="sm" onClick={() => { setEditingTarget(workflowTab); setEditingWorkflow({ ...workflow, params: workflow.params.map((param) => ({ ...param })) }); }}>
                                                        <Settings2 className="size-3.5" />
                                                        编辑
                                                    </Button>
                                                    <Button variant="destructive" size="sm" onClick={() => void deleteWorkflow(workflow.id)}>
                                                        <Trash2 className="size-3.5" />
                                                    </Button>
                                                </div>
                                            </div>
                                        );
                                    })}
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

            {editingWorkflow ? <WorkflowEditorModal workflow={editingWorkflow} onSave={(workflow) => void saveWorkflow(workflow)} onCancel={() => setEditingWorkflow(null)} /> : null}
        </>
    );
}

function WorkflowEditorModal({ workflow, onSave, onCancel }: { workflow: RunningHubWorkflow; onSave: (workflow: RunningHubWorkflow) => void; onCancel: () => void }) {
    const [draft, setDraft] = useState<RunningHubWorkflow>({ ...workflow, params: workflow.params.map((param) => ({ ...param })) });
    const [curlText, setCurlText] = useState("");
    const [showCurlImport, setShowCurlImport] = useState(!workflow.workflowId);
    const [pendingImport, setPendingImport] = useState<PendingImportRow[] | null>(null);

    const update = <K extends keyof RunningHubWorkflow>(key: K, value: RunningHubWorkflow[K]) => {
        setDraft((current) => ({ ...current, [key]: value }));
    };

    const updateParam = (index: number, patch: Partial<RunningHubParam>) => {
        const params = [...draft.params];
        params[index] = { ...params[index], ...patch };
        update("params", params);
    };

    const addParam = () => {
        update("params", [...draft.params, { nodeId: "", fieldName: "", role: "fixed", label: "新参数", order: draft.params.length, defaultValue: "" }]);
    };

    const removeParam = (index: number) => {
        update("params", draft.params.filter((_, paramIndex) => paramIndex !== index));
    };

    const moveParam = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= draft.params.length) return;
        const params = [...draft.params];
        [params[index], params[target]] = [params[target], params[index]];
        params.forEach((param, paramIndex) => {
            param.order = paramIndex;
        });
        update("params", params);
    };

    const handleParseCurl = () => {
        const text = curlText.trim();
        if (!text) {
            message.warning("请粘贴 curl 命令");
            return;
        }
        const parsed = parseCurlCommand(text);
        if (!parsed) {
            message.error("无法解析，请确认包含 RunningHub API 调用地址");
            return;
        }
        if (!parsed.rawNodes.length) {
            message.warning("未解析到节点参数");
            return;
        }

        update("workflowId", parsed.workflowId);
        update("instanceType", parsed.instanceType);

        const rows: PendingImportRow[] = parsed.rawNodes.map((node) => {
            const role = suggestParamRole(node);
            return { ...node, role, label: suggestParamLabel(node, role) };
        });
        setPendingImport(rows);
    };

    const handleConfirmImport = () => {
        if (!pendingImport) return;
        const params: RunningHubParam[] = pendingImport.map((row, index) => ({
            nodeId: row.nodeId,
            fieldName: row.fieldName,
            role: row.role,
            label: row.label,
            defaultValue: row.role === "fixed" || row.role === "boolean" || row.role === "number" || row.role === "string" ? row.fieldValue : undefined,
            description: row.description,
            enumOptions: row.enumOptions?.length ? row.enumOptions : undefined,
            order: index,
        }));
        update("params", params);
        setPendingImport(null);
        setCurlText("");
        setShowCurlImport(false);
        const counts = { prompt: 0, image: 0, video: 0, audio: 0, boolean: 0, number: 0, string: 0, fixed: 0, ignore: 0 };
        params.forEach((param) => counts[param.role]++);
        message.success(`已导入 ${params.length} 个参数：${counts.prompt} 提示词、${counts.image} 图片、${counts.video} 视频、${counts.audio} 音频、${counts.boolean} 开关、${counts.number} 数字、${counts.string} 字符串、${counts.fixed} 固定`);
    };

    const updateImportRow = (index: number, patch: Partial<PendingImportRow>) => {
        if (!pendingImport) return;
        const rows = [...pendingImport];
        rows[index] = { ...rows[index], ...patch };
        if (patch.role && !patch.label) {
            rows[index].label = suggestParamLabel(rows[index], patch.role);
        }
        setPendingImport(rows);
    };

    return (
        <Dialog open onOpenChange={(v) => !v && onCancel()}>
            <DialogContent className="max-w-[720px]" style={{ maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
                <DialogHeader>
                    <DialogTitle>编辑工作流</DialogTitle>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto" style={{ maxHeight: "70vh" }}>
                    <div className="mt-4 space-y-4">
                        <div className="rounded-lg border border-dashed border-blue-300 bg-blue-50/50 p-3 dark:border-blue-800 dark:bg-blue-950/20">
                            <div className="mb-2 flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-300">
                                    <ClipboardPaste className="size-3.5" />
                                    从 RunningHub 粘贴 curl 命令导入
                                </div>
                                <button type="button" className="text-xs text-blue-600 hover:underline dark:text-blue-400" onClick={() => { setShowCurlImport(!showCurlImport); setPendingImport(null); }}>
                                    {showCurlImport ? "收起" : "展开"}
                                </button>
                            </div>
                            {showCurlImport && !pendingImport ? (
                                <>
                                    <textarea
                                        rows={4}
                                        className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        value={curlText}
                                        onChange={(event) => setCurlText(event.target.value)}
                                        placeholder="粘贴从 RunningHub「调用 API」页面复制的 curl 命令..."
                                    />
                                    <Button size="sm" className="mt-2" disabled={!curlText.trim()} onClick={handleParseCurl}>
                                        <ClipboardPaste className="size-3.5" />
                                        解析
                                    </Button>
                                </>
                            ) : null}
                            {pendingImport ? (
                                <div className="mt-2">
                                    <div className="mb-2 text-xs font-medium">解析到 {pendingImport.length} 个节点，请为每个节点指定角色：</div>
                                    <div className="space-y-1.5">
                                        {pendingImport.map((row, index) => (
                                            <div key={index} className="flex items-center gap-1.5 rounded border border-stone-200 px-2 py-1 text-xs dark:border-stone-700">
                                                <span className="w-12 shrink-0 text-stone-400" title={`nodeId: ${row.nodeId}`}>{row.nodeId}</span>
                                                <span className="w-16 shrink-0 truncate font-mono" title={row.fieldName}>{row.fieldName}</span>
                                                <span className="min-w-0 flex-1 truncate text-stone-400" title={row.description}>{row.description || "-"}</span>
                                                <Select value={row.role} onValueChange={(value) => updateImportRow(index, { role: value as RunningHubParamRole })}>
                                                    <SelectTrigger className="h-7 w-24 shrink-0 text-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {PARAM_ROLE_OPTIONS.map((opt) => (
                                                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <Input className="h-7 w-24 shrink-0 text-xs" value={row.label} placeholder="标签" onChange={(event) => updateImportRow(index, { label: event.target.value })} />
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-2 flex gap-2">
                                        <Button size="sm" onClick={handleConfirmImport}>确认导入</Button>
                                        <Button variant="outline" size="sm" onClick={() => setPendingImport(null)}>取消</Button>
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>名称</Label>
                                <Input value={draft.name} placeholder="例如: FLUX文生图" onChange={(event) => update("name", event.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label>工作流 ID</Label>
                                <Input value={draft.workflowId} placeholder="从 RunningHub 复制" onChange={(event) => update("workflowId", event.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label>输出类型</Label>
                                <Select value={draft.outputType} onValueChange={(value) => update("outputType", value as RunningHubWorkflow["outputType"])}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="image">图片</SelectItem>
                                        <SelectItem value="video">视频</SelectItem>
                                        <SelectItem value="audio">音频</SelectItem>
                                        <SelectItem value="auto">自动识别</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>实例类型</Label>
                                <Select value={draft.instanceType} onValueChange={(value) => update("instanceType", value as RunningHubWorkflow["instanceType"])}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="default">default (24G显存)</SelectItem>
                                        <SelectItem value="plus">plus (48G显存)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold">参数列表</div>
                            <Button variant="outline" size="sm" onClick={addParam}>
                                <Plus className="size-3.5" />
                                添加参数
                            </Button>
                        </div>

                        {draft.params.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-stone-300 py-6 text-center text-xs text-stone-400 dark:border-stone-700">暂无参数，可通过 curl 导入或手动添加</div>
                        ) : (
                            <div className="space-y-1.5">
                                {draft.params.map((param, index) => (
                                    <div key={index} className="flex items-center gap-1.5 rounded border border-stone-200 px-2 py-1 dark:border-stone-700">
                                        <Input className="h-7 w-16 text-xs" value={param.nodeId} placeholder="nodeId" onChange={(event) => updateParam(index, { nodeId: event.target.value })} />
                                        <Input className="h-7 w-20 text-xs" value={param.fieldName} placeholder="field" onChange={(event) => updateParam(index, { fieldName: event.target.value })} />
                                        <Select value={param.role} onValueChange={(value) => updateParam(index, { role: value as RunningHubParamRole })}>
                                            <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {PARAM_ROLE_OPTIONS.map((opt) => (
                                                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Input className="h-7 w-24 text-xs" value={param.label} placeholder="标签" onChange={(event) => updateParam(index, { label: event.target.value })} />
                                        {param.role === "string" && param.enumOptions?.length ? (
                                            <Select value={param.defaultValue || ""} onValueChange={(value) => updateParam(index, { defaultValue: value })}>
                                                <SelectTrigger className="h-7 min-w-0 flex-1 text-xs"><SelectValue placeholder="默认值" /></SelectTrigger>
                                                <SelectContent>
                                                    {param.enumOptions.map((option) => (
                                                        <SelectItem key={option} value={option}>{option}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        ) : param.role === "fixed" || param.role === "boolean" || param.role === "number" || param.role === "string" ? (
                                            <Input className="h-7 min-w-0 flex-1 text-xs" value={param.defaultValue || ""} placeholder="默认值" onChange={(event) => updateParam(index, { defaultValue: event.target.value })} />
                                        ) : (
                                            <div className="min-w-0 flex-1" />
                                        )}
                                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={index === 0} onClick={() => moveParam(index, -1)}>
                                            <ArrowUp className="size-3" />
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={index === draft.params.length - 1} onClick={() => moveParam(index, 1)}>
                                            <ArrowDown className="size-3" />
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => removeParam(index)}>
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
                    <Button onClick={() => onSave(draft)}>保存</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
