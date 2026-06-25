import { create } from "zustand";

import { nanoid } from "nanoid";
import client from "@/services/backend-client";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
    fetchAssets: () => Promise<void>;
    reset: () => void;
};

let assetFetchPromise: Promise<void> | null = null;
let assetVersion = 0;

function toServerAsset(asset: Asset) {
    return {
        assetId: asset.id,
        kind: asset.kind,
        title: asset.title,
        tags: JSON.stringify(asset.tags || []),
        note: asset.note || "",
        data: JSON.stringify(asset.data),
    };
}

function fromServerAsset(raw: any): Asset {
    let data: any = {};
    try { data = typeof raw.data === "string" ? JSON.parse(raw.data) : raw.data || {}; } catch { data = {}; }
    let tags: string[] = [];
    try { tags = typeof raw.tags === "string" ? JSON.parse(raw.tags) : raw.tags || []; } catch { tags = []; }

    const base = {
        id: raw.assetId || raw.id?.toString(),
        kind: raw.kind,
        title: raw.title || "",
        coverUrl: "",
        tags,
        note: raw.note || "",
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
    };

    if (raw.kind === "image") {
        const url = data.storageKey ? `/api/v1/files/${data.storageKey}` : data.dataUrl || "";
        return { ...base, kind: "image", coverUrl: url, data: { ...data, dataUrl: url } } as ImageAsset;
    }
    if (raw.kind === "video") {
        const url = data.storageKey ? `/api/v1/files/${data.storageKey}` : data.url || "";
        return { ...base, kind: "video", coverUrl: "", data: { ...data, url } } as VideoAsset;
    }
    return { ...base, kind: "text", data: data || { content: "" } } as TextAsset;
}

export const useAssetStore = create<AssetStore>()((set, get) => ({
    hydrated: false,
    assets: [],

    fetchAssets: async () => {
        if (get().hydrated) return;
        if (assetFetchPromise) {
            await assetFetchPromise;
            return;
        }

        const version = assetVersion;
        assetFetchPromise = (async () => {
            try {
                const res = await client.get("/assets", { params: { pageSize: 100 } });
                const assets: Asset[] = (res.data.assets || []).map(fromServerAsset);
                if (version === assetVersion) set({ assets, hydrated: true });
            } catch {
                if (version === assetVersion) set({ hydrated: true });
            } finally {
                assetFetchPromise = null;
            }
        })();

        await assetFetchPromise;
    },

    addAsset: (asset) => {
        const now = new Date().toISOString();
        const id = nanoid();
        const full = { ...asset, id, createdAt: now, updatedAt: now } as Asset;
        set((state) => ({ assets: [full, ...state.assets] }));
        client.post("/assets", toServerAsset(full)).catch(() => {});
        return id;
    },

    updateAsset: (id, patch) => {
        set((state) => ({
            assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
        }));
        const updated = get().assets.find((a) => a.id === id);
        if (updated) {
            client.put(`/assets/${id}`, {
                title: updated.title,
                tags: JSON.stringify(updated.tags || []),
                note: updated.note || "",
                data: JSON.stringify(updated.data),
            }).catch(() => {});
        }
    },

    removeAsset: (id) => {
        set((state) => ({
            assets: state.assets.filter((asset) => asset.id !== id),
        }));
        client.delete(`/assets/${id}`).catch(() => {});
    },

    replaceAssets: (assets) => set({ assets, hydrated: true }),

    cleanupImages: () => {},

    reset: () => {
        assetVersion += 1;
        assetFetchPromise = null;
        set({ assets: [], hydrated: false });
    },
}));
