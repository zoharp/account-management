-- ─────────────────────────────────────────────────────────────────────────
-- bootstrap_new_account.sql
--
-- Full, idempotent schema + seed data for a brand-new per-account database.
-- Run once against a freshly created (empty) Supabase/Postgres project to
-- bring it up to the same schema every other account database has.
--
-- Run automatically by backend/provisioning.py during one-click account
-- creation (POST /admin/accounts), or manually in the Supabase SQL editor.
--
-- Does NOT include: users, accounts, account_llm_keys, auth_methods,
-- password_reset_tokens — those are platform/master-only tables (see
-- SCHEMA.md §10). User identity is global (owned by the master DB); columns
-- like repositories.owner_id and repository_members.user_id are plain
-- bigint values holding the master user id — there is no local FK to a
-- per-account users table.
-- ─────────────────────────────────────────────────────────────────────────


-- ── 1. Extensions ───────────────────────────────────────────────────────

create extension if not exists vector;
create extension if not exists pg_trgm;


-- ── 2. Standards (no dependencies) ──────────────────────────────────────

create table if not exists standards (
  id                      text primary key,
  name                    text not null,
  default_ai_instructions text not null
);

create table if not exists standard_sections (
  id               bigserial primary key,
  standard_id      text not null references standards(id),
  section_id       text not null,
  title            text not null,
  description      text,
  default_keywords text[] default '{}',
  created_at       timestamptz default now(),
  unique (standard_id, section_id)
);

create table if not exists predefined_questions (
  id            bigserial primary key,
  standard_id   text not null references standards(id),
  question_text text not null,
  hint_short    text,
  tags          text[] default '{}',
  category      text,
  sort_order    int default 0,
  created_at    timestamptz default now(),
  unique (standard_id, question_text)
);

create index if not exists idx_predefined_questions_standard on predefined_questions(standard_id);
create index if not exists idx_predefined_questions_tags    on predefined_questions using gin(tags);


-- ── 3. Settings table (no dependencies) ─────────────────────────────────

create table if not exists rag_settings (
  id          bigserial primary key,
  key         varchar not null unique,
  value       text not null,
  description text,
  data_type   varchar,
  min_value   double precision,
  max_value   double precision,
  tooltip     text,
  category    varchar,
  created_at  timestamp default now(),
  updated_at  timestamp default now()
);


-- ── 4. Repositories & sharing ───────────────────────────────────────────

create table if not exists repositories (
  id                   bigserial primary key,
  name                 text not null,
  owner_id             bigint not null,       -- global master user id (no local FK)
  storage_type         text not null default 'gdrive',
  storage_url          text not null,
  standard_id          text references standards(id),
  ai_instructions      text,
  company_details      text,
  scoring_config       jsonb default null,
  scoring_running      boolean default false,
  scoring_last_run_at  timestamptz default null,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

create index if not exists repositories_owner_id_idx on repositories(owner_id);

create table if not exists repository_members (
  id            bigserial primary key,
  repository_id bigint not null references repositories(id) on delete cascade,
  user_id       bigint not null,              -- global master user id (no local FK)
  permission    text not null default 'viewer',
  invited_at    timestamptz default now(),
  unique (repository_id, user_id)
);

create index if not exists repository_members_user_id_idx on repository_members(user_id);

create table if not exists repository_section_keywords (
  id            bigserial primary key,
  repository_id bigint not null references repositories(id) on delete cascade,
  section_id    bigint not null references standard_sections(id) on delete cascade,
  keywords      text[] not null default '{}',
  updated_at    timestamptz default now(),
  unique (repository_id, section_id)
);

create table if not exists repository_trace_patterns (
  id            bigserial primary key,
  repository_id bigint not null references repositories(id) on delete cascade,
  pattern       text not null,
  description   text,
  enabled       boolean default true,
  created_at    timestamptz default now(),
  unique (repository_id, pattern)
);

create index if not exists idx_repo_trace_patterns_repo on repository_trace_patterns(repository_id);

create table if not exists repository_skills (
  id            uuid primary key default gen_random_uuid(),
  repository_id bigint not null references repositories(id) on delete cascade,
  skill_id      text not null,
  name          text not null,
  description   text,
  system_prompt text not null,
  author        text,
  version       text,
  standard      text,
  industry      text,
  role          text,
  tags          text[] default '{}',
  verified      boolean default false,
  is_local      boolean default true,
  source_url    text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (repository_id, skill_id)
);

create index if not exists repository_skills_repository_id_idx on repository_skills(repository_id);

create table if not exists repository_imports (
  id                   bigserial primary key,
  repository_id        bigint not null references repositories(id) on delete cascade,
  source_type          text not null,
  source_config        jsonb not null default '{}',
  is_active            boolean not null default true,
  indexing_status      text not null default 'idle',
  indexing_started_at  timestamptz,
  last_indexed_at      timestamptz,
  document_count       integer default 0,
  last_error           text,
  last_warning         text,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

create index if not exists idx_repo_imports_repository on repository_imports(repository_id);
create index if not exists idx_repo_imports_status     on repository_imports(indexing_status);


-- ── 5. Documents & chunks ───────────────────────────────────────────────

create table if not exists documents (
  id                bigserial primary key,
  doc_name          text not null,
  file_path         text not null,
  summary           text,
  chunk_count       integer default 0,
  name_vector       vector(1536),
  indexed_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  repository_id     bigint references repositories(id),
  owner_id          bigint,                     -- global master user id (no local FK)
  doc_metadata      jsonb,
  doc_structure     text default 'sections',
  id_column_name    text,
  chunking_strategy text default 'semantic',
  file_content      bytea,
  file_hash         text,
  uploaded_at       timestamptz default now(),
  control_type      text,
  parent_id         bigint references documents(id) on delete set null,
  base_name         text,
  import_id         bigint references repository_imports(id) on delete set null,
  unique (doc_name, repository_id)
);

create index if not exists documents_repository_id_idx on documents(repository_id);
create index if not exists documents_name_vector_idx on documents using ivfflat (name_vector vector_cosine_ops) with (lists = 10);
create index if not exists documents_doc_name_trgm_idx on documents using gin (doc_name gin_trgm_ops);
create index if not exists documents_doc_title_trgm_idx on documents using gin ((doc_metadata->>'doc_title') gin_trgm_ops);
create index if not exists documents_doc_id_trgm_idx on documents using gin ((doc_metadata->>'doc_id') gin_trgm_ops);
create index if not exists documents_doc_type_trgm_idx on documents using gin ((doc_metadata->>'doc_type') gin_trgm_ops);
create index if not exists documents_department_trgm_idx on documents using gin ((doc_metadata->>'department') gin_trgm_ops);
create index if not exists documents_owner_trgm_idx on documents using gin ((doc_metadata->>'owner') gin_trgm_ops);
create index if not exists documents_description_trgm_idx on documents using gin ((doc_metadata->>'description') gin_trgm_ops);
create index if not exists documents_topics_trgm_idx on documents using gin ((doc_metadata->>'topics') gin_trgm_ops);
create index if not exists documents_repo_hash_idx on documents(repository_id, file_hash);
create index if not exists idx_documents_parent_id on documents(parent_id);
create index if not exists idx_documents_control_type on documents(control_type);
create index if not exists idx_documents_base_name on documents(base_name, repository_id);
create index if not exists idx_documents_import_id on documents(import_id);

create table if not exists doc_chunks (
  id                   bigserial primary key,
  doc_name             text not null,
  chunk_index          integer not null,
  chunk_type           text not null default 'section',
  text                 text not null,
  vector               vector(1536),
  metadata             jsonb default '{}'::jsonb,
  doc_id               bigint references documents(id),
  fts                  tsvector generated always as (to_tsvector('english', text)) stored,
  repository_id        bigint references repositories(id),
  created_at           timestamptz default now(),
  record_id            text,
  traced_items         text[] default '{}',
  preserve_formatting  boolean default false,
  score                float default 0
);

create index if not exists doc_chunks_vector_idx on doc_chunks using ivfflat (vector vector_cosine_ops) with (lists = 100);
create index if not exists doc_chunks_fts_idx on doc_chunks using gin(fts);
create index if not exists doc_chunks_repository_id_idx on doc_chunks(repository_id);
create index if not exists idx_doc_chunks_record_id on doc_chunks(record_id) where record_id is not null;
create index if not exists idx_doc_chunks_traced_items on doc_chunks using gin(traced_items);
create index if not exists idx_doc_chunks_repo_score on doc_chunks(repository_id, score desc);


-- ── 6. Conversations & messages ─────────────────────────────────────────

create table if not exists conversations (
  id            bigserial primary key,
  title         text not null default 'New Conversation',
  timestamp     text not null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  repository_id bigint references repositories(id),
  user_id       bigint                       -- global master user id (no local FK)
);

create index if not exists conversations_repository_user_idx on conversations(repository_id, user_id);

create table if not exists conversation_messages (
  id              bigserial primary key,
  conversation_id bigint not null references conversations(id) on delete cascade,
  message_id      bigint not null,
  type            text not null,
  content         text,
  answer          text,
  sources         jsonb,
  chunks_searched integer,
  usage           jsonb,
  timestamp       text not null,
  feedback        text,
  router_debug    jsonb default '{}',
  repository_id   bigint references repositories(id),
  created_at      timestamptz default now()
);

create index if not exists conversation_messages_conversation_id_idx on conversation_messages(conversation_id);


-- ── 7. Usage logs ────────────────────────────────────────────────────────

create table if not exists usage_logs (
  id                bigserial primary key,
  repository_id     bigint references repositories(id),
  repository_name   text,
  action            text not null,
  conversation_name text,
  tokens            integer,
  cost_usd          numeric,
  user_id           bigint,                  -- global master user id (no local FK)
  created_at        timestamptz default now()
);


-- ── 8. Upload logs (ZIP upload) ─────────────────────────────────────────

create table if not exists upload_logs (
  id            bigserial primary key,
  repository_id bigint not null references repositories(id) on delete cascade,
  upload_id     text not null,
  file_name     text not null,
  file_hash     text,
  status        text not null,
  reason        text,
  file_size     bigint,
  uploaded_at   timestamptz default now(),
  created_at    timestamptz default now()
);

create index if not exists upload_logs_repo_idx      on upload_logs(repository_id);
create index if not exists upload_logs_upload_id_idx on upload_logs(upload_id);
create index if not exists upload_logs_at_idx        on upload_logs(uploaded_at desc);
create index if not exists upload_logs_status_idx    on upload_logs(status);


-- ── 9. Search functions (RPC) ───────────────────────────────────────────

create or replace function search_chunks(
  query_vector    vector(1536),
  match_count     int default 5,
  filter_doc      text default null,
  p_repository_id bigint default null
)
returns table (
  id          bigint,
  doc_name    text,
  chunk_index integer,
  chunk_type  text,
  text        text,
  metadata    jsonb,
  similarity  float
)
language sql stable as $$
  select
    id, doc_name, chunk_index, chunk_type, text, metadata,
    1 - (vector <=> query_vector) as similarity
  from doc_chunks
  where (filter_doc is null or doc_name = filter_doc)
    and (p_repository_id is null or repository_id = p_repository_id)
  order by vector <=> query_vector
  limit match_count;
$$;

create or replace function search_chunks_hybrid(
  query_vector    vector(1536),
  query_text      text,
  match_count     int default 5,
  filter_doc      text default null,
  p_repository_id bigint default null
)
returns table (
  id          bigint,
  doc_name    text,
  chunk_index integer,
  chunk_type  text,
  text        text,
  metadata    jsonb,
  similarity  float
)
language sql stable as $$
  with
    vec as (
      select id, 1 - (vector <=> query_vector) as score,
             row_number() over (order by vector <=> query_vector) as rank
      from doc_chunks
      where (filter_doc is null or doc_name = filter_doc)
        and (p_repository_id is null or repository_id = p_repository_id)
      order by vector <=> query_vector
      limit match_count * 3
    ),
    fts as (
      select id,
             ts_rank_cd(fts, plainto_tsquery('english', query_text)) as score,
             row_number() over (order by ts_rank_cd(fts, plainto_tsquery('english', query_text)) desc) as rank
      from doc_chunks
      where (filter_doc is null or doc_name = filter_doc)
        and (p_repository_id is null or repository_id = p_repository_id)
        and fts @@ plainto_tsquery('english', query_text)
      order by score desc
      limit match_count * 3
    ),
    merged as (
      select
        coalesce(v.id, f.id) as id,
        (coalesce(1.0 / (60 + v.rank), 0) + coalesce(1.0 / (60 + f.rank), 0)) as rrf_score
      from vec v
      full outer join fts f on v.id = f.id
    )
  select
    dc.id, dc.doc_name, dc.chunk_index, dc.chunk_type, dc.text, dc.metadata,
    m.rrf_score as similarity
  from merged m
  join doc_chunks dc on dc.id = m.id
  order by rrf_score desc
  limit match_count;
$$;

create or replace function search_documents_by_content(
  p_search        text,
  p_repository_id bigint default null,
  p_limit         int default 30,
  p_offset        int default 0,
  p_threshold     float default 0.4
)
returns table (
  doc_name      text,
  chunk_count   integer,
  file_path     text,
  indexed_at    timestamptz,
  doc_metadata  jsonb
)
language sql stable as $$
  select distinct d.doc_name, d.chunk_count, d.file_path, d.indexed_at, d.doc_metadata
  from doc_chunks dc
  join documents d on d.doc_name = dc.doc_name
    and (p_repository_id is null or d.repository_id = p_repository_id)
  where
    (p_repository_id is null or dc.repository_id = p_repository_id)
    and word_similarity(p_search, dc.text) > p_threshold
  order by d.doc_name
  limit p_limit offset p_offset;
$$;

create or replace function search_documents_by_content_count(
  p_search        text,
  p_repository_id bigint default null,
  p_threshold     float default 0.4
)
returns bigint
language sql stable as $$
  select count(distinct d.doc_name)
  from doc_chunks dc
  join documents d on d.doc_name = dc.doc_name
    and (p_repository_id is null or d.repository_id = p_repository_id)
  where
    (p_repository_id is null or dc.repository_id = p_repository_id)
    and word_similarity(p_search, dc.text) > p_threshold;
$$;

create or replace function search_documents_by_name(
  query_vector    vector(1536),
  match_count     int default 5,
  p_repository_id bigint default null
)
returns table (
  doc_name   text,
  similarity float
)
language sql stable as $$
  select
    doc_name,
    1 - (name_vector <=> query_vector) as similarity
  from documents
  where name_vector is not null
    and (p_repository_id is null or repository_id = p_repository_id)
  order by name_vector <=> query_vector
  limit match_count;
$$;

-- Trigram fuzzy-match sensitivity for search_documents_by_content (persists per-DB)
select set_limit(0.2);

create or replace function apply_item_scoring(p_repo_id int, p_rules jsonb)
returns int language plpgsql as $$
declare updated_count int;
begin
  update doc_chunks c
  set score = (
    select coalesce(sum(
      case
        when (r->>'field') != 'text_length'
          and lower(c.metadata->>(r->>'field')) = lower(r->>'value')
        then (r->>'weight')::int
        when (r->>'field') = 'text_length' and (r->>'value') = 'long'   and length(c.text) > 400   then (r->>'weight')::int
        when (r->>'field') = 'text_length' and (r->>'value') = 'medium' and length(c.text) between 150 and 400 then (r->>'weight')::int
        when (r->>'field') = 'text_length' and (r->>'value') = 'short'  and length(c.text) < 150   then (r->>'weight')::int
        else 0
      end
    ), 0)
    from jsonb_array_elements(p_rules) as r
  )
  where c.repository_id = p_repo_id and c.chunk_type = 'row';
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;


-- ── 10. Seed data ────────────────────────────────────────────────────────

-- standards
insert into standards (id, name, default_ai_instructions) values
  ('empty', 'Empty', ''),
  ('iec_62304', 'IEC 62304:2006+AMD1:2015', 'You are an expert in medical device software lifecycle processes and the IEC 62304:2006+AMD1:2015 standard. When answering questions, reference the relevant clause numbers (e.g. "Clause 5.2.1") and clearly distinguish between requirements for Software Safety Class A, B, and C. Emphasize software development planning, architecture, unit implementation, integration, testing, problem resolution, and configuration management. Where documentation or records are missing or incomplete, state it explicitly. When identifying gaps, map them to the specific IEC 62304 clause that requires the missing artifact. For Class C software, always highlight the additional verification and V&V requirements. Reference related standards where relevant: ISO 14971 for risk management, ISO 13485 for QMS context, IEC 62366 for usability, and IEC 82304 for standalone software.'),
  ('iso_13485', 'ISO 13485:2016', 'You are an expert in quality management systems for medical devices and the ISO 13485:2016 standard. When answering questions, reference the relevant clause numbers (e.g. "Clause 7.3.3") and emphasize regulatory compliance, risk-based thinking, design controls, and traceability requirements. Distinguish between requirements that apply to all organizations and those that apply only when the relevant processes are performed. Where evidence or records are missing, state it clearly.'),
  ('iso_14971', 'ISO 14971:2019', 'You are an expert in medical device risk management and the ISO 14971:2019 standard. When answering questions, frame findings in terms of hazard identification, risk estimation, risk evaluation, and risk control. Reference specific clauses and emphasize the risk management process lifecycle.'),
  ('iso_27001', 'ISO 27001:2022', 'You are an expert in information security management systems (ISMS) and the ISO 27001:2022 standard. When answering questions, relate findings to the relevant Annex A controls and clauses. Use precise security terminology. Where evidence gaps exist, state them clearly rather than speculating.')
on conflict (id) do nothing;

-- standard_sections
insert into standard_sections (standard_id, section_id, title, description, default_keywords) values
  ('iso_27001', 'A.5.1', 'Information Security Policies', null, '{"information security policy","security policy","policy governance","information security governance"}'),
  ('iso_27001', 'A.6.1', 'Organization of Information Security', null, '{"information security roles","security responsibilities","HR security","human resources security"}'),
  ('iso_27001', 'A.9.1', 'Access Control Policy', null, '{"access control","authorization","authentication","access policy"}'),
  ('iso_27001', 'A.10.1', 'Cryptography Policy', null, '{"encryption","cryptography","cipher","TLS","data protection","data security"}'),
  ('iso_27001', 'A.12.1', 'Operational Procedures', null, '{"operational procedures","system procedures","IT operations","change management","system logging"}'),
  ('iso_13485', '4.1', 'General Requirements', 'Establish, document, implement, maintain and improve the QMS.', '{"quality management system","QMS","processes","outsourced processes","documented procedures","regulatory requirements"}'),
  ('iso_13485', '4.2.1', 'Documentation Requirements — General', 'QMS documentation including quality policy, quality manual, procedures, records and documents.', '{"documentation","quality manual","documented procedures","records","quality policy"}'),
  ('iso_13485', '4.2.2', 'Quality Manual', 'Establish and maintain a quality manual including scope, exclusions and interaction of processes.', '{"quality manual","scope","exclusions","process interaction","QMS scope"}'),
  ('iso_13485', '4.2.3', 'Medical Device File', 'Maintain a file for each medical device type or family containing documents and records.', '{"medical device file","device master record","DMR","device history record","DHR","technical file"}'),
  ('iso_13485', '4.2.4', 'Control of Documents', 'Documents required by the QMS shall be controlled.', '{"document control","controlled documents","document approval","document revision","obsolete documents","SOP","procedure"}'),
  ('iso_13485', '4.2.5', 'Control of Records', 'Records shall be established and maintained to provide evidence of conformity.', '{"records","record control","record retention","traceability records","quality records","retention period"}'),
  ('iso_13485', '5.1', 'Management Commitment', 'Top management shall provide evidence of its commitment to the development and maintenance of the QMS.', '{"management commitment","top management","regulatory requirements","quality objectives","management review"}'),
  ('iso_13485', '5.2', 'Customer Focus', 'Top management shall ensure customer and regulatory requirements are determined and met.', '{"customer focus","customer requirements","regulatory requirements","customer satisfaction"}'),
  ('iso_13485', '5.3', 'Quality Policy', 'Top management shall ensure the quality policy is appropriate to the organisation.', '{"quality policy","policy statement","commitment to compliance","continual improvement"}'),
  ('iso_13485', '5.4.1', 'Quality Objectives', 'Top management shall ensure quality objectives are established at relevant functions and levels.', '{"quality objectives","measurable objectives","KPI","performance targets"}'),
  ('iso_13485', '5.4.2', 'Quality Management System Planning', 'Top management shall ensure planning of the QMS is carried out.', '{"QMS planning","system planning","quality planning","integrity of QMS"}'),
  ('iso_13485', '5.5.1', 'Responsibility and Authority', 'Top management shall ensure responsibilities and authorities are defined and communicated.', '{"responsibility","authority","job description","organizational chart","roles"}'),
  ('iso_13485', '5.5.2', 'Management Representative', 'Top management shall appoint a member of management as management representative.', '{"management representative","QMS representative","regulatory liaison"}'),
  ('iso_13485', '5.5.3', 'Internal Communication', 'Top management shall ensure appropriate communication processes are established.', '{"internal communication","communication process","QMS effectiveness"}'),
  ('iso_13485', '5.6', 'Management Review', 'Top management shall review the QMS at planned intervals to ensure its continuing suitability, adequacy and effectiveness.', '{"management review","review meeting","review input","review output","corrective action","audit results"}'),
  ('iso_13485', '6.1', 'Provision of Resources', 'The organisation shall determine and provide resources needed to implement and maintain the QMS.', '{"resources","resource planning","infrastructure","budget"}'),
  ('iso_13485', '6.2', 'Human Resources', 'Personnel performing work affecting product quality shall be competent.', '{"human resources","competence","training","qualification","awareness","skills","personnel records"}'),
  ('iso_13485', '6.3', 'Infrastructure', 'Determine, provide and maintain infrastructure needed to achieve conformity to product requirements.', '{"infrastructure","facilities","equipment","utilities","maintenance","buildings"}'),
  ('iso_13485', '6.4.1', 'Work Environment', 'Determine and manage the work environment needed to achieve conformity to product requirements.', '{"work environment","environmental conditions","cleanroom","temperature","humidity","environmental monitoring"}'),
  ('iso_13485', '6.4.2', 'Contamination Control', 'Make arrangements for controlling contaminated or potentially contaminated product.', '{"contamination control","contamination","sterile","clean area","gowning","bioburden"}'),
  ('iso_13485', '7.1', 'Planning of Product Realization', 'Plan and develop the processes needed for product realization.', '{"product realization","quality plan","risk management","design planning","verification","validation","acceptance criteria"}'),
  ('iso_13485', '7.2.1', 'Determination of Requirements Related to Product', 'Determine requirements specified by the customer, regulatory, and use requirements.', '{"customer requirements","intended use","regulatory requirements","product requirements","user needs"}'),
  ('iso_13485', '7.2.2', 'Review of Requirements Related to Product', 'Review requirements related to the product before commitment to supply.', '{"requirements review","contract review","order review","tender review"}'),
  ('iso_13485', '7.2.3', 'Communication', 'Determine and implement effective arrangements for communicating with customers.', '{"customer communication","product information","feedback","complaints","advisory notices"}'),
  ('iso_13485', '7.3.1', 'Design and Development — General', 'Document and maintain procedures for design and development of product.', '{"design and development","design controls","design procedure"}'),
  ('iso_13485', '7.3.2', 'Design and Development Planning', 'Plan and control the design and development of product.', '{"design planning","development planning","design stages","design reviews","design team","design schedule"}'),
  ('iso_13485', '7.3.3', 'Design and Development Inputs', 'Inputs relating to product requirements shall be determined and records maintained.', '{"design inputs","user needs","intended use","functional requirements","performance requirements","safety requirements","regulatory inputs"}'),
  ('iso_13485', '7.3.4', 'Design and Development Outputs', 'Outputs shall be provided in a form that enables verification against inputs.', '{"design outputs","drawings","specifications","acceptance criteria","labeling requirements"}'),
  ('iso_13485', '7.3.5', 'Design and Development Review', 'At suitable stages, systematic reviews of design and development shall be performed.', '{"design review","design review record","formal review","review participants"}'),
  ('iso_13485', '7.3.6', 'Design and Development Verification', 'Verification shall be performed to ensure outputs have met input requirements.', '{"design verification","verification protocol","verification report","testing","inspection"}'),
  ('iso_13485', '7.3.7', 'Design and Development Validation', 'Validation shall be performed to ensure the resulting product is capable of meeting requirements for specified application or intended use.', '{"design validation","validation protocol","validation report","clinical evaluation","usability","intended use","simulated use"}'),
  ('iso_13485', '7.3.8', 'Design and Development Transfer', 'Transfer of design and development outputs to manufacturing shall be controlled.', '{"design transfer","technology transfer","manufacturing transfer","production release"}'),
  ('iso_13485', '7.3.9', 'Control of Design and Development Changes', 'Design and development changes shall be identified and records maintained.', '{"design change","change control","design change order","ECO","change request","impact assessment"}'),
  ('iso_13485', '7.3.10', 'Design and Development Files', 'Maintain a design and development file for each medical device type or family.', '{"design history file","DHF","design file","technical documentation"}'),
  ('iso_13485', '7.4.1', 'Purchasing Process', 'Ensure purchased product conforms to specified purchase requirements.', '{"purchasing","supplier control","supplier evaluation","approved supplier list","supplier qualification","critical supplier"}'),
  ('iso_13485', '7.4.2', 'Purchasing Information', 'Purchasing documents shall describe the product to be purchased.', '{"purchase order","purchasing information","supplier specification","quality agreement"}'),
  ('iso_13485', '7.4.3', 'Verification of Purchased Product', 'Establish and implement the inspection or other activities necessary for ensuring purchased product meets requirements.', '{"incoming inspection","receiving inspection","supplier verification","certificate of conformance","COC"}'),
  ('iso_13485', '7.5.1', 'Control of Production and Service Provision', 'Plan and carry out production and service provision under controlled conditions.', '{"production control","manufacturing controls","work instructions","batch record","device history record","DHR","in-process inspection"}'),
  ('iso_13485', '7.5.2', 'Cleanliness of Product', 'Document requirements for cleanliness of product or contamination control during manufacturing.', '{"cleanliness","product cleanliness","cleaning procedure","particulate contamination"}'),
  ('iso_13485', '7.5.3', 'Installation Activities', 'Document requirements for installation and installation verification.', '{"installation","installation qualification","IQ","site installation","installation record"}'),
  ('iso_13485', '7.5.4', 'Service Activities', 'Document service procedures, reference documents, and service records.', '{"servicing","maintenance","service record","field service","service report"}'),
  ('iso_13485', '7.5.5', 'Particular Requirements for Sterile Medical Devices', 'Maintain records of sterilization process parameters for each sterilization batch.', '{"sterile","sterilization","sterility","sterilization batch","sterilization record","SAL"}'),
  ('iso_13485', '7.5.6', 'Validation of Processes for Production and Service Provision', 'Validate processes for production where output cannot be verified by subsequent monitoring or measurement.', '{"process validation","IQ","OQ","PQ","validation protocol","validation report","revalidation"}'),
  ('iso_13485', '7.5.7', 'Validation of Processes for Sterilization', 'Validate sterilization processes and sterile barrier systems.', '{"sterilization validation","sterile barrier","EO sterilization","gamma sterilization","autoclave validation"}'),
  ('iso_13485', '7.5.8', 'Identification', 'Identify product throughout product realization.', '{"product identification","labeling","part number","lot number","batch number","UDI","unique device identification"}'),
  ('iso_13485', '7.5.9', 'Traceability', 'Maintain records that enable traceability of the medical device.', '{"traceability","device traceability","lot traceability","implantable device","UDI","distribution records"}'),
  ('iso_13485', '7.5.10', 'Customer Property', 'Exercise care with customer property while it is under the organisation''s control.', '{"customer property","customer-supplied product","customer asset","patient data"}'),
  ('iso_13485', '7.5.11', 'Preservation of Product', 'Preserve product during internal processing and delivery to intended destination.', '{"preservation","packaging","storage","handling","shelf life","expiry date","environmental storage conditions"}'),
  ('iso_13485', '7.6', 'Control of Monitoring and Measuring Equipment', 'Determine the monitoring and measurement to be undertaken and the equipment needed.', '{"calibration","measuring equipment","monitoring equipment","calibration records","calibration certificate","measurement uncertainty"}'),
  ('iso_13485', '8.1', 'General — Measurement Analysis and Improvement', 'Plan and implement the monitoring, measurement, analysis and improvement processes needed.', '{"measurement","analysis","improvement","statistical techniques","monitoring"}'),
  ('iso_13485', '8.2.1', 'Feedback', 'Monitor information relating to whether the organisation has met customer requirements.', '{"customer feedback","post-market surveillance","post-market data","feedback system","complaint trend"}'),
  ('iso_13485', '8.2.2', 'Complaint Handling', 'Document a procedure for timely complaint handling.', '{"complaint","complaint handling","complaint investigation","customer complaint","complaint record","reportable complaint"}'),
  ('iso_13485', '8.2.3', 'Reporting to Regulatory Authorities', 'Document a procedure for notification of adverse events and issuing advisory notices.', '{"regulatory reporting","MDR","medical device report","adverse event","vigilance report","field safety corrective action","FSCA","advisory notice"}'),
  ('iso_13485', '8.2.4', 'Internal Audit', 'Conduct internal audits at planned intervals to determine whether the QMS conforms.', '{"internal audit","audit plan","audit schedule","audit report","audit findings","auditor","audit checklist"}'),
  ('iso_13485', '8.2.5', 'Monitoring and Measurement of Processes', 'Apply suitable methods for monitoring and measurement of QMS processes.', '{"process monitoring","process measurement","process performance","KPI","metrics"}'),
  ('iso_13485', '8.2.6', 'Monitoring and Measurement of Product', 'Monitor and measure characteristics of product to verify product requirements are met.', '{"product inspection","product testing","final inspection","acceptance testing","release criteria","certificate of conformance"}'),
  ('iso_13485', '8.3.1', 'Control of Nonconforming Product — General', 'Ensure product that does not conform to product requirements is identified and controlled.', '{"nonconforming product","nonconformance","NCR","disposition","quarantine","rejection"}'),
  ('iso_13485', '8.3.2', 'Nonconforming Product Before Delivery', 'Take action on nonconforming product detected before delivery.', '{"rework","repair","scrap","deviation","concession","waiver","disposition"}'),
  ('iso_13485', '8.3.3', 'Nonconforming Product After Delivery', 'Take appropriate action on nonconforming product detected after delivery.', '{"field nonconformance","product recall","field correction","FSCA","advisory notice","customer notification"}'),
  ('iso_13485', '8.3.4', 'Rework', 'Document and approve rework processes in a manner equivalent to the original process.', '{"rework","rework procedure","rework record","rework authorization"}'),
  ('iso_13485', '8.4', 'Analysis of Data', 'Determine, collect and analyse appropriate data to demonstrate suitability and effectiveness of the QMS.', '{"data analysis","trend analysis","statistical analysis","quality data","performance data","post-market data"}'),
  ('iso_13485', '8.5.1', 'Improvement — General', 'Identify and implement changes necessary to ensure the continuing suitability, adequacy and effectiveness of the QMS.', '{"continual improvement","improvement","quality improvement","opportunities for improvement"}'),
  ('iso_13485', '8.5.2', 'Corrective Action', 'Take action to eliminate the cause of nonconformities to prevent recurrence.', '{"corrective action","CAPA","root cause analysis","corrective action plan","CAR","effectiveness verification"}'),
  ('iso_13485', '8.5.3', 'Preventive Action', 'Determine action to eliminate the cause of potential nonconformities to prevent occurrence.', '{"preventive action","CAPA","risk prevention","preventive action plan","PAR"}'),
  ('iec_62304', '4.1', 'Quality Management System', 'The manufacturer shall establish a quality management system that includes software lifecycle processes.', '{"quality management system","QMS","software lifecycle","IEC 62304 compliance","software processes","regulatory requirements"}'),
  ('iec_62304', '4.2', 'Risk Management', 'The manufacturer shall establish a risk management process compliant with ISO 14971 covering software.', '{"risk management","ISO 14971","software risk","risk control","residual risk","hazard","risk analysis","software contribution to risk"}'),
  ('iec_62304', '4.3', 'Software Safety Classification', 'Classify software items into Class A, B, or C based on their potential to contribute to hazardous situations.', '{"software safety class","Class A","Class B","Class C","safety classification","hazardous situation","software classification rationale"}'),
  ('iec_62304', '5.1', 'Software Development Planning', 'Establish a software development plan covering lifecycle model, activities, deliverables, tools, standards and traceability.', '{"software development plan","SDP","development planning","lifecycle model","software deliverables","development tools","software standards"}'),
  ('iec_62304', '5.1.1', 'Software Development Life Cycle Model', 'Define the software development lifecycle model appropriate for the project.', '{"lifecycle model","SDLC","waterfall","agile","iterative model","development model","software lifecycle model"}'),
  ('iec_62304', '5.1.2', 'Keep Software Development Plan Updated', 'Keep the software development plan current as development progresses.', '{"development plan update","plan revision","plan maintenance","software plan control"}'),
  ('iec_62304', '5.1.3', 'Software Development Plan Reference to System Design and Development', 'Reference the system design and development plan where one exists.', '{"system design","system development plan","hardware-software interface","system architecture reference"}'),
  ('iec_62304', '5.1.4', 'Software Development Standards, Methods and Tools Planning', 'Plan the standards, methods and tools used in software development.', '{"development standards","coding standards","development methods","software tools","CASE tools","tool qualification"}'),
  ('iec_62304', '5.1.5', 'Software Integration and Integration Testing Planning', 'Plan the software integration and integration testing.', '{"integration plan","integration testing","software integration","integration test plan","build plan"}'),
  ('iec_62304', '5.1.6', 'Software Verification Planning', 'Plan the verification activities for each development activity.', '{"verification plan","software verification","V&V plan","verification activities","verification methods"}'),
  ('iec_62304', '5.1.7', 'Software Risk Management Planning', 'Plan risk management activities for software.', '{"software risk management plan","risk management activities","software hazard","risk control measures"}'),
  ('iec_62304', '5.1.8', 'Documentation Planning', 'Plan documentation to be produced during software development.', '{"documentation plan","software documents","document list","deliverable documents"}'),
  ('iec_62304', '5.1.9', 'Software Configuration Management Planning', 'Plan configuration management including identification, control, status accounting and auditing.', '{"configuration management plan","CM plan","version control","software configuration","baseline","change control planning"}'),
  ('iec_62304', '5.1.10', 'Supporting Items Planning', 'Plan supporting items needed for software development such as facilities and tools.', '{"development facilities","development environment","supporting items","infrastructure planning","development tools"}'),
  ('iec_62304', '5.1.11', 'Software Safety Class Scaling', 'Scale development activities and deliverables according to the assigned software safety class.', '{"safety class scaling","tailoring","Class A activities","Class B activities","Class C activities","exemptions"}'),
  ('iec_62304', '5.2', 'Software Requirements Analysis', 'Specify and analyse the requirements for the software system, including functional, non-functional and safety requirements.', '{"software requirements","requirements analysis","software requirements specification","SRS","functional requirements","non-functional requirements","safety requirements","security requirements"}'),
  ('iec_62304', '5.2.1', 'Define and Document Software Requirements', 'Define and document the requirements for the software system.', '{"software requirements specification","SRS","requirements definition","software requirements document","functional requirements","performance requirements"}'),
  ('iec_62304', '5.2.2', 'Software Requirements Content', 'Software requirements shall include functionality, performance, interface, safety and security requirements.', '{"requirements content","functional requirements","performance requirements","interface requirements","safety requirements","security requirements","regulatory requirements traceability"}'),
  ('iec_62304', '5.2.3', 'Include Risk Control Measures in Software Requirements', 'Include software risk control measures in the software requirements.', '{"risk control requirements","software risk controls","risk mitigation","safety requirements from risk management"}'),
  ('iec_62304', '5.2.4', 'Re-evaluate Medical Device Risk Analysis', 'Re-evaluate the medical device risk analysis based on software requirements.', '{"risk analysis update","re-evaluation","risk management update","hazard analysis","software hazards"}'),
  ('iec_62304', '5.2.5', 'Update System Requirements', 'Update system requirements to include changes resulting from software requirements analysis.', '{"system requirements update","requirements allocation","traceability update"}'),
  ('iec_62304', '5.2.6', 'Verify Software Requirements', 'Verify that the software requirements are complete, consistent, unambiguous, and testable.', '{"requirements verification","requirements review","requirements completeness","requirements testability","requirements consistency","requirements traceability"}'),
  ('iec_62304', '5.3', 'Software Architectural Design', 'Design and document the software architecture identifying the major structural components (software items) and their interfaces.', '{"software architecture","architectural design","software items","software components","component interfaces","architecture document","SAD"}'),
  ('iec_62304', '5.3.1', 'Transform Software Requirements into an Architecture', 'Design the software architecture that identifies the software items.', '{"architecture design","software decomposition","software items","top-level design","architectural components"}'),
  ('iec_62304', '5.3.2', 'Develop an Architecture for the Interfaces of Software Items', 'Document the interfaces between software items and between software items and hardware.', '{"software interface","interface design","API design","hardware-software interface","software item interfaces","interface specification"}'),
  ('iec_62304', '5.3.3', 'Specify Functional and Performance Requirements of SOUP', 'Specify the functional and performance requirements for SOUP (Software of Unknown Provenance) items.', '{"SOUP","off-the-shelf software","third-party software","SOUP requirements","SOUP functional requirements","SOUP performance requirements","OTS software"}'),
  ('iec_62304', '5.3.4', 'Identify Hardware and Software Items Required by SOUP Item', 'Identify the hardware and software needed to support each SOUP item.', '{"SOUP dependencies","SOUP hardware requirements","SOUP operating system","SOUP environment","SOUP prerequisites"}'),
  ('iec_62304', '5.3.5', 'Identify Segregation Necessary for Risk Control', 'Identify segregation between software items required to implement risk controls.', '{"segregation","software isolation","partitioning","safety partition","risk control segregation","fault containment"}'),
  ('iec_62304', '5.3.6', 'Verify Software Architecture', 'Verify that the software architecture implements all software requirements and risk controls.', '{"architecture verification","architecture review","architecture traceability","design review"}'),
  ('iec_62304', '5.4', 'Software Detailed Design', 'Develop a detailed design for each software unit specifying implementation details.', '{"detailed design","software unit design","unit specification","low-level design","LLD","algorithm design","data structures"}'),
  ('iec_62304', '5.4.1', 'Refine Software Architecture to Software Units', 'Refine the software architecture to define the software units to be implemented.', '{"software units","unit decomposition","design refinement","module design","component design"}'),
  ('iec_62304', '5.4.2', 'Develop Detailed Design for Each Software Unit', 'Develop a detailed design for each software unit.', '{"unit design","detailed design document","module specification","class design","interface detail"}'),
  ('iec_62304', '5.4.3', 'Develop Detailed Design for Interfaces', 'Develop detailed designs for each interface between software units and external components.', '{"interface specification","unit interface","API specification","function signatures","data interface"}'),
  ('iec_62304', '5.4.4', 'Verify Detailed Design', 'Verify that the detailed design correctly implements all software requirements and architecture.', '{"detailed design review","design verification","unit design review","design traceability"}'),
  ('iec_62304', '5.5', 'Software Unit Implementation and Verification', 'Implement and verify each software unit.', '{"software unit implementation","coding","unit testing","unit verification","code review","static analysis","implementation"}'),
  ('iec_62304', '5.5.1', 'Implement Each Software Unit', 'Implement each software unit in accordance with its detailed design.', '{"unit implementation","coding","source code","implementation","programming","development"}'),
  ('iec_62304', '5.5.2', 'Establish Software Unit Verification Process', 'Establish a process for verifying each software unit.', '{"unit verification","unit testing","test procedure","verification process","unit test plan"}'),
  ('iec_62304', '5.5.3', 'Software Unit Acceptance Criteria', 'Define acceptance criteria for each software unit to be verified.', '{"acceptance criteria","unit acceptance criteria","pass criteria","test acceptance","definition of done"}'),
  ('iec_62304', '5.5.4', 'Additional Software Unit Acceptance Criteria (Class B & C)', 'For Class B and C: include criteria for proper event sequence, memory bounds, error handling, algorithmic accuracy, and timing.', '{"Class B unit testing","Class C unit testing","boundary testing","error handling","memory bounds","timing requirements","algorithmic accuracy"}'),
  ('iec_62304', '5.5.5', 'Software Unit Verification', 'Verify that each software unit meets its acceptance criteria.', '{"unit test execution","unit test results","test pass","test report","unit test record","verification results"}'),
  ('iec_62304', '5.6', 'Software Integration and Integration Testing', 'Integrate the software units and software items, and perform integration testing.', '{"software integration","integration testing","integration test plan","integration test report","build","software assembly","integration test results"}'),
  ('iec_62304', '5.6.1', 'Integrate Software Units', 'Integrate software units following the integration plan.', '{"software integration","unit integration","build process","integration sequence","incremental integration"}'),
  ('iec_62304', '5.6.2', 'Verify Software Integration', 'Verify that each integrated software item implements all software requirements.', '{"integration verification","integration test execution","interface testing","integration test results","test evidence"}'),
  ('iec_62304', '5.6.3', 'Software Integration Testing', 'Perform integration testing to verify combined software items work together as designed.', '{"integration testing","system integration test","SIT","interface test","combined testing","test protocol"}'),
  ('iec_62304', '5.6.4', 'Software Integration Testing Content (Class B & C)', 'For Class B and C: test all software items against requirements, including error handling and boundary conditions.', '{"integration test content","boundary conditions","error conditions","interface boundaries","Class B integration","Class C integration"}'),
  ('iec_62304', '5.6.5', 'Evaluate Integration Test Procedures', 'Evaluate integration test procedures for correctness and completeness.', '{"test procedure review","test procedure evaluation","test completeness","test coverage"}'),
  ('iec_62304', '5.6.6', 'Conduct Regression Tests', 'Conduct regression testing when software items are changed.', '{"regression testing","regression test","retest","change impact testing","regression test suite"}'),
  ('iec_62304', '5.6.7', 'Use Software Problem Resolution Process', 'Use the software problem resolution process to resolve test failures.', '{"problem resolution","defect resolution","test failure","anomaly resolution","bug fix process"}'),
  ('iec_62304', '5.7', 'Software System Testing', 'Establish and perform tests for the software system to verify that all software requirements are met.', '{"system testing","software system test","system test plan","system test report","system verification","requirements testing","V&V"}'),
  ('iec_62304', '5.7.1', 'Establish System Test Procedures', 'Establish test procedures for the software system.', '{"system test procedures","test protocol","test script","acceptance testing","system test specification"}'),
  ('iec_62304', '5.7.2', 'Verify Completeness of System Tests', 'Verify that system test procedures address all software requirements.', '{"test completeness","requirements coverage","test traceability matrix","RTM","coverage analysis"}'),
  ('iec_62304', '5.7.3', 'Test for Anomalous Situations', 'Test for anomalous inputs and situations.', '{"boundary testing","negative testing","anomalous inputs","error conditions","robustness testing","stress testing"}'),
  ('iec_62304', '5.7.4', 'Conduct Software System Tests', 'Conduct the software system tests and record results.', '{"system test execution","test execution","test results","test evidence","test records","OQ","operational qualification"}'),
  ('iec_62304', '5.7.5', 'Evaluate System Test Procedures and Results', 'Evaluate test procedures and test results for completeness and correctness.', '{"test result evaluation","test review","test closure","test summary report","system test review"}'),
  ('iec_62304', '5.7.6', 'Conduct Regression Tests', 'Conduct regression tests as necessary following changes.', '{"regression testing","system regression","re-qualification","change impact","retest"}'),
  ('iec_62304', '5.8', 'Software Release', 'Create and document a software release of the software product.', '{"software release","release process","software version","release baseline","release documentation","release approval","software build record"}'),
  ('iec_62304', '5.8.1', 'Ensure Software Verification is Complete', 'Ensure all verification activities have been completed before release.', '{"verification complete","release readiness","release checklist","V&V complete","release criteria"}'),
  ('iec_62304', '5.8.2', 'Document Known Residual Anomalies', 'Document known residual anomalies in the released software.', '{"known anomalies","residual defects","known issues","open defects","anomaly list","software defect list"}'),
  ('iec_62304', '5.8.3', 'Evaluate Residual Anomalies', 'Evaluate whether residual anomalies affect safety.', '{"anomaly evaluation","residual risk","defect impact","safety impact assessment","risk acceptance"}'),
  ('iec_62304', '5.8.4', 'Document How Released Version is Identified', 'Document how the released software version is identified.', '{"version identification","software identification","release label","version number","software mark","UDI-DI"}'),
  ('iec_62304', '5.8.5', 'Ensure Relevant Activities are Complete', 'Ensure all activities required by the software development plan are complete.', '{"release completeness","plan compliance","release audit","software release record"}'),
  ('iec_62304', '5.8.6', 'Archive Released Software', 'Archive the released version of the software.', '{"software archive","release archive","source code archive","build archive","baseline archive","archiving"}'),
  ('iec_62304', '5.8.7', 'Assure Repeatability of Release', 'Ensure the release can be rebuilt exactly from archived source.', '{"reproducible build","build repeatability","source control","build environment","build instructions"}'),
  ('iec_62304', '5.8.8', 'Deliver Software', 'Deliver the software product for use in the medical device.', '{"software delivery","software release note","delivery record","installation","deployment","software installation instructions"}'),
  ('iec_62304', '6.1', 'Establish Software Maintenance Plan', 'Establish a plan for software maintenance activities.', '{"maintenance plan","software maintenance plan","maintenance procedure","maintenance activities","support plan"}'),
  ('iec_62304', '6.2', 'Problem and Modification Analysis', 'Analyse reported problems and modifications to determine their nature and impact.', '{"problem analysis","modification analysis","change analysis","impact analysis","defect analysis","change request"}'),
  ('iec_62304', '6.2.1', 'Monitor Feedback from Post-Production', 'Monitor feedback from users and post-production experience.', '{"post-production monitoring","post-market surveillance","user feedback","complaint monitoring","field issues"}'),
  ('iec_62304', '6.2.2', 'Document Feedback Requiring Action', 'Document feedback that could impact software safety or performance.', '{"feedback documentation","post-market feedback","user complaint","software complaint","anomaly report"}'),
  ('iec_62304', '6.2.3', 'Analyse Modification', 'Analyse software modifications to determine impact on the software system.', '{"modification analysis","change impact analysis","change classification","software change"}'),
  ('iec_62304', '6.2.4', 'Approve Modification', 'Approve modifications prior to implementation.', '{"modification approval","change approval","change control","ECO","software change request","CCB"}'),
  ('iec_62304', '6.2.5', 'Implementation of Modification', 'Implement approved modifications using the software development process.', '{"modification implementation","change implementation","code change","software update","patch"}'),
  ('iec_62304', '6.3', 'Modification Implementation', 'Implement modifications and re-verify according to the applicable software development process activities.', '{"modification implementation","software update","re-verification","regression testing","change verification"}'),
  ('iec_62304', '7.1', 'Analysis of Software Contributing to Hazardous Situations', 'Identify software items that could contribute to hazardous situations.', '{"software hazard analysis","hazardous situation","software contribution","hazard identification","FMEA","FTA","software failure mode"}'),
  ('iec_62304', '7.2', 'Risk Control Measures', 'Specify software risk control measures and verify their implementation.', '{"risk control","software risk control","mitigation","risk control measure","risk reduction","defensive programming","fault detection"}'),
  ('iec_62304', '7.3', 'Verify Risk Control Measures', 'Verify implementation of software risk control measures.', '{"risk control verification","risk control testing","safety testing","verification of risk controls","hazard mitigation testing"}'),
  ('iec_62304', '7.4', 'Risk Management of Software Changes', 'Evaluate and manage risks when software changes are made.', '{"change risk management","change impact on risk","software change risk","risk re-evaluation","change risk analysis"}'),
  ('iec_62304', '7.4.1', 'Analyse Changes to Software with Respect to Safety', 'Analyse software changes to determine if new hazards are introduced.', '{"change safety analysis","change hazard analysis","new hazards","safety impact of change","risk analysis update"}'),
  ('iec_62304', '7.4.2', 'Analyse Impact of Software Changes on Existing Risk Controls', 'Analyse the impact of software changes on existing risk control measures.', '{"risk control impact","change impact on safety","existing risk controls","risk control effectiveness"}'),
  ('iec_62304', '8.1', 'Configuration Identification', 'Identify the software configuration items that are to be placed under configuration control.', '{"configuration identification","configuration items","CI","software items under control","configuration baseline","version identification"}'),
  ('iec_62304', '8.1.1', 'Identify Configuration Items', 'Identify all software configuration items including source code, tools, test infrastructure, and documentation.', '{"configuration items","CI identification","version control","software baseline","documentation baseline"}'),
  ('iec_62304', '8.1.2', 'Identify SOUP', 'Identify all SOUP items that form part of the medical device software.', '{"SOUP identification","SOUP list","third-party components","OTS software list","open source","SOUP registry","software bill of materials"}'),
  ('iec_62304', '8.1.3', 'Identify System Configuration Documentation', 'Identify the documentation establishing the configuration of the system.', '{"system configuration documentation","configuration document","baseline document","system baseline"}'),
  ('iec_62304', '8.2', 'Change Control', 'Control changes to software configuration items.', '{"change control","change management","change request","change approval","CCB","configuration control board","software change control","ECR","ECO"}'),
  ('iec_62304', '8.2.1', 'Approve Requests for Changes', 'Approve requests for changes to software configuration items.', '{"change request","change approval","change board","CCB","change authorization"}'),
  ('iec_62304', '8.2.2', 'Implement Changes', 'Implement approved changes following a defined procedure.', '{"change implementation","software change","code change","configuration change","change procedure"}'),
  ('iec_62304', '8.2.3', 'Verify Changes', 'Verify that changes to configuration items have been implemented correctly.', '{"change verification","change testing","regression testing","verification of change"}'),
  ('iec_62304', '8.3', 'Configuration Status Accounting', 'Record and report status of configuration items.', '{"configuration status accounting","status reporting","configuration record","version tracking","release history"}'),
  ('iec_62304', '8.4', 'Configuration Evaluation', 'Perform configuration audits to verify that configuration items are complete, correct, and consistent.', '{"configuration audit","configuration evaluation","software audit","configuration review","baseline audit"}'),
  ('iec_62304', '9.1', 'Prepare Problem Reports', 'Prepare a problem report for each detected software problem.', '{"problem report","software anomaly report","defect report","bug report","anomaly","NCR","problem tracking"}'),
  ('iec_62304', '9.2', 'Investigate the Problem', 'Investigate the problem to determine its cause and effect on safety.', '{"problem investigation","root cause analysis","defect investigation","anomaly investigation","problem analysis","safety impact"}'),
  ('iec_62304', '9.3', 'Advise Relevant Parties', 'Advise relevant parties of the problem and its status.', '{"problem notification","stakeholder notification","problem communication","advisory"}'),
  ('iec_62304', '9.4', 'Use Change Control Process', 'Use the change control process to resolve the problem.', '{"change control","problem resolution","defect fix","corrective action","change request","problem closure"}'),
  ('iec_62304', '9.5', 'Verify Problem Resolution', 'Verify that the problem has been resolved.', '{"problem resolution verification","fix verification","defect closure","verification of fix","retesting","regression testing"}'),
  ('iec_62304', '9.6', 'Test Documentation', 'Test documentation and closure records for problem resolution.', '{"problem resolution record","closure record","resolution documentation","problem report closure"}'),
  ('iec_62304', '9.7', 'Analyse Problems for Trends', 'Analyse problem reports for trends to identify systemic issues.', '{"trend analysis","problem trend","defect trend","quality metrics","defect density","software quality"}'),
  ('iec_62304', '9.8', 'Verify No Adverse Trends', 'Verify that problem trends do not indicate unacceptable risk.', '{"adverse trend","trend monitoring","quality indicator","risk threshold","safety trend"}')
on conflict (standard_id, section_id) do nothing;

-- predefined_questions
insert into predefined_questions (standard_id, question_text, hint_short, tags, category, sort_order) values
  ('iso_27001', 'What are the key Annex A controls missing from our documentation?', 'Missing Controls', '{"controls","gap","compliance"}', 'Gap Analysis', 1),
  ('iso_27001', 'Identify gaps between our current state and ISMS requirements.', 'ISMS Gaps', '{"gap","compliance","readiness"}', 'Gap Analysis', 2),
  ('iso_27001', 'Which controls lack evidence of implementation?', 'Missing Evidence', '{"evidence","audit","gap"}', 'Audit Prep', 3),
  ('iso_27001', 'What''s our status against ISO 27001:2022 clauses?', 'Compliance Status', '{"status","compliance","clauses"}', 'Audit Prep', 4),
  ('iso_27001', 'List all access control risks not yet mitigated.', 'Access Control Risks', '{"risk","access","mitigation"}', 'Risk Management', 5),
  ('iso_27001', 'Which personnel lack required security awareness training?', 'Training Gaps', '{"training","awareness","personnel","gap"}', 'People & Culture', 6),
  ('iso_27001', 'Are our incident response procedures documented and tested?', 'Incident Response', '{"incident","response","procedure","testing"}', 'Incident Management', 7),
  ('iso_27001', 'What cryptography controls are not yet implemented?', 'Cryptography Gaps', '{"cryptography","encryption","gap"}', 'Technical Controls', 8),
  ('iso_27001', 'Identify third-party vendors without security agreements.', 'Vendor Security', '{"vendor","supplier","agreement","gap"}', 'Supplier Management', 9),
  ('iso_27001', 'Which asset inventories are incomplete or outdated?', 'Asset Inventory', '{"asset","inventory","gap"}', 'Asset Management', 10),
  ('iso_27001', 'Are physical access controls adequate for all facilities?', 'Physical Security', '{"physical","access","facilities","controls"}', 'Physical Security', 11),
  ('iso_27001', 'What network security controls need strengthening?', 'Network Security', '{"network","security","controls"}', 'Technical Controls', 12),
  ('iso_27001', 'Do all data classification labels match our policy?', 'Data Classification', '{"data","classification","labels"}', 'Data Management', 13),
  ('iso_27001', 'List roles and responsibilities not yet assigned.', 'Role Assignment', '{"roles","responsibilities","gap"}', 'Organization', 14),
  ('iso_27001', 'Which business continuity plans lack testing evidence?', 'BC/DR Testing', '{"continuity","disaster","recovery","testing"}', 'Continuity', 15),
  ('iso_27001', 'Are change management procedures followed for all system changes?', 'Change Management', '{"change","management","procedure","controls"}', 'Operations', 16),
  ('iso_27001', 'Identify unpatched systems and outdated software.', 'Patch Management', '{"patch","update","vulnerability","gap"}', 'Technical Controls', 17),
  ('iso_27001', 'What monitoring and logging gaps exist in our environment?', 'Monitoring Gaps', '{"monitoring","logging","gap","controls"}', 'Operations', 18),
  ('iso_27001', 'Are all security policies current and communicated?', 'Policy Currency', '{"policy","current","communication"}', 'Governance', 19),
  ('iso_27001', 'Which exceptions to information security policy are unauthorized?', 'Policy Exceptions', '{"exception","policy","variance","authorization"}', 'Governance', 20),
  ('iso_13485', 'What design control activities are incomplete?', 'Design Controls', '{"design","gap","activity"}', 'Design Controls', 1),
  ('iso_13485', 'Identify requirements without linked test cases.', 'Unlinked Reqs', '{"requirement","test","traceability","gap"}', 'Traceability', 2),
  ('iso_13485', 'Which risks lack documented mitigation plans?', 'Risk Mitigation Gaps', '{"risk","mitigation","gap"}', 'Risk Management', 3),
  ('iso_13485', 'Are there NCRs without linked CAPAs?', 'NCR CAPA Gaps', '{"ncr","capa","traceability"}', 'Quality', 4),
  ('iso_13485', 'Check traceability gaps in our product.', 'Traceability Check', '{"traceability","gap","product"}', 'Traceability', 5),
  ('iso_13485', 'Which suppliers lack current quality agreements?', 'Supplier Agreements', '{"supplier","agreement","quality","gap"}', 'Supplier Management', 6),
  ('iso_13485', 'Are design changes properly documented and approved?', 'Design Changes', '{"design","change","control","documentation"}', 'Design Controls', 7),
  ('iso_13485', 'What production process validation records are missing?', 'Process Validation', '{"process","validation","production","gap"}', 'Production', 8),
  ('iso_13485', 'Identify product batches lacking proper traceability records.', 'Batch Traceability', '{"batch","traceability","records","gap"}', 'Traceability', 9),
  ('iso_13485', 'Which field actions lack proper effectiveness checks?', 'Field Actions', '{"field","action","effectiveness","gap"}', 'Post-Market', 10),
  ('iso_13485', 'Are all inspection and test records complete and retained?', 'Inspection Records', '{"inspection","test","records","retention"}', 'Quality', 11),
  ('iso_13485', 'What management review meeting records are overdue?', 'Management Review', '{"management","review","meeting","records"}', 'Management', 12),
  ('iso_13485', 'Identify non-conformances without root cause analysis.', 'Root Cause Gaps', '{"non-conformance","root-cause","analysis","gap"}', 'Quality', 13),
  ('iso_13485', 'Are complaint handling procedures adequately documented?', 'Complaint Handling', '{"complaint","procedure","documentation","controls"}', 'Post-Market', 14),
  ('iso_13485', 'Which product labeling or instructions lack approval records?', 'Labeling Controls', '{"label","instruction","approval","records"}', 'Design Controls', 15),
  ('iso_13485', 'List internal audits not yet completed this year.', 'Internal Audits', '{"audit","internal","schedule","overdue"}', 'Quality', 16),
  ('iso_13485', 'Are post-market surveillance activities documented and current?', 'PMS Documentation', '{"surveillance","post-market","documentation"}', 'Post-Market', 17),
  ('iso_13485', 'What sterilization or preservation validations are pending?', 'Sterilization Valid', '{"sterilization","preservation","validation","pending"}', 'Production', 18),
  ('iso_13485', 'Identify customer feedback not yet triaged or actioned.', 'Customer Feedback', '{"customer","feedback","triage","action"}', 'Post-Market', 19),
  ('iso_13485', 'Are management responsibility and accountability clearly defined?', 'Responsibility Matrix', '{"responsibility","accountability","organization","roles"}', 'Management', 20),
  ('iec_62304', 'What residual risks exceed acceptable thresholds?', 'Residual Risk', '{"risk","threshold","mitigation","residual"}', 'Risk Management', 1),
  ('iec_62304', 'List hazards without documented mitigations.', 'Unmitigated Hazards', '{"hazard","mitigation","gap"}', 'Risk Management', 2),
  ('iec_62304', 'Which risk controls lack verification evidence?', 'Risk Control Evidence', '{"risk","control","evidence","audit"}', 'Audit Prep', 3),
  ('iec_62304', 'Identify post-market surveillance gaps.', 'PMS Gaps', '{"surveillance","gap","post-market"}', 'Post-Market', 4),
  ('iec_62304', 'Are all foreseeable use cases covered by risk analysis?', 'Use Case Coverage', '{"use-case","risk","analysis"}', 'Risk Management', 5),
  ('iec_62304', 'What software requirements lack traceability to design?', 'Requirements Traceability', '{"requirement","traceability","design","gap"}', 'Traceability', 6),
  ('iec_62304', 'Which safety functions lack adequate verification testing?', 'Safety Function Testing', '{"safety","function","verification","testing"}', 'Verification', 7),
  ('iec_62304', 'Are all software integration test cases documented?', 'Integration Testing', '{"integration","test","documentation"}', 'Verification', 8),
  ('iec_62304', 'Identify unresolved software verification anomalies.', 'Verification Anomalies', '{"anomaly","verification","unresolved","gap"}', 'Verification', 9),
  ('iec_62304', 'What documented evidence supports our software safety class?', 'Safety Class Evidence', '{"safety","class","evidence","documentation"}', 'Documentation', 10),
  ('iec_62304', 'Are release notes and software version records current?', 'Release Documentation', '{"release","version","documentation","notes"}', 'Documentation', 11),
  ('iec_62304', 'List configuration management procedures lacking implementation detail.', 'Configuration Mgmt', '{"configuration","management","procedure","gap"}', 'Configuration', 12),
  ('iec_62304', 'Which security vulnerabilities have not been assessed?', 'Security Assessment', '{"security","vulnerability","assessment","gap"}', 'Security', 13),
  ('iec_62304', 'Are all problem resolution records linked to root cause?', 'Problem Resolution', '{"problem","resolution","root-cause","traceability"}', 'Quality', 14),
  ('iec_62304', 'What software maintenance procedures need documented evidence?', 'Maintenance Evidence', '{"maintenance","procedure","documentation","evidence"}', 'Maintenance', 15),
  ('iec_62304', 'Identify code review records lacking for critical modules.', 'Code Review Records', '{"code","review","records","critical"}', 'Development', 16),
  ('iec_62304', 'Are off-the-shelf software components properly evaluated and documented?', 'COTS Evaluation', '{"cots","component","evaluation","documentation"}', 'Procurement', 17),
  ('iec_62304', 'Which software change requests lack traceability to test results?', 'Change Traceability', '{"change","request","traceability","testing"}', 'Traceability', 18),
  ('iec_62304', 'List user documentation gaps affecting device operation or safety.', 'User Documentation', '{"documentation","user","operation","safety"}', 'Documentation', 19),
  ('iec_62304', 'Are all deviations from development standards documented and approved?', 'Development Deviations', '{"deviation","standard","development","approval"}', 'Development', 20)
on conflict (standard_id, question_text) do nothing;

-- rag_settings
insert into rag_settings (key, value, description, data_type, min_value, max_value, tooltip, category) values
  ('similarity_threshold', '0.2', 'Minimum similarity score (0-1) for vector search matches', 'float', 0, 1, 'Lower = more results but lower quality. Higher = fewer but higher quality results. Typical range: 0.15-0.35', 'Search'),
  ('top_k_chunks', '20', 'Number of document chunks to retrieve per query', 'int', 1, 20, 'More chunks = longer context but more token usage and cost. Default: 5', 'Search'),
  ('chunk_size', '1000', 'Characters per chunk when splitting documents', 'int', 100, 5000, 'Smaller chunks = more granular but more total chunks. Larger chunks = fewer chunks but less precise. Default: 1000', 'Indexing'),
  ('chunk_overlap', '199', 'Character overlap between adjacent chunks', 'int', 0, 1000, 'Helps preserve context across chunk boundaries. Typically 10-20% of chunk_size. Default: 200', 'Indexing'),
  ('embedding_model', 'text-embedding-3-small', 'OpenAI embedding model to use', 'text', null, null, 'Options: text-embedding-3-small (cheap, fast), text-embedding-3-large (expensive, better quality)', 'Models'),
  ('chat_model', 'gpt-4o', 'OpenAI chat model for generating answers', 'text', null, null, 'Options: gpt-4o (best quality), gpt-4-turbo (cheaper), gpt-3.5-turbo (cheapest)', 'Models'),
  ('router_temperature', '0.1', 'Temperature for query classification (0-1)', 'float', 0, 1, 'Lower = more deterministic routing. Higher = more creative. Default: 0.1 (very strict)', 'Router'),
  ('answer_temperature', '0.29', 'Temperature for answer generation (0-1)', 'float', 0, 1, 'Lower = more factual. Higher = more creative. Default: 0.3 (mostly factual)', 'Answer'),
  ('enable_debug_logging', 'true', 'Show detailed debug logs in console', 'text', null, null, 'true or false. Helps diagnose issues but adds overhead', 'Debug'),
  ('fuzzy_match_threshold', '0.5', 'Document name fuzzy matching threshold', 'float', 0, 1, 'Used when router extracts document names that don''t exactly match DB. Default: 0.50', 'Router'),
  ('doc_search_threshold', '0.4', 'Trigram word similarity threshold for document search (0.0-1.0). Higher = stricter matching.', 'float', null, null, null, 'Search'),
  ('clarify_confidence_threshold', '0.8', 'Router confidence below this triggers clarifying questions for aggregation/theme_analysis queries.', 'float', null, null, 'Clarify Confidence Threshold', 'Routing')
on conflict (key) do nothing;
