# Changelog

## 0.2.0

- Redesigned fusion UX around a single setup UI.
- `/fusion-setup` for choosing panel/judge with native pi TUI.
- `/fusion-run` for setup + prompt + run in one flow.
- `/fusion-clear` to reset session selection.
- `/fusion-init` now confirms before overwriting existing `.pi/fusion.json`.
- Setup UI controls: type to search, Tab switches search/list, p/Space toggle panel, j toggle judge, c clear, Enter confirm, Esc cancel.
- Persistent footer status and widget showing current panel and judge.

## 0.1.0

- Initial release.
- `fusion` tool for multi-model deliberation.
- `/fusion`, `/fusion-config`, `/fusion-panel`, `/fusion-models`, `/fusion-init` commands.
- Configurable panel and judge via `~/.pi/agent/fusion.json` or project-local `.pi/fusion.json`.
- Interactive, searchable model selector via `/fusion-panel` using pi's built-in `SelectList` and `Input` components.
- Session-state persistence for panel/judge selections.
- Config validation and model preview commands.
- TypeScript project setup with `npm run check` and `npm test`.
