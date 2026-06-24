import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Button, Form, Input, App } from "antd";

import { useUserStore } from "@/stores/use-user-store";

export default function RegisterPage() {
    const user = useUserStore((s) => s.user);
    const register = useUserStore((s) => s.register);
    const [loading, setLoading] = useState(false);
    const { message } = App.useApp();

    if (user) return <Navigate to="/" replace />;

    const onFinish = async (values: { username: string; password: string; displayName?: string }) => {
        setLoading(true);
        try {
            await register(values.username, values.password, values.displayName);
        } catch (error: any) {
            const msg = error.response?.data?.error;
            message.error(msg === "username already exists" ? "用户名已存在" : msg || "注册失败");
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
                    <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">注册</h1>
                    <p className="mt-1 text-sm text-stone-500">创建 Infinite Canvas 账号</p>
                </div>
                <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                    <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
                        <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }, { min: 3, message: "至少 3 个字符" }]}>
                            <Input size="large" placeholder="用户名" autoComplete="username" />
                        </Form.Item>
                        <Form.Item label="显示名称" name="displayName">
                            <Input size="large" placeholder="可选，默认与用户名相同" />
                        </Form.Item>
                        <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }, { min: 6, message: "至少 6 个字符" }]}>
                            <Input.Password size="large" placeholder="密码" autoComplete="new-password" />
                        </Form.Item>
                        <Form.Item className="mb-0">
                            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
                                注册
                            </Button>
                        </Form.Item>
                    </Form>
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
