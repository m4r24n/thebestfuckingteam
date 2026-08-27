create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  reminder_date date not null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reminders_workspace_date_idx on public.reminders(workspace_id, reminder_date);
create index if not exists reminders_owner_date_idx on public.reminders(owner_user_id, reminder_date);

alter table public.reminders enable row level security;

drop policy if exists "members read reminders" on public.reminders;
create policy "members read reminders"
on public.reminders for select
using (public.is_workspace_member(workspace_id));

drop policy if exists "members create reminders" on public.reminders;
create policy "members create reminders"
on public.reminders for insert
with check (
  public.is_workspace_member(workspace_id)
  and created_by = auth.uid()
  and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = reminders.workspace_id
      and wm.user_id = reminders.owner_user_id
  )
);

drop policy if exists "members update reminders" on public.reminders;
create policy "members update reminders"
on public.reminders for update
using (public.is_workspace_member(workspace_id))
with check (
  public.is_workspace_member(workspace_id)
  and exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = reminders.workspace_id
      and wm.user_id = reminders.owner_user_id
  )
);

drop policy if exists "members delete reminders" on public.reminders;
create policy "members delete reminders"
on public.reminders for delete
using (public.is_workspace_member(workspace_id));

do $$
begin
  alter publication supabase_realtime add table public.reminders;
exception
  when duplicate_object then null;
end $$;
