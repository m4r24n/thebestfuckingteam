-- TBFT v0.5 — Supabase Auth, shared workspaces, database persistence and Realtime
-- Safe to run on a new project or over the earlier TBFT schema.
-- Run the whole file in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

do $$ begin
  create type public.workspace_type as enum ('solo', 'couple');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.workspace_role as enum ('owner', 'partner');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.task_priority as enum ('low', 'normal', 'high');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.project_view as enum ('flow', 'folders', 'terminal');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  initials text not null default '',
  accent text not null default '#7c9caa',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'The Best Fucking Team',
  type public.workspace_type not null default 'solo',
  timezone text not null default 'Europe/Berlin',
  rollover_hour smallint not null default 6 check (rollover_hour between 0 and 23),
  discreet_mode boolean not null default false,
  ui_density text not null default 'compact' check (ui_density in ('compact', 'comfortable', 'large')),
  accent_color text not null default '#a38b57',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.workspace_role not null default 'partner',
  position smallint not null default 1 check (position in (1, 2)),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  unique (workspace_id, position)
);

create unique index if not exists workspace_members_one_workspace_per_user
  on public.workspace_members(user_id);

create table if not exists public.partner_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invited_by uuid not null references public.profiles(id),
  email text,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.partner_invitations alter column email drop not null;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  description text not null default '',
  owner_user_id uuid references public.profiles(id),
  is_joint boolean not null default true,
  target_date date,
  preferred_view public.project_view not null default 'flow',
  manual_progress smallint check (manual_progress between 0 and 100),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.project_nodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_node_id uuid references public.project_nodes(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '',
  position integer not null default 0,
  weight numeric(7, 2) not null default 1 check (weight > 0),
  manual_progress smallint check (manual_progress between 0 and 100),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_dependencies (
  project_id uuid not null references public.projects(id) on delete cascade,
  from_node_id uuid not null references public.project_nodes(id) on delete cascade,
  to_node_id uuid not null references public.project_nodes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_node_id, to_node_id),
  check (from_node_id <> to_node_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text not null default '',
  owner_user_id uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  original_date date not null,
  deadline time,
  priority public.task_priority not null default 'normal',
  project_id uuid references public.projects(id) on delete set null,
  project_node_id uuid references public.project_nodes(id) on delete set null,
  completed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_day_appearances (
  task_id uuid not null references public.tasks(id) on delete cascade,
  board_date date not null,
  appearance_type text not null check (appearance_type in ('original', 'carried')),
  created_at timestamptz not null default now(),
  primary key (task_id, board_date)
);

create table if not exists public.task_messages (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 10000),
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tasks_workspace_date_idx on public.tasks(workspace_id, original_date) where deleted_at is null;
create index if not exists tasks_owner_idx on public.tasks(owner_user_id) where deleted_at is null;
create index if not exists task_appearances_date_idx on public.task_day_appearances(board_date);
create index if not exists task_messages_task_idx on public.task_messages(task_id, created_at);
create index if not exists project_nodes_project_idx on public.project_nodes(project_id, position);
create index if not exists activity_workspace_idx on public.activity_log(workspace_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at before update on public.workspaces
for each row execute function public.set_updated_at();
drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at before update on public.projects
for each row execute function public.set_updated_at();
drop trigger if exists project_nodes_set_updated_at on public.project_nodes;
create trigger project_nodes_set_updated_at before update on public.project_nodes
for each row execute function public.set_updated_at();
drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  chosen_name text;
begin
  chosen_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    split_part(coalesce(new.email, 'User'), '@', 1)
  );

  insert into public.profiles (id, display_name, initials)
  values (new.id, chosen_name, upper(left(chosen_name, 2)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill a profile if a user was created before this SQL was installed.
insert into public.profiles (id, display_name, initials)
select
  u.id,
  coalesce(nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(u.email, 'User'), '@', 1)),
  upper(left(coalesce(nullif(trim(u.raw_user_meta_data ->> 'display_name'), ''), split_part(coalesce(u.email, 'U'), '@', 1)), 2))
from auth.users u
on conflict (id) do nothing;

create or replace function public.is_workspace_member(target_workspace uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace and user_id = target_user
  );
$$;

create or replace function public.is_workspace_owner(target_workspace uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace and user_id = target_user and role = 'owner'
  );
$$;

create or replace function public.shares_workspace(other_user uuid, target_user uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs using (workspace_id)
    where mine.user_id = target_user and theirs.user_id = other_user
  );
$$;

create or replace function public.create_workspace_with_owner(
  workspace_name text,
  workspace_type_value public.workspace_type,
  workspace_timezone text default 'Europe/Berlin',
  display_name_value text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  new_workspace_id uuid;
  existing_workspace_id uuid;
  clean_name text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select workspace_id into existing_workspace_id
  from public.workspace_members where user_id = auth.uid() limit 1;
  if existing_workspace_id is not null then
    return existing_workspace_id;
  end if;

  clean_name := coalesce(nullif(trim(display_name_value), ''), 'User');
  insert into public.profiles (id, display_name, initials)
  values (auth.uid(), clean_name, upper(left(clean_name, 2)))
  on conflict (id) do update set
    display_name = excluded.display_name,
    initials = excluded.initials;

  insert into public.workspaces (name, type, timezone, created_by)
  values (
    coalesce(nullif(trim(workspace_name), ''), 'The Best Fucking Team'),
    workspace_type_value,
    coalesce(nullif(trim(workspace_timezone), ''), 'Europe/Berlin'),
    auth.uid()
  ) returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role, position)
  values (new_workspace_id, auth.uid(), 'owner', 1);

  return new_workspace_id;
end;
$$;

create or replace function public.create_partner_invite(target_workspace uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  invite_code text;
  member_count integer;
begin
  if auth.uid() is null or not public.is_workspace_owner(target_workspace) then
    raise exception 'Only the workspace owner can create a partner invitation';
  end if;

  select count(*) into member_count from public.workspace_members where workspace_id = target_workspace;
  if member_count >= 2 then
    raise exception 'This couple workspace already has two members';
  end if;

  update public.workspaces set type = 'couple' where id = target_workspace;
  delete from public.partner_invitations
  where workspace_id = target_workspace and accepted_at is null;

  invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.partner_invitations (
    workspace_id, invited_by, token_hash, expires_at
  ) values (
    target_workspace,
    auth.uid(),
    encode(digest(invite_code, 'sha256'), 'hex'),
    now() + interval '14 days'
  );

  return invite_code;
end;
$$;

create or replace function public.accept_partner_invite(invite_code text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  invite_row public.partner_invitations%rowtype;
  member_count integer;
  existing_workspace uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select workspace_id into existing_workspace
  from public.workspace_members where user_id = auth.uid() limit 1;
  if existing_workspace is not null then
    return existing_workspace;
  end if;

  select * into invite_row
  from public.partner_invitations
  where token_hash = encode(digest(upper(trim(invite_code)), 'sha256'), 'hex')
    and accepted_at is null
    and expires_at > now()
  for update;

  if invite_row.id is null then
    raise exception 'This invitation code is invalid or expired';
  end if;

  select count(*) into member_count
  from public.workspace_members where workspace_id = invite_row.workspace_id;
  if member_count >= 2 then
    raise exception 'This couple workspace is already full';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, position)
  values (invite_row.workspace_id, auth.uid(), 'partner', 2);

  update public.partner_invitations set accepted_at = now() where id = invite_row.id;
  update public.workspaces set type = 'couple' where id = invite_row.workspace_id;

  return invite_row.workspace_id;
end;
$$;

create or replace function public.prevent_protected_task_changes()
returns trigger
language plpgsql
security invoker set search_path = public
as $$
declare
  workspace_tz text;
  workspace_rollover smallint;
  current_board_date date;
begin
  if auth.uid() is null then return new; end if;

  if new.workspace_id is distinct from old.workspace_id
     or new.created_by is distinct from old.created_by then
    raise exception 'Task workspace and creator cannot be changed';
  end if;

  if new.owner_user_id is distinct from old.owner_user_id
     and auth.uid() <> old.owner_user_id then
    raise exception 'Only the task owner can transfer ownership';
  end if;

  if (new.completed_at is distinct from old.completed_at or new.deleted_at is distinct from old.deleted_at)
     and auth.uid() <> old.owner_user_id then
    raise exception 'Only the task owner can complete or delete this task';
  end if;

  select timezone, rollover_hour into workspace_tz, workspace_rollover
  from public.workspaces where id = old.workspace_id;
  current_board_date := ((now() at time zone workspace_tz) - make_interval(hours => workspace_rollover))::date;

  if new.original_date is distinct from old.original_date
     and new.original_date < current_board_date then
    raise exception 'A task cannot be moved into a closed historical board';
  end if;

  if old.completed_at is null and new.completed_at is not null then
    if (now() at time zone workspace_tz)::date < old.original_date then
      raise exception 'A task cannot be completed before its scheduled date';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_protect_owner_actions on public.tasks;
create trigger tasks_protect_owner_actions
before update on public.tasks
for each row execute function public.prevent_protected_task_changes();

create or replace function public.validate_new_task_schedule()
returns trigger
language plpgsql
security invoker set search_path = public
as $$
declare
  workspace_tz text;
  workspace_rollover smallint;
  current_board_date date;
begin
  select timezone, rollover_hour into workspace_tz, workspace_rollover
  from public.workspaces where id = new.workspace_id;
  current_board_date := ((now() at time zone workspace_tz) - make_interval(hours => workspace_rollover))::date;
  if new.original_date < current_board_date then
    raise exception 'A new task cannot be added to a closed historical board';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_validate_new_schedule on public.tasks;
create trigger tasks_validate_new_schedule
before insert on public.tasks
for each row execute function public.validate_new_task_schedule();

create or replace function public.sync_task_original_appearance()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.original_date is distinct from old.original_date then
    delete from public.task_day_appearances
    where task_id = new.id and (appearance_type = 'original' or board_date < new.original_date);
  end if;

  insert into public.task_day_appearances(task_id, board_date, appearance_type)
  values (new.id, new.original_date, 'original')
  on conflict (task_id, board_date) do update set appearance_type = 'original';
  return new;
end;
$$;

drop trigger if exists tasks_create_original_appearance on public.tasks;
drop trigger if exists tasks_sync_original_appearance on public.tasks;
create trigger tasks_sync_original_appearance
after insert or update of original_date on public.tasks
for each row execute function public.sync_task_original_appearance();

create or replace function public.repair_workspace_rollovers(target_workspace uuid, target_board_date date)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  inserted_count integer := 0;
  workspace_tz text;
  workspace_rollover smallint;
begin
  if auth.uid() is null or not public.is_workspace_member(target_workspace) then
    raise exception 'You are not a member of this workspace';
  end if;

  select timezone, rollover_hour into workspace_tz, workspace_rollover
  from public.workspaces where id = target_workspace;

  insert into public.task_day_appearances(task_id, board_date, appearance_type)
  select
    t.id,
    series_date::date,
    'carried'
  from public.tasks t
  cross join lateral generate_series(
    t.original_date + 1,
    least(
      target_board_date,
      coalesce(
        ((t.completed_at at time zone workspace_tz) - make_interval(hours => workspace_rollover))::date,
        target_board_date
      )
    ),
    interval '1 day'
  ) as series_date
  where t.workspace_id = target_workspace
    and t.deleted_at is null
    and t.original_date < target_board_date
  on conflict (task_id, board_date) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

-- Keep the earlier function name usable by older builds.
create or replace function public.rollover_workspace_tasks(target_workspace uuid, target_board_date date)
returns integer
language sql
security definer set search_path = public
as $$
  select public.repair_workspace_rollovers(target_workspace, target_board_date);
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.partner_invitations enable row level security;
alter table public.projects enable row level security;
alter table public.project_nodes enable row level security;
alter table public.project_dependencies enable row level security;
alter table public.tasks enable row level security;
alter table public.task_day_appearances enable row level security;
alter table public.task_messages enable row level security;
alter table public.activity_log enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "profiles shared workspace read" on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles shared workspace read" on public.profiles
for select to authenticated using (id = (select auth.uid()) or public.shares_workspace(id));
create policy "profiles self update" on public.profiles
for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "workspace member read" on public.workspaces;
drop policy if exists "workspace create" on public.workspaces;
drop policy if exists "workspace owner update" on public.workspaces;
drop policy if exists "workspace member update" on public.workspaces;
create policy "workspace member read" on public.workspaces
for select to authenticated using (public.is_workspace_member(id));
create policy "workspace create" on public.workspaces
for insert to authenticated with check (created_by = (select auth.uid()));
create policy "workspace member update" on public.workspaces
for update to authenticated using (public.is_workspace_member(id)) with check (public.is_workspace_member(id));

drop policy if exists "members read workspace" on public.workspace_members;
drop policy if exists "creator adds first membership" on public.workspace_members;
drop policy if exists "owner manages members" on public.workspace_members;
create policy "members read workspace" on public.workspace_members
for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "creator adds first membership" on public.workspace_members
for insert to authenticated with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.workspaces w where w.id = workspace_id and w.created_by = (select auth.uid()))
);
create policy "owner manages members" on public.workspace_members
for all to authenticated using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id));

drop policy if exists "owner manages invitations" on public.partner_invitations;
create policy "owner manages invitations" on public.partner_invitations
for all to authenticated using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id));

drop policy if exists "members read projects" on public.projects;
drop policy if exists "members create projects" on public.projects;
drop policy if exists "members update projects" on public.projects;
create policy "members read projects" on public.projects
for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members create projects" on public.projects
for insert to authenticated with check (public.is_workspace_member(workspace_id) and created_by = (select auth.uid()));
create policy "members update projects" on public.projects
for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

drop policy if exists "members manage project nodes" on public.project_nodes;
create policy "members manage project nodes" on public.project_nodes
for all to authenticated
using (exists (select 1 from public.projects p where p.id = project_id and public.is_workspace_member(p.workspace_id)))
with check (exists (select 1 from public.projects p where p.id = project_id and public.is_workspace_member(p.workspace_id)));

drop policy if exists "members manage dependencies" on public.project_dependencies;
create policy "members manage dependencies" on public.project_dependencies
for all to authenticated
using (exists (select 1 from public.projects p where p.id = project_id and public.is_workspace_member(p.workspace_id)))
with check (exists (select 1 from public.projects p where p.id = project_id and public.is_workspace_member(p.workspace_id)));

drop policy if exists "members read tasks" on public.tasks;
drop policy if exists "members create tasks" on public.tasks;
drop policy if exists "members edit tasks" on public.tasks;
drop policy if exists "owners hard delete tasks" on public.tasks;
create policy "members read tasks" on public.tasks
for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members create tasks" on public.tasks
for insert to authenticated with check (
  public.is_workspace_member(workspace_id)
  and created_by = (select auth.uid())
  and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = tasks.workspace_id and wm.user_id = tasks.owner_user_id
  )
);
create policy "members edit tasks" on public.tasks
for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (
  public.is_workspace_member(workspace_id)
  and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = tasks.workspace_id and wm.user_id = tasks.owner_user_id
  )
);
create policy "owners hard delete tasks" on public.tasks
for delete to authenticated using (owner_user_id = (select auth.uid()));

drop policy if exists "members read appearances" on public.task_day_appearances;
create policy "members read appearances" on public.task_day_appearances
for select to authenticated
using (exists (select 1 from public.tasks t where t.id = task_id and public.is_workspace_member(t.workspace_id)));

drop policy if exists "members read messages" on public.task_messages;
drop policy if exists "members create messages" on public.task_messages;
drop policy if exists "authors update messages" on public.task_messages;
create policy "members read messages" on public.task_messages
for select to authenticated
using (exists (select 1 from public.tasks t where t.id = task_id and public.is_workspace_member(t.workspace_id)));
create policy "members create messages" on public.task_messages
for insert to authenticated with check (
  author_id = (select auth.uid())
  and exists (select 1 from public.tasks t where t.id = task_id and public.is_workspace_member(t.workspace_id))
);
create policy "authors update messages" on public.task_messages
for update to authenticated using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));

drop policy if exists "members read activity" on public.activity_log;
drop policy if exists "members create own activity" on public.activity_log;
create policy "members read activity" on public.activity_log
for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members create own activity" on public.activity_log
for insert to authenticated with check (public.is_workspace_member(workspace_id) and actor_id = (select auth.uid()));

drop policy if exists "users read notifications" on public.notifications;
drop policy if exists "users update notifications" on public.notifications;
create policy "users read notifications" on public.notifications
for select to authenticated using (user_id = (select auth.uid()));
create policy "users update notifications" on public.notifications
for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant usage on schema public to authenticated;
grant select, insert, update, delete on table
  public.profiles,
  public.workspaces,
  public.workspace_members,
  public.partner_invitations,
  public.projects,
  public.project_nodes,
  public.project_dependencies,
  public.tasks,
  public.task_day_appearances,
  public.task_messages,
  public.activity_log,
  public.notifications
to authenticated;
revoke all on table
  public.profiles,
  public.workspaces,
  public.workspace_members,
  public.partner_invitations,
  public.projects,
  public.project_nodes,
  public.project_dependencies,
  public.tasks,
  public.task_day_appearances,
  public.task_messages,
  public.activity_log,
  public.notifications
from anon;

grant execute on function public.create_workspace_with_owner(text, public.workspace_type, text, text) to authenticated;
grant execute on function public.create_partner_invite(uuid) to authenticated;
grant execute on function public.accept_partner_invite(text) to authenticated;
grant execute on function public.repair_workspace_rollovers(uuid, date) to authenticated;
grant execute on function public.rollover_workspace_tasks(uuid, date) to authenticated;

-- Add collaborative tables to the Realtime publication only once.
do $$
declare
  table_name_value text;
begin
  foreach table_name_value in array array[
    'workspaces', 'workspace_members', 'tasks', 'task_messages',
    'projects', 'project_nodes', 'activity_log'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name_value
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name_value);
    end if;
  end loop;
end $$;
