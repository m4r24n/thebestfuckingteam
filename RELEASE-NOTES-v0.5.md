# TBFT v0.5 — Cloud Accounts and Day Timer

## Authentication

- Added email/password sign-up and sign-in
- Added email-confirmation return handling
- Added forgotten-password and new-password flow
- Added persistent Supabase sessions
- Added secure sign-out

## Workspace onboarding

- Create a solo or couple workspace
- Create a private partner invitation code
- Join an existing couple workspace with the code
- Invitation codes expire after 14 days and are stored only as hashes

## Cloud persistence

The following now use Supabase PostgreSQL instead of browser-only storage:

- Tasks and completion state
- Task dates, deadlines, priority, ownership, and project links
- Task-thread messages
- Projects and project phases
- Workspace settings and appearance
- Activity history
- Partner membership

## Collaboration and security

- Added Realtime refresh for shared workspace changes
- Added Row Level Security for all collaborative tables
- Added database triggers for owner-only completion, deletion, and ownership transfer
- Added database protection against new tasks being backdated into closed boards
- Added missed-rollover repair on app opening
- Added cloud sync status

## Reliability

- Added a local read-only cache of the latest successful cloud load
- Added a JSON backup download
- Save failures are shown rather than silently falling back to browser-only data

## Current Day timer

- Added a live countdown in the upper-left of Current Day
- Progress is 0% at rollover, normally 6:00 AM
- Progress fills continuously until midnight
- From midnight to rollover, it stays at 100% and glows red
- During that interval the countdown shows the remaining grace-period time

## Important upgrade step

Run `supabase/setup-v0.5.sql` in the Supabase SQL Editor before using the new deployment.
