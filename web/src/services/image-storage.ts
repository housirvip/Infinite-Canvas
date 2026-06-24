import { readImageMeta } from "@/lib/image-utils";
import { uploadFile, fileUrl } from "@/services/backend-task";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const tempUrl = URL.createObjectURL(blob);
    const meta = await readImageMeta(tempUrl);
    URL.revokeObjectURL(tempUrl);
    const result = await uploadFile(blob, "image.png");
    const url = fileUrl(result.fileId);
    return { url, storageKey: result.fileId, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    return fileUrl(storageKey);
}

export async function getImageBlob(storageKey: string) {
    try {
        const res = await fetch(fileUrl(storageKey));
        if (!res.ok) return null;
        return await res.blob();
    } catch {
        return null;
    }
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    const result = await uploadFile(blob, "image.png");
    return fileUrl(result.fileId);
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(_keys: Iterable<string>) {
    // Server manages file lifecycle
}

export async function cleanupUnusedImages(_usedData: unknown) {
    // Server manages file lifecycle
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}
