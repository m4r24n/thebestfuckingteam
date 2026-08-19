-- TBFT 2.0 — recurring task series
-- Run once in Supabase SQL Editor after the existing TBFT schema.
-- A recurring root task represents the first occurrence. Future occurrences are real tasks
-- linked through recurrence_source_id so each day keeps independent completion/history.

alter table public.tasks add column if not exists recurrence_type text not null default 'none';
alter table public.tasks add column if not exists recurrence_interval_days integer;
alter table public.tasks add column if not exists recurrence_source_id uuid references public.tasks(id) on delete set null;

alter table public.tasks drop constraint if exists tasks_recurrence_type_check;
alter table public.tasks add constraint tasks_recurrence_type_check
  check (recurrence_type in ('none', 'daily', 'weekly', 'monthly', 'yearly', 'interval'));

alter table public.tasks drop constraint if exists tasks_recurrence_interval_check;
alter table public.tasks add constraint tasks_recurrence_interval_check
  check (
    (recurrence_type = 'interval' and recurrence_interval_days is not null and recurrence_interval_days >= 1 and recurrence_interval_days <= 3650)
    or (recurrence_type <> 'interval' and recurrence_interval_days is null)
  );

create index if not exists tasks_recurrence_source_idx
  on public.tasks(recurrence_source_id, original_date)
  where recurrence_source_id is not null;

create unique index if not exists tasks_recurrence_occurrence_unique
  on public.tasks(recurrence_source_id, original_date)
  where recurrence_source_id is not null;

create or replace function public.tbft_add_months_clamped(source_date date, month_count integer)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  target_month date;
  last_day integer;
  wanted_day integer;
begin
  target_month := (date_trunc('month', source_date)::date + make_interval(months => month_count))::date;
  last_day := extract(day from (target_month + interval '1 month - 1 day'))::integer;
  wanted_day := least(extract(day from source_date)::integer, last_day);
  return target_month + (wanted_day - 1);
end;
$$;

create or replace function public.expand_recurring_task_series()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  occurrence_date date;
  horizon date;
  step_no integer := 1;
  interval_days integer;
begin
  -- Generated occurrences never generate another series.
  if new.recurrence_source_id is not null or new.recurrence_type = 'none' then
    return new;
  end if;

  interval_days := coalesce(new.recurrence_interval_days, 1);
  horizon := new.original_date + 730;

  loop
    occurrence_date := case new.recurrence_type
      when 'daily' then new.original_date + step_no
      when 'weekly' then new.original_date + (step_no * 7)
      when 'interval' then new.original_date + (step_no * interval_days)
      when 'monthly' then public.tbft_add_months_clamped(new.original_date, step_no)
      when 'yearly' then public.tbft_add_months_clamped(new.original_date, step_no * 12)
      else null
    end;

    exit when occurrence_date is null or occurrence_date > horizon;

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
      new.workspace_id,
      new.title,
      new.description,
      new.owner_user_id,
      new.created_by,
      occurrence_date,
      new.deadline,
      new.priority,
      new.project_id,
      new.project_node_id,
      'none',
      null,
      new.id
    )
    on conflict do nothing;

    step_no := step_no + 1;
  end loop;

  return new;
end;
$$;

drop trigger if exists tasks_expand_recurring_series on public.tasks;
create trigger tasks_expand_recurring_series
after insert on public.tasks
for each row execute function public.expand_recurring_task_series();

-- Keep future generated occurrences aligned when the recurring root is edited.
create or replace function public.sync_recurring_task_series()
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
  if new.recurrence_source_id is not null or new.recurrence_type = 'none' then
    return new;
  end if;

  select timezone, rollover_hour into workspace_tz, workspace_rollover
  from public.workspaces where id = new.workspace_id;
  current_board_date := ((now() at time zone workspace_tz) - make_interval(hours => workspace_rollover))::date;

  update public.tasks
  set
    title = new.title,
    description = new.description,
    owner_user_id = new.owner_user_id,
    deadline = new.deadline,
    priority = new.priority,
    project_id = new.project_id,
    project_node_id = new.project_node_id
  where recurrence_source_id = new.id
    and original_date >= current_board_date
    and completed_at is null
    and deleted_at is null;

  return new;
end;
$$;

drop trigger if exists tasks_sync_recurring_series on public.tasks;
create trigger tasks_sync_recurring_series
after update of title, description, owner_user_id, deadline, priority, project_id, project_node_id on public.tasks
for each row execute function public.sync_recurring_task_series();

-- Archiving a recurring root stops future occurrences without deleting its history.
create or replace function public.stop_recurring_task_series()
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
  if new.recurrence_source_id is not null
     or new.recurrence_type = 'none'
     or old.deleted_at is not null
     or new.deleted_at is null then
    return new;
  end if;

  select timezone, rollover_hour into workspace_tz, workspace_rollover
  from public.workspaces where id = new.workspace_id;
  current_board_date := ((now() at time zone workspace_tz) - make_interval(hours => workspace_rollover))::date;

  update public.tasks
  set deleted_at = new.deleted_at
  where recurrence_source_id = new.id
    and original_date > current_board_date
    and completed_at is null
    and deleted_at is null;

  return new;
end;
$$;

drop trigger if exists tasks_stop_recurring_series on public.tasks;
create trigger tasks_stop_recurring_series
after update of deleted_at on public.tasks
for each row execute function public.stop_recurring_task_series();

-- Recurring occurrences are date-specific habits/rituals. They keep historical records,
-- but missed occurrences do not carry forward and stack beside the next occurrence.
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
    and t.recurrence_type = 'none'
    and t.recurrence_source_id is null
  on conflict (task_id, board_date) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

grant execute on function public.tbft_add_months_clamped(date, integer) to authenticated;
