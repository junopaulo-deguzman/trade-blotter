# Container deployment on EC2

This is a single-host, single-API deployment. Docker builds both applications;
no Node installation on EC2 is required. Use Docker Engine with Compose 2.24.4+
and a host with enough memory for frontend compilation and password hashing
(4 GiB is a practical starting point). Image builds follow the host architecture,
including ARM EC2 instances.

## Configure

Clone the repository onto the host and run commands from its root:

```sh
cp deploy/ec2.env.example .env.ec2
chmod 600 .env.ec2
```

Edit `.env.ec2` before starting:

- Set a strong, unique `POSTGRES_PASSWORD`.
- Optionally set `SEED_RECORDER_PASSWORD` to 12–1,024 characters. Login username
  is `seed-recorder`. Startup enables absent/disabled accounts; it does not reset
  an already enabled password.
- Set `WS_ALLOWED_ORIGINS` to the exact public browser origin, e.g.
  `https://trading.example.com`, without a trailing slash. Multiple origins can
  be comma-separated.
- Set the published `WEB_PORT` and bind address as appropriate for your TLS proxy.
  For an HTTP-only demo, the origin must instead match the actual HTTP address.
  Use HTTPS for deployment with real credentials.

Single-quote environment values containing `$` or `#` to avoid Compose
interpolation or comment parsing. Database credentials are URL-encoded by the
container entrypoint. `.env.ec2` is ignored by Git and excluded from image builds;
secrets remain runtime environment values visible to administrators with Docker
access. Do not put passwords in build arguments or frontend configuration.

Compose reads `.env.ec2` only when explicitly passed below. It does not read
`backend/.env`. Changing PostgreSQL's environment password does not change the
password inside an existing database volume; rotate that database role separately.

## Build and start

```sh
docker compose --env-file .env.ec2 -f docker-compose.yml -f docker-compose.ec2.yml config --quiet
docker compose --env-file .env.ec2 -f docker-compose.yml -f docker-compose.ec2.yml up -d --build
docker compose --env-file .env.ec2 -f docker-compose.yml -f docker-compose.ec2.yml ps -a
```

PostgreSQL must become healthy, the migration container must exit successfully,
and the API must become healthy before Nginx starts. The migration image includes
migration dependencies; the API image installs production dependencies and runs
as the unprivileged Node user. Both images contain the versioned database source.
The frontend is compiled in a separate build stage and served by Nginx.
See Docker's [startup-order documentation](https://docs.docker.com/compose/how-tos/startup-order/)
for the dependency conditions used here.

Startup seeds 1,000 trades only when the database is empty. Subsequent starts
preserve trades, recorder metadata, and enabled passwords. A migration or seed
failure prevents a usable API from starting; investigate rather than deleting
production data.

## Networking and HTTPS

The EC2 override publishes only Nginx. PostgreSQL and the API have no host ports.
Allow the web port only from your intended clients or TLS proxy in the EC2 security
group; restrict SSH to your administration address. Do not expose ports 3000/5432.

The supplied Nginx configuration listens on HTTP; it does not obtain certificates.
Terminate HTTPS at a configured TLS proxy or AWS load balancer before using real
credentials. Set that proxy's idle timeout to at least 75 seconds, forward
WebSocket upgrades, and set the exact HTTPS browser origin above. Redact the
`/api/ws` query string from upstream access logs, since it contains a connection
ticket. Nginx itself suppresses access logging for that endpoint.

The supplied API trusts one proxy hop: its Nginx container. Nginx overwrites the
forwarded protocol and appends the connecting address. With an additional load
balancer, rate limiting sees that balancer's address rather than the original
client. Configure trusted upstream address handling deliberately if deploying
that topology; do not blindly increase Express's proxy-hop count.

## Verify

```sh
curl --fail http://127.0.0.1/healthz
curl --fail http://127.0.0.1/api/health
```

Adjust the port if `WEB_PORT` differs from 80. Check that `ps -a` shows an exited
migration service with exit code 0 and healthy API/frontend services. Open the
public URL and log in. In two browser tabs, amend a trade and check the editing
dot, update warning, cancellation behavior, and reconnect recovery. WebSocket
connections should upgrade successfully on `/api/ws`; a public-origin mismatch
rejects the connection even when HTTP login succeeds.

To inspect startup failures:

```sh
docker compose --env-file .env.ec2 -f docker-compose.yml -f docker-compose.ec2.yml logs --tail 100 migrate api frontend
```

## Updates and administration

After pulling the intended revision, rebuild and recreate the stack so migrations
run for that revision. This causes brief downtime and reconnects clients:

```sh
docker compose --env-file .env.ec2 -f docker-compose.yml -f docker-compose.ec2.yml up -d --build --force-recreate
```

The books/opening-holdings migration deliberately truncates demo trades once,
retains accounts, and relies on startup to reseed. It is a demo reset, not a
production data-preserving upgrade. There is no automatic migration rollback. Back up before schema updates; an older
image may not be compatible with a newer schema. To reset an account password,
use the interactive CLI (the command revokes its existing sessions):

```sh
docker compose --env-file .env.ec2 -f docker-compose.yml -f docker-compose.ec2.yml exec api sh /usr/local/bin/backend-entrypoint node scripts/create-user.ts --username seed-recorder --reset-password
```

## Data and backups

PostgreSQL stores data in the persistent `postgres_data` named volume. `down`
retains it; **`down -v` deletes it**. Keep encrypted backups outside the EC2 host.
For example, create a custom-format dump without putting passwords on the CLI:

```sh
docker compose --env-file .env.ec2 -f docker-compose.yml -f docker-compose.ec2.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > trading.backup
```

Test restoration into a separate database before relying on a backup. Container
health checks verify availability, not backup integrity or high availability.
