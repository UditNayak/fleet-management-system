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

## Tests

Tests run in Docker against a throw-away MongoDB container (never against Atlas):

```bash
docker compose --profile test run --rm test
docker compose --profile test down          # stop the test database afterwards
```

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
docs/       OpenAPI (Swagger) specification
```
