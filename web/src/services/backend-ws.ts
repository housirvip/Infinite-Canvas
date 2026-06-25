import { getAccessToken } from "@/services/backend-client";

type WsMessage = {
    type: string;
    taskId?: string;
    status?: string;
    progress?: number;
    progressText?: string;
    result?: TaskResult;
    error?: string;
};

export type TaskResultFile = {
    fileId: string;
    url: string;
    mimeType: string;
    size: number;
    width?: number;
    height?: number;
};

export type TaskResult = {
    files?: TaskResultFile[];
    upstreamId?: string;
};

type TaskCallback = (msg: WsMessage) => void;
type Unsubscribe = () => void;

const BASE_WS_PATH = "/api/v1/ws";

class BackendWebSocket {
    private ws: WebSocket | null = null;
    private listeners = new Map<string, Set<TaskCallback>>();
    private globalListeners = new Set<TaskCallback>();
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectDelay = 1000;
    private maxReconnectDelay = 30000;
    private shouldConnect = false;

    connect() {
        this.shouldConnect = true;
        this.doConnect();
    }

    disconnect() {
        this.shouldConnect = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.reconnectDelay = 1000;
    }

    onTask(taskId: string, callback: TaskCallback): Unsubscribe {
        let set = this.listeners.get(taskId);
        if (!set) {
            set = new Set();
            this.listeners.set(taskId, set);
        }
        set.add(callback);
        return () => {
            set!.delete(callback);
            if (set!.size === 0) this.listeners.delete(taskId);
        };
    }

    onAnyTask(callback: TaskCallback): Unsubscribe {
        this.globalListeners.add(callback);
        return () => {
            this.globalListeners.delete(callback);
        };
    }

    private doConnect() {
        const token = getAccessToken();
        if (!token || !this.shouldConnect) return;

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const url = `${protocol}//${window.location.host}${BASE_WS_PATH}?token=${encodeURIComponent(token)}`;

        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            this.reconnectDelay = 1000;
        };

        this.ws.onmessage = (event) => {
            try {
                const msg: WsMessage = JSON.parse(event.data);
                if (msg.type === "pong") return;
                if (msg.taskId) {
                    const taskListeners = this.listeners.get(msg.taskId);
                    taskListeners?.forEach((cb) => cb(msg));
                }
                this.globalListeners.forEach((cb) => cb(msg));
            } catch {}
        };

        this.ws.onclose = () => {
            this.ws = null;
            if (this.shouldConnect) {
                this.reconnectTimer = setTimeout(() => {
                    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
                    this.doConnect();
                }, this.reconnectDelay);
            }
        };

        this.ws.onerror = () => {
            this.ws?.close();
        };
    }

    get connected() {
        return this.ws?.readyState === WebSocket.OPEN;
    }
}

export const backendWs = new BackendWebSocket();
