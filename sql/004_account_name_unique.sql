-- ─────────────────────────────────────────────────────────────────────────
-- 004_account_name_unique.sql
--
-- Run ONCE against the MASTER / platform Supabase database — the same one
-- holding `accounts`, `users`, `auth_methods`, `account_usage_logs` and
-- `security_audit_log`.
--
-- WHY IT EXISTS — the application check cannot be the last word.
-- `POST /api/accounts` refuses a duplicate name (`accountCiFilter`, an `ilike`
-- lookup) and the create form greys out the button. Both are read-then-write:
-- between the SELECT and the INSERT there is a window, and on the provisioning
-- path that window is MINUTES wide — the name is checked when the job starts and
-- the `accounts` row is written by `tickSavingAccount` after the Supabase project
-- comes up healthy. Two operators creating `acme` at the same time therefore both
-- pass, and master ends up with two rows.
--
-- Two rows are not a cosmetic problem. `account_name` is a text key with NO
-- foreign key in five tables (`auth_methods`, `account_llm_keys`,
-- `account_usage_logs`, `account_provisioning`, `security_audit_log`), and every
-- lookup takes `rows[0]`. Which of the two duplicates that is, is arbitrary — so
-- one tenant's LLM key, auth config and usage can be read against the other's
-- account row. Only the database can close that window.
--
-- CASE-INSENSITIVE, matching every reader. `accountCiFilter()` compares with
-- `ilike`, so `Acme` and `acme` are already the same account everywhere in this
-- app; the index is on `lower(account_name)` so the database agrees rather than
-- permitting a pair the code cannot tell apart.
-- ─────────────────────────────────────────────────────────────────────────

-- Fail loudly rather than half-applying. `create unique index` on a table that
-- already holds duplicates errors with the conflicting KEY only, which does not
-- say which names or how many. Merging duplicates is a hand-run job (the five
-- tables above have to be repointed first), so this names them and stops.
do $$
declare
  dupes text;
begin
  select string_agg(name || ' (' || n || ' rows)', ', ' order by name)
    into dupes
    from (
      select lower(account_name) as name, count(*) as n
        from accounts
       group by lower(account_name)
      having count(*) > 1
    ) d;

  if dupes is not null then
    raise exception
      'accounts already holds duplicate names, so the unique index cannot be '
      'created: %. Merge them by hand first — repoint auth_methods, '
      'account_llm_keys, account_usage_logs, account_provisioning and '
      'security_audit_log at the surviving row, delete the other, then re-run '
      'this migration.', dupes;
  end if;
end $$;

create unique index if not exists accounts_account_name_lower_key
  on accounts (lower(account_name));

comment on index accounts_account_name_lower_key is
  'Account names are unique without regard to case — the same comparison '
  '`accountCiFilter()` makes with ilike. This is the only duplicate check that '
  'cannot race: the API checks then inserts, and on the provisioning path those '
  'two are minutes apart. See sql/004_account_name_unique.sql.';
