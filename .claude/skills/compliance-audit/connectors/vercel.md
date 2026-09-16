# Vercel connector — blocked until a token is provided

Needs a Vercel API token in an env var named in the project's `compliance/scope.yaml`
(e.g. `VERCEL_API_TOKEN`) plus the team/project id. Until it's set, every check below
reports `status: blocked, reason: "no VERCEL_API_TOKEN set"`.

## How to query
Vercel REST API (`https://api.vercel.com/...`, `Authorization: Bearer <token>`).

## vercel.env_var_scoping
- `GET /v9/projects/{id}/env` — for each var, is it scoped to Production/Preview/Development correctly? Anything server-only (API keys, secrets) accidentally exposed to the client (`NEXT_PUBLIC_`/`VITE_`-prefixed by mistake)?

## vercel.deployment_protection
- Preview deployments: password/SSO/Vercel Authentication gate enabled, or publicly reachable by URL guess?
- Team settings: 2FA enforced org-wide?

## vercel.domain_tls
- Custom domains: HTTPS enforced, no plaintext HTTP fallback, HSTS present.

## Result schema
See `../SKILL.md` § Result schema.
