/**
 * Public API exports for Local IM Channel Plugin
 *
 * Provides external interfaces for interacting with the plugin
 */

export type {
  LocalIMConfig,
  LocalIMAccountConfig,
  ResolvedLocalIMAccount,
  SessionContext,
  GatewayOptions,
  StartContext,
  ServerRuntimeState,
  ClientRuntimeState,
} from './src/types/index.js';

export {
  localIMPlugin,
  resolveLocalIMAccount,
  listLocalIMAccountIds,
  resolveDefaultLocalIMAccountId,
} from './src/channel.js';

export { monitorLocalIMProvider } from './src/core/provider.js';

/**
 * Get current connection status
 */
export interface ConnectionStatus {
  mode: 'server' | 'client';
  running: boolean;
  wsUrl?: string;
  wsPort?: number;
  httpPort?: number;
  connectedClients?: number;
}

/**
 * Helper to build session context for external callers
 */
export function buildSessionContext(userId: string, conversationId?: string, sessionId?: string) {
  return {
    channel: 'nc-local-im-connector',
    accountId: '__default__',
    chatType: 'direct' as const,
    peerId: userId,
    conversationId,
    sessionId,
  };
}
