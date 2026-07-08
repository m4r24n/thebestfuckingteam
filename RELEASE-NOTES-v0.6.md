# TBFT v0.6 — Project editing and recoverable Archive

## Added

- Edit a project after creation, including its name, description, and target date.
- A compact project action menu with **Edit project** and **Move to archive**.
- A new **Archive** navigation section.
- Archived projects retain their phases and task relationships.
- Archived tasks retain their notes, completion state, project relationship, and daily history.
- Restore actions for projects and tasks.
- Task restoration remains owner-only.
- Project archive/restore actions are recorded in Activity.
- Target dates are now visible in the project header.

## Changed

- The former task Delete action is now explicitly labeled **Archive**.
- Confirmation dialogs explain that archived items remain recoverable.
- Active project lists and task project selectors exclude archived projects.
- Cloud loading now includes archived rows so the Archive works across devices.

## Database

No new Supabase SQL is required when upgrading from v0.5 or v0.5.2. The existing `projects.deleted_at` and `tasks.deleted_at` columns, RLS policies, and task-protection trigger already support these operations.

## Safety

Permanent deletion is intentionally not included in this release. Archived items can only be restored, preventing accidental irreversible data loss.

## Validation

- ESLint passed
- TypeScript validation passed as part of the Next.js build
- Next.js production build passed
- Local HTTP smoke test returned 200
- npm audit reported 0 known vulnerabilities
