-- VeatsAI — engineer accounts, persistent approvals, transactional release with inventory deduction.
-- Apply after 0001_init.sql (Supabase SQL editor or `supabase db push`). Safe to re-run.
-- The app talks to the database server-side only, with the service-role key.

-- ------------------------------------------------------------------ engineer accounts
-- Reuses the existing `users` table (role 'engineer' | 'sales' | 'admin').
alter table users add column if not exists password_hash text;          -- scrypt$N$r$p$salt$hash (see src/lib/auth/password.ts)
alter table users add column if not exists active boolean not null default true;
alter table users add column if not exists last_login_at timestamptz;
create unique index if not exists users_email_lower_idx on users (lower(email));

-- ------------------------------------------------------------------ project lifecycle
-- Draft → In progress → Pending approval (ENGINEERING_REVIEW) → Approved → Released
alter table projects drop constraint if exists projects_status_check;
alter table projects add constraint projects_status_check check (
  status in ('DRAFT','IN_PROGRESS','MISSING_INFORMATION','AI_PROCESSING','ENGINEERING_REVIEW','NEEDS_CHANGES','APPROVED','RELEASED')
);
alter table projects add column if not exists approved_by_id uuid references users(id);
alter table projects add column if not exists released_at timestamptz;
alter table projects add column if not exists released_by text;
alter table projects add column if not exists released_by_id uuid references users(id);
alter table projects add column if not exists plan jsonb;               -- uploaded architectural plan, analysis, electrical plan

-- ------------------------------------------------------------------ approvals
create table if not exists project_approvals (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references projects(id) on delete cascade,
  engineer_id uuid references users(id),            -- null only for legacy approvals recorded before accounts existed
  engineer_name text not null,
  status text not null default 'APPROVED' check (status in ('APPROVED','REVOKED')),
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  total_eur numeric(12,2),
  legacy boolean not null default false
);
create index if not exists project_approvals_project_idx on project_approvals(project_id);
-- At most one ACTIVE approval per project: a duplicate approval is impossible at the database level.
create unique index if not exists project_approvals_one_active on project_approvals(project_id) where status = 'APPROVED';
alter table project_approvals enable row level security;

insert into project_approvals (project_id, engineer_name, approved_at, total_eur, legacy)
select p.id, coalesce(p.approved_by, 'Unknown engineer'), coalesce(p.approved_at, p.updated_at), (p.design->'cost'->>'total')::numeric, true
from projects p
where p.status in ('APPROVED','RELEASED') and not exists (select 1 from project_approvals a where a.project_id = p.id);

-- ------------------------------------------------------------------ inventory
-- Stock can hold fractional quantities (cable metres) and can never go negative.
alter table inventory alter column stock_quantity type numeric(14,2);
alter table inventory drop constraint if exists inventory_stock_nonneg;
alter table inventory add constraint inventory_stock_nonneg check (stock_quantity >= 0);

create table if not exists inventory_movements (
  id bigint generated always as identity primary key,
  sku text not null references products(sku),
  project_id text not null references projects(id),
  quantity_change numeric(14,2) not null,           -- negative = taken out of stock
  stock_before numeric(14,2) not null,
  stock_after numeric(14,2) not null,
  reason text not null default 'PROJECT_RELEASE' check (reason in ('PROJECT_RELEASE')),
  actor_id uuid references users(id),
  actor_name text not null,
  created_at timestamptz not null default now(),
  -- a project can deduct a given SKU only once: repeated or concurrent releases cannot double-deduct
  unique (project_id, sku, reason)
);
create index if not exists inventory_movements_project_idx on inventory_movements(project_id);
alter table inventory_movements enable row level security;

-- ------------------------------------------------------------------ approve_project
-- Runs in one transaction under a row lock on the project.
create or replace function approve_project(p_project_id text, p_engineer_id uuid, p_engineer_name text, p_total numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project projects%rowtype;
  v_approval project_approvals%rowtype;
  v_now timestamptz := now();
begin
  select * into v_project from projects where id = p_project_id for update;
  if not found then raise exception 'VEATS:NOT_FOUND'; end if;
  if v_project.status = 'RELEASED' then raise exception 'VEATS:ALREADY_RELEASED'; end if;
  if v_project.status = 'APPROVED' then raise exception 'VEATS:ALREADY_APPROVED:%', coalesce(v_project.approved_by, ''); end if;
  if v_project.status not in ('ENGINEERING_REVIEW', 'NEEDS_CHANGES') then raise exception 'VEATS:BAD_STATUS:%', v_project.status; end if;
  if not exists (select 1 from users where id = p_engineer_id and role = 'engineer' and active) then raise exception 'VEATS:NOT_ENGINEER'; end if;

  insert into project_approvals (project_id, engineer_id, engineer_name, status, approved_at, total_eur)
  values (p_project_id, p_engineer_id, p_engineer_name, 'APPROVED', v_now, p_total)
  returning * into v_approval;

  update projects
     set status = 'APPROVED', approved_by = p_engineer_name, approved_by_id = p_engineer_id, approved_at = v_now, updated_at = v_now
   where id = p_project_id;

  return jsonb_build_object('approval', to_jsonb(v_approval));
end;
$$;

-- ------------------------------------------------------------------ release_project
-- Deducts the exact quantities from inventory, records every movement and marks the project RELEASED —
-- all or nothing. Stock rows are locked in SKU order (no deadlocks) and a project can only release once.
-- p_requirements: [{"sku": "...", "quantity": 10}, ...]
create or replace function release_project(p_project_id text, p_requirements jsonb, p_actor_id uuid, p_actor_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project projects%rowtype;
  v_now timestamptz := now();
  r record;
  v_stock numeric;
  v_missing text := '';
  v_short jsonb := '[]'::jsonb;
begin
  select * into v_project from projects where id = p_project_id for update;
  if not found then raise exception 'VEATS:NOT_FOUND'; end if;
  if v_project.status = 'RELEASED' then raise exception 'VEATS:ALREADY_RELEASED'; end if;
  if v_project.status <> 'APPROVED' then raise exception 'VEATS:NOT_APPROVED:%', v_project.status; end if;
  if not exists (select 1 from users where id = p_actor_id and role = 'engineer' and active) then raise exception 'VEATS:NOT_ENGINEER'; end if;
  if exists (select 1 from inventory_movements where project_id = p_project_id and reason = 'PROJECT_RELEASE') then raise exception 'VEATS:ALREADY_RELEASED'; end if;

  if not exists (select 1 from jsonb_to_recordset(p_requirements) as x(sku text, quantity numeric) where x.quantity > 0) then
    raise exception 'VEATS:NO_MATERIALS';
  end if;

  -- 1. lock and check every stock row first
  for r in
    select x.sku, sum(x.quantity) as qty
      from jsonb_to_recordset(p_requirements) as x(sku text, quantity numeric)
     where x.quantity > 0
     group by x.sku
     order by x.sku
  loop
    select stock_quantity into v_stock from inventory where sku = r.sku for update;
    if not found then
      v_missing := v_missing || case when v_missing = '' then '' else ',' end || r.sku;
    elsif v_stock < r.qty then
      v_short := v_short || jsonb_build_array(jsonb_build_object('sku', r.sku, 'required', r.qty, 'available', v_stock));
    end if;
  end loop;
  if v_missing <> '' then raise exception 'VEATS:MISSING_MATERIAL:%', v_missing; end if;
  if jsonb_array_length(v_short) > 0 then raise exception 'VEATS:INSUFFICIENT_STOCK:%', v_short::text; end if;

  -- 2. deduct and record
  for r in
    select x.sku, sum(x.quantity) as qty
      from jsonb_to_recordset(p_requirements) as x(sku text, quantity numeric)
     where x.quantity > 0
     group by x.sku
     order by x.sku
  loop
    select stock_quantity into v_stock from inventory where sku = r.sku;
    update inventory set stock_quantity = stock_quantity - r.qty, updated_at = v_now where sku = r.sku;
    insert into inventory_movements (sku, project_id, quantity_change, stock_before, stock_after, reason, actor_id, actor_name, created_at)
    values (r.sku, p_project_id, -r.qty, v_stock, v_stock - r.qty, 'PROJECT_RELEASE', p_actor_id, p_actor_name, v_now);
  end loop;

  update projects
     set status = 'RELEASED', released_at = v_now, released_by = p_actor_name, released_by_id = p_actor_id, updated_at = v_now
   where id = p_project_id;

  return jsonb_build_object('movements', (select coalesce(jsonb_agg(to_jsonb(m) order by m.sku), '[]'::jsonb) from inventory_movements m where m.project_id = p_project_id));
end;
$$;

-- only the service role (server) may call the functions
revoke all on function approve_project(text, uuid, text, numeric) from public, anon, authenticated;
revoke all on function release_project(text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function approve_project(text, uuid, text, numeric) to service_role;
grant execute on function release_project(text, jsonb, uuid, text) to service_role;
