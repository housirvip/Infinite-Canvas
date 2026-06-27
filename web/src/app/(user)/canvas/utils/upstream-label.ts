import { CanvasNodeType } from "../types";

export type UpstreamNode = { id: string; title: string; type: CanvasNodeType; content?: string };

export function upstreamLabel(node: UpstreamNode, index: number): string {
    if (node.type === CanvasNodeType.Text) return `文本${index + 1}`;
    if (node.type === CanvasNodeType.Image) return `图片${index + 1}`;
    if (node.type === CanvasNodeType.Video) return `视频${index + 1}`;
    if (node.type === CanvasNodeType.Audio) return `音频${index + 1}`;
    return node.title || node.id.slice(0, 8);
}
