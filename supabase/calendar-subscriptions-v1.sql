create table if not exists public.calendar_feed_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  token_value text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null
);

create unique index if not exists calendar_feed_tokens_active_user_idx
  on public.calendar_feed_tokens(workspace_id, user_id)
  where revoked_at is null;

create unique index if not exists calendar_feed_tokens_value_idx
  on public.calendar_feed_tokens(token_value)
  where token_value is not null;

alter table public.calendar_feed_tokens enable row level security;
revoke all on table public.calendar_feed_tokens from anon, authenticated;
