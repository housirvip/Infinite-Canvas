import { App, Button, Form, Input, Modal, Select, Space } from "antd";
import { ArrowDown, ArrowUp, ClipboardPaste, Download, Plus, Settings2, Trash2, Upload as UploadIcon } from "lucide-react";
import { useRef, useState } from "react";

import { createRunningHubWorkflow, parseCurlCommand, suggestParamLabel, suggestParamRole, PARAM_ROLE_OPTIONS, type ParsedCurlNode, type RunningHubParam, type RunningHubParamRole, type RunningHubWorkflow } from "@/lib/runninghub";
import { useRunningHubStore } from "@/stores/use-runninghub-store";

type PendingImportRow = ParsedCurlNode & { role: RunningHubParamRole; label: string };

export function RunningHubConfigModal() {
    const { message } = App.useApp();
    const [editingWorkflow, setEditingWorkflow] = useState<RunningHubWorkflow | null>(null);
    const [apiKeyDraft, setApiKeyDraft] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isOpen = useRunningHubStore((state) => state.isOpen);
    const setOpen = useRunningHubStore((state) => state.setOpen);
    const workflows = useRunningHubStore((state) => state.workflows);
    const hasApiKey = useRunningHubStore((state) => state.hasApiKey);
    const saveConfig = useRunningHubStore((state) => state.saveConfig);
    const setWorkflows = useRunningHubStore((state) => state.setWorkflows);
    const fetchConfigFromServer = useRunningHubStore((state) => state.fetchConfigFromServer);

    const updateWorkflows = async (nextWorkflows: RunningHubWorkflow[]) => {
        setWorkflows(nextWorkflows);
        try {
            await saveConfig({ workflows: nextWorkflows });
            return true;
        } catch {
            message.error("工作流保存失败");
            await fetchConfigFromServer();
            return false;
        }
    };

    const addWorkflow = () => {
        setEditingWorkflow(createRunningHubWorkflow());
    };

    const deleteWorkflow = async (id: string) => {
        const ok = await updateWorkflows(workflows.filter((workflow) => workflow.id !== id));
        if (ok) {
            message.success("工作流已删除");
        }
    };

    const saveWorkflow = async (workflow: RunningHubWorkflow) => {
        const exists = workflows.some((item) => item.id === workflow.id);
        const nextWorkflows = exists ? workflows.map((item) => (item.id === workflow.id ? workflow : item)) : [...workflows, workflow];
        const ok = await updateWorkflows(nextWorkflows);
        if (ok) {
            setEditingWorkflow(null);
            message.success(exists ? "工作流已更新" : "工作流已添加");
        }
    };

    const handleExport = () => {
        const data = { runninghubWorkflows: workflows };
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
            <Modal
                title="RunningHub 工作流"
                width={860}
                open={isOpen}
                onCancel={() => setOpen(false)}
                footer={[
                    <Button key="done" type="primary" onClick={() => setOpen(false)}>
                        完成
                    </Button>,
                ]}
            >
                <Form layout="vertical" requiredMark={false}>
                    <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-semibold">RunningHub 配置</div>
                                <div className="mt-1 text-xs text-stone-500">独立管理 RunningHub API Key 和 ComfyUI 工作流，画布 RunningHub 节点会读取这里的配置。</div>
                            </div>
                            <Space size="small">
                                <Button size="small" icon={<Download className="size-3.5" />} onClick={handleExport} disabled={!workflows.length}>
                                    导出
                                </Button>
                                <Button size="small" icon={<UploadIcon className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
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
                            </Space>
                        </div>
                        <Form.Item label="API Key" className="mb-0">
                            <div className="flex gap-2">
                                <Input.Password
                                    value={apiKeyDraft}
                                    placeholder={hasApiKey ? "已保存（输入新值覆盖，留空不修改）" : "输入 RunningHub API Key"}
                                    onChange={(event) => setApiKeyDraft(event.target.value)}
                                    onPressEnter={() => void handleSaveApiKey()}
                                />
                                <Button type="primary" onClick={() => void handleSaveApiKey()}>
                                    保存 Key
                                </Button>
                            </div>
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

                        {workflows.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-stone-300 py-8 text-center text-xs text-stone-400 dark:border-stone-700">暂无工作流，点击"新增"添加</div>
                        ) : (
                            <div className="space-y-2">
                                {workflows.map((workflow) => {
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
                                            <Space size="small">
                                                <Button size="small" icon={<Settings2 className="size-3.5" />} onClick={() => setEditingWorkflow({ ...workflow, params: workflow.params.map((param) => ({ ...param })) })}>
                                                    编辑
                                                </Button>
                                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => void deleteWorkflow(workflow.id)} />
                                            </Space>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>
                </Form>
            </Modal>

            {editingWorkflow ? <WorkflowEditorModal workflow={editingWorkflow} onSave={(workflow) => void saveWorkflow(workflow)} onCancel={() => setEditingWorkflow(null)} /> : null}
        </>
    );
}

function WorkflowEditorModal({ workflow, onSave, onCancel }: { workflow: RunningHubWorkflow; onSave: (workflow: RunningHubWorkflow) => void; onCancel: () => void }) {
    const { message } = App.useApp();
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
        const counts = { prompt: 0, image: 0, video: 0, boolean: 0, number: 0, string: 0, fixed: 0, ignore: 0 };
        params.forEach((param) => counts[param.role]++);
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
                            <Input.TextArea rows={4} value={curlText} onChange={(event) => setCurlText(event.target.value)} placeholder="粘贴从 RunningHub「调用 API」页面复制的 curl 命令..." className="!text-xs" />
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
                                        <Select size="small" className="!w-24 shrink-0" value={row.role} options={PARAM_ROLE_OPTIONS} onChange={(value) => updateImportRow(index, { role: value })} />
                                        <Input size="small" className="!w-24 shrink-0" value={row.label} placeholder="标签" onChange={(event) => updateImportRow(index, { label: event.target.value })} />
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

                <div className="grid gap-4 md:grid-cols-2">
                    <Form.Item label="名称" className="mb-3">
                        <Input value={draft.name} placeholder="例如: FLUX文生图" onChange={(event) => update("name", event.target.value)} />
                    </Form.Item>
                    <Form.Item label="工作流 ID" className="mb-3">
                        <Input value={draft.workflowId} placeholder="从 RunningHub 复制" onChange={(event) => update("workflowId", event.target.value)} />
                    </Form.Item>
                    <Form.Item label="输出类型" className="mb-3">
                        <Select value={draft.outputType} onChange={(value) => update("outputType", value)} options={[{ label: "图片", value: "image" }, { label: "视频", value: "video" }, { label: "自动识别", value: "auto" }]} />
                    </Form.Item>
                    <Form.Item label="实例类型" className="mb-3">
                        <Select value={draft.instanceType} onChange={(value) => update("instanceType", value)} options={[{ label: "default (24G显存)", value: "default" }, { label: "plus (48G显存)", value: "plus" }]} />
                    </Form.Item>
                </div>

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
                                <Input size="small" value={param.nodeId} placeholder="nodeId" className="!w-16" onChange={(event) => updateParam(index, { nodeId: event.target.value })} />
                                <Input size="small" value={param.fieldName} placeholder="field" className="!w-20" onChange={(event) => updateParam(index, { fieldName: event.target.value })} />
                                <Select size="small" className="!w-24" value={param.role} options={PARAM_ROLE_OPTIONS} onChange={(value) => updateParam(index, { role: value })} />
                                <Input size="small" value={param.label} placeholder="标签" className="!w-24" onChange={(event) => updateParam(index, { label: event.target.value })} />
                                {param.role === "string" && param.enumOptions?.length ? (
                                    <Select
                                        size="small"
                                        className="min-w-0 flex-1"
                                        value={param.defaultValue}
                                        placeholder="默认值"
                                        options={param.enumOptions.map((option) => ({ label: option, value: option }))}
                                        onChange={(value) => updateParam(index, { defaultValue: value })}
                                    />
                                ) : param.role === "fixed" || param.role === "boolean" || param.role === "number" || param.role === "string" ? (
                                    <Input size="small" value={param.defaultValue} placeholder="默认值" className="min-w-0 flex-1" onChange={(event) => updateParam(index, { defaultValue: event.target.value })} />
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
