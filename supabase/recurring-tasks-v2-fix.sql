-- TBFT recurring tasks v2 fix
-- Run once after recurring-tasks-v1.sql.
-- Fixes performance, cadence edits, and series management without deleting history.

-- Smaller rolling windows keep the dashboard light while still showing useful future dates.
create or replace function public.tbft_recurrence_horizon(
  anchor_date date,
  recurrence_kind text,
  interval_days integer default null
)
returns date
language sql
immutable
set search_path = public
as $$
  select anchor_date + case recurrence_kind
    when 'daily' then 21
    when 'weekly' then 126
    when 'monthly' then 365
    when 'yearly' then 1460
    when 'interval' then greatest(30, least(240, coalesce(interval_days, 1) * 10))
    else 0
  end;
$$;

-- Rebuild untouched future generated occurrences when cadence changes.
create or replace function public.rebuild_recurring_task_series()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace_tz text;
  workspace_rollover smallint;
  current_board_date date;
begin
  if new.recurrence_source_id is not null then
    return new;
  end if;

  if new.recurrence_type is not distinct from old.recurrence_type
     and new.recurrence_interval_days is not distinct from old.recurrence_interval_days
     and new.original_date is not distinct from old.original_date then
    return new;
  end if;

  select timezone, rollover_hour into workspace_tz, workspace_rollover
  from public.workspaces where id = new.workspace_id;
  current_board_date := ((now() at time zone workspace_tz) - make_interval(hours => workspace_rollover))::date;

  delete from public.tasks generated
  where generated.recurrence_source_id = new.id
    and generated.original_date >= current_board_date
    and generated.completed_at is null
    and generated.deleted_at is null
    and not exists (
      select 1 from public.task_messages message
      where message.task_id = generated.id
        and message.deleted_at is null
    );

  if new.recurrence_type <> 'none' and new.deleted_at is null then
    perform public.ensure_recurring_task_horizon(
      new.id,
      public.tbft_recurrence_horizon(
        greatest(new.original_date, current_board_date),
        new.recurrence_type,
        new.recurrence_interval_days
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_rebuild_recurring_series on public.tasks;
create trigger tasks_rebuild_recurring_series
after update of recurrence_type, recurrence_interval_days, original_date on public.tasks
for each row execute function public.rebuild_recurring_task_series();

-- Stop a complete series with one owner-authorized action. The existing stop trigger
-- marks untouched future generated occurrences archived while preserving history.
create or replace function public.stop_recurring_series(source_task_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_task public.tasks%rowtype;
begin
  select * into source_task from public.tasks where id = source_task_id;
  if source_task.id is null then raise exception 'Recurring task not found'; end if;
  if source_task.recurrence_source_id is not null or source_task.recurrence_type = 'none' then
    raise exception 'This task is not a recurring series root';
  end if;
  if source_task.owner_user_id <> auth.uid() then
    raise exception 'Only the task owner can stop this recurring series';
  end if;

  update public.tasks
  set deleted_at = now()
  where id = source_task_id;
end;
$$;

grant execute on function public.stop_recurring_series(uuid) to authenticated;

-- Clean up only untouched generated future rows beyond the new smaller window.
do $$
declare
  row_item record;
  workspace_tz text;
  workspace_rollover smallint;
  current_board_date date;
  cutoff date;
begin
  for row_item in
    select source.id, source.workspace_id, source.recurrence_type, source.recurrence_interval_days
    from public.tasks source
    where source.recurrence_source_id is null
      and source.recurrence_type <> 'none'
      and source.deleted_at is null
  loop
    select timezone, rollover_hour into workspace_tz, workspace_rollover
    from public.workspaces where id = row_item.workspace_id;
    current_board_date := ((now() at time zone workspace_tz) - make_interval(hours => workspace_rollover))::date;
    cutoff := public.tbft_recurrence_horizon(current_board_date, row_item.recurrence_type, row_item.recurrence_interval_days);

    delete from public.tasks generated
    where generated.recurrence_source_id = row_item.id
      and generated.original_date > cutoff
      and generated.completed_at is null
      and generated.deleted_at is null
      and not exists (
        select 1 from public.task_messages message
        where message.task_id = generated.id
          and message.deleted_at is null
      );
  end loop;
end;
$$;

create index if not exists tasks_workspace_original_date_all_idx
  on public.tasks(workspace_id, original_date);
create index if not exists tasks_workspace_recurrence_roots_idx
  on public.tasks(workspace_id, recurrence_type)
  where recurrence_source_id is null and deleted_at is null;

analyze public.tasks;
analyze public.task_day_appearances;
analyze public.task_messages;
