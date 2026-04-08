/**
 * 本地 IM Provider 入口
 * 
 * 职责：
 * - 提供 monitorLocalIMProvider 函数作为本地 IM 的统一入口
 * - 协调单账号和多账号监控场景
 * - 支持 Client 长连接模式
 */

import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { createLogger } from "../utils/logger.js";

export type MonitorLocalIMOpts = {
  config?: ClawdbotConfig;
  runtime?: any; // RuntimeEnv from framework
  abortSignal?: AbortSignal;
  accountId?: string;
  /** 可选：连接状态变更时回调，用于更新 UI 显示的 Connected / Last inbound 字段 */
  onStatusChange?: (patch: Record<string, unknown>) => void;
};

/**
 * 监控本地 IM Provider
 * 
 * 支持单账号或多账号模式：
 * - 如果指定了 accountId，只启动该账号
 * - 否则启动所有已启用且已配置的账号
 */
export async function monitorLocalIMProvider(opts: MonitorLocalIMOpts = {}): Promise<void> {
  const cfg = opts.config;
  if (!cfg) {
    throw new Error("Config is required for Local IM monitor");
  }

  const log = createLogger(cfg.channels?.["nc-local-im-connector"]?.debug ?? false, 'LocalIM:Provider');

  // 并行导入模块
  const [accountsModule, connectionModule] = await Promise.all([
    import("../config/accounts.js"),
    import("./connection.js"),
  ]);

  const { resolveLocalIMAccount, listEnabledLocalIMAccounts } = accountsModule;
  const { monitorSingleAccount } = connectionModule;

  // 单账号模式
  if (opts.accountId) {
    const account = resolveLocalIMAccount({ cfg, accountId: opts.accountId });
    if (!account.enabled || !account.configured) {
      throw new Error(`Local IM account "${opts.accountId}" not configured or disabled`);
    }

    // 只支持 Client 模式
    if (account.config.connectionMode !== 'client') {
      throw new Error(`Local IM account "${opts.accountId}" 当前版本只支持 Client 模式`);
    }

    return monitorSingleAccount({
      account,
      cfg,
      runtime: opts.runtime,
      abortSignal: opts.abortSignal,
      onStatusChange: opts.onStatusChange,
      log,
    });
  }

  // 多账号模式
  const accounts = listEnabledLocalIMAccounts(cfg).filter(
    a => a.config.connectionMode === 'client'
  );
  
  if (accounts.length === 0) {
    throw new Error("No enabled Local IM accounts configured (Client mode)");
  }

  log.info(
    `Local IM: starting ${accounts.length} account(s): ${accounts.map((a) => a.accountId).join(", ")}`
  );

  const monitorPromises: Promise<void>[] = [];
  for (const account of accounts) {
    if (opts.abortSignal?.aborted) {
      log.info("Local IM: abort signal received during startup; stopping");
      break;
    }

    monitorPromises.push(
      monitorSingleAccount({
        account,
        cfg,
        runtime: opts.runtime,
        abortSignal: opts.abortSignal,
        onStatusChange: opts.onStatusChange,
        log,
      })
    );
  }

  await Promise.all(monitorPromises);
}
