# Phase 2 — Real Couple Accounts

The next development milestone converts the validated local prototype into a synchronized private application.

## Authentication flow

- Register using email and password
- Confirm email
- Create a solo workspace automatically
- Choose Solo or Invite Partner
- Send a single-use invitation
- Partner registers or signs in
- Invitation converts the workspace from Solo to Couple
- Existing solo tasks remain under their original owner

## Data synchronization

Replace localStorage mutations with a typed repository layer:

- `createTask`
- `updateTask`
- `completeTask`
- `softDeleteTask`
- `createMessage`
- `createProject`
- `createProjectNode`
- `listDailyBoard`
- `listCalendarIndicators`

The UI should not call Supabase directly from every component. A repository keeps business rules testable and makes offline/PWA support easier later.

## Realtime subscriptions

Subscribe by workspace to:

- tasks
- task_messages
- projects
- project_nodes
- activity_log

When a task changes, update only the affected record in local React state rather than reloading the full workspace.

## Rollover strategy

Use both layers:

1. The interface derives red/yellow/green state from the workspace timezone and task history.
2. A scheduled server process calls `rollover_workspace_tasks` for an idempotent appearance record.

The app can safely repair a missed rollover because `(task_id, board_date)` is unique.

## First production acceptance tests

- A partner cannot complete the other owner’s task through the UI.
- A manually crafted database request is also rejected.
- A partner cannot delete the other owner’s task.
- Either partner can edit task text, date, project, and deadline.
- Either partner can add a thread message.
- A future task cannot be completed early.
- An unfinished task is red after midnight and before rollover.
- The same task is yellow after rollover without losing its original date.
- Completing a carried task stores the real completion timestamp.
- Both browsers receive updates without refreshing.
