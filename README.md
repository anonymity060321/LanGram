# LanGram

LanGram is a LAN-first Telegram-style chat application. This repository is currently in MVP v0.1 Phase 0: project initialization.

## Scope

Phase 0 only contains the monorepo structure and runnable project skeletons:

- `server/`: NestJS + TypeScript skeleton
- `client/`: Tauri v2 + React + TypeScript skeleton
- `docs/`: product and development documentation

Business features such as authentication, friends, chat, files, realtime messaging, and admin tools are intentionally not implemented in this phase.

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
