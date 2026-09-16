# Code connector

Runs entirely against the local repo — no external credentials needed. This is the
connector that should always be able to run, in every project.

For each check below, inspect the actual code (Read/Grep/Bash — `pip-audit`/`npm audit`
if installed, otherwise manual version inspection) and return one result per check_id
in the shared result schema (see `../SKILL.md` § Result schema). Don't guess — if you
can't find the relevant file/pattern, report `status: fail` with the gap named, not
`not_applicable`; only use `not_applicable` when the project genuinely has no such
surface (e.g. no file-upload feature at all → `pentest.input_validation` is N/A there,
not here).

Reuse the existing `code-review` and `security-review` skills' methodology where it
overlaps — this connector is the ISO-control-mapped subset of that same review, not a
different review style.

## code.secret_scanning
- `git ls-files` for `.env*`, `*.pem`, `*.key`, `credentials.json`, `service-account*.json` — anything that looks like it holds a real secret.
- Check `.gitignore` actually covers those patterns.
- Grep tracked files for common key shapes (`sk-`, `AKIA`, `-----BEGIN PRIVATE KEY-----`, `eyJ` JWT-looking strings assigned to a constant) — flag, don't print the matched secret value itself into the report.
- If a real-looking secret is found tracked in git, note explicitly whether it's also in git *history* (a `git log -p -- <path>` check) — history exposure needs rotation, not just untracking.

## code.dependency_vuln_scan
- Find manifest files (`requirements.txt`, `package.json`, `Pipfile`, `go.mod`, etc.).
- Run `pip-audit` / `npm audit --production` if the tool is available in the environment; otherwise note known-EOL major versions by inspection.
- Check whether versions are pinned/lockfiled (`==`/lockfile) vs floating (`>=`, `^`) — floating with no lockfile is a finding even absent a specific CVE.

## code.static_authz_review
- For every endpoint that takes an id/tenant/account parameter, confirm it checks the caller actually owns/belongs to that resource before acting — not just "is authenticated".
- Multi-tenant apps: confirm tenant-scoping headers/params are mandatory, not optional-with-silent-fallback.
- This is the same lens as an IDOR pentest check (`pentest.idor_review`) — one pass can satisfy both; don't duplicate the work, just report under both check_ids.

## code.authentication_review
- Password hashing: is it bcrypt/argon2/scrypt with a real cost factor, or something reversible/fast (MD5/SHA1/plain)?
- Session/token: JWT vs framework session; where's the signing secret sourced from (env var, hardcoded fallback — a hardcoded fallback is an automatic fail); expiry set?
- MFA: does any enrollment/verification flow exist, for any role?
- Rate limiting/lockout on login and password-reset endpoints — present or absent.

## code.crypto_review
- Are stored secrets/passwords encrypted with a real algorithm (AES-GCM, etc.), not base64 or a custom XOR?
- Is the encryption key itself sourced from env/secret-manager, never hardcoded?
- Any documented key-rotation path, or is rotation genuinely impossible without a data-loss event?

## code.audit_logging_review
- Do failed logins get recorded anywhere queryable (a table, not just stdout)?
- Do admin actions (create/delete account or user, permission grants, credential/key changes) get recorded?
- Is there any way to query that record back (an endpoint, a dashboard) or does it only exist as an unqueried table?

## code.secure_sdlc_review
- Does the repo have branch protection / required PR review (check hosting platform settings if reachable, otherwise infer from CI config + commit history patterns)?
- Does CI run tests and a build on every change (inspect the CI config file)?
- Is there any security-specific gate (dependency audit, SAST, secret scan) in CI, or is it purely functional tests?

## code.source_code_access_review
Attestation-leaning even though tagged `code` — ask the user who has push/read access to
this repo (org/team membership isn't visible from the checked-out working copy).

## code.env_separation_review
- Are dev/test/prod credentials clearly distinct (different env files, different secret names), or is there a real risk of a test config accidentally pointing at prod?
- Does test data/fixtures ever contain what looks like real customer data?

## code.data_deletion_review
- Trace every "delete account/user/tenant" endpoint. Does it cascade to all of that entity's data, or leave orphaned rows/tables/external-service state behind?
- If it doesn't fully cascade, is that at least surfaced to the caller (an explicit warning), or silent?

## code.data_masking_review
- Grep logging/print statements and error-response bodies for anything that could carry a secret, token, or raw PII value.
- Check whether internal exception messages (`str(e)`) ever reach the client response directly.

## code.change_management_review
- Is there a defined deploy pipeline (CI/CD config), or are deploys manual/ad hoc?
- Does the pipeline enforce tests/build passing before a prod deploy step runs?

## Result schema
See `../SKILL.md` § Result schema — every check_id above returns one entry.
