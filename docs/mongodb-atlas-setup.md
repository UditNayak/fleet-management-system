# MongoDB Atlas Setup

This project stores its data in **MongoDB Atlas**, MongoDB's cloud service. The free **M0** tier is
enough and needs no credit card. Nothing has to be installed on your machine.

> Tests do **not** use Atlas. They run against a temporary MongoDB container started by Docker Compose.

## 1. Create an Account

1. Go to <https://www.mongodb.com/cloud/atlas/register>.
2. Sign up with Google, GitHub or email (verify the email if asked).
3. If a welcome questionnaire appears, any answers are fine.

## 2. Create a Free Cluster

1. In your project, open **Clusters** and click **Create** / **Build a Cluster**.
2. Choose **M0 (Free)**. Do not pick Flex or Dedicated, which are paid.
3. **Provider:** any (e.g. AWS). **Region:** the closest one marked **FREE**.
4. **Name:** e.g. `fleet-cluster`.
5. Leave **Preload sample dataset** unchecked.
6. Click **Create Deployment** and wait 1–3 minutes until the cluster is **Active**.

## 3. Create a Database User

Atlas often shows this step in a popup right after creating the cluster. Otherwise go to
**Security → Database Access → Add New Database User**.

1. Authentication method: **Password**.
2. Enter a username, or keep the suggested one.
3. Click **Autogenerate Secure Password** and save the password somewhere safe.
   Avoid the characters `@ : / ? #` if you type your own, because they break the connection string.
4. Role: **Read and write to any database**.
5. Click **Create User**.

## 4. Allow Network Access

Atlas blocks every IP address by default. Go to **Security → Network Access → Add IP Address** and choose one:

| Option                                       | When to use                                                         |
| -------------------------------------------- | ------------------------------------------------------------------- |
| **Add Current IP Address**                   | More secure. Must be updated whenever your network/IP changes.      |
| **Allow Access from Anywhere** (`0.0.0.0/0`) | Easiest for development. Access is still protected by the password. |

Click **Confirm** and wait until the entry shows **Active** (about 1 minute).

> **Symptom if you skip this:** services log
> `Startup failed: Could not connect to any servers in your MongoDB Atlas cluster ... IP that isn't whitelisted`
> and `docker compose ps` shows them restarting or unhealthy.

## 5. Get the Connection String

1. Open **Clusters → Connect** on your cluster.
2. Choose **Drivers**, then **Node.js**.
3. Copy the string. It looks like this:

   ```
   mongodb+srv://<username>:<db_password>@<cluster-host>/?retryWrites=true&w=majority&appName=<cluster-name>
   ```

4. Replace `<db_password>` with your password and add the database name **`fleet_db`** after the host:

   ```
   mongodb+srv://myuser:mypassword@fleet-cluster.abc123.mongodb.net/fleet_db?retryWrites=true&w=majority
   ```

   You don't have to create `fleet_db` yourself. MongoDB creates it when the app first writes data.

## 6. Configure the Project

```bash
cp .env.example .env
```

Open `.env` and set `MONGO_URI` to the connection string from step 5. `.env` is git-ignored, so never commit it.

## 7. Verify

```bash
docker compose up --build -d
docker compose ps                                   # all services should become "healthy"
docker compose logs user-service | grep MongoDB     # → "MongoDB connected (.../fleet_db)"
```

## 8. Browse the Data

In Atlas, open **Clusters → Browse Collections** (Data Explorer) to view and filter documents in `fleet_db`.
The database appears after the first record is written.

## Troubleshooting

| Problem                                        | Fix                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `IP that isn't whitelisted`                    | Add your IP (or `0.0.0.0/0`) in Network Access, wait until Active.                    |
| `bad auth : authentication failed`             | Wrong username/password in `MONGO_URI`; reset the password in Database Access.        |
| `Invalid environment configuration: MONGO_URI` | The value must start with `mongodb://` or `mongodb+srv://`.                           |
| Password contains `@`, `:`, `/`, `?`, `#`      | URL-encode it (e.g. `@` → `%40`) or generate a new password without those characters. |
| Services keep restarting after fixing Atlas    | They retry automatically; or run `docker compose restart`.                            |
