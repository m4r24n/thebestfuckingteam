-- The Best Fucking Team (TBFT)
-- Production-ready database foundation for Supabase PostgreSQL.
-- Run this file in Supabase > SQL Editor on a new project.

create extension if not exists pgcrypto;

create type public.workspace_type as enum ('solo', 'couple');
create type public.workspace_role as enum ('owner', 'partner');
create type public.task_priority as enum ('low', 'normal', 'high');
create type public.project_view as enum ('flow', 'folders', 'terminal');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  initials text not null default '',
  accent text not null default '#d9ff57',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'The Best Fucking Team',
  type public.workspace_type not null default 'solo',
  timezone text not null default 'Europe/Berlin',
  rollover_hour smallint not null default 6 check (rollover_hour between 0 and 23),
  discreet_mode boolean not null default false,
  ui_density text not null default 'compact' check (ui_density in ('compact', 'comfortable', 'large')),
  accent_color text not null default '#17181a',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.workspace_role not null default 'partner',
  position smallint not null default 1 check (position in (1, 2)),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  unique (workspace_id, position)
);

create table public.partner_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invited_by uuid not null references public.profiles(id),
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.projects (
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

create table public.project_nodes (
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

create table public.project_dependencies (
  project_id uuid not null references public.projects(id) on delete cascade,
  from_node_id uuid not null references public.project_nodes(id) on delete cascade,
  to_node_id uuid not null references public.project_nodes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_node_id, to_node_id),
  check (from_node_id <> to_node_id)
);

create table public.tasks (
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

create table public.task_day_appearances (
  task_id uuid not null references public.tasks(id) on delete cascade,
  board_date date not null,
  appearance_type text not null check (appearance_type in ('original', 'carried')),
  created_at timestamptz not null default now(),
  primary key (task_id, board_date)
);

create table public.task_messages (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 10000),
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.activity_log (
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

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index tasks_workspace_date_idx on public.tasks(workspace_id, original_date) where deleted_at is null;
create index tasks_owner_idx on public.tasks(owner_user_id) where deleted_at is null;
create index task_appearances_date_idx on public.task_day_appearances(board_date);
create index task_messages_task_idx on public.task_messages(task_id, created_at);
create index project_nodes_project_idx on public.project_nodes(project_id, position);
create index activity_workspace_idx on public.activity_log(workspace_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger workspaces_set_updated_at before update on public.workspaces
for each row execute function public.set_updated_at();
create trigger projects_set_updated_at before update on public.projects
for each row execute function public.set_updated_at();
create trigger project_nodes_set_updated_at before update on public.project_nodes
for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, initials)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, 'User'), '@', 1)),
    upper(left(coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, 'U'), '@', 1)), 2))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Security-definer helper functions prevent recursive RLS checks on membership.
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

create or replace function public.prevent_protected_task_changes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  workspace_tz text;
begin
  if auth.uid() is null then
    return new;
  end if;

  if (new.completed_at is distinct from old.completed_at or new.deleted_at is distinct from old.deleted_at)
     and auth.uid() <> old.owner_user_id then
    raise exception 'Only the task owner can complete or delete this task';
  end if;

  if old.completed_at is null and new.completed_at is not null then
    select timezone into workspace_tz from public.workspaces where id = old.workspace_id;
    if (now() at time zone workspace_tz)::date < old.original_date then
      raise exception 'A task cannot be completed before its scheduled date';
    end if;
  end if;

  return new;
end;
$$;

create trigger tasks_protect_owner_actions
before update on public.tasks
for each row execute function public.prevent_protected_task_changes();

create or replace function public.create_original_task_appearance()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.task_day_appearances(task_id, board_date, appearance_type)
  values (new.id, new.original_date, 'original')
  on conflict do nothing;
  return new;
end;
$$;

create trigger tasks_create_original_appearance
after insert on public.tasks
for each row execute function public.create_original_task_appearance();

-- Idempotent rollover: the same task/date pair can only be inserted once.
create or replace function public.rollover_workspace_tasks(target_workspace uuid, target_board_date date)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  inserted_count integer;
begin
  insert into public.task_day_appearances(task_id, board_date, appearance_type)
  select t.id, target_board_date, 'carried'
  from public.tasks t
  where t.workspace_id = target_workspace
    and t.deleted_at is null
    and t.completed_at is null
    and t.original_date < target_board_date
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
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

create policy "profiles shared workspace read" on public.profiles
for select to authenticated
using (id = auth.uid() or public.shares_workspace(id));
create policy "profiles self update" on public.profiles
for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy "workspace member read" on public.workspaces
for select to authenticated using (public.is_workspace_member(id));
create policy "workspace create" on public.workspaces
for insert to authenticated with check (created_by = auth.uid());
create policy "workspace owner update" on public.workspaces
for update to authenticated using (public.is_workspace_owner(id)) with check (public.is_workspace_owner(id));

create policy "members read workspace" on public.workspace_members
for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "creator adds first membership" on public.workspace_members
for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from public.workspaces w where w.id = workspace_id and w.created_by = auth.uid())
);
create policy "owner manages members" on public.workspace_members
for all to authenticated using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id));

create policy "owner manages invitations" on public.partner_invitations
for all to authenticated using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id));

create policy "members read projects" on public.projects
for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members create projects" on public.projects
for insert to authenticated with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy "members update projects" on public.projects
for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

create policy "members manage project nodes" on public.project_nodes
for all to authenticated
using (exists (select 1 from public.projects p where p.id = project_id and public.is_workspace_member(p.workspace_id)))
with check (exists (select 1 from public.projects p where p.id = project_id and public.is_workspace_member(p.workspace_id)));

create policy "members manage dependencies" on public.project_dependencies
for all to authenticated
using (exists (select 1 from public.projects p where p.id = project_id and public.is_workspace_member(p.workspace_id)))
with check (exists (select 1 from public.projects p where p.id = project_id and public.is_workspace_member(p.workspace_id)));

create policy "members read tasks" on public.tasks
for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members create tasks" on public.tasks
for insert to authenticated with check (
  public.is_workspace_member(workspace_id)
  and created_by = auth.uid()
  and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = tasks.workspace_id and wm.user_id = tasks.owner_user_id
  )
);
create policy "members edit tasks" on public.tasks
for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "owners hard delete tasks" on public.tasks
for delete to authenticated using (owner_user_id = auth.uid());

create policy "members read appearances" on public.task_day_appearances
for select to authenticated
using (exists (select 1 from public.tasks t where t.id = task_id and public.is_workspace_member(t.workspace_id)));

create policy "members read messages" on public.task_messages
for select to authenticated
using (exists (select 1 from public.tasks t where t.id = task_id and public.is_workspace_member(t.workspace_id)));
create policy "members create messages" on public.task_messages
for insert to authenticated
with check (
  author_id = auth.uid()
  and exists (select 1 from public.tasks t where t.id = task_id and public.is_workspace_member(t.workspace_id))
);
create policy "authors update messages" on public.task_messages
for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());

create policy "members read activity" on public.activity_log
for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members create own activity" on public.activity_log
for insert to authenticated with check (public.is_workspace_member(workspace_id) and actor_id = auth.uid());

create policy "users read notifications" on public.notifications
for select to authenticated using (user_id = auth.uid());
create policy "users update notifications" on public.notifications
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Enable Postgres Changes for the collaborative tables.
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.task_messages;
alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.project_nodes;
alter publication supabase_realtime add table public.activity_log;
