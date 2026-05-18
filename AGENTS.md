# AGENTS.md — LanGram Codex/GPT-5.5 开发约束

> 适用范围：本文件用于约束 Codex + GPT-5.5 在 LanGram 仓库中的开发行为。  
> 推荐位置：仓库根目录 `/AGENTS.md`。  
> 关联需求文档：`docs/LanGram_MVP_Codex_Spec.md`。  
> 项目阶段：MVP v0.1。  
> 核心目标：先做出稳定、可运行、可验证的局域网 Telegram 风格聊天软件，不提前实现远期复杂能力。

---

## 0. 指令优先级

当不同来源的要求冲突时，按以下优先级执行：

1. 用户当前明确指令。
2. 本文件 `AGENTS.md`。
3. `docs/LanGram_MVP_Codex_Spec.md`。
4. 已有代码风格和目录结构。
5. 合理工程默认值。

如果需求文档和本文件冲突：

- 本文件约束“如何开发、如何取舍、如何验证”。
- 需求文档约束“产品功能、模块范围、验收标准”。
- 无法判断时，先提出冲突点，不要静默选择。

---

## 1. 项目硬性边界

LanGram 当前只开发 MVP v0.1。

### 1.1 必须遵守的 MVP 边界

当前 MVP 固定为：

```text
Project: LanGram
Client: Tauri v2 + React + TypeScript + Rust
Server: NestJS + TypeScript
Database: PostgreSQL + Prisma
Client Local DB: SQLite
Target OS: Windows client + Rocky Linux server
Architecture: Central server mode
Network: Fixed server IP
Chat Type: Direct chat only
File Limit: 200MB
File Transfer: Server relay
Email: SMTP verification code
Admin: Web admin
Encryption: Message content encryption
Full E2EE: Future version
P2P: Reserved only
Multi-device: Reserved only
UI Style: Telegram-like
Languages: zh-CN + en-US
Themes: Light + Dark
```

### 1.2 明确禁止在 MVP 中完整实现的能力

除非用户明确要求，否则不要实现以下能力，只允许预留接口、类型、数据字段或 TODO：

- 群聊
- 频道
- 语音消息
- 视频消息
- 自定义表情包
- 2GB 文件传输
- WebRTC DataChannel
- STUN / TURN / NAT 穿透
- 真正 P2P 大文件传输
- 多设备同时在线
- 陌生设备扫码登录
- 完整 Secret Chat
- 双棘轮算法
- 前向保密
- 多设备密钥同步
- 阅后即焚
- 服务端明文全文搜索
- 文档在线预览
- Docker Compose 强制一键部署
- Redis / RabbitMQ / Kafka 等中间件

原则：

> 如果一个功能不在 MVP 必须实现范围内，不要因为“以后可能需要”而提前实现。

---

## 2. 工作方式总原则

### 2.1 先理解，再修改

在写代码前必须完成：

1. 阅读相关需求文档。
2. 阅读相关现有代码。
3. 明确本次任务影响范围。
4. 列出假设。
5. 给出简短实现计划。
6. 给出可验证的完成标准。

不要跳过理解阶段直接写代码。

### 2.2 不要掩盖不确定性

如果存在以下情况，必须说明：

- 需求存在歧义。
- 有多个合理实现方案。
- 现有代码和需求文档冲突。
- 需要新增生产依赖。
- 需要改动数据库 schema。
- 需要改变 API 或 WebSocket 协议。
- 需要调整加密、认证、文件存储等安全敏感逻辑。

不要静默假设。

### 2.3 简单优先

优先选择最小可运行实现。

禁止：

- 为单次使用抽象复杂框架。
- 写未被调用的通用工具。
- 提前做插件化、微服务化、队列化。
- 为远期能力写大段不可验证代码。
- 为了“看起来高级”引入复杂架构。
- 在 MVP 中引入不必要的配置层。

判断标准：

> 如果 50 行清晰代码可以解决，不要写 200 行泛化代码。

### 2.4 外科手术式修改

修改已有代码时：

- 只改和任务直接相关的文件。
- 不重构无关模块。
- 不格式化整仓库。
- 不顺手改命名、注释、目录。
- 不删除已有死代码，除非它是本次改动产生的。
- 不改变公共 API，除非任务明确要求。

每一行 diff 都应该能解释为“为了完成本次任务”。

---

## 3. 任务执行流程

### 3.1 开始任务前

每个非平凡任务开始时，先输出简短计划：

```text
目标：
- ...

假设：
- ...

计划：
1. ...
2. ...
3. ...

验证：
- ...
```

计划不要冗长，但必须具体。

### 3.2 实现过程中

执行时遵守：

- 小步修改。
- 每完成一个模块就运行相关检查。
- 发现需求冲突时暂停并说明。
- 发现无关问题时记录，不要顺手修。
- 对安全敏感逻辑优先保守处理。
- 对数据库迁移、认证、加密、文件删除等操作必须格外谨慎。

### 3.3 完成任务后

完成后必须给出：

```text
完成内容：
- ...

改动文件：
- ...

验证结果：
- 已运行：...
- 结果：...

未完成 / 降级：
- ...

后续建议：
- ...
```

如果没有运行测试，必须明确说明原因，不能声称“应该可以”。

---

## 4. 验证优先规则

### 4.1 不允许无验证完成

除非任务只改文档，否则每次代码修改后至少运行相关检查。

推荐顺序：

```text
1. 类型检查
2. 单元测试
3. lint
4. 构建
5. 手动启动验证
```

### 4.2 服务端验证命令

在 `server/` 下优先使用：

```bash
npm run lint
npm run test
npm run build
npx prisma validate
npx prisma generate
```

如果新增或修改 Prisma schema：

```bash
npx prisma migrate dev
```

仅在开发环境中执行迁移命令。不要在生产数据库上自动迁移。

### 4.3 客户端验证命令

在 `client/` 下优先使用：

```bash
npm run lint
npm run test
npm run build
```

如果涉及 Rust / Tauri：

```bash
cargo check
cargo test
```

如项目使用 Tauri CLI：

```bash
npm run tauri build
```

如果环境缺少 Windows 打包能力，应说明限制，不要假装已验证 Windows 安装包。

### 4.4 端到端手动验证

涉及聊天核心流程时，至少说明如何验证：

1. 用户 A 登录。
2. 用户 B 登录。
3. A 和 B 成为好友。
4. A 发送消息。
5. B 实时收到。
6. B 已读。
7. A 看到已读状态。
8. A 撤回或编辑。
9. B 收到同步状态。

---

## 5. 仓库结构约束

默认 monorepo 结构：

```text
langram/
  AGENTS.md
  README.md
  docs/
    LanGram_MVP_Codex_Spec.md
  client/
  server/
```

### 5.1 客户端目录约束

```text
client/
  src/
    pages/
    components/
    stores/
    api/
    realtime/
    crypto/
    i18n/
    utils/
  src-tauri/
    src/
      commands/
      db/
      storage/
      crypto/
      tray/
```

客户端规则：

- React 负责 UI、状态、路由、用户交互。
- Rust/Tauri 负责 SQLite、本地文件、本地加密、系统托盘、开机自启、通知桥接。
- 不要让 React 直接访问任意本地路径。
- 不要在前端硬编码敏感密钥。
- Tauri command 必须保持窄接口，避免暴露任意文件系统能力。
- 前端 API 类型应和后端 DTO 保持一致。

### 5.2 服务端目录约束

```text
server/
  src/
    auth/
    users/
    devices/
    friends/
    conversations/
    messages/
    files/
    realtime/
    admin/
    logs/
    crypto/
    health/
    common/
    config/
  prisma/
    schema.prisma
    migrations/
```

服务端规则：

- 每个业务域使用独立 NestJS module。
- Controller 只处理 HTTP 输入输出。
- Service 处理业务逻辑。
- DTO 使用 class-validator 或 Zod 进行校验。
- Prisma 访问集中在 service 层，不在 controller 中直接访问数据库。
- WebSocket Gateway 不应塞满业务逻辑，应调用 service。
- 公共异常、鉴权、日志放入 `common/`。

---

## 6. 技术栈约束

### 6.1 后端

固定使用：

- NestJS
- TypeScript
- PostgreSQL
- Prisma
- JWT + Refresh Token
- SMTP 邮箱验证码
- WebSocket Gateway
- 本地文件系统存储

禁止擅自引入：

- Express 替代 NestJS
- TypeORM 替代 Prisma
- MongoDB 替代 PostgreSQL
- Redis
- Kafka
- RabbitMQ
- MinIO / S3
- GraphQL
- 微服务框架

除非用户明确要求或需求文档更新。

### 6.2 客户端

固定使用：

- Tauri v2
- React
- TypeScript
- Rust
- SQLite
- Zustand
- TanStack Query
- React Router
- Tailwind CSS
- zh-CN / en-US i18n

禁止擅自切换：

- Electron
- Vue
- Flutter
- Qt
- MobX
- Redux Toolkit，除非已有项目已经使用
- 其他 UI 框架，除非已有项目已经使用

---

## 7. 安全与隐私硬约束

### 7.1 消息内容

服务端不得保存明文消息内容。

必须遵守：

- 客户端加密消息内容后发送。
- 服务端只保存 ciphertext、nonce、encryption_version、元数据。
- 管理后台不能查看聊天明文。
- 日志不能记录明文消息。
- 测试数据也不要写真实隐私内容。

### 7.2 Token 与验证码

禁止：

- 在日志中打印 access token。
- 在日志中打印 refresh token。
- 在日志中打印邮箱验证码明文。
- 将 refresh token 明文落库。
- 将验证码明文落库。

要求：

- refresh token 存 hash。
- 验证码存 hash。
- 验证码有效期 5 分钟。
- 同一邮箱 60 秒内不可重复发送验证码。
- 登出后 refresh token 失效。

### 7.3 文件安全

文件逻辑必须遵守：

- 清洗原始文件名。
- 禁止路径穿越。
- 限制最大 200MB。
- 校验 MIME 类型和文件大小。
- 文件存储在配置的服务端目录。
- 下载接口必须鉴权。
- 只能下载自己有权限访问的文件。
- 管理员删除文件必须记录日志。

### 7.4 本地数据安全

客户端本地数据必须遵守：

- SQLite 用于本地缓存，不替代服务端数据库。
- 敏感本地缓存需要加密。
- 私钥不得上传服务端。
- 游客账号只绑定当前设备。
- 用户退出登录后不得继续使用旧 token。

---

## 8. 数据库与迁移规则

### 8.1 Prisma schema 修改规则

修改 Prisma schema 前必须说明：

- 新增了哪些表。
- 新增了哪些字段。
- 是否影响已有数据。
- 是否需要迁移。
- 是否破坏兼容性。

### 8.2 数据库命名规则

使用英文 snake_case 数据库字段名。

推荐：

```text
created_at
updated_at
deleted_at
user_id
conversation_id
message_id
```

避免：

```text
createdAt
updatedAt
用户ID
messageId
```

TypeScript 层可使用 camelCase，但 Prisma mapping 要清晰。

### 8.3 不要物理删除关键业务记录

默认使用状态标记，不直接删除：

- messages
- users
- devices
- files metadata
- sessions logs

例外：

- 客户端本地消息删除可以只影响本地 SQLite。
- 管理员删除违规文件时，可删除文件实体，但保留审计日志。

---

## 9. API 与 WebSocket 规则

### 9.1 REST API

API 必须：

- 使用 `/api` 前缀。
- 使用 DTO 校验输入。
- 使用统一错误结构。
- 使用鉴权 guard 保护私有接口。
- 避免返回敏感字段。
- 返回字段命名保持一致。

统一错误建议：

```json
{
  "code": "AUTH_INVALID_TOKEN",
  "message": "Invalid or expired token",
  "requestId": "..."
}
```

### 9.2 WebSocket

WebSocket 必须：

- 连接时校验 access token。
- 未授权连接直接拒绝。
- 服务端推送事件使用稳定事件名。
- 事件 payload 使用明确类型。
- 不通过 WebSocket 发送明文 token。
- 不把业务逻辑全部写在 Gateway 中。

核心事件名必须和需求文档保持一致：

```text
message:send
message:new
message:delivered
message:read
message:edit
message:edited
message:recall
message:recalled
friend:request
friend:request_received
friend:accept
friend:accepted
presence:update
presence:changed
session:kicked
error
```

---

## 10. 客户端 UI/UX 规则

### 10.1 Telegram 风格布局

MVP UI 必须保持：

- 左侧会话列表。
- 中间聊天窗口。
- 右侧用户信息面板。
- 顶部聊天对象信息。
- 底部消息输入框。
- 设置页。
- 好友页。
- 用户头像和在线状态。

不要把 UI 做成普通后台管理表单风格。

### 10.2 主题与语言

必须支持：

```text
theme: system | light | dark
language: system | zh-CN | en-US
```

新增文案时必须同时添加：

- `zh-CN.json`
- `en-US.json`

禁止硬编码 UI 文案到组件里，临时调试除外。

### 10.3 消息体验

消息列表应支持：

- 发送中。
- 发送失败。
- 已发送。
- 已送达。
- 已读。
- 已编辑。
- 已撤回。
- 回复预览。
- 图片缩略图。
- 文件卡片。

---

## 11. 文件传输规则

### 11.1 MVP 文件传输

MVP 使用服务器中转。

规则：

- 最大 200MB。
- 超过限制必须在客户端和服务端都拒绝。
- 图片默认压缩。
- 用户可选择发送原图。
- 文件必须先上传，完成后再创建文件消息。
- 下载文件默认保存到 `Documents/LanGram/`。
- 用户可以自定义保存路径。

### 11.2 断点续传

MVP 可以尝试断点续传。

如果实现复杂度过高，允许降级，但必须：

- 保留 upload session 数据结构。
- 保留 chunk API 设计。
- 写明 TODO。
- 不要阻塞核心聊天流程。

---

## 12. 加密实现规则

### 12.1 MVP 加密定位

MVP 只做“消息内容加密”，不是完整 Secret Chat。

要求：

- 用明确的 `encryption_version`。
- 加密和解密逻辑放在客户端 crypto 模块。
- 服务端 crypto 模块只管理元数据或后续扩展点。
- 服务端不得解密消息内容。
- 不要宣称已经实现完整端到端加密。

### 12.2 禁止虚假安全

禁止：

- 使用 Base64 冒充加密。
- 使用自制加密算法。
- 将密钥硬编码在代码中。
- 将所有用户共用同一个固定密钥。
- 在 README 中夸大安全能力。

如果只是 MVP 占位实现，必须明确标记：

```text
MVP message content encryption, not full E2EE.
```

---

## 13. 依赖管理规则

### 13.1 新增依赖前必须说明

新增生产依赖前，必须说明：

- 为什么需要它。
- 是否已有依赖能完成。
- 维护状态是否可靠。
- 是否影响包体积。
- 是否引入安全风险。

### 13.2 禁止依赖膨胀

不要为了小工具引入大依赖。

示例：

- 简单日期格式化不要引入大型日期库。
- 简单状态管理不要引入复杂框架。
- 简单表单不要引入多套表单库。
- 后端不要同时使用 class-validator 和 Zod 做同一层 DTO 校验，除非已有约定。

---

## 14. 日志规则

### 14.1 必须记录

服务端应记录：

- 登录成功。
- 登录失败。
- 登出。
- token 刷新失败。
- 文件上传失败。
- WebSocket 鉴权失败。
- 服务端错误。
- 管理员操作。

### 14.2 禁止记录

日志中禁止出现：

- access token
- refresh token
- 邮箱验证码明文
- 消息明文
- 用户私钥
- SMTP 密码
- 数据库密码

---

## 15. 测试策略

### 15.1 后端测试优先级

优先测试：

1. AuthService
2. Email verification
3. FriendsService
4. MessagesService
5. FilesService
6. RealtimeGateway

### 15.2 客户端测试优先级

优先测试：

1. messageCrypto
2. API client
3. settings store
4. file utils
5. image compression utils
6. local database wrapper

### 15.3 必须补测试的情况

以下修改必须补测试或说明无法测试原因：

- 认证逻辑。
- 验证码逻辑。
- 好友申请逻辑。
- 消息状态逻辑。
- 撤回 / 编辑时间限制。
- 文件大小限制。
- 文件路径处理。
- 加密 / 解密逻辑。
- 数据库迁移。

---

## 16. 不要做的事

Codex 不应：

- 未经要求切换技术栈。
- 未经要求引入复杂中间件。
- 未经要求实现远期路线图功能。
- 伪造测试结果。
- 声称功能完成但没有运行验证。
- 把 TODO 当成已完成。
- 只改前端不改必要的后端契约。
- 只改后端不更新必要的前端类型。
- 改数据库但不更新 Prisma client。
- 改 API 但不更新客户端调用。
- 改 WebSocket payload 但不更新两端类型。
- 在日志中打印敏感信息。
- 在管理后台展示聊天明文。
- 写大段不可执行的伪代码作为实现。
- 用 mock 假装真实功能完成，除非任务要求 mock。

---

## 17. 分阶段开发规则

开发必须按阶段推进。

### Phase 0：项目初始化

只做：

- monorepo。
- client 初始化。
- server 初始化。
- lint / format。
- README。
- 基础配置。

不要开始写完整业务。

### Phase 1：认证与账号

只做：

- SMTP 验证码。
- 注册。
- 登录。
- 游客登录。
- JWT。
- refresh token。
- 单设备登录策略。

### Phase 2：客户端基础

只做：

- Tauri + React 主界面。
- 登录/注册页。
- 本地配置。
- 设备 ID。
- SQLite 初始化。

### Phase 3：好友系统

只做：

- 配对码。
- 好友申请。
- 确认/拒绝。
- 好友列表。

### Phase 4：实时单聊

只做：

- WebSocket。
- 单聊会话。
- 文本消息。
- 密文存储。
- 离线投递。
- 已读/未读。
- 本地缓存。

### Phase 5：消息操作

只做：

- 撤回。
- 编辑。
- 删除本地。
- 清空本地会话。
- 搜索。
- 单人转发。

### Phase 6：图片与文件

只做：

- 图片压缩/原图。
- 文件上传。
- 文件下载。
- 200MB 限制。
- 下载记录。
- 自定义路径。
- 断点续传尝试或预留。

### Phase 7：体验增强

只做：

- Telegram 风格优化。
- 深色/浅色。
- 中英文。
- 系统托盘。
- 桌面通知。
- 开机自启动。

### Phase 8：管理后台

只做：

- 用户列表。
- 禁用/启用。
- 重置登录状态。
- 在线设备。
- 登录/错误日志。
- 文件删除。
- 游客账号开关。

### Phase 9：部署与打包

只做：

- Rocky Linux 部署说明。
- PostgreSQL 初始化。
- systemd。
- Windows 客户端打包说明。
- 最终验收清单。

---

## 18. 代码风格

### 18.1 TypeScript

要求：

- 开启 strict。
- 禁止 `any`，除非有注释解释。
- DTO 和 API response 要有类型。
- WebSocket payload 要有类型。
- 错误码用枚举或常量集中维护。
- 不要吞异常。

### 18.2 Rust

要求：

- Tauri command 返回明确 Result。
- 错误转换为前端可理解的错误结构。
- 文件路径处理必须安全。
- 不要 unwrap 用户输入。
- 不要 panic 处理可恢复错误。

### 18.3 React

要求：

- 组件职责清晰。
- 业务状态放 store。
- 服务端状态优先用 TanStack Query。
- 长列表预留虚拟滚动能力。
- 表单必须校验。
- UI 文案走 i18n。

---

## 19. 提交与说明规则

如果任务涉及 git commit，提交信息使用：

```text
type(scope): summary
```

示例：

```text
feat(auth): add smtp email verification
fix(messages): enforce recall time limit
chore(prisma): add message delivery schema
```

常用 type：

```text
feat
fix
docs
test
refactor
chore
build
ci
```

不要把无关改动混入同一个提交。

---

## 20. 完成定义

一个任务只有满足以下条件，才能称为完成：

1. 实现了用户要求的功能。
2. 没有超出 MVP 边界。
3. 相关类型、API、数据库、前后端契约一致。
4. 安全约束没有被破坏。
5. 相关测试或检查已运行。
6. 失败的检查已说明原因。
7. 没有伪造结果。
8. 没有留下明显无用代码。
9. 用户能根据说明复现验证。

---

## 21. 默认响应模板

完成一次开发任务后，Codex 应按以下格式回复：

```text
完成：
- ...

改动：
- ...

验证：
- [command] -> pass/fail
- ...

注意：
- ...

下一步建议：
- ...
```

如果任务无法完成：

```text
无法完整完成，原因：
- ...

已完成：
- ...

未完成：
- ...

建议：
- ...
```

---

## 22. 最重要的三条规则

1. **不要实现超出 MVP 的远期功能。**
2. **不要让服务端保存或展示消息明文。**
3. **不要在没有验证的情况下声称完成。**
