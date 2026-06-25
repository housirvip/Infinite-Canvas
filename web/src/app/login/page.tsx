import { useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { message } from "@/lib/message";
import { useUserStore } from "@/stores/use-user-store";

export default function LoginPage() {
    const user = useUserStore((s) => s.user);
    const login = useUserStore((s) => s.login);
    const [loading, setLoading] = useState(false);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");

    if (user) return <Navigate to="/" replace />;

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();
        setLoading(true);
        try {
            await login(username, password);
        } catch (error: any) {
            message.error(error.response?.data?.error || "登录失败");
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
                    <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">登录</h1>
                    <p className="mt-1 text-sm text-stone-500">登录到 Infinite Canvas</p>
                </div>
                <div className="rounded-xl border border-stone-200 bg-card p-6 shadow-sm dark:border-stone-800">
                    <form onSubmit={onSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="username">用户名</Label>
                            <Input id="username" className="h-10" placeholder="用户名" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password">密码</Label>
                            <Input id="password" type="password" className="h-10" placeholder="密码" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                        </div>
                        <Button type="submit" size="lg" className="w-full" disabled={loading}>
                            {loading && <Loader2 className="animate-spin" />}
                            登录
                        </Button>
                    </form>
                </div>
                <p className="mt-4 text-center text-sm text-stone-500">
                    没有账号？
                    <Link to="/register" className="ml-1 font-medium text-stone-900 hover:underline dark:text-stone-100">
                        注册
                    </Link>
                </p>
            </div>
        </div>
    );
}
