---
title: "fix: Preserve extension statuses in custom footer"
date: "2026-06-30"
type: "fix"
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
execution: "code"
product_contract_source: "ce-plan-bootstrap"
origin: "https://github.com/synthetic-recon/pi-fusion/issues/10"
---

# fix: Preserve extension statuses in custom footer

## Goal Capsule

| Field | Value |
|---|---|
| Objective | Keep pi-fusion's custom footer while preserving status output registered by other Pi extensions. |
| Source of truth | GitHub issue #10, installed Pi type declarations, and existing footer behavior in `src/index.ts`. |
| Execution profile | Small behavior fix with unit coverage before final repo checks. |
| Stop conditions | Stop if the installed Pi footer data API differs from the issue's reported surface or if preserving statuses requires changing Pi itself. |
| Tail ownership | LFG owns implementation, review fixes, verification, commit, PR, and CI watch. |

---

## Product Contract

### Summary

pi-fusion currently replaces Pi's built-in footer when it renders fusion status, but the custom footer returns only pi-fusion's top and bottom lines.
That hides status text from other extensions registered through Pi's status API, making extensions such as token-speed appear broken even when their commands still work.
This fix preserves pi-fusion's footer content and appends other extension statuses when Pi exposes them.

### Problem Frame

The extension intentionally uses `ctx.ui.setFooter()` so it can show cwd, token/cost stats, model details, and fusion mode in a compact footer.
Once pi-fusion owns the footer, it also owns rendering status lines that Pi's built-in footer would normally include.
The current implementation clears pi-fusion's own status key with `ctx.ui.setStatus("fusion", undefined)` but does not consume `footerData.getExtensionStatuses()`, so unrelated extension statuses disappear from the UI.

### Requirements

- R1. When pi-fusion renders a custom footer, it appends a status line for non-empty extension statuses from Pi's footer data provider.
- R2. The status line is deterministic by extension key so footer output is stable across renders.
- R3. Status text is sanitized before rendering: ANSI escape sequences are stripped, CR/LF/TAB become spaces, remaining C0/C1 control characters are removed, and repeated whitespace is collapsed.
- R4. The appended status line is truncated to the available footer width using the same visible-width-aware utility already used elsewhere in the footer.
- R5. pi-fusion's existing full, compact, and off footer modes keep their current behavior except that full and compact custom footers can preserve other extension statuses.
- R6. When pi-fusion has no footer text to render, it still restores Pi's built-in footer instead of installing a custom footer.

### Acceptance Examples

- AE1. Given two other extensions register status text, when pi-fusion's custom footer renders, then the returned lines include pi-fusion's two existing footer lines followed by one combined status line.
- AE2. Given a status value contains a newline or control character, when the status line is rendered, then the returned line contains a single sanitized footer-safe string.
- AE3. Given no other extension statuses exist, when pi-fusion's custom footer renders, then the returned lines remain the current two-line footer output.
- AE4. Given footer display is `off` or no panel is selected, when `updateStatus` runs, then pi-fusion restores Pi's built-in footer and does not install a custom footer.

### Scope Boundaries

- Code changes are limited to pi-fusion's custom footer rendering path.
- It does not redesign footer configuration, add new user-facing settings, or change `/fusion-status` output.
- It does not vendor or duplicate Pi's built-in footer implementation beyond the extension status preservation required by issue #10.

---

## Planning Contract

### Key Technical Decisions

- KTD1. Render extension statuses as an extra line after pi-fusion's existing footer lines.
  This preserves the current top/bottom layout and avoids squeezing third-party statuses into either aligned line.
- KTD2. Sort by extension key and render values only.
  The key gives deterministic ordering while the value is the user-facing status text Pi extensions registered.
- KTD3. Keep sanitization local to footer status rendering.
  The behavior is footer-specific, so a small helper in `src/index.ts` is simpler than a shared utility with no second consumer.
- KTD4. Unit-test the pure formatting helper and keep integration risk low.
  The custom footer callback depends on live Pi TUI objects, so the deterministic behavior should be covered through exported pure helpers and the existing harness.

### Assumptions

- The installed Pi API is authoritative: `ReadonlyFooterDataProvider.getExtensionStatuses()` returns a `ReadonlyMap<string, string>`.
- `ctx.ui.setStatus("fusion", undefined)` continues to prevent pi-fusion from duplicating its own status in the appended line.
- Other extension status text should appear exactly as registered after sanitization and width truncation; pi-fusion should not add labels or icons.

### Sources & Research

- GitHub issue #10 describes the observed hidden-status behavior and suggested `getExtensionStatuses()` based fix.
- `src/index.ts` owns `updateStatus`, `fusionFooterText`, `alignLine`, and the custom `ctx.ui.setFooter()` render callback.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/footer-data-provider.d.ts` confirms `getExtensionStatuses()` is available on the read-only footer data provider.
- `node_modules/@earendil-works/pi-coding-agent/docs/tui.md` documents `footerData.getExtensionStatuses()` for custom footers.
- Pi's built-in footer implementation in `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/footer.js` sorts by key, sanitizes status text, joins values with spaces, and truncates to width.
- `src/__tests__/index.test.ts` already covers footer display helpers through the repo's custom harness.

---

## Implementation Units

### U1. Add status-line formatting helpers

- **Goal:** Provide deterministic, sanitized, width-aware formatting for extension statuses.
- **Requirements:** R1, R2, R3, R4, AE1, AE2, AE3
- **Dependencies:** None
- **Files:** `src/index.ts`, `src/__tests__/index.test.ts`
- **Approach:** Add a small exported helper that accepts the read-only status map and width, returns `undefined` for empty maps or all-empty sanitized values, sorts entries by key, strips ANSI escape sequences, replaces CR/LF/TAB with spaces, removes remaining C0/C1 controls, collapses whitespace, joins the remaining values with spaces, and truncates the result to the footer width.
- **Patterns to follow:** Keep helper style close to `fusionFooterText`, `normalizeFooterDisplay`, and `alignLine`; keep tests in `src/__tests__/index.test.ts` using `test` and `eq`.
- **Test scenarios:** Empty status map returns `undefined`; two statuses keyed out of insertion order render in key order; newline/tab text plus ESC and BEL controls collapse to a single safe line; narrow width truncates through `truncateToWidth`.
- **Verification:** The helper behavior is fully covered by unit tests and uses visible-width-aware truncation.

### U2. Append extension statuses from the custom footer render path

- **Goal:** Preserve other extensions' statuses when pi-fusion installs its custom footer.
- **Requirements:** R1, R4, R5, R6, AE1, AE3, AE4
- **Dependencies:** U1
- **Files:** `src/index.ts`, `src/__tests__/index.test.ts`
- **Approach:** In the existing `ctx.ui.setFooter()` render callback, build the current two lines exactly as today, then append the formatted extension status line when the helper returns one. Add a callback-level test that captures the installed footer factory, invokes `render(width)` with fake footer data, and proves the rendered lines include the appended third-party status line.
- **Patterns to follow:** Keep all footer rendering inside `updateStatus`; preserve the existing `setFooter(undefined)` branch when `fusionText` is absent.
- **Test scenarios:** Existing `fusionFooterText` display-mode tests continue to pass; a focused formatting test proves the appended-line input contract used by the render callback; a callback-level test proves `footerData.getExtensionStatuses()` is read and appended; footer display `off` returns no fusion footer text; an empty selected panel returns no fusion footer text.
- **Verification:** Footer helper tests pass, the callback-level test fails on the current two-line implementation and passes after wiring, and the render callback continues returning two lines when there are no external statuses.

---

## Verification Contract

| Gate | Command | Proves |
|---|---|---|
| Unit tests | `npm test` | Existing behavior plus new footer status formatting scenarios pass under the custom harness. |
| Type check | `npm run check` | Public helper exports and Pi API usage type-check against installed declarations. |
| Strict dead-code pass | `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` | No unused helpers/imports were introduced. |
| Package surface | `npm pack --dry-run` | The package still contains the expected publishable files after the change. |

---

## Definition of Done

- U1 and U2 are implemented without adding runtime dependencies.
- The custom footer appends a sanitized, deterministic third-party extension status line only when statuses exist.
- Existing footer mode behavior remains intact: `off` restores Pi's built-in footer, and full/compact still render pi-fusion's own text.
- All verification gates in the Verification Contract pass.
- Any dead-end implementation attempts are removed from the final diff.
- The PR references issue #10 and describes the footer status preservation behavior.
