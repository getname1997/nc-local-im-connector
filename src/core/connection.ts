/**
 * 本地 IM WebSocket 连接管理
 * 
 * 职责：
 * - 管理 Client 模式下的 WebSocket 长连接
 * - 实现应用层心跳检测（30 秒间隔）
 * - 处理连接重连逻辑，带指数退避
 * - 消息去重（内置 Map，5 分钟 TTL）
 * - 使用 SDK 的 Reply Dispatcher 集成 AI
 * 
 * 核心特性：
 * - 指数退避重连，避免雪崩效应
 * - 使用框架的 Reply Dispatcher（无需配置 gatewayToken）
 * - 详细的消息接收日志
 * - 连接统计和监控
 */

import WebSocket from 'ws';
import type { ResolvedLocalIMAccount, SessionContext } from "../types/index.js";
import { createLoggerFromConfig } from "../utils/logger.js";
import { getLocalIMRuntime } from "../runtime.js";

// ============ 连接配置 ============

/** 心跳间隔（毫秒） */
const HEARTBEAT_INTERVAL = 30 * 1000; // 30 秒
/** 超时阈值（毫秒） */
const TIMEOUT_THRESHOLD = 90 * 1000; // 90 秒（3 次心跳未响应）
/** 基础退避时间（毫秒） */
const BASE_BACKOFF_DELAY = 1000; // 1 秒
/** 最大退避时间（毫秒） */
const MAX_BACKOFF_DELAY = 30 * 1000; // 30 秒
/** 消息去重 TTL（毫秒） */
const MESSAGE_DEDUP_TTL = 5 * 60 * 1000; // 5 分钟

// ============ 消息去重缓存 ============

const messageDedupCache = new Map<string, number>();

/**
 * 检查并标记消息
 * @returns true 表示重复消息，false 表示新消息
 */
function checkAndMarkMessage(messageId: string): boolean {
  const now = Date.now();
  if (messageDedupCache.has(messageId)) {
    return true; // 重复
  }
  messageDedupCache.set(messageId, now);
  
  // 清理过期条目
  for (const [id, time] of messageDedupCache) {
    if (now - time > MESSAGE_DEDUP_TTL) {
      messageDedupCache.delete(id);
    }
  }
  return false;
}

// ============ 会话构建 ============

function buildSessionContext(userId: string, conversationId: string | undefined, accountId: string): SessionContext {
  return {
    channel: 'nc-local-im-connector',
    accountId,
    chatType: 'direct',
    peerId: userId,
    conversationId,
  };
}

// ============ 计算指数退避延迟 ============

function calculateBackoffDelay(attempt: number): number {
  const exponentialDelay = BASE_BACKOFF_DELAY * Math.pow(2, attempt);
  const jitter = Math.random() * 1000; // 0-1 秒随机抖动
  return Math.min(exponentialDelay + jitter, MAX_BACKOFF_DELAY);
}

// ============ Client 模式连接管理 ============

export type MonitorLocalIMOpts = {
  account: ResolvedLocalIMAccount;
  cfg: any;
  abortSignal?: AbortSignal;
  onStatusChange?: (patch: Record<string, unknown>) => void;
  log?: any;
  runtime?: any;
};

/**
 * 监控单个账号（Client 模式）
 * 
 * 使用框架的 Reply Dispatcher 处理消息，无需配置 gatewayToken
 */
export async function monitorSingleAccount(opts: MonitorLocalIMOpts): Promise<void> {
  const { account, cfg, abortSignal, onStatusChange, log: externalLog, runtime } = opts;
  const { accountId, config } = account;

  const logger = createLoggerFromConfig(config, `LocalIM:${accountId}`);
  const log = externalLog || logger;

  // 验证配置
  if (config.connectionMode !== 'client') {
    throw new Error(`[LocalIM][${accountId}] 当前只支持 Client 模式`);
  }

  if (!config.clientWsUrl) {
    throw new Error(`[LocalIM][${accountId}] Client 模式必须配置 clientWsUrl`);
  }

  // 运行时状态
  let wsClient: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let pingTimer: NodeJS.Timeout | null = null;
  let reconnectAttempts = 0;
  let isStopped = false;
  let lastPongTime = Date.now();
  let isReconnecting = false;

  // 消息统计
  let receivedCount = 0;
  let processedCount = 0;
  let lastMessageTime = Date.now();

  // 当前回复分发器
  let currentDispatcher: any = null;
  let accumulatedText = '';
  let isProcessing = false;

  // ============ 辅助函数 ============

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

  const stop = () => {
    if (isStopped) return;
    isStopped = true;
    log.info(`[LocalIM][${accountId}] 停止客户端连接`);
    
    // 停止当前回复
    if (currentDispatcher) {
      try {
        currentDispatcher.stop();
      } catch {}
      currentDispatcher = null;
    }
    
    cleanupClient();
  };

  // ============ 发送消息到 WebSocket ============

  const sendToWebSocket = (type: string, data: any) => {
    if (wsClient?.readyState === WebSocket.OPEN) {
      wsClient.send(JSON.stringify({ type, ...data }));
    }
  };

  // ============ 重连逻辑 ============

  const doReconnect = async (immediate = false) => {
    if (isReconnecting || isStopped) {
      log.debug(`[LocalIM][${accountId}] 正在重连中或已停止，跳过`);
      return;
    }

    isReconnecting = true;

    // 应用指数退避（非立即重连时）
    if (!immediate && reconnectAttempts > 0) {
      const delay = calculateBackoffDelay(reconnectAttempts);
      log.info(`[LocalIM][${accountId}] ⏳ 等待 ${Math.round(delay / 1000)} 秒后重连 (尝试 ${reconnectAttempts + 1})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      cleanupClient();
      await connectClient();
      reconnectAttempts = 0; // 重连成功，重置计数
      onStatusChange?.({ connected: true, lastConnectedAt: Date.now() });
      log.info(`[LocalIM][${accountId}] ✅ 重连成功`);
    } catch (err: any) {
      reconnectAttempts++;
      log.error(`[LocalIM][${accountId}] 重连失败：${err.message} (尝试 ${reconnectAttempts})`);
      // 安排下次重连
      scheduleReconnect();
    } finally {
      isReconnecting = false;
    }
  };

  const scheduleReconnect = () => {
    if (isStopped || reconnectTimer) return;
    
    const delay = calculateBackoffDelay(reconnectAttempts);
    log.info(`[LocalIM][${accountId}] ⏳ ${Math.round(delay / 1000)} 秒后尝试重连...`);
    
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      doReconnect().catch((err) => {
        log.error(`[LocalIM][${accountId}] 重连失败：${err.message}`);
      });
    }, delay);
  };

  // ============ 消息处理 ============

  const handleMessage = async (data: any) => {
    // 优先使用 messageId，如果不存在则生成唯一 ID
    // ⚠️ 不要使用 conversationId 作为消息 ID，因为同一会话的所有消息共享相同的 conversationId
    const messageId = data.messageId || `${data.conversationId || 'unknown'}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const timestamp = new Date().toISOString();

    receivedCount++;
    lastMessageTime = Date.now();

    // 收到消息时报告状态
    onStatusChange?.({ lastInboundAt: Date.now() });

    log.info(`\n========== [LocalIM][${accountId}] 收到新消息 ==========`);
    log.info(`时间：${timestamp}`);
    log.info(`MessageId: ${messageId}`);
    log.info(`用户：${data.userId || 'unknown'}`);
    log.info(`会话：${data.conversationId || 'N/A'}`);
    log.info(`内容长度：${data.content?.length || 0}`);

    // 消息去重（使用 messageId，不是 conversationId）
    if (checkAndMarkMessage(messageId)) {
      processedCount++;
      log.warn(`⚠️ 检测到重复消息，跳过处理：${messageId} (${processedCount}/${receivedCount})`);
      return;
    }

    try {
      const { userId, conversationId, content } = data;
      if (!content) {
        log.warn(`⚠️ 收到无效消息负载，缺少 content 字段`);
        return;
      }

      // 如果正在处理，忽略新消息
      if (isProcessing) {
        log.warn(`⚠️ 正在处理上一条消息，忽略新消息`);
        return;
      }

      isProcessing = true;
      accumulatedText = '';

      // 构建会话上下文
      const sessionContext = buildSessionContext(userId, conversationId, accountId);

      log.info(`🚀 开始处理消息...`);

      try {
        // 获取 SDK Runtime
        const core = getLocalIMRuntime();

        // 构建消息体
        const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
        const envelopeFrom = userId || accountId;

        const body = core.channel.reply.formatAgentEnvelope({
          channel: "nc-local-im-connector",
          from: envelopeFrom,
          timestamp: new Date(),
          envelope: envelopeOptions,
          body: content,
        });

        // 构建 sessionKey
        const dmScope = cfg.session?.dmScope || 'per-channel-peer';
        const sessionKey = core.channel.routing.buildAgentSessionKey({
          agentId: 'main',
          channel: 'nc-local-im-connector',
          accountId: accountId,
          peer: {
            kind: sessionContext.chatType,
            id: sessionContext.sessionPeerId || userId || accountId,
          },
          dmScope: dmScope,
        });

        // 构建 inbound context
        const ctxPayload = core.channel.reply.finalizeInboundContext({
          Body: body,
          BodyForAgent: content,
          RawBody: content,
          CommandBody: content,
          From: userId || accountId,
          To: accountId,
          SessionKey: sessionKey,
          AccountId: accountId,
          ChatType: sessionContext.chatType,
          SenderName: userId,
          SenderId: userId,
          Provider: "nc-local-im-connector" as const,
          Surface: "nc-local-im-connector" as const,
          MessageSid: messageId,
          Timestamp: Date.now(),
          CommandAuthorized: true,
          OriginatingChannel: "nc-local-im-connector" as const,
          OriginatingTo: accountId,
        });

        // 创建 Reply Dispatcher
        let currentAccumulatedText = '';
        let replyComplete = false;
        let replyError: Error | null = null;

        // 导入 channel-runtime 模块（createReplyPrefixOptions）
        const channelRuntime = await import("openclaw/plugin-sdk/channel-runtime") as any;
        const { createReplyPrefixOptions } = channelRuntime;

        // 创建回复前缀选项
        const prefixOptions = createReplyPrefixOptions({
          cfg,
          agentId: 'main',
          channel: 'nc-local-im-connector',
          accountId,
        });

        const { dispatcher, replyOptions, markDispatchIdle } =
          core.channel.reply.createReplyDispatcherWithTyping({
            ...(prefixOptions || {}),
            humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, 'main'),
            onReplyStart: () => {
              log.info(`[LocalIM][${accountId}] AI 开始回复`);
            },
            deliver: async (payload, info) => {
              let text = payload.text ?? '';
              log.debug(`[LocalIM][${accountId}] deliver: kind=${info?.kind}, textLength=${text.length}`);

              if (info?.kind === "final") {
                currentAccumulatedText = text;
                replyComplete = true;
                // 发送到 WebSocket
                sendToWebSocket('done', { conversationId, content: currentAccumulatedText });
                // 回复完成，标记为空闲
                markDispatchIdle();
              } else {
                // 流式更新
                currentAccumulatedText += text;
                accumulatedText = currentAccumulatedText;
                sendToWebSocket('stream', { conversationId, content: currentAccumulatedText });
              }
            },
            onError: async (error, info) => {
              log.error(`[LocalIM][${accountId}] 回复错误: ${String(error)}`);
              replyError = error instanceof Error ? error : new Error(String(error));
              sendToWebSocket('error', { conversationId, error: String(error) });
              markDispatchIdle();
            },
            onIdle: async () => {
              // 回复空闲回调，记录日志
              log.info(`[LocalIM][${accountId}] 回复空闲`);
            },
            onCleanup: () => {
              log.debug(`[LocalIM][${accountId}] 清理`);
            },
          });

        currentDispatcher = dispatcher;

        // 使用 SDK 调度回复
        await core.channel.reply.withReplyDispatcher({
          dispatcher,
          onSettled: () => {
            // 调度结束时也标记一次空闲
            markDispatchIdle();
          },
          run: async () => {
            return await core.channel.reply.dispatchReplyFromConfig({
              ctx: ctxPayload,
              cfg,
              dispatcher,
              replyOptions,
            });
          },
        });

        log.info(`📥 AI 处理完成`);

      } catch (err: any) {
        log.error(`❌ AI 处理失败：${err.message}`);
        sendToWebSocket('error', { conversationId, error: err.message });
        throw err; // 重新抛出，由外层 catch 处理
      }

      processedCount++;
      isProcessing = false;
      currentDispatcher = null;

      log.info(`✅ 消息处理完成 (${processedCount}/${receivedCount})`);

    } catch (err: any) {
      processedCount++;
      isProcessing = false;
      log.error(`❌ 处理消息异常 (${processedCount}/${receivedCount}): ${err.message}`);
      
      // 通知错误
      if (currentDispatcher) {
        try {
          currentDispatcher.onError({ error: err, info: { type: 'message-handler' } });
          currentDispatcher.stop();
        } catch {}
        currentDispatcher = null;
      }

      if (wsClient?.readyState === WebSocket.OPEN) {
        wsClient.send(JSON.stringify({ type: 'error', error: err.message }));
      }
    }
  };

  // ============ 连接逻辑 ============

  const connectClient = async () => {
    if (isStopped) return;

    const { clientWsUrl, gatewayToken, name } = config;

    // 1. 自动拼接 accountId 到 URL 查询参数
    let finalWsUrl = clientWsUrl!;
    if (!finalWsUrl.startsWith('ws://') && !finalWsUrl.startsWith('wss://')) {
      finalWsUrl = `ws://${finalWsUrl}`;
    }

    const urlObj = new URL(finalWsUrl);
    urlObj.searchParams.set('accountId', accountId);
    finalWsUrl = urlObj.toString();

    // 2. 准备请求头
    const options: any = {
      handshakeTimeout: 10000,
      headers: {},
    };

    if (gatewayToken) {
      options.headers['Authorization'] = `Bearer ${gatewayToken}`;
    }

    log.info(`[LocalIM][${accountId}] 正在连接服务端: ${finalWsUrl}`);

    return new Promise<void>((resolve, reject) => {
      try {
        wsClient = new WebSocket(finalWsUrl, options);
        let isAlive = true;

        wsClient.on('open', () => {
          log.info(`[LocalIM][${accountId}] ✅ 成功连接至服务端 [Account: ${accountId}, name: ${name || 'N/A'}]`);
          isAlive = true;
          lastPongTime = Date.now();

          // 启动心跳
          pingTimer = setInterval(() => {
            if (!wsClient || wsClient.readyState !== WebSocket.OPEN) return;
            
            const elapsed = Date.now() - lastPongTime;
            if (elapsed > TIMEOUT_THRESHOLD) {
              log.warn(`[LocalIM][${accountId}] ⚠️ 心跳超时（${Math.round(elapsed / 1000)}s），触发重连...`);
              wsClient.terminate();
              return;
            }

            isAlive = false;
            wsClient.ping();
            log.debug(`[LocalIM][${accountId}] 💓 发送 PING 心跳`);
          }, HEARTBEAT_INTERVAL);

          resolve();
        });

        wsClient.on('pong', () => {
          isAlive = true;
          lastPongTime = Date.now();
          log.debug(`[LocalIM][${accountId}] 收到 PONG 响应`);
        });

        wsClient.on('message', async (msg) => {
          try {
            const data = JSON.parse(msg.toString());
            await handleMessage(data);
          } catch (err: any) {
            log.error(`[LocalIM][${accountId}] 消息解析异常: ${err.message}`);
          }
        });

        wsClient.on('close', (code, reason) => {
          log.warn(`[LocalIM][${accountId}] WebSocket 关闭: code=${code}, reason=${reason || 'unknown'}`);
          
          // 报告断开状态
          onStatusChange?.({ connected: false });
          
          if (!isStopped) {
            cleanupClient();
            scheduleReconnect();
          }
        });

        wsClient.on('error', (err: any) => {
          log.error(`[LocalIM][${accountId}] WebSocket 错误: ${err.message}`);
          reject(err);
        });

      } catch (err: any) {
        reject(err);
      }
    });
  };

  // ============ 统计定时器 ============

  const statsInterval = setInterval(() => {
    const now = Date.now();
    const timeSinceLastMessage = Math.round((now - lastMessageTime) / 1000);
    log.info(
      `[LocalIM][${accountId}] 统计：收到=${receivedCount}, 处理=${processedCount}, ` +
      `丢失=${receivedCount - processedCount}, 距上次消息=${timeSinceLastMessage}s`
    );
  }, 60000); // 每分钟输出一次

  // ============ 启动 ============

  return new Promise<void>((resolve, reject) => {
    // 处理中止信号
    if (abortSignal) {
      const onAbort = () => {
        log.info(`[LocalIM][${accountId}] 收到中止信号，停止连接...`);
        stop();
        clearInterval(statsInterval);
        resolve();
      };
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }

    // 启动连接
    connectClient().then(() => {
      log.info(`[LocalIM][${accountId}] 连接初始化完成`);
    }).catch((err) => {
      log.error(`[LocalIM][${accountId}] 初始连接失败: ${err.message}`);
      scheduleReconnect();
    });
  });
}
