-- VeatsAI — initial schema
-- Apply with the Supabase SQL editor or `supabase db push`.
-- The app accesses the database server-side only, with the service-role key.
-- RLS is enabled on every table and no anon/authenticated policies are created,
-- so the public anon key cannot read or write data.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique,
  role text not null default 'engineer' check (role in ('engineer', 'sales', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists standards (
  code text primary key,                 -- e.g. 'IEC 60364'
  family text not null,                  -- 'IEC' | 'NEC' | ...
  title text not null,
  topic text,
  version text not null default 'configurable',  -- never invent an edition; configure explicitly
  used_for jsonb not null default '[]',
  implemented boolean not null default false
);

create table if not exists products (
  sku text primary key,
  name text not null,
  category text not null,
  unit text not null,
  purchase_price_eur numeric(12,2) not null,
  selling_price_eur numeric(12,2) not null,
  min_stock_level integer not null default 0,
  attributes jsonb not null default '{}',     -- machine-readable specs used by the selection engine
  source text not null default 'client_dataset' check (source in ('client_dataset', 'demo_supplement'))
);

create table if not exists inventory (
  sku text primary key references products(sku) on delete cascade,
  stock_quantity integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists projects (
  id text primary key,
  title text not null,
  client_name text not null,
  original_request text not null,
  status text not null check (status in ('DRAFT','MISSING_INFORMATION','AI_PROCESSING','ENGINEERING_REVIEW','NEEDS_CHANGES','APPROVED')),
  engineer text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  analysis jsonb,                 -- AI interpretation (RequestAnalysis)
  inputs jsonb,                   -- engine inputs with provenance (DesignInputs)
  cost_settings jsonb not null,
  bom_overrides jsonb not null default '{}',
  custom_lines jsonb not null default '[]',
  acknowledged_warnings jsonb not null default '{}',
  notes jsonb not null default '[]',
  history jsonb not null default '[]',
  design jsonb,                   -- calculation + BOM + cost + CAD snapshot
  approved_by text,
  approved_at timestamptz
);

create table if not exists project_components (
  id bigint generated always as identity primary key,
  project_id text not null references projects(id) on delete cascade,
  line_id text not null,
  sku text references products(sku),
  name text not null,
  category text,
  function text,
  specification text,
  required_spec text,
  quantity numeric(12,2) not null,
  unit text,
  unit_price numeric(12,2),
  stock_status text,
  standard_reference text[],
  reasoning text,
  provenance text
);
create index if not exists project_components_project_idx on project_components(project_id);

create table if not exists engineering_calculations (
  id bigint generated always as identity primary key,
  project_id text not null references projects(id) on delete cascade,
  result_id text not null,
  label text not null,
  value text not null,
  numeric_value numeric,
  unit text,
  formula text,
  reason text,
  rule_id text,
  standards text[],
  provenance text,
  status text
);
create index if not exists engineering_calculations_project_idx on engineering_calculations(project_id);

create table if not exists quotes (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  quote_number text not null unique,
  total numeric(12,2) not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','ISSUED')),
  approval_status text not null,
  snapshot jsonb,
  created_at timestamptz not null default now()
);

create table if not exists project_reviews (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  action text not null,
  author text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists project_reviews_project_idx on project_reviews(project_id);

alter table users enable row level security;
alter table standards enable row level security;
alter table products enable row level security;
alter table inventory enable row level security;
alter table projects enable row level security;
alter table project_components enable row level security;
alter table engineering_calculations enable row level security;
alter table quotes enable row level security;
alter table project_reviews enable row level security;
