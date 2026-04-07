/**
 * Main entry point for Local IM Channel Plugin
 *
 * Based on OpenClaw 2026.3.24-beta.2 SDK
 */

import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/core';
import { ncLocalImPlugin } from './src/channel.js';

export default defineChannelPluginEntry({
    id: 'nc-local-im-connector',
    name: 'Local IM Connector',
    description: 'Provide local WebSocket/HTTP endpoints and Outbound Stream connection to chat with OpenClaw agents. Supports both Server (listening) and Client (long-connection) modes.',
    plugin: ncLocalImPlugin,
    // start: ncLocalImPlugin.start,
    registerCliMetadata(api) {
        api.registerCli(
            ({ program }) => {
                program
                    .command("nc-local-im-connector")
                    .description("Acme Chat management");
            },
            {
                descriptors: [
                    {
                        name: 'local-im',
                        description: 'Local IM connector management',
                        hasSubcommands: false,
                    },
                ],
            },
        );
    },

    registerFull(api) {
        // 注入运行时实例，供插件内部使用
        (globalThis as any).__OPENCLAW_PLUGIN_RUNTIME__ = api;

        // 直接使用导入的插件对象设置 runtime
        if (ncLocalImPlugin && (ncLocalImPlugin as any).setRuntime) {
            (ncLocalImPlugin as any).setRuntime(api);
        }

        // Register gateway method for status check
        api.registerGatewayMethod('nc-local-im-connector.status', async ({ respond }: any) => {
            api.logger?.info('看一下');
            respond(true, { ok: true, timestamp: new Date().toISOString() });
        });

        // Register HTTP routes for inbound messages
        api.registerHttpRoute({
            path: '/local-im/webhook',
            auth: 'plugin',
            handler: async (req, res) => {
                // This endpoint can be used for receiving webhook-style messages
                // Message dispatching would be handled here
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ status: 'ok' }));
                return true;
            },
        });

        api.logger?.info('[LocalIM] 本地通信插件已注册 (支持 Server/Client 双向长连接模式)');

        // 调试：检查 start 方法
        if (ncLocalImPlugin && ncLocalImPlugin.start) {
            api.logger?.info('[LocalIM] ncLocalImPlugin.start 方法存在');
            // 尝试在这里直接调用 (实验性)
            // 但此时 cfg 可能还没完全加载，或者 account 还没准备好
        } else {
            api.logger?.error('[LocalIM] ncLocalImPlugin.start 方法缺失！');
        }

        // 强制检查配置并尝试启动 (如果 OpenClaw 没调用 start)
        // setTimeout(async () => {
        //     const cfg = (api as any).config || {};
        //
        //     // 尝试从 global config 中获取账号
        //     const section = cfg.channels?.['nc-local-im-connector'] || {};
        //     const isEnabled = section.enabled !== false;
        //     api.logger?.info(`[LocalIM] Fallback 检查: enabled=${section.enabled}, isEnabled=${isEnabled}`);
        //
        //     if (isEnabled) {
        //         api.logger?.info('[LocalIM] 正在尝试 Fallback 启动流程...');
        //
        //         try {
        //             // 1. 获取所有账号 ID
        //             const accountId = await ncLocalImPlugin.config.listAccountIds(cfg);
        //             api.logger?.info(`[LocalIM] 发现账号列表: ${JSON.stringify(accountId)}`);
        //
        //             api.logger?.info(`[LocalIM] 准备启动账号: ${accountId}`);
        //             const account = await ncLocalImPlugin.config.resolveAccount(cfg, accountId);
        //             const startCtx = {
        //                 account,
        //                 cfg,
        //                 log: api.logger,
        //                 runtime: (api as any).runtime || {}
        //             };
        //
        //             if (ncLocalImPlugin.gateway && ncLocalImPlugin.gateway.startAccount) {
        //                 api.logger?.info(`[LocalIM] 通过 gateway.startAccount 启动: ${accountId}`);
        //                 await ncLocalImPlugin.gateway.startAccount(startCtx);
        //             } else {
        //                 api.logger?.info(`[LocalIM] 通过直接 start 启动: ${accountId}`);
        //                 await ncLocalImPlugin.start(startCtx);
        //             }
        //
        //         } catch (e: any) {
        //             api.logger?.error(`[LocalIM] Fallback 启动过程异常: ${e.message}\n${e.stack}`);
        //         }
        //     }
        // }, 15000);
    },
});
