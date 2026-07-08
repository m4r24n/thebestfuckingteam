# TBFT v0.5.2 — Button contrast correction

This maintenance update improves the readability of action controls across every mellow accent theme.

## Changed

- Primary action buttons now use dark text instead of white text.
- Authentication actions such as **Sign in**, **Create account**, **Save new password**, and **Create workspace** inherit the corrected dark text.
- Task, project, phase, note, and confirmation actions inherit the same correction.
- Destructive controls now use a restrained pale-danger surface with dark text.
- The outlined **Sign out** control is now clearly readable.
- Selected calendar dates use dark text on a lighter theme-aware surface.
- Completed-task check controls use a dark check mark for improved contrast.
- Hover states remain readable across mustard, muted green, mellow blue, clay, soft mauve, and blue-green themes.

No database migration or Supabase configuration change is required.
