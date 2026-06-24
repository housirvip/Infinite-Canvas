import { uploadFile, fileUrl } from "@/services/backend-task";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

export async function uploadMediaFile(input: string | Blob, prefix = "file"): Promise<UploadedFile> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const ext = prefix === "video" ? "mp4" : prefix === "audio" ? "mp3" : "bin";
    const result = await uploadFile(blob, `${prefix}.${ext}`);
    const url = fileUrl(result.fileId);
    const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
    return { url, storageKey: result.fileId, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta };
}

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    return fileUrl(storageKey);
}

export async function getMediaBlob(storageKey: string) {
    try {
        const res = await fetch(fileUrl(storageKey));
        if (!res.ok) return null;
        return await res.blob();
    } catch {
        return null;
    }
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    const result = await uploadFile(blob, "media.bin");
    return fileUrl(result.fileId);
}

export async function deleteStoredMedia(_keys: Iterable<string>) {
    // Server manages file lifecycle
}

export async function cleanupUnusedMedia(_usedData: unknown) {
    // Server manages file lifecycle
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectMediaStorageKeys(child, keys)) : collectMediaStorageKeys(item, keys)));
    return keys;
}

function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        video.crossOrigin = "anonymous";
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        audio.crossOrigin = "anonymous";
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}
