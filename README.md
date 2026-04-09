# nc-local-im-connector

本地 IM 连接器插件，支持多账号 Client 长连接模式，用于连接外部 IM 服务。

## 功能特性

- **多账号支持**：支持配置多个 IM 账号，每个账号独立连接
- **WebSocket Client 模式**：作为客户端连接到外部 WebSocket 服务
- **AI 回复流式输出**：支持 AI 回复内容流式推送到外部 IM
- **消息去重**：5 分钟 TTL 的消息去重缓存，防止重复处理
- **指数退避重连**：连接断开后自动重连，指数退避策略

## 架构设计

```
nc-local-im-connector/
├── index.ts                    # 插件入口，注册 channel
├── src/
│   ├── channel.ts              # Channel 插件定义
│   ├── runtime.ts              # PluginRuntime 存储
│   ├── config/
│   │   ├── schema.ts           # 配置 Schema 定义
│   │   └── accounts.ts         # 账号配置解析
│   ├── core/
│   │   ├── connection.ts       # WebSocket 连接管理、消息处理
│   │   └── provider.ts         # 账号启动/停止逻辑
│   ├── types/
│   │   └── index.ts            # 类型定义
│   └── utils/
│       └── logger.ts           # 日志工具
└── README.md
```

## 配置说明

### 基础配置

```json
{
  "channels": {
    "nc-local-im-connector": {
      "enabled": true,
      "serverUrl": "ws://192.168.100.168:8080",
      "defaultAccount": "u00267",
      "name": "刘XXXX"
    }
  }
}
```

### 配置项说明

| 配置项 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `serverUrl` | string | 是 | WebSocket 服务端地址 |
| `defaultAccount` | string | 否 | 默认账号 ID |
| `accounts` | object | 是 | 账号配置映射 |
| `accounts.<id>.enabled` | boolean | 否 | 是否启用该账号 |
| `accounts.<id>.name` | string | 否 | 账号显示名称 |

## 消息协议

### 客户端 → 服务端（发送）

连接时通过 URL 参数传递账号 ID：
```
ws://192.168.100.168:8080/?accountId=u00267
```

### 服务端 → 客户端（接收）

#### 文本消息
```json
{
  "type": "message",
  "messageId": "uuid-timestamp-random",
  "conversationId": "会话ID",
  "userId": "用户ID",
  "sessionId": "会话标识 (可选，用于隔离会话)",
  "content": "消息内容"
}
```

- **userId**: 标识 OpenClaw 实例或服务器。
- **sessionId**: 标识具体的会话/Agent。如果提供，插件将使用它来构建会话 Key。更换 `sessionId` 会导致插件开启一个全新的会话上下文，从而防止单一会话过长或混淆。

### 客户端 → 服务端（推送）

#### 思考过程 (Thought)
```json
{
  "type": "thought",
  "conversationId": "会话ID",
  "sessionId": "会话ID (由服务端返回)",
  "content": "当前累积的思考内容",
  "delta": "本次增量的思考内容"
}
```

#### 流式更新
```json
{
  "type": "stream",
  "conversationId": "会话ID",
  "sessionId": "会话ID (由服务端返回)",
  "content": "当前累积的回复内容"
}
```

#### 回复完成
```json
{
  "type": "done",
  "conversationId": "会话ID",
  "sessionId": "会话ID (由服务端返回)",
  "content": "完整的回复内容",
  "thought": "完整的思考内容"
}
```

#### 错误通知
```json
{
  "type": "error",
  "conversationId": "会话ID",
  "sessionId": "会话ID (由服务端返回)",
  "error": "错误信息"
}
```

## 会话 Key 格式

AI 回复的会话 Key 格式：
```
agent:{agentId}:nc-local-im-connector:{peerKind}:{sessionPeerId}
```

示例：
```
agent:default:nc-local-im-connector:user:u00267
agent:default:nc-local-im-connector:conversation:f6cf52ac-9f9d-4abd-890e-95e55439b939
```

## AI 回复流程

```
1. 收到 WebSocket 消息
2. 消息去重检查（5 分钟 TTL）
3. 构建会话上下文（sessionKey）
4. 调用 createReplyPrefixOptions 生成 prefixOptions
5. 调用 createReplyDispatcherWithTyping 创建 dispatcher
6. 调用 withReplyDispatcher + dispatchReplyFromConfig 触发 AI
7. deliver 回调收到 AI 回复
8. 通过 WebSocket 推送到外部 IM
```

## 关键依赖

- `openclaw/plugin-sdk` - OpenClaw 插件 SDK
- `openclaw/plugin-sdk/channel-runtime` - 提供 `createReplyPrefixOptions`
- `openclaw/plugin-sdk/reply-runtime` - 提供 `createReplyDispatcherWithTyping`

## 日志标签

日志前缀格式：`[LocalIM][{accountId}]`

示例：
```
[LocalIM][u00267] 正在连接服务端: ws://192.168.100.168:8080/?accountId=u00267
[LocalIM][u00267] ✅ 成功连接至服务端
[LocalIM][u00267] 🚀 开始处理消息...
[LocalIM][u00267] AI 开始回复
[LocalIM][u00267] deliver: kind=final, textLength=506, thoughtLength=0
[LocalIM][u00267] 📥 AI 处理完成
[LocalIM][u00267] 回复空闲
[LocalIM][u00267] ✅ 消息处理完成 (1/1)
```

## 开发说明

### 构建

```bash
npm run build
```

### 调试

启用详细日志：
```json
{
  "channels": {
    "nc-local-im-connector": {
      "debug": true
    }
  }
}
```

### 常见问题

1. **消息被忽略**：检查 `isProcessing` 状态，可能上一条消息未处理完成
2. **AI 不回复**：检查 `createReplyPrefixOptions` 导入是否正确
3. **无限循环**：确保 `markDispatchIdle()` 不在 `onIdle` 回调中调用
