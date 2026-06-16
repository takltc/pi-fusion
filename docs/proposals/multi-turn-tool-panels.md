# Design proposal: multi-turn, tool-enabled fusion panels

Status: **proposal** (deliberated via a 3-lens design panel; not yet implemented)
Scope: let each fusion **panel** model optionally run an internal agentic loop with tool
calls, bounded and configurable — mirroring OpenRouter Fusion's behavior, built on pi's own
primitives.

## 1. Goal & framing

Today every panel model does a single `complete()` with no tools ([src/llm.ts](../../src/llm.ts)
`callModelText` → [src/fusion.ts](../../src/fusion.ts) `runFusion`). We want a panel model to be
able to **gather information before answering** — read files, grep, search — across multiple
internal turns, then return its final text. The judge still synthesizes the panel's *final*
answers.

Important framing borrowed from OpenRouter Fusion: this is **not** multi-turn *conversation*
with the user. Each panel member runs **one logical call** that may internally call tools up to a
cap (`max_tool_calls`, default 8 there, range 1–16), then returns final text. Deliberation stays
a single panel→judge round.

## 2. Background (verified)

**OpenRouter Fusion** — panel = single top-level completion, each with an internal tool loop
(web_search/web_fetch) capped by `max_tool_calls` (default 8, 1–16). Tools are global to all
panel+judge members, not per-model. Recursion is blocked server-side via an
`x-openrouter-fusion-depth` header: panel/judge never get the `fusion` tool injected, so they
can't recurse.

**pi primitives** (all present, no new SDK needed):
- `complete(model, Context, options)` where `Context = { systemPrompt?, messages, tools?: Tool[] }`,
  `Tool = { name, description, parameters: TSchema }`.
- Response `AssistantMessage.content: (TextContent | ThinkingContent | ToolCall)[]`;
  `ToolCall = { type:"toolCall", id, name, arguments }`; `stopReason` includes `"toolUse"`.
- Feed results back with `ToolResultMessage = { role:"toolResult", toolCallId, toolName,
  content, isError, timestamp }`.
- Executable tool defs: `createReadOnlyToolDefinitions(cwd)` → `[read, grep, find, ls]`;
  `createCodingToolDefinitions(cwd)` → `[read, bash, edit, write]`. Each `ToolDef.execute(
  toolCallId, params, signal, onUpdate, ctx)`; `ToolDef.parameters` is the schema to advertise.
- **No** lightweight built-in agent loop; `createAgentSession` is heavyweight and unsafe to call
  inside a running extension. → We build a small manual loop (Path A).

> All of the above were verified against the installed type defs: `pi-ai/dist/types.d.ts`
> (`Context.tools` :244, `Tool` :239, `ToolCall` :170, `StopReason "toolUse"` :191,
> `ToolResultMessage` :211 with `content: (TextContent | ImageContent)[]`), `pi-ai/dist/stream.d.ts:5`
> (`complete`), and `pi-coding-agent/dist/core/tools/index.d.ts:34-35`
> (`createCodingToolDefinitions` / `createReadOnlyToolDefinitions`) +
> `core/extensions/types.d.ts:361` (`ToolDefinition.execute(..., ctx: ExtensionContext)`).

## 3. Decisions (judge synthesis of the panel)

1. **Manual loop in the extension** (Path A). ~50–80 LOC in `llm.ts`. No `createAgentSession`.
2. **Tools OFF by default.** Existing configs/sessions behave identically.
3. **Tool modes: `none` | `readonly` | `all` (plus an optional explicit tool-name list).**
   `readonly` = `[read, grep, find, ls]`; `all` = the full toolset including `bash`/`edit`/`write`,
   **ungated** (no project-trust requirement — it's the user's machine, and pi already grants
   extensions full system access). `all` requires explicit opt-in **plus a one-time consent**
   (it runs `bash` and writes files). Power-user override: pass a `string[]` of exact tool names
   instead of a named bundle.
   - **Gating and concurrency are orthogonal.** Opting in answers *"am I allowed."* It does **not**
     answer *"will N concurrent vendor models corrupt each other's writes."* So when a **mutating**
     tool is active (`all`, or a list containing `bash`/`edit`/`write`), **serialize the panel
     (effective concurrency 1)** to prevent interleaved/clobbered writes. Per-panel worktree
     isolation is the fully-correct fix but is out of scope for v1.
4. **`max_tool_calls` default 8, range 1–16** (configurable), matching OpenRouter.
5. **Judge is always tool-free.** No `judgeTools` knob — the judge is a pure synthesizer; tools
   there only add cost and recursion surface.
6. **Recursion-safe by construction, made explicit.** Panel/judge tool lists are built from a
   hard-coded allowlist via the `create*ToolDefinitions` factories — never from pi's live tool
   registry — so the `fusion` tool can never leak in. Keep the existing `tool_call` block on
   `fusion` as a second gate.

## 4. Configuration

`FusionConfig` additions (camelCase, optional):

```ts
panelTools?: "none" | "readonly" | "all" | string[];  // default "none"; string[] = explicit tool names
maxToolCalls?: number;                                  // 1–16, default 8
```

`fusion` tool params (snake_case, per-call overrides) — enum only; the `string[]` list is
config-file only to keep the tool schema clean:

```ts
panel_tools?: "none" | "readonly" | "all";   // Type.Union of literals, like context_mode
max_tool_calls?: number;                       // Type.Integer 1–16, default 8; mirrors OpenRouter naming
```

Annotated example `fusion.json`:

```jsonc
{
  "panel": ["anthropic/claude-sonnet-4-5", "openai/gpt-4.1", "google/gemini-2.5-pro"],
  "judge": "anthropic/claude-opus-4-5",
  "maxPanelOutputTokens": 2048,
  "maxCompletionTokens": 4096,
  "temperature": 0.3,
  "panelTools": "readonly",   // read, grep, find, ls
  "maxToolCalls": 8
}
```

Example calls:
- read-only: `{ "prompt": "Audit src/auth/ for auth bugs", "panel_tools": "readonly", "max_tool_calls": 6 }`
- full/ungated (off by default; triggers consent + serialized panel): `{ "prompt": "...", "panel_tools": "all" }`
- explicit list: `{ "prompt": "...", "panel_tools": ["read", "grep", "bash"] }`

Backward compatibility: all fields optional; `undefined` ⇒ `"none"`. `applyDefaults` passes them
through. No existing behavior changes.

## 5. Implementation (llm.ts)

Keep `callModelText` as-is (judge + zero-tool panels). Add:

```ts
export interface ToolLoopResult {
  message: AssistantMessage;                 // final text turn
  turns: number;                             // complete() calls made
  toolCalls: { name: string; ok: boolean }[];
  cappedOut: boolean;
}

export async function callModelWithTools(
  registry, model, systemPrompt, userText, maxTokens, temperature, signal,
  toolDefs: ToolDef[], maxToolCalls: number, ctx: ExtensionContext,
  onUpdate?: (ev: { kind: "tool"; name: string; turn: number }) => void,
): Promise<ToolLoopResult>
```

Loop:
1. Build `tools = toolDefs.map(d => ({name,description,parameters}))` and `byName` map once.
2. `messages = [user]`. Repeat: `resp = complete(model, {systemPrompt, messages, tools}, opts)`.
3. If `stopReason !== "toolUse"` / no `ToolCall`s → return `resp` (natural stop).
4. Else push `resp` (the assistant turn — preserves toolCall ids + thinking). For each ToolCall
   **sequentially**: `def = byName.get(tc.name)`; `out = def ? await def.execute(tc.id,
   tc.arguments, signal, adapter, ctxForTools) : isErrorResult("unknown tool")`; **truncate large
   tool output**, then push a `ToolResultMessage{ toolCallId: tc.id, toolName: tc.name, content:
   [{ type:"text", text: <output> }], isError, timestamp }`; `used++`.
   - **`tc.arguments` is already a parsed object** (`Record<string, any>`) — pass it straight to
     `execute`, do **not** `JSON.parse` it.
   - **`content` MUST be `(TextContent | ImageContent)[]`** (verified against the type), not a raw
     string — wrap text as `[{ type:"text", text }]`.
   - **`ctxForTools`**: `execute`'s last arg is `ExtensionContext`, and its `ctx.signal` is the
     *outer agent* signal, not the per-panel one. Pass a shallow proxy of `ctx` whose `signal` is
     overridden to the panel `signal` so a panel-level abort actually cancels in-flight tool work.
     (The explicit 3rd `signal` arg is also passed; overriding `ctx.signal` covers tools that read
     it off `ctx`.)
5. **Cap handling (enforced at turn boundaries):** before executing a turn's calls, if
   `used + toolCalls.length > maxToolCalls`, execute the calls that fit, **pair every remaining
   `ToolCall` in the turn with a synthetic `isError` result** (`"tool-call budget exhausted"`) so
   no `toolCall` is left unanswered, then do **one final `complete()` with `tools` omitted** to
   force a text answer; return with `cappedOut: true`. Never leave an orphaned `ToolCall` — the
   next provider request 400s otherwise.
6. **Circuit breaker:** stop after 2 consecutive identical calls (identity = `name +
   JSON.stringify(arguments)`) or 2 repeated tool errors, then finalize as in step 5.

`runFusion` integration:
- Thread `ctx` into `runFusion` (already has `cwd`, `projectTrusted`).
- Resolve `toolDefs` from `panelTools`: `"none"` → `[]`; `"readonly"` →
  `createReadOnlyToolDefinitions(cwd)` ([read, grep, find, ls]); `"all"` →
  `createAllToolDefinitions(cwd)` (all 7 tools); `string[]` → `createToolDefinition(name, cwd)`
  per name.
- **Detect mutating tools** (`bash`/`edit`/`write` present in the resolved set). If so: require the
  one-time consent, and run the panel **serialized** (`mapWithConcurrencyLimit(panel, 1, ...)`)
  instead of `PANEL_CONCURRENCY=4`.
- In the panel map callback: `toolDefs.length ? callModelWithTools(...) : callModelText(...)`.
- Record per-response `{ turns, tool_calls, capped }` in `FusionDetails` for `/fusion-report`.

## 6. Safety requirements (hard — must be true to ship)

1. **Panels can never invoke `fusion`** — allowlist-only tool construction + keep the `tool_call`
   block. (Optionally add an "active fusion run" guard so the off-switch isn't the only gate.)
2. **Tools off by default; mutation is opt-in + consented + serialized.** `readonly` is the safe
   default-when-on. `all` (and any list containing `bash`/`edit`/`write`) is **ungated** but must
   require explicit opt-in, a one-time consent, and **panel serialization (concurrency 1)** so the
   N models cannot clobber each other's writes.
3. **`signal` cancels in-flight tool execution AND model calls** — pass it as `def.execute`'s
   3rd arg, into every `complete()`, **and override `ctx.signal` via a proxy** (tools read the
   signal off `ctx`, whose default value is the outer agent signal, not the panel's). Enforce
   `maxToolCalls` + a wall-clock budget.
4. **Bound tool-output size before it re-enters the loop** — independent of the judge's
   `truncateForJudge` (which only bounds the final text, not intra-loop context). Prevents
   per-panel context-window blowup.

## 7. Privacy / trust boundary

Even read-only tools mean **file contents now leave the machine to multiple third-party vendors**
that previously saw only the prompt; `all` additionally runs `bash` and writes files. Surface this:
a one-time per-session consent when panel tools are first enabled (stronger confirmation for
`all`/mutating sets), plus a persistent indicator.

### 7a. Integration with existing surfaces

The new controls must reuse pi-fusion's current machinery, not add a parallel system. Map:

**The `/fusion` command stays as-is** (`on`/`available`/`off`/toggle/`<prompt>`). We deliberately do
**not** add `/fusion tools`/`/fusion calls` subcommands or extend its autocomplete — that's more
command surface than this warrants, and it would mean special-casing two-word args before the
force-prompt fallback. Interactive setup lives in the **`/fusion-setup` menu**; durable config lives
in **`fusion.json`**; one-off control is the **per-call tool param**.

| Existing surface (file) | Change |
|---|---|
| **`/fusion-setup` picker** (`ui.ts` `selectFusionSetup`, `FusionSetupState`) | This is the home for tool setup. Add `t` to cycle panel tool mode (`none→readonly→all→none`) and `m` to cycle the max-calls preset (`4→8→12→16`) — both reuse the existing keybinding+`statusLine` pattern, so no free-form numeric widget. Show in `statusLine` (e.g. `3 panel · judge X · tools: readonly · 8`). Add `panelTools`/`maxToolCalls` to `FusionSetupState` and a one-line hint. On confirm with a mutating mode, fire the consent `ctx.ui.confirm`. |
| **Session state** (`persistSessionState`/`restoreSessionState`, the `fusion-state` custom entry) | Add `panelTools`, `maxToolCalls`, and `toolsConsented` to the persisted `{selectedIds, judgeId, mode, ...}` payload so tool config (and consent) survive `/resume` exactly like mode/panel/judge do today. |
| **Footer** (`fusionFooterText`/`installFusionFooter`/`updateStatus`, `index.ts:131`) | Thread `panelTools`/`maxToolCalls` through these signatures (they already take `selectedIds, judgeId, mode`). When tools on, append ` • tools: readonly·8` (or `tools: all·8 ⚠`). |
| **`/fusion-status`** (`index.ts:567`) | Add a `Tools:` line (`readonly (max 8)` / `all (max 8, panel serialized)` / `off`). Point users to `/fusion-setup` to change it (consistent with how it already points there for panel/judge). |
| **`/fusion-init` template** (`generateConfigExample`, `config.ts`) | Add `panelTools: "none"` and `maxToolCalls: 8` to the emitted template (safe default = off) so the knobs are discoverable in the file. |
| **`fusion` tool params** (`FusionParams`, `index.ts:30`) | Add `panel_tools` (a `Type.Union` of `none`/`readonly`/`all` literals, like the existing `context_mode`) and `max_tool_calls` (`Type.Integer`, min 1 max 16, default 8). The explicit `string[]` tool list is **config-file only** — keep the tool *param* a clean enum. |
| **Config + precedence** (`FusionConfig`, `FusionOptions`, `applyDefaults`, `sessionFusionOptions`) | Carry `panelTools`/`maxToolCalls` through these like `temperature`/`max_completion_tokens` do. Precedence stays identical to today: **per-call param → session (`/fusion-setup`) → `fusion.json` → default** (`none` / `8`). |

### 7b. Non-interactive (`print`/no-UI) mode

`ctx.hasUI` is false in `-p`/print mode, so the consent `confirm` can't run. Rule: in non-UI mode,
tools work only when set **explicitly** (config or `panel_tools` param), and `all`/mutating sets
require an explicit opt-in field (e.g. config `panelToolsConsent: true`) rather than an interactive
prompt — otherwise downgrade to `readonly` (mirrors how `/fusion-setup` already guards on
`ctx.hasUI`).

## 8. Failure semantics

Reuse the existing partial-success path: a panel whose loop errors, loops, or caps out degrades to
a normal `PanelResult` — best partial text, or `{ error }` like a failed `complete()` today. The
`successful`/`failed` split, single-success skip-judge, and all-failed classifier need no new
branches.

## 9. v1 scope

**In:** `none`/`readonly`/`all` panel tool modes + explicit tool-name lists, `max_tool_calls` cap
(default 8), mutation opt-in with consent + **panel serialization when mutating**, cap-then-finalize,
circuit breaker, output truncation, abort propagation, recursion guarantee, config + per-call
params, `/fusion-status` + footer indicators, `FusionDetails` instrumentation.

**Punted:** per-panel worktree isolation (the fully-correct fix for concurrent mutation; v1
serializes instead), judge tools, per-model tool config, streaming tool progress beyond a simple
"running X" line.

## 10. Open questions

- Should `readonly` require consent, or only a passive indicator? (Proposed: light one-time consent
  because file contents leave the machine; stronger confirmation for `all`.)
- Per-tool output truncation size — pick a byte cap (e.g. 8–16 KB/tool result) and make it config.
- Serialization granularity: serialize the whole panel when *any* mutating tool is configured
  (simple, chosen), vs. only serialize the actual mutating calls (more complex, more parallelism).
