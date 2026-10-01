-- ═════════════════════════════════════════════════════════════════════════════
-- bootstrap_new_account.sql — GENERATED, do not edit by hand.
--
-- Snapshot of the schema-master account 'orca60' (Supabase eoxpzwmowzbrwpufpzir), taken
-- 2026-10-01T02:22:11.871Z by scripts/snapshot-bootstrap.mjs.
-- At migration: 041_standard_section_metadata.sql (35 rows in schema_migrations).
--
-- Run once by provisioning (lib/provisioning.ts → running_schema) against a brand
-- new tenant project through the Management API. Idempotent: every object is
-- if-not-exists / or-replace and every row is on-conflict-do-nothing, so a resumed
-- job can run it again.
--
-- To change the per-account schema: add a numbered migration in Orcanos QMS
-- design/sql/, apply it (scripts/run_missing_migrations.py), then regenerate this.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── Extensions ──────────────────────────────────────────────────────────────

create extension if not exists pg_trgm with schema public;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists vector with schema public;

-- ─── Sequences ───────────────────────────────────────────────────────────────

create sequence if not exists public.account_section_keywords_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.action_item_proposals_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.agent_run_messages_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.agent_tool_cache_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.audit_mdsap_findings_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.capa_proposal_action_items_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.conversation_messages_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.conversations_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.doc_chunks_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.documents_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.dossier_510k_checklist_items_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.dossier_510k_documents_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.dossier_510k_references_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.dossier_mdsap_checklist_items_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.dossier_mdsap_documents_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.predefined_questions_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.rag_settings_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.repositories_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.repository_imports_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.repository_members_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.repository_section_keywords_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.repository_trace_patterns_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.sop_rule_sections_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.sop_rules_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.standard_sections_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.submission_510k_fda_comments_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.upload_logs_id_seq as bigint start with 1 increment by 1;
create sequence if not exists public.usage_logs_id_seq as bigint start with 1 increment by 1;

-- ─── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.account_section_keywords (
  id bigint default nextval('account_section_keywords_id_seq'::regclass) not null,
  section_id bigint not null,
  keywords text[] default '{}'::text[] not null,
  updated_at timestamp with time zone default now(),
  constraint account_section_keywords_pkey PRIMARY KEY (id),
  constraint account_section_keywords_section_id_key UNIQUE (section_id)
);
create table if not exists public.account_skills (
  id uuid default gen_random_uuid() not null,
  skill_id text not null,
  name text not null,
  description text,
  system_prompt text not null,
  author text,
  version text,
  standard text,
  industry text,
  role text,
  tags text[] default '{}'::text[],
  verified boolean default false,
  is_local boolean default true,
  source_url text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint account_skills_pkey PRIMARY KEY (id),
  constraint account_skills_skill_id_key UNIQUE (skill_id)
);
create table if not exists public.action_item_proposals (
  id bigint default nextval('action_item_proposals_id_seq'::regclass) not null,
  run_id uuid,
  agent_id uuid not null,
  source jsonb default '{}'::jsonb not null,
  project_input text,
  project_id bigint,
  project_name text,
  version_input text,
  version_id bigint,
  version_label text,
  item_type_input text not null,
  item_type_code text,
  name text not null,
  description text,
  assigned_to text,
  status text default 'pending'::text not null,
  rejected_reason text,
  created_item_key text,
  created_item_url text,
  confirmed_by bigint,
  confirmed_at timestamp with time zone,
  updated_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  constraint action_item_proposals_pkey PRIMARY KEY (id)
);
create table if not exists public.agent_definitions (
  id uuid default gen_random_uuid() not null,
  agent_key text not null,
  name text not null,
  description text,
  icon text default '🤖'::text,
  instructions text default ''::text not null,
  enabled_tools text[] default '{}'::text[] not null,
  data_sources bigint[] default '{}'::bigint[] not null,
  enabled_skills text[] default '{}'::text[] not null,
  engine text,
  model text,
  status text default 'draft'::text not null,
  cloned_from uuid,
  cloned_from_name text,
  cloned_at timestamp with time zone,
  is_customized boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  created_by bigint,
  updated_by bigint,
  default_item_type text,
  default_project_id bigint,
  default_version_id bigint,
  job_title text,
  category text default 'general'::text not null,
  avatar_seed text,
  memory_enabled boolean default true not null,
  personality text default 'professional'::text not null,
  requires_source_input boolean default false not null,
  chat_only boolean default false not null,
  include_company_profile boolean default true not null,
  callable_agents text[] default '{}'::text[] not null,
  agent_type text default 'chat'::text not null,
  trigger_config jsonb default '{}'::jsonb not null,
  trigger_state jsonb default '{}'::jsonb not null,
  approval_mode text default 'review'::text not null,
  constraint agent_definitions_pkey PRIMARY KEY (id),
  constraint agent_definitions_agent_key_key UNIQUE (agent_key)
);
create table if not exists public.agent_memories (
  id uuid default gen_random_uuid() not null,
  agent_id uuid not null,
  content text not null,
  source text default 'manual'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  created_by bigint,
  updated_by bigint,
  constraint agent_memories_pkey PRIMARY KEY (id)
);
create table if not exists public.agent_run_messages (
  id bigint default nextval('agent_run_messages_id_seq'::regclass) not null,
  run_id uuid not null,
  role text not null,
  content text not null,
  usage jsonb,
  created_at timestamp with time zone default now() not null,
  data jsonb,
  constraint agent_run_messages_pkey PRIMARY KEY (id)
);
create table if not exists public.agent_runs (
  id uuid default gen_random_uuid() not null,
  agent_id uuid not null,
  agent_key text not null,
  agent_name text not null,
  status text default 'running'::text not null,
  input text not null,
  orcanos_target jsonb,
  data_sources bigint[] default '{}'::bigint[] not null,
  llm_engine text,
  tool_protocol text,
  summary text,
  findings jsonb,
  sources jsonb,
  eform jsonb,
  trace jsonb default '[]'::jsonb not null,
  truncated boolean default false not null,
  error text,
  run_stats jsonb,
  usage_logged boolean default false not null,
  started_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone,
  created_by bigint,
  parent_run_id uuid,
  constraint agent_runs_pkey PRIMARY KEY (id)
);
create table if not exists public.agent_tool_cache (
  id bigint default nextval('agent_tool_cache_id_seq'::regclass) not null,
  agent_id uuid not null,
  source_type text not null,
  source_key text not null,
  content_hash text not null,
  cached_result jsonb not null,
  cached_at timestamp with time zone default now() not null,
  last_hit_at timestamp with time zone,
  hit_count integer default 0 not null,
  constraint agent_tool_cache_pkey PRIMARY KEY (id),
  constraint agent_tool_cache_agent_id_source_type_source_key_key UNIQUE (agent_id, source_type, source_key)
);
create table if not exists public.audit_cycles_mdsap (
  id uuid default gen_random_uuid() not null,
  dossier_id uuid not null,
  cycle_key text not null,
  cycle_type text default 'initial'::text not null,
  stage text,
  auditing_organization text,
  audit_date date,
  closed_on date,
  status text default 'preparing'::text not null,
  notes text,
  snapshot jsonb,
  created_by bigint,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint audit_cycles_mdsap_pkey PRIMARY KEY (id)
);
create table if not exists public.audit_mdsap_findings (
  id bigint default nextval('audit_mdsap_findings_id_seq'::regclass) not null,
  cycle_id uuid not null,
  process_area text,
  grading text,
  description text not null,
  corrective_action text,
  status text default 'open'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint audit_mdsap_findings_pkey PRIMARY KEY (id)
);
create table if not exists public.automation_jobs (
  id uuid default gen_random_uuid() not null,
  agent_id uuid not null,
  interval_value integer default 5 not null,
  interval_unit text default 'minutes'::text not null,
  state text default 'paused'::text not null,
  next_run_at timestamp with time zone,
  last_run_at timestamp with time zone,
  last_run_status text,
  last_run_error text,
  last_run_matched integer,
  consecutive_failures integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  created_by bigint,
  updated_by bigint,
  constraint automation_jobs_pkey PRIMARY KEY (id)
);
create table if not exists public.capa_proposal_action_items (
  id bigint default nextval('capa_proposal_action_items_id_seq'::regclass) not null,
  proposal_id uuid not null,
  description text not null,
  owner_hint text,
  created_capa_action_key text,
  created_at timestamp with time zone default now() not null,
  title text,
  action_type text,
  priority text,
  constraint capa_proposal_action_items_pkey PRIMARY KEY (id)
);
create table if not exists public.capa_proposals (
  id uuid default gen_random_uuid() not null,
  run_id uuid,
  agent_id uuid not null,
  subject_item_key text,
  source jsonb default '{}'::jsonb not null,
  title text not null,
  description text,
  root_cause text,
  severity text,
  sop_basis text,
  status text default 'pending'::text not null,
  rejected_reason text,
  created_capa_key text,
  confirmed_by bigint,
  confirmed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  created_capa_url text,
  constraint capa_proposals_pkey PRIMARY KEY (id)
);
create table if not exists public.conversation_messages (
  id bigint default nextval('conversation_messages_id_seq'::regclass) not null,
  conversation_id bigint not null,
  message_id bigint not null,
  type text not null,
  content text,
  answer text,
  sources jsonb,
  chunks_searched integer,
  usage jsonb,
  timestamp text not null,
  feedback text,
  router_debug jsonb default '{}'::jsonb,
  repository_id bigint,
  created_at timestamp with time zone default now(),
  file_content text,
  constraint conversation_messages_pkey PRIMARY KEY (id)
);
create table if not exists public.conversations (
  id bigint default nextval('conversations_id_seq'::regclass) not null,
  title text default 'New Conversation'::text not null,
  timestamp text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  repository_id bigint,
  user_id bigint,
  constraint conversations_pkey PRIMARY KEY (id)
);
create table if not exists public.doc_chunks (
  id bigint default nextval('doc_chunks_id_seq'::regclass) not null,
  doc_name text not null,
  chunk_index integer not null,
  chunk_type text default 'section'::text not null,
  text text not null,
  vector vector(1536),
  metadata jsonb default '{}'::jsonb,
  doc_id bigint,
  fts tsvector generated always as (to_tsvector('english'::regconfig, text)) stored,
  repository_id bigint,
  created_at timestamp with time zone default now(),
  record_id text,
  traced_items text[] default '{}'::text[],
  preserve_formatting boolean default false,
  score double precision default 0,
  content_hash text,
  constraint doc_chunks_pkey PRIMARY KEY (id)
);
create table if not exists public.document_diff_analyses (
  id uuid default gen_random_uuid() not null,
  repository_id integer not null,
  from_doc_name text not null,
  to_doc_name text not null,
  analysis text not null,
  model text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  constraint document_diff_analyses_pkey PRIMARY KEY (id),
  constraint document_diff_analyses_repository_id_from_doc_name_to_doc_n_key UNIQUE (repository_id, from_doc_name, to_doc_name)
);
create table if not exists public.documents (
  id bigint default nextval('documents_id_seq'::regclass) not null,
  doc_name text not null,
  file_path text not null,
  summary text,
  chunk_count integer default 0,
  name_vector vector(1536),
  indexed_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  repository_id bigint,
  owner_id bigint,
  doc_metadata jsonb,
  doc_structure text default 'sections'::text,
  id_column_name text,
  chunking_strategy text default 'semantic'::text,
  file_content bytea,
  file_hash text,
  uploaded_at timestamp with time zone default now(),
  control_type text,
  parent_id bigint,
  base_name text,
  import_id bigint,
  constraint documents_pkey PRIMARY KEY (id),
  constraint documents_doc_name_repository_id_key UNIQUE (doc_name, repository_id)
);
create table if not exists public.dossier_510k_checklist_items (
  id bigint default nextval('dossier_510k_checklist_items_id_seq'::regclass) not null,
  dossier_id uuid not null,
  item_key text not null,
  section text not null,
  label text not null,
  status text default 'missing'::text not null,
  evidence_note text,
  document_id bigint,
  sort_order integer default 0 not null,
  updated_at timestamp with time zone default now() not null,
  category text default 'submission'::text not null,
  constraint dossier_510k_checklist_items_pkey PRIMARY KEY (id)
);
create table if not exists public.dossier_510k_documents (
  id bigint default nextval('dossier_510k_documents_id_seq'::regclass) not null,
  dossier_id uuid not null,
  name text not null,
  doc_type text,
  status text default 'draft'::text not null,
  origin text default 'manual'::text not null,
  repository_id bigint,
  source_doc_name text,
  content text,
  draft_kind text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  category text default 'submission'::text not null,
  source_meta jsonb default '{}'::jsonb not null,
  constraint dossier_510k_documents_pkey PRIMARY KEY (id)
);
create table if not exists public.dossier_510k_references (
  id bigint default nextval('dossier_510k_references_id_seq'::regclass) not null,
  dossier_id uuid not null,
  k_number text not null,
  device_name text,
  applicant text,
  product_code text,
  decision_date date,
  decision text,
  use_as_reference boolean default true not null,
  predicate_candidate boolean default false not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  constraint dossier_510k_references_pkey PRIMARY KEY (id)
);
create table if not exists public.dossier_mdsap_checklist_items (
  id bigint default nextval('dossier_mdsap_checklist_items_id_seq'::regclass) not null,
  dossier_id uuid not null,
  item_key text not null,
  section text not null,
  label text not null,
  status text default 'missing'::text not null,
  evidence_note text,
  document_id bigint,
  sort_order integer default 0 not null,
  updated_at timestamp with time zone default now() not null,
  constraint dossier_mdsap_checklist_items_pkey PRIMARY KEY (id)
);
create table if not exists public.dossier_mdsap_documents (
  id bigint default nextval('dossier_mdsap_documents_id_seq'::regclass) not null,
  dossier_id uuid not null,
  name text not null,
  doc_type text,
  status text default 'draft'::text not null,
  origin text default 'manual'::text not null,
  repository_id bigint,
  source_doc_name text,
  content text,
  draft_kind text,
  source_meta jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  data_incomplete boolean default false not null,
  data_gaps jsonb default '[]'::jsonb not null,
  constraint dossier_mdsap_documents_pkey PRIMARY KEY (id)
);
create table if not exists public.dossiers_510k (
  id uuid default gen_random_uuid() not null,
  device_name text not null,
  device_code text,
  variants text,
  risk_class text,
  device_type text,
  data_source jsonb default '{}'::jsonb not null,
  setup_state jsonb default '{}'::jsonb not null,
  facts jsonb default '{}'::jsonb not null,
  created_by bigint,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint dossiers_510k_pkey PRIMARY KEY (id)
);
create table if not exists public.dossiers_mdsap (
  id uuid default gen_random_uuid() not null,
  site_name text not null,
  site_code text,
  jurisdictions jsonb default '[]'::jsonb not null,
  devices_in_scope text,
  data_source jsonb default '{}'::jsonb not null,
  setup_state jsonb default '{}'::jsonb not null,
  facts jsonb default '{}'::jsonb not null,
  created_by bigint,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint dossiers_mdsap_pkey PRIMARY KEY (id)
);
create table if not exists public.item_field_update_proposals (
  id uuid default gen_random_uuid() not null,
  run_id uuid,
  agent_id uuid not null,
  item_key text not null,
  item_type text not null,
  field_title text not null,
  field_ws_col_name text not null,
  current_value text,
  proposed_value text not null,
  reason text,
  status text default 'pending'::text not null,
  rejected_reason text,
  confirmed_by bigint,
  confirmed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  constraint item_field_update_proposals_pkey PRIMARY KEY (id)
);
create table if not exists public.predefined_questions (
  id bigint default nextval('predefined_questions_id_seq'::regclass) not null,
  standard_id text not null,
  question_text text not null,
  hint_short text,
  tags text[] default '{}'::text[],
  category text,
  sort_order integer default 0,
  created_at timestamp with time zone default now(),
  constraint predefined_questions_pkey PRIMARY KEY (id),
  constraint predefined_questions_standard_id_question_text_key UNIQUE (standard_id, question_text)
);
create table if not exists public.rag_settings (
  id bigint default nextval('rag_settings_id_seq'::regclass) not null,
  key character varying not null,
  value text not null,
  description text,
  data_type character varying,
  min_value double precision,
  max_value double precision,
  tooltip text,
  category character varying,
  created_at timestamp without time zone default now(),
  updated_at timestamp without time zone default now(),
  constraint rag_settings_pkey PRIMARY KEY (id),
  constraint rag_settings_key_key UNIQUE (key)
);
create table if not exists public.repositories (
  id bigint default nextval('repositories_id_seq'::regclass) not null,
  name text not null,
  owner_id bigint not null,
  storage_type text default 'gdrive'::text not null,
  storage_url text not null,
  standard_id text,
  ai_instructions text,
  company_details text,
  scoring_config jsonb,
  scoring_running boolean default false,
  scoring_last_run_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  rules_extraction_running boolean default false,
  rules_extraction_last_run_at timestamp with time zone,
  is_public boolean default false not null,
  constraint repositories_pkey PRIMARY KEY (id)
);
create table if not exists public.repository_imports (
  id bigint default nextval('repository_imports_id_seq'::regclass) not null,
  repository_id bigint not null,
  source_type text not null,
  source_config jsonb default '{}'::jsonb not null,
  is_active boolean default true not null,
  indexing_status text default 'idle'::text not null,
  indexing_started_at timestamp with time zone,
  last_indexed_at timestamp with time zone,
  document_count integer default 0,
  last_error text,
  last_warning text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  progress_total integer default 0,
  recent_errors jsonb default '[]'::jsonb,
  constraint repository_imports_pkey PRIMARY KEY (id)
);
create table if not exists public.repository_members (
  id bigint default nextval('repository_members_id_seq'::regclass) not null,
  repository_id bigint not null,
  user_id bigint not null,
  permission text default 'viewer'::text not null,
  invited_at timestamp with time zone default now(),
  constraint repository_members_pkey PRIMARY KEY (id),
  constraint repository_members_repository_id_user_id_key UNIQUE (repository_id, user_id)
);
create table if not exists public.repository_section_keywords (
  id bigint default nextval('repository_section_keywords_id_seq'::regclass) not null,
  repository_id bigint not null,
  section_id bigint not null,
  keywords text[] default '{}'::text[] not null,
  updated_at timestamp with time zone default now(),
  constraint repository_section_keywords_pkey PRIMARY KEY (id),
  constraint repository_section_keywords_repository_id_section_id_key UNIQUE (repository_id, section_id)
);
create table if not exists public.repository_skills (
  id uuid default gen_random_uuid() not null,
  repository_id bigint not null,
  skill_id text not null,
  name text not null,
  description text,
  system_prompt text not null,
  author text,
  version text,
  standard text,
  industry text,
  role text,
  tags text[] default '{}'::text[],
  verified boolean default false,
  is_local boolean default true,
  source_url text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint repository_skills_pkey PRIMARY KEY (id),
  constraint repository_skills_repository_id_skill_id_key UNIQUE (repository_id, skill_id)
);
create table if not exists public.repository_trace_patterns (
  id bigint default nextval('repository_trace_patterns_id_seq'::regclass) not null,
  repository_id bigint not null,
  pattern text not null,
  description text,
  enabled boolean default true,
  created_at timestamp with time zone default now(),
  constraint repository_trace_patterns_pkey PRIMARY KEY (id),
  constraint repository_trace_patterns_repository_id_pattern_key UNIQUE (repository_id, pattern)
);
create table if not exists public.schema_migrations (
  filename text not null,
  applied_at timestamp with time zone default now() not null,
  constraint schema_migrations_pkey PRIMARY KEY (filename)
);
create table if not exists public.settings_510k (
  id integer default 1 not null,
  fda_identifiers jsonb default '{}'::jsonb not null,
  default_repository_ids jsonb default '[]'::jsonb not null,
  checklist_template jsonb,
  openfda_enabled boolean default false not null,
  updated_by bigint,
  updated_at timestamp with time zone default now() not null,
  doc_skill_overrides jsonb default '{}'::jsonb not null,
  dhf_template jsonb,
  device_categories jsonb,
  constraint settings_510k_id_check1 CHECK ((id = 1)),
  constraint settings_510k_pkey1 PRIMARY KEY (id)
);
create table if not exists public.settings_mdsap (
  id integer default 1 not null,
  default_repository_ids jsonb default '[]'::jsonb not null,
  checklist_template jsonb,
  jurisdictions_enabled jsonb,
  doc_skill_overrides jsonb default '{}'::jsonb not null,
  updated_by bigint,
  updated_at timestamp with time zone default now() not null,
  constraint settings_mdsap_id_check CHECK ((id = 1)),
  constraint settings_mdsap_pkey PRIMARY KEY (id)
);
create table if not exists public.sop_rule_sections (
  id bigint default nextval('sop_rule_sections_id_seq'::regclass) not null,
  rule_id bigint not null,
  section_id bigint not null,
  match_status text not null,
  ai_comment text,
  section_hash text,
  created_at timestamp with time zone default now(),
  constraint sop_rule_sections_match_status_check CHECK ((match_status = ANY (ARRAY['match'::text, 'partial'::text, 'gap'::text]))),
  constraint sop_rule_sections_pkey PRIMARY KEY (id),
  constraint sop_rule_sections_rule_id_section_id_key UNIQUE (rule_id, section_id)
);
create table if not exists public.sop_rules (
  id bigint default nextval('sop_rules_id_seq'::regclass) not null,
  repository_id bigint not null,
  chunk_id bigint not null,
  chunk_hash text not null,
  rule_text text not null,
  process_hint text,
  created_at timestamp with time zone default now(),
  constraint sop_rules_pkey PRIMARY KEY (id)
);
create table if not exists public.standard_sections (
  id bigint default nextval('standard_sections_id_seq'::regclass) not null,
  standard_id text not null,
  section_id text not null,
  title text not null,
  description text,
  default_keywords text[] default '{}'::text[],
  created_at timestamp with time zone default now(),
  metadata jsonb default '{}'::jsonb not null,
  constraint standard_sections_pkey PRIMARY KEY (id),
  constraint standard_sections_standard_id_section_id_key UNIQUE (standard_id, section_id)
);
create table if not exists public.standards (
  id text not null,
  name text not null,
  default_ai_instructions text not null,
  constraint standards_pkey PRIMARY KEY (id)
);
create table if not exists public.submission_510k_fda_comments (
  id bigint default nextval('submission_510k_fda_comments_id_seq'::regclass) not null,
  submission_id uuid not null,
  comment text not null,
  response text,
  status text default 'open'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint submission_510k_fda_comments_pkey PRIMARY KEY (id)
);
create table if not exists public.submissions_510k (
  id uuid default gen_random_uuid() not null,
  dossier_id uuid not null,
  submission_key text not null,
  submission_type text default 'initial'::text not null,
  pathway text,
  target_date date,
  sent_on date,
  k_number text,
  fda_status text default 'preparing'::text not null,
  notes text,
  snapshot jsonb,
  created_by bigint,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint submissions_510k_pkey1 PRIMARY KEY (id)
);
create table if not exists public.upload_logs (
  id bigint default nextval('upload_logs_id_seq'::regclass) not null,
  repository_id bigint not null,
  upload_id text not null,
  file_name text not null,
  file_hash text,
  status text not null,
  reason text,
  file_size bigint,
  uploaded_at timestamp with time zone default now(),
  created_at timestamp with time zone default now(),
  constraint upload_logs_pkey PRIMARY KEY (id)
);
create table if not exists public.usage_logs (
  id bigint default nextval('usage_logs_id_seq'::regclass) not null,
  repository_id bigint,
  repository_name text,
  action text not null,
  conversation_name text,
  tokens integer,
  cost_usd numeric,
  user_id bigint,
  created_at timestamp with time zone default now(),
  constraint usage_logs_pkey PRIMARY KEY (id)
);

-- ─── Sequence ownership ──────────────────────────────────────────────────────

alter sequence public.account_section_keywords_id_seq owned by public.account_section_keywords.id;
alter sequence public.action_item_proposals_id_seq owned by public.action_item_proposals.id;
alter sequence public.agent_run_messages_id_seq owned by public.agent_run_messages.id;
alter sequence public.agent_tool_cache_id_seq owned by public.agent_tool_cache.id;
alter sequence public.audit_mdsap_findings_id_seq owned by public.audit_mdsap_findings.id;
alter sequence public.capa_proposal_action_items_id_seq owned by public.capa_proposal_action_items.id;
alter sequence public.conversation_messages_id_seq owned by public.conversation_messages.id;
alter sequence public.conversations_id_seq owned by public.conversations.id;
alter sequence public.doc_chunks_id_seq owned by public.doc_chunks.id;
alter sequence public.documents_id_seq owned by public.documents.id;
alter sequence public.dossier_510k_checklist_items_id_seq owned by public.dossier_510k_checklist_items.id;
alter sequence public.dossier_510k_documents_id_seq owned by public.dossier_510k_documents.id;
alter sequence public.dossier_510k_references_id_seq owned by public.dossier_510k_references.id;
alter sequence public.dossier_mdsap_checklist_items_id_seq owned by public.dossier_mdsap_checklist_items.id;
alter sequence public.dossier_mdsap_documents_id_seq owned by public.dossier_mdsap_documents.id;
alter sequence public.predefined_questions_id_seq owned by public.predefined_questions.id;
alter sequence public.rag_settings_id_seq owned by public.rag_settings.id;
alter sequence public.repositories_id_seq owned by public.repositories.id;
alter sequence public.repository_imports_id_seq owned by public.repository_imports.id;
alter sequence public.repository_members_id_seq owned by public.repository_members.id;
alter sequence public.repository_section_keywords_id_seq owned by public.repository_section_keywords.id;
alter sequence public.repository_trace_patterns_id_seq owned by public.repository_trace_patterns.id;
alter sequence public.sop_rule_sections_id_seq owned by public.sop_rule_sections.id;
alter sequence public.sop_rules_id_seq owned by public.sop_rules.id;
alter sequence public.standard_sections_id_seq owned by public.standard_sections.id;
alter sequence public.submission_510k_fda_comments_id_seq owned by public.submission_510k_fda_comments.id;
alter sequence public.upload_logs_id_seq owned by public.upload_logs.id;
alter sequence public.usage_logs_id_seq owned by public.usage_logs.id;

-- ─── Foreign keys ────────────────────────────────────────────────────────────

do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'account_section_keywords_section_id_fkey' and conrelid = 'public.account_section_keywords'::regclass) then
    alter table public.account_section_keywords add constraint account_section_keywords_section_id_fkey FOREIGN KEY (section_id) REFERENCES standard_sections(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'action_item_proposals_agent_id_fkey' and conrelid = 'public.action_item_proposals'::regclass) then
    alter table public.action_item_proposals add constraint action_item_proposals_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agent_definitions(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'action_item_proposals_run_id_fkey' and conrelid = 'public.action_item_proposals'::regclass) then
    alter table public.action_item_proposals add constraint action_item_proposals_run_id_fkey FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'agent_definitions_cloned_from_fkey' and conrelid = 'public.agent_definitions'::regclass) then
    alter table public.agent_definitions add constraint agent_definitions_cloned_from_fkey FOREIGN KEY (cloned_from) REFERENCES agent_definitions(id) ON DELETE SET NULL;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'agent_memories_agent_id_fkey' and conrelid = 'public.agent_memories'::regclass) then
    alter table public.agent_memories add constraint agent_memories_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agent_definitions(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'agent_run_messages_run_id_fkey' and conrelid = 'public.agent_run_messages'::regclass) then
    alter table public.agent_run_messages add constraint agent_run_messages_run_id_fkey FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'agent_runs_agent_id_fkey' and conrelid = 'public.agent_runs'::regclass) then
    alter table public.agent_runs add constraint agent_runs_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agent_definitions(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'agent_runs_parent_run_id_fkey' and conrelid = 'public.agent_runs'::regclass) then
    alter table public.agent_runs add constraint agent_runs_parent_run_id_fkey FOREIGN KEY (parent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'agent_tool_cache_agent_id_fkey' and conrelid = 'public.agent_tool_cache'::regclass) then
    alter table public.agent_tool_cache add constraint agent_tool_cache_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agent_definitions(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'audit_cycles_mdsap_dossier_id_fkey' and conrelid = 'public.audit_cycles_mdsap'::regclass) then
    alter table public.audit_cycles_mdsap add constraint audit_cycles_mdsap_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers_mdsap(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'audit_mdsap_findings_cycle_id_fkey' and conrelid = 'public.audit_mdsap_findings'::regclass) then
    alter table public.audit_mdsap_findings add constraint audit_mdsap_findings_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES audit_cycles_mdsap(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'automation_jobs_agent_id_fkey' and conrelid = 'public.automation_jobs'::regclass) then
    alter table public.automation_jobs add constraint automation_jobs_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agent_definitions(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'capa_proposal_action_items_proposal_id_fkey' and conrelid = 'public.capa_proposal_action_items'::regclass) then
    alter table public.capa_proposal_action_items add constraint capa_proposal_action_items_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES capa_proposals(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'capa_proposals_agent_id_fkey' and conrelid = 'public.capa_proposals'::regclass) then
    alter table public.capa_proposals add constraint capa_proposals_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agent_definitions(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'capa_proposals_run_id_fkey' and conrelid = 'public.capa_proposals'::regclass) then
    alter table public.capa_proposals add constraint capa_proposals_run_id_fkey FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'conversation_messages_conversation_id_fkey' and conrelid = 'public.conversation_messages'::regclass) then
    alter table public.conversation_messages add constraint conversation_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'conversation_messages_repository_id_fkey' and conrelid = 'public.conversation_messages'::regclass) then
    alter table public.conversation_messages add constraint conversation_messages_repository_id_fkey FOREIGN KEY (repository_id) REFERENCES repositories(id);
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_repository_id_fkey' and conrelid = 'public.conversations'::regclass) then
    alter table public.conversations add constraint conversations_repository_id_fkey FOREIGN KEY (repository_id) REFERENCES repositories(id);
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'doc_chunks_doc_id_fkey' and conrelid = 'public.doc_chunks'::regclass) then
    alter table public.doc_chunks add constraint doc_chunks_doc_id_fkey FOREIGN KEY (doc_id) REFERENCES documents(id);
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'doc_chunks_repository_id_fkey' and conrelid = 'public.doc_chunks'::regclass) then
    alter table public.doc_chunks add constraint doc_chunks_repository_id_fkey FOREIGN KEY (repository_id) REFERENCES repositories(id);
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'documents_import_id_fkey' and conrelid = 'public.documents'::regclass) then
    alter table public.documents add constraint documents_import_id_fkey FOREIGN KEY (import_id) REFERENCES repository_imports(id) ON DELETE SET NULL;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'documents_parent_id_fkey' and conrelid = 'public.documents'::regclass) then
    alter table public.documents add constraint documents_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES documents(id) ON DELETE SET NULL;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'documents_repository_id_fkey' and conrelid = 'public.documents'::regclass) then
    alter table public.documents add constraint documents_repository_id_fkey FOREIGN KEY (repository_id) REFERENCES repositories(id);
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'dossier_510k_checklist_items_document_id_fkey' and conrelid = 'public.dossier_510k_checklist_items'::regclass) then
    alter table public.dossier_510k_checklist_items add constraint dossier_510k_checklist_items_document_id_fkey FOREIGN KEY (document_id) REFERENCES dossier_510k_documents(id) ON DELETE SET NULL;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'dossier_510k_checklist_items_dossier_id_fkey' and conrelid = 'public.dossier_510k_checklist_items'::regclass) then
    alter table public.dossier_510k_checklist_items add constraint dossier_510k_checklist_items_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers_510k(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'dossier_510k_documents_dossier_id_fkey' and conrelid = 'public.dossier_510k_documents'::regclass) then
    alter table public.dossier_510k_documents add constraint dossier_510k_documents_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers_510k(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'dossier_510k_references_dossier_id_fkey' and conrelid = 'public.dossier_510k_references'::regclass) then
    alter table public.dossier_510k_references add constraint dossier_510k_references_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers_510k(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'dossier_mdsap_checklist_items_document_id_fkey' and conrelid = 'public.dossier_mdsap_checklist_items'::regclass) then
    alter table public.dossier_mdsap_checklist_items add constraint dossier_mdsap_checklist_items_document_id_fkey FOREIGN KEY (document_id) REFERENCES dossier_mdsap_documents(id) ON DELETE SET NULL;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'dossier_mdsap_checklist_items_dossier_id_fkey' and conrelid = 'public.dossier_mdsap_checklist_items'::regclass) then
    alter table public.dossier_mdsap_checklist_items add constraint dossier_mdsap_checklist_items_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers_mdsap(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'dossier_mdsap_documents_dossier_id_fkey' and conrelid = 'public.dossier_mdsap_documents'::regclass) then
    alter table public.dossier_mdsap_documents add constraint dossier_mdsap_documents_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers_mdsap(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'item_field_update_proposals_agent_id_fkey' and conrelid = 'public.item_field_update_proposals'::regclass) then
    alter table public.item_field_update_proposals add constraint item_field_update_proposals_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agent_definitions(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'item_field_update_proposals_run_id_fkey' and conrelid = 'public.item_field_update_proposals'::regclass) then
    alter table public.item_field_update_proposals add constraint item_field_update_proposals_run_id_fkey FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'predefined_questions_standard_id_fkey' and conrelid = 'public.predefined_questions'::regclass) then
    alter table public.predefined_questions add constraint predefined_questions_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES standards(id);
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'repositories_standard_id_fkey' and conrelid = 'public.repositories'::regclass) then
    alter table public.repositories add constraint repositories_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES standards(id);
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'repository_imports_repository_id_fkey' and conrelid = 'public.repository_imports'::regclass) then
    alter table public.repository_imports add constraint repository_imports_repository_id_fkey FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'repository_members_repository_id_fkey' and conrelid = 'public.repository_members'::regclass) then
    alter table public.repository_members add constraint repository_members_repository_id_fkey FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'repository_section_keywords_repository_id_fkey' and conrelid = 'public.repository_section_keywords'::regclass) then
    alter table public.repository_section_keywords add constraint repository_section_keywords_repository_id_fkey FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'repository_section_keywords_section_id_fkey' and conrelid = 'public.repository_section_keywords'::regclass) then
    alter table public.repository_section_keywords add constraint repository_section_keywords_section_id_fkey FOREIGN KEY (section_id) REFERENCES standard_sections(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'repository_skills_repository_id_fkey' and conrelid = 'public.repository_skills'::regclass) then
    alter table public.repository_skills add constraint repository_skills_repository_id_fkey FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'repository_trace_patterns_repository_id_fkey' and conrelid = 'public.repository_trace_patterns'::regclass) then
    alter table public.repository_trace_patterns add constraint repository_trace_patterns_repository_id_fkey FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'sop_rule_sections_rule_id_fkey' and conrelid = 'public.sop_rule_sections'::regclass) then
    alter table public.sop_rule_sections add constraint sop_rule_sections_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES sop_rules(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'sop_rule_sections_section_id_fkey' and conrelid = 'public.sop_rule_sections'::regclass) then
    alter table public.sop_rule_sections add constraint sop_rule_sections_section_id_fkey FOREIGN KEY (section_id) REFERENCES standard_sections(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'sop_rules_chunk_id_fkey' and conrelid = 'public.sop_rules'::regclass) then
    alter table public.sop_rules add constraint sop_rules_chunk_id_fkey FOREIGN KEY (chunk_id) REFERENCES doc_chunks(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'sop_rules_repository_id_fkey' and conrelid = 'public.sop_rules'::regclass) then
    alter table public.sop_rules add constraint sop_rules_repository_id_fkey FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'standard_sections_standard_id_fkey' and conrelid = 'public.standard_sections'::regclass) then
    alter table public.standard_sections add constraint standard_sections_standard_id_fkey FOREIGN KEY (standard_id) REFERENCES standards(id);
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'submission_510k_fda_comments_submission_id_fkey' and conrelid = 'public.submission_510k_fda_comments'::regclass) then
    alter table public.submission_510k_fda_comments add constraint submission_510k_fda_comments_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES submissions_510k(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'submissions_510k_dossier_id_fkey' and conrelid = 'public.submissions_510k'::regclass) then
    alter table public.submissions_510k add constraint submissions_510k_dossier_id_fkey FOREIGN KEY (dossier_id) REFERENCES dossiers_510k(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'upload_logs_repository_id_fkey' and conrelid = 'public.upload_logs'::regclass) then
    alter table public.upload_logs add constraint upload_logs_repository_id_fkey FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE;
  end if;
end $fk$;
do $fk$ begin
  if not exists (select 1 from pg_constraint where conname = 'usage_logs_repository_id_fkey' and conrelid = 'public.usage_logs'::regclass) then
    alter table public.usage_logs add constraint usage_logs_repository_id_fkey FOREIGN KEY (repository_id) REFERENCES repositories(id);
  end if;
end $fk$;

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_action_item_proposals_agent_id ON public.action_item_proposals USING btree (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_item_proposals_status ON public.action_item_proposals USING btree (status);
CREATE INDEX IF NOT EXISTS idx_agent_definitions_agent_type ON public.agent_definitions USING btree (agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_definitions_cloned_from ON public.agent_definitions USING btree (cloned_from);
CREATE INDEX IF NOT EXISTS idx_agent_definitions_status ON public.agent_definitions USING btree (status);
CREATE INDEX IF NOT EXISTS idx_agent_memories_agent ON public.agent_memories USING btree (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_run_messages_run_id ON public.agent_run_messages USING btree (run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id ON public.agent_runs USING btree (agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created_by ON public.agent_runs USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_agent_runs_parent_run_id ON public.agent_runs USING btree (parent_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_tool_cache_agent ON public.agent_tool_cache USING btree (agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_cycles_mdsap_dossier ON public.audit_cycles_mdsap USING btree (dossier_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_cycles_mdsap_key ON public.audit_cycles_mdsap USING btree (dossier_id, cycle_key);
CREATE INDEX IF NOT EXISTS idx_audit_mdsap_findings_cycle ON public.audit_mdsap_findings USING btree (cycle_id, created_at);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_agent_id ON public.automation_jobs USING btree (agent_id);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_state ON public.automation_jobs USING btree (state, next_run_at);
CREATE INDEX IF NOT EXISTS idx_capa_proposal_action_items_proposal_id ON public.capa_proposal_action_items USING btree (proposal_id, created_at);
CREATE INDEX IF NOT EXISTS idx_capa_proposals_agent_id ON public.capa_proposals USING btree (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capa_proposals_status ON public.capa_proposals USING btree (status);
CREATE INDEX IF NOT EXISTS conversation_messages_conversation_id_idx ON public.conversation_messages USING btree (conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_file ON public.conversation_messages USING btree (id) WHERE (file_content IS NOT NULL);
CREATE INDEX IF NOT EXISTS conversations_repository_user_idx ON public.conversations USING btree (repository_id, user_id);
CREATE INDEX IF NOT EXISTS doc_chunks_fts_idx ON public.doc_chunks USING gin (fts);
CREATE INDEX IF NOT EXISTS doc_chunks_repository_id_idx ON public.doc_chunks USING btree (repository_id);
CREATE INDEX IF NOT EXISTS doc_chunks_vector_idx ON public.doc_chunks USING ivfflat (vector vector_cosine_ops) WITH (lists='100');
CREATE INDEX IF NOT EXISTS idx_doc_chunks_content_hash ON public.doc_chunks USING btree (content_hash);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_record_id ON public.doc_chunks USING btree (record_id) WHERE (record_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_repo_score ON public.doc_chunks USING btree (repository_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_traced_items ON public.doc_chunks USING gin (traced_items);
CREATE INDEX IF NOT EXISTS idx_document_diff_analyses_lookup ON public.document_diff_analyses USING btree (repository_id, from_doc_name, to_doc_name);
CREATE INDEX IF NOT EXISTS documents_department_trgm_idx ON public.documents USING gin (((doc_metadata ->> 'department'::text)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_description_trgm_idx ON public.documents USING gin (((doc_metadata ->> 'description'::text)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_doc_id_trgm_idx ON public.documents USING gin (((doc_metadata ->> 'doc_id'::text)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_doc_name_trgm_idx ON public.documents USING gin (doc_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_doc_title_trgm_idx ON public.documents USING gin (((doc_metadata ->> 'doc_title'::text)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_doc_type_trgm_idx ON public.documents USING gin (((doc_metadata ->> 'doc_type'::text)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_name_vector_idx ON public.documents USING ivfflat (name_vector vector_cosine_ops) WITH (lists='10');
CREATE INDEX IF NOT EXISTS documents_owner_trgm_idx ON public.documents USING gin (((doc_metadata ->> 'owner'::text)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_repo_hash_idx ON public.documents USING btree (repository_id, file_hash);
CREATE INDEX IF NOT EXISTS documents_repository_id_idx ON public.documents USING btree (repository_id);
CREATE INDEX IF NOT EXISTS documents_topics_trgm_idx ON public.documents USING gin (((doc_metadata ->> 'topics'::text)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_documents_base_name ON public.documents USING btree (base_name, repository_id);
CREATE INDEX IF NOT EXISTS idx_documents_control_type ON public.documents USING btree (control_type);
CREATE INDEX IF NOT EXISTS idx_documents_import_id ON public.documents USING btree (import_id);
CREATE INDEX IF NOT EXISTS idx_documents_parent_id ON public.documents USING btree (parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dossier_510k_checklist_item ON public.dossier_510k_checklist_items USING btree (dossier_id, category, item_key);
CREATE INDEX IF NOT EXISTS idx_dossier_510k_documents_category ON public.dossier_510k_documents USING btree (dossier_id, category, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_dossier_510k_documents_dossier ON public.dossier_510k_documents USING btree (dossier_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dossier_510k_reference ON public.dossier_510k_references USING btree (dossier_id, k_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dossier_mdsap_checklist_item ON public.dossier_mdsap_checklist_items USING btree (dossier_id, item_key);
CREATE INDEX IF NOT EXISTS idx_dossier_mdsap_documents_dossier ON public.dossier_mdsap_documents USING btree (dossier_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_field_update_proposals_agent_id ON public.item_field_update_proposals USING btree (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_field_update_proposals_status ON public.item_field_update_proposals USING btree (status);
CREATE INDEX IF NOT EXISTS idx_predefined_questions_standard ON public.predefined_questions USING btree (standard_id);
CREATE INDEX IF NOT EXISTS idx_predefined_questions_tags ON public.predefined_questions USING gin (tags);
CREATE INDEX IF NOT EXISTS repositories_owner_id_idx ON public.repositories USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_repo_imports_repository ON public.repository_imports USING btree (repository_id);
CREATE INDEX IF NOT EXISTS idx_repo_imports_status ON public.repository_imports USING btree (indexing_status);
CREATE INDEX IF NOT EXISTS repository_members_user_id_idx ON public.repository_members USING btree (user_id);
CREATE INDEX IF NOT EXISTS repository_skills_repository_id_idx ON public.repository_skills USING btree (repository_id);
CREATE INDEX IF NOT EXISTS idx_repo_trace_patterns_repo ON public.repository_trace_patterns USING btree (repository_id);
CREATE INDEX IF NOT EXISTS idx_sop_rule_sections_section_id ON public.sop_rule_sections USING btree (section_id);
CREATE INDEX IF NOT EXISTS idx_sop_rules_chunk_id ON public.sop_rules USING btree (chunk_id);
CREATE INDEX IF NOT EXISTS idx_sop_rules_repository_id ON public.sop_rules USING btree (repository_id);
CREATE INDEX IF NOT EXISTS idx_submission_510k_fda_comments_submission ON public.submission_510k_fda_comments USING btree (submission_id, created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_510k_v2_dossier ON public.submissions_510k USING btree (dossier_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_510k_v2_key ON public.submissions_510k USING btree (submission_key);
CREATE INDEX IF NOT EXISTS upload_logs_at_idx ON public.upload_logs USING btree (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS upload_logs_repo_idx ON public.upload_logs USING btree (repository_id);
CREATE INDEX IF NOT EXISTS upload_logs_status_idx ON public.upload_logs USING btree (status);
CREATE INDEX IF NOT EXISTS upload_logs_upload_id_idx ON public.upload_logs USING btree (upload_id);

-- ─── Functions ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_item_scoring(p_repo_id integer, p_rules jsonb)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.search_chunks(query_vector vector, match_count integer DEFAULT 5, filter_doc text DEFAULT NULL::text, p_repository_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(id bigint, doc_name text, chunk_index integer, chunk_type text, text text, metadata jsonb, similarity double precision)
 LANGUAGE sql
 STABLE
AS $function$
  select
    dc.id, dc.doc_name, dc.chunk_index, dc.chunk_type, dc.text, dc.metadata,
    1 - (dc.vector <=> query_vector) as similarity
  from doc_chunks dc
  join documents d on d.doc_name = dc.doc_name
    and (p_repository_id is null or d.repository_id = p_repository_id)
  where (filter_doc is null or dc.doc_name = filter_doc)
    and (p_repository_id is null or dc.repository_id = p_repository_id)
    and (filter_doc is not null or d.parent_id is null)
  order by dc.vector <=> query_vector
  limit match_count;
$function$;

CREATE OR REPLACE FUNCTION public.search_chunks_hybrid(query_vector vector, query_text text, match_count integer DEFAULT 5, filter_doc text DEFAULT NULL::text, p_repository_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(id bigint, doc_name text, chunk_index integer, chunk_type text, text text, metadata jsonb, similarity double precision)
 LANGUAGE sql
 STABLE
AS $function$
  with
    current_chunks as (
      select dc.*
      from doc_chunks dc
      join documents d on d.doc_name = dc.doc_name
        and (p_repository_id is null or d.repository_id = p_repository_id)
      where (filter_doc is null or dc.doc_name = filter_doc)
        and (p_repository_id is null or dc.repository_id = p_repository_id)
        and (filter_doc is not null or d.parent_id is null)
    ),
    vec as (
      select id, 1 - (vector <=> query_vector) as score,
             row_number() over (order by vector <=> query_vector) as rank
      from current_chunks
      order by vector <=> query_vector
      limit match_count * 3
    ),
    fts as (
      select id,
             ts_rank_cd(fts, plainto_tsquery('english', query_text)) as score,
             row_number() over (order by ts_rank_cd(fts, plainto_tsquery('english', query_text)) desc) as rank
      from current_chunks
      where fts @@ plainto_tsquery('english', query_text)
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
$function$;

CREATE OR REPLACE FUNCTION public.search_documents_by_content(p_search text, p_repository_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0, p_threshold double precision DEFAULT 0.4)
 RETURNS TABLE(doc_name text, chunk_count integer, file_path text, indexed_at timestamp with time zone, doc_metadata jsonb)
 LANGUAGE sql
 STABLE
AS $function$
  select distinct d.doc_name, d.chunk_count, d.file_path, d.indexed_at, d.doc_metadata
  from doc_chunks dc
  join documents d on d.doc_name = dc.doc_name
    and (p_repository_id is null or d.repository_id = p_repository_id)
  where
    (p_repository_id is null or dc.repository_id = p_repository_id)
    and word_similarity(p_search, dc.text) > p_threshold
    and d.parent_id is null
  order by d.doc_name
  limit p_limit offset p_offset;
$function$;

CREATE OR REPLACE FUNCTION public.search_documents_by_content_count(p_search text, p_repository_id bigint DEFAULT NULL::bigint, p_threshold double precision DEFAULT 0.4)
 RETURNS bigint
 LANGUAGE sql
 STABLE
AS $function$
  select count(distinct d.doc_name)
  from doc_chunks dc
  join documents d on d.doc_name = dc.doc_name
    and (p_repository_id is null or d.repository_id = p_repository_id)
  where
    (p_repository_id is null or dc.repository_id = p_repository_id)
    and word_similarity(p_search, dc.text) > p_threshold
    and d.parent_id is null;
$function$;

CREATE OR REPLACE FUNCTION public.search_documents_by_name(query_vector vector, match_count integer DEFAULT 5, p_repository_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(doc_name text, similarity double precision)
 LANGUAGE sql
 STABLE
AS $function$
  select
    doc_name,
    1 - (name_vector <=> query_vector) as similarity
  from documents
  where name_vector is not null
    and (p_repository_id is null or repository_id = p_repository_id)
  order by name_vector <=> query_vector
  limit match_count;
$function$;


-- ─── Triggers ────────────────────────────────────────────────────────────────


-- ─── Row level security ──────────────────────────────────────────────────────

alter table public.account_section_keywords enable row level security;
alter table public.account_skills enable row level security;
alter table public.agent_definitions enable row level security;
alter table public.agent_memories enable row level security;
alter table public.agent_run_messages enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_tool_cache enable row level security;
alter table public.capa_proposal_action_items enable row level security;
alter table public.capa_proposals enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.conversations enable row level security;
alter table public.doc_chunks enable row level security;
alter table public.document_diff_analyses enable row level security;
alter table public.documents enable row level security;
alter table public.dossier_510k_checklist_items enable row level security;
alter table public.dossier_510k_documents enable row level security;
alter table public.dossier_510k_references enable row level security;
alter table public.dossiers_510k enable row level security;
alter table public.item_field_update_proposals enable row level security;
alter table public.predefined_questions enable row level security;
alter table public.rag_settings enable row level security;
alter table public.repositories enable row level security;
alter table public.repository_imports enable row level security;
alter table public.repository_members enable row level security;
alter table public.repository_section_keywords enable row level security;
alter table public.repository_skills enable row level security;
alter table public.repository_trace_patterns enable row level security;
alter table public.schema_migrations enable row level security;
alter table public.settings_510k enable row level security;
alter table public.sop_rule_sections enable row level security;
alter table public.sop_rules enable row level security;
alter table public.standard_sections enable row level security;
alter table public.standards enable row level security;
alter table public.submission_510k_fda_comments enable row level security;
alter table public.submissions_510k enable row level security;
alter table public.upload_logs enable row level security;
alter table public.usage_logs enable row level security;

-- ─── Reference data ──────────────────────────────────────────────────────────

-- standards: 5 row(s)
insert into public.standards (id, name, default_ai_instructions)
select id, name, default_ai_instructions from jsonb_populate_recordset(null::public.standards, $ref$[{"id":"empty","name":"Empty","default_ai_instructions":""},{"id":"iec_62304","name":"IEC 62304:2006+AMD1:2015","default_ai_instructions":"You are an expert in medical device software lifecycle processes and the IEC 62304:2006+AMD1:2015 standard. When answering questions, reference the relevant clause numbers (e.g. \"Clause 5.2.1\") and clearly distinguish between requirements for Software Safety Class A, B, and C. Emphasize software development planning, architecture, unit implementation, integration, testing, problem resolution, and configuration management. Where documentation or records are missing or incomplete, state it explicitly. When identifying gaps, map them to the specific IEC 62304 clause that requires the missing artifact. For Class C software, always highlight the additional verification and V&V requirements. Reference related standards where relevant: ISO 14971 for risk management, ISO 13485 for QMS context, IEC 62366 for usability, and IEC 82304 for standalone software."},{"id":"iso_13485","name":"ISO 13485:2016","default_ai_instructions":"You are an expert in quality management systems for medical devices and the ISO 13485:2016 standard. When answering questions, reference the relevant clause numbers (e.g. \"Clause 7.3.3\") and emphasize regulatory compliance, risk-based thinking, design controls, and traceability requirements. Distinguish between requirements that apply to all organizations and those that apply only when the relevant processes are performed. Where evidence or records are missing, state it clearly."},{"id":"iso_14971","name":"ISO 14971:2019","default_ai_instructions":"You are an expert in medical device risk management and the ISO 14971:2019 standard. When answering questions, frame findings in terms of hazard identification, risk estimation, risk evaluation, and risk control. Reference specific clauses and emphasize the risk management process lifecycle."},{"id":"iso_27001","name":"ISO 27001:2022","default_ai_instructions":"You are an expert in information security management systems (ISMS) and the ISO 27001:2022 standard. When answering questions, relate findings to the relevant Annex A controls and clauses. Use precise security terminology. Where evidence gaps exist, state them clearly rather than speculating."}]$ref$::jsonb)
on conflict do nothing;
-- standard_sections: 176 row(s)
insert into public.standard_sections (id, standard_id, section_id, title, description, default_keywords, created_at, metadata)
select id, standard_id, section_id, title, description, default_keywords, created_at, metadata from jsonb_populate_recordset(null::public.standard_sections, $ref$[{"id":1,"standard_id":"iso_27001","section_id":"A.5.1","title":"Information Security Policies","description":null,"default_keywords":["information security policy","security policy","policy governance","information security governance"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":2,"standard_id":"iso_27001","section_id":"A.6.1","title":"Organization of Information Security","description":null,"default_keywords":["information security roles","security responsibilities","HR security","human resources security"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":3,"standard_id":"iso_27001","section_id":"A.9.1","title":"Access Control Policy","description":null,"default_keywords":["access control","authorization","authentication","access policy"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":4,"standard_id":"iso_27001","section_id":"A.10.1","title":"Cryptography Policy","description":null,"default_keywords":["encryption","cryptography","cipher","TLS","data protection","data security"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":5,"standard_id":"iso_27001","section_id":"A.12.1","title":"Operational Procedures","description":null,"default_keywords":["operational procedures","system procedures","IT operations","change management","system logging"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":8,"standard_id":"iso_13485","section_id":"4.2.2","title":"Quality Manual","description":"Establish and maintain a quality manual including scope, exclusions and interaction of processes.","default_keywords":["quality manual","scope","exclusions","process interaction","QMS scope"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Quality manual defines QMS scope with justified exclusions/non-applications","Manual references procedures and describes process interaction and documentation structure"],"common_gaps":["Exclusions/non-applications not justified","Manual does not describe process interaction or documentation structure"],"assessment_node":true,"required_evidence":["Quality manual"]}},{"id":11,"standard_id":"iso_13485","section_id":"4.2.5","title":"Control of Records","description":"Records shall be established and maintained to provide evidence of conformity.","default_keywords":["records","record control","record retention","traceability records","quality records","retention period"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Records identification, storage, security, integrity, retrieval, retention and disposition are controlled","Retention at least the device lifetime defined by the organization, not less than two years from release (or as regulations require)","Confidential health information protected; record changes remain identifiable"],"common_gaps":["Retention period not linked to device lifetime","Record changes not traceable","Confidential health information not protected"],"assessment_node":true,"required_evidence":["Record control procedure","Retention schedule","Backup/access control evidence for electronic records"]}},{"id":13,"standard_id":"iso_13485","section_id":"5.2","title":"Customer Focus","description":"Top management shall ensure customer and regulatory requirements are determined and met.","default_keywords":["customer focus","customer requirements","regulatory requirements","customer satisfaction"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Customer requirements and applicable regulatory requirements are determined and met"],"common_gaps":["Regulatory requirements not considered alongside customer requirements"],"assessment_node":true,"required_evidence":["Customer requirement reviews","Customer satisfaction/feedback data"]}},{"id":16,"standard_id":"iso_13485","section_id":"5.4.2","title":"Quality Management System Planning","description":"Top management shall ensure planning of the QMS is carried out.","default_keywords":["QMS planning","system planning","quality planning","integrity of QMS"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["QMS planning meets 4.1 requirements and quality objectives","QMS integrity is maintained when changes are planned and implemented"],"common_gaps":["Major reorganizations or system migrations without QMS planning"],"assessment_node":true,"required_evidence":["QMS plan / quality plan","Change plans for major QMS changes"]}},{"id":18,"standard_id":"iso_13485","section_id":"5.5.2","title":"Management Representative","description":"Top management shall appoint a member of management as management representative.","default_keywords":["management representative","QMS representative","regulatory liaison"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["A member of management is appointed as management representative with documented authority","Representative reports QMS effectiveness and promotes awareness of regulatory and QMS requirements"],"common_gaps":["Representative not a member of management","No evidence of reporting to top management"],"assessment_node":true,"required_evidence":["Appointment letter / documented responsibilities of management representative"]}},{"id":20,"standard_id":"iso_13485","section_id":"5.6","title":"Management Review","description":"Top management shall review the QMS at planned intervals to ensure its continuing suitability, adequacy and effectiveness.","default_keywords":["management review","review meeting","review input","review output","corrective action","audit results"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"note":"Parent/aggregate clause. Assess the child requirements separately.","assessment_node":false}},{"id":23,"standard_id":"iso_13485","section_id":"6.3","title":"Infrastructure","description":"Determine, provide and maintain infrastructure needed to achieve conformity to product requirements.","default_keywords":["infrastructure","facilities","equipment","utilities","maintenance","buildings"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Infrastructure requirements (buildings, equipment, supporting services) are documented","Maintenance activities and intervals documented where they can affect product quality, with records"],"common_gaps":["Maintenance not performed at documented intervals","No maintenance requirements for software/IT infrastructure"],"assessment_node":true,"required_evidence":["Equipment list","Preventive maintenance plan and records"]}},{"id":26,"standard_id":"iso_13485","section_id":"7.1","title":"Planning of Product Realization","description":"Plan and develop the processes needed for product realization.","default_keywords":["product realization","quality plan","risk management","design planning","verification","validation","acceptance criteria"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Product realization is planned and consistent with other QMS processes","Documented risk management processes cover product realization with records","Planning defines objectives, requirements, verification/validation/monitoring/inspection/test activities, acceptance criteria and records"],"common_gaps":["Risk management not applied across the whole realization process","No acceptance criteria defined in planning"],"assessment_node":true,"required_evidence":["Risk management plan/file (e.g. ISO 14971)","Quality/realization plans"]}},{"id":32,"standard_id":"iso_13485","section_id":"7.3.3","title":"Design and Development Inputs","description":"Inputs relating to product requirements shall be determined and records maintained.","default_keywords":["design inputs","user needs","intended use","functional requirements","performance requirements","safety requirements","regulatory inputs"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Design inputs include functional, performance, usability and safety requirements, regulatory requirements, risk management outputs and prior similar designs","Inputs are reviewed for adequacy, approved, complete, unambiguous and non-conflicting"],"common_gaps":["Usability or risk-control requirements missing from inputs","Inputs ambiguous or untestable"],"assessment_node":true,"required_evidence":["Design input / requirements specification","Design input review and approval record"]}},{"id":35,"standard_id":"iso_13485","section_id":"7.3.6","title":"Design and Development Verification","description":"Verification shall be performed to ensure outputs have met input requirements.","default_keywords":["design verification","verification protocol","verification report","testing","inspection"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Verification is performed per planned arrangements to ensure outputs meet inputs","Verification plans include methods, acceptance criteria and statistical rationale for sample size where appropriate","Interfaces with connected devices are verified where required; records of results, conclusions and actions retained"],"common_gaps":["Sample sizes without statistical rationale","Inputs without verification","Interface verification missing"],"assessment_node":true,"required_evidence":["Verification protocols and reports","Sample size rationale","Traceability matrix inputs to verification"]}},{"id":39,"standard_id":"iso_13485","section_id":"7.3.10","title":"Design and Development Files","description":"Maintain a design and development file for each medical device type or family.","default_keywords":["design history file","DHF","design file","technical documentation"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["A design and development file is maintained for each device type or family","File includes or references records of design conformity and design changes"],"common_gaps":["DHF incomplete or missing change records"],"assessment_node":true,"required_evidence":["Design history file (DHF) index per device family"]}},{"id":41,"standard_id":"iso_13485","section_id":"7.4.2","title":"Purchasing Information","description":"Purchasing documents shall describe the product to be purchased.","default_keywords":["purchase order","purchasing information","supplier specification","quality agreement"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Purchasing information describes product specifications, acceptance requirements, personnel qualification and QMS requirements as appropriate","Adequacy of requirements verified before communication to supplier","Written agreement requires supplier notification of changes before implementation, where applicable"],"common_gaps":["No supplier change-notification agreement","POs reference no specification revision"],"assessment_node":true,"required_evidence":["Purchase orders with specifications","Quality agreements with change-notification clause"]}},{"id":44,"standard_id":"iso_13485","section_id":"7.5.2","title":"Cleanliness of Product","description":"Document requirements for cleanliness of product or contamination control during manufacturing.","default_keywords":["cleanliness","product cleanliness","cleaning procedure","particulate contamination"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Cleanliness/contamination requirements are documented where product is cleaned before sterilization/use, supplied non-sterile but cleaned before use, cannot be cleaned but cleanliness matters, or process agents must be removed"],"common_gaps":["Process agents not removed/verified","Cleaning not validated"],"applicability":"Applies only in the listed cleanliness conditions.","assessment_node":true,"required_evidence":["Cleanliness specifications","Cleaning procedures and validation"]}},{"id":46,"standard_id":"iso_13485","section_id":"7.5.4","title":"Service Activities","description":"Document service procedures, reference documents, and service records.","default_keywords":["servicing","maintenance","service record","field service","service report"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Documented servicing procedures, reference materials and measurements exist where servicing is a specified requirement","Servicing records are analyzed to determine whether information is a complaint and for input to improvement","Records of servicing activities are maintained"],"common_gaps":["Service records not reviewed for complaints"],"applicability":"Applies only if servicing is a specified requirement.","assessment_node":true,"required_evidence":["Service procedures/manuals","Service reports","Analysis of service records"]}},{"id":49,"standard_id":"iso_13485","section_id":"7.5.7","title":"Particular Requirements for Validation of Processes for Sterilization and Sterile Barrier Systems","description":"Validate sterilization processes and sterile barrier systems.","default_keywords":["sterilization validation","sterile barrier","EO sterilization","gamma sterilization","autoclave validation"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Sterilization and sterile barrier system processes are validated before implementation and after product/process changes as appropriate","Validation results, conclusions and actions are recorded"],"common_gaps":["Packaging validation missing","Revalidation not done after product or process change"],"applicability":"Applies only if the organization sterilizes or uses sterile barrier systems.","assessment_node":true,"required_evidence":["Sterilization validation report","Sterile barrier/packaging validation report","Revalidation records"]}},{"id":51,"standard_id":"iso_13485","section_id":"7.5.9","title":"Traceability","description":"Maintain records that enable traceability of the medical device.","default_keywords":["traceability","device traceability","lot traceability","implantable device","UDI","distribution records"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"note":"Parent/aggregate clause. Assess the child requirements separately.","assessment_node":false}},{"id":53,"standard_id":"iso_13485","section_id":"7.5.11","title":"Preservation of Product","description":"Preserve product during internal processing and delivery to intended destination.","default_keywords":["preservation","packaging","storage","handling","shelf life","expiry date","environmental storage conditions"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Product conformity is preserved during processing, storage, handling and distribution","Packaging/shipping containers protect product from alteration, contamination or damage","Special conditions (e.g. shelf life, storage conditions) are documented, controlled and recorded"],"common_gaps":["Shelf life not controlled (FIFO/FEFO)","Storage conditions not monitored"],"assessment_node":true,"required_evidence":["Storage and handling procedures","Shipping/packaging validation","Storage condition monitoring records"]}},{"id":70,"standard_id":"iec_62304","section_id":"4.1","title":"Quality Management System","description":"The manufacturer shall establish a quality management system that includes software lifecycle processes.","default_keywords":["quality management system","QMS","software lifecycle","IEC 62304 compliance","software processes","regulatory requirements"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":71,"standard_id":"iec_62304","section_id":"4.2","title":"Risk Management","description":"The manufacturer shall establish a risk management process compliant with ISO 14971 covering software.","default_keywords":["risk management","ISO 14971","software risk","risk control","residual risk","hazard","risk analysis","software contribution to risk"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":72,"standard_id":"iec_62304","section_id":"4.3","title":"Software Safety Classification","description":"Classify software items into Class A, B, or C based on their potential to contribute to hazardous situations.","default_keywords":["software safety class","Class A","Class B","Class C","safety classification","hazardous situation","software classification rationale"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":73,"standard_id":"iec_62304","section_id":"5.1","title":"Software Development Planning","description":"Establish a software development plan covering lifecycle model, activities, deliverables, tools, standards and traceability.","default_keywords":["software development plan","SDP","development planning","lifecycle model","software deliverables","development tools","software standards"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":74,"standard_id":"iec_62304","section_id":"5.1.1","title":"Software Development Life Cycle Model","description":"Define the software development lifecycle model appropriate for the project.","default_keywords":["lifecycle model","SDLC","waterfall","agile","iterative model","development model","software lifecycle model"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":75,"standard_id":"iec_62304","section_id":"5.1.2","title":"Keep Software Development Plan Updated","description":"Keep the software development plan current as development progresses.","default_keywords":["development plan update","plan revision","plan maintenance","software plan control"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":76,"standard_id":"iec_62304","section_id":"5.1.3","title":"Software Development Plan Reference to System Design and Development","description":"Reference the system design and development plan where one exists.","default_keywords":["system design","system development plan","hardware-software interface","system architecture reference"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":77,"standard_id":"iec_62304","section_id":"5.1.4","title":"Software Development Standards, Methods and Tools Planning","description":"Plan the standards, methods and tools used in software development.","default_keywords":["development standards","coding standards","development methods","software tools","CASE tools","tool qualification"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":78,"standard_id":"iec_62304","section_id":"5.1.5","title":"Software Integration and Integration Testing Planning","description":"Plan the software integration and integration testing.","default_keywords":["integration plan","integration testing","software integration","integration test plan","build plan"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":79,"standard_id":"iec_62304","section_id":"5.1.6","title":"Software Verification Planning","description":"Plan the verification activities for each development activity.","default_keywords":["verification plan","software verification","V&V plan","verification activities","verification methods"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":58,"standard_id":"iso_13485","section_id":"8.2.3","title":"Reporting to Regulatory Authorities","description":"Document a procedure for notification of adverse events and issuing advisory notices.","default_keywords":["regulatory reporting","MDR","medical device report","adverse event","vigilance report","field safety corrective action","FSCA","advisory notice"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Procedures exist for notifying regulatory authorities of reportable complaints/adverse events and advisory notices per applicable regulations","Records of reporting are maintained"],"common_gaps":["Reporting timelines per jurisdiction not defined","Late reports"],"assessment_node":true,"required_evidence":["Vigilance/MDR reporting procedure","Submitted reports and timelines"]}},{"id":60,"standard_id":"iso_13485","section_id":"8.2.5","title":"Monitoring and Measurement of Processes","description":"Apply suitable methods for monitoring and measurement of QMS processes.","default_keywords":["process monitoring","process measurement","process performance","KPI","metrics"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Suitable methods monitor and, where applicable, measure QMS processes","When planned results are not achieved, correction and corrective action are taken"],"common_gaps":["KPIs missing targets with no action taken"],"assessment_node":true,"required_evidence":["Process KPIs and trend reports"]}},{"id":63,"standard_id":"iso_13485","section_id":"8.3.2","title":"Nonconforming Product Before Delivery","description":"Take action on nonconforming product detected before delivery.","default_keywords":["rework","repair","scrap","deviation","concession","waiver","disposition"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Nonconforming product before delivery is dealt with by elimination, precluding use, or authorizing use by concession","Concessions are accepted only if justified and regulatory requirements met; records identify the approver"],"common_gaps":["Concessions without justification or approver"],"assessment_node":true,"required_evidence":["Disposition records","Concession records with justification and approver"]}},{"id":65,"standard_id":"iso_13485","section_id":"8.3.4","title":"Rework","description":"Document and approve rework processes in a manner equivalent to the original process.","default_keywords":["rework","rework procedure","rework record","rework authorization"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Rework is performed per documented procedures that consider potential adverse effect on product","Procedures are reviewed and approved like the original work instructions","Reworked product is re-verified to meet acceptance criteria; records maintained"],"common_gaps":["Rework done without approved instructions","No re-verification after rework"],"applicability":"Applies only if rework is performed.","assessment_node":true,"required_evidence":["Rework instructions","Rework and re-verification records"]}},{"id":68,"standard_id":"iso_13485","section_id":"8.5.2","title":"Corrective Action","description":"Take action to eliminate the cause of nonconformities to prevent recurrence.","default_keywords":["corrective action","CAPA","root cause analysis","corrective action plan","CAR","effectiveness verification"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Documented corrective action procedure covers reviewing nonconformities, determining causes, evaluating need for action, planning/implementing actions and updating documentation","Actions are proportionate to effects; they do not adversely affect regulatory compliance or device safety/performance","Effectiveness of corrective action is reviewed; results recorded"],"common_gaps":["Root cause superficial (e.g. 'human error')","Effectiveness not verified","CAPAs overdue"],"assessment_node":true,"required_evidence":["CAPA procedure","CAPA records with root cause, actions and effectiveness checks"]}},{"id":80,"standard_id":"iec_62304","section_id":"5.1.7","title":"Software Risk Management Planning","description":"Plan risk management activities for software.","default_keywords":["software risk management plan","risk management activities","software hazard","risk control measures"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":81,"standard_id":"iec_62304","section_id":"5.1.8","title":"Documentation Planning","description":"Plan documentation to be produced during software development.","default_keywords":["documentation plan","software documents","document list","deliverable documents"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":82,"standard_id":"iec_62304","section_id":"5.1.9","title":"Software Configuration Management Planning","description":"Plan configuration management including identification, control, status accounting and auditing.","default_keywords":["configuration management plan","CM plan","version control","software configuration","baseline","change control planning"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":83,"standard_id":"iec_62304","section_id":"5.1.10","title":"Supporting Items Planning","description":"Plan supporting items needed for software development such as facilities and tools.","default_keywords":["development facilities","development environment","supporting items","infrastructure planning","development tools"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":84,"standard_id":"iec_62304","section_id":"5.1.11","title":"Software Safety Class Scaling","description":"Scale development activities and deliverables according to the assigned software safety class.","default_keywords":["safety class scaling","tailoring","Class A activities","Class B activities","Class C activities","exemptions"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":85,"standard_id":"iec_62304","section_id":"5.2","title":"Software Requirements Analysis","description":"Specify and analyse the requirements for the software system, including functional, non-functional and safety requirements.","default_keywords":["software requirements","requirements analysis","software requirements specification","SRS","functional requirements","non-functional requirements","safety requirements","security requirements"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":86,"standard_id":"iec_62304","section_id":"5.2.1","title":"Define and Document Software Requirements","description":"Define and document the requirements for the software system.","default_keywords":["software requirements specification","SRS","requirements definition","software requirements document","functional requirements","performance requirements"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":87,"standard_id":"iec_62304","section_id":"5.2.2","title":"Software Requirements Content","description":"Software requirements shall include functionality, performance, interface, safety and security requirements.","default_keywords":["requirements content","functional requirements","performance requirements","interface requirements","safety requirements","security requirements","regulatory requirements traceability"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":88,"standard_id":"iec_62304","section_id":"5.2.3","title":"Include Risk Control Measures in Software Requirements","description":"Include software risk control measures in the software requirements.","default_keywords":["risk control requirements","software risk controls","risk mitigation","safety requirements from risk management"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":89,"standard_id":"iec_62304","section_id":"5.2.4","title":"Re-evaluate Medical Device Risk Analysis","description":"Re-evaluate the medical device risk analysis based on software requirements.","default_keywords":["risk analysis update","re-evaluation","risk management update","hazard analysis","software hazards"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":90,"standard_id":"iec_62304","section_id":"5.2.5","title":"Update System Requirements","description":"Update system requirements to include changes resulting from software requirements analysis.","default_keywords":["system requirements update","requirements allocation","traceability update"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":91,"standard_id":"iec_62304","section_id":"5.2.6","title":"Verify Software Requirements","description":"Verify that the software requirements are complete, consistent, unambiguous, and testable.","default_keywords":["requirements verification","requirements review","requirements completeness","requirements testability","requirements consistency","requirements traceability"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":92,"standard_id":"iec_62304","section_id":"5.3","title":"Software Architectural Design","description":"Design and document the software architecture identifying the major structural components (software items) and their interfaces.","default_keywords":["software architecture","architectural design","software items","software components","component interfaces","architecture document","SAD"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":93,"standard_id":"iec_62304","section_id":"5.3.1","title":"Transform Software Requirements into an Architecture","description":"Design the software architecture that identifies the software items.","default_keywords":["architecture design","software decomposition","software items","top-level design","architectural components"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":94,"standard_id":"iec_62304","section_id":"5.3.2","title":"Develop an Architecture for the Interfaces of Software Items","description":"Document the interfaces between software items and between software items and hardware.","default_keywords":["software interface","interface design","API design","hardware-software interface","software item interfaces","interface specification"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":95,"standard_id":"iec_62304","section_id":"5.3.3","title":"Specify Functional and Performance Requirements of SOUP","description":"Specify the functional and performance requirements for SOUP (Software of Unknown Provenance) items.","default_keywords":["SOUP","off-the-shelf software","third-party software","SOUP requirements","SOUP functional requirements","SOUP performance requirements","OTS software"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":96,"standard_id":"iec_62304","section_id":"5.3.4","title":"Identify Hardware and Software Items Required by SOUP Item","description":"Identify the hardware and software needed to support each SOUP item.","default_keywords":["SOUP dependencies","SOUP hardware requirements","SOUP operating system","SOUP environment","SOUP prerequisites"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":97,"standard_id":"iec_62304","section_id":"5.3.5","title":"Identify Segregation Necessary for Risk Control","description":"Identify segregation between software items required to implement risk controls.","default_keywords":["segregation","software isolation","partitioning","safety partition","risk control segregation","fault containment"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":98,"standard_id":"iec_62304","section_id":"5.3.6","title":"Verify Software Architecture","description":"Verify that the software architecture implements all software requirements and risk controls.","default_keywords":["architecture verification","architecture review","architecture traceability","design review"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":99,"standard_id":"iec_62304","section_id":"5.4","title":"Software Detailed Design","description":"Develop a detailed design for each software unit specifying implementation details.","default_keywords":["detailed design","software unit design","unit specification","low-level design","LLD","algorithm design","data structures"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":100,"standard_id":"iec_62304","section_id":"5.4.1","title":"Refine Software Architecture to Software Units","description":"Refine the software architecture to define the software units to be implemented.","default_keywords":["software units","unit decomposition","design refinement","module design","component design"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":101,"standard_id":"iec_62304","section_id":"5.4.2","title":"Develop Detailed Design for Each Software Unit","description":"Develop a detailed design for each software unit.","default_keywords":["unit design","detailed design document","module specification","class design","interface detail"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":102,"standard_id":"iec_62304","section_id":"5.4.3","title":"Develop Detailed Design for Interfaces","description":"Develop detailed designs for each interface between software units and external components.","default_keywords":["interface specification","unit interface","API specification","function signatures","data interface"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":103,"standard_id":"iec_62304","section_id":"5.4.4","title":"Verify Detailed Design","description":"Verify that the detailed design correctly implements all software requirements and architecture.","default_keywords":["detailed design review","design verification","unit design review","design traceability"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":104,"standard_id":"iec_62304","section_id":"5.5","title":"Software Unit Implementation and Verification","description":"Implement and verify each software unit.","default_keywords":["software unit implementation","coding","unit testing","unit verification","code review","static analysis","implementation"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":105,"standard_id":"iec_62304","section_id":"5.5.1","title":"Implement Each Software Unit","description":"Implement each software unit in accordance with its detailed design.","default_keywords":["unit implementation","coding","source code","implementation","programming","development"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":106,"standard_id":"iec_62304","section_id":"5.5.2","title":"Establish Software Unit Verification Process","description":"Establish a process for verifying each software unit.","default_keywords":["unit verification","unit testing","test procedure","verification process","unit test plan"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":107,"standard_id":"iec_62304","section_id":"5.5.3","title":"Software Unit Acceptance Criteria","description":"Define acceptance criteria for each software unit to be verified.","default_keywords":["acceptance criteria","unit acceptance criteria","pass criteria","test acceptance","definition of done"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":108,"standard_id":"iec_62304","section_id":"5.5.4","title":"Additional Software Unit Acceptance Criteria (Class B & C)","description":"For Class B and C: include criteria for proper event sequence, memory bounds, error handling, algorithmic accuracy, and timing.","default_keywords":["Class B unit testing","Class C unit testing","boundary testing","error handling","memory bounds","timing requirements","algorithmic accuracy"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":109,"standard_id":"iec_62304","section_id":"5.5.5","title":"Software Unit Verification","description":"Verify that each software unit meets its acceptance criteria.","default_keywords":["unit test execution","unit test results","test pass","test report","unit test record","verification results"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":110,"standard_id":"iec_62304","section_id":"5.6","title":"Software Integration and Integration Testing","description":"Integrate the software units and software items, and perform integration testing.","default_keywords":["software integration","integration testing","integration test plan","integration test report","build","software assembly","integration test results"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":111,"standard_id":"iec_62304","section_id":"5.6.1","title":"Integrate Software Units","description":"Integrate software units following the integration plan.","default_keywords":["software integration","unit integration","build process","integration sequence","incremental integration"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":112,"standard_id":"iec_62304","section_id":"5.6.2","title":"Verify Software Integration","description":"Verify that each integrated software item implements all software requirements.","default_keywords":["integration verification","integration test execution","interface testing","integration test results","test evidence"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":113,"standard_id":"iec_62304","section_id":"5.6.3","title":"Software Integration Testing","description":"Perform integration testing to verify combined software items work together as designed.","default_keywords":["integration testing","system integration test","SIT","interface test","combined testing","test protocol"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":114,"standard_id":"iec_62304","section_id":"5.6.4","title":"Software Integration Testing Content (Class B & C)","description":"For Class B and C: test all software items against requirements, including error handling and boundary conditions.","default_keywords":["integration test content","boundary conditions","error conditions","interface boundaries","Class B integration","Class C integration"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":115,"standard_id":"iec_62304","section_id":"5.6.5","title":"Evaluate Integration Test Procedures","description":"Evaluate integration test procedures for correctness and completeness.","default_keywords":["test procedure review","test procedure evaluation","test completeness","test coverage"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":116,"standard_id":"iec_62304","section_id":"5.6.6","title":"Conduct Regression Tests","description":"Conduct regression testing when software items are changed.","default_keywords":["regression testing","regression test","retest","change impact testing","regression test suite"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":117,"standard_id":"iec_62304","section_id":"5.6.7","title":"Use Software Problem Resolution Process","description":"Use the software problem resolution process to resolve test failures.","default_keywords":["problem resolution","defect resolution","test failure","anomaly resolution","bug fix process"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":118,"standard_id":"iec_62304","section_id":"5.7","title":"Software System Testing","description":"Establish and perform tests for the software system to verify that all software requirements are met.","default_keywords":["system testing","software system test","system test plan","system test report","system verification","requirements testing","V&V"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":119,"standard_id":"iec_62304","section_id":"5.7.1","title":"Establish System Test Procedures","description":"Establish test procedures for the software system.","default_keywords":["system test procedures","test protocol","test script","acceptance testing","system test specification"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":120,"standard_id":"iec_62304","section_id":"5.7.2","title":"Verify Completeness of System Tests","description":"Verify that system test procedures address all software requirements.","default_keywords":["test completeness","requirements coverage","test traceability matrix","RTM","coverage analysis"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":121,"standard_id":"iec_62304","section_id":"5.7.3","title":"Test for Anomalous Situations","description":"Test for anomalous inputs and situations.","default_keywords":["boundary testing","negative testing","anomalous inputs","error conditions","robustness testing","stress testing"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":122,"standard_id":"iec_62304","section_id":"5.7.4","title":"Conduct Software System Tests","description":"Conduct the software system tests and record results.","default_keywords":["system test execution","test execution","test results","test evidence","test records","OQ","operational qualification"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":123,"standard_id":"iec_62304","section_id":"5.7.5","title":"Evaluate System Test Procedures and Results","description":"Evaluate test procedures and test results for completeness and correctness.","default_keywords":["test result evaluation","test review","test closure","test summary report","system test review"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":124,"standard_id":"iec_62304","section_id":"5.7.6","title":"Conduct Regression Tests","description":"Conduct regression tests as necessary following changes.","default_keywords":["regression testing","system regression","re-qualification","change impact","retest"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":125,"standard_id":"iec_62304","section_id":"5.8","title":"Software Release","description":"Create and document a software release of the software product.","default_keywords":["software release","release process","software version","release baseline","release documentation","release approval","software build record"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":126,"standard_id":"iec_62304","section_id":"5.8.1","title":"Ensure Software Verification is Complete","description":"Ensure all verification activities have been completed before release.","default_keywords":["verification complete","release readiness","release checklist","V&V complete","release criteria"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":127,"standard_id":"iec_62304","section_id":"5.8.2","title":"Document Known Residual Anomalies","description":"Document known residual anomalies in the released software.","default_keywords":["known anomalies","residual defects","known issues","open defects","anomaly list","software defect list"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":128,"standard_id":"iec_62304","section_id":"5.8.3","title":"Evaluate Residual Anomalies","description":"Evaluate whether residual anomalies affect safety.","default_keywords":["anomaly evaluation","residual risk","defect impact","safety impact assessment","risk acceptance"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":129,"standard_id":"iec_62304","section_id":"5.8.4","title":"Document How Released Version is Identified","description":"Document how the released software version is identified.","default_keywords":["version identification","software identification","release label","version number","software mark","UDI-DI"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":130,"standard_id":"iec_62304","section_id":"5.8.5","title":"Ensure Relevant Activities are Complete","description":"Ensure all activities required by the software development plan are complete.","default_keywords":["release completeness","plan compliance","release audit","software release record"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":131,"standard_id":"iec_62304","section_id":"5.8.6","title":"Archive Released Software","description":"Archive the released version of the software.","default_keywords":["software archive","release archive","source code archive","build archive","baseline archive","archiving"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":132,"standard_id":"iec_62304","section_id":"5.8.7","title":"Assure Repeatability of Release","description":"Ensure the release can be rebuilt exactly from archived source.","default_keywords":["reproducible build","build repeatability","source control","build environment","build instructions"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":133,"standard_id":"iec_62304","section_id":"5.8.8","title":"Deliver Software","description":"Deliver the software product for use in the medical device.","default_keywords":["software delivery","software release note","delivery record","installation","deployment","software installation instructions"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":134,"standard_id":"iec_62304","section_id":"6.1","title":"Establish Software Maintenance Plan","description":"Establish a plan for software maintenance activities.","default_keywords":["maintenance plan","software maintenance plan","maintenance procedure","maintenance activities","support plan"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":135,"standard_id":"iec_62304","section_id":"6.2","title":"Problem and Modification Analysis","description":"Analyse reported problems and modifications to determine their nature and impact.","default_keywords":["problem analysis","modification analysis","change analysis","impact analysis","defect analysis","change request"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":136,"standard_id":"iec_62304","section_id":"6.2.1","title":"Monitor Feedback from Post-Production","description":"Monitor feedback from users and post-production experience.","default_keywords":["post-production monitoring","post-market surveillance","user feedback","complaint monitoring","field issues"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":137,"standard_id":"iec_62304","section_id":"6.2.2","title":"Document Feedback Requiring Action","description":"Document feedback that could impact software safety or performance.","default_keywords":["feedback documentation","post-market feedback","user complaint","software complaint","anomaly report"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":138,"standard_id":"iec_62304","section_id":"6.2.3","title":"Analyse Modification","description":"Analyse software modifications to determine impact on the software system.","default_keywords":["modification analysis","change impact analysis","change classification","software change"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":139,"standard_id":"iec_62304","section_id":"6.2.4","title":"Approve Modification","description":"Approve modifications prior to implementation.","default_keywords":["modification approval","change approval","change control","ECO","software change request","CCB"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":140,"standard_id":"iec_62304","section_id":"6.2.5","title":"Implementation of Modification","description":"Implement approved modifications using the software development process.","default_keywords":["modification implementation","change implementation","code change","software update","patch"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":141,"standard_id":"iec_62304","section_id":"6.3","title":"Modification Implementation","description":"Implement modifications and re-verify according to the applicable software development process activities.","default_keywords":["modification implementation","software update","re-verification","regression testing","change verification"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":142,"standard_id":"iec_62304","section_id":"7.1","title":"Analysis of Software Contributing to Hazardous Situations","description":"Identify software items that could contribute to hazardous situations.","default_keywords":["software hazard analysis","hazardous situation","software contribution","hazard identification","FMEA","FTA","software failure mode"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":143,"standard_id":"iec_62304","section_id":"7.2","title":"Risk Control Measures","description":"Specify software risk control measures and verify their implementation.","default_keywords":["risk control","software risk control","mitigation","risk control measure","risk reduction","defensive programming","fault detection"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":144,"standard_id":"iec_62304","section_id":"7.3","title":"Verify Risk Control Measures","description":"Verify implementation of software risk control measures.","default_keywords":["risk control verification","risk control testing","safety testing","verification of risk controls","hazard mitigation testing"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":145,"standard_id":"iec_62304","section_id":"7.4","title":"Risk Management of Software Changes","description":"Evaluate and manage risks when software changes are made.","default_keywords":["change risk management","change impact on risk","software change risk","risk re-evaluation","change risk analysis"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":146,"standard_id":"iec_62304","section_id":"7.4.1","title":"Analyse Changes to Software with Respect to Safety","description":"Analyse software changes to determine if new hazards are introduced.","default_keywords":["change safety analysis","change hazard analysis","new hazards","safety impact of change","risk analysis update"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":147,"standard_id":"iec_62304","section_id":"7.4.2","title":"Analyse Impact of Software Changes on Existing Risk Controls","description":"Analyse the impact of software changes on existing risk control measures.","default_keywords":["risk control impact","change impact on safety","existing risk controls","risk control effectiveness"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":148,"standard_id":"iec_62304","section_id":"8.1","title":"Configuration Identification","description":"Identify the software configuration items that are to be placed under configuration control.","default_keywords":["configuration identification","configuration items","CI","software items under control","configuration baseline","version identification"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":149,"standard_id":"iec_62304","section_id":"8.1.1","title":"Identify Configuration Items","description":"Identify all software configuration items including source code, tools, test infrastructure, and documentation.","default_keywords":["configuration items","CI identification","version control","software baseline","documentation baseline"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":150,"standard_id":"iec_62304","section_id":"8.1.2","title":"Identify SOUP","description":"Identify all SOUP items that form part of the medical device software.","default_keywords":["SOUP identification","SOUP list","third-party components","OTS software list","open source","SOUP registry","software bill of materials"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":151,"standard_id":"iec_62304","section_id":"8.1.3","title":"Identify System Configuration Documentation","description":"Identify the documentation establishing the configuration of the system.","default_keywords":["system configuration documentation","configuration document","baseline document","system baseline"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":152,"standard_id":"iec_62304","section_id":"8.2","title":"Change Control","description":"Control changes to software configuration items.","default_keywords":["change control","change management","change request","change approval","CCB","configuration control board","software change control","ECR","ECO"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":153,"standard_id":"iec_62304","section_id":"8.2.1","title":"Approve Requests for Changes","description":"Approve requests for changes to software configuration items.","default_keywords":["change request","change approval","change board","CCB","change authorization"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":154,"standard_id":"iec_62304","section_id":"8.2.2","title":"Implement Changes","description":"Implement approved changes following a defined procedure.","default_keywords":["change implementation","software change","code change","configuration change","change procedure"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":155,"standard_id":"iec_62304","section_id":"8.2.3","title":"Verify Changes","description":"Verify that changes to configuration items have been implemented correctly.","default_keywords":["change verification","change testing","regression testing","verification of change"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":156,"standard_id":"iec_62304","section_id":"8.3","title":"Configuration Status Accounting","description":"Record and report status of configuration items.","default_keywords":["configuration status accounting","status reporting","configuration record","version tracking","release history"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":157,"standard_id":"iec_62304","section_id":"8.4","title":"Configuration Evaluation","description":"Perform configuration audits to verify that configuration items are complete, correct, and consistent.","default_keywords":["configuration audit","configuration evaluation","software audit","configuration review","baseline audit"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":158,"standard_id":"iec_62304","section_id":"9.1","title":"Prepare Problem Reports","description":"Prepare a problem report for each detected software problem.","default_keywords":["problem report","software anomaly report","defect report","bug report","anomaly","NCR","problem tracking"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":159,"standard_id":"iec_62304","section_id":"9.2","title":"Investigate the Problem","description":"Investigate the problem to determine its cause and effect on safety.","default_keywords":["problem investigation","root cause analysis","defect investigation","anomaly investigation","problem analysis","safety impact"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":160,"standard_id":"iec_62304","section_id":"9.3","title":"Advise Relevant Parties","description":"Advise relevant parties of the problem and its status.","default_keywords":["problem notification","stakeholder notification","problem communication","advisory"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":161,"standard_id":"iec_62304","section_id":"9.4","title":"Use Change Control Process","description":"Use the change control process to resolve the problem.","default_keywords":["change control","problem resolution","defect fix","corrective action","change request","problem closure"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":162,"standard_id":"iec_62304","section_id":"9.5","title":"Verify Problem Resolution","description":"Verify that the problem has been resolved.","default_keywords":["problem resolution verification","fix verification","defect closure","verification of fix","retesting","regression testing"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":163,"standard_id":"iec_62304","section_id":"9.6","title":"Test Documentation","description":"Test documentation and closure records for problem resolution.","default_keywords":["problem resolution record","closure record","resolution documentation","problem report closure"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":164,"standard_id":"iec_62304","section_id":"9.7","title":"Analyse Problems for Trends","description":"Analyse problem reports for trends to identify systemic issues.","default_keywords":["trend analysis","problem trend","defect trend","quality metrics","defect density","software quality"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":165,"standard_id":"iec_62304","section_id":"9.8","title":"Verify No Adverse Trends","description":"Verify that problem trends do not indicate unacceptable risk.","default_keywords":["adverse trend","trend monitoring","quality indicator","risk threshold","safety trend"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{}},{"id":6,"standard_id":"iso_13485","section_id":"4.1","title":"General Requirements","description":"Establish, document, implement, maintain and improve the QMS.","default_keywords":["quality management system","QMS","processes","outsourced processes","documented procedures","regulatory requirements"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"note":"Parent/aggregate clause. Assess the child requirements separately.","assessment_node":false}},{"id":331,"standard_id":"iso_13485","section_id":"4.1.1","title":"QMS Requirements and Regulatory Roles","description":null,"default_keywords":["QMS requirements","applicable regulatory requirements","organization roles","manufacturer","supplier","authorized representative","importer","distributor"],"created_at":"2026-09-30T03:01:27.520407+00:00","metadata":{"agent_focus":["QMS is established, documented, implemented and maintained","Applicable regulatory roles are documented"],"common_gaps":["Regulatory roles not documented","Applicable regulations listed generically, not per device/market"],"assessment_node":true,"required_evidence":["Quality manual scope statement","Register of applicable regulatory requirements per market","Documented regulatory role(s) of the organization"]}},{"id":332,"standard_id":"iso_13485","section_id":"4.1.2","title":"QMS Processes and Risk-Based Control","description":null,"default_keywords":["QMS processes","process sequence","process interaction","risk-based approach","process control"],"created_at":"2026-09-30T03:01:27.600613+00:00","metadata":{"agent_focus":["Needed QMS processes and their interactions are defined","Controls use a risk-based approach"],"common_gaps":["Process map missing outsourced or support processes","No evidence that control rigor is based on risk"],"assessment_node":true,"required_evidence":["Process map / interaction diagram","Risk-based rationale for process controls"]}},{"id":333,"standard_id":"iso_13485","section_id":"4.1.3","title":"Process Criteria, Resources, Monitoring and Records","description":null,"default_keywords":["process criteria","process effectiveness","resources","monitoring","measurement","analysis","records"],"created_at":"2026-09-30T03:01:27.676817+00:00","metadata":{"agent_focus":["Process criteria and methods are defined","Resources/information are available","Processes are monitored and records retained"],"common_gaps":["Processes lack measurable criteria","Monitoring defined but not performed"],"assessment_node":true,"required_evidence":["Process KPIs and acceptance criteria","Process monitoring records","Resource assignments"]}},{"id":334,"standard_id":"iso_13485","section_id":"4.1.4","title":"Control of QMS Processes and Changes","description":null,"default_keywords":["process control","QMS change","change control","change impact","regulatory impact","medical device impact"],"created_at":"2026-09-30T03:01:27.747014+00:00","metadata":{"agent_focus":["QMS processes are controlled","Changes are evaluated for QMS and medical-device impact before implementation"],"common_gaps":["QMS changes implemented without documented impact assessment"],"assessment_node":true,"required_evidence":["QMS change control procedure","Change records with QMS/device/regulatory impact assessment"]}},{"id":335,"standard_id":"iso_13485","section_id":"4.1.5","title":"Control of Outsourced Processes","description":null,"default_keywords":["outsourced process","supplier control","external provider","quality agreement","purchasing controls","outsourcing risk"],"created_at":"2026-09-30T03:01:27.825889+00:00","metadata":{"agent_focus":["Outsourced processes remain under QMS control","Controls are proportionate to risk and supplier capability","Written quality agreements are considered where required"],"common_gaps":["Outsourced processes not identified as such","No quality agreement with critical outsourced provider","Controls not proportionate to risk"],"applicability":"Applies only if any process affecting product conformity is outsourced; N/A requires a statement that none is.","assessment_node":true,"required_evidence":["List of outsourced processes","Quality agreements","Supplier monitoring records"]}},{"id":336,"standard_id":"iso_13485","section_id":"4.1.6","title":"Validation of QMS Software","description":null,"default_keywords":["QMS software","computer software validation","software validation","CSV","software revalidation","risk-based validation"],"created_at":"2026-09-30T03:01:27.904248+00:00","metadata":{"agent_focus":["Software used in the QMS is validated before initial use","Changes are evaluated for revalidation","Validation effort is proportionate to risk","Validation records are retained"],"common_gaps":["eQMS/ERP/spreadsheets used without validation","No risk-based rationale for validation extent","Software updates not evaluated for revalidation"],"applicability":"Applies to all computer software used in the QMS (eQMS, ERP, LIMS, spreadsheets with logic).","assessment_node":true,"required_evidence":["QMS software inventory","Computer software validation plans/reports","Revalidation assessments after software changes"]}},{"id":7,"standard_id":"iso_13485","section_id":"4.2.1","title":"Documentation Requirements — General","description":"QMS documentation including quality policy, quality manual, procedures, records and documents.","default_keywords":["documentation","quality manual","documented procedures","records","quality policy"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Documentation includes quality policy/objectives, quality manual, required procedures and records","Documents needed for effective planning, operation and control of processes exist"],"common_gaps":["Required procedures missing (e.g. complaint handling, internal audit, CAPA)","Records required by the standard not defined"],"assessment_node":true,"required_evidence":["Document master list","Quality policy and objectives","Quality manual","Required documented procedures"]}},{"id":9,"standard_id":"iso_13485","section_id":"4.2.3","title":"Medical Device File","description":"Maintain a file for each medical device type or family containing documents and records.","default_keywords":["medical device file","device master record","DMR","device history record","DHR","technical file"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["A medical device file exists per device type/family","File covers description, intended use, labeling, specifications, manufacturing/packaging/storage/handling/distribution, measuring/monitoring and installation/servicing procedures as applicable"],"common_gaps":["No file for some device families","File missing labeling, servicing or installation requirements","File not kept current after design changes"],"assessment_node":true,"required_evidence":["Medical device file (or DMR/technical documentation) per device family","Labeling and IFU","Product and manufacturing specifications"]}},{"id":10,"standard_id":"iso_13485","section_id":"4.2.4","title":"Control of Documents","description":"Documents required by the QMS shall be controlled.","default_keywords":["document control","controlled documents","document approval","document revision","obsolete documents","SOP","procedure"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Documents are reviewed and approved before issue and on change","Current revisions available at points of use; obsolete documents controlled","External-origin documents identified and distribution controlled","Changes approved by original function or designated function with access to background"],"common_gaps":["Uncontrolled copies at points of use","Obsolete revisions still accessible","External standards not tracked for new editions","Retention period for obsolete documents not defined"],"assessment_node":true,"required_evidence":["Document control procedure","Document approval/revision history","External document list","Obsolete document handling records"]}},{"id":12,"standard_id":"iso_13485","section_id":"5.1","title":"Management Commitment","description":"Top management shall provide evidence of its commitment to the development and maintenance of the QMS.","default_keywords":["management commitment","top management","regulatory requirements","quality objectives","management review"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Top management communicates the importance of meeting customer and regulatory requirements","Quality policy and objectives established, management reviews conducted, resources available"],"common_gaps":["Top management not visibly involved; QMS delegated entirely to QA"],"assessment_node":true,"required_evidence":["Management review minutes","Communications from top management","Resource allocation decisions"]}},{"id":14,"standard_id":"iso_13485","section_id":"5.3","title":"Quality Policy","description":"Top management shall ensure the quality policy is appropriate to the organisation.","default_keywords":["quality policy","policy statement","commitment to compliance","continual improvement"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Policy is appropriate to purpose and includes commitment to comply and maintain QMS effectiveness","Policy provides a framework for objectives, is communicated, understood and reviewed for suitability"],"common_gaps":["Policy lacks commitment to comply with requirements","Policy never reviewed","Staff cannot relate policy to their work"],"assessment_node":true,"required_evidence":["Quality policy (approved, dated)","Evidence of communication/training","Management review record of policy review"]}},{"id":15,"standard_id":"iso_13485","section_id":"5.4.1","title":"Quality Objectives","description":"Top management shall ensure quality objectives are established at relevant functions and levels.","default_keywords":["quality objectives","measurable objectives","KPI","performance targets"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Quality objectives, including those for product requirements, are set at relevant functions and levels","Objectives are measurable and consistent with the quality policy"],"common_gaps":["Objectives not measurable","No objectives at function level","Objectives not tracked"],"assessment_node":true,"required_evidence":["Quality objectives list with targets and owners","Objective tracking reports"]}},{"id":17,"standard_id":"iso_13485","section_id":"5.5.1","title":"Responsibility and Authority","description":"Top management shall ensure responsibilities and authorities are defined and communicated.","default_keywords":["responsibility","authority","job description","organizational chart","roles"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Responsibilities and authorities are defined, documented and communicated","Interrelation of personnel who manage, perform and verify quality-affecting work is documented","Independence and authority for these tasks is assured"],"common_gaps":["Job descriptions outdated","Verification roles lack independence"],"assessment_node":true,"required_evidence":["Organization chart","Job descriptions","Responsibility/authority matrix"]}},{"id":19,"standard_id":"iso_13485","section_id":"5.5.3","title":"Internal Communication","description":"Top management shall ensure appropriate communication processes are established.","default_keywords":["internal communication","communication process","QMS effectiveness"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Communication processes are established within the organization","Communication regarding QMS effectiveness takes place"],"common_gaps":["No defined channel for communicating QMS performance"],"assessment_node":true,"required_evidence":["Meeting minutes, QMS dashboards, internal notices"]}},{"id":337,"standard_id":"iso_13485","section_id":"5.6.1","title":"Management Review — General","description":null,"default_keywords":["management review","planned intervals","QMS suitability","QMS adequacy","QMS effectiveness","review procedure","review records"],"created_at":"2026-09-30T03:01:28.927209+00:00","metadata":{"agent_focus":["Management reviews occur at documented planned intervals","Review procedure and records are maintained"],"common_gaps":["Reviews not held at documented intervals","No procedure for management review"],"assessment_node":true,"required_evidence":["Management review procedure","Management review schedule","Management review records"]}},{"id":338,"standard_id":"iso_13485","section_id":"5.6.2","title":"Management Review Input","description":null,"default_keywords":["management review inputs","feedback","complaints","regulatory reporting","audits","process performance","product conformity","CAPA","previous actions","QMS changes","regulatory changes","improvement recommendations"],"created_at":"2026-09-30T03:01:29.004181+00:00","metadata":{"agent_focus":["Required input categories are covered by the review","Inputs are supported by current objective evidence"],"common_gaps":["Required inputs missing (e.g. regulatory reporting, new regulations, complaint handling)","Inputs stated without supporting data"],"assessment_node":true,"required_evidence":["Management review agenda/input package covering every required input"]}},{"id":339,"standard_id":"iso_13485","section_id":"5.6.3","title":"Management Review Output","description":null,"default_keywords":["management review outputs","QMS improvement","product improvement","regulatory changes","resource needs","actions","decisions"],"created_at":"2026-09-30T03:01:29.072524+00:00","metadata":{"agent_focus":["Decisions/actions address QMS, product/regulatory needs and resources","Owners and follow-up evidence are traceable"],"common_gaps":["Outputs without owners or due dates","Actions from previous review not closed"],"assessment_node":true,"required_evidence":["Management review minutes with decisions, actions, owners, due dates","Action follow-up records"]}},{"id":21,"standard_id":"iso_13485","section_id":"6.1","title":"Provision of Resources","description":"The organisation shall determine and provide resources needed to implement and maintain the QMS.","default_keywords":["resources","resource planning","infrastructure","budget"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Resources needed to implement/maintain the QMS and meet regulatory and customer requirements are determined and provided"],"common_gaps":["Resource needs identified but not addressed"],"assessment_node":true,"required_evidence":["Resource planning records","Budget/headcount decisions from management review"]}},{"id":22,"standard_id":"iso_13485","section_id":"6.2","title":"Human Resources","description":"Personnel performing work affecting product quality shall be competent.","default_keywords":["human resources","competence","training","qualification","awareness","skills","personnel records"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Competence requirements based on education, training, skills and experience are defined","Training or other actions provided and their effectiveness evaluated (proportionate to risk)","Personnel aware of the relevance of their activities; records of education, training, skills and experience maintained"],"common_gaps":["Training effectiveness not evaluated","Competence requirements undefined for key roles","Training records incomplete for procedure revisions"],"assessment_node":true,"required_evidence":["Competence matrix","Training records","Training effectiveness evaluations"]}},{"id":24,"standard_id":"iso_13485","section_id":"6.4.1","title":"Work Environment","description":"Determine and manage the work environment needed to achieve conformity to product requirements.","default_keywords":["work environment","environmental conditions","cleanroom","temperature","humidity","environmental monitoring"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Work environment requirements needed for product conformity are documented","Environmental conditions are monitored/controlled per documented procedures where they can affect product quality","Health, cleanliness and clothing requirements for personnel are documented where applicable"],"common_gaps":["Environmental limits defined but not monitored","Excursions not investigated"],"assessment_node":true,"required_evidence":["Work environment requirements","Environmental monitoring records","Personnel hygiene/gowning procedures"]}},{"id":25,"standard_id":"iso_13485","section_id":"6.4.2","title":"Contamination Control","description":"Make arrangements for controlling contaminated or potentially contaminated product.","default_keywords":["contamination control","contamination","sterile","clean area","gowning","bioburden"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Arrangements for control of contaminated or potentially contaminated product are documented","For sterile devices, microorganism/particulate contamination control is documented and cleanliness maintained during assembly/packaging"],"common_gaps":["No arrangements for returned/contaminated product","Cleanroom classification not maintained"],"applicability":"Second part applies only to sterile medical devices.","assessment_node":true,"required_evidence":["Contamination control procedure","Cleanroom monitoring/bioburden data (sterile devices)"]}},{"id":27,"standard_id":"iso_13485","section_id":"7.2.1","title":"Determination of Requirements Related to Product","description":"Determine requirements specified by the customer, regulatory, and use requirements.","default_keywords":["customer requirements","intended use","regulatory requirements","product requirements","user needs"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Customer-specified requirements including delivery and post-delivery activities are determined","Unstated requirements for intended use, applicable regulatory requirements and user training needs are determined"],"common_gaps":["User training needs not determined","Regulatory requirements not traced to product requirements"],"assessment_node":true,"required_evidence":["Product requirements specification","Intended use statement","Regulatory requirements register","User training requirements"]}},{"id":28,"standard_id":"iso_13485","section_id":"7.2.2","title":"Review of Requirements Related to Product","description":"Review requirements related to the product before commitment to supply.","default_keywords":["requirements review","contract review","order review","tender review"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Requirements are reviewed before commitment to supply","Review confirms requirements are defined, differences resolved, regulatory requirements met, training available and capability to meet them","Review results and actions are recorded; changed requirements are amended and communicated"],"common_gaps":["Orders accepted without documented review","Changed requirements not communicated internally"],"assessment_node":true,"required_evidence":["Contract/order review records","Records of requirement changes communicated"]}},{"id":29,"standard_id":"iso_13485","section_id":"7.2.3","title":"Communication","description":"Determine and implement effective arrangements for communicating with customers.","default_keywords":["customer communication","product information","feedback","complaints","advisory notices"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Communication arrangements cover product information, enquiries/orders/amendments, customer feedback including complaints, and advisory notices","Communication with regulatory authorities is planned per applicable regulations"],"common_gaps":["No planned communication with regulatory authorities"],"assessment_node":true,"required_evidence":["Customer communication procedure","Advisory notice procedure","Regulatory communication plan"]}},{"id":30,"standard_id":"iso_13485","section_id":"7.3.1","title":"Design and Development — General","description":"Document and maintain procedures for design and development of product.","default_keywords":["design and development","design controls","design procedure"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Documented procedures for design and development exist"],"common_gaps":["Design control procedure missing or not followed for software/changes"],"applicability":"7.3 may be excluded only if regulations permit and the exclusion is justified in the quality manual.","assessment_node":true,"required_evidence":["Design and development procedure"]}},{"id":31,"standard_id":"iso_13485","section_id":"7.3.2","title":"Design and Development Planning","description":"Plan and control the design and development of product.","default_keywords":["design planning","development planning","design stages","design reviews","design team","design schedule"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Design is planned and controlled with documented plans updated as it progresses","Plans define stages, reviews, verification, validation, transfer activities, responsibilities and resources","Traceability of design outputs to design inputs is planned"],"common_gaps":["Plan never updated as project evolved","Traceability approach not planned"],"assessment_node":true,"required_evidence":["Design and development plan (with revisions)"]}},{"id":33,"standard_id":"iso_13485","section_id":"7.3.4","title":"Design and Development Outputs","description":"Outputs shall be provided in a form that enables verification against inputs.","default_keywords":["design outputs","drawings","specifications","acceptance criteria","labeling requirements"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Outputs meet input requirements and provide information for purchasing, production and service","Outputs contain or reference acceptance criteria and specify characteristics essential for safe and proper use","Outputs are approved before release and records maintained"],"common_gaps":["Essential characteristics not identified","Outputs released without approval"],"assessment_node":true,"required_evidence":["Drawings, specifications, software releases","Traceability matrix inputs to outputs","Output approval records"]}},{"id":34,"standard_id":"iso_13485","section_id":"7.3.5","title":"Design and Development Review","description":"At suitable stages, systematic reviews of design and development shall be performed.","default_keywords":["design review","design review record","formal review","review participants"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Systematic design reviews occur at suitable stages per plan","Participants include representatives of the functions concerned and other specialists","Review records include design identification, participants and date"],"common_gaps":["Reviews lack independent participants","Review actions not closed"],"assessment_node":true,"required_evidence":["Design review minutes","Attendance lists","Action item follow-up"]}},{"id":36,"standard_id":"iso_13485","section_id":"7.3.7","title":"Design and Development Validation","description":"Validation shall be performed to ensure the resulting product is capable of meeting requirements for specified application or intended use.","default_keywords":["design validation","validation protocol","validation report","clinical evaluation","usability","intended use","simulated use"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Validation confirms the product meets requirements for its intended use","Validation is performed on initial production units or equivalents (rationale recorded) before release for use","Clinical evaluation and/or performance evaluation per regulatory requirements; records retained"],"common_gaps":["Validation on prototypes without equivalence rationale","Clinical evaluation not performed or outdated"],"assessment_node":true,"required_evidence":["Validation protocols and reports","Clinical/performance evaluation report","Usability validation (summative) report","Rationale for units used"]}},{"id":37,"standard_id":"iso_13485","section_id":"7.3.8","title":"Design and Development Transfer","description":"Transfer of design and development outputs to manufacturing shall be controlled.","default_keywords":["design transfer","technology transfer","manufacturing transfer","production release"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Documented procedures for transfer of design outputs to manufacturing","Outputs verified as suitable for manufacturing before becoming final production specifications","Production capability to meet product requirements is confirmed; results recorded"],"common_gaps":["Transfer not documented; production started from engineering drafts"],"assessment_node":true,"required_evidence":["Design transfer procedure","Transfer checklist/report","Pilot/production capability evidence"]}},{"id":38,"standard_id":"iso_13485","section_id":"7.3.9","title":"Control of Design and Development Changes","description":"Design and development changes shall be identified and records maintained.","default_keywords":["design change","change control","design change order","ECO","change request","impact assessment"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Design changes are identified, reviewed, verified, validated as appropriate and approved before implementation","Change impact on constituent parts, product in process or delivered, risk management inputs/outputs and realization processes is evaluated","Significance of change to function, performance, usability, safety and regulatory requirements determined; records maintained"],"common_gaps":["No regulatory significance assessment","Risk file not updated for changes","Changes implemented before approval"],"assessment_node":true,"required_evidence":["Design change records","Change impact assessments","Regulatory assessment of change significance"]}},{"id":40,"standard_id":"iso_13485","section_id":"7.4.1","title":"Purchasing Process","description":"Ensure purchased product conforms to specified purchase requirements.","default_keywords":["purchasing","supplier control","supplier evaluation","approved supplier list","supplier qualification","critical supplier"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Documented procedures ensure purchased product conforms to purchasing information","Supplier evaluation/selection criteria are based on ability to supply, performance, effect on device quality and risk","Suppliers are monitored and re-evaluated; nonfulfilment addressed proportionately to risk; records kept"],"common_gaps":["Suppliers never re-evaluated","Criteria not risk-based","Critical suppliers without audits or quality agreements"],"assessment_node":true,"required_evidence":["Purchasing procedure","Approved supplier list","Supplier evaluations and re-evaluations","Supplier monitoring data"]}},{"id":42,"standard_id":"iso_13485","section_id":"7.4.3","title":"Verification of Purchased Product","description":"Establish and implement the inspection or other activities necessary for ensuring purchased product meets requirements.","default_keywords":["incoming inspection","receiving inspection","supplier verification","certificate of conformance","COC"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Verification activities for purchased product are established based on supplier evaluation and risk","Changes to purchased product are evaluated for effect on realization or the device","Verification records maintained, including verification at supplier premises where planned"],"common_gaps":["Inspection level not linked to risk","Supplier changes accepted without evaluation"],"assessment_node":true,"required_evidence":["Incoming inspection procedure and records","Certificates of conformance"]}},{"id":43,"standard_id":"iso_13485","section_id":"7.5.1","title":"Control of Production and Service Provision","description":"Plan and carry out production and service provision under controlled conditions.","default_keywords":["production control","manufacturing controls","work instructions","batch record","device history record","DHR","in-process inspection"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Production is planned, performed, monitored and controlled so product conforms to specification","Controls include documented procedures, qualified infrastructure, monitoring/measurement of parameters, labeling/packaging operations and defined release/delivery/post-delivery activities","A record per device or batch provides traceability and identifies amount manufactured and approved for distribution; it is verified and approved"],"common_gaps":["Batch records incomplete or not approved","Labeling operations uncontrolled"],"assessment_node":true,"required_evidence":["Work instructions","Batch/device history records","Labeling/packaging controls","Release records"]}},{"id":45,"standard_id":"iso_13485","section_id":"7.5.3","title":"Installation Activities","description":"Document requirements for installation and installation verification.","default_keywords":["installation","installation qualification","IQ","site installation","installation record"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Requirements for device installation and acceptance criteria for verification of installation are documented","If installation is performed by an external party, installation and verification requirements are provided to them","Records of installation and verification are maintained"],"common_gaps":["Third-party installers not given requirements","No installation records"],"applicability":"Applies only if the device requires installation.","assessment_node":true,"required_evidence":["Installation instructions","Installation acceptance criteria","Installation records"]}},{"id":47,"standard_id":"iso_13485","section_id":"7.5.5","title":"Particular Requirements for Sterile Medical Devices","description":"Maintain records of sterilization process parameters for each sterilization batch.","default_keywords":["sterile","sterilization","sterility","sterilization batch","sterilization record","SAL"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Records of sterilization process parameters are maintained for each sterilization batch","Sterilization records are traceable to each production batch of medical devices"],"common_gaps":["Sterilization loads not traceable to product batches"],"applicability":"Applies only to sterile medical devices.","assessment_node":true,"required_evidence":["Sterilization batch records","Link from sterilization load to production batch"]}},{"id":48,"standard_id":"iso_13485","section_id":"7.5.6","title":"Validation of Processes for Production and Service Provision","description":"Validate processes for production where output cannot be verified by subsequent monitoring or measurement.","default_keywords":["process validation","IQ","OQ","PQ","validation protocol","validation report","revalidation"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Processes whose output cannot be or is not verified by subsequent monitoring/measurement are validated","Procedures cover review/approval criteria, equipment qualification, personnel qualification, methods, statistical techniques with sample size rationale, records and revalidation criteria","Validation of software used in production/service is documented, proportionate to risk, with records"],"common_gaps":["Special processes (e.g. sealing, welding, bonding) not validated","Production software not validated","No revalidation triggers"],"assessment_node":true,"required_evidence":["Process validation master plan","IQ/OQ/PQ protocols and reports","Production software validation records","Revalidation criteria"]}},{"id":50,"standard_id":"iso_13485","section_id":"7.5.8","title":"Identification","description":"Identify product throughout product realization.","default_keywords":["product identification","labeling","part number","lot number","batch number","UDI","unique device identification"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Product is identified by suitable means throughout realization","Product status with respect to monitoring/measurement requirements is identified so only conforming product is released","A system for assigning unique device identification is documented where required by regulations; returned product is identified and segregated"],"common_gaps":["Inspection status not visible","UDI not assigned where required","Returned product not segregated"],"assessment_node":true,"required_evidence":["Identification/labeling procedure","Inspection status indicators","UDI procedure and records"]}},{"id":340,"standard_id":"iso_13485","section_id":"7.5.9.1","title":"Traceability — General","description":null,"default_keywords":["traceability","documented procedure","extent of traceability","required records","materials","components","processing conditions"],"created_at":"2026-09-30T03:01:31.297066+00:00","metadata":{"agent_focus":["Traceability extent is defined according to regulatory requirements","Required traceability records are maintained"],"common_gaps":["Traceability extent undefined","Cannot trace from finished device to components or customers"],"assessment_node":true,"required_evidence":["Traceability procedure","Batch/lot and component traceability records","Distribution records"]}},{"id":341,"standard_id":"iso_13485","section_id":"7.5.9.2","title":"Particular Requirements for Implantable Medical Devices","description":null,"default_keywords":["implantable medical device","implantable traceability","components","materials","work environment","distribution records","consignee"],"created_at":"2026-09-30T03:01:31.375905+00:00","metadata":{"agent_focus":["Implantable-device traceability captures required materials/components/conditions","Distribution records support traceability"],"common_gaps":["Distributors not required to keep traceability records"],"applicability":"Applies only to implantable medical devices.","assessment_node":true,"required_evidence":["Implant traceability records","Distribution agent traceability agreements"]}},{"id":52,"standard_id":"iso_13485","section_id":"7.5.10","title":"Customer Property","description":"Exercise care with customer property while it is under the organisation's control.","default_keywords":["customer property","customer-supplied product","customer asset","patient data"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Customer property under the organization's control is identified, verified, protected and safeguarded","Loss, damage or unsuitability is reported to the customer and recorded (includes intellectual property and confidential health information)"],"common_gaps":["Patient data not recognized as customer property"],"applicability":"Applies only when customer property (including IP or confidential health information) is under the organization's control.","assessment_node":true,"required_evidence":["Customer property register","Records of reported loss/damage"]}},{"id":54,"standard_id":"iso_13485","section_id":"7.6","title":"Control of Monitoring and Measuring Equipment","description":"Determine the monitoring and measurement to be undertaken and the equipment needed.","default_keywords":["calibration","measuring equipment","monitoring equipment","calibration records","calibration certificate","measurement uncertainty"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Monitoring/measurement needed to provide evidence of product conformity is determined","Equipment is calibrated/verified at specified intervals against traceable standards, identified for status, safeguarded and protected","Validity of previous results is assessed when equipment is found nonconforming","Software used for monitoring/measurement is validated before use; calibration records maintained"],"common_gaps":["Out-of-tolerance findings without impact assessment","Calibration overdue","Test software not validated"],"assessment_node":true,"required_evidence":["Calibration procedure","Equipment calibration register and certificates","Out-of-tolerance impact assessments","Measurement software validation"]}},{"id":55,"standard_id":"iso_13485","section_id":"8.1","title":"General — Measurement Analysis and Improvement","description":"Plan and implement the monitoring, measurement, analysis and improvement processes needed.","default_keywords":["measurement","analysis","improvement","statistical techniques","monitoring"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Monitoring, measurement, analysis and improvement processes demonstrate product conformity and QMS conformity/effectiveness","Appropriate methods including statistical techniques are determined"],"common_gaps":["Statistical techniques used without documented rationale"],"assessment_node":true,"required_evidence":["Monitoring and measurement plan","Statistical techniques procedure"]}},{"id":56,"standard_id":"iso_13485","section_id":"8.2.1","title":"Feedback","description":"Monitor information relating to whether the organisation has met customer requirements.","default_keywords":["customer feedback","post-market surveillance","post-market data","feedback system","complaint trend"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Information on whether customer requirements have been met is gathered and monitored","Feedback process includes production and post-production data","Feedback is an input to risk management and to product realization/improvement processes"],"common_gaps":["Feedback not fed back into risk management","Only complaints collected, no proactive post-market data"],"assessment_node":true,"required_evidence":["Feedback/post-market surveillance procedure","PMS plan and reports","Evidence feedback updates the risk file"]}},{"id":57,"standard_id":"iso_13485","section_id":"8.2.2","title":"Complaint Handling","description":"Document a procedure for timely complaint handling.","default_keywords":["complaint","complaint handling","complaint investigation","customer complaint","complaint record","reportable complaint"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Documented complaint-handling procedure covers receiving, evaluating, investigating and deciding actions","Complaints are evaluated for reportability to regulatory authorities","Non-investigated complaints are justified; corrections/corrective actions are taken; records maintained"],"common_gaps":["Reportability decision not documented","No justification for uninvestigated complaints","Timeliness not defined or not met"],"assessment_node":true,"required_evidence":["Complaint handling procedure","Complaint files with reportability assessment","Investigation records"]}},{"id":59,"standard_id":"iso_13485","section_id":"8.2.4","title":"Internal Audit","description":"Conduct internal audits at planned intervals to determine whether the QMS conforms.","default_keywords":["internal audit","audit plan","audit schedule","audit report","audit findings","auditor","audit checklist"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Internal audits are conducted at planned intervals per a documented procedure","Audit program considers status/importance of processes and prior results; criteria, scope, frequency and methods defined","Auditors do not audit their own work; nonconformities are corrected without undue delay and follow-up verified; records maintained"],"common_gaps":["Not all processes audited in the cycle","Auditors audit own area","Findings not followed up"],"assessment_node":true,"required_evidence":["Internal audit procedure","Audit program/schedule","Audit reports","Auditor qualification records"]}},{"id":61,"standard_id":"iso_13485","section_id":"8.2.6","title":"Monitoring and Measurement of Product","description":"Monitor and measure characteristics of product to verify product requirements are met.","default_keywords":["product inspection","product testing","final inspection","acceptance testing","release criteria","certificate of conformance"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Product characteristics are monitored/measured at applicable stages per planned arrangements","Evidence of conformity to acceptance criteria is maintained","Records identify the person authorizing release; test equipment is identified where required"],"common_gaps":["Release authority not recorded","Acceptance criteria missing"],"assessment_node":true,"required_evidence":["Inspection and test procedures","Final inspection/release records","Release authorization records"]}},{"id":62,"standard_id":"iso_13485","section_id":"8.3.1","title":"Control of Nonconforming Product — General","description":"Ensure product that does not conform to product requirements is identified and controlled.","default_keywords":["nonconforming product","nonconformance","NCR","disposition","quarantine","rejection"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Nonconforming product is identified and controlled to prevent unintended use or delivery","A documented procedure defines controls, responsibilities and authorities for identification, documentation, segregation, evaluation and disposition","Evaluation includes need for investigation and notification of external parties; records maintained"],"common_gaps":["NCRs without evaluation for investigation or external notification","Quarantine not controlled"],"assessment_node":true,"required_evidence":["Nonconforming product procedure","NCR records","Quarantine/segregation evidence"]}},{"id":64,"standard_id":"iso_13485","section_id":"8.3.3","title":"Nonconforming Product After Delivery","description":"Take appropriate action on nonconforming product detected after delivery.","default_keywords":["field nonconformance","product recall","field correction","FSCA","advisory notice","customer notification"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Nonconforming product detected after delivery is addressed with actions appropriate to its effects","A procedure for issuing advisory notices exists and can be put into effect at any time; records maintained"],"common_gaps":["Advisory notice procedure never tested or not executable at any time"],"assessment_node":true,"required_evidence":["Advisory notice / recall procedure","Field action records"]}},{"id":66,"standard_id":"iso_13485","section_id":"8.4","title":"Analysis of Data","description":"Determine, collect and analyse appropriate data to demonstrate suitability and effectiveness of the QMS.","default_keywords":["data analysis","trend analysis","statistical analysis","quality data","performance data","post-market data"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Documented procedures determine, collect and analyze appropriate data, including statistical techniques","Analysis covers feedback, product conformity, process/product trends including opportunities for improvement, suppliers, audits and service reports","Records of analysis results are maintained; inadequate results feed improvement"],"common_gaps":["Data collected but not trended","Supplier or service data not analyzed"],"assessment_node":true,"required_evidence":["Data analysis procedure","Trend reports (complaints, NCRs, suppliers, audits, service)"]}},{"id":67,"standard_id":"iso_13485","section_id":"8.5.1","title":"Improvement — General","description":"Identify and implement changes necessary to ensure the continuing suitability, adequacy and effectiveness of the QMS.","default_keywords":["continual improvement","improvement","quality improvement","opportunities for improvement"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Changes needed to ensure and maintain QMS suitability, adequacy and effectiveness and device safety/performance are identified and implemented","Improvement uses quality policy, objectives, audit results, post-market surveillance, data analysis, CAPA and management review"],"common_gaps":["No link between data analysis and improvement actions"],"assessment_node":true,"required_evidence":["Improvement actions from management review, CAPA and data analysis"]}},{"id":69,"standard_id":"iso_13485","section_id":"8.5.3","title":"Preventive Action","description":"Determine action to eliminate the cause of potential nonconformities to prevent occurrence.","default_keywords":["preventive action","CAPA","risk prevention","preventive action plan","PAR"],"created_at":"2026-07-29T00:59:05.827087+00:00","metadata":{"agent_focus":["Documented preventive action procedure covers determining potential nonconformities and causes, evaluating need for action, implementing actions","Preventive actions are proportionate to effects of potential problems; effectiveness reviewed; records maintained"],"common_gaps":["No preventive actions ever raised; everything handled reactively"],"assessment_node":true,"required_evidence":["Preventive action records","Trend-triggered actions"]}}]$ref$::jsonb)
on conflict do nothing;
select setval(pg_get_serial_sequence('public.standard_sections', 'id'), greatest((select max(id) from public.standard_sections), 1));
-- predefined_questions: 60 row(s)
insert into public.predefined_questions (id, standard_id, question_text, hint_short, tags, category, sort_order, created_at)
select id, standard_id, question_text, hint_short, tags, category, sort_order, created_at from jsonb_populate_recordset(null::public.predefined_questions, $ref$[{"id":1,"standard_id":"iso_27001","question_text":"What are the key Annex A controls missing from our documentation?","hint_short":"Missing Controls","tags":["controls","gap","compliance"],"category":"Gap Analysis","sort_order":1,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":2,"standard_id":"iso_27001","question_text":"Identify gaps between our current state and ISMS requirements.","hint_short":"ISMS Gaps","tags":["gap","compliance","readiness"],"category":"Gap Analysis","sort_order":2,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":3,"standard_id":"iso_27001","question_text":"Which controls lack evidence of implementation?","hint_short":"Missing Evidence","tags":["evidence","audit","gap"],"category":"Audit Prep","sort_order":3,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":4,"standard_id":"iso_27001","question_text":"What's our status against ISO 27001:2022 clauses?","hint_short":"Compliance Status","tags":["status","compliance","clauses"],"category":"Audit Prep","sort_order":4,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":5,"standard_id":"iso_27001","question_text":"List all access control risks not yet mitigated.","hint_short":"Access Control Risks","tags":["risk","access","mitigation"],"category":"Risk Management","sort_order":5,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":6,"standard_id":"iso_27001","question_text":"Which personnel lack required security awareness training?","hint_short":"Training Gaps","tags":["training","awareness","personnel","gap"],"category":"People & Culture","sort_order":6,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":7,"standard_id":"iso_27001","question_text":"Are our incident response procedures documented and tested?","hint_short":"Incident Response","tags":["incident","response","procedure","testing"],"category":"Incident Management","sort_order":7,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":8,"standard_id":"iso_27001","question_text":"What cryptography controls are not yet implemented?","hint_short":"Cryptography Gaps","tags":["cryptography","encryption","gap"],"category":"Technical Controls","sort_order":8,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":9,"standard_id":"iso_27001","question_text":"Identify third-party vendors without security agreements.","hint_short":"Vendor Security","tags":["vendor","supplier","agreement","gap"],"category":"Supplier Management","sort_order":9,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":10,"standard_id":"iso_27001","question_text":"Which asset inventories are incomplete or outdated?","hint_short":"Asset Inventory","tags":["asset","inventory","gap"],"category":"Asset Management","sort_order":10,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":11,"standard_id":"iso_27001","question_text":"Are physical access controls adequate for all facilities?","hint_short":"Physical Security","tags":["physical","access","facilities","controls"],"category":"Physical Security","sort_order":11,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":12,"standard_id":"iso_27001","question_text":"What network security controls need strengthening?","hint_short":"Network Security","tags":["network","security","controls"],"category":"Technical Controls","sort_order":12,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":13,"standard_id":"iso_27001","question_text":"Do all data classification labels match our policy?","hint_short":"Data Classification","tags":["data","classification","labels"],"category":"Data Management","sort_order":13,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":14,"standard_id":"iso_27001","question_text":"List roles and responsibilities not yet assigned.","hint_short":"Role Assignment","tags":["roles","responsibilities","gap"],"category":"Organization","sort_order":14,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":15,"standard_id":"iso_27001","question_text":"Which business continuity plans lack testing evidence?","hint_short":"BC/DR Testing","tags":["continuity","disaster","recovery","testing"],"category":"Continuity","sort_order":15,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":16,"standard_id":"iso_27001","question_text":"Are change management procedures followed for all system changes?","hint_short":"Change Management","tags":["change","management","procedure","controls"],"category":"Operations","sort_order":16,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":17,"standard_id":"iso_27001","question_text":"Identify unpatched systems and outdated software.","hint_short":"Patch Management","tags":["patch","update","vulnerability","gap"],"category":"Technical Controls","sort_order":17,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":18,"standard_id":"iso_27001","question_text":"What monitoring and logging gaps exist in our environment?","hint_short":"Monitoring Gaps","tags":["monitoring","logging","gap","controls"],"category":"Operations","sort_order":18,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":19,"standard_id":"iso_27001","question_text":"Are all security policies current and communicated?","hint_short":"Policy Currency","tags":["policy","current","communication"],"category":"Governance","sort_order":19,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":20,"standard_id":"iso_27001","question_text":"Which exceptions to information security policy are unauthorized?","hint_short":"Policy Exceptions","tags":["exception","policy","variance","authorization"],"category":"Governance","sort_order":20,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":21,"standard_id":"iso_13485","question_text":"What design control activities are incomplete?","hint_short":"Design Controls","tags":["design","gap","activity"],"category":"Design Controls","sort_order":1,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":22,"standard_id":"iso_13485","question_text":"Identify requirements without linked test cases.","hint_short":"Unlinked Reqs","tags":["requirement","test","traceability","gap"],"category":"Traceability","sort_order":2,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":23,"standard_id":"iso_13485","question_text":"Which risks lack documented mitigation plans?","hint_short":"Risk Mitigation Gaps","tags":["risk","mitigation","gap"],"category":"Risk Management","sort_order":3,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":24,"standard_id":"iso_13485","question_text":"Are there NCRs without linked CAPAs?","hint_short":"NCR CAPA Gaps","tags":["ncr","capa","traceability"],"category":"Quality","sort_order":4,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":25,"standard_id":"iso_13485","question_text":"Check traceability gaps in our product.","hint_short":"Traceability Check","tags":["traceability","gap","product"],"category":"Traceability","sort_order":5,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":26,"standard_id":"iso_13485","question_text":"Which suppliers lack current quality agreements?","hint_short":"Supplier Agreements","tags":["supplier","agreement","quality","gap"],"category":"Supplier Management","sort_order":6,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":27,"standard_id":"iso_13485","question_text":"Are design changes properly documented and approved?","hint_short":"Design Changes","tags":["design","change","control","documentation"],"category":"Design Controls","sort_order":7,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":28,"standard_id":"iso_13485","question_text":"What production process validation records are missing?","hint_short":"Process Validation","tags":["process","validation","production","gap"],"category":"Production","sort_order":8,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":29,"standard_id":"iso_13485","question_text":"Identify product batches lacking proper traceability records.","hint_short":"Batch Traceability","tags":["batch","traceability","records","gap"],"category":"Traceability","sort_order":9,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":30,"standard_id":"iso_13485","question_text":"Which field actions lack proper effectiveness checks?","hint_short":"Field Actions","tags":["field","action","effectiveness","gap"],"category":"Post-Market","sort_order":10,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":31,"standard_id":"iso_13485","question_text":"Are all inspection and test records complete and retained?","hint_short":"Inspection Records","tags":["inspection","test","records","retention"],"category":"Quality","sort_order":11,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":32,"standard_id":"iso_13485","question_text":"What management review meeting records are overdue?","hint_short":"Management Review","tags":["management","review","meeting","records"],"category":"Management","sort_order":12,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":33,"standard_id":"iso_13485","question_text":"Identify non-conformances without root cause analysis.","hint_short":"Root Cause Gaps","tags":["non-conformance","root-cause","analysis","gap"],"category":"Quality","sort_order":13,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":34,"standard_id":"iso_13485","question_text":"Are complaint handling procedures adequately documented?","hint_short":"Complaint Handling","tags":["complaint","procedure","documentation","controls"],"category":"Post-Market","sort_order":14,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":35,"standard_id":"iso_13485","question_text":"Which product labeling or instructions lack approval records?","hint_short":"Labeling Controls","tags":["label","instruction","approval","records"],"category":"Design Controls","sort_order":15,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":36,"standard_id":"iso_13485","question_text":"List internal audits not yet completed this year.","hint_short":"Internal Audits","tags":["audit","internal","schedule","overdue"],"category":"Quality","sort_order":16,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":37,"standard_id":"iso_13485","question_text":"Are post-market surveillance activities documented and current?","hint_short":"PMS Documentation","tags":["surveillance","post-market","documentation"],"category":"Post-Market","sort_order":17,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":38,"standard_id":"iso_13485","question_text":"What sterilization or preservation validations are pending?","hint_short":"Sterilization Valid","tags":["sterilization","preservation","validation","pending"],"category":"Production","sort_order":18,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":39,"standard_id":"iso_13485","question_text":"Identify customer feedback not yet triaged or actioned.","hint_short":"Customer Feedback","tags":["customer","feedback","triage","action"],"category":"Post-Market","sort_order":19,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":40,"standard_id":"iso_13485","question_text":"Are management responsibility and accountability clearly defined?","hint_short":"Responsibility Matrix","tags":["responsibility","accountability","organization","roles"],"category":"Management","sort_order":20,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":41,"standard_id":"iec_62304","question_text":"What residual risks exceed acceptable thresholds?","hint_short":"Residual Risk","tags":["risk","threshold","mitigation","residual"],"category":"Risk Management","sort_order":1,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":42,"standard_id":"iec_62304","question_text":"List hazards without documented mitigations.","hint_short":"Unmitigated Hazards","tags":["hazard","mitigation","gap"],"category":"Risk Management","sort_order":2,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":43,"standard_id":"iec_62304","question_text":"Which risk controls lack verification evidence?","hint_short":"Risk Control Evidence","tags":["risk","control","evidence","audit"],"category":"Audit Prep","sort_order":3,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":44,"standard_id":"iec_62304","question_text":"Identify post-market surveillance gaps.","hint_short":"PMS Gaps","tags":["surveillance","gap","post-market"],"category":"Post-Market","sort_order":4,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":45,"standard_id":"iec_62304","question_text":"Are all foreseeable use cases covered by risk analysis?","hint_short":"Use Case Coverage","tags":["use-case","risk","analysis"],"category":"Risk Management","sort_order":5,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":46,"standard_id":"iec_62304","question_text":"What software requirements lack traceability to design?","hint_short":"Requirements Traceability","tags":["requirement","traceability","design","gap"],"category":"Traceability","sort_order":6,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":47,"standard_id":"iec_62304","question_text":"Which safety functions lack adequate verification testing?","hint_short":"Safety Function Testing","tags":["safety","function","verification","testing"],"category":"Verification","sort_order":7,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":48,"standard_id":"iec_62304","question_text":"Are all software integration test cases documented?","hint_short":"Integration Testing","tags":["integration","test","documentation"],"category":"Verification","sort_order":8,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":49,"standard_id":"iec_62304","question_text":"Identify unresolved software verification anomalies.","hint_short":"Verification Anomalies","tags":["anomaly","verification","unresolved","gap"],"category":"Verification","sort_order":9,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":50,"standard_id":"iec_62304","question_text":"What documented evidence supports our software safety class?","hint_short":"Safety Class Evidence","tags":["safety","class","evidence","documentation"],"category":"Documentation","sort_order":10,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":51,"standard_id":"iec_62304","question_text":"Are release notes and software version records current?","hint_short":"Release Documentation","tags":["release","version","documentation","notes"],"category":"Documentation","sort_order":11,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":52,"standard_id":"iec_62304","question_text":"List configuration management procedures lacking implementation detail.","hint_short":"Configuration Mgmt","tags":["configuration","management","procedure","gap"],"category":"Configuration","sort_order":12,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":53,"standard_id":"iec_62304","question_text":"Which security vulnerabilities have not been assessed?","hint_short":"Security Assessment","tags":["security","vulnerability","assessment","gap"],"category":"Security","sort_order":13,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":54,"standard_id":"iec_62304","question_text":"Are all problem resolution records linked to root cause?","hint_short":"Problem Resolution","tags":["problem","resolution","root-cause","traceability"],"category":"Quality","sort_order":14,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":55,"standard_id":"iec_62304","question_text":"What software maintenance procedures need documented evidence?","hint_short":"Maintenance Evidence","tags":["maintenance","procedure","documentation","evidence"],"category":"Maintenance","sort_order":15,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":56,"standard_id":"iec_62304","question_text":"Identify code review records lacking for critical modules.","hint_short":"Code Review Records","tags":["code","review","records","critical"],"category":"Development","sort_order":16,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":57,"standard_id":"iec_62304","question_text":"Are off-the-shelf software components properly evaluated and documented?","hint_short":"COTS Evaluation","tags":["cots","component","evaluation","documentation"],"category":"Procurement","sort_order":17,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":58,"standard_id":"iec_62304","question_text":"Which software change requests lack traceability to test results?","hint_short":"Change Traceability","tags":["change","request","traceability","testing"],"category":"Traceability","sort_order":18,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":59,"standard_id":"iec_62304","question_text":"List user documentation gaps affecting device operation or safety.","hint_short":"User Documentation","tags":["documentation","user","operation","safety"],"category":"Documentation","sort_order":19,"created_at":"2026-07-29T00:59:05.827087+00:00"},{"id":60,"standard_id":"iec_62304","question_text":"Are all deviations from development standards documented and approved?","hint_short":"Development Deviations","tags":["deviation","standard","development","approval"],"category":"Development","sort_order":20,"created_at":"2026-07-29T00:59:05.827087+00:00"}]$ref$::jsonb)
on conflict do nothing;
select setval(pg_get_serial_sequence('public.predefined_questions', 'id'), greatest((select max(id) from public.predefined_questions), 1));
-- rag_settings: 21 row(s)
insert into public.rag_settings (id, key, value, description, data_type, min_value, max_value, tooltip, category, created_at, updated_at)
select id, key, value, description, data_type, min_value, max_value, tooltip, category, created_at, updated_at from jsonb_populate_recordset(null::public.rag_settings, $ref$[{"id":1,"key":"similarity_threshold","value":"0.2","description":"Minimum similarity score (0-1) for vector search matches","data_type":"float","min_value":0,"max_value":1,"tooltip":"Lower = more results but lower quality. Higher = fewer but higher quality results. Typical range: 0.15-0.35","category":"Search","created_at":"2026-07-29T00:59:05.827087","updated_at":"2026-07-29T00:59:05.827087"},{"id":2,"key":"top_k_chunks","value":"20","description":"Number of document chunks to retrieve per query","data_type":"int","min_value":1,"max_value":20,"tooltip":"More chunks = longer context but more token usage and cost. Default: 5","category":"Search","created_at":"2026-07-29T00:59:05.827087","updated_at":"2026-07-29T00:59:05.827087"},{"id":3,"key":"chunk_size","value":"1000","description":"Characters per chunk when splitting documents","data_type":"int","min_value":100,"max_value":5000,"tooltip":"Smaller chunks = more granular but more total chunks. Larger chunks = fewer chunks but less precise. Default: 1000","category":"Indexing","created_at":"2026-07-29T00:59:05.827087","updated_at":"2026-07-29T00:59:05.827087"},{"id":4,"key":"chunk_overlap","value":"199","description":"Character overlap between adjacent chunks","data_type":"int","min_value":0,"max_value":1000,"tooltip":"Helps preserve context across chunk boundaries. Typically 10-20% of chunk_size. Default: 200","category":"Indexing","created_at":"2026-07-29T00:59:05.827087","updated_at":"2026-07-29T00:59:05.827087"},{"id":5,"key":"embedding_model","value":"text-embedding-3-small","description":"OpenAI embedding model to use","data_type":"text","min_value":null,"max_value":null,"tooltip":"Options: text-embedding-3-small (cheap, fast), text-embedding-3-large (expensive, better quality)","category":"Models","created_at":"2026-07-29T00:59:05.827087","updated_at":"2026-07-29T00:59:05.827087"},{"id":6,"key":"chat_model","value":"gpt-4o","description":"OpenAI chat model for generating answers","data_type":"text","min_value":null,"max_value":null,"tooltip":"Options: gpt-4o (best quality), gpt-4-turbo (cheaper), gpt-3.5-turbo (cheapest)","category":"Models","created_at":"2026-07-29T00:59:05.827087","updated_at":"2026-07-29T00:59:05.827087"},{"id":7,"key":"router_temperature","value":"0.1","description":"Temperature for query classification (0-1)","data_type":"float","min_value":0,"max_value":1,"tooltip":"Lower = more deterministic routing. Higher = more creative. Default: 0.1 (very strict)","category":"Router","created_at":"2026-07-29T00:59:05.827087","updated_at":"2026-07-29T00:59:05.827087"},{"id":8,"key":"answer_temperature","value":"0.29","description":"Temperature for answer generation (0-1)","data_type":"float","min_value":0,"max_value":1,"tooltip":"Lower = more factual. Higher = more creative. Default: 0.3 (mostly factual)","category":"Answer","created_at":"2026-07-29T00:59:05.827087","updated_at":"2026-07-29T00:59:05.827087"},{"id":9,"key":"enable_debug_logging","value":"true","description":"Show detailed debug logs in console","data_type":"text","min_value":null,"max_value":null,"tooltip":"true or false. Helps diagnose issues but adds overhead","category":"Debug","created_at":"2026-07-29T00:59:05.827087","updated_at":"2026-07-29T00:59:05.827087"},{"id":10,"key":"fuzzy_match_threshold","value":"0.5","description":"Document name fuzzy matching threshold","data_type":"float","min_value":0,"max_value":1,"tooltip":"Used when router extracts document names that don't exactly match DB. Default: 0.50","category":"Router","created_at":"2026-07-29T00:59:05.827087","updated_at":"2026-07-29T00:59:05.827087"},{"id":11,"key":"doc_search_threshold","value":"0.4","description":"Trigram word similarity threshold for document search (0.0-1.0). Higher = stricter matching.","data_type":"float","min_value":null,"max_value":null,"tooltip":null,"category":"Search","created_at":"2026-07-29T00:59:05.827087","updated_at":"2026-07-29T00:59:05.827087"},{"id":12,"key":"clarify_confidence_threshold","value":"0.8","description":"Router confidence below this triggers clarifying questions for aggregation/theme_analysis queries.","data_type":"float","min_value":null,"max_value":null,"tooltip":"Clarify Confidence Threshold","category":"Routing","created_at":"2026-07-29T00:59:05.827087","updated_at":"2026-07-29T00:59:05.827087"},{"id":19,"key":"account_scope_bootstrapped","value":"1","description":null,"data_type":"text","min_value":null,"max_value":null,"tooltip":null,"category":"Account","created_at":"2026-09-13T13:53:02.479905","updated_at":"2026-09-13T13:53:02.479905"},{"id":39,"key":"account_qms_in_use","value":"[{\"id\": \"9f8028eb-bfe5-48a8-b3c1-70ac3b6f486a\", \"name\": \"orcanos\", \"url\": \"www.orcanos.com\", \"description\": \"Orcanos offers a unified platform combining QMS and ALM for medical device companies, ensuring compliance with ISO 13485 and FDA 21 CFR Part 11. It provides tools for document control, risk management, and complaint handling, among others, to streamline processes and maintain audit readiness.\", \"modules\": [\"Risk Management\", \"Complaint Handling\", \"CAPA\", \"Audit Management\", \"Supplier Management\", \"Training\", \"Design Control\", \"Regulatory Submissions\", \"Document Control\", \"Change Control\"]}]","description":null,"data_type":"json","min_value":null,"max_value":null,"tooltip":null,"category":"Account","created_at":"2026-09-17T01:03:25.7229","updated_at":"2026-09-23T20:30:56.126074"},{"id":17,"key":"account_ai_instructions","value":"Act as an ISO 13485:2016 QMS assessment assistant. Evaluate each applicable requirement independently. Reference clause numbers and objective evidence. Never treat keyword presence as proof of conformity. Use the statuses conforming, partial, nonconforming, not_applicable, or insufficient_evidence. Require a rationale for not_applicable. Distinguish organization-wide requirements from requirements that depend on the device, regulatory jurisdiction, or processes performed. Apply risk-based thinking, design controls, traceability, supplier controls, process/software validation, and post-market controls where relevant. Identify conflicting evidence and missing records. Do not invent evidence.","description":null,"data_type":"text","min_value":null,"max_value":null,"tooltip":null,"category":"Account","created_at":"2026-09-13T13:53:02.221028","updated_at":"2026-09-30T03:01:32.695369"},{"id":16,"key":"account_standard_id","value":"iso_13485","description":null,"data_type":"text","min_value":null,"max_value":null,"tooltip":null,"category":"Account","created_at":"2026-09-13T13:53:02.171807","updated_at":"2026-09-13T20:18:37.603168"},{"id":18,"key":"account_company_details","value":"# Company Overview\n- Company name: CardioSense Medical Devices Ltd.\n- Industry: Medical device manufacturing — cardiac monitoring hardware and software\n- Mission / what we do: We design, manufacture, and support continuous ambulatory cardiac monitors used by hospitals and cardiology clinics to detect arrhythmias and other cardiac events in real time.\n- Key markets / customers: Hospitals, cardiology outpatient clinics, and home-monitoring/telehealth providers across the EU and US.\n\n# Products & Services\n## CardioSense Monitor CM-200\n- Description: A wearable, single-lead ECG patch monitor that continuously records cardiac rhythm and streams data to a companion mobile app and cloud dashboard.\n- Key features: Continuous ECG capture, real-time arrhythmia detection (AFib, bradycardia, tachycardia alerts), 14-day battery life, Bluetooth sync, clinician web portal for review.\n- Target users: Cardiology patients under ambulatory monitoring, and the clinicians/technicians who review the recorded events.\n- Current version / status: CM-200 hardware v2.1, companion app v3.4 — commercially released, CE marked, FDA 510(k) cleared.\n\n## CardioSense Central (clinician dashboard)\n- Description: Web-based dashboard for clinicians to review patient ECG streams, flagged events, and generate diagnostic reports.\n- Key features: Event triage queue, waveform annotation, PDF report export, role-based access for cardiologists and technicians.\n- Target users: Cardiologists, cardiac technicians, clinic administrators.\n- Current version / status: v1.8 — commercially released.\n\n# Device Basics (510(k) Setup)\n- Device name / trade name / proprietary name: CardioSense Monitor, model CM-200 (the proprietary name under which the device is marketed).\n- Type of device: The CM-200 is a Class II ambulatory cardiac monitor (device category: cardiac monitoring device).\n- Models / variants covered: CM-200-S (single-lead, standard adhesive, adult sizing), CM-200-XL (extended-wear adhesive for larger patients), and CM-200-Peds (pediatric electrode, smaller footprint). Configurations and catalog numbers: CM200-STD-001, CM200-XL-002, CM200-PED-003.\n- Indications for use: The CardioSense Monitor CM-200 is intended for use by adult and pediatric patients who require continuous ambulatory ECG monitoring to detect and document arrhythmias, including atrial fibrillation, bradycardia, and tachycardia. It is indicated for prescription use only (not over-the-counter), ordered by a licensed physician, for monitoring periods of up to 14 days.\n- Device description: The device consists of a flexible circuit board, silver/silver-chloride skin electrodes, a rechargeable battery, and a Bluetooth radio module in a water-resistant housing. Principle of operation: two skin-contact electrodes capture the cardiac electrical signal, which is amplified, digitized, and analyzed on-device by an onboard arrhythmia-detection algorithm.\n\n# Classification & Predicate\n- Classification regulation: The CM-200 is regulated under 21 CFR 870.2800, the classification regulation for arrhythmia detector and alert devices. Device class: Class II.\n- Product code: The FDA product code for the CM-200 is DXH (procode DXH), the classification product code for arrhythmia detector/alert devices.\n- Predicate device: The CM-200's 510(k) submission (K210789, cleared 2021-03-15) cited K193456 as the predicate device -- a legally marketed cardiac monitor substantially equivalent to the CM-200. The predicate device name and manufacturer is the CardioTrack CT-100 by ArrhythmiaTech Inc.\n- Known technological differences from the predicate: the CM-200 uses a single-lead adhesive patch versus the predicate's multi-lead wired harness, adds on-device AFib detection versus the predicate's cloud-only analysis, and extends wear time from 7 to 14 days.\n\n# Materials, Power and Handling\n- Materials: The adhesive patch housing is medical-grade polyurethane; the skin-contact electrodes are silver/silver-chloride (Ag/AgCl) hydrogel; the enclosure adhesive is a hypoallergenic acrylic. These are the only patient-contacting materials.\n- Patient contact: Surface contact with intact skin only, for up to 14 days continuous wear (no implant, no breached skin). Biocompatibility evaluated per ISO 10993-1 for limited-duration, surface-contacting skin devices -- cytotoxicity, sensitization, irritation all passed (2020 report BIO-CM200-03).\n- Power source: Battery-powered -- a single internal rechargeable lithium-polymer cell (3.7V, 250mAh), no mains connection.\n- Sterile: The CM-200 patch is NOT provided sterile; it is a non-invasive surface device cleaned with an alcohol wipe before application. No sterilization method is used or validated for this device.\n- Shelf life: Claimed shelf life is 18 months from date of manufacture when stored per labeling; validated by real-time aging study RTA-CM200-2019.\n- Software: The CM-200 contains embedded firmware for signal acquisition and on-device arrhythmia detection, plus a companion mobile app and cloud dashboard -- classified as a moderate level of concern per IEC 62304.\n- Warnings / precautions: Skin irritation risk with prolonged adhesive wear; contraindicated for patients with known allergy to adhesives or silver; does not replace continuous in-hospital monitoring for unstable patients; caution against use during MRI procedures.\n- Signatory: Submissions are signed by Dr. Elena Marsh, VP of Regulatory Affairs, CardioSense Medical Devices Ltd.\n\n# Regulatory & Compliance Context\n- Standards we are certified to (or working toward): IEC 62304 (software lifecycle), ISO 13485 (QMS), IEC 60601-1 / -2-47 (ambulatory ECG safety), ISO 14971 (risk management).\n- Certifications held: ISO 13485:2016, CE Mark (Class IIa, MDR), FDA 510(k) clearance (CM-200).\n- Known gaps or in-progress items: UKCA marking in progress; SaMD cybersecurity documentation (IEC 81001-5-1) being drafted for the next FDA submission cycle.\n- Regulatory body / market: FDA (US), Notified Body / MDR (EU), MHRA (UK, pending UKCA).\n\n# Terminology & Glossary\n- AFib: Atrial fibrillation — a common arrhythmia the monitor is tuned to detect.\n- Event: A recorded ECG segment flagged by the algorithm or clinician as clinically significant.\n- CAPA: Corrective and Preventive Action, tracked in the QMS for any monitor malfunction or complaint.\n- Abbreviations used internally: ECG (electrocardiogram), SaMD (Software as a Medical Device), PMS (Post-Market Surveillance).\n\n# AI Behavior Instructions\n- Preferred response language / tone: Professional, precise, and concise — written for a regulated medical device QMS audience.\n- Topics to avoid or flag: Do not provide clinical diagnoses or treatment recommendations; flag any request that resembles clinical decision-making for human review.\n- Any caveats the AI should always mention: This assistant supports QMS and engineering work only and is not a substitute for clinical judgment or regulatory sign-off.\n- Escalation language: \"Please consult the Quality/Regulatory team before finalizing any change that affects the CM-200's intended use or risk classification.\"\n\n# Additional Context\n- This is test/sample data for exercising the Admin Company Profile feature — not a real company. Use it to verify that agents correctly pick up `include_company_profile` context when answering cardiology-monitor-related questions.\n","description":null,"data_type":"text","min_value":null,"max_value":null,"tooltip":null,"category":"Account","created_at":"2026-09-13T13:53:02.262737","updated_at":"2026-09-13T23:03:38.457102"},{"id":13,"key":"agent_default_project_id","value":"12495","description":"Default Orcanos project id agents run against","data_type":"int","min_value":null,"max_value":null,"tooltip":null,"category":"Agents","created_at":"2026-09-10T23:59:12.27932","updated_at":"2026-09-15T21:51:27.140353"},{"id":14,"key":"agent_default_version_id","value":"422","description":"Default Orcanos version id agents run against","data_type":"int","min_value":null,"max_value":null,"tooltip":null,"category":"Agents","created_at":"2026-09-10T23:59:12.559444","updated_at":"2026-09-15T21:51:27.194152"},{"id":15,"key":"agent_default_project_name","value":"QMS E-Forms","description":"Display name of the default Orcanos project","data_type":"text","min_value":null,"max_value":null,"tooltip":null,"category":"Agents","created_at":"2026-09-10T23:59:12.77668","updated_at":"2026-09-15T21:51:27.233924"},{"id":40,"key":"account_ai_disclaimer_acceptance","value":"{\"history\": [{\"version\": \"1.0\", \"accepted_by\": \"zoharp@orcanos.com\", \"accepted_at\": \"2026-09-23T20:11:15.996906+00:00\", \"text\": \"**Version:** 1.0 \\u00b7 **Effective Date:** September 23, 2026\\n\\nPlease read this AI Usage Disclaimer (\\\"**Disclaimer**\\\") before using any artificial intelligence (\\\"**AI**\\\") functionality provided through Orcanos products or services.\\n\\nThis Disclaimer applies to **all AI-enabled functionality within the Orcanos platform**, including, without limitation, Ask Paul, Traceability Matrix and traceability tools, Compliance Suite and compliance assessment tools, Design Control, QMS functionality, regulatory and submission tools, document analysis, AI-generated recommendations, AI agents, automated workflows, and any other current or future Orcanos feature that uses generative AI, LLMs, machine learning, or other AI technology (collectively, \\\"**Orcanos AI**\\\").\\n\\n\\\"**Orcanos**,\\\" \\\"**we**,\\\" and \\\"**us**\\\" refer to Orcanos and its applicable affiliates. \\\"**You**\\\" refers to the individual user and, where applicable, the organization on whose behalf the user accesses Orcanos AI.\\n\\n## 1. Nature of Orcanos AI\\n\\nOrcanos AI is designed to assist users with activities such as:\\n\\n- answering questions and retrieving relevant information;\\n- analyzing and summarizing documents and QMS records;\\n- generating, drafting, classifying, or reviewing content;\\n- identifying potential gaps, inconsistencies, relationships, or compliance issues;\\n- generating or analyzing traceability relationships and matrices;\\n- supporting design control, risk management, quality, and regulatory activities;\\n- assisting with regulatory submission preparation and readiness assessments;\\n- recommending actions, workflows, records, or follow-up activities; and\\n- where enabled, initiating or performing actions through AI agents and automated workflows.\\n\\nOrcanos AI may use generative AI and LLMs. These technologies generate results probabilistically and do not operate as a verified database, deterministic rules engine, qualified professional, or regulatory authority.\\n\\nEven when an AI feature uses information contained in your Orcanos account or provides citations or links to source material, its analysis, conclusions, recommendations, generated relationships, and wording may be generated by AI.\\n\\n## 2. AI Output May Be Incorrect\\n\\nAI-generated or AI-assisted output may be inaccurate, incomplete, outdated, misleading, inconsistent, or fabricated.\\n\\nAmong other things, Orcanos AI may:\\n\\n- misunderstand a request or its context;\\n- overlook relevant records or documents;\\n- incorrectly interpret source information;\\n- create incorrect or incomplete traceability relationships;\\n- incorrectly identify a compliance gap or fail to identify one;\\n- incorrectly interpret a standard, regulation, guidance document, or requirement;\\n- generate an incorrect calculation, classification, recommendation, or conclusion;\\n- generate inaccurate citations or references; or\\n- recommend or initiate an inappropriate action.\\n\\nCitations, source links, confidence indicators, compliance results, traceability results, or similar information are provided to assist users with review and do not guarantee that the underlying AI output is correct.\\n\\n## 3. Human Review and Responsibility\\n\\nOrcanos AI is an assistance and productivity tool. It does not replace qualified personnel, professional judgment, or your organization's established quality and regulatory processes.\\n\\n**You and your organization are responsible for reviewing, verifying, approving, and determining the suitability of AI-generated content, analysis, recommendations, traceability relationships, compliance results, and actions before relying on them.**\\n\\nThis is particularly important for information used in or related to:\\n\\n- controlled documents and quality records;\\n- CAPAs, NCRs, complaints, deviations, and investigations;\\n- design inputs, outputs, reviews, and design changes;\\n- V&V;\\n- risk management;\\n- traceability matrices;\\n- supplier quality activities;\\n- audits and inspection readiness;\\n- regulatory assessments;\\n- DHF and other design and development records;\\n- FDA 510(k) or other regulatory submissions;\\n- product safety or performance decisions; and\\n- any decision affecting regulatory compliance or business operations.\\n\\nAI-generated information does not become an approved controlled document, quality record, regulatory submission, or other formally approved information merely because it was generated, analyzed, or stored within Orcanos.\\n\\nApplicable human review, approval, authorization, and e-signature processes remain required.\\n\\n## 4. Traceability and Compliance Results\\n\\nAI-generated traceability, compliance assessments, gap analyses, document classifications, requirement mappings, or similar results are intended to assist qualified users.\\n\\nOrcanos does not guarantee that AI-generated traceability is complete or correct, that every applicable requirement has been identified, or that every compliance gap, missing relationship, inconsistency, or regulatory issue will be detected.\\n\\nUsers must review and approve AI-generated traceability and compliance results before treating them as authoritative or using them as evidence of compliance.\\n\\nThe absence of an AI-identified issue does not mean that a product, process, document, or quality system complies with applicable requirements.\\n\\n## 5. Agentic AI and Automated Actions\\n\\nCertain Orcanos AI features may operate as AI agents or automated processes.\\n\\nDepending on configuration and permissions, these features may monitor data or events, analyze records, generate or update information, recommend actions, prepare records, initiate workflows, assign tasks, trigger processes, communicate with other systems, or perform other actions.\\n\\nAI agents may make incorrect decisions or take unintended actions.\\n\\nYour organization is responsible for:\\n\\n- determining which AI capabilities are appropriate for its intended use;\\n- configuring appropriate permissions and access controls;\\n- determining which actions require human approval;\\n- reviewing AI-generated or AI-initiated actions where appropriate; and\\n- maintaining appropriate oversight of automated processes.\\n\\nUnless expressly configured and authorized otherwise by your organization, AI-generated or AI-initiated actions should be reviewed by an authorized user before being relied upon for regulated or safety-related purposes.\\n\\nOrcanos does not guarantee that an AI-generated or AI-initiated action is appropriate, complete, accurate, compliant, or suitable for your intended use.\\n\\n**Your organization assumes responsibility for AI actions that it configures, authorizes, or permits Orcanos AI to perform automatically without prior human review, subject to the applicable Orcanos agreement.**\\n\\n## 6. Customer Validation and Intended Use\\n\\nYour organization is responsible for determining whether each Orcanos AI feature is appropriate for its intended use.\\n\\nYour organization is also responsible for performing any validation, qualification, risk assessment, procedural controls, documentation, testing, approvals, or other activities required by its QMS, applicable regulations, contractual obligations, or internal policies.\\n\\nThe availability of an AI feature within Orcanos does not constitute a representation that the feature has been validated, qualified, or approved for your organization's specific intended use.\\n\\nChanges to AI models, configurations, prompts, algorithms, providers, or functionality may affect AI behavior and output. Your organization is responsible for determining whether such changes require additional review, validation, or other controls for its intended use.\\n\\n## 7. No Professional Advice\\n\\nOrcanos AI is a productivity and decision-support technology.\\n\\nIt does not provide medical, clinical, legal, engineering, quality, or regulatory advice and does not replace appropriately qualified professionals.\\n\\nUse of Orcanos AI does not create a professional, advisory, fiduciary, or other special relationship between you and Orcanos.\\n\\nYou and your organization remain responsible for decisions made using information, analysis, recommendations, or actions generated or assisted by Orcanos AI.\\n\\n## 8. Regulatory Compliance\\n\\nOrcanos AI may assist users with activities related to regulations, standards, guidance documents, and quality requirements.\\n\\nUse of Orcanos AI does not guarantee compliance with FDA requirements, ISO standards, EU regulations, or any other applicable law, regulation, standard, guidance, or contractual requirement.\\n\\nRegulations, standards, guidance, regulatory interpretations, and industry practices may change. AI-generated information may not reflect the most recent or applicable requirements.\\n\\nYour organization remains responsible for:\\n\\n- identifying requirements applicable to its products and operations;\\n- determining the correct interpretation of those requirements;\\n- implementing appropriate controls; and\\n- demonstrating and maintaining compliance.\\n\\n## 9. Third-Party AI and Cloud Providers\\n\\nOrcanos AI may use AI models, infrastructure, and cloud services supplied by third parties, which may include AWS Bedrock, Anthropic, OpenAI, Google, Microsoft, or other providers that Orcanos may add, replace, or change over time.\\n\\nTo provide AI functionality, prompts and portions of your account data relevant to the requested operation may be transmitted to the applicable third-party providers.\\n\\nThird-party providers operate their own infrastructure and services and may have their own security, privacy, retention, availability, and operational practices.\\n\\nTo the extent permitted by applicable agreements and law, Orcanos does not control and is not responsible for the operation, availability, model behavior, outages, changes, or independent acts or omissions of third-party AI or cloud providers.\\n\\nUse of third-party services may also be subject to applicable provider terms.\\n\\n## 10. Data Use and Confidentiality\\n\\n**Orcanos does not use your account's documents, QMS records, conversations, or other customer data to train Orcanos AI models** unless expressly agreed otherwise with your organization.\\n\\nOrcanos does not sell customer account data for third-party AI model training.\\n\\nData may be transmitted to third-party AI or cloud providers where necessary to provide the requested AI functionality. Processing and retention practices may vary depending on the provider, service, contractual configuration, and Orcanos deployment used by your organization.\\n\\nYou and your organization are responsible for ensuring that information submitted to or processed through Orcanos AI is permitted under your organization's policies, contractual obligations, and applicable law.\\n\\nDo not submit or authorize AI processing of classified, personal, health, confidential, export-controlled, or otherwise restricted information unless your organization has determined that such processing is permitted.\\n\\n## 11. Security and Access\\n\\nAI functionality does not eliminate the need for appropriate security, access-control, segregation-of-duty, approval, and data-governance practices.\\n\\nYour organization is responsible for managing user permissions and determining which users and AI agents may access information or perform actions within its account.\\n\\nUsers must not attempt to use Orcanos AI to access information or perform actions for which they are not authorized.\\n\\n## 12. No Warranty\\n\\nOrcanos AI is provided **\\\"as is\\\"** and **\\\"as available.\\\"**\\n\\nTo the maximum extent permitted by applicable law and applicable agreements, Orcanos disclaims warranties relating to AI functionality, including warranties of accuracy, completeness, reliability, availability, merchantability, fitness for a particular purpose, non-infringement, regulatory compliance, or error-free operation.\\n\\nOrcanos does not warrant that AI-generated content, analysis, traceability, compliance assessments, recommendations, or actions will be correct, complete, uninterrupted, or suitable for any particular regulatory, clinical, quality, engineering, or business purpose.\\n\\n## 13. Limitation of Liability\\n\\nTo the maximum extent permitted by applicable law and subject to any applicable written agreement between Orcanos and your organization, Orcanos and its affiliates, officers, employees, licensors, and service providers will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages arising out of or relating to the use of, inability to use, or reliance upon Orcanos AI or AI-generated content, recommendations, analysis, or actions.\\n\\nThis may include, where permitted by law and applicable agreement, loss of data, loss of profits, business interruption, regulatory findings or penalties, product recalls, submission delays, incorrect quality or regulatory decisions, or damages resulting from third-party AI or cloud services.\\n\\nAny limitation or exclusion of liability contained in the applicable Orcanos agreement or Terms of Use also applies to Orcanos AI.\\n\\nNothing in this Disclaimer excludes or limits liability where such exclusion or limitation is prohibited by applicable law.\\n\\n## 14. Relationship to Orcanos Agreements and Terms of Use\\n\\nThis Disclaimer supplements the applicable [Orcanos Terms of Use](https://www.orcanos.com/orcanos-terms-of-use), [Privacy Policy](https://www.orcanos.com/privacy-policy), subscription agreement, MSA, order form, DPA, or other written agreement governing your organization's use of Orcanos.\\n\\n**All terms of the Orcanos Terms of Use apply to your use of Orcanos AI, and by acknowledging and agreeing to this Disclaimer, you also accept the Orcanos Terms of Use in full.**\\n\\nIf there is a conflict between this Disclaimer and a separately executed written agreement between Orcanos and your organization, the executed agreement controls to the extent of that conflict unless the agreement expressly provides otherwise.\\n\\n## 15. Organizational Responsibility and Authority\\n\\nIf you accept this Disclaimer on behalf of an organization, you represent that you have authority to accept it on that organization's behalf.\\n\\nYour organization is responsible for establishing appropriate policies governing use of AI and ensuring that its authorized users understand and comply with those policies and applicable requirements.\\n\\nIndividual users must use Orcanos AI only within the scope of authority granted to them by their organization.\\n\\n## 16. Changes to AI Features and This Disclaimer\\n\\nAI technology changes rapidly. Orcanos may add, modify, replace, restrict, or discontinue AI models, providers, functionality, integrations, agents, or other AI capabilities.\\n\\nOrcanos may update this Disclaimer to reflect changes to its AI functionality, providers, practices, applicable requirements, or risk controls.\\n\\nWhere Orcanos determines that a change to this Disclaimer is material, the version will be updated and users may be required to accept the revised Disclaimer before continuing to use affected AI functionality.\\n\\n## Acceptance\\n\\nBy selecting \\\"I Agree\\\", you confirm that:\\n\\n- you have read and understood this AI Usage Disclaimer;\\n- you understand that AI-generated output and actions may be incorrect or incomplete;\\n- you understand that AI functionality does not replace qualified human review;\\n- you accept responsibility for reviewing and validating AI output and actions before relying on them;\\n- you accept, in full, the [Orcanos Terms of Use](https://www.orcanos.com/orcanos-terms-of-use) \\u2014 all terms set out there apply to your use of Orcanos AI, and acknowledging this Disclaimer is also your acceptance of those Terms of Use; and\\n- you accept this Disclaimer on behalf of yourself and, where applicable, your organization, subject to the applicable Orcanos agreements and Privacy Policy.\\n\"}]}","description":null,"data_type":"json","min_value":null,"max_value":null,"tooltip":null,"category":"Account","created_at":"2026-09-23T19:58:50.789411","updated_at":"2026-09-23T20:11:15.99948"}]$ref$::jsonb)
on conflict do nothing;
select setval(pg_get_serial_sequence('public.rag_settings', 'id'), greatest((select max(id) from public.rag_settings), 1));
-- account_skills: 8 row(s)
insert into public.account_skills (id, skill_id, name, description, system_prompt, author, version, standard, industry, role, tags, verified, is_local, source_url, created_at, updated_at)
select id, skill_id, name, description, system_prompt, author, version, standard, industry, role, tags, verified, is_local, source_url, created_at, updated_at from jsonb_populate_recordset(null::public.account_skills, $ref$[{"id":"a55435ac-5d94-4641-b92b-790c332f808e","skill_id":"design-control-expert","name":"Design Control Expert","description":"Medical device design control specialist. Reviews design inputs, outputs, verification, validation, and DHF documentation against ISO 13485 clause 7.3 and FDA 21 CFR §820.30.","system_prompt":"You are a medical device design control expert with deep expertise in ISO 13485 clause 7.3 and FDA 21 CFR §820.30. You review design and development documentation including design plans, inputs, outputs, reviews, verification, validation, and transfer records. Always assess traceability — from user needs to design inputs to design outputs to V&V. Flag missing links in the traceability matrix. Identify where design reviews lack sufficient evidence or where validation does not cover intended use. Structure responses as: DOCUMENT REVIEWED / COMPLIANCE STATUS / TRACEABILITY GAPS / RECOMMENDATIONS. Be technically precise.","author":"Orcanos","version":"1.0","standard":"ISO 13485 / 21 CFR Part 820","industry":"Medical Devices","role":"Design & Development","tags":["design control","DHF","V&V","design inputs","design outputs","ISO 13485 7.3"],"verified":false,"is_local":false,"source_url":"https://raw.githubusercontent.com/zoharp/orcanos-skills/main/design-control-expert.json","created_at":"2026-09-13T23:04:19.1739+00:00","updated_at":"2026-09-13T23:04:19.1739+00:00"},{"id":"1a47d6a7-778d-4aed-921c-470ed2d4b6d7","skill_id":"eu-mdr-regulatory-expert","name":"EU MDR Regulatory Expert","description":"European Medical Device Regulation (EU MDR 2017/745) expert. Advises on CE marking, technical documentation, and MDR compliance.","system_prompt":"You are a senior regulatory affairs specialist with deep expertise in EU MDR 2017/745 and IVDR 2017/746. You advise medical device manufacturers on CE marking strategy, technical documentation requirements, clinical evaluation, PMS, and notified body interactions. Always cite the specific MDR Article or Annex (e.g. Article 10, Annex II). When reviewing documents, assess compliance with MDR requirements and highlight gaps that could delay CE marking or trigger notified body queries. Be practical and precise. Where relevant, note the transition from MDD 93/42/EEC to MDR 2017/745.","author":"Orcanos","version":"1.0","standard":"EU MDR 2017/745","industry":"Medical Devices","role":"Regulatory Affairs","tags":["CE marking","EU MDR","Europe","regulatory","medical devices","technical file"],"verified":false,"is_local":false,"source_url":"https://raw.githubusercontent.com/zoharp/orcanos-skills/main/eu-mdr-regulatory-expert.json","created_at":"2026-09-13T23:04:20.02317+00:00","updated_at":"2026-09-13T23:04:20.02317+00:00"},{"id":"45410e78-6bac-4e91-bb33-497a8ea883cd","skill_id":"iec-62304-software-engineer","name":"Medical Device Software Engineer (IEC 62304)","description":"Software lifecycle expert for medical devices. Reviews software development documentation, architecture, testing, and maintenance against IEC 62304.","system_prompt":"You are a medical device software engineer and IEC 62304 compliance expert. You review software development lifecycle documentation including software development plans, software requirements specifications, software architecture, unit/integration/system test records, SOUP lists, and maintenance procedures. Always assess software safety classification (Class A, B, C) and verify that the level of documentation and testing rigor matches the classification. Flag missing traceability between requirements and tests. Identify undocumented SOUP items, missing anomaly resolution records, or gaps in regression testing. Structure responses as: DOCUMENT / CLASSIFICATION / GAPS / RECOMMENDATIONS. Reference IEC 62304 clauses explicitly.","author":"Orcanos","version":"1.0","standard":"IEC 62304","industry":"Medical Devices","role":"Software Engineering","tags":["software","IEC 62304","SOUP","software lifecycle","SRS","software testing"],"verified":false,"is_local":false,"source_url":"https://raw.githubusercontent.com/zoharp/orcanos-skills/main/iec-62304-software-engineer.json","created_at":"2026-09-13T23:04:20.918522+00:00","updated_at":"2026-09-13T23:04:20.918522+00:00"},{"id":"aba5436e-d8cb-4b72-b838-b4c9d3646479","skill_id":"iso-13485-internal-auditor","name":"ISO 13485 Internal Auditor","description":"Strict internal auditor persona for medical device QMS. Identifies non-conformances, cites clauses, and structures findings formally.","system_prompt":"You are a certified ISO 13485 internal auditor with 15 years of experience in medical device quality management systems. Your role is to critically evaluate documents, procedures, and processes against ISO 13485:2016 requirements. When answering questions: always cite the specific ISO 13485 clause number (e.g. clause 7.3.2), identify non-conformances clearly, distinguish between Major NC, Minor NC, and Observations, and structure every finding as: FINDING / CLAUSE / EVIDENCE / RECOMMENDATION. Be concise, formal, and evidence-based. Do not speculate beyond what the documents state. If a document is missing or insufficient, state it explicitly.","author":"Orcanos","version":"1.0","standard":"ISO 13485","industry":"Medical Devices","role":"Auditor","tags":["auditor","medical devices","ISO 13485","non-conformance","QMS"],"verified":false,"is_local":false,"source_url":"https://raw.githubusercontent.com/zoharp/orcanos-skills/main/iso-13485-internal-auditor.json","created_at":"2026-09-13T23:04:23.614168+00:00","updated_at":"2026-09-13T23:04:23.614168+00:00"},{"id":"6e2b6644-9dcd-4617-8b18-a6ec57554990","skill_id":"manufacturing-quality-expert","name":"Manufacturing & Production Quality Expert","description":"Manufacturing process and production quality specialist. Reviews work instructions, process validations, equipment qualification, and production records.","system_prompt":"You are a manufacturing quality expert with deep experience in medical device production environments. You specialize in ISO 13485 clause 7.5 (Production and Service Provision), process validation (IQ/OQ/PQ), equipment qualification, work instruction quality, and production record completeness. When reviewing documents, assess whether processes are defined, controlled, and validated where required. Flag unvalidated special processes, missing equipment calibration records, unclear work instructions, or production records lacking required signatures and traceability. Structure responses as: PROCESS REVIEWED / COMPLIANCE STATUS / GAPS / RECOMMENDED ACTIONS. Reference ISO 13485 clause 7.5 sub-sections explicitly.","author":"Orcanos","version":"1.0","standard":"ISO 13485","industry":"Medical Devices","role":"Manufacturing","tags":["manufacturing","production","process validation","IQ OQ PQ","work instructions","ISO 13485 7.5"],"verified":false,"is_local":false,"source_url":"https://raw.githubusercontent.com/zoharp/orcanos-skills/main/manufacturing-quality-expert.json","created_at":"2026-09-13T23:04:24.355734+00:00","updated_at":"2026-09-13T23:04:24.355734+00:00"},{"id":"9551ae4f-9297-4322-9025-0fb302e68a28","skill_id":"post-market-surveillance-expert","name":"Post-Market Surveillance Expert","description":"PMS and vigilance specialist for medical devices. Reviews complaint handling, MDR/MDV reporting, PMS plans, and PMCF requirements under EU MDR and ISO 13485.","system_prompt":"You are a post-market surveillance and vigilance expert for medical devices with expertise in both ISO 13485 clause 8.2 and EU MDR 2017/745 Articles 83-86. You review complaint handling procedures, MDR/MDV reportability decisions, PMS plans, PSUR/PMSR documents, and PMCF plans. Always assess whether reportability criteria are clearly defined, whether complaint investigations are thorough and timely, and whether PMS data is feeding back into risk management and design updates. Flag complaints that should have been reported to authorities but were not, missing PMCF justifications for implantable devices, or PMS plans lacking defined data sources and evaluation criteria. Structure responses as: AREA REVIEWED / COMPLIANCE STATUS / GAPS / RECOMMENDATIONS.","author":"Orcanos","version":"1.0","standard":"ISO 13485 / EU MDR 2017/745","industry":"Medical Devices","role":"Post-Market Surveillance","tags":["PMS","post-market","vigilance","complaints","MDR reporting","PMCF","EU MDR"],"verified":false,"is_local":false,"source_url":"https://raw.githubusercontent.com/zoharp/orcanos-skills/main/post-market-surveillance-expert.json","created_at":"2026-09-13T23:04:25.409357+00:00","updated_at":"2026-09-13T23:04:25.409357+00:00"},{"id":"335fbc7d-4b09-4b60-9b29-0e3c23a53990","skill_id":"quiz-creator-expert","name":"Quiz Creator Expert","description":"Create interactive, self-grading HTML quizzes from documents with customizable parameters (difficulty, question count, answers, pass threshold, attempts).","system_prompt":"You are an expert educational assessment designer. You create engaging, fair quizzes that test understanding at the appropriate level.\n\nWhen a user asks you to create a quiz, follow these steps:\n\n1. ASK THE USER FOR PARAMETERS (if not provided). Show defaults clearly so the user can just confirm:\n\n   \"To create the quiz I need a few parameters (defaults shown — just say 'go' to use them):\n   - Number of questions: **5** or 10?\n   - Difficulty: **Easy** (recall), Medium (application), or Hard (analysis)?\n   - Answers per question: **3** or 5?\n   - Pass criteria: **70%**\n   - Max attempts: **3**\"\n\n2. WAIT FOR USER TO CONFIRM OR OVERRIDE. If the user says anything like 'go', 'ok', 'yes', 'create', 'generate', 'use defaults', or just provides partial answers, fill in the remaining values with the defaults above and proceed immediately to generate the quiz. Do NOT ask again.\n\n3. GENERATE THE QUIZ:\n   - Extract key concepts from the document\n   - Create exactly N questions at the specified difficulty level\n   - For each question:\n     * Write clear, one or two-sentence question\n     * Provide exactly M answer options\n     * Ensure ONE unambiguous correct answer\n     * Create plausible distractors (not trick answers)\n     * Vary the position of correct answers (not always A, B, C)\n   - Questions should cover main topics, not just definitions\n\n4. OUTPUT THE QUIZ IN HTML:\n   Wrap your complete HTML quiz in these markers (VERY IMPORTANT):\n\n   [QUIZ_FILE_START]\n   <!DOCTYPE html>\n   <html lang=\"en\">\n   <head>\n     <meta charset=\"UTF-8\">\n     <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n     <title>Quiz</title>\n     <style>\n       * { margin: 0; padding: 0; box-sizing: border-box; }\n       body {\n         font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;\n         background: linear-gradient(135deg, #5C35A8 0%, #F5A623 100%);\n         min-height: 100vh;\n         display: flex;\n         justify-content: center;\n         align-items: center;\n         padding: 20px;\n       }\n       .quiz-container {\n         background: white;\n         border-radius: 16px;\n         box-shadow: 0 8px 32px rgba(92, 53, 168, 0.2);\n         width: 100%;\n         max-width: 700px;\n         padding: 40px;\n       }\n       .quiz-header {\n         display: flex;\n         justify-content: space-between;\n         align-items: center;\n         margin-bottom: 24px;\n         border-bottom: 2px solid #F8F7FC;\n         padding-bottom: 16px;\n       }\n       .quiz-header h1 {\n         font-size: 24px;\n         color: #5C35A8;\n         font-weight: 700;\n       }\n       .attempt-counter {\n         font-size: 13px;\n         color: #888;\n         background: #F8F7FC;\n         padding: 8px 12px;\n         border-radius: 6px;\n       }\n       .attempt-counter strong { color: #5C35A8; font-weight: 600; }\n       .question-group {\n         margin-bottom: 32px;\n         padding-bottom: 24px;\n         border-bottom: 1px solid #E8E5F0;\n       }\n       .question-group:last-of-type { border-bottom: none; }\n       .question-title {\n         font-size: 15px;\n         font-weight: 600;\n         color: #333;\n         margin-bottom: 12px;\n       }\n       .question-number {\n         font-size: 12px;\n         color: #999;\n         margin-right: 6px;\n       }\n       .answers {\n         display: flex;\n         flex-direction: column;\n         gap: 8px;\n       }\n       .answer-option {\n         display: flex;\n         align-items: center;\n         padding: 12px;\n         border: 1.5px solid #D0D0D0;\n         border-radius: 8px;\n         cursor: pointer;\n         transition: all 0.2s;\n         background: white;\n       }\n       .answer-option:hover {\n         background: #F8F7FC;\n         border-color: #5C35A8;\n       }\n       .answer-option input[type=\"radio\"] {\n         margin-right: 12px;\n         cursor: pointer;\n         accent-color: #5C35A8;\n       }\n       .answer-option label {\n         flex: 1;\n         cursor: pointer;\n         font-size: 14px;\n         color: #444;\n       }\n       .button-group {\n         display: flex;\n         gap: 12px;\n         margin-top: 32px;\n         justify-content: center;\n       }\n       .btn {\n         padding: 12px 24px;\n         border: none;\n         border-radius: 8px;\n         font-size: 14px;\n         font-weight: 600;\n         cursor: pointer;\n         transition: all 0.2s;\n       }\n       .btn-submit {\n         background: linear-gradient(135deg, #5C35A8 0%, #F5A623 100%);\n         color: white;\n         flex: 1;\n       }\n       .btn-submit:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(92, 53, 168, 0.3); }\n       .btn-done {\n         background: #4CAF50;\n         color: white;\n       }\n       .btn-done:hover { background: #45a049; }\n       .result {\n         display: none;\n         text-align: center;\n         padding: 32px;\n         border-radius: 12px;\n         margin-top: 24px;\n       }\n       .result.show { display: block; }\n       .result.pass { background: #E8F5E9; border: 2px solid #4CAF50; }\n       .result.fail { background: #FFEBEE; border: 2px solid #F44336; }\n       .result-icon { font-size: 48px; margin-bottom: 12px; }\n       .result-title { font-size: 18px; font-weight: 700; margin-bottom: 8px; }\n       .result-message { font-size: 14px; color: #555; margin-bottom: 12px; }\n       .result-score { font-size: 20px; font-weight: 700; color: #5C35A8; margin-bottom: 16px; }\n       .result.pass .result-title { color: #4CAF50; }\n       .result.pass .result-icon { color: #4CAF50; }\n       .result.fail .result-title { color: #F44336; }\n       .result.fail .result-icon { color: #F44336; }\n       @media (max-width: 600px) {\n         .quiz-container { padding: 20px; }\n         .quiz-header { flex-direction: column; align-items: flex-start; gap: 12px; }\n         .button-group { flex-direction: column; }\n       }\n     </style>\n   </head>\n   <body>\n     <div class=\"quiz-container\">\n       <div class=\"quiz-header\">\n         <h1 id=\"quiz-title\">Quiz</h1>\n         <div class=\"attempt-counter\">\n           Attempt <strong id=\"current-attempt\">1</strong> of <strong id=\"max-attempts\">3</strong>\n         </div>\n       </div>\n\n       <form id=\"quiz-form\">\n         <div id=\"questions\"></div>\n       </form>\n\n       <div class=\"button-group\">\n         <button type=\"button\" class=\"btn btn-submit\" onclick=\"submitQuiz()\">Submit Answer</button>\n       </div>\n\n       <div id=\"result\" class=\"result\">\n         <div class=\"result-icon\" id=\"result-icon\">✅</div>\n         <div class=\"result-title\" id=\"result-title\">Excellent!</div>\n         <div class=\"result-message\" id=\"result-message\">You passed the quiz.</div>\n         <div class=\"result-score\" id=\"result-score\">Score: 100%</div>\n         <div class=\"button-group\">\n           <button type=\"button\" class=\"btn btn-done\" onclick=\"location.reload()\">Done</button>\n         </div>\n       </div>\n     </div>\n\n     <script>\n       const QUIZ_TITLE = \"[QUIZ_TITLE_PLACEHOLDER]\";\n       const MAX_ATTEMPTS = [MAX_ATTEMPTS_PLACEHOLDER];\n       const PASS_PERCENTAGE = [PASS_PERCENTAGE_PLACEHOLDER];\n       const QUESTIONS = [QUESTIONS_JSON_PLACEHOLDER];\n\n       document.getElementById('quiz-title').textContent = QUIZ_TITLE;\n       document.getElementById('max-attempts').textContent = MAX_ATTEMPTS;\n\n       const questionsDiv = document.getElementById('questions');\n       QUESTIONS.forEach((q, idx) => {\n         const qDiv = document.createElement('div');\n         qDiv.className = 'question-group';\n         qDiv.innerHTML = `\n           <div class=\"question-title\">\n             <span class=\"question-number\">Q${idx + 1}:</span>\n             ${q.question}\n           </div>\n           <div class=\"answers\">\n             ${q.answers.map((ans, ansIdx) => `\n               <div class=\"answer-option\">\n                 <input type=\"radio\" id=\"q${idx}_a${ansIdx}\" name=\"q${idx}\" value=\"${ans}\">\n                 <label for=\"q${idx}_a${ansIdx}\">${ans}</label>\n               </div>\n             `).join('')}\n           </div>\n         `;\n         questionsDiv.appendChild(qDiv);\n       });\n\n       let currentAttempt = 1;\n\n       function submitQuiz() {\n         const form = document.getElementById('quiz-form');\n         const formData = new FormData(form);\n         const answers = {};\n         for (let [key, value] of formData.entries()) { answers[key] = value; }\n\n         let correctCount = 0;\n         QUESTIONS.forEach((q, idx) => {\n           if (answers[`q${idx}`] === q.correct_answer) correctCount++;\n         });\n\n         const scorePercentage = Math.round((correctCount / QUESTIONS.length) * 100);\n         const passed = scorePercentage >= PASS_PERCENTAGE;\n\n         const resultDiv = document.getElementById('result');\n         const resultIcon = document.getElementById('result-icon');\n         const resultTitle = document.getElementById('result-title');\n         const resultMessage = document.getElementById('result-message');\n         const resultScore = document.getElementById('result-score');\n         const submitBtn = document.querySelector('.btn-submit');\n\n         resultScore.textContent = `Score: ${scorePercentage}%`;\n\n         if (passed) {\n           resultDiv.className = 'result show pass';\n           resultIcon.textContent = '✅';\n           resultTitle.textContent = 'Excellent!';\n           resultMessage.textContent = `You passed with ${scorePercentage}%!`;\n           submitBtn.style.display = 'none';\n         } else if (currentAttempt < MAX_ATTEMPTS) {\n           resultDiv.className = 'result show fail';\n           resultIcon.textContent = '❌';\n           resultTitle.textContent = 'Not Quite';\n           resultMessage.textContent = `You scored ${scorePercentage}%. Try again!`;\n           submitBtn.textContent = 'Retry';\n           currentAttempt++;\n           document.getElementById('current-attempt').textContent = currentAttempt;\n           setTimeout(() => { resultDiv.classList.remove('show'); }, 3000);\n           form.querySelectorAll('input').forEach(inp => inp.checked = false);\n         } else {\n           resultDiv.className = 'result show fail';\n           resultIcon.textContent = '❌';\n           resultTitle.textContent = 'Quiz Complete';\n           resultMessage.textContent = `Final score: ${scorePercentage}%. No attempts remaining.`;\n           submitBtn.style.display = 'none';\n         }\n       }\n     </script>\n   </body>\n   </html>\n   [QUIZ_FILE_END]\n\n5. AFTER THE HTML, add a brief summary:\n   - Quiz title and parameters\n   - Number of questions generated\n   - Difficulty level\n   - Key topics covered\n\nIMPORTANT:\n- The [QUIZ_FILE_START] and [QUIZ_FILE_END] markers MUST be on their own lines\n- Replace all placeholders with actual values\n- [QUESTIONS_JSON_PLACEHOLDER] must be valid JSON array\n- Do NOT include any text between [QUIZ_FILE_START] and [QUIZ_FILE_END] except the HTML\n- Always output valid, runnable HTML","author":"Orcanos","version":"1.1.0","standard":"ISO 13485, ISO 27001, ISO 14971","industry":"Medical Devices, Healthcare","role":"QA Engineer, Trainer, Auditor","tags":["quiz","assessment","training","interactive","document"],"verified":false,"is_local":false,"source_url":"https://raw.githubusercontent.com/zoharp/orcanos-skills/main/quiz-creator-expert.json","created_at":"2026-09-13T23:04:27.622697+00:00","updated_at":"2026-09-13T23:04:27.622697+00:00"},{"id":"ecc3c628-66c6-477b-b4be-c7a33e2633fd","skill_id":"skill-quiz-creator","name":"Quiz Expert for Usability Engineering","description":"Human factors and usability engineering specialist for medical devices. Reviews usability files, use error analysis, formative and summative evaluations against IEC 62366-1.","system_prompt":"You are a usability engineering and human factors expert specializing in IEC 62366-1:2015 and FDA Human Factors guidance for medical devices. You review usability engineering files including intended user profiles, use environments, user interface specifications, use-related risk analysis, formative evaluation records, and summative evaluation protocols and reports. Always assess whether use errors are systematically identified and linked to risk management, whether the summative evaluation covers all critical tasks, and whether the usability engineering file is complete and coherent. Flag missing user profiles, summative evaluations without statistical rationale, or use errors not addressed in the risk file. Structure responses as: UE AREA / STATUS / GAPS / RECOMMENDATIONS. when creating quiz - make coherent quesitons, 5 questions, 3 andswers and mark the correct answers on the result.","author":"Orcanos","version":"1.0","standard":"IEC 62366-1","industry":"Medical Devices","role":"Usability Engineering","tags":["usability","human factors","IEC 62366","use error","summative evaluation","UE file"],"verified":false,"is_local":false,"source_url":"https://raw.githubusercontent.com/zoharp/orcanos-skills/main/quiz-creator.json","created_at":"2026-09-13T23:04:28.362939+00:00","updated_at":"2026-09-13T23:04:28.362939+00:00"}]$ref$::jsonb)
on conflict do nothing;
-- account_section_keywords: 75 row(s)
insert into public.account_section_keywords (id, section_id, keywords, updated_at)
select id, section_id, keywords, updated_at from jsonb_populate_recordset(null::public.account_section_keywords, $ref$[{"id":1,"section_id":6,"keywords":["quality management system","QMS","processes","outsourced processes","documented procedures","regulatory requirements"],"updated_at":"2026-09-30T03:01:27.480566+00:00"},{"id":2,"section_id":331,"keywords":["QMS requirements","applicable regulatory requirements","organization roles","manufacturer","supplier","authorized representative","importer","distributor"],"updated_at":"2026-09-30T03:01:27.560874+00:00"},{"id":3,"section_id":332,"keywords":["QMS processes","process sequence","process interaction","risk-based approach","process control"],"updated_at":"2026-09-30T03:01:27.639558+00:00"},{"id":4,"section_id":333,"keywords":["process criteria","process effectiveness","resources","monitoring","measurement","analysis","records"],"updated_at":"2026-09-30T03:01:27.707161+00:00"},{"id":5,"section_id":334,"keywords":["process control","QMS change","change control","change impact","regulatory impact","medical device impact"],"updated_at":"2026-09-30T03:01:27.789089+00:00"},{"id":6,"section_id":335,"keywords":["outsourced process","supplier control","external provider","quality agreement","purchasing controls","outsourcing risk"],"updated_at":"2026-09-30T03:01:27.863883+00:00"},{"id":7,"section_id":336,"keywords":["QMS software","computer software validation","software validation","CSV","software revalidation","risk-based validation"],"updated_at":"2026-09-30T03:01:27.947127+00:00"},{"id":8,"section_id":7,"keywords":["documentation","quality manual","documented procedures","records","quality policy"],"updated_at":"2026-09-30T03:01:28.012157+00:00"},{"id":9,"section_id":8,"keywords":["quality manual","scope","exclusions","process interaction","QMS scope"],"updated_at":"2026-09-30T03:01:28.069751+00:00"},{"id":10,"section_id":9,"keywords":["medical device file","device master record","DMR","technical file","device specifications","production procedures","packaging","storage","distribution","installation","servicing"],"updated_at":"2026-09-30T03:01:28.129582+00:00"},{"id":11,"section_id":10,"keywords":["document control","controlled documents","document approval","document revision","obsolete documents","SOP","procedure"],"updated_at":"2026-09-30T03:01:28.194029+00:00"},{"id":12,"section_id":11,"keywords":["records","record control","record retention","traceability records","quality records","retention period"],"updated_at":"2026-09-30T03:01:28.258284+00:00"},{"id":13,"section_id":12,"keywords":["management commitment","top management","regulatory requirements","quality objectives","management review"],"updated_at":"2026-09-30T03:01:28.315901+00:00"},{"id":14,"section_id":13,"keywords":["customer focus","customer requirements","regulatory requirements","customer satisfaction"],"updated_at":"2026-09-30T03:01:28.385858+00:00"},{"id":15,"section_id":14,"keywords":["quality policy","policy statement","commitment to compliance","maintain QMS effectiveness","quality policy communication"],"updated_at":"2026-09-30T03:01:28.449363+00:00"},{"id":16,"section_id":15,"keywords":["quality objectives","measurable objectives","KPI","performance targets"],"updated_at":"2026-09-30T03:01:28.52261+00:00"},{"id":17,"section_id":16,"keywords":["QMS planning","system planning","quality planning","integrity of QMS"],"updated_at":"2026-09-30T03:01:28.592439+00:00"},{"id":18,"section_id":17,"keywords":["responsibility","authority","job description","organizational chart","roles"],"updated_at":"2026-09-30T03:01:28.661674+00:00"},{"id":19,"section_id":18,"keywords":["management representative","QMS representative","regulatory liaison"],"updated_at":"2026-09-30T03:01:28.739854+00:00"},{"id":20,"section_id":19,"keywords":["internal communication","communication process","QMS effectiveness"],"updated_at":"2026-09-30T03:01:28.808235+00:00"},{"id":21,"section_id":20,"keywords":["management review","review meeting","review input","review output","corrective action","audit results"],"updated_at":"2026-09-30T03:01:28.887331+00:00"},{"id":22,"section_id":337,"keywords":["management review","planned intervals","QMS suitability","QMS adequacy","QMS effectiveness","review procedure","review records"],"updated_at":"2026-09-30T03:01:28.975098+00:00"},{"id":23,"section_id":338,"keywords":["management review inputs","feedback","complaints","regulatory reporting","audits","process performance","product conformity","CAPA","previous actions","QMS changes","regulatory changes","improvement recommendations"],"updated_at":"2026-09-30T03:01:29.034429+00:00"},{"id":24,"section_id":339,"keywords":["management review outputs","QMS improvement","product improvement","regulatory changes","resource needs","actions","decisions"],"updated_at":"2026-09-30T03:01:29.10902+00:00"},{"id":25,"section_id":21,"keywords":["resources","resource planning","infrastructure","budget"],"updated_at":"2026-09-30T03:01:29.178574+00:00"},{"id":26,"section_id":22,"keywords":["human resources","competence","training","qualification","awareness","skills","personnel records"],"updated_at":"2026-09-30T03:01:29.246756+00:00"},{"id":27,"section_id":23,"keywords":["infrastructure","facilities","equipment","utilities","maintenance","buildings"],"updated_at":"2026-09-30T03:01:29.324997+00:00"},{"id":28,"section_id":24,"keywords":["work environment","environmental conditions","cleanroom","temperature","humidity","environmental monitoring"],"updated_at":"2026-09-30T03:01:29.401831+00:00"},{"id":29,"section_id":25,"keywords":["contamination control","contamination","sterile","clean area","gowning","bioburden"],"updated_at":"2026-09-30T03:01:29.484889+00:00"},{"id":30,"section_id":26,"keywords":["product realization","quality plan","risk management","design planning","verification","validation","acceptance criteria"],"updated_at":"2026-09-30T03:01:29.544949+00:00"},{"id":31,"section_id":27,"keywords":["customer requirements","intended use","regulatory requirements","product requirements","user needs"],"updated_at":"2026-09-30T03:01:29.61304+00:00"},{"id":32,"section_id":28,"keywords":["requirements review","contract review","order review","tender review"],"updated_at":"2026-09-30T03:01:29.675793+00:00"},{"id":33,"section_id":29,"keywords":["customer communication","product information","feedback","complaints","advisory notices"],"updated_at":"2026-09-30T03:01:29.750626+00:00"},{"id":34,"section_id":30,"keywords":["design and development","design controls","design procedure"],"updated_at":"2026-09-30T03:01:29.810023+00:00"},{"id":35,"section_id":31,"keywords":["design planning","development planning","design stages","design reviews","design team","design schedule"],"updated_at":"2026-09-30T03:01:29.868611+00:00"},{"id":36,"section_id":32,"keywords":["design inputs","user needs","intended use","functional requirements","performance requirements","safety requirements","regulatory inputs"],"updated_at":"2026-09-30T03:01:29.954996+00:00"},{"id":37,"section_id":33,"keywords":["design outputs","drawings","specifications","acceptance criteria","labeling requirements"],"updated_at":"2026-09-30T03:01:30.026656+00:00"},{"id":38,"section_id":34,"keywords":["design review","design review record","formal review","review participants"],"updated_at":"2026-09-30T03:01:30.086657+00:00"},{"id":39,"section_id":35,"keywords":["design verification","verification protocol","verification report","testing","inspection"],"updated_at":"2026-09-30T03:01:30.144561+00:00"},{"id":40,"section_id":36,"keywords":["design validation","validation protocol","validation report","clinical evaluation","usability","intended use","simulated use"],"updated_at":"2026-09-30T03:01:30.203523+00:00"},{"id":41,"section_id":37,"keywords":["design transfer","technology transfer","manufacturing transfer","production release"],"updated_at":"2026-09-30T03:01:30.274216+00:00"},{"id":42,"section_id":38,"keywords":["design change","change control","design change order","ECO","change request","impact assessment"],"updated_at":"2026-09-30T03:01:30.342798+00:00"},{"id":43,"section_id":39,"keywords":["design history file","DHF","design file","technical documentation"],"updated_at":"2026-09-30T03:01:30.402388+00:00"},{"id":44,"section_id":40,"keywords":["purchasing","supplier control","supplier evaluation","approved supplier list","supplier qualification","critical supplier"],"updated_at":"2026-09-30T03:01:30.480596+00:00"},{"id":45,"section_id":41,"keywords":["purchase order","purchasing information","supplier specification","quality agreement"],"updated_at":"2026-09-30T03:01:30.549311+00:00"},{"id":46,"section_id":42,"keywords":["incoming inspection","receiving inspection","supplier verification","certificate of conformance","COC"],"updated_at":"2026-09-30T03:01:30.610234+00:00"},{"id":47,"section_id":43,"keywords":["production control","manufacturing controls","work instructions","batch record","device history record","DHR","in-process inspection"],"updated_at":"2026-09-30T03:01:30.678239+00:00"},{"id":48,"section_id":44,"keywords":["cleanliness","product cleanliness","cleaning procedure","particulate contamination"],"updated_at":"2026-09-30T03:01:30.754772+00:00"},{"id":49,"section_id":45,"keywords":["installation","site installation","installation record","installation verification","installation acceptance criteria"],"updated_at":"2026-09-30T03:01:30.835321+00:00"},{"id":50,"section_id":46,"keywords":["servicing","maintenance","service record","field service","service report"],"updated_at":"2026-09-30T03:01:30.913151+00:00"},{"id":51,"section_id":47,"keywords":["sterile","sterilization","sterility","sterilization batch","sterilization record","SAL"],"updated_at":"2026-09-30T03:01:30.984413+00:00"},{"id":52,"section_id":48,"keywords":["process validation","IQ","OQ","PQ","validation protocol","validation report","revalidation"],"updated_at":"2026-09-30T03:01:31.062567+00:00"},{"id":53,"section_id":49,"keywords":["sterilization validation","sterile barrier","EO sterilization","gamma sterilization","autoclave validation","sterile barrier system","sterile barrier validation"],"updated_at":"2026-09-30T03:01:31.119897+00:00"},{"id":54,"section_id":50,"keywords":["product identification","labeling","part number","lot number","batch number","UDI","unique device identification"],"updated_at":"2026-09-30T03:01:31.190302+00:00"},{"id":55,"section_id":51,"keywords":["traceability","device traceability","lot traceability","implantable device","UDI","distribution records"],"updated_at":"2026-09-30T03:01:31.25784+00:00"},{"id":56,"section_id":340,"keywords":["traceability","documented procedure","extent of traceability","required records","materials","components","processing conditions"],"updated_at":"2026-09-30T03:01:31.339116+00:00"},{"id":57,"section_id":341,"keywords":["implantable medical device","implantable traceability","components","materials","work environment","distribution records","consignee"],"updated_at":"2026-09-30T03:01:31.415153+00:00"},{"id":58,"section_id":52,"keywords":["customer property","customer-supplied product","customer asset","patient data"],"updated_at":"2026-09-30T03:01:31.483797+00:00"},{"id":59,"section_id":53,"keywords":["preservation","packaging","storage","handling","shelf life","expiry date","environmental storage conditions"],"updated_at":"2026-09-30T03:01:31.564047+00:00"},{"id":60,"section_id":54,"keywords":["calibration","measuring equipment","monitoring equipment","calibration records","calibration certificate","measurement uncertainty"],"updated_at":"2026-09-30T03:01:31.631845+00:00"},{"id":61,"section_id":55,"keywords":["measurement","analysis","improvement","statistical techniques","monitoring"],"updated_at":"2026-09-30T03:01:31.702424+00:00"},{"id":62,"section_id":56,"keywords":["customer feedback","post-market surveillance","post-market data","feedback system","complaint trend"],"updated_at":"2026-09-30T03:01:31.770108+00:00"},{"id":63,"section_id":57,"keywords":["complaint","complaint handling","complaint investigation","customer complaint","complaint record","reportable complaint"],"updated_at":"2026-09-30T03:01:31.839298+00:00"},{"id":64,"section_id":58,"keywords":["regulatory reporting","MDR","medical device report","adverse event","vigilance report","field safety corrective action","FSCA","advisory notice"],"updated_at":"2026-09-30T03:01:31.897873+00:00"},{"id":65,"section_id":59,"keywords":["internal audit","audit plan","audit schedule","audit report","audit findings","auditor","audit checklist"],"updated_at":"2026-09-30T03:01:31.967853+00:00"},{"id":66,"section_id":60,"keywords":["process monitoring","process measurement","process performance","KPI","metrics"],"updated_at":"2026-09-30T03:01:32.036334+00:00"},{"id":67,"section_id":61,"keywords":["product inspection","product testing","final inspection","acceptance testing","release criteria","certificate of conformance"],"updated_at":"2026-09-30T03:01:32.115538+00:00"},{"id":68,"section_id":62,"keywords":["nonconforming product","nonconformance","NCR","disposition","quarantine","rejection"],"updated_at":"2026-09-30T03:01:32.17311+00:00"},{"id":69,"section_id":63,"keywords":["rework","repair","scrap","deviation","concession","waiver","disposition"],"updated_at":"2026-09-30T03:01:32.233548+00:00"},{"id":70,"section_id":64,"keywords":["field nonconformance","product recall","field correction","FSCA","advisory notice","customer notification"],"updated_at":"2026-09-30T03:01:32.308324+00:00"},{"id":71,"section_id":65,"keywords":["rework","rework procedure","rework record","rework authorization"],"updated_at":"2026-09-30T03:01:32.380023+00:00"},{"id":72,"section_id":66,"keywords":["data analysis","trend analysis","statistical analysis","quality data","performance data","post-market data"],"updated_at":"2026-09-30T03:01:32.44982+00:00"},{"id":73,"section_id":67,"keywords":["improvement","quality improvement","opportunities for improvement","maintain QMS suitability","maintain QMS adequacy","maintain QMS effectiveness","medical device safety","medical device performance","regulatory requirements"],"updated_at":"2026-09-30T03:01:32.539033+00:00"},{"id":74,"section_id":68,"keywords":["corrective action","CAPA","root cause analysis","corrective action plan","CAR","effectiveness verification"],"updated_at":"2026-09-30T03:01:32.605619+00:00"},{"id":75,"section_id":69,"keywords":["preventive action","CAPA","risk prevention","preventive action plan","PAR"],"updated_at":"2026-09-30T03:01:32.664707+00:00"}]$ref$::jsonb)
on conflict do nothing;
select setval(pg_get_serial_sequence('public.account_section_keywords', 'id'), greatest((select max(id) from public.account_section_keywords), 1));
-- settings_510k: 1 row(s)
insert into public.settings_510k (id, fda_identifiers, default_repository_ids, checklist_template, openfda_enabled, updated_by, updated_at, doc_skill_overrides, dhf_template, device_categories)
select id, fda_identifiers, default_repository_ids, checklist_template, openfda_enabled, updated_by, updated_at, doc_skill_overrides, dhf_template, device_categories from jsonb_populate_recordset(null::public.settings_510k, $ref$[{"id":1,"fda_identifiers":{},"default_repository_ids":[],"checklist_template":[{"label":"Cover letter","section":"Administrative","doc_type":"cover_letter","item_key":"admin.cover_letter"},{"label":"User fee payment","section":"Administrative","doc_type":null,"item_key":"admin.user_fee"},{"label":"Indications for Use statement","section":"Administrative","doc_type":"indications_for_use","item_key":"admin.indications_for_use"},{"label":"510(k) Summary or 510(k) Statement","section":"Administrative","doc_type":"summary_510k","item_key":"admin.summary"},{"label":"Truthful and Accuracy Statement","section":"Administrative","doc_type":"truthful_accuracy","item_key":"admin.truthful_accurate"},{"label":"Device description","section":"Device Description","doc_type":"device_description","item_key":"device.description"},{"label":"Classification regulation and product code","section":"Device Description","doc_type":null,"item_key":"device.classification"},{"label":"Predicate device identified (K-number)","section":"Substantial Equivalence","doc_type":null,"item_key":"se.predicate"},{"label":"Side-by-side comparison with the predicate","section":"Substantial Equivalence","doc_type":"se_comparison","item_key":"se.comparison"},{"label":"Proposed labeling, instructions for use and package labels","section":"Labeling","doc_type":"labeling","item_key":"labeling.proposed"},{"label":"Bench performance testing","section":"Performance Testing","doc_type":"bench_test","item_key":"perf.bench"},{"label":"Biocompatibility (if patient-contacting)","section":"Performance Testing","doc_type":"biocompatibility","item_key":"perf.biocompatibility"},{"label":"Sterilization and shelf life (if provided sterile)","section":"Performance Testing","doc_type":"sterilization","item_key":"perf.sterility"},{"label":"Software documentation (if the device contains software)","section":"Performance Testing","doc_type":"software","item_key":"perf.software"},{"label":"Electrical safety and EMC (if electrically powered)","section":"Performance Testing","doc_type":"electrical_safety","item_key":"perf.electrical"}],"openfda_enabled":true,"updated_by":1,"updated_at":"2026-09-15T21:18:28.781209+00:00","doc_skill_overrides":{},"dhf_template":null,"device_categories":null}]$ref$::jsonb)
on conflict do nothing;
-- settings_mdsap: no rows in orca60

-- ─── Migration ledger ────────────────────────────────────────────────────────

insert into public.schema_migrations (filename) values
  ('003_intelligent_chunking.sql'),
  ('004_quiz_file_content.sql'),
  ('006_router_debug_column.sql'),
  ('007_import_live_progress.sql'),
  ('010_agent_definitions.sql'),
  ('012_agent_run_targets.sql'),
  ('013_agent_run_history.sql'),
  ('014_agent_tool_cache.sql'),
  ('015_agent_memories.sql'),
  ('016_agent_avatar_fields.sql'),
  ('017_agent_personality.sql'),
  ('018_capa_proposals.sql'),
  ('019_capa_proposal_url.sql'),
  ('020_account_scope.sql'),
  ('020_item_field_update_proposals.sql'),
  ('021_agent_chat_only.sql'),
  ('023_agent_run_chain.sql'),
  ('024_sop_rule_extraction.sql'),
  ('025_agent_company_profile.sql'),
  ('026_capa_action_item_orcanos_fields.sql'),
  ('027_510k_submissions.sql'),
  ('028_agent_callable_agents.sql'),
  ('029_510k_device_categories.sql'),
  ('030_510k_doc_skill_overrides.sql'),
  ('031_dhf.sql'),
  ('032_enable_rls.sql'),
  ('033_automation_agents.sql'),
  ('034_action_item_proposals.sql'),
  ('035_search_current_revision_only.sql'),
  ('036_document_diff_analyses.sql'),
  ('037_repository_visibility.sql'),
  ('038_agent_run_message_data.sql'),
  ('039_mdsap.sql'),
  ('040_mdsap_document_data_gaps.sql'),
  ('041_standard_section_metadata.sql')
on conflict do nothing;
