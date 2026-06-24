import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Button, Form, Input, App } from "antd";

import { useUserStore } from "@/stores/use-user-store";

export default function LoginPage() {
    const user = useUserStore((s) => s.user);
    const login = useUserStore((s) => s.login);
    const [loading, setLoading] = useState(false);
    const { message } = App.useApp();

    if (user) return <Navigate to="/" replace />;

    const onFinish = async (values: { username: string; password: string }) => {
        setLoading(true);
        try {
            await login(values.username, values.password);
        } catch (error: any) {
            message.error(error.response?.data?.error || "登录失败");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex h-dvh items-center justify-center bg-background bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.16)_1px,transparent_1px)]">
            <div className="w-full max-w-sm">
                <div className="mb-8 text-center">
                    <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-xl border border-stone-200 bg-white text-xl font-bold shadow-sm dark:border-stone-800 dark:bg-stone-900">
                        IC
                    </div>
                    <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">登录</h1>
                    <p className="mt-1 text-sm text-stone-500">登录到 Infinite Canvas</p>
                </div>
                <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                    <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
                        <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}>
                            <Input size="large" placeholder="用户名" autoComplete="username" />
                        </Form.Item>
                        <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
                            <Input.Password size="large" placeholder="密码" autoComplete="current-password" />
                        </Form.Item>
                        <Form.Item className="mb-0">
                            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
                                登录
                            </Button>
                        </Form.Item>
                    </Form>
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
