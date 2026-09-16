# Fly.io connector — blocked until a token is provided

Needs a Fly.io API token in an env var named in the project's `compliance/scope.yaml`
(e.g. `FLY_API_TOKEN`). Until it's set, every check below reports
`status: blocked, reason: "no FLY_API_TOKEN set"`.

## How to query
`flyctl` CLI (if installed and authenticated) or the Fly GraphQL API
(`https://api.fly.io/graphql`, `Authorization: Bearer <token>`).

## fly.secrets_management
- `fly secrets list -a <app>` — confirms secrets are set via Fly's secret store, not baked into `fly.toml`/Dockerfile `ENV`/`ARG`.
- Grep `fly.toml` and `Dockerfile` in the repo for anything that looks like a real credential.

## fly.network_firewall
- Internal-only services actually marked internal (not exposing a port publicly that should be private).
- TLS termination configured on public-facing services (no plaintext HTTP for anything carrying auth tokens or customer data).

## fly.machine_image_currency
- `fly image show -a <app>` / `fly status` — base image age, machine count/region spread reasonable for the stated capacity needs.

## Result schema
See `../SKILL.md` § Result schema.
