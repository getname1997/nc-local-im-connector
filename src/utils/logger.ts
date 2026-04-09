/**
 * Local IM Connector 类型定义
 */

import type { ClawdbotConfig } from "openclaw/plugin-sdk";

/**
 * 本地 IM 账号配置
 */
export interface LocalIMAccountConfig {
  /** 账号 ID（用于区分用户/会话） */
  accountId?: string;
  /** 账号名称 */
  name?: string;
  /** 是否启用 */
  enabled?: boolean;
  /** 连接模式: server 或 client */
  connectionMode: 'server' | 'client';
  /** Client 模式下的 WebSocket URL */
  clientWsUrl?: string;
  /** Server 模式下的 WebSocket 端口 */
  wsPort?: number;
  /** Server 模式下的 HTTP 端口 */
  httpPort?: number;
  /** Gateway 认证令牌 */
  gatewayToken?: string;
  /** 令牌类型 */
  tokenType?: 'Bearer' | 'ApiKey';
}

/**
 * 本地 IM 顶层配置
 */
export interface LocalIMConfig {
  /** 是否启用 */
  enabled?: boolean;
  /** 账号 ID（用于区分用户/会话，与外部 IM 系统对应） */
  accountId?: string;
  /** 默认账号 */
  defaultAccount?: string;
  /** 多账号配置 */
  accounts?: Record<string, LocalIMAccountConfig>;
  /** 顶层配置（向后兼容） */
  connectionMode?: 'server' | 'client';
  clientWsUrl?: string;
  wsPort?: number;
  httpPort?: number;
  gatewayToken?: string;
  tokenType?: 'Bearer' | 'ApiKey';
}

/**
 * 解析后的账号信息
 */
export interface ResolvedLocalIMAccount {
  /** 账号 ID */
  accountId: string;
  /** 账号选择来源 */
  selectionSource: 'explicit' | 'explicit-default' | 'mapped-default' | 'fallback';
  /** 是否启用 */
  enabled: boolean;
  /** 是否已配置 */
  configured: boolean;
  /** 账号名称 */
  name?: string;
  /** 合并后的配置 */
  config: LocalIMAccountConfig;
}

/**
 * 会话上下文
 */
export interface SessionContext {
  /** 渠道标识 */
  channel: string;
  /** 账号 ID */
  accountId: string;
  /** 聊天类型 */
  chatType: 'direct' | 'group';
  /** 对方 ID */
  peerId: string;
  /** 会话 ID */
  conversationId?: string;
  /** OpenClaw 会话 ID，用于防止会话超长 */
  sessionId?: string;
  /** 用于 sessionKey 的会话标识 */
  sessionPeerId?: string;
}

/**
 * Gateway 流式通信选项
 */
export interface GatewayOptions {
  /** 用户消息内容 */
  userContent: string;
  /** 会话上下文 */
  sessionContext: SessionContext;
  /** 对方 ID */
  peerId?: string;
  /** Gateway 端口 */
  gatewayPort?: number;
  /** 日志对象 */
  log?: any;
  /** Gateway Token */
  gatewayToken?: string;
  /** Token 类型 */
  tokenType?: 'Bearer' | 'ApiKey';
}

/**
 * 启动上下文
 */
export interface StartContext {
  /** 账号信息 */
  account: ResolvedLocalIMAccount;
  /** 配置 */
  cfg: ClawdbotConfig;
  /** 中止信号 */
  abortSignal?: AbortSignal;
  /** 日志对象 */
  log?: any;
  /** 状态变更回调 */
  onStatusChange?: (patch: Record<string, unknown>) => void;
}

/**
 * 服务器运行时状态
 */
export interface ServerRuntimeState {
  /** WebSocket 服务器 */
  wss?: any;
  /** HTTP 服务器 */
  httpServer?: any;
  /** 心跳定时器 */
  heartbeatInterval?: NodeJS.Timeout;
}

/**
 * 客户端运行时状态
 */
export interface ClientRuntimeState {
  /** WebSocket 客户端 */
  wsClient?: any;
  /** 重连定时器 */
  reconnectTimer?: NodeJS.Timeout;
  /** Ping 定时器 */
  pingTimer?: NodeJS.Timeout;
  /** 当前重连尝试次数 */
  reconnectAttempts: number;
  /** 是否已停止 */
  isStopped: boolean;
}
