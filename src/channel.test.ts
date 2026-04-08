/**
 * Unit tests for Local IM Channel Plugin
 */

import { describe, it, expect } from 'vitest';
import { ncLocalImPlugin, resolveAccount, buildSessionContext } from './channel.js';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/core';

describe('Local IM Plugin', () => {
  describe('resolveAccount', () => {
    it('resolves account from config with server mode', () => {
      const cfg: OpenClawConfig = {
        channels: {
          'nc-local-im-connector': {
            enabled: true,
            connectionMode: 'server',
            wsPort: 3001,
            httpPort: 3002,
          },
        },
      } as any;

      const account = resolveAccount(cfg, '__default__');

      expect(account.accountId).toBe('__default__');
      expect(account.config.connectionMode).toBe('server');
      expect(account.config.wsPort).toBe(3001);
      expect(account.config.httpPort).toBe(3002);
      expect(account.enabled).toBe(true);
    });

    it('resolves account from config with client mode', () => {
      const cfg: OpenClawConfig = {
        channels: {
          'nc-local-im-connector': {
            enabled: true,
            connectionMode: 'client',
            clientWsUrl: 'ws://127.0.0.1:8080',
            gatewayToken: 'test-token',
            tokenType: 'Bearer',
          },
        },
      } as any;

      const account = resolveAccount(cfg, '__default__');

      expect(account.accountId).toBe('__default__');
      expect(account.config.connectionMode).toBe('client');
      expect(account.config.clientWsUrl).toBe('ws://127.0.0.1:8080');
      expect(account.config.gatewayToken).toBe('test-token');
      expect(account.config.tokenType).toBe('Bearer');
    });

    it('returns default config when no config exists', () => {
      const cfg: OpenClawConfig = {} as any;
      const account = resolveAccount(cfg, '__default__');

      expect(account.accountId).toBe('__default__');
      expect(account.config.enabled).toBe(true);
      expect(account.config.connectionMode).toBe('server');
      expect(account.config.wsPort).toBe(3001);
      expect(account.config.httpPort).toBe(3002);
    });

    it('handles disabled account', () => {
      const cfg: OpenClawConfig = {
        channels: {
          'nc-local-im-connector': {
            enabled: false,
            connectionMode: 'server',
          },
        },
      } as any;

      const account = resolveAccount(cfg, '__default__');
      expect(account.enabled).toBe(false);
    });
  });

  describe('inspectAccount', () => {
    it('reports configured server mode', () => {
      const cfg: OpenClawConfig = {
        channels: {
          'nc-local-im-connector': {
            enabled: true,
            connectionMode: 'server',
            wsPort: 3001,
            httpPort: 3002,
            gatewayToken: 'test-token',
          },
        },
      } as any;

      const result = ncLocalImPlugin.setup!.inspectAccount!(cfg, '__default__');

      expect(result.enabled).toBe(true);
      expect(result.configured).toBe(true);
      expect(result.tokenStatus).toBe('available');
      expect(result.connectionMode).toBe('server');
    });

    it('reports configured client mode', () => {
      const cfg: OpenClawConfig = {
        channels: {
          'nc-local-im-connector': {
            enabled: true,
            connectionMode: 'client',
            clientWsUrl: 'ws://127.0.0.1:8080',
          },
        },
      } as any;

      const result = ncLocalImPlugin.setup!.inspectAccount!(cfg, '__default__');

      expect(result.enabled).toBe(true);
      expect(result.configured).toBe(true);
      expect(result.connectionMode).toBe('client');
    });

    it('reports unconfigured when ports missing in server mode', () => {
      const cfg: OpenClawConfig = {
        channels: {
          'nc-local-im-connector': {
            enabled: true,
            connectionMode: 'server',
          },
        },
      } as any;

      const result = ncLocalImPlugin.setup!.inspectAccount!(cfg, '__default__');

      expect(result.configured).toBe(false);
    });

    it('reports unconfigured when clientWsUrl missing in client mode', () => {
      const cfg: OpenClawConfig = {
        channels: {
          'nc-local-im-connector': {
            enabled: true,
            connectionMode: 'client',
          },
        },
      } as any;

      const result = ncLocalImPlugin.setup!.inspectAccount!(cfg, '__default__');

      expect(result.configured).toBe(false);
    });

    it('reports missing token status', () => {
      const cfg: OpenClawConfig = {
        channels: {
          'nc-local-im-connector': {
            enabled: true,
            connectionMode: 'server',
            wsPort: 3001,
            httpPort: 3002,
          },
        },
      } as any;

      const result = ncLocalImPlugin.setup!.inspectAccount!(cfg, '__default__');

      expect(result.tokenStatus).toBe('missing');
    });
  });

  describe('buildSessionContext', () => {
    it('builds session context without conversationId', () => {
      const ctx = buildSessionContext('user123');

      expect(ctx.channel).toBe('nc-local-im-connector');
      expect(ctx.accountId).toBe('__default__');
      expect(ctx.chatType).toBe('direct');
      expect(ctx.peerId).toBe('user123');
      expect(ctx.conversationId).toBeUndefined();
    });

    it('builds session context with conversationId', () => {
      const ctx = buildSessionContext('user123', 'conv456');

      expect(ctx.channel).toBe('nc-local-im-connector');
      expect(ctx.accountId).toBe('__default__');
      expect(ctx.chatType).toBe('direct');
      expect(ctx.peerId).toBe('user123');
      expect(ctx.conversationId).toBe('conv456');
    });
  });

  describe('Plugin metadata', () => {
    it('has correct plugin ID', () => {
      expect(ncLocalImPlugin.id).toBe('nc-local-im-connector');
    });

    it('has security configured', () => {
      expect(ncLocalImPlugin.security).toBeDefined();
      expect(ncLocalImPlugin.security?.dm).toBeDefined();
      expect(ncLocalImPlugin.security?.dm?.channelKey).toBe('nc-local-im-connector');
    });

    it('has threading configured', () => {
      expect(ncLocalImPlugin.threading).toBeDefined();
      expect(ncLocalImPlugin.threading?.topLevelReplyToMode).toBe('reply');
    });

    it('has setup configured', () => {
      expect(ncLocalImPlugin.setup).toBeDefined();
      expect(ncLocalImPlugin.setup?.resolveAccount).toBeDefined();
      expect(ncLocalImPlugin.setup?.inspectAccount).toBeDefined();
    });
  });
});
