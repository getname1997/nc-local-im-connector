/**
 * Local IM Connector Plugin for OpenClaw
 *
 * 基于 OpenClaw SDK 重构，参考钉钉插件架构
 * - 支持多账号配置
 * - 使用 Provider 模式管理连接
 * - 状态报告给框架
 */

import type { ChannelPlugin, ClawdbotConfig } from "openclaw/plugin-sdk";
import {
  DEFAULT_ACCOUNT_ID,
  listLocalIMAccountIds,
  resolveLocalIMAccount,
  resolveDefaultLocalIMAccountId,
} from "./config/accounts.js";
import { monitorLocalIMProvider } from "./core/provider.js";
import { createLogger } from "./utils/logger.js";
import type { ResolvedLocalIMAccount, LocalIMConfig } from "./types/index.ts";

const meta = {
  id: "nc-local-im-connector",
  label: "Local IM",
  selectionLabel: "Local IM (本地通信)",
  docsPath: "/channels/nc-local-im-connector",
  docsLabel: "nc-local-im-connector",
  blurb: "本地 WebSocket/HTTP 连接器，支持 Server 监听模式和 Client 长连接模式。",
  aliases: ["local", "nc"] as string[],
  order: 80,
};

/**
 * 构建默认运行时状态
 */
function createDefaultRuntimeState(accountId: string) {
  return {
    accountId,
    running: false,
    lastStartAt: null as number | null,
    lastStopAt: null as number | null,
    lastError: null as string | null,
    connected: null as boolean | null,
    lastConnectedAt: null as number | null,
    lastInboundAt: null as number | null,
  };
}

/**
 * 检查账号是否已配置
 */
function isAccountConfigured(account: ResolvedLocalIMAccount): boolean {
  return account.configured;
}

/**
 * 描述账号
 */
function describeAccount(account: ResolvedLocalIMAccount) {
  return {
    accountId: account.accountId,
    enabled: account.enabled,
    configured: account.configured,
    name: account.name,
    connectionMode: account.config.connectionMode,
  };
}

/**
 * 检查账号配置（用于状态报告）
 */
function inspectAccount(cfg: ClawdbotConfig, accountId?: string) {
  const account = resolveLocalIMAccount({ cfg, accountId: accountId || DEFAULT_ACCOUNT_ID });
  const { config } = account;

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
    ...account,
    enabled: account.enabled,
    configured,
    tokenStatus: config.gatewayToken ? 'available' : 'missing',
    connectionMode: config.connectionMode,
    endpoint,
  };
}

/**
 * 探测账号状态
 */
async function probeAccount(account: ResolvedLocalIMAccount): Promise<{
  ok: boolean;
  status: string;
  detail: string;
}> {
  const { config, enabled, configured } = account;

  if (!enabled) {
    return { ok: false, status: 'disabled', detail: 'Account is disabled' };
  }

  if (!configured) {
    return { ok: false, status: 'unconfigured', detail: 'Account is not configured' };
  }

  return {
    ok: true,
    status: 'online',
    detail: `${config.connectionMode.toUpperCase()} mode: ${
        config.connectionMode === 'client'
            ? config.clientWsUrl
            : `WS:${config.wsPort}, HTTP:${config.httpPort}`
    }`,
  };
}

/**
 * 规范化目标
 */
function normalizeTarget(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed;
}

/**
 * 检查是否像本地 IM ID
 */
function looksLikeId(raw: string): boolean {
  return typeof raw === 'string' && raw.length > 0 && !raw.includes(' ');
}

// ============ 插件定义 ============

export const localIMPlugin: ChannelPlugin<ResolvedLocalIMAccount> = {
  id: "nc-local-im-connector",
  meta: {
    ...meta,
  },
  pairing: {
    idLabel: "localUserId",
    normalizeAllowEntry: (entry) => entry.trim(),
    notifyApproval: async ({ cfg, id }) => {
      const log = createLogger(false, 'LocalIM:Pairing');
      log.info(`Pairing approved for user: ${id}`);
    },
  },
  capabilities: {
    chatTypes: ["direct"],
    polls: false,
    threads: false,
    media: false,
    reactions: false,
    edit: false,
    reply: false,
  },
  agentPrompt: {
    messageToolHints: () => [
      "- Local IM targeting: omit `target` to reply to the current conversation.",
    ],
  },
  reload: { configPrefixes: ["channels.nc-local-im-connector"] },
  config: {
    listAccountIds: (cfg) => listLocalIMAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveLocalIMAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultLocalIMAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const isDefault = accountId === DEFAULT_ACCOUNT_ID;

      if (isDefault) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            "nc-local-im-connector": {
              ...cfg.channels?.["nc-local-im-connector"],
              enabled,
            },
          },
        };
      }

      const localIMCfg = cfg.channels?.["nc-local-im-connector"] as LocalIMConfig | undefined;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          "nc-local-im-connector": {
            ...localIMCfg,
            accounts: {
              ...localIMCfg?.accounts,
              [accountId]: {
                ...localIMCfg?.accounts?.[accountId],
                enabled,
              },
            },
          },
        },
      };
    },
    deleteAccount: ({ cfg, accountId }) => {
      const isDefault = accountId === DEFAULT_ACCOUNT_ID;

      if (isDefault) {
        const next = { ...cfg } as ClawdbotConfig;
        const nextChannels = { ...cfg.channels };
        delete (nextChannels as Record<string, unknown>)["nc-local-im-connector"];
        if (Object.keys(nextChannels).length > 0) {
          next.channels = nextChannels;
        } else {
          delete next.channels;
        }
        return next;
      }

      const localIMCfg = cfg.channels?.["nc-local-im-connector"] as LocalIMConfig | undefined;
      const accounts = { ...localIMCfg?.accounts };
      delete accounts[accountId];

      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          "nc-local-im-connector": {
            ...localIMCfg,
            accounts: Object.keys(accounts).length > 0 ? accounts : undefined,
          },
        },
      };
    },
    isConfigured: isAccountConfigured,
    describeAccount,
    resolveAllowFrom: ({ cfg, accountId }) => {
      const account = resolveLocalIMAccount({ cfg, accountId });
      return [];
    },
    formatAllowFrom: ({ allowFrom }) => allowFrom.map((e) => String(e).trim()).filter(Boolean),
  },
  security: {
    collectWarnings: ({ cfg, accountId }) => {
      return [];
    },
  },
  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({ cfg, accountId }) => {
      const isDefault = !accountId || accountId === DEFAULT_ACCOUNT_ID;

      if (isDefault) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            "nc-local-im-connector": {
              ...cfg.channels?.["nc-local-im-connector"],
              enabled: true,
            },
          },
        };
      }

      const localIMCfg = cfg.channels?.["nc-local-im-connector"] as LocalIMConfig | undefined;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          "nc-local-im-connector": {
            ...localIMCfg,
            accounts: {
              ...localIMCfg?.accounts,
              [accountId]: {
                ...localIMCfg?.accounts?.[accountId],
                enabled: true,
              },
            },
          },
        },
      };
    },
  },
  messaging: {
    normalizeTarget: (raw) => normalizeTarget(raw) ?? undefined,
    targetResolver: {
      looksLikeId,
      hint: "<userId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async () => [],
    listGroups: async () => [],
    listPeersLive: async () => [],
    listGroupsLive: async () => [],
  },
  status: {
    defaultRuntime: createDefaultRuntimeState(DEFAULT_ACCOUNT_ID) as any,
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account }) => await probeAccount(account),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      // 连接状态和消息时间戳：由 startAccount 里的 onStatusChange 回调写入 runtime
      connected: runtime?.connected ?? undefined,
      lastConnectedAt: runtime?.lastConnectedAt ?? undefined,
      lastInboundAt: runtime?.lastInboundAt ?? undefined,
      probe,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = resolveLocalIMAccount({ cfg: ctx.cfg, accountId: ctx.accountId });

      // 检查账号是否启用和配置
      if (!account.enabled) {
        ctx.log?.info?.(`nc-local-im-connector[${ctx.accountId}] is disabled, skipping startup`);
        return new Promise<void>((resolve) => {
          if (ctx.abortSignal?.aborted) {
            resolve();
            return;
          }
          ctx.abortSignal?.addEventListener('abort', () => resolve(), { once: true });
        });
      }

      if (!account.configured) {
        throw new Error(`Local IM account "${ctx.accountId}" is not properly configured`);
      }

      // 当前版本只支持 Client 模式
      if (account.config.connectionMode !== 'client') {
        ctx.log?.warn?.(`nc-local-im-connector[${ctx.accountId}] Server 模式在当前版本已弃用，请使用 Client 模式`);
        return new Promise<void>((resolve) => {
          if (ctx.abortSignal?.aborted) {
            resolve();
            return;
          }
          ctx.abortSignal?.addEventListener('abort', () => resolve(), { once: true });
        });
      }

      ctx.setStatus({ accountId: ctx.accountId, running: true, lastStartAt: Date.now() });
      ctx.log?.info(`starting nc-local-im-connector[${ctx.accountId}] (mode: client)`);

      // 把 ctx.setStatus 包装成 onStatusChange 回调
      // 注意：ctx.setStatus 是完全替换而非 merge patch，必须先 getStatus() 获取当前快照再合并
      const onStatusChange = (patch: Record<string, unknown>) => {
        const currentSnapshot = ctx.getStatus?.() ?? { accountId: ctx.accountId };
        const nextSnapshot = { ...currentSnapshot, ...patch, accountId: ctx.accountId };
        ctx.setStatus(nextSnapshot as any);
      };

      try {
        return await monitorLocalIMProvider({
          config: ctx.cfg,
          runtime: ctx.runtime,
          abortSignal: ctx.abortSignal,
          accountId: ctx.accountId,
          onStatusChange,
        });
      } catch (err: any) {
        ctx.log?.error(`[nc-local-im-connector][${ctx.accountId}] startAccount error: ${err?.message ?? err}`);
        ctx.setStatus({
          accountId: ctx.accountId,
          running: false,
          lastStopAt: Date.now(),
          lastError: err?.message || String(err),
        });
        throw err;
      }
    },
  },
};

// 导出兼容旧代码的函数
export { resolveLocalIMAccount, listLocalIMAccountIds, resolveDefaultLocalIMAccountId };
export type { ResolvedLocalIMAccount };
