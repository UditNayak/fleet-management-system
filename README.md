# Fleet Management System

Backend for a fleet management platform: an Express **API Gateway** in front of five microservices
(users, vehicles, telemetry, maps/geolocation, notifications), with OpenStreetMap geocoding,
mock SMS notifications, Swagger docs and a Mocha/Chai test suite.

Everything runs in **Docker** — no local Node/MongoDB install needed.

## Architecture

```
Client ──► API Gateway :3000 ─┬─► user-service         :3001
                              ├─► vehicle-service      :3002
                              ├─► telemetry-service    :3003
                              ├─► maps-service         :3004
                              └─► notification-service :3005
                                          │
                                          ▼
                                   MongoDB Atlas
```

Only the gateway is exposed to the host; the services are reachable only inside the Docker network.

## Prerequisites

- Docker Desktop (with Docker Compose v2)
- A MongoDB Atlas cluster (free M0 tier works) — see **[MongoDB Atlas Setup](docs/mongodb-atlas-setup.md)**

## Setup

```bash
cp .env.example .env    # then put your Atlas connection string in MONGO_URI (see docs/mongodb-atlas-setup.md)
docker compose up --build
```

Check it is running:

```bash
curl http://localhost:3000/health
docker compose ps        # all services should be "healthy"
```

## API Gateway

All requests go through the gateway at `http://localhost:3000`.

| Endpoint               | API key | Description                                     |
| ---------------------- | ------- | ----------------------------------------------- |
| `GET /health`          | no      | Gateway health                                  |
| `GET /health/services` | no      | Status of all 5 services (503 if any is down)   |
| `GET /api-docs`        | no      | Swagger UI (raw spec: `/api-docs/openapi.json`) |
| `/api/users/*`         | yes     | → User Service                                  |
| `/api/vehicles/*`      | yes     | → Vehicle/Fleet Service                         |
| `/api/telemetry/*`     | yes     | → Telemetry Service                             |
| `/api/maps/*`          | yes     | → Geolocation Service                           |
| `/api/notifications/*` | yes     | → Notification Service                          |

- **API key:** send `x-api-key: <key>`. Valid keys come from `API_KEYS` in `.env` (local default `fleet-dev-key-123`).
  Missing → `401 MISSING_API_KEY`, wrong → `401 INVALID_API_KEY`.
- **Rate limiting:** `RATE_LIMIT_MAX` requests per key per `RATE_LIMIT_WINDOW_MS` (default 100 / 15 min).
  Over the limit → `429 RATE_LIMITED` with a `Retry-After` header.
- **Forwarding:** the `/api/<service>` prefix is stripped (`/api/vehicles/42` → vehicle-service `/42`);
  method, query, headers (except `x-api-key`) and body are forwarded unchanged.
- **Failures:** service down → `503 SERVICE_UNAVAILABLE`; slower than `PROXY_TIMEOUT_MS` → `504 GATEWAY_TIMEOUT`.
- **Tracing:** every response carries `X-Request-Id`, which is also logged by the service that handled it.

```bash
curl http://localhost:3000/api/users/health -H "x-api-key: fleet-dev-key-123"
```

### Postman

Import `postman/fleet-management.postman_collection.json`. The collection variables `baseUrl` and `apiKey`
are pre-filled, and the API key is sent automatically on every request that needs it.
Set `adminEmail` / `adminPassword` to your admin's credentials (defaults match `.env.example`).
**Login** requests save the JWT into `adminToken` / `driverToken` / `managerToken`, which the other requests use,
so run the folders in order: **Gateway → Users → Vehicles**.

The whole collection can also be run from the command line with Newman (in a container, nothing installed locally):

```bash
docker run --rm -v "$PWD/postman":/etc/newman postman/newman:6-alpine run fleet-management.postman_collection.json \
  --env-var baseUrl=http://host.docker.internal:3000 \
  --env-var adminEmail=admin@fleet.dev --env-var adminPassword=Admin@12345
```

## Authentication & Roles

Two independent layers:

| Layer   | Header                          | Checked by   | Answers                                    |
| ------- | ------------------------------- | ------------ | ------------------------------------------ |
| API key | `x-api-key: <key>`              | gateway      | Is this an allowed client app?             |
| JWT     | `Authorization: Bearer <token>` | each service | Which user is this and what is their role? |

| Role            | How it is created                                               | Can                                 |
| --------------- | --------------------------------------------------------------- | ----------------------------------- |
| `admin`         | bootstrap admin from `.env` on first start, or by another admin | everything, incl. user management   |
| `fleet_manager` | by an admin                                                     | manage vehicles, receive SMS alerts |
| `driver`        | public `POST /api/users/register`, or by an admin               | own profile, submit telemetry       |

**Bootstrap admin:** when `user-service` starts and no admin exists, it creates one from `ADMIN_NAME`,
`ADMIN_EMAIL`, `ADMIN_PASSWORD` and `ADMIN_PHONE`. Set these in `.env` before the first start.

```bash
# Log in and call a protected endpoint
TOKEN=$(curl -s -X POST http://localhost:3000/api/users/login \
  -H "x-api-key: fleet-dev-key-123" -H "Content-Type: application/json" \
  -d '{"email":"admin@fleet.dev","password":"Admin@12345"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

curl http://localhost:3000/api/users/me -H "x-api-key: fleet-dev-key-123" -H "Authorization: Bearer $TOKEN"
```

Passwords are hashed with bcrypt; tokens are HS256 JWTs signed with `JWT_SECRET` and expire after `JWT_EXPIRES_IN` (default 1h).

## Vehicles

Vehicles are managed by `vehicle-service` (`/api/vehicles`). Every request needs the API key **and** a JWT.

| Action                                          | admin | fleet_manager | driver |
| ----------------------------------------------- | :---: | :-----------: | :----: |
| `GET /api/vehicles`, `GET /api/vehicles/:id`    |  ✅   |      ✅       |   ✅   |
| `POST /api/vehicles`, `PATCH /api/vehicles/:id` |  ✅   |      ✅       |   ❌   |
| `PATCH /api/vehicles/:id/status`                |  ✅   |      ✅       |   ❌   |
| `DELETE /api/vehicles/:id`                      |  ✅   |      ❌       |   ❌   |

- **Registration numbers** are normalised and unique: `ka-01 ab 1234` is stored as `KA01AB1234`.
- **Location** is sent and returned as `{ "lat": 12.97, "lng": 77.59 }` and stored as a GeoJSON point with a
  `2dsphere` index (used by the nearby search later).
- **Status** (`active`, `idle`, `maintenance`, `inactive`) only changes through `PATCH /:id/status`. Each change is
  appended to `statusHistory` (`from`, `to`, `reason`, `changedBy`, `changedAt`) and triggers a status-change hook
  (SMS notification).
- **List filters:** `status`, `type`, `assignedDriver`, `search` (registration prefix), `sort`, `page`, `limit`.

```bash
curl -X POST http://localhost:3000/api/vehicles \
  -H "x-api-key: fleet-dev-key-123" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"registrationNumber":"KA 01 AB 1234","model":"Tata Ace Gold","type":"truck","location":{"lat":12.9756,"lng":77.605}}'
```

## Tests

Tests run in Docker against a throw-away MongoDB container (never against Atlas):

```bash
docker compose --profile test run --rm test
docker compose --profile test down          # stop the test database afterwards
```

| File                       | Flow                                    |
| -------------------------- | --------------------------------------- |
| `test/01-auth.test.js`     | 1. User login & JWT verification        |
| `test/02-vehicles.test.js` | 2. Vehicle registration & retrieval     |
| `test/05-rbac.test.js`     | 5. Role-based access control            |
| `test/07-gateway.test.js`  | 7. API key verification & rate limiting |

## Lint

```bash
docker compose --profile tools run --rm lint
```

## Clean Up

Removes all containers, volumes and images created by this project:

```bash
docker compose --profile test --profile tools down -v --rmi all
```

> If you add new npm dependencies, rebuild with `docker compose up --build -V`
> (`-V` recreates the `node_modules` volume).

## Project Structure

```
services/   gateway + one folder per microservice (app.js builds the app, index.js starts it)
shared/     config, logger, DB connection, app factory, error handling
test/       Mocha/Chai test suite
docs/       OpenAPI (Swagger) specification, MongoDB Atlas setup guide
postman/    Postman collection
```
