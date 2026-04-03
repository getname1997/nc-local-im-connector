/**
 * Local IM Connector Plugin for OpenClaw
 *
 * 提供本地 WebSocket 和 HTTP 服务，允许外部应用通过标准接口与 OpenClaw 智能体对话。
 * [New] 支持 Client 长连接模式（类似钉钉 Stream 模式），主动连接外部网关并保持心跳。
 *
 * 基于 OpenClaw 2026.3.24-beta.2 SDK 重构
 */

import WebSocket, { WebSocketServer } from 'ws';
import express from 'express';
import * as http from 'http';
import {
  createChatChannelPlugin,
  createChannelPluginBase,
  type OpenClawConfig,
  type PluginRuntime,
  type ChannelConfigSchema,
} from 'openclaw/plugin-sdk/core';

// ============ 类型定义 ============

export interface LocalIMConfig {
  enabled: boolean;
  connectionMode: 'server' | 'client';
  clientWsUrl?: string;
  wsPort?: number;
  httpPort?: number;
  gatewayToken?: string;
  tokenType?: 'Bearer' | 'ApiKey';
}

export interface ResolvedAccount {
  accountId: string;
  config: LocalIMConfig;
  enabled: boolean;
}

interface SessionContext {
  channel: string;
  accountId: string;
  chatType: 'direct' | 'group';
  peerId: string;
  conversationId?: string;
}

interface GatewayOptions {
  userContent: string;
  sessionContext: SessionContext;
  peerId?: string;
  gatewayPort?: number;
  log?: any;
  gatewayToken?: string;
  tokenType?: 'Bearer' | 'ApiKey';
}

// ============ 全局 Runtime ============

let runtime: any | null = null;

export function getRuntime(): any {
  if (!runtime) {
    // 降级尝试从 global 获取 (针对旧版 SDK 兼容)
    const gRt = (globalThis as any).__OPENCLAW_PLUGIN_RUNTIME__;
    if (gRt) return gRt;
    throw new Error('Local IM runtime not initialized');
  }
  return runtime;
}

export function setRuntime(rt: any) {
  runtime = rt;
}

// 活跃连接映射，已废弃

// ============ 配置管理 ============

export function getConfig(cfg: OpenClawConfig): LocalIMConfig {
  try {
    const section = (cfg.channels as any)?.['nc-local-im-connector'];
    if (section && typeof section === 'object') return section;
  } catch (e) {}
  return {
    enabled: true,
    connectionMode: 'server',
    wsPort: 3001,
    httpPort: 3002,
  };
}

function listAccountIds(cfg: OpenClawConfig): string[] {
  try {
    const config = getConfig(cfg);
    if (config.accounts && typeof config.accounts === 'object') {
      return Object.keys(config.accounts);
    }
  } catch (e) {}
  return ['__default__'];
}

function resolveAccount(cfg: OpenClawConfig, accountId?: string | null): ResolvedAccount {
  const config = getConfig(cfg);
  const id = accountId || '__default__';
  if (config.accounts?.[id]) {
    return {
      accountId: id,
      config: { ...config, ...config.accounts[id] },
      enabled: config.accounts[id].enabled !== false,
    };
  }
  return {
    accountId: '__default__',
    config,
    enabled: config.enabled !== false,
  };
}

function defaultAccountId(): string {
  return '__default__';
}

function isConfigured(account: ResolvedAccount): boolean {
  const config = account?.config || {};
  if (config.connectionMode === 'client') {
    return Boolean(config.clientWsUrl);
  }
  return Boolean(config.wsPort && config.httpPort);
}

function describeAccount(account: ResolvedAccount) {
  return {
    accountId: account.accountId,
    name: account.config?.name || 'Local IM',
    enabled: account.enabled,
    configured: account.config?.connectionMode === 'client'
        ? Boolean(account.config?.clientWsUrl)
        : Boolean(account.config?.wsPort && account.config?.httpPort),
  };
}

function inspectAccount(cfg: OpenClawConfig, accountId?: string | null) {
  const account = resolveAccount(cfg, accountId);
  const { config } = account;
  return {
    ...account,
    ..._inspectAccountInternal(config, account.enabled)
  };
}

function _inspectAccountInternal(config: LocalIMConfig, enabled: boolean) {
  let configured = false;
  let endpoint = '';
  if (config.connectionMode === 'client') {
    configured = Boolean(config.clientWsUrl);
    endpoint = config.clientWsUrl || '';
  } else {
    configured = Boolean(config.wsPort && config.httpPort);
    endpoint = `WS: ${config.wsPort}, HTTP: ${config.httpPort}`;
  }

  return {
    enabled,
    configured,
    tokenStatus: config.gatewayToken ? 'available' : 'missing',
    connectionMode: config.connectionMode,
    endpoint,
  };
}

// ============ Session 构建 ============

function buildSessionContext(userId: string, conversationId?: string): SessionContext {
  return {
    channel: 'nc-local-im-connector',
    accountId: '__default__',
    chatType: 'direct',
    peerId: userId,
    conversationId,
  };
}

// ============ Gateway 流式通信 ============

/**
 * 封装与 OpenClaw Gateway 的流式通信
 */
async function* streamFromGateway(options: GatewayOptions): AsyncGenerator<string, void, unknown> {
  const { userContent, sessionContext, peerId, gatewayPort, log, gatewayToken, tokenType = 'Bearer' } = options;
  const rt = getRuntime();
  const port = gatewayPort || rt.gateway?.port || 18789;
  const gatewayUrl = `http://127.0.0.1:${port}/v1/chat/completions`;

  const messages = [
    { role: 'user', content: userContent }
  ];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-OpenClaw-Agent-Id': 'main',
  };

  const memoryUser = `${sessionContext.channel}:${sessionContext.accountId}:${sessionContext.peerId}`;
  headers['X-OpenClaw-Memory-User'] = Buffer.from(memoryUser, 'utf-8').toString('base64');

  if (gatewayToken) {
    if (tokenType === 'Bearer') {
      headers['Authorization'] = `Bearer ${gatewayToken}`;
    } else if (tokenType === 'ApiKey') {
      headers['X-API-Key'] = gatewayToken;
    }
    log?.info?.(`[LocalIM] 使用 ${tokenType} Token 认证`);
  }

  const response = await fetch(gatewayUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'openclaw',
      messages,
      stream: true,
      user: JSON.stringify(sessionContext),
    }),
  });

  if (!response.ok || !response.body) {
    const errText = response.body ? await response.text() : '(no body)';
    if (response.status === 401 || response.status === 403) {
      if (!gatewayToken) {
        throw new Error(`Gateway 认证失败 (${response.status}): Gateway 需要认证，请在插件配置中设置 gatewayToken`);
      } else {
        throw new Error(`Gateway 认证失败 (${response.status}): Token 无效或已过期，请检查 gatewayToken 配置`);
      }
    }
    throw new Error(`Gateway error: ${response.status} - ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;

      try {
        const chunk = JSON.parse(data);
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {}
    }
  }
}

// ============ Channel Plugin 定义 ============

const pluginObject = createChatChannelPlugin<ResolvedAccount>({
  base: createChannelPluginBase({
    id: 'nc-local-im-connector',
    setup: {
      resolveAccount,
      // 注意：setup 中一般不直接提供 listAccountIds，而是在 config 中提供
      defaultAccountId,
      isConfigured,
      describeAccount,
      inspectAccount,
    },
  }),
  // DM 安全配置
  security: {
    dm: {
      channelKey: 'nc-local-im-connector',
      resolvePolicy: () => 'allowlist',
      resolveAllowFrom: () => [],
      defaultPolicy: 'allowlist',
    },
  },
  // 线程配置
  threading: {
    topLevelReplyToMode: 'reply',
    getThreadSessionKeys: async (p: any) => ({
      channel: p.channel,
      accountId: p.accountId,
      threadId: p.threadId || p.messageId,
    }),
  },
  // 出站能力
  outbound: {
    attachedResults: {
      sendText: async (params) => {
        // 由于现在的逻辑是 Inbound 直接返回响应，Outbound 逻辑目前主要用于系统主动推送（若有）
        // 这里暂时保留简单的日志记录，因为 WebSocket 响应已经在 startLocalImServer 中处理了
        return { messageId: `msg_${Date.now()}` };
      },
    },
    base: {
      sendMedia: async (params) => {
        console.warn('sendMedia not implemented in local-im');
      },
    },
  },
  // 状态检查
  status: {
    probe: async (account) => {
      const { configured, enabled, connectionMode, endpoint } = _inspectAccountInternal(account.config, account.enabled);
      return {
        ok: enabled && configured,
        status: enabled ? (configured ? 'online' : 'unconfigured') : 'disabled',
        detail: `${connectionMode.toUpperCase()} mode: ${endpoint}`,
      };
    }
  },
  // 绑定配置
  bindings: {
    getAccountBindings: async () => [],
    getConversationBindings: async () => [],
    listConfiguredBindings: async () => [],
  },
  // 启动服务逻辑
  gateway: {
    startAccount: async (ctx: any) => {
      console.log('>>> [LocalIM] gateway.startAccount 被调用了！');
      const startResult = await startLocalImServer({
        account: ctx.account,
        cfg: ctx.cfg,
        abortSignal: ctx.abortSignal,
        log: ctx.log || ctx.runtime?.logger,
      });
      (ctx as any)._stop = startResult.stop;
      return startResult;
    },
    stopAccount: async (ctx: any) => {
      console.log('>>> [LocalIM] gateway.stopAccount 被调用了！');
      if ((ctx as any)._stop) {
        (ctx as any)._stop();
      }
    }
  },
  start: startLocalImServer,
  // 兼容性字段：在某些版本中，start 必须在 plugin 对象的一级属性中
  plugin: {
    start: startLocalImServer,
  }
});

// 强制显式注入 config 适配器和 setRuntime
// 这是为了确保在 createChatChannelPlugin 可能忽略某些字段的情况下，插件对象仍然符合 ChannelPlugin 接口
export const ncLocalImPlugin: any = {
  ...pluginObject,
  start: startLocalImServer,
  gateway: pluginObject.gateway,
  config: {
    listAccountIds,
    resolveAccount,
    defaultAccountId,
    isConfigured,
    describeAccount,
    inspectAccount,
  },
  configSchema: {
    schema: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          default: true,
          description: "启用或禁用本地 IM 连接器"
        },
        connectionMode: {
          type: "string",
          enum: ["server", "client"],
          default: "client",
          description: "运行模式 (Server: 本地监听 / Client: 主动连接外部服务)"
        },
        clientWsUrl: {
          type: "string",
          default: "ws://192.168.100.168:8080",
          description: "Client 模式下要连接的 WebSocket 地址"
        },
        wsPort: {
          type: "number",
          default: 3001,
          description: "Server 模式下 WebSocket 服务端口"
        },
        httpPort: {
          type: "number",
          default: 3002,
          description: "Server 模式下 HTTP 服务端口"
        },
        gatewayToken: {
          type: "string",
          description: "Gateway 认证令牌"
        },
        tokenType: {
          type: "string",
          enum: ["Bearer", "ApiKey"],
          default: "Bearer",
          description: "令牌类型"
        }
      }
    }
  },
  setRuntime,
};

// ============ 服务启动逻辑 ============

export interface ServerRuntimeState {
  wss?: WebSocketServer;
  httpServer?: http.Server;
  heartbeatInterval?: NodeJS.Timeout;
}

export interface ClientRuntimeState {
  wsClient?: WebSocket;
  reconnectTimer?: NodeJS.Timeout;
  pingTimer?: NodeJS.Timeout;
}

export interface StartContext {
  account: ResolvedAccount;
  cfg: OpenClawConfig;
  abortSignal?: AbortSignal;
  log?: any;
}

export async function startLocalImServer(ctx: StartContext): Promise<{ stop: () => void; isHealthy: () => boolean }> {
  console.log('>>> [LocalIM] startLocalImServer 被调用了！');
  const { account, cfg, abortSignal, log } = ctx;
  console.log('>>> [LocalIM] 启动配置:', JSON.stringify(account.config));
  log?.info(`[LocalIM-Server] 正在启动服务...`);
  const config = account.config;
  const mode = config.connectionMode || 'server';

  // 这里的 start 方法是 SDK 传入的，确保我们在 runtime 里存一份，方便后续使用
  // 注意：在 SDK 2026.3 版本中，start 可能由 runtime 调用，
  // 我们已经在 index.ts 中通过 registerFull 等待 runtime 初始化了。
  // 但在 start 方法里直接使用 ctx 也是标准做法。

  let stopped = false;
  let doStop = (reason: string) => {};

  if (mode === 'server') {
    // ==========================================
    // SERVER 模式：本地监听 (增强版：附带长连接心跳与 SSE 支持)
    // ==========================================
    const wsPort = config.wsPort || 3001;
    const httpPort = config.httpPort || 3002;
    log?.info(`[LocalIM-Server] 正在启动服务... (WS: ${wsPort}, HTTP: ${httpPort})`);

    // 1. WebSocket 服务 (带长连接心跳)
    const wss = new WebSocketServer({ port: wsPort });
    const aliveClients = new WeakSet<WebSocket>();

    // 服务端心跳检测：每 30 秒清理一次断开的死连接
    const heartbeatInterval = setInterval(() => {
      wss.clients.forEach((ws) => {
        if (!aliveClients.has(ws)) return ws.terminate();
        aliveClients.delete(ws);
        ws.ping();
      });
    }, 30000);

    wss.on('connection', (ws) => {
      aliveClients.add(ws);
      ws.on('pong', () => aliveClients.add(ws)); // 收到 pong 则更新活跃状态

      ws.on('message', async (msg) => {
        try {
          const data = JSON.parse(msg.toString());
          const { userId, conversationId, content } = data;
          if (!userId || !content) return ws.send(JSON.stringify({ error: 'invalid payload' }));

          log?.info(`[LocalIM-Server] 收到消息: from=${userId}, conv=${conversationId}, len=${content.length}`);

          const sessionContext = buildSessionContext(userId, conversationId);
          let reply = '';

          for await (const chunk of streamFromGateway({
            userContent: content,
            sessionContext,
            peerId: userId,
            gatewayPort: cfg.gateway?.port,
            log,
            gatewayToken: config.gatewayToken,
            tokenType: config.tokenType || 'Bearer',
          })) {
            reply += chunk;
            ws.send(JSON.stringify({ type: 'stream', conversationId, content: reply }));
          }
          ws.send(JSON.stringify({ type: 'done', conversationId, content: reply }));
        } catch (err: any) {
          log?.error(`[LocalIM-Server] WS 处理错误: ${err.message}`);
          ws.send(JSON.stringify({ error: err.message }));
        }
      });

      ws.on('close', () => {
        // 清理活跃连接？需要知道是哪个 userId，比较麻烦，暂且让它在 outbound 时失败或覆盖
      });
    });

    // 2. HTTP 服务 (增加 SSE 接口支持长连接)
    const app = express();
    app.use(express.json());

    // 原有 REST 接口：等待完成后返回
    app.post('/chat', async (req, res) => {
      const { userId, conversationId, content } = req.body;
      if (!userId || !content) return res.status(400).json({ error: 'invalid params' });

      const sessionContext = buildSessionContext(userId, conversationId);
      let reply = '';
      try {
        for await (const chunk of streamFromGateway({
          userContent: content, sessionContext, peerId: userId, gatewayPort: cfg.gateway?.port,
          log, gatewayToken: config.gatewayToken, tokenType: config.tokenType || 'Bearer'
        })) { reply += chunk; }
        res.json({ reply });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // 新增 SSE 接口：支持单向 HTTP 长连接流式输出
    app.post('/chat/stream', async (req, res) => {
      const { userId, conversationId, content } = req.body;
      if (!userId || !content) return res.status(400).json({ error: 'invalid params' });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const sessionContext = buildSessionContext(userId, conversationId);
      try {
        for await (const chunk of streamFromGateway({
          userContent: content, sessionContext, peerId: userId, gatewayPort: cfg.gateway?.port,
          log, gatewayToken: config.gatewayToken, tokenType: config.tokenType || 'Bearer'
        })) {
          res.write(`data: ${JSON.stringify({ type: 'stream', conversationId, chunk })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ type: 'done', conversationId })}\n\n`);
        res.end();
      } catch (err: any) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    });

    const httpServer = http.createServer(app);
    httpServer.listen(httpPort);
    log?.info(`[LocalIM-Server] 服务启动成功！`);

    doStop = (reason: string) => {
      if (stopped) return;
      stopped = true;
      log?.info(`[LocalIM-Server] 停止服务 (${reason})...`);
      clearInterval(heartbeatInterval);
      try { wss.close(); httpServer.close(); } catch (err: any) {}
    };

  } else if (mode === 'client') {

    log?.info(`[LocalIM-Server] 正在启动服务...`);
    // ==========================================
    // CLIENT 模式：主动长连接 (参考钉钉 Stream 模式)
    // ==========================================
    let wsClient: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let pingTimer: NodeJS.Timeout | null = null;
    let tryProtocols = config.gatewayToken ? [config.gatewayToken] : undefined;

    const doStop = (reason: string) => {
      if (stopped) return;
      stopped = true;
      log?.info(`[LocalIM-Client] 停止客户端长连接 (${reason})...`);
      cleanupClient();
    };

    const cleanupClient = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (wsClient) {
        wsClient.removeAllListeners();
        try {
          if (wsClient.readyState !== WebSocket.CLOSED) {
            wsClient.terminate();
          }
        } catch (e) {}
        wsClient = null;
      }
    };

    const scheduleReconnect = () => {
      if (stopped) return;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      log?.info('[LocalIM-Client] 5秒后尝试断线重连...');
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectClient();
      }, 5000);
    };

    const connectClient = () => {
      if (stopped) return;
      cleanupClient();

      const clientWsUrl = config.clientWsUrl;
      if (!clientWsUrl) {
        log?.error('[LocalIM-Client] 未配置 clientWsUrl，无法启动长连接');
        return;
      }

      let finalWsUrl = clientWsUrl;
      if (!finalWsUrl.startsWith('ws://') && !finalWsUrl.startsWith('wss://')) {
        finalWsUrl = `ws://${finalWsUrl}`;
      }

      const options: any = { handshakeTimeout: 10000 };
      if (config.gatewayToken) {
        options.headers = { 'Authorization': `Bearer ${config.gatewayToken}` };
      }

      log?.info(`[LocalIM-Client] 尝试长连接至: ${finalWsUrl}`);
      try {
        log?.debug(`[LocalIM-Client] WebSocket 实例化: url=${finalWsUrl}, protocols=${JSON.stringify(tryProtocols)}`);
        wsClient = new WebSocket(finalWsUrl, tryProtocols, options);

        let isAlive = true;

        wsClient.on('unexpected-response', (req, res) => {
          if (res.statusCode === 400 && tryProtocols) {
            log?.warn(`[LocalIM-Client] 服务端拒绝了 subprotocol (${res.statusCode})，尝试无协议重连...`);
            tryProtocols = undefined;
            cleanupClient();
            scheduleReconnect();
          }
        });

        wsClient.on('open', () => {
          log?.info('[LocalIM-Client] 长连接建立成功' + (tryProtocols ? ' (带认证协议)' : ' (无协议)'));
          isAlive = true;
          pingTimer = setInterval(() => {
            if (!wsClient || wsClient.readyState !== WebSocket.OPEN) return;
            if (isAlive === false) {
              log?.warn('[LocalIM-Client] 心跳超时，正在断开连接...');
              wsClient.terminate();
              return;
            }
            isAlive = false;
            wsClient.ping();
          }, 30000);
        });

        wsClient.on('pong', () => { isAlive = true; });

        wsClient.on('message', async (msg) => {
          try {
            const data = JSON.parse(msg.toString());
            const { userId, conversationId, content } = data;
            if (!userId || !content) {
              log?.warn(`[LocalIM-Client] 收到无效消息负载: ${msg.toString().slice(0, 100)}`);
              return;
            }

            log?.info(`[LocalIM-Client] 收到消息: from=${userId}, conv=${conversationId}, len=${content.length}`);

            const sessionContext = buildSessionContext(userId, conversationId);
            let reply = '';

            for await (const chunk of streamFromGateway({
              userContent: content, sessionContext, peerId: userId, gatewayPort: cfg.gateway?.port,
              log, gatewayToken: config.gatewayToken, tokenType: config.tokenType || 'Bearer'
            })) {
              reply += chunk;
              if (wsClient?.readyState === WebSocket.OPEN) {
                wsClient.send(JSON.stringify({ type: 'stream', conversationId, content: reply }));
              }
            }
            if (wsClient?.readyState === WebSocket.OPEN) {
              wsClient.send(JSON.stringify({ type: 'done', conversationId, content: reply }));
            }
          } catch (err: any) {
            log?.error(`[LocalIM-Client] 消息处理异常: ${err.message}`);
            if (wsClient?.readyState === WebSocket.OPEN) {
              wsClient.send(JSON.stringify({ error: err.message }));
            }
          }
        });

        wsClient.on('close', (code, reason) => {
          log?.warn(`[LocalIM-Client] 长连接已断开: code=${code}, reason=${reason}`);
          cleanupClient();
          scheduleReconnect();
        });

        wsClient.on('error', (err: any) => {
          log?.error(`[LocalIM-Client] WebSocket 异常: ${err.message}`);
          if (err.message?.includes('subprotocol') && tryProtocols) {
             tryProtocols = undefined;
          }
          cleanupClient();
          scheduleReconnect();
        });
      } catch (err: any) {
        log?.error(`[LocalIM-Client] 创建连接失败: ${err.message}`);
        scheduleReconnect();
      }
    };

    connectClient();
  }

  const rt = getRuntime();
  if (rt?.channel?.activity?.record) {
    rt.channel.activity.record('nc-local-im-connector', account.accountId, 'start');
  } else {
    log?.debug('[LocalIM] Runtime activity recorder not available, skipping recording.');
  }

  return Promise.resolve({
    stop: () => doStop('manual'),
    isHealthy: () => !stopped,
  });
}
