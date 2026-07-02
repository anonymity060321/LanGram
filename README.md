# LanGram

## 项目简介

LanGram 是一个基于 Tauri + React + NestJS 的桌面聊天应用，优先面向 Windows 桌面端。项目目标是先完成局域网 / 小规模聊天 MVP，再逐步扩展到跨网段和 WAN 场景。

当前阶段重点是稳定核心聊天体验、好友系统、图片与文件收发、群聊基础能力、群管理面板、桌面端本地能力，以及 MVP 级消息内容加密。

## 技术栈

- Client: Tauri, React, TypeScript, Rust, Zustand, Socket.IO client
- Server: NestJS, TypeScript, Prisma, PostgreSQL, Socket.IO Gateway
- Database: PostgreSQL
- Local capabilities: Tauri/Rust 本地文件能力、下载保存、窗口能力

## 当前进度

### 已完成

基础能力：

- 认证与账号基础
- 好友系统
- 好友申请实时刷新
- 删除好友二次确认
- 单聊会话
- 非好友消息发送失败气泡
- 会话搜索独立窗口
- 会话置顶 / 取消置顶
- 消息免打扰
- 清空本地记录
- emoji 面板
- 发送快捷键菜单，选中项使用 ✔

消息与文件：

- 文本消息
- 图片发送与预览
- 文件发送与下载
- Office/PDF 等常见文件上传兼容
- file-icon-vectors 文件图标统一
- 文件消息卡片重构
- 图片预览滚轮缩放 / 拖拽 / 缩放比例显示

群聊：

- 群聊基础能力
- 群聊文本 / 图片 / 文件消息
- 群昵称
- 私有群备注 groupRemark
- 群昵称 / 群备注自动保存
- 群聊退出
- 群聊退出应用内二次确认
- 群聊邀请成员
- 邀请成员左右双栏选择器
- 邀请成员多端实时同步
- 群成员右侧资料卡片
- 群成员资料卡片中好友成员可直接发起单聊
- 群管理入口
- 独立群管理面板
- 群名称保存
- 群简介保存
- Conversation.intro 字段与 Prisma migration
- conversation:updated / group_updated 实时同步
- 成员管理视图
- 成员搜索
- 成员排序
- 成员管理邀请入口
- 群主移除普通成员
- 移除成员应用内二次确认
- group_member_removed 实时同步
- 管理员只读 / 占位视图

加密与同步：

- MVP 消息内容加密
- GROUP 新消息使用 mvp-group-v2
- 群聊离线成员后续上线可解密新群消息
- 服务端只接收 / 保存 / 转发 ciphertext、nonce、encryptionVersion

资源清理：

- 已移除旧 client/public/file_icon 资源
- client/public/vector_icon 仍保留用于客户端 UI 图标

### 暂未实现

- 完整管理员机制
- 管理员任命 / 取消管理员
- 群主转让
- 群头像上传
- 邀请链接真实生成
- 群公告
- @ 功能
- 举报系统
- P2P
- 完整 E2EE
- 多设备完整同步
- 完整 WAN 部署方案

## 数据库 / Migration 说明

重要 migration：

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

## 安全说明

- 当前 MVP 使用 AES-GCM 做消息内容加密。
- 服务端保存 / 转发 ciphertext、nonce、encryptionVersion。
- 服务端不应处理消息明文。
- GROUP 新消息使用 mvp-group-v2，key derivation 基于稳定 conversationId，解决离线成员后续上线无法解密新消息的问题。
- 当前方案不是完整端到端加密。
- token/session 不写入 localStorage。
- 不应在日志中输出 plaintext、token、password、verification、clipboard、本地文件路径、ciphertext、nonce 等敏感信息。

## 开发命令

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

## Git / 环境说明

- `.env` 不提交。
- 使用 `.env.example` 作为配置模板。
- `node_modules`、`target`、`dist` 等生成目录不提交。
- 旧的 `client/public/file_icon` 已移除，文件图标统一使用 `file-icon-vectors`。
- `client/public/vector_icon` 仍保留，用于客户端 UI 图标。

## 说明

LanGram 当前仍处于 MVP 开发阶段，已具备基础账号、好友、单聊、群聊、图片 / 文件收发、群管理和桌面端能力，但不应被视为生产级安全通信软件。当前消息内容加密是 MVP 级能力，不等同于完整 E2EE 或 Secret Chat。
