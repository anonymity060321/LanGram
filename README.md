- # LanGram

  LanGram 是一个面向局域网优先场景的即时通信项目，产品体验参考 Telegram，目标是在小型私有网络、宿舍 / 实验室 / 校园网环境中提供轻量、可控、可扩展的聊天体验。

  当前项目重点为：

  - Windows 桌面客户端
  - Linux 服务端
  - 中心化服务端转发架构
  - 单聊优先
  - 局域网优先，后续可扩展到公网部署
  - MVP 消息内容加密，但不是完整端到端加密

  > LanGram MVP implements message content encryption, not full E2EE.

  ------

  ## 项目状态

  LanGram 已经不再是早期 Phase 1 骨架项目。目前已经完成或部分完成：

  - 认证与账号系统
  - 好友系统
  - 单聊会话
  - Socket.IO 实时消息
  - 消息发送 / 接收 / 已读 / 已送达
  - 消息失败重试
  - 消息复制 / 编辑 / 撤回 / 转发 / 本地删除
  - 文件 / 图片基础发送
  - 图片独立预览
  - 文件下载基础能力
  - Tauri 托盘
  - 桌面通知
  - 深色 / 浅色主题
  - 中英文国际化
  - 设置页
  - 认证页体验优化
  - SQLite 本地缓存基础设施

  当前仍未完整完成：

  - 客户端 SQLite 缓存读写完整接入
  - 从 SQLite 恢复会话 / 消息 UI
  - 文件下载记录
  - 自定义保存路径
  - 管理后台
  - 完整部署与打包文档
  - 完整 E2EE / Secret Chat
  - 群聊
  - P2P
  - 完整多设备方案

  ------

  ## 技术栈

  ### Client

  | 模块        | 技术                            |
  | ----------- | ------------------------------- |
  | 桌面框架    | Tauri v2                        |
  | 前端框架    | React                           |
  | 语言        | TypeScript                      |
  | 构建工具    | Vite                            |
  | 桌面后端    | Rust                            |
  | 状态管理    | Zustand                         |
  | 请求 / 缓存 | TanStack Query                  |
  | 路由        | React Router                    |
  | 实时通信    | Socket.IO Client                |
  | 本地缓存    | SQLite via Rust / Tauri command |
  | 桌面通知    | Tauri Notification Plugin       |
  | UI 样式     | 原生 CSS                        |
  | 国际化      | 自研轻量 i18n JSON              |

  ### Server

  | 模块     | 技术                          |
  | -------- | ----------------------------- |
  | 运行时   | Node.js                       |
  | 框架     | NestJS 风格结构               |
  | 语言     | TypeScript                    |
  | ORM      | Prisma                        |
  | 数据库   | PostgreSQL                    |
  | 实时通信 | Socket.IO / WebSocket Gateway |
  | 认证     | JWT + Refresh Token           |
  | 邮件服务 | SMTP                          |
  | 文件存储 | 服务端本地文件系统            |
  | 数据校验 | 后端 DTO / Service 校验       |

  ### Desktop / Native

  | 模块         | 技术                      |
  | ------------ | ------------------------- |
  | 桌面运行时   | Tauri                     |
  | Native 层    | Rust                      |
  | 托盘菜单     | Tauri Tray                |
  | 系统通知     | Tauri Notification Plugin |
  | 本地数据库   | SQLite                    |
  | 本地命令桥接 | Tauri Commands            |

  ------

  ## 项目架构

  ```text
  LanGram/
  ├── client/
  │   ├── src/
  │   │   ├── api/                 # 前端 API 封装
  │   │   ├── crypto/              # MVP 消息内容加密
  │   │   ├── i18n/                # zh-CN / en-US 文案
  │   │   ├── pages/               # 页面
  │   │   ├── realtime/            # Socket.IO 客户端
  │   │   ├── stores/              # Zustand 状态
  │   │   ├── utils/               # 工具函数
  │   │   ├── App.tsx
  │   │   └── main.tsx
  │   ├── src-tauri/
  │   │   ├── src/
  │   │   │   ├── lib.rs           # Tauri 主逻辑与 command 注册
  │   │   │   ├── main.rs
  │   │   │   └── local_cache.rs   # SQLite 本地缓存基础设施
  │   │   ├── Cargo.toml
  │   │   └── tauri.conf.json
  │   └── package.json
  │
  ├── server/
  │   ├── src/
  │   │   ├── auth/                # 认证与账号
  │   │   ├── conversations/       # 会话与消息
  │   │   ├── files/               # 文件上传 / 下载
  │   │   ├── friends/             # 好友系统
  │   │   ├── prisma/              # Prisma Service
  │   │   └── users/               # 用户资料
  │   ├── prisma/
  │   │   ├── schema.prisma
  │   │   └── migrations/
  │   └── package.json
  │
  ├── docs/
  │   └── LanGram_MVP_Codex_Spec.md
  │
  ├── AGENTS.md
  ├── README.md
  ├── package.json
  └── package-lock.json
  ```

  ------

  ## 当前功能

  ### 认证与账号

  已实现或基本实现：

  - 密码登录
  - 邮箱验证码登录
  - 邮箱注册
  - 忘记密码 / 重置密码
  - 游客登录
  - 游客登录必须输入昵称
  - 单账号单客户端策略
  - 异地登录提示
  - Access Token / Refresh Token
  - 服务端保存 Refresh Token Hash
  - 邮箱验证码 Hash 存储
  - 文本验证码
  - 文本验证码固定 6 位
  - 文本验证码 30 秒自动刷新
  - 登录 / 注册 / 游客登录防重复提交
  - 提交中按钮 loading 文案
  - 登录方式切换过渡
  - 密码输入框显示 / 隐藏图标按钮
  - 服务端断开时认证页网络异常提示
  - 注册页已移除临时测试账号入口

  ### 好友系统

  已实现或基本实现：

  - 配对码
  - 添加好友
  - 好友申请
  - 接受好友申请
  - 拒绝好友申请
  - 好友列表
  - 在线 / 离线状态
  - 联系人页面双栏布局
  - 好友通知入口
  - 添加好友入口
  - 搜索栏与更多菜单

  ### 单聊系统

  已实现或基本实现：

  - 单聊会话列表
  - 打开单聊会话
  - REST 拉取历史消息
  - Socket.IO 实时消息
  - 消息发送
  - 消息接收
  - 送达状态
  - 已读状态
  - 消息时间分割线
  - 聊天滚动体验
  - 新消息提示
  - 回到底部按钮
  - 加载历史消息时保持阅读位置

  ### 消息操作

  已实现或基本实现：

  - 文本消息发送
  - failed TEXT 本地失败消息
  - failed TEXT 重试
  - failed TEXT 重连后不消失
  - failed TEXT 编辑后重发使用编辑后的内容
  - failed TEXT 点击撤回时前端拦截并提示失败
  - 消息复制
  - 消息编辑
  - 消息撤回
  - 消息转发
  - 消息本地删除
  - 清空本地记录
  - 消息右键菜单
  - 会话右键菜单
  - 输入框右键菜单

  ### 文件与图片

  已实现或基本实现：

  - 文件发送
  - 图片发送
  - 图片独立预览
  - 文件下载基础能力
  - 服务端文件上传 / 下载
  - 文件大小限制：MVP 200MB

  尚未完整实现：

  - 文件下载记录
  - 自定义保存路径
  - 断点续传
  - 下载任务持久化

  ### 桌面体验

  已实现或基本实现：

  - Tauri Windows 桌面端
  - 托盘菜单
  - 登录前托盘仅显示退出
  - 登录后托盘显示完整设置
  - 托盘右键退出无二次确认
  - 关闭行为设置
  - 关闭到托盘
  - 桌面通知
  - Web 通知 / Tauri 通知
  - 服务端断开 / 重连提示
  - 设置页
  - 深色 / 浅色 / 跟随系统主题
  - 中英文切换
  - 主界面 UI polish
  - 联系人页 UI polish

  ### SQLite 本地缓存

  已完成基础设施：

  - Rust / Tauri 侧 SQLite 基础设施
  - 数据库文件位于 Tauri app data 目录
  - 数据库文件名：

  ```text
  langram-local-cache.sqlite3
  ```

  - 本地 schema v1
  - 本地 migration 机制
  - 设置页显示本地缓存状态
  - 设置页显示 schemaVersion
  - 设置页显示 dbPath
  - 设置页可刷新缓存状态
  - 设置页可清空本地缓存
  - 会话摘要 best-effort 写入 `cached_conversations`

  当前仍未完成：

  - 从 SQLite 读取恢复会话列表 UI
  - 消息历史写入 SQLite
  - 从 SQLite 恢复消息历史
  - 完整离线模式
  - 自动离线队列
  - 自动重放失败消息

  ------

  ## SQLite 本地缓存 Schema

  当前本地 SQLite schema v1 包含：

  ### local_cache_meta

  ```sql
  key TEXT PRIMARY KEY
  value TEXT NOT NULL
  updated_at TEXT NOT NULL
  ```

  ### cached_conversations

  ```sql
  id TEXT PRIMARY KEY
  conversation_type TEXT NOT NULL
  peer_user_id TEXT
  title TEXT
  avatar_url TEXT
  last_message_id TEXT
  last_message_at TEXT
  updated_at TEXT NOT NULL
  ```

  ### cached_messages

  ```sql
  id TEXT PRIMARY KEY
  client_message_id TEXT
  conversation_id TEXT NOT NULL
  sender_id TEXT NOT NULL
  message_type TEXT NOT NULL
  status TEXT NOT NULL
  ciphertext TEXT
  nonce TEXT
  encryption_version TEXT
  metadata_json TEXT
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL
  delivered_at TEXT
  read_at TEXT
  edited_at TEXT
  recalled_at TEXT
  local_deleted_at TEXT
  ```

  ### local_clear_watermarks

  ```sql
  conversation_id TEXT PRIMARY KEY
  cleared_at TEXT NOT NULL
  updated_at TEXT NOT NULL
  ```

  ### 安全说明

  `cached_messages` 不保存：

  - plaintext
  - plainText
  - decryptedText
  - messagePlaintext
  - token
  - password
  - captcha
  - verification code
  - clipboard content

  ------

  ## 安全边界

  LanGram 当前 MVP 的安全边界如下：

  - MVP message content encryption, not full E2EE.
  - 客户端发送消息前加密消息内容。
  - 服务端只接收并存储：
    - `ciphertext`
    - `nonce`
    - `encryptionVersion`
    - 必要 metadata
  - 服务端不应存储消息明文。
  - 服务端不应显示消息明文。
  - 不把 Access Token / Refresh Token 写入 `localStorage`。
  - 不把 token 写入 SQLite。
  - 不把消息明文写入 SQLite。
  - 不记录密码、验证码、token、消息明文、剪贴板内容。
  - 不复用 AES-GCM nonce。
  - 不实现自动无限重试。
  - 不实现自动离线队列。
  - 不恢复浏览器默认右键菜单。

  当前未实现完整 E2EE，因此以下能力不属于当前 MVP：

  - Secret Chat
  - 双棘轮
  - 前向保密
  - 多设备密钥同步
  - 完整端到端加密
  - 端到端加密群聊

  ------

  ## 环境要求

  ### 通用要求

  - Node.js LTS
  - npm
  - Rust stable toolchain
  - PostgreSQL
  - SMTP 邮箱服务
  - Windows Tauri v2 开发环境
  - Linux / Rocky Linux 服务端环境

  ### 推荐开发环境

  Client：

  - Windows 10 / Windows 11
  - Tauri prerequisites
  - Microsoft Edge WebView2 Runtime

  Server：

  - Linux / Rocky Linux
  - PostgreSQL 16+
  - systemd
  - Nginx 可选

  ------

  ## 安装依赖

  在仓库根目录执行：

  ```bash
  npm install
  ```

  ------

  ## 环境变量

  复制环境变量示例文件：

  ```bash
  copy server\.env.example server\.env
  copy client\.env.example client\.env
  ```

  Linux / macOS 可使用：

  ```bash
  cp server/.env.example server/.env
  cp client/.env.example client/.env
  ```

  不要提交真实密钥、SMTP 密码、数据库密码或 token。

  ------

  ## 数据库

  服务端使用 PostgreSQL + Prisma。

  常用命令：

  ```bash
  cd server
  npx.cmd prisma validate
  npx.cmd prisma generate
  ```

  如果任务没有明确要求，不要新增 Prisma migration。

  ------

  ## 启动服务端

  ```bash
  npm.cmd run start:dev -w server
  ```

  ------

  ## 启动客户端

  进入客户端目录：

  ```bash
  cd client
  npm.cmd run tauri dev
  ```

  不要先单独运行：

  ```bash
  npm.cmd run dev
  ```

  因为 Tauri 的 `beforeDevCommand` 已经会自动启动 Vite。提前手动启动 Vite 可能导致端口冲突。

  ------

  ## 常用验证命令

  ### 全项目 lint

  ```bash
  npm.cmd run lint
  ```

  ### 全项目 build

  ```bash
  npm.cmd run build
  ```

  ### 服务端测试

  ```bash
  npm.cmd run test -w server
  ```

  ### Prisma 校验

  ```bash
  cd server
  npx.cmd prisma validate
  npx.cmd prisma generate
  ```

  ### Tauri / Rust 检查

  ```bash
  cd client\src-tauri
  cargo check
  cargo test
  ```

  ### Tauri 启动级验证

  ```bash
  cd client
  npm.cmd run tauri dev
  ```

  ------

  ## Windows 构建注意事项

  在 Windows 上运行 Rust / Tauri 时，可能遇到以下问题：

  ### `.cargo-lock` 拒绝访问

  表现：

  ```text
  failed to open target/debug/.cargo-lock
  拒绝访问。 (os error 5)
  ```

  常见原因：

  - 上一次 `cargo` / `tauri dev` 未完全退出
  - `langram-client.exe` 仍在运行
  - Vite / Node / Cargo 残留进程占用文件

  可尝试结束相关进程后重试：

  ```powershell
  Get-Process cargo,rustc,langram-client,node -ErrorAction SilentlyContinue | Stop-Process -Force
  ```

  ### Windows 应用程序控制策略拦截

  表现：

  ```text
  应用程序控制策略已阻止此文件。 (os error 4551)
  ```

  这通常是 Windows Smart App Control / 企业策略拦截 Cargo 生成的临时 build script，不是源码错误。

  可检查：

  ```text
  Windows 安全中心
  → 应用和浏览器控制
  → 智能应用控制
  ```

  如果设备由学校或组织策略管理，可能需要管理员调整策略。

  ------

  ## 当前 Phase 概览

  | Phase   | 状态     | 说明                                       |
  | ------- | -------- | ------------------------------------------ |
  | Phase 0 | 已完成   | monorepo、基础文档、约束文档               |
  | Phase 1 | 已完成   | 认证与账号基础                             |
  | Phase 2 | 部分完成 | 客户端基础、设置、设备 ID、本地配置        |
  | Phase 3 | 接近完成 | 好友系统、配对码、好友申请                 |
  | Phase 4 | 部分完成 | 单聊会话、REST 历史、Socket.IO 实时消息    |
  | Phase 5 | 部分完成 | 消息编辑、撤回、转发、重试、本地删除       |
  | Phase 6 | 部分完成 | 文件 / 图片基础能力                        |
  | Phase 7 | 部分完成 | UI polish、主题、语言、托盘、通知          |
  | Phase 8 | 进行中   | 当前做客户端体验和本地缓存；管理后台未开始 |
  | Phase 9 | 部分完成 | Tauri 配置存在，部署与打包文档未完整落地   |

  ------

  ## 已知缺口

  ### 客户端本地缓存

  已完成：

  - SQLite 基础设施
  - 初始化
  - 设置页状态入口
  - 清空本地缓存
  - 会话摘要写入 cached_conversations

  未完成：

  - 从 SQLite 读取恢复会话列表
  - 消息历史写入 SQLite
  - 从 SQLite 读取恢复消息历史
  - 离线缓存完整闭环

  ### 文件下载

  未完成：

  - 下载记录
  - 自定义保存路径
  - 下载任务状态
  - 断点续传

  ### 管理后台

  未完成：

  - 管理员登录
  - 用户管理
  - 日志查看
  - 错误追踪
  - 文件管理
  - 系统状态

  ### 部署与打包

  未完成：

  - 完整 Rocky Linux 部署文档
  - systemd 服务配置文档
  - Nginx 反向代理文档
  - Windows 安装包完整验收
  - 自动更新机制

  ------

  ## 不在当前 MVP 范围内

  以下能力暂不属于当前 MVP：

  - 群聊
  - 频道
  - P2P 文件传输
  - WebRTC
  - STUN / TURN
  - 完整多设备同时在线方案
  - Secret Chat
  - 双棘轮
  - 前向保密
  - 完整端到端加密
  - 多设备密钥同步
  - 管理后台读取聊天明文

  ------

  ## 开发约束

  开发时必须遵守：

  - 不修改服务端，除非任务明确要求。
  - 不新增 Prisma migration，除非任务明确要求。
  - 不修改消息协议，除非任务明确要求。
  - 不修改加密协议，除非任务明确要求。
  - 不保存消息明文到 SQLite。
  - 不保存 token 到 SQLite。
  - 不把 token 写入 localStorage。
  - 不记录密码、验证码、token、消息明文、剪贴板内容。
  - 不恢复浏览器默认右键菜单。
  - 不实现自动离线队列。
  - 不自动重放失败消息。
  - 不破坏 failed TEXT 重试链路。
  - 不破坏消息时间分割线。
  - 不破坏聊天滚动体验。
  - 不破坏认证页体验优化。

  ------

  ## Git 提交建议

  常用提交格式：

  ```bash
  git commit -m "feat(client): add local SQLite cache foundation"
  git commit -m "feat(client): expose local cache status in settings"
  git commit -m "feat(client): cache conversation summaries locally"
  git commit -m "fix(client): improve failed message retry flow"
  git commit -m "docs: update project status and MVP scope"
  ```

  ------

  ## Roadmap

  ### 近期优先级

  1. 从 SQLite 读取恢复会话列表
  2. 消息历史写入 SQLite
  3. 从 SQLite 读取恢复消息历史
  4. 文件下载记录
  5. 自定义文件保存路径
  6. 管理后台 Phase 8
  7. 部署与打包 Phase 9

  ### 中期方向

  - 更完善的离线体验
  - 本地搜索
  - 更完整的设置页
  - 文件下载管理
  - 日志与诊断工具
  - 管理后台
  - 公网部署支持

  ### 长期方向

  - 多设备支持
  - 群聊
  - P2P / WebRTC
  - Secret Chat
  - 完整 E2EE
  - 自动更新
  - 更完善的安装包与发布流程

  ------

  ## License

  当前项目 License 尚未明确。发布到 GitHub 前建议补充：

  - MIT
  - Apache-2.0
  - GPL-3.0
  - 私有项目 / All rights reserved

  根据项目开放程度选择其一。

  ------

  ## Disclaimer

  LanGram 当前仍处于 MVP 开发阶段。虽然已经具备基础聊天、好友、文件、通知和本地缓存能力，但仍不应被视为生产级安全通信软件。

  当前 MVP 不是完整端到端加密实现，不提供 Secret Chat、双棘轮、前向保密或多设备密钥同步。
