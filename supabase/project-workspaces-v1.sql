-- TBFT 2.0 — automated project/task document workspaces
-- Run once in Supabase SQL Editor after the existing TBFT schema.
-- Files are private in Supabase Storage. Logical folders exist even while empty.

create table if not exists public.project_file_spaces (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  kind text not null check (kind in ('project', 'task')),
  label text not null,
  provider text not null default 'supabase' check (provider in ('supabase', 'google_drive', 'onedrive', 'local')),
  external_folder_id text,
  external_folder_url text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'project' and task_id is null) or (kind = 'task' and task_id is not null))
);

create unique index if not exists project_file_spaces_one_project_root
  on public.project_file_spaces(project_id)
  where task_id is null;
create unique index if not exists project_file_spaces_one_task_space
  on public.project_file_spaces(task_id)
  where task_id is not null;
create index if not exists project_file_spaces_workspace_idx
  on public.project_file_spaces(workspace_id, project_id);

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  file_space_id uuid references public.project_file_spaces(id) on delete set null,
  provider text not null default 'supabase' check (provider in ('supabase', 'google_drive', 'onedrive', 'local')),
  storage_path text,
  external_file_id text,
  external_file_url text,
  original_name text not null check (char_length(original_name) between 1 and 500),
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists project_files_project_idx
  on public.project_files(project_id, created_at desc)
  where deleted_at is null;
create index if not exists project_files_task_idx
  on public.project_files(task_id, created_at desc)
  where deleted_at is null;

drop trigger if exists project_file_spaces_set_updated_at on public.project_file_spaces;
create trigger project_file_spaces_set_updated_at
before update on public.project_file_spaces
for each row execute function public.set_updated_at();

create or replace function public.sync_project_file_space()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.project_file_spaces (
    workspace_id, project_id, task_id, kind, label, created_by
  ) values (
    new.workspace_id, new.id, null, 'project', new.name, new.created_by
  )
  on conflict (project_id) where task_id is null
  do update set
    workspace_id = excluded.workspace_id,
    label = excluded.label,
    updated_at = now();
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
security definer set search_path = public
as $$
declare
  project_workspace uuid;
begin
  if new.project_id is null then
    delete from public.project_file_spaces where task_id = new.id;
    return new;
  end if;

  select p.workspace_id into project_workspace
  from public.projects p
  where p.id = new.project_id;

  if project_workspace is null or project_workspace <> new.workspace_id then
    return new;
  end if;

  insert into public.project_file_spaces (
    workspace_id, project_id, task_id, kind, label, created_by
  ) values (
    new.workspace_id, new.project_id, new.id, 'task', new.title, new.created_by
  )
  on conflict (task_id) where task_id is not null
  do update set
    workspace_id = excluded.workspace_id,
    project_id = excluded.project_id,
    label = excluded.label,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists tasks_create_file_space on public.tasks;
drop trigger if exists tasks_sync_file_space on public.tasks;
create trigger tasks_sync_file_space
after insert or update of project_id, title on public.tasks
for each row execute function public.sync_task_file_space();

-- Backfill logical folders for projects and project-linked tasks that already exist.
insert into public.project_file_spaces (workspace_id, project_id, task_id, kind, label, created_by)
select p.workspace_id, p.id, null, 'project', p.name, p.created_by
from public.projects p
on conflict (project_id) where task_id is null
  do update set label = excluded.label, updated_at = now();

insert into public.project_file_spaces (workspace_id, project_id, task_id, kind, label, created_by)
select t.workspace_id, t.project_id, t.id, 'task', t.title, t.created_by
from public.tasks t
where t.project_id is not null
on conflict (task_id) where task_id is not null
  do update set project_id = excluded.project_id, label = excluded.label, updated_at = now();

alter table public.project_file_spaces enable row level security;
alter table public.project_files enable row level security;

drop policy if exists "members read project file spaces" on public.project_file_spaces;
create policy "members read project file spaces"
on public.project_file_spaces for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "members create project file spaces" on public.project_file_spaces;
create policy "members create project file spaces"
on public.project_file_spaces for insert
to authenticated
with check (public.is_workspace_member(workspace_id));

drop policy if exists "members update project file spaces" on public.project_file_spaces;
create policy "members update project file spaces"
on public.project_file_spaces for update
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "members delete project file spaces" on public.project_file_spaces;
create policy "members delete project file spaces"
on public.project_file_spaces for delete
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "members read project files" on public.project_files;
create policy "members read project files"
on public.project_files for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "members create project files" on public.project_files;
create policy "members create project files"
on public.project_files for insert
to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and uploaded_by = auth.uid()
);

drop policy if exists "members update project files" on public.project_files;
create policy "members update project files"
on public.project_files for update
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

insert into storage.buckets (id, name, public)
values ('tbft-files', 'tbft-files', false)
on conflict (id) do update set public = false;

-- Object paths are: <workspace-id>/projects/<project-id>/project/... or
-- <workspace-id>/projects/<project-id>/tasks/<task-id>/...
drop policy if exists "workspace members read tbft files" on storage.objects;
create policy "workspace members read tbft files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'tbft-files'
  and exists (
    select 1 from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.workspace_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists "workspace members upload tbft files" on storage.objects;
create policy "workspace members upload tbft files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'tbft-files'
  and exists (
    select 1 from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.workspace_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists "workspace members update tbft files" on storage.objects;
create policy "workspace members update tbft files"
on storage.objects for update
to authenticated
using (
  bucket_id = 'tbft-files'
  and exists (
    select 1 from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.workspace_id::text = (storage.foldername(name))[1]
  )
)
with check (
  bucket_id = 'tbft-files'
  and exists (
    select 1 from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.workspace_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists "workspace members delete tbft files" on storage.objects;
create policy "workspace members delete tbft files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'tbft-files'
  and exists (
    select 1 from public.workspace_members wm
    where wm.user_id = auth.uid()
      and wm.workspace_id::text = (storage.foldername(name))[1]
  )
);

grant select, insert, update, delete on public.project_file_spaces to authenticated;
grant select, insert, update on public.project_files to authenticated;
