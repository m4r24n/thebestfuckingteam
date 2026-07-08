# The Best Fucking Team — v0.5

A private shared daily planner and project workspace for solo users and couples.

## What v0.5 adds

- Supabase email/password registration and sign-in
- Email confirmation and password-reset flows
- First-time onboarding for solo or couple workspaces
- Private partner invitation codes
- PostgreSQL persistence for tasks, projects, phases, messages, settings, and activity
- Supabase Realtime synchronization between both partners
- Row Level Security and database triggers for task ownership rules
- Owner-only completion, un-completion, and deletion
- Missed 6:00 AM rollover repair when the app opens
- Cloud sync status in the sidebar
- Downloadable JSON backup
- Read-only last-synced browser cache for temporary offline access
- A Current Day countdown timer and operational-day progress bar

The countdown is 0% at the workspace rollover time, normally 6:00 AM. It fills toward 100% at midnight. Between midnight and rollover it remains at 100%, switches to the grace-period countdown, and glows red.

## Before uploading this version

### 1. Install the database in Supabase

Open **Supabase → SQL Editor → New query**.

Copy the complete contents of:

```text
supabase/setup-v0.5.sql
```

Paste it into the SQL Editor and select **Run**. The file is designed to work on a new project or over the earlier TBFT schema.

Do not run individual fragments. Run the complete file so the tables, functions, triggers, RLS policies, grants, and Realtime publication are installed together.

### 2. Keep the Netlify environment variables

The app accepts the variables already configured in Netlify:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

It also supports the newer variable name:

```text
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Use a Supabase publishable or legacy anon key. Never use a `service_role` or secret key in a `NEXT_PUBLIC_` variable.

### 3. Configure Supabase authentication URLs

In **Supabase → Authentication → URL Configuration**:

- Set **Site URL** to the deployed Netlify URL, for example `https://your-site.netlify.app`.
- Add the same production address under **Redirect URLs**.
- Add a future custom domain there too before switching domains.

This is required for email confirmation and password-reset links to return to the deployed app.

### 4. Upload to GitHub

Upload everything inside the root-ready package to the repository root, replacing matching files. Confirm that GitHub still shows:

```text
src/
public/
supabase/
package.json
package-lock.json
netlify.toml
```

Netlify should deploy the new commit automatically. If necessary, use **Clear cache and deploy site**.

## First use

1. Open the deployed app.
2. Create your own account.
3. Confirm your email if confirmation is enabled in Supabase.
4. Create a Couple workspace.
5. Open **Settings → Partner Access** and create an invitation code.
6. Your partner creates a separate account on their own browser or device.
7. During onboarding, they choose **Join your partner** and enter the code.

After joining, both accounts load the same tasks, projects, notes, activity, and appearance settings.

## Data and reliability

Supabase is now the source of truth. The browser no longer stores tasks as the primary database.

- Successful cloud loads are cached locally so the most recently synced dashboard can still be viewed during a temporary outage.
- Offline changes are not queued in v0.5. Editing while offline will show a save error rather than pretending the change was stored.
- Settings includes **Download backup**, which exports the current workspace as JSON.
- Existing v0.4 browser-only demo data is not automatically uploaded because its demo user IDs cannot safely be matched to real authenticated accounts.

## Permission model

Both partners may:

- View the shared workspace
- Create tasks for either partner
- Edit titles, notes, dates, deadlines, priorities, and project links
- Add task-thread notes
- Create projects and phases

Only the assigned task owner may:

- Mark the task complete
- Mark it incomplete again
- Delete it
- Transfer ownership

These restrictions are enforced in PostgreSQL as well as in the interface.

## Development checks

The release has been validated with:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Project structure

```text
src/app/                       Next.js shell and visual system
src/components/TBFTApp.tsx     Authentication, onboarding, app UI, and mutations
src/lib/database.ts            Supabase loading, workspace, invite, and rollover helpers
src/lib/date.ts                Timezone and operational-day calculations
src/lib/supabase.ts            Browser Supabase client
src/lib/types.ts               Application types
supabase/setup-v0.5.sql        Upgrade/new-project database installer
supabase/schema.sql            Current complete schema
```

## Current limitations

- No queued offline editing yet
- No automatic restore from the downloaded JSON backup yet
- No attachment upload yet
- No recurring tasks or notifications yet
- Each user can belong to one TBFT workspace in this release
