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
**Login** requests save the JWT into `adminToken` / `driverToken` / `managerToken`, which the other requests use.

**Auto-setup:** a collection-level script runs before every request. If a token is missing or expired, or the demo
data doesn't exist yet, it logs in and creates (once) a demo fleet manager, a demo driver, a fleet manager with an
unreachable phone (to show failed SMS) and two demo vehicles (`KA01DM2026`, assigned to the demo driver, and
`KA01DM2027`). So any request, or any folder, can be run on its own; the numbered requests in
**Notifications**, **Telemetry** and **Maps** are a ready-made demo (Maps uses the seeded vehicles, see below).

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

## SMS Notifications

`notification-service` sends an SMS when a vehicle's status changes (and, later, when a vehicle reports a critical event)
and keeps a record of every SMS with its delivery status.

```
PATCH /api/vehicles/:id/status ─► vehicle-service ─► POST notification-service /internal/events
                                                     (x-internal-token, Docker network only)
                                                       ├─ recipients: active admins + fleet managers + assigned driver
                                                       ├─ SMS provider (mock) per recipient
                                                       └─ Notification record: sent | failed
```

- **Mock SMS provider:** nothing is really sent; each SMS is written to the log
  (`docker compose logs notification-service` → `📱 SMS → +91...`). Numbers ending in **`0000`** fail on purpose.
- The status-change response includes `notifications: { "sent": 2, "failed": 1 }`. If notification-service is down,
  the status still changes and `notifications` is `null`.
- **SMS log** (admin, fleet manager): `GET /api/notifications?status=failed&type=status_change&vehicleId=...`,
  `GET /api/notifications/:id`, `GET /api/notifications/stats`.
- `/internal/*` endpoints are for service-to-service calls only: they need `INTERNAL_SERVICE_TOKEN`, and the gateway
  always answers them with 404.

## Telemetry

`telemetry-service` stores GPS / sensor readings and keeps each vehicle's current position up to date.

```
POST /api/telemetry { vehicleId, location: {lat,lng}, speed, heading, batteryLevel, fuelLevel, engineTemp, event, recordedAt? }
  ├─ drivers: only for their assigned vehicle (403 NOT_ASSIGNED_DRIVER otherwise)
  ├─ reading stored (history)
  ├─ vehicle.location + lastSeenAt updated, unless the reading is older than lastSeenAt
  └─ event = engine_fault | low_battery | emergency_stop
       → SMS alert to admins + fleet managers (notification-service),
         at most once per vehicle + event per ALERT_COOLDOWN_MS (default 5 min)
```

- `GET /api/telemetry/vehicle/:vehicleId?from=&to=&event=`: history of one vehicle, newest first.
- `GET /api/telemetry/events`: critical events across the fleet (admin, fleet manager).
- The reading is stored even if the SMS can't be sent; the alert is retried with the next critical reading.

## Maps & Geolocation

`maps-service` uses **OpenStreetMap Nominatim** (free, no API key) to turn addresses into coordinates and back,
and MongoDB `$geoNear` (2dsphere index) to find vehicles near a place. Every role may use it.

| Endpoint                                              | Result                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| `GET /api/maps/geocode?address=MG Road, Bengaluru`    | `{ lat, lng, displayName }`                                |
| `GET /api/maps/reverse?lat=12.9756&lng=77.6066`       | street address                                             |
| `GET /api/maps/nearby?lat=&lng=&radiusKm=5`           | vehicles within 5 km, nearest first, with `distanceKm`     |
| `GET /api/maps/nearby?address=Koramangala&radiusKm=4` | same, around an address (geocoded first)                   |
| `GET /api/maps/vehicles`                              | positions of all vehicles that have a location (for a map) |

- **Nominatim usage policy:** requests identify the app (`NOMINATIM_USER_AGENT`), are spaced at least 1 second
  apart, and answers are cached for 24 h. A timeout or network error is retried once; Nominatim down → `503
GEOCODER_UNAVAILABLE`, unknown address → `404 ADDRESS_NOT_FOUND`.
- **Vehicle addresses are geocoded:** register (or update) a vehicle with an `address` and no `location`, and
  vehicle-service asks maps-service for the coordinates (`locationSource: geocoded`). If that fails the vehicle is
  still saved and the response says why (`geocoding.status: not_found | unavailable`).
- `locationSource` shows where a vehicle's position came from: `manual`, `geocoded` or `telemetry` (GPS).

**Demo data:** add 9 vehicles at real Bangalore places (0–16 km from MG Road). Safe to re-run: it resets them and
never touches other data.

```bash
docker compose --profile tools run --rm seed
```

## Dashboard

Open **http://localhost:3000/** for the web dashboard (served by the gateway: plain HTML + JavaScript, Leaflet with
OpenStreetMap tiles, no build step).

| Tab         | What it shows                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------- |
| **Map**     | every vehicle as a pin coloured by status; click the map or type an address → vehicles within X km |
| **SMS Log** | SMS stats and every SMS with its `sent` / `failed` status (admin, fleet manager)                   |
| **Alerts**  | critical telemetry events, click to jump to the map (admin, fleet manager)                         |

Admins and fleet managers can change a vehicle's status from its map popup; the SMS result is shown right away.
The page is public, but every API call it makes uses the API key and the JWT from the login, like any other client.
It refreshes every 15 s while visible; for long demos raise `RATE_LIMIT_MAX` in `.env` (e.g. 1000).

> In this demo the API key is typed into the browser. A real deployment would keep keys on a server
> (e.g. a backend-for-frontend) and give browsers only user tokens.

**Demo data and live movement:**

```bash
docker compose --profile tools run --rm seed       # demo users + Bangalore vehicles (safe to re-run)
docker compose --profile tools run --rm simulate   # 3 vehicles drive around; one sends a low-battery alert (Ctrl+C stops)
```

Demo logins (created by the seed): `demo.manager@fleet.dev` / `Manager@123` (fleet manager),
`demo.driver@fleet.dev` / `Driver@123` (driver). The simulator posts readings to telemetry-service directly on the
Docker network, like tracking devices would, so it doesn't use up the gateway rate limit.

## Tests

Tests run in Docker against a throw-away MongoDB container (never against Atlas) and never call the real
Nominatim (the geocoder is stubbed with Sinon):

```bash
docker compose --profile test run --rm test
docker compose --profile test down          # stop the test database afterwards
```

| File                                  | Flow                                       |
| ------------------------------------- | ------------------------------------------ |
| `test/01-auth.test.js`                | 1. User login & JWT verification           |
| `test/02-vehicles.test.js`            | 2. Vehicle registration & retrieval        |
| `test/03-telemetry.test.js`           | 3. Location update & telemetry storage     |
| `test/04-status-notification.test.js` | 4. Status update & notification triggering |
| `test/05-rbac.test.js`                | 5. Role-based access control               |
| `test/06-nearby-geocoding.test.js`    | 6. Nearby vehicle search & geocoding       |
| `test/07-gateway.test.js`             | 7. API key verification & rate limiting    |
| `test/08-dashboard.test.js`           | Dashboard files, CSP, simulator helpers    |

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
shared/     config, logger, DB connection, app factory, error handling, models, service clients
public/     dashboard (index.html, css/, js/ — browser ES modules)
scripts/    seed (demo users + Bangalore vehicles) and telemetry simulator
test/       Mocha/Chai test suite
docs/       OpenAPI (Swagger) specification, MongoDB Atlas setup guide
postman/    Postman collection
```
