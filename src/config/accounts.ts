/**
 * 账号配置解析
 * 
 * 参考钉钉插件的 accounts.ts 实现
 */

import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import type { LocalIMConfig, LocalIMAccountConfig, ResolvedLocalIMAccount } from "../types/index.ts";

/** 默认账号 ID */
export const DEFAULT_ACCOUNT_ID = '__default__';

/**
 * 规范化账号 ID
 */
function normalizeAccountId(id: string): string {
  return id.trim().toLowerCase();
}

/**
 * 列出所有配置的账号 ID
 */
function listConfiguredAccountIds(cfg: ClawdbotConfig): string[] {
  const accounts = (cfg.channels?.["nc-local-im-connector"] as LocalIMConfig)?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [];
  }
  return Object.keys(accounts).filter(Boolean);
}

/**
 * 列出所有账号 ID
 * 优先使用 accounts 数组中的 accountId，否则使用顶层配置的 accountId
 */
export function listLocalIMAccountIds(cfg: ClawdbotConfig): string[] {
  const localIMCfg = cfg.channels?.["nc-local-im-connector"] as LocalIMConfig | undefined;
  const accounts = localIMCfg?.accounts;
  
  if (accounts && typeof accounts === 'object' && Object.keys(accounts).length > 0) {
    // 使用 accounts 数组中的 accountId
    return Object.keys(accounts).filter(Boolean);
  }
  
  // 如果没有配置 accounts，使用顶层配置的 accountId
  if (localIMCfg?.accountId) {
    return [localIMCfg.accountId];
  }
  
  // 默认账号 ID
  return [DEFAULT_ACCOUNT_ID];
}

/**
 * 解析默认账号选择
 */
export function resolveDefaultLocalIMAccountSelection(cfg: ClawdbotConfig): {
  accountId: string;
  source: 'explicit-default' | 'mapped-default' | 'fallback';
} {
  const localIMCfg = cfg.channels?.["nc-local-im-connector"] as LocalIMConfig | undefined;
  
  // 1. 优先使用顶层配置的 accountId
  if (localIMCfg?.accountId) {
    return {
      accountId: normalizeAccountId(localIMCfg.accountId),
      source: "explicit-default",
    };
  }
  
  // 2. 其次使用 defaultAccount
  const preferredRaw = localIMCfg?.defaultAccount?.trim();
  const preferred = preferredRaw ? normalizeAccountId(preferredRaw) : undefined;
  if (preferred) {
    return {
      accountId: preferred,
      source: "explicit-default",
    };
  }
  
  // 3. 使用 listLocalIMAccountIds 返回的第一个
  const ids = listLocalIMAccountIds(cfg);
  return {
    accountId: ids[0] ?? DEFAULT_ACCOUNT_ID,
    source: "fallback",
  };
}

/**
 * 解析默认账号 ID
 */
export function resolveDefaultLocalIMAccountId(cfg: ClawdbotConfig): string {
  return resolveDefaultLocalIMAccountSelection(cfg).accountId;
}

/**
 * 获取账号特定配置
 */
function resolveAccountConfig(
  cfg: ClawdbotConfig,
  accountId: string,
): LocalIMAccountConfig | undefined {
  const accounts = (cfg.channels?.["nc-local-im-connector"] as LocalIMConfig)?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  return accounts[accountId];
}

/**
 * 合并顶层配置和账号特定配置
 * 账号特定字段覆盖顶层字段
 */
function mergeLocalIMAccountConfig(cfg: ClawdbotConfig, accountId: string): LocalIMAccountConfig {
  const localIMCfg = cfg.channels?.["nc-local-im-connector"] as LocalIMConfig | undefined;

  // 提取基础配置（排除 accounts 字段以避免递归）
  const { accounts: _ignored, defaultAccount: _ignoredDefaultAccount, ...base } = localIMCfg ?? {};

  // 获取账号特定覆盖
  const account = resolveAccountConfig(cfg, accountId) ?? {};

  // 合并：账号配置覆盖基础配置
  return { ...base, ...account } as LocalIMAccountConfig;
}

/**
 * 检查账号是否已配置
 */
function isAccountConfigured(config: LocalIMAccountConfig): boolean {
  if (config.connectionMode === 'client') {
    return Boolean(config.clientWsUrl);
  }
  return Boolean(config.wsPort && config.httpPort);
}

/**
 * 解析完整的本地 IM 账号
 */
export function resolveLocalIMAccount(params: {
  cfg: ClawdbotConfig;
  accountId?: string | null;
}): ResolvedLocalIMAccount {
  const hasExplicitAccountId =
    typeof params.accountId === "string" && params.accountId.trim() !== "";
  const defaultSelection = hasExplicitAccountId
    ? null
    : resolveDefaultLocalIMAccountSelection(params.cfg);
  const accountId = hasExplicitAccountId
    ? normalizeAccountId(params.accountId ?? "")
    : (defaultSelection?.accountId ?? DEFAULT_ACCOUNT_ID);
  const selectionSource = hasExplicitAccountId
    ? "explicit"
    : (defaultSelection?.source ?? "fallback");
  const localIMCfg = params.cfg.channels?.["nc-local-im-connector"] as LocalIMConfig | undefined;

  // 基础启用状态（顶层）
  const baseEnabled = localIMCfg?.enabled !== false;

  // 合并配置
  const merged = mergeLocalIMAccountConfig(params.cfg, accountId);

  // 账号级启用状态
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;

  // 账号名称
  const accountName = (merged as LocalIMAccountConfig).name;

  return {
    accountId,
    selectionSource,
    enabled,
    configured: isAccountConfigured(merged),
    name: typeof accountName === "string" ? accountName.trim() || undefined : undefined,
    config: merged,
  };
}

/**
 * 列出所有已启用且已配置的账号
 */
export function listEnabledLocalIMAccounts(cfg: ClawdbotConfig): ResolvedLocalIMAccount[] {
  return listLocalIMAccountIds(cfg)
    .map((accountId) => resolveLocalIMAccount({ cfg, accountId }))
    .filter((account) => account.enabled && account.configured);
}
