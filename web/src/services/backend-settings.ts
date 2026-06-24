import client from "@/services/backend-client";

export async function getSettings(): Promise<Record<string, unknown>> {
    const res = await client.get("/settings");
    return res.data.settings || {};
}

export async function updateSettings(settings: Record<string, unknown>): Promise<void> {
    await client.put("/settings", { settings });
}
