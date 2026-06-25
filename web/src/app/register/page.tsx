import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { message } from "@/lib/message";
import { useUserStore } from "@/stores/use-user-store";

export default function RegisterPage() {
    const user = useUserStore((s) => s.user);
    const register = useUserStore((s) => s.register);
    const [loading, setLoading] = useState(false);
    const [username, setUsername] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [password, setPassword] = useState("");

    if (user) return <Navigate to="/" replace />;

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (username.length < 3) {
            message.error("用户名至少 3 个字符");
            return;
        }
        if (password.length < 6) {
            message.error("密码至少 6 个字符");
            return;
        }
        setLoading(true);
        try {
            await register(username, password, displayName || undefined);
        } catch (error: any) {
            const msg = error.response?.data?.error;
            message.error(msg === "username already exists" ? "用户名已存在" : msg || "注册失败");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex h-dvh items-center justify-center bg-background bg-dot-grid px-6">
            <div className="w-full max-w-sm">
                <div className="mb-8 text-center">
                    <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-xl border border-stone-200 bg-card shadow-sm dark:border-stone-800">
                        <span
                            className="size-7 shrink-0 bg-current"
                            style={{
                                mask: "url(/logo.svg) center / contain no-repeat",
                                WebkitMask: "url(/logo.svg) center / contain no-repeat",
                            }}
                        />
                    </div>
                    <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">注册</h1>
                    <p className="mt-1 text-sm text-stone-500">创建 Infinite Canvas 账号</p>
                </div>
                <div className="rounded-xl border border-stone-200 bg-card p-6 shadow-sm dark:border-stone-800">
                    <form onSubmit={onSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="username">用户名</Label>
                            <Input id="username" className="h-10" placeholder="用户名" autoComplete="username" required minLength={3} value={username} onChange={(e) => setUsername(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="displayName">显示名称</Label>
                            <Input id="displayName" className="h-10" placeholder="可选，默认与用户名相同" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password">密码</Label>
                            <Input id="password" type="password" className="h-10" placeholder="密码" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
                        </div>
                        <Button type="submit" size="lg" className="w-full" disabled={loading}>
                            {loading && <Loader2 className="animate-spin" />}
                            注册
                        </Button>
                    </form>
                </div>
                <p className="mt-4 text-center text-sm text-stone-500">
                    已有账号？
                    <Link to="/login" className="ml-1 font-medium text-stone-900 hover:underline dark:text-stone-100">
                        登录
                    </Link>
                </p>
            </div>
        </div>
    );
}
