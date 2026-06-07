# LanGram

LanGram is a LAN-first, Telegram-style instant messaging project for small private networks. The current MVP targets a Windows desktop client and a Rocky Linux/PostgreSQL server in central-server mode.

The project is no longer in Phase 1 only. Authentication, friends, direct chat, message operations, file/image basics, notifications, tray behavior, settings, and auth-page experience work are already partially or largely implemented. The management admin phase has not started.

Security scope is intentionally conservative: LanGram MVP implements message content encryption, not full E2EE. Clients encrypt message content before sending; the server should only receive and store `ciphertext`, `nonce`, `encryptionVersion`, and metadata.

## Tech Stack

Client:

- Tauri v2
- React
- TypeScript
- Vite
- Rust
- Zustand
- TanStack Query
- React Router
- Socket.IO client
- Tauri notification plugin

Server:

- Node.js
- NestJS / TypeScript
- Prisma
- PostgreSQL
- Socket.IO via NestJS WebSocket gateway
- JWT + refresh token
- SMTP email verification
- Local filesystem file storage

This README only lists dependencies that are present in `package.json`. Do not assume Tailwind, Radix, React Hook Form, or Zod are part of the current implementation.

## Current Feature Status

Authentication and accounts:

- Password login.
- Email-code login.
- Email registration.
- Forgot password / password reset.
- Guest login with required nickname.
- Single active client strategy for an account.
- Access token and refresh token flow.
- Refresh token hash storage on the server.
- Email verification code hash storage on the server.
- Fixed 6-character text captcha.
- Auth-page duplicate-submit guards, loading states, network error messages, captcha error messages, captcha refresh countdown, and password show/hide icon button.

Friends:

- Pairing code flow.
- Friend request creation.
- Accept / reject friend requests.
- Friend list.
- Contacts page with two-column workspace layout and notification/list/detail views.

Chat:

- Direct chat conversations.
- REST history loading.
- Socket.IO realtime messaging.
- Message content encryption before send.
- Server-side ciphertext storage.
- Delivered / read state.
- Message time separators.
- Failed-message retry.
- Local failed messages remain available after reconnect.
- Copy, edit, recall, forward, and local-delete actions.
- Local conversation clear watermark.
- Chat scrolling and jump-to-bottom behavior.

Files and images:

- File message send flow.
- Image message send flow.
- Image preview window.
- Basic file download support.
- 200MB file-size boundary is part of the MVP rules.

Desktop and UI:

- Tauri desktop client.
- Telegram-like three-panel main layout.
- System tray menu and close-to-tray preference.
- Desktop notification support.
- Light / dark / system theme.
- zh-CN / en-US i18n.
- Settings page for server URL, theme, language, notification, tray, account, and profile settings.

## Known Gaps

The following are not complete yet:

- Client SQLite local cache is not fully landed.
- File download records and custom save path are not fully implemented.
- Admin web console, Phase 8, has not started.
- Rocky Linux deployment, systemd service setup, and final packaging docs, Phase 9, are not fully complete.
- Windows installer/package verification is not complete.
- Full E2EE, Secret Chat, double ratchet, forward secrecy, and multi-device key sync are not part of the current MVP.
- Group chat, channels, P2P transfer, WebRTC/STUN/TURN, and a complete multi-device online strategy are not implemented.

## Requirements

- Node.js LTS
- npm
- Rust stable toolchain
- Tauri v2 prerequisites for Windows development
- PostgreSQL for the server
- SMTP credentials for email-code flows

## Setup

Install dependencies from the repository root:

```bash
npm install
```

Copy example environment files before local development:

```bash
copy server\.env.example server\.env
copy client\.env.example client\.env
```

Do not commit real secrets.

For local Windows development with PostgreSQL running inside a Rocky Linux VM, set `DATABASE_URL` to the VM/NAT IP address, not Windows `localhost`:

```bash
DATABASE_URL=postgresql://langram_user:change_me@<VMWARE_NAT_IP>:5432/langram
```

## Development

Server:

```bash
npm.cmd run start:dev -w server
```

Client desktop app:

```bash
cd client
npm.cmd run tauri dev
```

Do not run `npm.cmd run dev` separately before Tauri. Tauri already starts Vite through its `beforeDevCommand`; starting Vite separately can cause a port conflict.

## Validation Commands

Common checks:

```bash
npm.cmd run lint
npm.cmd run build
```

Server checks:

```bash
npm.cmd run test -w server
cd server
npx.cmd prisma validate
npx.cmd prisma generate
```

Client/Tauri checks:

```bash
cd client\src-tauri
cargo check
cargo test
```

Tauri startup-level verification:

```bash
cd client
npm.cmd run tauri dev
```

For documentation-only changes, code build/test is not required unless the document update changes commands or setup behavior in a way that needs execution.

## Security Constraints

- Do not write access tokens or refresh tokens to `localStorage`.
- Do not log passwords, email codes, captchas, tokens, message plaintext, clipboard contents, SMTP passwords, or database passwords.
- Do not send plaintext message content to the server.
- The server must not store or display message plaintext.
- MVP message content encryption, not full E2EE.
- Do not reuse AES-GCM nonces.
- Do not add a Prisma migration unless the task explicitly requires a schema change.
- Admin tooling must not expose chat plaintext.

## MVP Boundaries

Current MVP remains direct chat only with central server relay for files. The project should not expand into group chat, channels, P2P, WebRTC, full multi-device, Secret Chat, or complete E2EE unless a future task explicitly changes the scope.

Server-side message records must continue to use encrypted payload fields only:

```text
ciphertext
nonce
encryptionVersion
metadata
```

## Repository Layout

```text
LanGram/
  AGENTS.md
  README.md
  docs/
    LanGram_MVP_Codex_Spec.md
  client/
    src/
    src-tauri/
  server/
    src/
    prisma/
```

## Current Phase Summary

- Phase 0: complete.
- Phase 1: complete.
- Phase 2: partially complete; desktop shell, auth pages, settings, device identity, and local config exist, but SQLite cache is not fully landed.
- Phase 3: near complete for MVP friend flows.
- Phase 4: partially complete for direct realtime chat and encrypted message transport.
- Phase 5: partially complete for edit, recall, local delete, forwarding, search, and retry flows.
- Phase 6: partially complete for files/images; download records and custom save path remain gaps.
- Phase 7: partially complete for UI polish, themes, i18n, tray, and notifications.
- Phase 8: admin web console not started.
- Phase 9: deployment and packaging docs are incomplete.
