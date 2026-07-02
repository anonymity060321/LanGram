# LanGram

![Status](https://img.shields.io/badge/status-MVP-blue)
![Client](https://img.shields.io/badge/client-Tauri%20%2B%20React-24C8DB)
![Server](https://img.shields.io/badge/server-NestJS%20%2B%20Prisma-E0234E)
![Database](https://img.shields.io/badge/database-PostgreSQL-336791)
![License](https://img.shields.io/badge/license-TBD-lightgrey)

LanGram is a desktop-first, LAN-first chat app built with Tauri, React, NestJS, Prisma, PostgreSQL, and Socket.IO.

## Overview / 项目概览

LanGram 是一个基于 Tauri + React + NestJS 的桌面聊天应用，优先面向 Windows 桌面端。项目目标是先完成局域网 / 小规模聊天 MVP，再逐步扩展到跨网段和 WAN 场景。

当前版本聚焦：

- Desktop-first Windows client
- LAN-first MVP chat workflow
- Realtime direct chat and group chat
- Group chat management panel
- Client-side MVP message content encryption
- Server-side relay and sync with Socket.IO

## Screenshots

> 截图将在 UI 稳定后补充。

## Features

### Account & Friends

- [x] 邮箱 / 临时账号基础能力
- [x] 好友系统
- [x] 好友申请实时刷新
- [x] 删除好友应用内二次确认

### Direct Chat

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

### Group Chat

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

### Files & Images

- [x] 图片发送与预览
- [x] 图片预览滚轮缩放
- [x] 图片预览拖拽
- [x] 图片预览缩放比例显示
- [x] 文件发送与下载
- [x] Office / PDF 等常见文件上传兼容
- [x] file-icon-vectors 文件图标统一
- [x] 文件消息卡片横向布局
- [x] 移除旧 client/public/file_icon 资源

### Realtime & Sync

- [x] Socket.IO realtime gateway
- [x] 好友申请实时刷新
- [x] group_member_added
- [x] group_member_removed
- [x] group_member_left
- [x] conversation:updated / group_updated
- [x] 群成员变更多端同步
- [x] 群资料变更多端同步

### MVP Security

- [x] AES-GCM MVP message encryption
- [x] 服务端只保存 / 转发 ciphertext、nonce、encryptionVersion
- [x] GROUP 新消息使用 mvp-group-v2
- [x] 群聊离线成员后续上线可解密新群消息
- [x] token/session 不写入 localStorage

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

## Tech Stack

| Layer | Stack |
|---|---|
| Desktop client | Tauri, React, TypeScript, Rust |
| State | Zustand |
| Realtime | Socket.IO client / Socket.IO Gateway |
| Server | NestJS, TypeScript |
| ORM | Prisma |
| Database | PostgreSQL |
| Local capability | Tauri / Rust file and window APIs |
| UI | Telegram-like desktop layout |

## Architecture

LanGram 使用中心服务端模式：客户端负责桌面体验、本地能力、消息加解密和实时连接；服务端负责认证、会话、成员关系、文件中转、数据库持久化和 Socket.IO 同步。

```text
client/
  Tauri + React + TypeScript
  Zustand stores
  Socket.IO client
  Local file / window capabilities

server/
  NestJS application
  Prisma ORM
  PostgreSQL
  Socket.IO Gateway

docs/
  Project specs and development notes
```

## Database / Migrations

当前重要 migration：

- `20260702012928_add_group_intro`
  - 为 `conversations` 表新增 `intro` 字段
  - 字段类型：`VARCHAR(500)`
  - 用于群简介保存

开发环境更新数据库：

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

## Security Notes

- 当前 MVP 使用 AES-GCM 做消息内容加密。
- 服务端保存 / 转发 `ciphertext`、`nonce`、`encryptionVersion`。
- 服务端不应处理消息明文。
- GROUP 新消息使用 `mvp-group-v2`，key derivation 基于稳定 `conversationId`，用于解决离线成员后续上线无法解密新群消息的问题。
- 当前方案不是完整端到端加密，也不应宣称为完整 E2EE。
- token/session 不写入 `localStorage`。
- 不应在日志中输出 plaintext、token、password、verification、clipboard、本地文件路径、ciphertext、nonce 等敏感信息。

## Development

### Client

```powershell
cd client
npm.cmd install
npm.cmd run lint
npm.cmd run build
npm.cmd run tauri dev
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
npm.cmd install
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

## Repository Notes

- `.env` 不提交。
- 使用 `.env.example` 作为配置模板。
- `node_modules`、`target`、`dist` 等生成目录不提交。
- 旧的 `client/public/file_icon` 资源已移除，文件图标统一使用 file-icon-vectors。
- `client/public/vector_icon` 仍保留，用于客户端 UI 图标。

## Current Status

LanGram 当前处于 MVP 开发阶段，重点是稳定、可运行、可验证的局域网 / 小规模聊天体验。安全能力是 MVP message content encryption，不是完整安全通信产品；生产化部署、完整 E2EE、多设备完整同步和 WAN 方案仍在后续路线图中。
