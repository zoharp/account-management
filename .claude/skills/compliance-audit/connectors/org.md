# Org connector — attestation, not automation

These checks can't be answered by scanning anything — they're about whether this
specific system is actually covered by programs the company already runs org-wide.
Don't skip them and don't guess; either ask the user directly (a batch of yes/no +
"where's the evidence" questions) or, if they hand over a document (policy PDF, DPA,
risk register export), read it and check whether it actually names/covers this system —
a generic company-wide policy that never mentions this system by name is a partial,
not a pass.

## How to run this connector
1. Batch every `org.*` check_id that the current audit run touches into a single set of
   questions — don't ask one at a time across many turns.
2. For each, accept one of: a direct attestation ("yes, covered — see <link/doc>"), an
   uploaded document to cross-check, or "no" / "not yet".
3. A "yes" attestation with no evidence reference is a valid pass for this v1 (the
   org's ISMS is assumed to already exist and be sound) — record it as
   `status: pass, evidence: "user attestation, no document reviewed"` so a later formal
   audit can tell the difference between "we checked a document" and "we were told yes".
4. A document that's handed over should actually be read (PDF/doc via the Read tool)
   and checked for whether it names this system, not just whether it exists in general.

## Result schema
Same shape as automated checks (see `../SKILL.md` § Result schema) — `evidence` field
carries the attestation text or the document reference instead of a file:line citation.
