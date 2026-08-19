-- TBFT 2.0 — recurring tasks never get document folders
-- Run AFTER file-space-hierarchy-v2.sql and recurring-tasks-v1.sql.
--
-- Rules:
--   * Project roots still exist.
--   * Normal project tasks get task subfolders.
--   * Normal standalone tasks live under Fucking Lonely Tasks.
--   * Recurring-series roots get NO task folder.
--   * Generated recurring occurrences get NO task folder.

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

  -- Recurrence is scheduling, not a document workspace. Remove any task-space row
  -- that may have been created before recurrence was attached to the task.
  if task_row.recurrence_source_id is not null
     or task_row.recurrence_type <> 'none' then
    delete from public.project_file_spaces
    where task_id = task_row.id;
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

  update public.project_files
  set project_id = task_row.project_id,
      file_space_id = space_id
  where task_id = task_row.id;

  return space_id;
end;
$$;

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
after insert or update of project_id, title, recurrence_type, recurrence_source_id on public.tasks
for each row execute function public.sync_task_file_space();

-- Clean up task-space rows already created for recurring tasks by earlier migrations.
-- Any historical file metadata is preserved; only the folder relationship is removed.
delete from public.project_file_spaces space
using public.tasks task
where space.task_id = task.id
  and space.kind = 'task'
  and (task.recurrence_source_id is not null or task.recurrence_type <> 'none');

analyze public.project_file_spaces;
