-- TBFT 2.0 — canonical document folder hierarchy
-- Run once AFTER project-workspaces-v1.sql.
--
-- Hierarchy:
--   Workspace
--   ├─ <Project name>/
--   │  └─ <Task name>/
--   └─ Fucking Lonely Tasks/
--      └─ <Standalone task name>/
--
-- Duplicate standalone task names (and, for consistency, duplicate sibling task names
-- inside a project) are assigned stable labels: Name, Name (1), Name (2), ...

-- The original v1 schema required every file space/file to belong to a project.
-- v2 allows the fixed lonely-task root and standalone task folders.
alter table public.project_file_spaces alter column project_id drop not null;
alter table public.project_files alter column project_id drop not null;

alter table public.project_file_spaces
  add column if not exists parent_space_id uuid;

do $$
begin
  alter table public.project_file_spaces
    add constraint project_file_spaces_parent_fk
    foreign key (parent_space_id)
    references public.project_file_spaces(id)
    on delete cascade;
exception when duplicate_object then null;
end $$;

-- Drop v1 hierarchy checks while existing rows are being reshaped.
alter table public.project_file_spaces
  drop constraint if exists project_file_spaces_kind_check;
alter table public.project_file_spaces
  drop constraint if exists project_file_spaces_check;
alter table public.project_file_spaces
  drop constraint if exists project_file_spaces_hierarchy_check;

-- Rebuild root indexes around explicit kinds.
drop index if exists public.project_file_spaces_one_project_root;
create unique index if not exists project_file_spaces_one_project_root
  on public.project_file_spaces(project_id)
  where kind = 'project';

create unique index if not exists project_file_spaces_one_lonely_root
  on public.project_file_spaces(workspace_id)
  where kind = 'lonely_root';

create unique index if not exists project_file_spaces_one_task_space
  on public.project_file_spaces(task_id)
  where task_id is not null;

create index if not exists project_file_spaces_parent_idx
  on public.project_file_spaces(parent_space_id, created_at)
  where parent_space_id is not null;

-- One fixed parent folder per workspace for every task that has no project.
create or replace function public.ensure_lonely_task_root(
  target_workspace uuid,
  creator_hint uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  root_id uuid;
  creator_id uuid;
begin
  select id into root_id
  from public.project_file_spaces
  where workspace_id = target_workspace
    and kind = 'lonely_root'
  limit 1;

  if root_id is not null then
    update public.project_file_spaces
    set label = 'Fucking Lonely Tasks',
        project_id = null,
        task_id = null,
        parent_space_id = null,
        updated_at = now()
    where id = root_id;
    return root_id;
  end if;

  select coalesce(creator_hint, w.created_by)
  into creator_id
  from public.workspaces w
  where w.id = target_workspace;

  if creator_id is null then
    raise exception 'Workspace % was not found', target_workspace;
  end if;

  insert into public.project_file_spaces (
    workspace_id,
    project_id,
    task_id,
    parent_space_id,
    kind,
    label,
    provider,
    created_by
  ) values (
    target_workspace,
    null,
    null,
    null,
    'lonely_root',
    'Fucking Lonely Tasks',
    'supabase',
    creator_id
  )
  on conflict (workspace_id) where kind = 'lonely_root'
  do update set
    label = 'Fucking Lonely Tasks',
    updated_at = now()
  returning id into root_id;

  return root_id;
end;
$$;

create or replace function public.ensure_project_file_space(target_project uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  project_row public.projects%rowtype;
  root_id uuid;
begin
  select * into project_row
  from public.projects
  where id = target_project;

  if project_row.id is null then
    return null;
  end if;

  insert into public.project_file_spaces (
    workspace_id,
    project_id,
    task_id,
    parent_space_id,
    kind,
    label,
    provider,
    created_by
  ) values (
    project_row.workspace_id,
    project_row.id,
    null,
    null,
    'project',
    project_row.name,
    'supabase',
    project_row.created_by
  )
  on conflict (project_id) where kind = 'project'
  do update set
    workspace_id = excluded.workspace_id,
    task_id = null,
    parent_space_id = null,
    kind = 'project',
    label = excluded.label,
    updated_at = now()
  returning id into root_id;

  return root_id;
end;
$$;

create or replace function public.next_task_file_space_label(
  target_parent uuid,
  target_task uuid,
  base_title text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base_label text := coalesce(nullif(trim(base_title), ''), 'Untitled task');
  candidate text;
  suffix integer := 0;
begin
  candidate := base_label;

  loop
    exit when not exists (
      select 1
      from public.project_file_spaces s
      where s.parent_space_id = target_parent
        and s.kind = 'task'
        and s.task_id is distinct from target_task
        and lower(s.label) = lower(candidate)
    );

    suffix := suffix + 1;
    candidate := base_label || ' (' || suffix || ')';
  end loop;

  return candidate;
end;
$$;

-- Canonical task-space upsert. A task owns exactly one logical folder. Assigning or
-- unassigning a project moves that same folder beneath the correct parent instead of
-- creating a second task folder.
create or replace function public.ensure_task_file_space(target_task uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.tasks%rowtype;
  parent_id uuid;
  space_id uuid;
  folder_label text;
begin
  select * into task_row
  from public.tasks
  where id = target_task;

  if task_row.id is null then
    return null;
  end if;

  if task_row.project_id is null then
    parent_id := public.ensure_lonely_task_root(task_row.workspace_id, task_row.created_by);
  else
    parent_id := public.ensure_project_file_space(task_row.project_id);
  end if;

  if parent_id is null then
    raise exception 'Could not resolve a parent folder for task %', target_task;
  end if;

  -- Serialize sibling naming so two same-name tasks created together still receive
  -- deterministic Name / Name (1) labels.
  perform 1
  from public.project_file_spaces
  where id = parent_id
  for update;

  folder_label := public.next_task_file_space_label(parent_id, task_row.id, task_row.title);

  insert into public.project_file_spaces (
    workspace_id,
    project_id,
    task_id,
    parent_space_id,
    kind,
    label,
    provider,
    created_by
  ) values (
    task_row.workspace_id,
    task_row.project_id,
    task_row.id,
    parent_id,
    'task',
    folder_label,
    'supabase',
    task_row.created_by
  )
  on conflict (task_id) where task_id is not null
  do update set
    workspace_id = excluded.workspace_id,
    project_id = excluded.project_id,
    parent_space_id = excluded.parent_space_id,
    kind = 'task',
    label = excluded.label,
    updated_at = now()
  returning id into space_id;

  -- File metadata follows the task logically if the task moves into or out of a project.
  -- Existing object keys remain stable; provider adapters treat the file-space hierarchy
  -- as canonical rather than relying on object-key text as the folder model.
  update public.project_files
  set project_id = task_row.project_id,
      file_space_id = space_id
  where task_id = task_row.id;

  return space_id;
end;
$$;

create or replace function public.sync_workspace_lonely_task_root()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_lonely_task_root(new.id, new.created_by);
  return new;
end;
$$;

drop trigger if exists workspaces_create_lonely_task_root on public.workspaces;
create trigger workspaces_create_lonely_task_root
after insert on public.workspaces
for each row execute function public.sync_workspace_lonely_task_root();

create or replace function public.sync_project_file_space()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_project_file_space(new.id);
  return new;
end;
$$;

drop trigger if exists projects_create_file_space on public.projects;
drop trigger if exists projects_sync_file_space on public.projects;
create trigger projects_sync_file_space
after insert or update of name on public.projects
for each row execute function public.sync_project_file_space();

create or replace function public.sync_task_file_space()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_task_file_space(new.id);
  return new;
end;
$$;

drop trigger if exists tasks_create_file_space on public.tasks;
drop trigger if exists tasks_sync_file_space on public.tasks;
create trigger tasks_sync_file_space
after insert or update of project_id, title on public.tasks
for each row execute function public.sync_task_file_space();

-- Backfill one lonely root per existing workspace and rebuild every existing task's
-- canonical parent/label in creation order so duplicate suffixes are deterministic.
do $$
declare
  workspace_row record;
  project_row record;
  task_row record;
begin
  for workspace_row in
    select id, created_by from public.workspaces order by created_at, id
  loop
    perform public.ensure_lonely_task_root(workspace_row.id, workspace_row.created_by);
  end loop;

  for project_row in
    select id from public.projects order by created_at, id
  loop
    perform public.ensure_project_file_space(project_row.id);
  end loop;

  for task_row in
    select id from public.tasks order by created_at, id
  loop
    perform public.ensure_task_file_space(task_row.id);
  end loop;
end;
$$;

-- Now that all rows have been reshaped, enforce the canonical hierarchy.
alter table public.project_file_spaces
  add constraint project_file_spaces_kind_check
  check (kind in ('project', 'lonely_root', 'task'));

alter table public.project_file_spaces
  add constraint project_file_spaces_hierarchy_check
  check (
    (kind = 'project'
      and project_id is not null
      and task_id is null
      and parent_space_id is null)
    or
    (kind = 'lonely_root'
      and project_id is null
      and task_id is null
      and parent_space_id is null)
    or
    (kind = 'task'
      and task_id is not null
      and parent_space_id is not null)
  );

create unique index if not exists project_file_spaces_unique_sibling_task_label
  on public.project_file_spaces(parent_space_id, lower(label))
  where kind = 'task';

-- Standalone files are indexed by workspace/task; project files keep the existing
-- project index from v1.
create index if not exists project_files_workspace_task_idx
  on public.project_files(workspace_id, task_id, created_at desc)
  where deleted_at is null and task_id is not null;

grant execute on function public.ensure_lonely_task_root(uuid, uuid) to authenticated;
grant execute on function public.ensure_project_file_space(uuid) to authenticated;
grant execute on function public.ensure_task_file_space(uuid) to authenticated;

grant select, insert, update, delete on public.project_file_spaces to authenticated;
grant select, insert, update on public.project_files to authenticated;

analyze public.project_file_spaces;
analyze public.project_files;
