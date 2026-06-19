# Enigma API

Express.js + TypeScript + MongoDB (Mongoose) REST API.

## Stack

- **Runtime:** Node.js
- **Framework:** Express 4
- **Language:** TypeScript
- **Database:** MongoDB via Mongoose
- **Tooling:** nodemon + ts-node (dev), tsc (build)

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (already created)
#    Edit .env if needed — MONGODB_URL is preconfigured.

# 3. Run in development (hot reload)
npm run dev

# 4. Build & run in production
npm run build
npm start
```

The server starts on `http://localhost:3000` by default.

## Project Structure

```
src/
├── config/
│   ├── env.ts          # Loads & validates environment variables
│   └── database.ts     # Mongoose connection lifecycle
├── controllers/
│   └── user.controller.ts
├── middleware/
│   ├── errorHandler.ts # Central error handler
│   └── notFound.ts     # 404 handler
├── models/
│   └── user.model.ts   # Sample Mongoose model
├── routes/
│   ├── index.ts        # Mounts /health + feature routers
│   └── user.routes.ts
├── utils/
│   ├── ApiError.ts     # Operational error with HTTP status
│   ├── asyncHandler.ts # Async route wrapper
│   └── logger.ts       # Minimal leveled logger
├── app.ts              # Express app (middleware + routes)
└── index.ts            # Entry point (DB connect + listen)
```

## API Endpoints

| Method | Path             | Description        |
| ------ | ---------------- | ------------------ |
| GET    | `/`              | Welcome message    |
| GET    | `/api/health`    | Health + DB status |
| GET    | `/api/users`     | List users         |
| POST   | `/api/users`     | Create a user      |
| GET    | `/api/users/:id` | Get a user by id   |
| DELETE | `/api/users/:id` | Delete a user      |

### Example

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada Lovelace","email":"ada@example.com"}'
```

## Scripts

| Script              | Description                          |
| ------------------- | ------------------------------------ |
| `npm run dev`       | Start with hot reload (nodemon)      |
| `npm run build`     | Compile TypeScript to `dist/`        |
| `npm start`         | Run compiled output                  |
| `npm run typecheck` | Type-check without emitting          |

## Environment Variables

See `.env.example`. Required:

- `MONGODB_URL` — MongoDB connection string
- `PORT` — HTTP port (default `3000`)
- `NODE_ENV` — `development` | `production`
