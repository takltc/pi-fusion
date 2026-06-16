/**
 * Panel tool resolution for pi-fusion.
 *
 * Tool definitions are built from a hard-coded allowlist of pi's own tool
 * factories — never from the live extension registry — so the `fusion` tool can
 * never leak into a panel model's tool list (recursion guarantee).
 */

import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_TOOL_CALLS, MAX_TOOL_CALLS, MIN_TOOL_CALLS } from "./config.ts";
import type { ToolSelection } from "./types.ts";

export type FusionToolDef = ToolDefinition<any, any>;

export const READONLY_TOOL_NAMES = ["read", "grep", "find", "ls"] as const;
export const MUTATING_TOOL_NAMES = ["bash", "edit", "write"] as const;
export const ALL_TOOL_NAMES = [...READONLY_TOOL_NAMES, ...MUTATING_TOOL_NAMES] as const;

type ToolName = (typeof ALL_TOOL_NAMES)[number];

const FACTORIES: Record<ToolName, (cwd: string) => FusionToolDef> = {
	read: (cwd) => createReadToolDefinition(cwd),
	grep: (cwd) => createGrepToolDefinition(cwd),
	find: (cwd) => createFindToolDefinition(cwd),
	ls: (cwd) => createLsToolDefinition(cwd),
	bash: (cwd) => createBashToolDefinition(cwd),
	edit: (cwd) => createEditToolDefinition(cwd),
	write: (cwd) => createWriteToolDefinition(cwd),
};

function isToolName(value: string): value is ToolName {
	return (ALL_TOOL_NAMES as readonly string[]).includes(value);
}

/** Normalize a selection (mode or explicit list) into an ordered, deduped tool-name list. */
export function selectionToNames(selection: ToolSelection | undefined): ToolName[] {
	if (!selection || selection === "none") return [];
	if (selection === "readonly") return [...READONLY_TOOL_NAMES];
	if (selection === "all") return [...ALL_TOOL_NAMES];
	if (Array.isArray(selection)) {
		const seen = new Set<string>();
		const out: ToolName[] = [];
		for (const raw of selection) {
			const name = String(raw).toLowerCase();
			if (isToolName(name) && !seen.has(name)) {
				seen.add(name);
				out.push(name);
			}
		}
		return out;
	}
	return [];
}

/** Build executable tool definitions for the resolved selection. */
export function resolveToolDefs(selection: ToolSelection | undefined, cwd: string): FusionToolDef[] {
	return selectionToNames(selection).map((name) => FACTORIES[name](cwd));
}

/** True when the selection includes a tool that can mutate the filesystem or run commands. */
export function isMutatingSelection(selection: ToolSelection | undefined): boolean {
	return selectionToNames(selection).some((n) => (MUTATING_TOOL_NAMES as readonly string[]).includes(n));
}

/** A short, stable label for a selection (for footers, status, diagnostics). */
export function selectionLabel(selection: ToolSelection | undefined): string {
	if (!selection || selection === "none") return "none";
	if (selection === "readonly" || selection === "all") return selection;
	const names = selectionToNames(selection);
	return names.length ? names.join(",") : "none";
}

/** Clamp a max-tool-calls value into the supported range, defaulting when absent. */
export function clampMaxToolCalls(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_TOOL_CALLS;
	return Math.max(MIN_TOOL_CALLS, Math.min(MAX_TOOL_CALLS, Math.floor(value)));
}
