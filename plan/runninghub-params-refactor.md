# RunningHub 参数映射系统重构 + 配置备份方案

> 创建时间: 2026-06-23

## Context

RunningHub 集成的基础框架已完成（节点类型、API 调用、画布集成）。当前参数模型是扁平的：1 个提示词 + 1 个图片 + customNodes 固定值。需要重构为角色化参数系统，支持：
- 多个提示词（正向/反向/风格）
- 多个图片输入（参考图/蒙版/控制图）
- 布尔开关（高品质等）
- curl 导入后用户手动确认角色
- 配置导入导出 + WebDAV 同步

---

## 1. 新类型系统

### `web/src/lib/runninghub.ts`

新增角色类型，替代旧的扁平字段：

```typescript
export type RunningHubParamRole = "prompt" | "image" | "boolean" | "fixed" | "ignore";

export type RunningHubParam = {
    nodeId: string;
    fieldName: string;
    role: RunningHubParamRole;
    label: string;           // 面板上的显示名，如 "正向提示词"、"参考图"
    defaultValue?: string;   // fixed: 固定值; boolean: 初始值 "true"/"false"; prompt: 可选占位
    description?: string;    // 来自 curl 的原始 description
    order: number;           // 显示排序
};

// 参数值 key = `${nodeId}:${fieldName}`
export function paramKey(p: Pick<RunningHubParam, "nodeId" | "fieldName">): string {
    return `${p.nodeId}:${p.fieldName}`;
}
```

`RunningHubWorkflow` 改为 params 数组，移除旧字段：

```typescript
export type RunningHubWorkflow = {
    id: string;
    name: string;
    workflowId: string;
    outputType: "image" | "video" | "auto";
    instanceType: "default" | "plus";
    params: RunningHubParam[];
};
```

---

## 2. buildNodeInfoList 重写

```typescript
export type RunningHubParamValues = {
    texts: Record<string, string>;    // paramKey → 用户输入的提示词
    images: Record<string, string>;   // paramKey → 上传后的 URL
    booleans: Record<string, string>; // paramKey → "true" | "false"
};

export function buildNodeInfoList(workflow: RunningHubWorkflow, values: RunningHubParamValues): RunningHubNodeInfo[]
```

遍历 `workflow.params`，根据 role 从 values 中取值，组装 `nodeInfoList`。

---

## 3. parseCurlCommand 改为不自动分类

返回原始节点列表 + 建议角色函数：

```typescript
export type ParsedCurlResult = {
    workflowId: string;
    instanceType: "default" | "plus";
    rawNodes: Array<{ nodeId: string; fieldName: string; fieldValue: string; description?: string }>;
};

export function suggestParamRole(node): RunningHubParamRole {
    // fieldName/description 关键词匹配，只做预填建议，用户可改
}
```

---

## 4. 数据格式

不做旧数据迁移。直接移除旧字段（`promptNodeId`/`imageNodeId`/`customNodes`），只保留 `params` 数组。用户需重新配置已有工作流。

---

## 5. Metadata 扩展

`web/src/app/(user)/canvas/types.ts` 新增：

```typescript
runninghubParamValues?: Record<string, string>;  // paramKey → 用户填的值
```

---

## 6. 工作流编辑器重构

`web/src/components/layout/runninghub-workflow-editor.tsx`

### curl 导入改为两步

1. 粘贴 curl → 点击"解析" → 返回 `rawNodes[]`
2. 展示确认表格：每行 nodeId / fieldName / description / 角色选择(Select) / 标签(Input)
   - 角色预填 `suggestParamRole()` 的建议
   - 标签预填 description 或 fieldName
3. 用户确认 → 转为 `RunningHubParam[]` 填入 workflow.params

### 参数列表（替代旧的基础映射+高级模式）

统一的参数表格，每行可编辑：nodeId / fieldName / 角色(Select) / 标签(Input) / 默认值 / 排序 / 删除

---

## 7. 节点面板重构

`web/src/app/(user)/canvas/components/canvas-runninghub-panel.tsx`

根据 workflow.params 动态渲染：
- prompt 角色 → textarea 输入框（带 label）
- boolean 角色 → Switch 开关（带 label）
- image 角色 → 显示连接状态
- fixed/ignore → 不在面板展示

---

## 8. 执行逻辑重构

`web/src/app/(user)/canvas/[id]/canvas-client-page.tsx`

- 从 `runninghubParamValues` 读取文本/布尔值
- 从上游连线收集图片 Blob，按 order 对应到 image 参数
- 新增 `handleRunningHubParamChange` 回调
- `executeRunningHubWorkflow` 签名改为接收 `RunningHubParamValues` + `Map<string,Blob>`

---

## 9. 配置导入导出

`web/src/components/layout/runninghub-workflow-editor.tsx`

在 RunningHub Tab 顶部增加导出/导入按钮：
- **导出**：`{ runninghubApiKey, runninghubWorkflows }` → JSON 文件下载
- **导入**：上传 JSON → 解析 → 覆盖写入 config store

---

## 10. WebDAV 同步

`web/src/services/app-sync.ts`

新增 `"settings"` domain：
- `AppSyncDomainKey` 新增 `"settings"`
- 同步数据：`{ runninghubApiKey, runninghubWorkflows }`
- 不同步渠道 API Key（只同步 RunningHub 配置）
- WebDAV 进度面板新增"配置"行

---

## 11. 改动文件清单

| 文件 | 改动 |
|------|------|
| `web/src/lib/runninghub.ts` | 重写：新类型 + buildNodeInfoList + parseCurlCommand + suggestParamRole |
| `web/src/services/api/runninghub.ts` | 修改 executeRunningHubWorkflow 签名 |
| `web/src/app/(user)/canvas/types.ts` | 新增 `runninghubParamValues` |
| `web/src/components/layout/runninghub-workflow-editor.tsx` | 重写：两步 curl 导入 + 参数表格 + 导入导出 |
| `web/src/app/(user)/canvas/components/canvas-runninghub-panel.tsx` | 重写：动态参数面板 |
| `web/src/app/(user)/canvas/components/canvas-runninghub-node.tsx` | 小改：预览读 paramValues |
| `web/src/app/(user)/canvas/[id]/canvas-client-page.tsx` | 修改执行逻辑 + 新增 paramChange handler |
| `web/src/services/app-sync.ts` | 新增 settings domain 同步 |
| `web/src/components/layout/app-config-modal.tsx` | WebDAV 进度新增配置行 |

---

## 12. 实现顺序

1. **类型 + 核心逻辑** — runninghub.ts 重写
2. **types.ts** — metadata 扩展
3. **API 服务** — executeRunningHubWorkflow 签名更新
4. **工作流编辑器** — 两步 curl 导入 + 参数表格
5. **节点面板** — 动态参数渲染
6. **执行逻辑** — canvas-client-page handler 更新
7. **节点显示** — 预览文本更新
8. **配置导入导出** — JSON 下载/上传
9. **WebDAV 同步** — settings domain

---

## 13. 验证

1. **curl 导入**：粘贴 curl → 确认表格展示所有节点 → 修改角色 → 确认 → 保存
2. **多提示词**：2 个 prompt 参数 → 面板 2 个输入框 → 执行 → 两个都发到 API
3. **多图片**：2 个 image 参数 → 连 2 图 → 执行 → 两张都上传并映射
4. **布尔开关**：boolean 参数 → Switch → 切换 → 确认 "true"/"false" 正确发送
5. **固定参数**：fixed 参数 → 面板不显示 → 执行 → 值被发送
6. **配置导出**：点击导出 → 下载 JSON → 包含 apiKey + workflows
7. **配置导入**：上传 JSON → 配置恢复 → 工作流列表正确
8. **WebDAV 同步**：同步 → 换浏览器 → RunningHub 配置恢复
