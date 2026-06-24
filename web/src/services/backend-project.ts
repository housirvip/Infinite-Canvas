import client from "@/services/backend-client";

export type ProjectListItem = {
    id: number;
    projectId: string;
    title: string;
    backgroundMode: string;
    nodeCount: number;
    connectionCount: number;
    createdAt: string;
    updatedAt: string;
};

export type ProjectFull = {
    id: number;
    projectId: string;
    userId: number;
    title: string;
    backgroundMode: string;
    showImageInfo: boolean;
    viewportX: number;
    viewportY: number;
    viewportK: number;
    activeChatId: string;
    nodes: any[];
    connections: any[];
    chatSessions: any[];
    createdAt: string;
    updatedAt: string;
};

export type CreateProjectPayload = {
    projectId?: string;
    title: string;
    backgroundMode?: string;
    showImageInfo?: boolean;
    viewportX?: number;
    viewportY?: number;
    viewportK?: number;
    activeChatId?: string;
    nodes?: any[];
    connections?: any[];
    chatSessions?: any[];
};

export type UpdateProjectPayload = {
    title?: string;
    backgroundMode?: string;
    showImageInfo?: boolean;
    viewportX?: number;
    viewportY?: number;
    viewportK?: number;
    activeChatId?: string;
    nodes?: any[];
    connections?: any[];
    chatSessions?: any[];
};

export async function listProjects(page = 1, pageSize = 50): Promise<{ projects: ProjectListItem[]; total: number }> {
    const res = await client.get("/projects", { params: { page, pageSize } });
    return res.data;
}

export async function createProject(payload: CreateProjectPayload): Promise<ProjectFull> {
    const res = await client.post("/projects", payload);
    return res.data.project;
}

export async function getProject(projectId: string): Promise<ProjectFull> {
    const res = await client.get(`/projects/${projectId}`);
    return res.data.project;
}

export async function updateProject(projectId: string, payload: UpdateProjectPayload): Promise<ProjectFull> {
    const res = await client.put(`/projects/${projectId}`, payload);
    return res.data.project;
}

export async function deleteProject(projectId: string): Promise<void> {
    await client.delete(`/projects/${projectId}`);
}
