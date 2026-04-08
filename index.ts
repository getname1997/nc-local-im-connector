/**
 * Main entry point for Local IM Channel Plugin
 *
 * Based on OpenClaw SDK，参考钉钉插件架构
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { localIMPlugin } from './src/channel.js';
import { setLocalIMRuntime } from './src/runtime.js';

export default function register(api: OpenClawPluginApi) {
    // 存储 runtime 供后续使用
    setLocalIMRuntime(api.runtime);

    api.registerChannel({ plugin: localIMPlugin });
    api.logger?.info('[LocalIM] 本地通信插件已注册 (支持多账号 Client 长连接模式)');
}
