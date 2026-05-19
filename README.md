# LanGram

LanGram is a LAN-first Telegram-style chat application. This repository is currently in MVP v0.1 Phase 1: authentication and account basics.

## Scope

The repository contains the monorepo structure and runnable project skeletons:

- `server/`: NestJS + TypeScript skeleton
- `client/`: Tauri v2 + React + TypeScript skeleton
- `docs/`: product and development documentation

Phase 1 implements server-side authentication and account basics only:

- PostgreSQL schema through Prisma
- email verification code sending through SMTP
- email registration
- email login by password or verification code
- guest login
- access token and refresh token
- logout
- current user endpoint
- single active session per account

Friends, chat, files, realtime messaging, P2P, multi-device online behavior, full end-to-end encryption, and admin tools are intentionally not implemented in this phase.

## Requirements

- Node.js LTS
- npm
- Rust stable toolchain
- Tauri v2 prerequisites for Windows development

## Setup

```bash
npm install
npm run lint
npm run build
```

Run package-specific checks:

```bash
npm run lint -w server
npm run build -w server
npm run lint -w client
npm run build -w client
cd client/src-tauri
cargo check
```

## Environment

Copy example files before local development:

```bash
copy server\.env.example server\.env
copy client\.env.example client\.env
```

Do not commit real secrets.

## Server Phase 1

Configure `server/.env` before starting the API. Required values include:

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`

For local Windows development, PostgreSQL runs inside the Rocky Linux virtual machine. Set `DATABASE_URL` to the VMware NAT IP address, for example:

```bash
DATABASE_URL=postgresql://langram_user:change_me@<VMWARE_NAT_IP>:5432/langram
```

Do not use `localhost` for the virtual machine PostgreSQL from Windows; `localhost` would point to Windows itself, not the Rocky Linux VM. Keep the real `server/.env` local and never commit it.

Validate and generate Prisma Client:

```bash
cd server
npx prisma validate
npx prisma generate
```

Run the server:

```bash
npm run start:dev -w server
```

## Client Development

Start the Tauri desktop client from `client/` with one command:

```bash
npm.cmd run tauri dev
```

Do not run `npm.cmd run dev` first. Tauri already starts Vite through `beforeDevCommand`.

If port `1420` is already in use, close the leftover `node.exe` process or the process holding that port, then run `npm.cmd run tauri dev` again.

Phase 1 endpoints are under `/api/auth`:

- `POST /api/auth/email/code`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/guest`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Security notes:

- Verification codes are stored as hashes only.
- Refresh tokens are stored as hashes only.
- Access tokens, refresh tokens, verification codes, SMTP passwords, and database passwords must not be logged.
- The server does not store or process message plaintext in Phase 1.
