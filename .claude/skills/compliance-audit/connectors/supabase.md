# Supabase connector

Needs a Supabase **access token** (Management API, org/project-scoped personal access
token — never the project's `service_role` key for this) and the target project ref(s).
Read them from env vars named in the project's `compliance/scope.yaml`
(`SUPABASE_MANAGEMENT_TOKEN`, `SUPABASE_PROJECT_REF`) — never ask the user to paste a
token into chat; confirm the env var is set and use it from there.

If the token isn't available, report every check below as
`status: blocked, reason: "no SUPABASE_MANAGEMENT_TOKEN set"` — don't skip them
silently, so the report shows an accurate "couldn't check" count rather than looking
like a clean pass.

## How to query

- Management API: `https://api.supabase.com/v1/projects/{ref}/...` (auth: `Bearer <token>`) — project config, network restrictions, auth settings.
- Direct Postgres inspection (needs a direct connection string, not just the Management API) for RLS/role checks:
  ```sql
  select tablename, rowsecurity from pg_tables where schemaname = 'public';
  select * from pg_policies where schemaname = 'public';
  select rolname, rolsuper, rolcreaterole, rolcreatedb from pg_roles;
  ```

## supabase.rls_policies
- For every table in `public` reachable by a client-side key (anon or authenticated role — check the project's frontend for which key it ships), confirm `rowsecurity = true` AND at least one real policy exists (not just RLS-enabled-with-zero-policies, which is a silent fail-closed that often gets "fixed" by someone adding an overly-broad policy later — check the policy's `USING`/`WITH CHECK` clause makes sense, not just that one exists).
- If ALL data access actually goes through a backend using the `service_role` key (RLS bypassed by design, same pattern as this project's own Orcanos QMS backend) — that's a valid architecture, but say so explicitly and confirm no anon-key path exists to the same tables. Don't mark RLS "failed" for an architecture that deliberately doesn't rely on it, but DO flag it if the frontend also holds an anon key that could reach the same tables directly.

## supabase.auth_config
- `GET /v1/projects/{ref}/config/auth` — MFA availability, password min length, session/JWT expiry, enabled providers, signup allowed/disabled, email confirmation required.

## supabase.api_key_management
- Confirm which key (anon vs service_role) ships to the browser bundle (grep frontend build/env for `SUPABASE_SERVICE`/service-role-looking JWTs — a service key in a client bundle is an automatic Critical finding).
- Confirm keys can actually be rotated (Supabase supports JWT secret rotation) and whether that's ever been exercised.

## supabase.network_restrictions
- `GET /v1/projects/{ref}/network-restrictions` — is the DB restricted, or open to `0.0.0.0/0`?
- Confirm SSL is enforced on the Postgres connection (not `sslmode=disable`).

## supabase.backup_pitr
- `GET /v1/projects/{ref}/database/backups` — backup schedule, PITR enabled/window, last successful backup timestamp.

## supabase.audit_logging
- Postgres logs / Supabase's auth audit log — retention period, whether anyone reviews them, whether they're exported anywhere durable or just held in Supabase's own short retention window.

## supabase.role_privilege_review
- `pg_roles` — does anything other than `postgres`/`service_role`/`authenticator` have superuser or createrole? Any custom role with more privilege than its actual usage needs?

## Result schema
See `../SKILL.md` § Result schema.
