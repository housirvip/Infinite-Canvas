import { App, Button, Form, Input, Modal, Select, Space, Switch, Upload } from "antd";
import { ArrowDown, ArrowUp, ClipboardPaste, Download, Plus, Settings2, Trash2, Upload as UploadIcon } from "lucide-react";
import { useRef, useState } from "react";

import { createRunningHubWorkflow, parseCurlCommand, suggestParamLabel, suggestParamRole, PARAM_ROLE_OPTIONS, type ParsedCurlNode, type RunningHubParam, type RunningHubParamRole, type RunningHubWorkflow } from "@/lib/runninghub";
import type { AiConfig } from "@/stores/use-config-store";

type RunningHubConfigTabProps = {
    config: AiConfig;
    onConfigChange: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
};

export function RunningHubConfigTab({ config, onConfigChange }: RunningHubConfigTabProps) {
    const { message } = App.useApp();
    const [editingWorkflow, setEditingWorkflow] = useState<RunningHubWorkflow | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const updateWorkflows = (workflows: RunningHubWorkflow[]) => {
        onConfigChange("runninghubWorkflows", workflows);
    };

    const addWorkflow = () => {
        setEditingWorkflow(createRunningHubWorkflow());
    };

    const deleteWorkflow = (id: string) => {
        updateWorkflows(config.runninghubWorkflows.filter((w) => w.id !== id));
    };

    const saveWorkflow = (workflow: RunningHubWorkflow) => {
        const exists = config.runninghubWorkflows.some((w) => w.id === workflow.id);
        if (exists) {
            updateWorkflows(config.runninghubWorkflows.map((w) => (w.id === workflow.id ? workflow : w)));
        } else {
            updateWorkflows([...config.runninghubWorkflows, workflow]);
        }
        setEditingWorkflow(null);
    };

    const handleExport = () => {
        const data = { runninghubApiKey: config.runninghubApiKey, runninghubWorkflows: config.runninghubWorkflows };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "runninghub-config.json";
        a.click();
        URL.revokeObjectURL(url);
        message.success("配置已导出");
    };

    const handleImport = (file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result as string);
                if (data.runninghubApiKey !== undefined) onConfigChange("runninghubApiKey", data.runninghubApiKey);
                if (Array.isArray(data.runninghubWorkflows)) {
                    const valid = data.runninghubWorkflows.filter(
                        (w: unknown) => w && typeof w === "object" && "id" in w && "workflowId" in w && Array.isArray((w as Record<string, unknown>).params),
                    );
                    onConfigChange("runninghubWorkflows", valid);
                    message.success(`已导入 ${valid.length} 个工作流${valid.length < data.runninghubWorkflows.length ? `（${data.runninghubWorkflows.length - valid.length} 个格式异常已跳过）` : ""}`);
                } else {
                    message.warning("配置文件中未找到工作流数据");
                }
            } catch {
                message.error("配置文件格式错误");
            }
        };
        reader.readAsText(file);
    };

    return (
        <Form layout="vertical" requiredMark={false}>
            <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <div className="text-sm font-semibold">RunningHub 配置</div>
                        <div className="mt-1 text-xs text-stone-500">配置 RunningHub API Key 和 ComfyUI 工作流，在画布中通过 RunningHub 节点调用。</div>
                    </div>
                    <Space size="small">
                        <Button size="small" icon={<Download className="size-3.5" />} onClick={handleExport} disabled={!config.runninghubWorkflows.length}>
                            导出
                        </Button>
                        <Button size="small" icon={<UploadIcon className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                            导入
                        </Button>
                        <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleImport(file); e.target.value = ""; }} />
                    </Space>
                </div>
                <Form.Item label="API Key" className="mb-0">
                    <Input.Password value={config.runninghubApiKey} placeholder="输入 RunningHub API Key" onChange={(e) => onConfigChange("runninghubApiKey", e.target.value)} />
                </Form.Item>
            </section>

            <section className="mt-4 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <div className="text-sm font-semibold">工作流列表</div>
                        <div className="mt-1 text-xs text-stone-500">每个工作流对应 RunningHub 上的一个 ComfyUI 工作流，需配置节点参数映射。</div>
                    </div>
                    <Button type="primary" size="small" icon={<Plus className="size-3.5" />} onClick={addWorkflow}>
                        新增
                    </Button>
                </div>

                {config.runninghubWorkflows.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-stone-300 py-8 text-center text-xs text-stone-400 dark:border-stone-700">暂无工作流，点击"新增"添加</div>
                ) : (
                    <div className="space-y-2">
                        {config.runninghubWorkflows.map((workflow) => {
                            const promptCount = workflow.params.filter((p) => p.role === "prompt").length;
                            const imageCount = workflow.params.filter((p) => p.role === "image").length;
                            const videoCount = workflow.params.filter((p) => p.role === "video").length;
                            const boolCount = workflow.params.filter((p) => p.role === "boolean").length;
                            const numCount = workflow.params.filter((p) => p.role === "number").length;
                            const strCount = workflow.params.filter((p) => p.role === "string").length;
                            return (
                                <div key={workflow.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-medium">{workflow.name}</div>
                                        <div className="mt-0.5 text-xs text-stone-500">
                                            ID: {workflow.workflowId || "未配置"} · {promptCount} 提示词 · {imageCount} 图片 · {videoCount} 视频 · {boolCount} 开关 · {numCount} 数字 · {strCount} 字符串 · {workflow.instanceType}
                                        </div>
                                    </div>
                                    <Space size="small">
                                        <Button size="small" icon={<Settings2 className="size-3.5" />} onClick={() => setEditingWorkflow({ ...workflow, params: [...workflow.params] })}>
                                            编辑
                                        </Button>
                                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteWorkflow(workflow.id)} />
                                    </Space>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {editingWorkflow ? <WorkflowEditorModal workflow={editingWorkflow} onSave={saveWorkflow} onCancel={() => setEditingWorkflow(null)} /> : null}
        </Form>
    );
}

// ========== 工作流编辑弹窗 ==========

type PendingImportRow = ParsedCurlNode & { role: RunningHubParamRole; label: string };

function WorkflowEditorModal({ workflow, onSave, onCancel }: { workflow: RunningHubWorkflow; onSave: (w: RunningHubWorkflow) => void; onCancel: () => void }) {
    const { message } = App.useApp();
    const [draft, setDraft] = useState<RunningHubWorkflow>({ ...workflow, params: workflow.params.map((p) => ({ ...p })) });
    const [curlText, setCurlText] = useState("");
    const [showCurlImport, setShowCurlImport] = useState(!workflow.workflowId);
    const [pendingImport, setPendingImport] = useState<PendingImportRow[] | null>(null);

    const update = <K extends keyof RunningHubWorkflow>(key: K, value: RunningHubWorkflow[K]) => {
        setDraft((d) => ({ ...d, [key]: value }));
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
        update("params", draft.params.filter((_, i) => i !== index));
    };

    const moveParam = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= draft.params.length) return;
        const params = [...draft.params];
        [params[index], params[target]] = [params[target], params[index]];
        params.forEach((p, i) => (p.order = i));
        update("params", params);
    };

    // curl 解析第一步
    const handleParseCurl = () => {
        const text = curlText.trim();
        if (!text) { message.warning("请粘贴 curl 命令"); return; }
        const parsed = parseCurlCommand(text);
        if (!parsed) { message.error("无法解析，请确认包含 RunningHub API 调用地址"); return; }
        if (!parsed.rawNodes.length) { message.warning("未解析到节点参数"); return; }

        update("workflowId", parsed.workflowId);
        update("instanceType", parsed.instanceType);

        const rows: PendingImportRow[] = parsed.rawNodes.map((node) => {
            const role = suggestParamRole(node);
            return { ...node, role, label: suggestParamLabel(node, role) };
        });
        setPendingImport(rows);
    };

    // curl 导入确认第二步
    const handleConfirmImport = () => {
        if (!pendingImport) return;
        const params: RunningHubParam[] = pendingImport.map((row, index) => ({
            nodeId: row.nodeId,
            fieldName: row.fieldName,
            role: row.role,
            label: row.label,
            defaultValue: row.role === "fixed" || row.role === "boolean" || row.role === "number" || row.role === "string" ? row.fieldValue : undefined,
            description: row.description,
            order: index,
        }));
        update("params", params);
        setPendingImport(null);
        setCurlText("");
        setShowCurlImport(false);
        const counts = { prompt: 0, image: 0, video: 0, boolean: 0, number: 0, string: 0, fixed: 0, ignore: 0 };
        params.forEach((p) => counts[p.role]++);
        message.success(`已导入 ${params.length} 个参数：${counts.prompt} 提示词、${counts.image} 图片、${counts.video} 视频、${counts.boolean} 开关、${counts.number} 数字、${counts.string} 字符串、${counts.fixed} 固定`);
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
        <Modal title="编辑工作流" open width={720} centered onCancel={onCancel} onOk={() => onSave(draft)} okText="保存" cancelText="取消" styles={{ body: { maxHeight: "70vh", overflowY: "auto" } }}>
            <Form layout="vertical" requiredMark={false} className="mt-4">
                {/* curl import */}
                <div className="mb-4 rounded-lg border border-dashed border-blue-300 bg-blue-50/50 p-3 dark:border-blue-800 dark:bg-blue-950/20">
                    <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-300">
                            <ClipboardPaste className="size-3.5" />
                            从 RunningHub 粘贴 curl 命令导入
                        </div>
                        <Button type="link" size="small" className="!px-0 !text-xs" onClick={() => { setShowCurlImport(!showCurlImport); setPendingImport(null); }}>
                            {showCurlImport ? "收起" : "展开"}
                        </Button>
                    </div>
                    {showCurlImport && !pendingImport ? (
                        <>
                            <Input.TextArea rows={4} value={curlText} onChange={(e) => setCurlText(e.target.value)} placeholder={"粘贴从 RunningHub「调用 API」页面复制的 curl 命令..."} className="!text-xs" />
                            <Button type="primary" size="small" className="mt-2" icon={<ClipboardPaste className="size-3.5" />} disabled={!curlText.trim()} onClick={handleParseCurl}>
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
                                        <Select size="small" className="!w-24 shrink-0" value={row.role} options={PARAM_ROLE_OPTIONS} onChange={(v) => updateImportRow(index, { role: v })} />
                                        <Input size="small" className="!w-24 shrink-0" value={row.label} placeholder="标签" onChange={(e) => updateImportRow(index, { label: e.target.value })} />
                                    </div>
                                ))}
                            </div>
                            <div className="mt-2 flex gap-2">
                                <Button type="primary" size="small" onClick={handleConfirmImport}>确认导入</Button>
                                <Button size="small" onClick={() => setPendingImport(null)}>取消</Button>
                            </div>
                        </div>
                    ) : null}
                </div>

                {/* basic fields */}
                <div className="grid gap-4 md:grid-cols-2">
                    <Form.Item label="名称" className="mb-3">
                        <Input value={draft.name} placeholder="例如: FLUX文生图" onChange={(e) => update("name", e.target.value)} />
                    </Form.Item>
                    <Form.Item label="工作流 ID" className="mb-3">
                        <Input value={draft.workflowId} placeholder="从 RunningHub 复制" onChange={(e) => update("workflowId", e.target.value)} />
                    </Form.Item>
                    <Form.Item label="输出类型" className="mb-3">
                        <Select value={draft.outputType} onChange={(v) => update("outputType", v)} options={[{ label: "图片", value: "image" }, { label: "视频", value: "video" }, { label: "自动识别", value: "auto" }]} />
                    </Form.Item>
                    <Form.Item label="实例类型" className="mb-3">
                        <Select value={draft.instanceType} onChange={(v) => update("instanceType", v)} options={[{ label: "default (24G显存)", value: "default" }, { label: "plus (48G显存)", value: "plus" }]} />
                    </Form.Item>
                </div>

                {/* params table */}
                <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-semibold">参数列表</div>
                    <Button size="small" icon={<Plus className="size-3.5" />} onClick={addParam}>添加参数</Button>
                </div>

                {draft.params.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-stone-300 py-6 text-center text-xs text-stone-400 dark:border-stone-700">暂无参数，可通过 curl 导入或手动添加</div>
                ) : (
                    <div className="space-y-1.5">
                        {draft.params.map((param, index) => (
                            <div key={index} className="flex items-center gap-1.5 rounded border border-stone-200 px-2 py-1 dark:border-stone-700">
                                <Input size="small" value={param.nodeId} placeholder="nodeId" className="!w-16" onChange={(e) => updateParam(index, { nodeId: e.target.value })} />
                                <Input size="small" value={param.fieldName} placeholder="field" className="!w-20" onChange={(e) => updateParam(index, { fieldName: e.target.value })} />
                                <Select size="small" className="!w-24" value={param.role} options={PARAM_ROLE_OPTIONS} onChange={(v) => updateParam(index, { role: v })} />
                                <Input size="small" value={param.label} placeholder="标签" className="!w-24" onChange={(e) => updateParam(index, { label: e.target.value })} />
                                {param.role === "fixed" || param.role === "boolean" || param.role === "number" || param.role === "string" ? (
                                    <Input size="small" value={param.defaultValue} placeholder="默认值" className="min-w-0 flex-1" onChange={(e) => updateParam(index, { defaultValue: e.target.value })} />
                                ) : (
                                    <div className="min-w-0 flex-1" />
                                )}
                                <Button size="small" type="text" icon={<ArrowUp className="size-3" />} disabled={index === 0} onClick={() => moveParam(index, -1)} />
                                <Button size="small" type="text" icon={<ArrowDown className="size-3" />} disabled={index === draft.params.length - 1} onClick={() => moveParam(index, 1)} />
                                <Button size="small" type="text" danger icon={<Trash2 className="size-3" />} onClick={() => removeParam(index)} />
                            </div>
                        ))}
                    </div>
                )}
            </Form>
        </Modal>
    );
}
