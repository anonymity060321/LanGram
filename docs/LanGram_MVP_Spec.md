# LanGram MVP 开发需求文档

> 用途：本文件用于交给 **ChatGPT 5.5 驱动的 Codex** 进行项目开发。  
> 项目阶段：MVP v0.1  
> 目标平台：Windows 客户端 + Rocky Linux 服务端  
> 项目定位：小型局域网内 Telegram 风格聊天软件，后续可演进到广域网部署。

---

## 0. 给 Codex 的总开发指令

请基于本文档开发一个名为 **LanGram** 的局域网聊天软件 MVP。

开发原则：

1. **先实现可运行 MVP，不要一次性实现所有远期功能。**
2. 代码应清晰、模块化、类型安全，便于后续继续迭代。
3. 不要引入不必要的复杂中间件；MVP 阶段不强制使用 Redis、消息队列、对象存储、STUN/TURN。
4. 所有远期能力需要在架构、接口、数据表中合理预留，但不要过度实现。
5. 后端优先保证账号、好友、消息、文件、WebSocket、管理后台核心链路稳定。
6. 客户端优先保证登录、好友、会话列表、聊天窗口、文件发送、图片发送、消息状态、本地缓存稳定。
7. 消息内容在服务端不得以明文保存。MVP 阶段实现“消息内容加密”，完整 Secret Chat 级别端到端加密作为后续版本。
8. 当前 MVP 使用中心服务器模式；P2P 大文件传输仅预留协议和接口，不作为 MVP 阻塞项。
9. 默认文档语言为中文；代码命名、API、数据库字段、WebSocket 事件名使用英文。

---

## 1. 项目概述

### 1.1 项目名称

**LanGram**

### 1.2 使用场景

LanGram 第一阶段用于 **2-10 人的小型局域网环境**，例如宿舍、实验室、小办公室、教室、临时工作组等。

后续项目成熟后，需要支持部署到广域网环境。

### 1.3 软件定位

LanGram 是一个 **Telegram 风格的局域网聊天软件**，第一版专注于：

- Windows 桌面客户端
- 局域网服务端
- 单聊
- 文本消息
- 图片消息
- 文件发送
- 好友添加
- 已读/未读
- 撤回
- 编辑
- 本地消息搜索
- 用户头像
- 深色/浅色模式
- 中英文切换
- Web 管理后台

---

## 2. MVP 范围

### 2.1 MVP 必须实现

#### 客户端

- Windows 桌面客户端
- 登录 / 注册 / 游客登录
- 邮箱验证码注册与登录
- 用户资料：昵称、头像、状态、在线状态
- 好友列表
- 通过配对码添加好友
- 好友申请确认
- 会话列表
- 单聊聊天窗口
- 文本消息
- Unicode Emoji
- 图片发送
- 文件发送
- 回复某条消息
- 消息撤回
- 消息编辑，并显示“已编辑”
- 删除本地消息
- 按会话清空本地聊天记录
- 已读 / 未读
- 消息搜索
- 转发消息给单个好友
- 图片默认压缩，可选择发送原图
- 文件保存路径自定义
- 下载记录
- 尝试实现断点续传；如果影响进度，可降级为普通下载并保留接口
- 系统托盘，可由用户启用/禁用
- 桌面通知，需用户授权
- 开机自启动，可由用户启用/禁用
- Telegram 风格 UI
- 浅色 / 深色模式切换
- 中英文切换，默认跟随设备语言
- 客户端本地 SQLite 加密缓存

#### 服务端

- Rocky Linux 可部署
- 固定 IP 访问
- NestJS 服务端
- PostgreSQL 数据库
- SMTP 邮箱验证码
- REST API
- WebSocket 实时通信
- 用户账号管理
- 游客账号管理
- 设备管理
- 单设备登录策略
- 好友配对码
- 好友申请与确认
- 消息密文存储
- 离线消息暂存与上线投递
- 消息状态管理
- 文件上传 / 下载
- 200MB 文件大小限制
- 图片 / 文件元数据管理
- 登录日志
- 退出日志
- 错误日志
- Web 管理后台

### 2.2 MVP 不强制实现

以下能力必须预留接口或模块位置，但不要求 MVP 完整实现：

- 真正 P2P 大文件传输
- 2GB 文件传输
- WebRTC DataChannel
- STUN/TURN/NAT 穿透
- 多设备同时在线
- 陌生设备扫码登录
- 完整 Secret Chat 级别端到端加密
- 前向保密
- 多设备密钥同步
- 文档在线预览
- 群聊
- 频道
- 语音消息
- 视频消息
- 自定义表情包
- 服务端全文搜索消息内容
- Docker Compose 一键部署

---

## 3. 技术栈

### 3.1 客户端

```text
Desktop Framework: Tauri v2
Frontend Framework: React
Language: TypeScript
Native Layer: Rust
Local Database: SQLite
Local Storage: AppData / Documents
State Management: Zustand
Data Fetching: TanStack Query
Routing: React Router
Forms: React Hook Form + Zod
UI: Tailwind CSS + Radix UI style components
Build Tool: Vite
```

### 3.2 服务端

```text
Runtime: Node.js LTS
Framework: NestJS
Language: TypeScript
Database: PostgreSQL
ORM: Prisma
Realtime: NestJS WebSocket Gateway
Auth: JWT + Refresh Token
Email: SMTP
File Storage: Local filesystem
Admin: Web Admin under /admin
Logging: NestJS Logger + structured application logs
```

### 3.3 部署环境

```text
OS: Rocky Linux
Database: PostgreSQL
Network: Fixed LAN IP
HTTP Port: 8080
WebSocket Path: /ws
Admin Path: /admin
File API Path: /files
```

---

## 4. 总体架构

### 4.1 MVP 架构

MVP 使用 **中心服务器模式**。

```text
Windows Client A
Windows Client B  --->  LanGram Server on Rocky Linux  ---> PostgreSQL
Windows Client C                                  |
                                                  +-- Local File Storage
```

### 4.2 设计理由

中心服务器模式优先满足：

- 邮箱注册
- 设备登录
- 好友关系
- 离线消息
- 已读 / 未读
- 撤回
- 编辑
- 管理后台
- 日志
- 后续广域网部署

### 4.3 P2P 预留

MVP 需要预留 P2P 文件传输相关结构：

- `transfer_mode`
- `p2p_session_id`
- `p2p_offer`
- `p2p_answer`
- `ice_candidates`
- `fallback_to_server`
- `file_transfer_sessions`

但 MVP 不需要实现完整 WebRTC P2P 传输。

---

## 5. 客户端架构

### 5.1 客户端职责划分

#### React 前端职责

- UI 渲染
- 页面路由
- 登录/注册表单
- 会话列表
- 聊天窗口
- 消息输入框
- 文件选择
- 图片压缩选项
- 消息状态显示
- 设置页面
- 管理用户交互状态
- 调用 Tauri commands
- 连接 WebSocket
- 调用 REST API

#### Rust / Tauri 侧职责

- SQLite 本地数据库
- 本地文件读写
- 下载任务管理
- 文件保存路径管理
- 本地加密 / 解密封装
- 系统托盘
- 开机自启动
- 桌面通知桥接
- 操作系统信息读取
- 设备 ID 生成和保存
- 安全存储访问

### 5.2 推荐客户端目录结构

```text
client/
  package.json
  vite.config.ts
  tsconfig.json
  src/
    main.tsx
    App.tsx
    routes/
      index.tsx
      auth.routes.tsx
      main.routes.tsx
    pages/
      auth/
        LoginPage.tsx
        RegisterPage.tsx
        GuestLoginPage.tsx
      main/
        MainLayout.tsx
        ChatPage.tsx
        FriendsPage.tsx
        SettingsPage.tsx
        ProfilePage.tsx
    components/
      layout/
      chat/
        ConversationList.tsx
        MessageList.tsx
        MessageBubble.tsx
        MessageInput.tsx
        FileMessage.tsx
        ImageMessage.tsx
        ReplyPreview.tsx
      friends/
      auth/
      settings/
      common/
    stores/
      auth.store.ts
      chat.store.ts
      settings.store.ts
      transfer.store.ts
    api/
      http.ts
      auth.api.ts
      users.api.ts
      friends.api.ts
      messages.api.ts
      files.api.ts
    realtime/
      socket.ts
      socket.events.ts
    crypto/
      messageCrypto.ts
    i18n/
      index.ts
      zh-CN.json
      en-US.json
    utils/
      file.ts
      image.ts
      time.ts
      device.ts
  src-tauri/
    Cargo.toml
    tauri.conf.json
    src/
      main.rs
      commands/
        mod.rs
        db.rs
        files.rs
        crypto.rs
        system.rs
        notifications.rs
      db/
        mod.rs
        migrations/
      storage/
      crypto/
      tray/
```

---

## 6. 服务端架构

### 6.1 服务端模块

```text
AuthModule
UsersModule
DevicesModule
FriendsModule
ConversationsModule
MessagesModule
FilesModule
RealtimeModule
AdminModule
LogsModule
CryptoModule
ConfigModule
HealthModule
```

### 6.2 推荐服务端目录结构

```text
server/
  package.json
  tsconfig.json
  nest-cli.json
  prisma/
    schema.prisma
    migrations/
  src/
    main.ts
    app.module.ts
    config/
      env.schema.ts
      configuration.ts
    common/
      decorators/
      guards/
      interceptors/
      filters/
      pipes/
      dto/
      types/
      utils/
    auth/
      auth.module.ts
      auth.controller.ts
      auth.service.ts
      dto/
      strategies/
      guards/
    users/
      users.module.ts
      users.controller.ts
      users.service.ts
      dto/
    devices/
      devices.module.ts
      devices.controller.ts
      devices.service.ts
    friends/
      friends.module.ts
      friends.controller.ts
      friends.service.ts
      dto/
    conversations/
      conversations.module.ts
      conversations.controller.ts
      conversations.service.ts
    messages/
      messages.module.ts
      messages.controller.ts
      messages.service.ts
      dto/
    files/
      files.module.ts
      files.controller.ts
      files.service.ts
      dto/
      storage/
    realtime/
      realtime.module.ts
      realtime.gateway.ts
      realtime.service.ts
      events.ts
    admin/
      admin.module.ts
      admin.controller.ts
      admin.service.ts
    logs/
      logs.module.ts
      logs.service.ts
    crypto/
      crypto.module.ts
      crypto.service.ts
    health/
      health.controller.ts
```

---

## 7. 账号与登录

### 7.1 账号类型

系统支持两类账号：

1. 正式账号
2. 游客账号

### 7.2 正式账号

正式账号使用邮箱注册。

注册流程：

```text
用户输入邮箱
服务端发送验证码
用户输入验证码
用户设置昵称
客户端生成设备信息
服务端创建用户和首个设备
返回 access_token 和 refresh_token
```

### 7.3 游客账号

游客账号使用设备 ID / 本机身份。

规则：

- 不需要邮箱
- 当前设备有效
- 换电脑后无法恢复
- 可以通过绑定邮箱转换为正式账号
- 允许单聊
- 允许发送文件
- 管理后台可以一键禁用游客账号功能

### 7.4 邮箱验证码

MVP 使用 SMTP。

验证码规则：

```text
长度：6 位数字
有效期：5 分钟
同一邮箱 60 秒内不可重复发送
同一邮箱每日发送次数限制可配置
```

### 7.5 登录策略

MVP 阶段采用单设备登录策略：

- 同一正式账号同一时间只允许一个设备在线
- 新设备登录成功后，旧设备自动下线
- 数据库预留多设备结构
- 后续支持多设备同时在线

### 7.6 设备丢失恢复

MVP 支持邮箱验证码单次恢复登录：

- 用户输入邮箱
- 验证码验证成功后允许登录一次
- 账号退出后再次登录需要重新验证码
- 后续版本支持已登录设备扫码确认陌生设备

---

## 8. 用户资料

### 8.1 用户字段

用户资料包含：

- 昵称
- 头像
- 状态
- 在线状态
- 账号类型
- 创建时间
- 更新时间

### 8.2 在线状态

在线状态包括：

```text
online
offline
away
busy
```

MVP 至少实现：

```text
online
offline
```

---

## 9. 好友系统

### 9.1 添加好友方式

MVP 使用配对码添加好友。

流程：

```text
用户 A 生成配对码
配对码有效期 5 分钟
用户 B 输入配对码
系统向用户 A 创建好友申请
用户 A 确认
双方成为好友
```

### 9.2 二维码

二维码本质上编码配对码和服务器信息。

MVP 可先实现数字配对码；二维码作为可选增强。

### 9.3 好友状态

```text
pending
accepted
rejected
blocked
```

MVP 实现：

```text
pending
accepted
rejected
```

---

## 10. 聊天功能

### 10.1 聊天类型

MVP 仅支持单聊。

预留：

- 群聊
- 频道
- 临时聊天室

### 10.2 消息类型

MVP 支持：

```text
text
image
file
emoji
reply
```

说明：

- Emoji 使用 Unicode Emoji
- reply 通过 `reply_to_message_id` 表示
- 图片本质上也是文件消息，但在 UI 上以图片消息展示

### 10.3 消息状态

消息状态包括：

```text
sending
sent
delivered
read
failed
recalled
deleted_local
```

### 10.4 消息撤回

规则：

- 消息发送后 2 分钟内允许撤回
- 超过 2 分钟不可撤回
- 撤回后双方显示“消息已撤回”
- 服务端保留撤回元数据
- 客户端本地消息内容应被清除或标记不可见

### 10.5 消息编辑

规则：

- 消息发送后 15 分钟内允许编辑
- 超过 15 分钟不可编辑
- 编辑后显示“已编辑”
- 服务端保存最新密文内容
- 是否保存历史编辑版本由后续版本决定，MVP 可不保存历史版本

### 10.6 删除本地消息

规则：

- 删除本地消息只影响当前设备
- 不影响对方设备
- 不影响服务端密文记录
- 支持单条删除
- 支持按会话清空本地聊天记录

### 10.7 转发消息

MVP 支持转发给单个好友。

后续版本支持多选好友批量转发。

### 10.8 消息搜索

MVP 优先实现客户端本地搜索。

原因：

- 消息内容在服务端密文存储
- 服务端不应搜索明文消息
- 客户端解密后可在本地加密数据库中建立搜索索引

---

## 11. 离线消息

### 11.1 离线消息策略

用户离线时：

- 服务端暂存密文消息
- 标记消息为 `sent`
- 接收方上线后通过 WebSocket 推送
- 推送成功并确认后更新为 `delivered`
- 服务端不保存明文消息

### 11.2 是否清理服务端暂存消息

需求要求“用户上线后发送给用户，同时清理服务器暂存消息”。

实现建议：

- 服务端消息表仍保留密文消息记录，用于历史同步
- 单独的待投递队列 `message_deliveries` 在成功投递后标记完成
- 不建议物理删除主消息记录，否则多设备、历史同步、重发恢复都会困难

---

## 12. 文件与图片

### 12.1 文件大小限制

MVP 最大文件限制：

```text
200MB
```

后续版本逐步提升至 2GB。

### 12.2 文件传输方式

MVP：

```text
服务器中转
```

后续：

```text
小于 200MB：服务器中转
大于 200MB：P2P 直传
P2P 失败：可降级服务器中转或提示重试
```

### 12.3 文件上传

MVP 可实现两种方案之一：

#### 优先方案：分片上传

```text
create upload session
upload chunks
complete upload
verify hash
create file message
```

#### 降级方案：普通上传

如果分片上传和断点续传显著影响进度，可先实现普通上传，但必须保留 API 设计。

### 12.4 断点续传

MVP 尝试实现：

- 上传断点续传
- 下载断点续传

如果影响进度，降级为：

- 普通上传
- 普通下载
- 数据表保留 chunk / offset 字段
- v0.2 实现断点续传

### 12.5 图片发送

规则：

- 默认压缩图片
- 用户可勾选“发送原图”
- 压缩图和原图都作为文件处理
- 图片消息在 UI 内显示缩略图
- 点击图片可本地预览

### 12.6 文档预览

MVP 不支持在线预览文档。

规则：

- 文件必须下载到本地
- 通过设备支持的软件打开
- 图片可以在客户端内预览

### 12.7 文件保存路径

默认路径：

```text
Windows Documents/LanGram/
```

用户可以在设置中自定义文件保存路径。

本地需要记录：

- 文件 ID
- 文件名
- 文件大小
- 文件 hash
- 下载状态
- 本地路径
- 下载时间
- 所属会话

---

## 13. 加密设计

### 13.1 MVP 加密目标

MVP 实现“消息内容加密”。

要求：

- 服务端不保存明文消息正文
- 消息正文在客户端加密后发送
- 服务端只保存密文、元数据、状态
- 客户端收到密文后解密展示
- 客户端本地缓存也应加密存储

### 13.2 MVP 不实现的完整 E2EE 能力

MVP 不要求实现：

- 完整 Secret Chat
- 前向保密
- 双棘轮算法
- 多设备密钥同步
- 自动密钥轮换
- 安全码校验
- 阅后即焚

### 13.3 后续加密演进预留

预留字段：

```text
encryption_version
sender_key_id
receiver_key_id
conversation_key_id
nonce
ciphertext
signature
```

### 13.4 服务端可见元数据

服务端可以保存：

- 发送者 ID
- 接收者 ID
- 会话 ID
- 消息类型
- 发送时间
- 消息状态
- 文件大小
- 文件名
- 文件 MIME 类型
- 文件 hash
- 密文消息内容

服务端不应保存：

- 明文消息内容
- 明文搜索索引
- 客户端私钥

---

## 14. 数据库设计

### 14.1 服务端 PostgreSQL 核心表

#### users

```text
id
email
email_verified
account_type: formal | guest
nickname
avatar_file_id
status_text
is_disabled
created_at
updated_at
```

#### devices

```text
id
user_id
device_id
device_name
device_os
device_type
public_key
trusted
last_seen_at
created_at
updated_at
```

#### sessions

```text
id
user_id
device_id
refresh_token_hash
ip_address
user_agent
expires_at
revoked_at
created_at
```

#### email_verification_codes

```text
id
email
code_hash
purpose: register | login | recovery
expires_at
used_at
created_at
```

#### friend_pairing_codes

```text
id
creator_user_id
code_hash
expires_at
used_at
created_at
```

#### friend_requests

```text
id
from_user_id
to_user_id
status: pending | accepted | rejected
created_at
updated_at
```

#### friendships

```text
id
user_a_id
user_b_id
created_at
```

#### conversations

```text
id
type: direct
created_at
updated_at
```

#### conversation_members

```text
id
conversation_id
user_id
last_read_message_id
last_read_at
created_at
```

#### messages

```text
id
conversation_id
sender_id
message_type: text | image | file | emoji
ciphertext
encryption_version
nonce
reply_to_message_id
file_id
status: sent | delivered | read | recalled
edited_at
recalled_at
created_at
updated_at
```

#### message_deliveries

```text
id
message_id
receiver_id
delivered_at
read_at
created_at
updated_at
```

#### files

```text
id
owner_id
conversation_id
original_name
stored_name
mime_type
size_bytes
sha256
storage_path
transfer_mode: server | p2p
upload_status: pending | uploading | completed | failed
created_at
updated_at
```

#### file_upload_sessions

```text
id
file_id
user_id
chunk_size
total_chunks
uploaded_chunks
status
created_at
updated_at
```

#### login_logs

```text
id
user_id
device_id
event_type: login | logout | login_failed
ip_address
user_agent
created_at
```

#### error_logs

```text
id
level
source
message
stack
metadata_json
created_at
```

#### admin_users

```text
id
user_id
role: super_admin | admin
created_at
```

#### app_settings

```text
key
value
updated_at
```

### 14.2 客户端 SQLite 核心表

#### local_users

```text
id
server_user_id
email
account_type
nickname
avatar_local_path
created_at
updated_at
```

#### local_conversations

```text
id
server_conversation_id
title
type
last_message_preview
last_message_at
unread_count
created_at
updated_at
```

#### local_messages

```text
id
server_message_id
conversation_id
sender_id
message_type
plaintext_encrypted
ciphertext
reply_to_message_id
file_id
status
is_deleted_local
edited_at
recalled_at
created_at
updated_at
```

#### local_files

```text
id
server_file_id
conversation_id
file_name
mime_type
size_bytes
sha256
local_path
downloaded_bytes
download_status
created_at
updated_at
```

#### local_settings

```text
key
value
updated_at
```

#### outgoing_queue

```text
id
conversation_id
message_type
payload_json
status
retry_count
created_at
updated_at
```

---

## 15. REST API 设计

### 15.1 Auth

```text
POST /api/auth/email/send-code
POST /api/auth/register
POST /api/auth/login
POST /api/auth/guest-login
POST /api/auth/logout
POST /api/auth/refresh
POST /api/auth/recovery-login
POST /api/auth/bind-email
GET  /api/auth/me
```

### 15.2 Users

```text
GET    /api/users/me
PATCH  /api/users/me
POST   /api/users/me/avatar
GET    /api/users/:id
```

### 15.3 Devices

```text
GET    /api/devices
DELETE /api/devices/:id
POST   /api/devices/:id/revoke
```

### 15.4 Friends

```text
POST /api/friends/pairing-code
POST /api/friends/requests
GET  /api/friends/requests
POST /api/friends/requests/:id/accept
POST /api/friends/requests/:id/reject
GET  /api/friends
```

### 15.5 Conversations

```text
GET  /api/conversations
POST /api/conversations/direct
GET  /api/conversations/:id/messages
POST /api/conversations/:id/read
```

### 15.6 Messages

```text
POST   /api/messages
PATCH  /api/messages/:id
POST   /api/messages/:id/recall
POST   /api/messages/:id/forward
DELETE /api/messages/:id/local
```

说明：`DELETE /api/messages/:id/local` 可只在客户端本地实现，不一定需要服务端 API。

### 15.7 Files

```text
POST /api/files/upload
POST /api/files/upload-sessions
PUT  /api/files/upload-sessions/:id/chunks/:chunkIndex
POST /api/files/upload-sessions/:id/complete
GET  /api/files/:id/download
GET  /api/files/:id/meta
```

### 15.8 Admin

```text
GET   /admin
GET   /api/admin/users
PATCH /api/admin/users/:id/disable
PATCH /api/admin/users/:id/enable
POST  /api/admin/users/:id/reset-session
GET   /api/admin/devices
GET   /api/admin/logs/login
GET   /api/admin/logs/errors
DELETE /api/admin/files/:id
PATCH /api/admin/settings
```

---

## 16. WebSocket 协议

### 16.1 连接

客户端连接：

```text
ws://server-ip:8080/ws?token=<access_token>
```

服务端验证 token 后建立连接。

### 16.2 客户端发送事件

```text
message:send
message:read
message:typing
message:edit
message:recall
friend:request
friend:accept
presence:update
file:upload_completed
```

### 16.3 服务端推送事件

```text
message:new
message:delivered
message:read
message:edited
message:recalled
friend:request_received
friend:accepted
presence:changed
session:kicked
file:ready
error
```

### 16.4 message:send payload

```json
{
  "clientMessageId": "uuid",
  "conversationId": "uuid",
  "messageType": "text",
  "ciphertext": "base64",
  "nonce": "base64",
  "encryptionVersion": "mvp-v1",
  "replyToMessageId": null,
  "fileId": null,
  "createdAt": "2026-05-18T00:00:00.000Z"
}
```

### 16.5 message:new payload

```json
{
  "messageId": "uuid",
  "conversationId": "uuid",
  "senderId": "uuid",
  "messageType": "text",
  "ciphertext": "base64",
  "nonce": "base64",
  "encryptionVersion": "mvp-v1",
  "replyToMessageId": null,
  "fileId": null,
  "createdAt": "2026-05-18T00:00:00.000Z"
}
```

### 16.6 session:kicked

当同一账号新设备登录时，旧设备收到：

```json
{
  "reason": "new_device_login"
}
```

客户端应：

- 显示提示
- 清除登录态
- 跳转登录页
- 保留本地加密缓存，除非用户选择清除数据

---

## 17. 管理后台

### 17.1 入口

```text
http://server-ip:8080/admin
```

### 17.2 MVP 功能

管理后台需要支持：

- 查看用户列表
- 禁用 / 启用账号
- 重置用户登录状态
- 查看在线设备
- 查看登录日志
- 查看退出日志
- 查看错误日志
- 删除违规头像或文件
- 开启 / 关闭游客账号功能

### 17.3 管理后台限制

由于消息内容加密，管理员不应查看聊天明文内容。

管理后台可以查看：

- 用户信息
- 设备信息
- 登录记录
- 错误记录
- 文件元数据
- 在线状态

管理后台不应查看：

- 明文聊天内容
- 用户私钥
- 本地缓存内容

---

## 18. 客户端 UI 需求

### 18.1 整体风格

UI 风格参考 Telegram Desktop。

### 18.2 布局

需要包含：

- 左侧会话列表
- 中间聊天窗口
- 右侧用户信息面板
- 设置页面
- 头像
- 在线状态
- 好友页面
- 搜索入口

### 18.3 聊天窗口

聊天窗口包含：

- 顶部好友信息栏
- 消息列表
- 日期分隔
- 消息气泡
- 发送状态
- 已读状态
- 图片消息展示
- 文件消息卡片
- 回复预览
- 输入框
- Emoji 入口
- 文件按钮
- 图片按钮
- 发送按钮

### 18.4 设置页面

设置项：

- 主题：跟随系统 / 浅色 / 深色
- 语言：跟随系统 / 中文 / English
- 文件保存路径
- 系统托盘开关
- 桌面通知开关
- 开机自启动开关
- 清理本地缓存
- 当前设备信息
- 退出登录

---

## 19. 配置项

### 19.1 服务端 .env

```env
NODE_ENV=development
PORT=8080

DATABASE_URL=postgresql://langram:password@localhost:5432/langram

JWT_ACCESS_SECRET=change_me
JWT_REFRESH_SECRET=change_me
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=example@example.com
SMTP_PASS=change_me
SMTP_FROM="LanGram <example@example.com>"

FILE_STORAGE_DIR=/var/lib/langram/files
MAX_FILE_SIZE_MB=200

ALLOW_GUEST_ACCOUNT=true
ADMIN_INITIAL_EMAIL=admin@example.com
```

### 19.2 客户端配置

```json
{
  "serverUrl": "http://192.168.1.100:8080",
  "wsUrl": "ws://192.168.1.100:8080/ws",
  "theme": "system",
  "language": "system",
  "downloadDir": "%USERPROFILE%\\Documents\\LanGram",
  "enableTray": true,
  "enableNotifications": false,
  "enableAutoStart": false
}
```

---

## 20. 开发阶段拆分

### Phase 0：项目初始化

目标：

- 创建 monorepo
- 初始化 client
- 初始化 server
- 配置 lint / format
- 配置 TypeScript
- 配置 Prisma
- 配置基础 README

建议目录：

```text
langram/
  client/
  server/
  docs/
  README.md
```

### Phase 1：服务端基础

实现：

- NestJS 项目
- PostgreSQL 连接
- Prisma schema
- 环境变量校验
- Health API
- Auth 基础模块
- SMTP 验证码
- JWT 登录
- 游客登录
- 单设备会话策略

验收：

- 可以注册
- 可以登录
- 可以游客登录
- 可以刷新 token
- 新设备登录踢下旧设备

### Phase 2：客户端基础

实现：

- Tauri + React 项目
- 登录页
- 注册页
- 游客登录页
- 主布局
- 设置页
- 本地配置保存
- SQLite 初始化
- 设备 ID 生成
- HTTP API 封装

验收：

- Windows 上可以启动客户端
- 可以连接服务端
- 可以登录并进入主界面
- 可以退出登录

### Phase 3：好友系统

实现：

- 配对码生成
- 配对码输入
- 好友申请
- 好友确认 / 拒绝
- 好友列表
- 在线状态基础展示

验收：

- A 生成配对码
- B 输入配对码
- A 收到好友申请
- A 确认后双方成为好友

### Phase 4：实时聊天

实现：

- WebSocket 网关
- 单聊会话
- 文本消息
- 消息密文存储
- 客户端解密展示
- 离线消息投递
- 已发送 / 已送达 / 已读
- 回复消息
- 本地 SQLite 缓存

验收：

- 两个用户可以实时聊天
- 用户离线后上线能收到消息
- 已读状态能同步
- 本地重启后仍可看到历史消息

### Phase 5：消息操作

实现：

- 撤回
- 编辑
- 删除本地消息
- 清空当前会话本地记录
- 消息搜索
- 转发给单个好友

验收：

- 2 分钟内可撤回
- 15 分钟内可编辑
- 编辑后显示“已编辑”
- 本地删除不影响对方
- 搜索能搜到本地消息

### Phase 6：文件和图片

实现：

- 图片发送
- 图片默认压缩
- 原图发送选项
- 文件上传
- 文件下载
- 文件大小限制 200MB
- 下载记录
- 自定义保存路径
- 尝试断点续传
- 文件消息 UI

验收：

- 可以发送图片
- 可以发送文件
- 超过 200MB 拒绝上传
- 下载后可从本地打开
- 下载记录可查看

### Phase 7：客户端体验

实现：

- Telegram 风格 UI 优化
- 深色/浅色模式
- 中英文切换
- 系统托盘
- 桌面通知
- 开机自启动
- 右侧用户信息面板

验收：

- UI 接近 Telegram Desktop 结构
- 设置项可保存并生效
- 新消息可通知
- 托盘行为正常

### Phase 8：管理后台

实现：

- Web 管理后台
- 管理员登录
- 用户列表
- 禁用 / 启用账号
- 重置登录状态
- 在线设备
- 登录日志
- 错误日志
- 删除违规头像或文件
- 游客账号开关

验收：

- 管理员可以登录后台
- 可以管理账号
- 可以查看日志
- 不能查看聊天明文

### Phase 9：打包和部署

实现：

- Windows 客户端打包
- Rocky Linux 服务端部署说明
- PostgreSQL 初始化脚本
- systemd 服务
- 日志目录
- 文件存储目录
- README

验收：

- 服务端可在 Rocky Linux 启动
- 客户端可连接固定 IP 服务端
- 两台 Windows 客户端可完成完整聊天流程

---

## 21. 测试计划

### 21.1 单元测试

服务端至少测试：

- AuthService
- EmailCodeService
- FriendsService
- MessagesService
- FilesService

客户端至少测试：

- messageCrypto
- API client
- settings store
- file utils
- image compression utils

### 21.2 集成测试

测试场景：

- 注册登录
- 游客登录
- 添加好友
- 发送消息
- 离线消息
- 已读状态
- 撤回消息
- 编辑消息
- 上传文件
- 下载文件

### 21.3 手动验收测试

必须通过：

1. Rocky Linux 服务端启动成功
2. PostgreSQL 连接成功
3. Windows 客户端 A 登录成功
4. Windows 客户端 B 登录成功
5. A 生成配对码
6. B 添加 A
7. A 确认好友
8. A 给 B 发送文本
9. B 实时收到文本
10. B 回复 A
11. A 发送图片
12. B 看到图片
13. A 发送文件
14. B 下载文件
15. A 撤回 2 分钟内消息
16. A 编辑 15 分钟内消息
17. B 已读后 A 能看到已读状态
18. B 离线时 A 发送消息
19. B 上线后收到离线消息
20. 管理后台可查看用户和日志

---

## 22. 安全要求

### 22.1 鉴权

- REST API 使用 access token
- WebSocket 连接时校验 access token
- Refresh token 存储 hash
- 登出后 refresh token 失效

### 22.2 文件安全

- 文件名必须清洗
- 禁止路径穿越
- 限制文件大小
- MIME 类型检测
- 文件保存到服务端指定目录
- 管理员可删除违规文件

### 22.3 数据安全

- 服务端不保存消息明文
- 客户端本地数据库加密
- 私钥不得上传服务端
- 日志不得记录验证码、token、明文消息、密码

### 22.4 管理后台安全

- 管理后台需要管理员身份
- 所有管理操作记录日志
- 管理员不能查看聊天明文
- 默认管理员通过环境变量初始化

---

## 23. 后续版本路线

### v0.2

- 完整断点续传
- 文件上限提升
- 二维码添加好友
- 多选转发
- 更完整的本地搜索
- 局域网自动发现服务端

### v0.3

- 2GB 文件支持
- 局域网 P2P 文件直传
- P2P 失败降级策略
- 文件传输速度显示
- 文件传输暂停 / 继续

### v0.4

- 多设备同时在线
- 陌生设备扫码确认
- 设备信任管理
- 设备丢失恢复流程优化

### v0.5

- 完整端到端加密
- 前向保密
- 密钥轮换
- 安全码校验
- 多设备密钥同步

### v1.0

- 广域网部署
- HTTPS
- 反向代理
- STUN/TURN
- WebRTC DataChannel
- Docker Compose
- 服务器监控
- 自动更新

---

## 24. 最终 MVP 验收标准

MVP 完成的定义：

1. 服务端可在 Rocky Linux 上运行。
2. PostgreSQL 数据库可正常初始化。
3. Windows 客户端可安装并运行。
4. 客户端可连接固定 IP 服务端。
5. 用户可通过邮箱验证码注册和登录。
6. 用户可使用游客账号登录。
7. 两个用户可通过配对码添加好友。
8. 两个用户可进行单聊。
9. 支持文本、Emoji、图片、文件。
10. 支持回复消息。
11. 支持已读/未读。
12. 支持撤回和编辑。
13. 支持本地删除和清空本地会话。
14. 支持本地消息搜索。
15. 支持 200MB 内文件发送。
16. 支持图片默认压缩和原图发送。
17. 支持文件下载记录和自定义保存路径。
18. 支持浅色/深色模式。
19. 支持中英文切换。
20. 支持系统托盘、桌面通知、开机自启动设置。
21. 管理后台可管理账号、设备和日志。
22. 服务端不保存消息明文。
23. 项目代码结构清晰，便于后续扩展 P2P、多设备和完整 E2EE。

---

## 25. Codex 开发建议 Prompt

可以将下面这段作为给 Codex 的起始指令：

```text
请根据 docs/LanGram_MVP_Spec.md 开发 LanGram MVP。

优先顺序：
1. 搭建 monorepo：client + server。
2. 服务端使用 NestJS + TypeScript + Prisma + PostgreSQL。
3. 客户端使用 Tauri v2 + React + TypeScript + Rust。
4. 先实现认证、好友、单聊、WebSocket、SQLite 本地缓存。
5. 再实现文件、图片、消息操作、设置、管理后台。
6. 不要一次性实现完整 P2P、完整端到端加密、多设备密钥同步。
7. 对于暂不实现的高级功能，请保留接口、类型和 TODO 注释。
8. 每完成一个阶段，请保证项目可以启动、可以测试、可以提交。
9. 所有 API、数据库字段、事件名使用英文。
10. UI 文案支持 zh-CN 和 en-US。
```

---

## 26. 关键决策冻结

以下决策在 MVP 阶段固定：

```text
Project Name: LanGram
Client: Tauri v2 + React + TypeScript + Rust
Server: NestJS + TypeScript
Database: PostgreSQL + Prisma
Client Local DB: SQLite
OS: Windows client + Rocky Linux server
Network: Fixed server IP
Architecture: Central server mode
File Limit: 200MB
File Transfer: Server relay
P2P: Reserved only
Email: SMTP verification code
Admin: Web admin
Login: Formal email account + guest account
MVP Device Rule: Single active device per account
Future Device Rule: Multi-device online + QR approval
Encryption: MVP message content encryption
Full E2EE: Future version
Chat Type: Direct chat only
UI Style: Telegram
Language: Chinese + English
Theme: Light + Dark
```
