# AsepriteSync

Real-time collaboration server for Aseprite pixel art files. Teammates share projects, lock files while editing, upload versions, and see live presence — all from inside Aseprite via a Lua plugin, or from any browser.

## Architecture

```
apps/
  server/   — Fastify REST API + WebSocket server
  web/      — Next.js 14 web dashboard (App Router)
  plugin/   — Aseprite Lua extension
packages/
  db/       — Drizzle ORM schema + migrations (PostgreSQL)
  shared/   — Shared TypeScript types
```

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20+ |
| pnpm | 9+ |
| Docker + Docker Compose | any recent |
| Aseprite | 1.3+ (for the plugin) |

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/your-org/asepritesync
cd asepritesync
pnpm install

# 2. Environment
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET (≥32 chars)

# 3. Start Postgres + Redis
docker-compose up -d

# 4. Run migrations and seed
pnpm --filter @asepritesync/db migrate
pnpm --filter @asepritesync/db seed

# 5. Start all apps
pnpm dev
```

`pnpm dev` starts:
- **API server** on `http://localhost:4000`
- **Web dashboard** on `http://localhost:3000`

## Environment variables

Copy `.env.example` and fill in the values. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `JWT_SECRET` | — | **Required.** ≥32-character secret |
| `JWT_ACCESS_EXPIRY` | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRY` | `7d` | Refresh token TTL |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origin |
| `MAX_FILE_SIZE_MB` | `50` | Upload size limit |
| `MAX_VERSIONS_PER_FILE` | `50` | Version history cap |
| `STORAGE_TYPE` | `local` | `local` or `s3` |
| `STORAGE_PATH` | `./storage` | Root for local storage |
| `S3_BUCKET` | — | S3 bucket name (S3 storage only) |
| `S3_ENDPOINT` | — | Custom S3 endpoint (e.g. MinIO) |
| `LOCK_DURATION_MINUTES` | `30` | Auto-expire lock duration |
| `ASEPRITE_CLI` | — | Path to `aseprite` binary for previews |
| `PORT` | `4000` | API server port |

## Running in development

```bash
# All apps (web + server)
pnpm dev

# Individual apps
pnpm --filter @asepritesync/server dev
pnpm --filter @asepritesync/web dev
```

## Running tests

```bash
# All tests
pnpm test

# Server unit tests only
pnpm --filter @asepritesync/server test

# Web component/hook tests only
pnpm --filter @asepritesync/web test
```

## Installing the Aseprite plugin

**Build the extension file:**

```bash
pnpm --filter asepritesync-plugin bundle
# → apps/plugin/asepritesync.aseprite-extension
```

**Install in Aseprite:**

1. In Aseprite, go to **Edit → Preferences → Extensions**.
2. Click **Add Extension** and select `apps/plugin/asepritesync.aseprite-extension`.
3. Restart Aseprite if prompted.

The commands appear in **File → Scripts → AsepriteSync**:

| Command | What it does |
|---------|-------------|
| Login / Connect | Authenticate against your server |
| Open File… | Browse projects and open a file |
| Push Changes | Upload current sprite as a new version |
| Upload New File | First-time upload to a project |
| Lock / Unlock File | Toggle the file lock |
| Server Settings | Change the server URL |

## Roles

| Role | List files | Download | Upload / Push | Lock/Unlock | Delete | Manage members |
|------|:---------:|:--------:|:------------:|:-----------:|:------:|:--------------:|
| viewer | ✓ | ✓ | — | — | — | — |
| editor | ✓ | ✓ | ✓ | ✓ | — | — |
| owner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## API reference

See [`docs/openapi.yaml`](docs/openapi.yaml) for the full OpenAPI 3.1 specification.

Base URL: `http://localhost:4000`

Authentication: `Authorization: Bearer <access_token>` header, except `/auth/*` routes.

WebSocket: `ws://localhost:4000/?token=<access_token>`

## Docker Compose services

| Service | Port | Notes |
|---------|------|-------|
| `postgres` | 5432 | PostgreSQL 16 |
| `redis` | 6379 | Redis 7 |
| `mailpit` | 1025 (SMTP) / 8025 (UI) | Dev mail catcher |
