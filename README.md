# Local IM Connector Plugin for OpenClaw

提供本地 WebSocket 和 HTTP 服务，允许外部应用通过标准接口与 OpenClaw 智能体对话。

## 特性

- **双模式运行**
  - **Server 模式**：本地监听 WebSocket (默认 3001) 和 HTTP (默认 3002) 服务
  - **Client 模式**：主动连接外部 WebSocket 网关，类似钉钉 Stream 模式

- **长连接支持**
  - WebSocket 心跳保活机制（30秒间隔）
  - Client 模式自动断线重连（5秒延迟）
  - SSE 流式输出支持

- **流式对话**
  - 与 OpenClaw Gateway 的流式通信
  - 实时返回 AI 回复内容

## 快速开始

### 安装依赖

```bash
pnpm install
```

### 编译

```bash
pnpm build
```

### 运行测试

```bash
pnpm test
```

## 配置说明

### Server 模式配置

```json
{
  "channels": {
    "nc-local-im-connector": {
      "enabled": true,
      "connectionMode": "server",
      "wsPort": 3001,
      "httpPort": 3002,
      "gatewayToken": "your-gateway-token",
      "tokenType": "Bearer"
    }
  }
}
```

### Client 模式配置

```json
{
  "channels": {
    "nc-local-im-connector": {
      "enabled": true,
      "connectionMode": "client",
      "clientWsUrl": "ws://127.0.0.1:8080",
      "gatewayToken": "your-gateway-token",
      "tokenType": "Bearer"
    }
  }
}
```

## API 接口

### WebSocket 接口 (Server 模式)

连接地址：`ws://localhost:3001`

发送消息格式：
```json
{
  "userId": "user123",
  "conversationId": "conv456",
  "content": "你好"
}
```

接收消息格式：
```json
{
  "type": "stream",
  "conversationId": "conv456",
  "content": "你好！我是AI助手..."
}
```

完成消息格式：
```json
{
  "type": "done",
  "conversationId": "conv456",
  "content": "完整回复内容"
}
```

### HTTP REST 接口 (Server 模式)

#### 同步接口 - 等待完成后返回

```bash
POST http://localhost:3002/chat
Content-Type: application/json

{
  "userId": "user123",
  "conversationId": "conv456",
  "content": "你好"
}
```

响应：
```json
{
  "reply": "完整回复内容"
}
```

#### SSE 流式接口 - 实时流式输出

```bash
POST http://localhost:3002/chat/stream
Content-Type: application/json

{
  "userId": "user123",
  "conversationId": "conv456",
  "content": "你好"
}
```

响应格式（Server-Sent Events）：
```
data: {"type":"stream","conversationId":"conv456","chunk":"你"}

data: {"type":"stream","conversationId":"conv456","chunk":"好"}

data: {"type":"done","conversationId":"conv456"}
```

## 重构说明

本插件已从旧版 SDK 迁移至 **OpenClaw 2026.3.24-beta.2** 最新规范：

### 核心变更

1. **架构升级**
   - 使用 `createChatChannelPlugin` 标准框架
   - 适配新的配置 Schema 和 API 接口
   - 支持独立的 setup-entry 轻量级入口

2. **保留功能**
   - ✅ Server/Client 双模式运行
   - ✅ WebSocket 心跳保活
   - ✅ SSE 流式输出
   - ✅ 断线自动重连
   - ✅ Gateway 流式通信

3. **新增特性**
   - ✅ 标准化的账户解析和检查
   - ✅ 完整的单元测试覆盖
   - ✅ 类型安全的 TypeScript 定义
   - ✅ 公共 API 导出接口

### 文件结构

```
nc-local-im-connector/
├── package.json              # 元数据配置
├── openclaw.plugin.json      # 配置 Schema
├── tsconfig.json             # TypeScript 配置
├── index.ts                  # 主入口（defineChannelPluginEntry）
├── setup-entry.ts            # 轻量级设置入口
├── api.ts                    # 公共 API 导出
├── README.md                 # 文档
└── src/
    ├── channel.ts            # 核心插件定义
    └── channel.test.ts       # 单元测试
```

## 开发指南

### 添加新的出站能力

在 `src/channel.ts` 中扩展 `outbound` 配置：

```typescript
outbound: {
  attachedResults: {
    sendText: async (params) => {
      // 发送文本逻辑
      return { messageId: '...' };
    },
    sendMedia: async (params) => {
      // 发送媒体逻辑
      return { messageId: '...' };
    },
  },
},
```

### 扩展安全策略

在 `security` 配置中添加自定义策略：

```typescript
security: {
  dm: {
    channelKey: 'nc-local-im-connector',
    resolvePolicy: (account) => {
      // 自定义安全策略
      return 'allowlist';
    },
    resolveAllowFrom: (account) => {
      // 返回允许的用户列表
      return ['user1', 'user2'];
    },
    defaultPolicy: 'allowlist',
  },
},
```

## 故障排查

### Server 模式无法启动

- 检查端口是否被占用：`wsPort` 和 `httpPort`
- 查看日志输出，确认是否有错误信息

### Client 模式连接失败

- 验证 `clientWsUrl` 配置是否正确
- 检查外部 WebSocket 服务是否可访问
- 查看日志，确认是否在自动重连

### Gateway 认证失败

- 确认 `gatewayToken` 配置正确
- 检查 `tokenType` 设置（Bearer 或 ApiKey）
- 验证 Gateway 服务是否需要认证

## 版本历史

### v2.0.0 (2026-04-03)
- 🔄 完全迁移至 OpenClaw 2026.3.24-beta.2 SDK
- 🏗️ 使用 `createChatChannelPlugin` 标准框架
- ✨ 添加完整的单元测试
- 📝 完善类型定义和 API 导出
- 📚 更新文档和配置说明

### v1.1.0 (Previous)
- 原始版本，基于旧版 SDK

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
