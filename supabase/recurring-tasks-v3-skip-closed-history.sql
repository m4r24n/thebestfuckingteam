-- TBFT recurring tasks v3
-- Prevent recurrence repair from attempting to insert occurrences into closed historical boards.
-- Existing historical occurrences are preserved; only current/future missing occurrences are generated.

create or replace function public.ensure_recurring_task_horizon(source_task_id uuid, horizon date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  source_task public.tasks%rowtype;
  occurrence_date date;
  step_no integer := 1;
  inserted_count integer := 0;
  affected integer := 0;
  workspace_tz text;
  workspace_rollover smallint;
  current_board_date date;
begin
  select * into source_task
  from public.tasks
  where id = source_task_id;

  if source_task.id is null
     or source_task.deleted_at is not null
     or source_task.recurrence_source_id is not null
     or source_task.recurrence_type = 'none' then
    return 0;
  end if;

  select timezone, rollover_hour into workspace_tz, workspace_rollover
  from public.workspaces
  where id = source_task.workspace_id;

  current_board_date := ((now() at time zone workspace_tz) - make_interval(hours => workspace_rollover))::date;

  loop
    occurrence_date := case source_task.recurrence_type
      when 'daily' then source_task.original_date + step_no
      when 'weekly' then source_task.original_date + (step_no * 7)
      when 'interval' then source_task.original_date + (step_no * coalesce(source_task.recurrence_interval_days, 1))
      when 'monthly' then public.tbft_add_months_clamped(source_task.original_date, step_no)
      when 'yearly' then public.tbft_add_months_clamped(source_task.original_date, step_no * 12)
      else null
    end;

    exit when occurrence_date is null or occurrence_date > horizon or step_no > 5000;

    if occurrence_date < current_board_date then
      step_no := step_no + 1;
      continue;
    end if;

    insert into public.tasks (
      workspace_id,
      title,
      description,
      owner_user_id,
      created_by,
      original_date,
      deadline,
      priority,
      project_id,
      project_node_id,
      recurrence_type,
      recurrence_interval_days,
      recurrence_source_id
    ) values (
      source_task.workspace_id,
      source_task.title,
      source_task.description,
      source_task.owner_user_id,
      source_task.created_by,
      occurrence_date,
      source_task.deadline,
      source_task.priority,
      source_task.project_id,
      source_task.project_node_id,
      'none',
      null,
      source_task.id
    )
    on conflict do nothing;

    get diagnostics affected = row_count;
    inserted_count := inserted_count + affected;
    step_no := step_no + 1;
  end loop;

  return inserted_count;
end;
$$;
