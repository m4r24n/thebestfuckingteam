# TBFT 0.2 — Minimal Interface Redesign

## Interface

- Replaced the notepad/paper aesthetic with a clean neutral dashboard.
- Reduced sidebar, header, date information, progress indicators, and metadata.
- Increased the visual priority of the two task columns.
- Standardized the interface on one modern system sans-serif font stack.
- Removed bright decorative colors from the main UI.
- Kept status colors restrained and limited to small labels and task-edge indicators.
- Hid task edit/delete controls until hover or keyboard focus.
- Rebuilt desktop and mobile layouts.

## Task behavior

- The task owner can now click a completed checkbox to mark the task incomplete again.
- Un-completion is recorded in activity history.
- Historical completed tasks can be returned to incomplete and then follow the rollover rules again.

## Dialogs

- Redesigned the task editor as a modern in-app dialog.
- Added a dedicated project-phase dialog.
- Replaced browser-native delete and reset confirmations with in-app confirmation dialogs.
- Removed every use of `window.prompt()` and `window.confirm()`.
