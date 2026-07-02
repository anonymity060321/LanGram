# LanGram

![Status](https://img.shields.io/badge/status-MVP-blue)
![Client](https://img.shields.io/badge/client-Tauri%20%2B%20React-24C8DB)
![Server](https://img.shields.io/badge/server-NestJS%20%2B%20Prisma-E0234E)
![Database](https://img.shields.io/badge/database-PostgreSQL-336791)
![License](https://img.shields.io/badge/license-TBD-lightgrey)

LanGram 是一个基于 Tauri + React + NestJS 的桌面聊天应用，优先面向 Windows 桌面端，目标是先完成局域网 / 小规模聊天 MVP，再逐步扩展到跨网段和 WAN 场景。

## 目录

- [项目背景](#项目背景)
- [项目目标](#项目目标)
- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [系统架构](#系统架构)
- [项目结构](#项目结构)
- [数据库与 Migration](#数据库与-migration)
- [安装与运行](#安装与运行)
- [开发与验证命令](#开发与验证命令)
- [安全说明](#安全说明)
- [当前状态](#当前状态)
- [Roadmap](#roadmap)
- [License](#license)

## 项目背景

LanGram 的目标是构建一个稳定、可运行、可验证的桌面端聊天应用。当前阶段优先服务小规模局域网、校园网和实验环境，先完成 MVP 级核心聊天体验，再逐步扩展到跨网段和 WAN 场景。

项目采用客户端 + 服务端架构。客户端负责 Telegram-like 桌面 UI、桌面窗口能力、本地文件能力、消息输入体验和 MVP 消息内容加密；服务端负责认证、好友关系、会话、消息转发、文件中转、群管理和实时事件同步。

当前版本不是生产级安全通信系统，也不是完整 E2EE / Secret Chat 实现。安全设计以“服务端不处理消息明文”和“客户端 MVP 加密”为当前边界。

## 项目目标

### 当前 MVP 目标

- Windows desktop first
- 单聊
- 群聊
- 好友系统
- 图片 / 文件消息
- 群管理
- 实时同步
- MVP 消息加密
- PostgreSQL 持久化

### 长期目标

- 跨网段 / WAN 场景支持
- 完整管理员机制
- 完整 E2EE
- 多设备完整同步
- P2P 能力
- 更完整的群管理能力

## 功能特性

### 账号与好友

- [x] 账号基础能力
- [x] 邮箱 / 临时账号基础流程
- [x] 好友系统
- [x] 好友申请实时刷新
- [x] 删除好友应用内二次确认

### 单聊

- [x] 单聊会话
- [x] 文本消息
- [x] 图片消息
- [x] 文件消息
- [x] 非好友消息发送失败气泡
- [x] 会话置顶 / 取消置顶
- [x] 消息免打扰
- [x] 会话搜索独立窗口
- [x] 清空本地记录
- [x] emoji 面板
- [x] 发送快捷键菜单，选中项使用 ✔

### 群聊

- [x] 群聊基础能力
- [x] 群聊文本 / 图片 / 文件消息
- [x] 群昵称
- [x] 私有群备注 groupRemark
- [x] 群昵称 / 群备注自动保存
- [x] 群聊退出
- [x] 群聊退出应用内二次确认
- [x] 群聊邀请成员
- [x] 邀请成员左右双栏选择器
- [x] 邀请成员多端实时同步
- [x] 群成员右侧资料卡片
- [x] 群成员资料卡片中好友成员可直接发起单聊
- [x] 群管理入口
- [x] 独立群管理面板
- [x] 群名称保存
- [x] 群简介保存
- [x] Conversation.intro 字段与 Prisma migration
- [x] conversation:updated / group_updated 实时同步
- [x] 成员管理视图
- [x] 成员搜索 / 排序
- [x] 成员管理邀请入口
- [x] 群主移除普通成员
- [x] 移除成员应用内二次确认
- [x] group_member_removed 实时同步
- [x] 管理员只读 / 占位视图

### 文件与图片

- [x] 图片发送与预览
- [x] 图片预览滚轮缩放
- [x] 图片预览拖拽
- [x] 图片预览缩放比例显示
- [x] 文件发送与下载
- [x] Office / PDF 等常见文件上传兼容
- [x] file-icon-vectors 文件图标统一
- [x] 文件消息卡片横向布局
- [x] 移除旧 client/public/file_icon 资源

### 实时同步

- [x] Socket.IO realtime gateway
- [x] 好友申请实时刷新
- [x] group_member_added
- [x] group_member_removed
- [x] group_member_left
- [x] conversation:updated / group_updated
- [x] 群成员变更多端同步
- [x] 群资料变更多端同步

### MVP 加密

- [x] AES-GCM MVP message encryption
- [x] 服务端只保存 / 转发 ciphertext、nonce、encryptionVersion
- [x] GROUP 新消息使用 mvp-group-v2
- [x] 群聊离线成员后续上线可解密新群消息
- [x] token/session 不写入 localStorage

## 技术栈

| Layer | Stack |
|---|---|
| Desktop client | Tauri, React, TypeScript, Rust |
| State management | Zustand |
| Realtime client | Socket.IO client |
| Server | NestJS, TypeScript |
| Realtime server | Socket.IO Gateway |
| ORM | Prisma |
| Database | PostgreSQL |
| Local desktop capability | Tauri / Rust file and window APIs |
| Message crypto | Web Crypto AES-GCM MVP encryption |

## 系统架构

LanGram 使用中心服务端模式。客户端通过 REST API 完成认证、会话、文件等请求，通过 Socket.IO 接收实时事件；服务端使用 NestJS 组织业务模块，通过 Prisma 访问 PostgreSQL，并通过 Socket.IO Gateway 向在线客户端推送消息、好友、群成员和群资料变更。

```text
┌─────────────────────────────────────┐
│              Client                 │
│  Tauri + React + TypeScript          │
│  Zustand Store                       │
│  Socket.IO Client                    │
│  Web Crypto AES-GCM                  │
│  Rust / Tauri local capabilities     │
└──────────────────┬──────────────────┘
                   │ REST + WebSocket
┌──────────────────▼──────────────────┐
│              Server                 │
│  NestJS                              │
│  Socket.IO Gateway                   │
│  Prisma ORM                          │
│  Auth / Friends / Conversations      │
│  Messages / Group Management         │
└──────────────────┬──────────────────┘
                   │
┌──────────────────▼──────────────────┐
│             PostgreSQL              │
│  users / friendships / conversations │
│  conversation_members / messages     │
│  file metadata                       │
└─────────────────────────────────────┘
```

## 项目结构

```text
LanGram/
  README.md
  docs/
    LanGram_MVP_Codex_Spec.md
    Phase_8_13_Windows_Notifications.md
  client/
    src/
      api/
      crypto/
      i18n/
      pages/
      realtime/
      stores/
      utils/
    src-tauri/
      src/
  server/
    prisma/
      schema.prisma
      migrations/
    src/
      auth/
      conversations/
      files/
      friends/
      messages/
      realtime/
      users/
```

## 数据库与 Migration

数据库使用 PostgreSQL，服务端通过 Prisma ORM 访问。Prisma schema 位于 `server/prisma/schema.prisma`，migration 位于 `server/prisma/migrations/`。

当前重要 migration：

- `20260702012928_add_group_intro`
  - 为 `conversations` 表新增 `intro` 字段
  - 字段类型：`VARCHAR(500)`
  - 用于群简介保存

开发环境应用 migration：

```powershell
cd server
npx.cmd prisma migrate dev
```

生产 / 部署环境应用 migration：

```powershell
cd server
npx.cmd prisma migrate deploy
```

生成 Prisma Client：

```powershell
cd server
npx.cmd prisma generate
```

## 安装与运行

### 前置要求

- Node.js / npm
- Rust toolchain
- Tauri v2 运行所需系统依赖
- PostgreSQL
- Windows 桌面环境用于客户端优先验证

### Server

```powershell
cd server
npm.cmd install
npx.cmd prisma generate
npx.cmd prisma migrate dev
npm.cmd run build
```

### Client

```powershell
cd client
npm.cmd install
npm.cmd run build
npm.cmd run tauri dev
```

### 环境变量

- `.env` 不提交。
- 使用 `.env.example` 作为配置模板。
- 数据库连接、JWT、SMTP、文件存储路径等应通过环境变量配置。

## 开发与验证命令

### Client

```powershell
cd client
npm.cmd run lint
npm.cmd run build
```

### Tauri / Rust

```powershell
cd client/src-tauri
cargo check
cargo test
```

### Server

```powershell
cd server
npx.cmd prisma validate
npx.cmd prisma generate
npm.cmd run lint
npm.cmd run build
npm.cmd test
```

### Prisma / Database

```powershell
cd server
npx.cmd prisma migrate dev
npx.cmd prisma migrate deploy
npx.cmd prisma generate
```

## 安全说明

- 当前 MVP 使用 Web Crypto AES-GCM 做消息内容加密。
- 服务端保存 / 转发 `ciphertext`、`nonce`、`encryptionVersion`，不应处理消息明文。
- GROUP 新消息使用 `mvp-group-v2`，key derivation 基于稳定 `conversationId`，用于解决离线成员后续上线无法解密新群消息的问题。
- 当前方案不是完整端到端加密，也不是 Secret Chat。
- token/session 不写入 `localStorage`。
- 不应在日志中输出 plaintext、token、password、verification、clipboard、本地文件路径、ciphertext、nonce 等敏感信息。
- 文件传输使用服务端中转，下载接口需要鉴权，客户端下载保存通过 Tauri / Rust 本地能力完成。

## 当前状态

LanGram 当前处于 MVP 开发阶段，已具备账号、好友、单聊、群聊、图片与文件收发、群管理、群名称 / 群简介保存、实时同步和 MVP 消息内容加密等基础能力。

近期已完成：

- 群管理面板
- 成员管理、搜索、排序、邀请入口
- 群主移除成员与应用内确认
- 管理员只读 / 占位视图
- 群名称 / 群简介保存
- `Conversation.intro` 字段与 `20260702012928_add_group_intro` migration
- `conversation:updated` / `group_updated` 实时同步
- `group_member_removed` 实时同步
- GROUP 新消息 `mvp-group-v2`
- 群聊离线成员后续上线可解密新群消息
- 退出群聊应用内二次确认
- 发送快捷键菜单选中项使用 ✔

## Roadmap

- [ ] 完整管理员机制
- [ ] 管理员任命 / 取消管理员
- [ ] 群主转让
- [ ] 群头像上传
- [ ] 邀请链接真实生成
- [ ] 群公告
- [ ] @ 功能
- [ ] 举报系统
- [ ] P2P
- [ ] 完整 E2EE
- [ ] 多设备完整同步
- [ ] 完整 WAN 部署方案

## License

License: TBD

当前仓库尚未声明 MIT / Apache 等开源许可证。正式分发或公开协作前需要补充明确的 LICENSE 文件。

## Status

MVP in active development. 当前版本适合开发、验证和小规模实验，不应被视为生产级安全通信系统。
