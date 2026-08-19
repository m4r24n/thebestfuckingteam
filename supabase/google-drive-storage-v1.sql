-- TBFT 2.0 — Google Drive storage connection
-- Run once after the base schema and file-space hierarchy migrations.
-- Actual file bytes live in Google Drive. Supabase stores only connection metadata,
-- folder/file IDs, and TBFT activity/index data.

create table if not exists public.storage_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('google_drive')),
  connected_by uuid not null references public.profiles(id),
  account_email text,
  refresh_token_ciphertext text not null,
  root_folder_id text not null,
  root_folder_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (workspace_id, provider)
);

create index if not exists storage_connections_workspace_idx
  on public.storage_connections(workspace_id, provider)
  where revoked_at is null;

drop trigger if exists storage_connections_set_updated_at on public.storage_connections;
create trigger storage_connections_set_updated_at
before update on public.storage_connections
for each row execute function public.set_updated_at();

alter table public.storage_connections enable row level security;

-- Tokens are server-only. Authenticated clients intentionally receive no direct table grants.
revoke all on public.storage_connections from anon;
revoke all on public.storage_connections from authenticated;

create or replace function public.storage_connection_status(target_workspace uuid)
returns table (
  provider text,
  account_email text,
  root_folder_url text,
  connected_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.provider,
    c.account_email,
    c.root_folder_url,
    c.updated_at
  from public.storage_connections c
  where c.workspace_id = target_workspace
    and c.revoked_at is null
    and public.is_workspace_member(target_workspace)
  order by c.updated_at desc;
$$;

grant execute on function public.storage_connection_status(uuid) to authenticated;

-- Keep the physical Google Drive hierarchy close to the logical TBFT file-space tree.
-- The client subscribes to these changes and asks the authenticated server route to sync.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'project_file_spaces'
     ) then
    alter publication supabase_realtime add table public.project_file_spaces;
  end if;
end $$;
