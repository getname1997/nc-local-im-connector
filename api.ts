/**
 * Public API exports for Local IM Channel Plugin
 * 
 * Provides external interfaces for interacting with the plugin
 */

export type {
  LocalIMConfig,
  ResolvedAccount,
  ServerRuntimeState,
  ClientRuntimeState,
  StartContext,
} from './src/channel.js';

export {
  ncLocalImPlugin,
  startLocalImServer,
} from './src/channel.js';

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
export function buildSessionContext(userId: string, conversationId?: string) {
  return {
    channel: 'nc-local-im-connector',
    accountId: '__default__',
    chatType: 'direct' as const,
    peerId: userId,
    conversationId,
  };
}
