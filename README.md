# The Best Fucking Team — MVP 0.1

A private notepad-style shared planner for couples and solo users.

## What works in this build

- Split daily dashboard for Marzan and Shamina
- Switch the active demo user to test both partners
- Create tasks for yourself or your partner
- Edit either partner’s task
- Only the task owner can complete or delete it
- Task notes and message threads
- Midnight grace-period and 6:00 AM operational-day logic
- Red overdue, yellow carried, green completed, and neutral future states
- Original task date preserved after late completion
- Calendar with protected past dates and schedulable future dates
- Projects with task-based progress
- Flowchart, Windows 98 folder, and neon-terminal project views
- Workspace timezone, rollover time, and discreet mode settings
- Mobile-responsive layout
- Local browser persistence

## Important status

This release is a **fully interactive local prototype**. Data is saved in the current browser through `localStorage`, so it is ideal for testing the product and interface.

It does **not yet provide real email login or cross-device synchronization**. The included `supabase/schema.sql` is the production database and security foundation for the next integration step.

## Test it locally

For developers:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The production build has been validated with:

```bash
npm run lint
npm run build
```

## Deploy through GitHub and Netlify without using a terminal

1. Unzip this project on your computer.
2. Create a new empty repository on GitHub.
3. Choose **Add file → Upload files**.
4. Upload the contents of the unzipped folder. Make sure `package.json` is at the repository root.
5. Commit the files.
6. In Netlify, choose **Add new project → Import an existing project**.
7. Select GitHub and select the repository.
8. Netlify should detect Next.js automatically.
9. Confirm the build command is `npm run build`.
10. Keep the publish directory as `.next`.
11. Deploy the site.

The repository pins Node.js 20 and npm 10 for compatibility with Next.js 16. The committed `package-lock.json` uses the public npm registry so Netlify can install dependencies normally.

No Supabase variables are required for the local-demo release.

## Prepare Supabase for real accounts

1. Create a new Supabase project.
2. Open **SQL Editor**.
3. Copy and run `supabase/schema.sql`.
4. Open **Project Settings → API**.
5. Copy the Project URL and publishable/anon key.
6. In Netlify, open **Project configuration → Environment variables**.
7. Add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
8. Redeploy after the authentication/data integration code is enabled.

Never put a Supabase service-role key in browser code or a `NEXT_PUBLIC_` variable.

## Project structure

```text
src/app/                 Next.js page, metadata, and global visual system
src/components/          Main interactive application
src/lib/date.ts          Timezone and operational-day calculations
src/lib/types.ts         Application data types
src/lib/supabase.ts      Supabase client preparation
supabase/schema.sql      Database, RLS, permissions, and rollover functions
public/                   App mark
```

## Recommended next implementation phase

1. Supabase email/password authentication
2. Create solo workspace after registration
3. Invite and link a partner account
4. Replace local data functions with Supabase queries
5. Subscribe to task and message changes through Realtime
6. Add secure rollover verification
7. Add notification preferences and PWA installation

## Product rule encoded in the database

A partner can create, edit, connect, and comment on the other partner’s task. Only the assigned owner can complete or delete that task. The database trigger in `schema.sql` enforces this independently of the interface.

## Appearance settings

TBFT includes three full-interface sizes—Small, Medium, and Large—and six mellow theme colors. Size selection scales typography, task windows, controls, dialogs, navigation, and spacing together. The workspace uses a warm off-white matte surface with subtle CSS-generated grain.
