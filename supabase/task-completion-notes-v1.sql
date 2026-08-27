alter table public.tasks
  add column if not exists completion_note text not null default '';

comment on column public.tasks.completion_note is
  'Draft notes written in the task file panel and exported to PDF when the task is completed.';
