-- TBFT 2.0 — permanent deletion from Archive
-- Run once in Supabase SQL Editor after the base schema.
-- Destructive actions are intentionally limited to already-archived entities.

create or replace function public.permanently_delete_archived_task(target_task uuid)
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  root_task public.tasks%rowtype;
  delete_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select * into root_task
  from public.tasks
  where id = target_task;

  if root_task.id is null then
    raise exception 'Task not found';
  end if;

  if root_task.deleted_at is null then
    raise exception 'Only archived tasks can be permanently deleted';
  end if;

  if root_task.owner_user_id <> auth.uid() then
    raise exception 'Only the task owner can permanently delete it';
  end if;

  if not public.is_workspace_member(root_task.workspace_id) then
    raise exception 'You are not a member of this workspace';
  end if;

  -- If this is a recurring-series root, delete the generated occurrences with it.
  -- If it is one generated occurrence, only that occurrence is removed.
  if root_task.recurrence_source_id is null and root_task.recurrence_type <> 'none' then
    select array_agg(id) into delete_ids
    from public.tasks
    where id = root_task.id or recurrence_source_id = root_task.id;
  else
    delete_ids := array[root_task.id];
  end if;

  -- Remove stored file objects first when the optional project-file layer exists.
  if to_regclass('public.project_files') is not null then
    execute $sql$
      delete from storage.objects object
      using public.project_files file
      where object.bucket_id = 'tbft-files'
        and object.name = file.storage_path
        and file.storage_path is not null
        and file.task_id = any($1)
    $sql$ using delete_ids;

    execute $sql$
      delete from public.project_files
      where task_id = any($1)
    $sql$ using delete_ids;
  end if;

  delete from public.activity_log
  where entity_type = 'task'
    and entity_id = any(delete_ids);

  -- Generated rows first avoids recurrence_source_id becoming orphaned via ON DELETE SET NULL.
  delete from public.tasks
  where recurrence_source_id = root_task.id
    and id = any(delete_ids);

  delete from public.tasks
  where id = root_task.id;
end;
$$;

create or replace function public.permanently_delete_archived_project(target_project uuid)
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  project_row public.projects%rowtype;
  node_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select * into project_row
  from public.projects
  where id = target_project;

  if project_row.id is null then
    raise exception 'Project not found';
  end if;

  if project_row.deleted_at is null then
    raise exception 'Only archived projects can be permanently deleted';
  end if;

  if not public.is_workspace_member(project_row.workspace_id) then
    raise exception 'You are not a member of this workspace';
  end if;

  if project_row.created_by <> auth.uid()
     and not public.is_workspace_owner(project_row.workspace_id) then
    raise exception 'Only the project creator or workspace owner can permanently delete it';
  end if;

  select array_agg(id) into node_ids
  from public.project_nodes
  where project_id = project_row.id;

  -- Files belonging to the project are part of the permanent deletion. Connected tasks
  -- themselves survive; their project references become NULL through existing FKs.
  if to_regclass('public.project_files') is not null then
    execute $sql$
      delete from storage.objects object
      using public.project_files file
      where object.bucket_id = 'tbft-files'
        and object.name = file.storage_path
        and file.storage_path is not null
        and file.project_id = $1
    $sql$ using project_row.id;

    execute $sql$
      delete from public.project_files
      where project_id = $1
    $sql$ using project_row.id;
  end if;

  delete from public.activity_log
  where (entity_type = 'project' and entity_id = project_row.id)
     or (entity_type = 'project_node' and node_ids is not null and entity_id = any(node_ids));

  delete from public.projects
  where id = project_row.id;
end;
$$;

grant execute on function public.permanently_delete_archived_task(uuid) to authenticated;
grant execute on function public.permanently_delete_archived_project(uuid) to authenticated;
