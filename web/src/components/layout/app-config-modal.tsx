import { App, Button, Form, Input, Modal, Select, Tabs } from "antd";
import { CircleAlert, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { RunningHubConfigTab } from "@/components/layout/runninghub-workflow-editor";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import { createModelChannel, defaultBaseUrlForApiFormat, filterModelsByCapability, modelOptionLabel, modelOptionsFromChannels, normalizeModelOptionValue, useConfigStore, type AiConfig, type ApiCallFormat, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import * as channelApi from "@/services/backend-channel";
import * as settingsApi from "@/services/backend-settings";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    modelsKey: "imageModels" | "videoModels" | "textModels" | "audioModels";
    defaultLabel: string;
    optionsLabel: string;
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", modelsKey: "imageModels", defaultLabel: "默认生图模型", optionsLabel: "生图模型可选项" },
    { capability: "video", modelKey: "videoModel", modelsKey: "videoModels", defaultLabel: "默认视频模型", optionsLabel: "视频模型可选项" },
    { capability: "text", modelKey: "textModel", modelsKey: "textModels", defaultLabel: "默认文本模型", optionsLabel: "文本模型可选项" },
    { capability: "audio", modelKey: "audioModel", modelsKey: "audioModels", defaultLabel: "默认音频模型", optionsLabel: "音频模型可选项" },
];

const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
    { label: "OpenAI Response", value: "openai-response" },
    { label: "OpenAI Completion", value: "openai-completion" },
    { label: "Gemini", value: "gemini" },
];

export function AppConfigModal() {
    const { message } = App.useApp();
    const [activeTab, setActiveTab] = useState("channels");
    const [loadingChannelId, setLoadingChannelId] = useState("");
    const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, string>>({});
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const modelOptions = config.models.map((model) => ({ label: modelOptionLabel(config, model), value: model }));

    let settingsSaveTimer: ReturnType<typeof setTimeout> | null = null;
    const syncSettingsToServer = () => {
        if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
        settingsSaveTimer = setTimeout(() => {
            const { channels: _channels, apiKey: _apiKey, ...settingsOnly } = useConfigStore.getState().config;
            settingsApi.updateSettings(settingsOnly).catch(() => {});
        }, 500);
    };

    const updateConfigAndSync = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => {
        updateConfig(key, value);
        syncSettingsToServer();
    };

    const saveConfig = (nextConfig: AiConfig) => {
        (Object.keys(nextConfig) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, nextConfig[key]));
        const { channels: _channels, apiKey: _apiKey, ...settingsOnly } = nextConfig;
        settingsApi.updateSettings(settingsOnly).catch(() => {});
    };

    const finishConfig = () => {
        const ready = config.channels.some((channel) => channel.baseUrl.trim() && channel.models.length);
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(shouldPromptContinue ? "配置已保存，请继续刚才的请求" : "配置已保存");
        clearPromptContinue();
    };

    const updateChannels = (channels: ModelChannel[]) => {
        const nextConfig = withChannels(config, channels);
        saveConfig(nextConfig);
    };

    const updateChannel = (id: string, patch: Partial<ModelChannel>) => {
        const nextChannels = config.channels.map((channel) => (channel.id === id ? { ...channel, ...patch, models: patch.models ? uniqueModels(patch.models) : channel.models } : channel));
        updateChannels(nextChannels);
        const nextChannel = nextChannels.find((channel) => channel.id === id);
        const serverChannelId = useConfigStore.getState().getServerChannelId(id);
        if (serverChannelId) {
            const payload: channelApi.UpdateChannelPayload = {};
            if (patch.name !== undefined) payload.name = patch.name;
            if (patch.baseUrl !== undefined) payload.baseUrl = patch.baseUrl;
            if (patch.apiFormat !== undefined) payload.apiFormat = patch.apiFormat;
            if (patch.models !== undefined) payload.models = uniqueModels(patch.models);
            if (patch.apiKey !== undefined && patch.apiKey !== "") payload.apiKey = patch.apiKey;
            if (Object.keys(payload).length) channelApi.updateChannel(serverChannelId, payload).catch(() => message.error("渠道保存失败"));
        } else if (nextChannel && patch.apiKey) {
            channelApi.createChannel({ name: nextChannel.name, provider: nextChannel.apiFormat, baseUrl: nextChannel.baseUrl, apiKey: patch.apiKey, apiFormat: nextChannel.apiFormat, models: nextChannel.models }).then((serverChannel) => {
                const localId = `server-${serverChannel.id}`;
                useConfigStore.setState((state) => ({ serverChannelMap: new Map(state.serverChannelMap).set(localId, serverChannel.id), config: { ...state.config, channels: state.config.channels.map((channel) => (channel.id === id ? { ...nextChannel, id: localId, apiKey: "" } : channel)) } }));
                setApiKeyDrafts((drafts) => omitKey(drafts, id));
                message.success("API Key 已保存");
            }).catch(() => message.error("API Key 保存失败"));
        }
    };

    const updateChannelApiFormat = (channel: ModelChannel, apiFormat: ApiCallFormat) => {
        const baseUrl = !channel.baseUrl.trim() || channel.baseUrl.trim() === defaultBaseUrlForApiFormat(channel.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : channel.baseUrl;
        updateChannel(channel.id, { apiFormat, baseUrl });
    };
    const commitChannelApiKey = (channel: ModelChannel) => {
        const apiKey = apiKeyDrafts[channel.id]?.trim();
        if (!apiKey) return;
        updateChannel(channel.id, { apiKey });
    };

    const addChannel = async () => {
        const newChannel = createModelChannel({ name: `渠道 ${config.channels.length + 1}` });
        updateChannels([...config.channels, newChannel]);
        try {
            const serverChannel = await channelApi.createChannel({ name: newChannel.name, provider: newChannel.apiFormat, baseUrl: newChannel.baseUrl, apiKey: "", apiFormat: newChannel.apiFormat, models: newChannel.models });
            const localId = `server-${serverChannel.id}`;
            const updatedChannel = { ...newChannel, id: localId };
            useConfigStore.setState((state) => {
                const channelMap = new Map(state.serverChannelMap);
                channelMap.set(localId, serverChannel.id);
                return {
                    serverChannelMap: channelMap,
                    config: { ...state.config, channels: state.config.channels.map((ch) => (ch.id === newChannel.id ? updatedChannel : ch)) },
                };
            });
        } catch {}
    };

    const deleteChannel = (id: string) => {
        if (config.channels.length <= 1) {
            message.warning("至少保留一个渠道");
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
        const serverChannelId = useConfigStore.getState().getServerChannelId(id);
        if (serverChannelId) channelApi.deleteChannel(serverChannelId).catch(() => {});
    };

    const refreshChannelModels = async (channel: ModelChannel) => {
        const serverChannelId = useConfigStore.getState().getServerChannelId(channel.id);
        if (!serverChannelId) {
            message.error("该渠道尚未同步到服务端，请先保存 API Key");
            return;
        }
        setLoadingChannelId(channel.id);
        try {
            const models = await channelApi.listChannelModels(serverChannelId);
            updateChannels(config.channels.map((item) => (item.id === channel.id ? { ...item, models } : item)));
            const serverPayload: channelApi.UpdateChannelPayload = { models };
            channelApi.updateChannel(serverChannelId, serverPayload).catch(() => {});
            message.success(`${channel.name} 模型列表已更新`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取模型失败");
        } finally {
            setLoadingChannelId("");
        }
    };

    const refreshAllModels = async () => {
        const runnable = config.channels.filter((channel) => useConfigStore.getState().getServerChannelId(channel.id));
        if (!runnable.length) {
            message.error("没有已同步到服务端的渠道");
            return;
        }
        setLoadingChannelId("all");
        try {
            const entries = await Promise.all(runnable.map(async (channel) => {
                const serverId = useConfigStore.getState().getServerChannelId(channel.id)!;
                const models = await channelApi.listChannelModels(serverId);
                channelApi.updateChannel(serverId, { models }).catch(() => {});
                return [channel.id, models] as const;
            }));
            const modelMap = new Map(entries);
            updateChannels(config.channels.map((channel) => (modelMap.has(channel.id) ? { ...channel, models: modelMap.get(channel.id) || [] } : channel)));
            message.success("模型列表已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取模型失败");
        } finally {
            setLoadingChannelId("");
        }
    };

    const updateCapabilityModels = (group: ModelGroup, models: string[]) => {
        const next = uniqueModels(models.map((model) => normalizeModelOptionValue(model, config.channels)).filter(Boolean));
        updateConfigAndSync(group.modelsKey, next);
        if (!next.includes(config[group.modelKey])) updateConfigAndSync(group.modelKey, next[0] || "");
    };

    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">配置与用户偏好</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">渠道聚合、模型选择和同步偏好</div>
                </div>
            }
            open={isConfigOpen}
            width={980}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}
            footer={
                <Button type="primary" onClick={finishConfig}>
                    完成
                </Button>
            }
        >
            <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                    {
                        key: "channels",
                        label: "渠道",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
                                            <CircleAlert className="size-3.5 shrink-0" />
                                            <span className="font-semibold">重要：</span>
                                            <span>新增或拉取模型后，需要到“模型”Tab 选择可选项才会显示。</span>
                                            <Button type="link" size="small" className="h-auto p-0 text-xs font-semibold text-amber-900 dark:text-amber-100" onClick={() => setActiveTab("models")}>
                                                去模型设置
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 gap-2">
                                        <Button icon={<RefreshCw className="size-4" />} loading={Boolean(loadingChannelId)} onClick={() => void refreshAllModels()}>
                                            拉取全部
                                        </Button>
                                        <Button type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>
                                            新增渠道
                                        </Button>
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    {config.channels.map((channel) => (
                                        <section key={channel.id} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                            <div className="mb-3 flex items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-semibold">{channel.name || "未命名渠道"}</div>
                                                    <div className="mt-1 text-xs text-stone-500">
                                                        {apiFormatLabel(channel.apiFormat)} · 已保存 {channel.models.length} 个模型
                                                    </div>
                                                </div>
                                                <div className="flex shrink-0 gap-2">
                                                    <Button size="small" loading={loadingChannelId === channel.id} onClick={() => void refreshChannelModels(channel)}>
                                                        拉取模型
                                                    </Button>
                                                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteChannel(channel.id)} />
                                                </div>
                                            </div>
                                            <div className="grid gap-4 md:grid-cols-2">
                                                <Form.Item label="渠道名称" className="mb-0">
                                                    <Input value={channel.name} onChange={(event) => updateChannel(channel.id, { name: event.target.value })} />
                                                </Form.Item>
                                                <Form.Item label="调用格式" className="mb-0">
                                                    <Select value={channel.apiFormat} options={apiFormatOptions} onChange={(value: ApiCallFormat) => updateChannelApiFormat(channel, value)} />
                                                </Form.Item>
                                                <Form.Item label="Base URL" className="mb-0">
                                                    <Input value={channel.baseUrl} onChange={(event) => updateChannel(channel.id, { baseUrl: event.target.value })} />
                                                </Form.Item>
                                                <Form.Item label="API Key" className="mb-0">
                                                    <Input.Password
                                                        value={apiKeyDrafts[channel.id] || ""}
                                                        placeholder={useConfigStore.getState().getServerChannelId(channel.id) ? "已保存（输入新值覆盖）" : "输入 API Key"}
                                                        onChange={(event) => setApiKeyDrafts((drafts) => ({ ...drafts, [channel.id]: event.target.value }))}
                                                        onBlur={() => commitChannelApiKey(channel)}
                                                        onPressEnter={() => commitChannelApiKey(channel)}
                                                    />
                                                </Form.Item>
                                                <Form.Item label="模型列表" className="mb-0 md:col-span-2">
                                                    <Select mode="tags" showSearch allowClear maxTagCount="responsive" placeholder="输入模型名，或点击拉取模型" value={channel.models} onChange={(models) => updateChannel(channel.id, { models })} />
                                                </Form.Item>
                                            </div>
                                        </section>
                                    ))}
                                </div>
                            </Form>
                        ),
                    },
                    {
                        key: "models",
                        label: "模型",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-4 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="text-sm font-semibold">默认模型和可选项</div>
                                    <div className="mt-1 text-xs leading-5 text-stone-500">可选项决定各处下拉框展示哪些模型；同名模型会以括号里的渠道名区分。</div>
                                </div>
                                <div className="grid gap-4 md:grid-cols-2">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelsKey} label={group.optionsLabel} className="mb-0">
                                            <Select
                                                mode="tags"
                                                showSearch
                                                allowClear
                                                maxTagCount="responsive"
                                                placeholder={config.models.length ? `请选择或输入${group.optionsLabel}` : "先到渠道里填写或拉取模型"}
                                                value={config[group.modelsKey]}
                                                options={modelOptions}
                                                onChange={(models) => updateCapabilityModels(group, models)}
                                            />
                                        </Form.Item>
                                    ))}
                                </div>
                                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-0">
                                            <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfigAndSync(group.modelKey, model)} capability={group.capability} fullWidth />
                                        </Form.Item>
                                    ))}
                                </div>
                            </Form>
                        ),
                    },
                    {
                        key: "preferences",
                        label: "生成偏好",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="grid gap-4 md:grid-cols-4">
                                    <Form.Item label="AI 自动生成结果数" extra="新建画布生图和配置节点默认使用，单个节点仍可单独覆盖。" className="mb-4">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={15}
                                            value={config.canvasImageCount}
                                            onChange={(event) => updateConfigAndSync("canvasImageCount", event.target.value)}
                                            onBlur={(event) => updateConfigAndSync("canvasImageCount", normalizeImageCount(event.target.value))}
                                        />
                                    </Form.Item>
                                    <Form.Item label="默认音频声音" className="mb-4">
                                        <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfigAndSync("audioVoice", value)} />
                                    </Form.Item>
                                    <Form.Item label="默认音频格式" className="mb-4">
                                        <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfigAndSync("audioFormat", value)} />
                                    </Form.Item>
                                    <Form.Item label="默认音频语速" className="mb-4">
                                        <Input
                                            type="number"
                                            min={0.25}
                                            max={4}
                                            step={0.05}
                                            value={config.audioSpeed}
                                            onChange={(event) => updateConfigAndSync("audioSpeed", event.target.value)}
                                            onBlur={(event) => updateConfigAndSync("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                                        />
                                    </Form.Item>
                                </div>
                                <Form.Item label="默认音频指令" className="mb-4">
                                    <Input.TextArea rows={2} value={config.audioInstructions} placeholder="例如：自然、温暖、适合旁白。" onChange={(event) => updateConfigAndSync("audioInstructions", event.target.value)} />
                                </Form.Item>
                                <Form.Item label="系统提示词" className="mb-0">
                                    <Input.TextArea rows={4} value={config.systemPrompt} placeholder="例如：你是一位擅长电影感写实摄影的视觉导演。" onChange={(event) => updateConfigAndSync("systemPrompt", event.target.value)} />
                                </Form.Item>
                            </Form>
                        ),
                    },
                    {
                        key: "runninghub",
                        label: "RunningHub",
                        children: <RunningHubConfigTab config={config} onConfigChange={(key, value) => updateConfigAndSync(key, value)} />,
                    },
                ]}
            />
        </Modal>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const models = modelOptionsFromChannels(channels);
    const imageModels = keepOrSuggest(config.imageModels, filterModelsByCapability(models, "image"), models);
    const videoModels = keepOrSuggest(config.videoModels, filterModelsByCapability(models, "video"), models);
    const textModels = keepOrSuggest(config.textModels, filterModelsByCapability(models, "text"), models);
    const audioModels = keepOrSuggest(config.audioModels, filterModelsByCapability(models, "audio"), models);
    return {
        ...config,
        channels,
        models,
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
        imageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel: normalizeDefaultModel(config.imageModel, imageModels),
        videoModel: normalizeDefaultModel(config.videoModel, videoModels),
        textModel: normalizeDefaultModel(config.textModel, textModels),
        audioModel: normalizeDefaultModel(config.audioModel, audioModels),
    };
}

function keepOrSuggest(current: string[], suggested: string[], allModels: string[]) {
    const available = new Set(allModels);
    const kept = uniqueModels(current).filter((model) => available.has(model));
    return kept.length ? kept : suggested;
}

function normalizeDefaultModel(value: string, options: string[]) {
    if (options.includes(value)) return value;
    return options[0] || value;
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function omitKey<T>(record: Record<string, T>, key: string) {
    const { [key]: _removed, ...rest } = record;
    return rest;
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return "Gemini";
    if (apiFormat === "openai-completion") return "OpenAI Completion";
    return "OpenAI Response";
}
