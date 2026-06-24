import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { readFileSync } from "fs";

const localVersion = readFileSync(resolve(__dirname, "../VERSION"), "utf8").trim() || "dev";

let localReleases = "[]";
try {
    const changelog = readFileSync(resolve(__dirname, "../CHANGELOG.md"), "utf8");
    const releases = changelog
        .split(/^## /m)
        .slice(1)
        .map((block) => {
            const [title = "", ...lines] = block.trim().split("\n");
            const [, version = title.trim(), date = ""] = title.match(/^(.+?)(?:\s+-\s+(.+))?$/) || [];
            return {
                version: version.trim(),
                date: date.trim(),
                items: lines
                    .map((line) => line.trim().match(/^\+\s+\[(.+?)\]\s+(.+)$/))
                    .filter((match): match is RegExpMatchArray => Boolean(match))
                    .map((match) => ({ type: match[1], content: match[2] })),
            };
        })
        .filter((r) => r.items.length);
    localReleases = JSON.stringify(releases);
} catch {}

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": resolve(__dirname, "src"),
        },
    },
    define: {
        "process.env.NEXT_PUBLIC_APP_VERSION": JSON.stringify(localVersion),
        "process.env.NEXT_PUBLIC_APP_RELEASES": JSON.stringify(localReleases),
        "process.env.NEXT_PUBLIC_DOC_URL": JSON.stringify(process.env.VITE_DOC_URL || "https://docs.canvas.best"),
    },
    server: {
        host: "0.0.0.0",
        port: 3030,
        proxy: {
            "/api/v1": {
                target: "http://localhost:3040",
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: "dist",
        sourcemap: false,
    },
    css: {
        postcss: "./postcss.config.mjs",
    },
});
