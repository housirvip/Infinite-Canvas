import { create } from "zustand";

import { nanoid } from "nanoid";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "../types";
import * as projectApi from "@/services/backend-project";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodeCount?: number;
    connectionCount?: number;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasProjectPatch = Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>;

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    createProject: (title?: string) => Promise<string>;
    importProject: (project: Partial<CanvasProject>) => Promise<string>;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (id: string, patch: CanvasProjectPatch) => void;
    saveProjectNow: (id: string, patch: CanvasProjectPatch) => Promise<void>;
    fetchProjects: () => Promise<void>;
    fetchProject: (id: string) => Promise<CanvasProject | null>;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSaves = new Map<string, Record<string, any>>();

function buildProjectSavePatch(patch: CanvasProjectPatch): Record<string, any> {
    const savePatch: Record<string, any> = {};
    if (patch.nodes !== undefined) savePatch.nodes = patch.nodes;
    if (patch.connections !== undefined) savePatch.connections = patch.connections;
    if (patch.chatSessions !== undefined) savePatch.chatSessions = patch.chatSessions;
    if (patch.activeChatId !== undefined) savePatch.activeChatId = patch.activeChatId;
    if (patch.backgroundMode !== undefined) savePatch.backgroundMode = patch.backgroundMode;
    if (patch.showImageInfo !== undefined) savePatch.showImageInfo = patch.showImageInfo;
    if (patch.viewport !== undefined) {
        savePatch.viewportX = patch.viewport.x;
        savePatch.viewportY = patch.viewport.y;
        savePatch.viewportK = patch.viewport.k;
    }
    return savePatch;
}
function toCanvasProject(full: projectApi.ProjectFull): CanvasProject {
    return {
        id: full.projectId,
        title: full.title,
        createdAt: full.createdAt,
        updatedAt: full.updatedAt,
        nodes: full.nodes || [],
        connections: full.connections || [],
        chatSessions: full.chatSessions || [],
        activeChatId: full.activeChatId || null,
        backgroundMode: (full.backgroundMode || "lines") as CanvasBackgroundMode,
        showImageInfo: full.showImageInfo,
        viewport: { x: full.viewportX, y: full.viewportY, k: full.viewportK || 1 },
    };
}

function debouncedSave(projectId: string, patch: Record<string, any>) {
    const existing = pendingSaves.get(projectId) || {};
    pendingSaves.set(projectId, { ...existing, ...patch });

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        const saves = new Map(pendingSaves);
        pendingSaves.clear();
        saves.forEach((data, id) => {
            projectApi.updateProject(id, data).catch((err) => console.error("[canvas-save] update failed:", id, err?.response?.status, err?.response?.data || err.message));
        });
    }, 400);
}

export const useCanvasStore = create<CanvasStore>()((set, get) => ({
    hydrated: false,
    projects: [],

    fetchProjects: async () => {
        try {
            const { projects: items } = await projectApi.listProjects(1, 100);
            const projects: CanvasProject[] = items.map((item) => ({
                id: item.projectId,
                title: item.title,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
                nodeCount: item.nodeCount || 0,
                connectionCount: item.connectionCount || 0,
                nodes: [],
                connections: [],
                chatSessions: [],
                activeChatId: null,
                backgroundMode: (item.backgroundMode || "lines") as CanvasBackgroundMode,
                showImageInfo: false,
                viewport: initialViewport,
            }));
            set({ projects, hydrated: true });
        } catch {
            set({ hydrated: true });
        }
    },

    fetchProject: async (id) => {
        try {
            const project = toCanvasProject(await projectApi.getProject(id));
            set((state) => ({
                hydrated: true,
                projects: state.projects.some((p) => p.id === id)
                    ? state.projects.map((p) => (p.id === id ? project : p))
                    : [project, ...state.projects],
            }));
            return project;
        } catch {
            set({ hydrated: true });
            return null;
        }
    },

    createProject: async (title = "未命名画布") => {
        const id = nanoid();
        const project = toCanvasProject(
            await projectApi.createProject({
                projectId: id,
                title,
                backgroundMode: "lines",
            }),
        );
        set((state) => ({ projects: [project, ...state.projects] }));
        return project.id;
    },

    importProject: async (source) => {
        const id = nanoid();
        const project = toCanvasProject(
            await projectApi.createProject({
                projectId: id,
                title: source.title || "导入画布",
                backgroundMode: source.backgroundMode || "lines",
                showImageInfo: source.showImageInfo || false,
                viewportX: source.viewport?.x ?? initialViewport.x,
                viewportY: source.viewport?.y ?? initialViewport.y,
                viewportK: source.viewport?.k ?? initialViewport.k,
                activeChatId: source.activeChatId || undefined,
                nodes: source.nodes || [],
                connections: source.connections || [],
                chatSessions: source.chatSessions || [],
            }),
        );
        set((state) => ({ projects: [project, ...state.projects] }));
        return project.id;
    },

    openProject: (id) => {
        return get().projects.find((item) => item.id === id) || null;
    },

    renameProject: (id, title) => {
        set((state) => ({
            projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
        }));
        debouncedSave(id, { title: title.trim() });
    },

    deleteProjects: (ids) => {
        set((state) => ({
            projects: state.projects.filter((project) => !ids.includes(project.id)),
        }));
        ids.forEach((id) => projectApi.deleteProject(id).catch((err) => console.error("[canvas-save] delete failed:", id, err?.response?.status, err?.response?.data || err.message)));
    },

    replaceProjects: (projects) => set({ projects }),

    updateProject: (id, patch) => {
        set((state) => ({
            projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
        }));
        debouncedSave(id, buildProjectSavePatch(patch));
    },

    saveProjectNow: async (id, patch) => {
        set((state) => ({
            projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
        }));
        const pendingPatch = pendingSaves.get(id) || {};
        pendingSaves.delete(id);
        if (!pendingSaves.size && saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        await projectApi.updateProject(id, { ...pendingPatch, ...buildProjectSavePatch(patch) });
    },
}));
