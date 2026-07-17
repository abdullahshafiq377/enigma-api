# Enigma University — API

Express 5 + TypeScript + MongoDB (Mongoose) REST API for the Enigma University learning platform.
Built to the conventions in `../MERN Development Guide`. See `../DOCS/Development Plan — Enigma University.md`.

## Stack

- **Runtime:** Node.js 22 (LTS)
- **Framework:** Express 5
- **Language:** TypeScript (strict, ESM)
- **Database:** MongoDB via Mongoose 8
- **Validation:** Zod · **Logging:** pino · **Auth (later):** Clerk
- **Tooling:** tsx (dev), tsup (build), Vitest + supertest + mongodb-memory-server (test), ESLint + Prettier, husky + lint-staged

## Getting Started

```bash
npm install
cp .env.example .env     # then set MONGODB_URL to your Atlas connection string
npm run dev              # hot-reload dev server (tsx watch)
```

Production:

```bash
npm run build            # tsup → dist/server.js
npm start                # node dist/server.js
```

Server listens on `http://localhost:3000` by default.

## Project Structure (feature-first layered architecture)

```
src/
├── app.ts                  # Express app (middleware + routes), no listen — testable
├── server.ts               # Entry point: DB connect + listen + graceful shutdown
├── config/
│   ├── env.ts              # Zod-validated, typed, frozen env (fail-fast)
│   ├── db.ts               # Mongoose connection lifecycle
│   └── logger.ts           # pino structured logger
├── middlewares/
│   ├── errorHandler.ts     # Central error handler ({ data, meta, error } envelope)
│   ├── notFound.ts         # 404 → ApiError
│   ├── validate.ts         # Zod body/query/params validation
│   ├── mongoSanitize.ts    # In-place NoSQL-injection guard (Express-5 safe)
│   └── rateLimit.ts        # express-rate-limit
├── modules/                # feature-first modules (routes→controller→service→repository→model)
│   └── user/               #   reference module: the Clerk-mirror user
│       ├── user.routes.ts
│       ├── user.controller.ts
│       ├── user.service.ts
│       ├── user.repository.ts
│       ├── user.model.ts
│       ├── user.validators.ts   # Zod schemas
│       └── user.types.ts
├── routes/index.ts         # /v1 router aggregator
├── types/express/          # Express Request augmentation (req.user, req.validated)
└── utils/                  # ApiError, asyncHandler, apiResponse (envelope helper)
```

### Layer boundaries

`routes` wire HTTP → controller · `controllers` extract request context, call services · `services` hold business logic (no HTTP, no raw queries) · `repositories` own all DB access. Add new features as sibling folders under `modules/` and mount them in `routes/index.ts`.

## API

| Method | Path             | Description                                   |
| ------ | ---------------- | --------------------------------------------- |
| GET    | `/health`        | Health + DB status (for load balancers)       |
| GET    | `/v1/users`      | List users (search, tier/role filter, cursor) |
| GET    | `/v1/users/:id`  | Get a user by id                              |

All responses use the envelope `{ data, meta?, error }`.

## Scripts

| Script                 | Description                                   |
| ---------------------- | --------------------------------------------- |
| `npm run dev`          | Hot-reload dev server (tsx watch)             |
| `npm run build`        | Bundle to `dist/` (tsup)                      |
| `npm start`            | Run compiled output                           |
| `npm run typecheck`    | `tsc --noEmit`                                |
| `npm run lint` / `:fix`| ESLint (flat config)                          |
| `npm run format`       | Prettier                                      |
| `npm test` / `:watch`  | Vitest (in-memory MongoDB)                    |
| `npm run test:coverage`| Vitest + v8 coverage                          |

## Environment

See `.env.example`. `MONGODB_URL` (Atlas connection string) is required; Clerk and AWS vars are optional until those features are wired.

## Clerk webhook (user sync)

New sign-ups are silently placed on the free **insight** tier (set in Clerk `publicMetadata` by the `user.created` handler). Clerk → MongoDB mirror sync runs via the Svix-verified endpoint:

```
POST /v1/webhooks/clerk   # events: user.created, user.updated, user.deleted
```

### Testing it locally (tunnel)

Clerk must reach your local server over HTTPS, so expose port 4000 with a tunnel:

```bash
# Option A — ngrok
ngrok http 4000
# Option B — cloudflared
cloudflared tunnel --url http://localhost:4000
```

Then in the Clerk Dashboard → **Webhooks → Add Endpoint**:

1. URL: `https://<your-tunnel-host>/v1/webhooks/clerk`
2. Subscribe to: `user.created`, `user.updated`, `user.deleted`
3. Copy the **Signing Secret** (`whsec_…`) into `CLERK_WEBHOOK_SIGNING_SECRET` in `.env`
4. Also add the session-token claims (Clerk → Sessions → Customize session token):
   `{ "tier": "{{user.public_metadata.tier}}", "role": "{{user.public_metadata.role}}" }`

Use the Clerk Dashboard's **"Send test event"** (or create a user) to verify a document appears in the `users` collection.
