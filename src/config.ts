/**
 * Fusion configuration loading and validation.
 */

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FusionConfig, ResolvedFusionConfig } from "./types.ts";

export type { FusionConfig, ResolvedFusionConfig };

export const DEFAULT_MAX_PANEL_MODELS = 3;
export const DEFAULT_MAX_PANEL_OUTPUT_TOKENS = 2048;
export const DEFAULT_MAX_COMPLETION_TOKENS = 4096;
export const DEFAULT_TEMPERATURE = 0.3;
export const MAX_PANEL_MODELS_HARD_LIMIT = 8;
export const PANEL_CONCURRENCY = 4;

export const DEFAULT_MAX_TOOL_CALLS = 8;
export const MIN_TOOL_CALLS = 1;
export const MAX_TOOL_CALLS = 100;
/** Per tool result, before it re-enters the loop transcript (keeps panel context bounded). */
export const TOOL_OUTPUT_MAX_BYTES = 12_000;

export function loadConfig(cwd: string, projectTrusted: boolean): FusionConfig {
	const paths: string[] = [];
	if (projectTrusted) {
		paths.push(join(cwd, ".pi", "fusion.json"));
	}
	paths.push(join(getAgentDir(), "fusion.json"));

	for (const path of paths) {
		if (!existsSync(path)) continue;
		try {
			return JSON.parse(readFileSync(path, "utf8")) as FusionConfig;
		} catch (err) {
			console.error(`[pi-fusion] failed to parse ${path}:`, err);
		}
	}
	return {};
}

export function applyDefaults(config: FusionConfig, overrides: {
	max_completion_tokens?: number;
	temperature?: number;
	panel_tools?: FusionConfig["panelTools"];
	max_tool_calls?: number;
}): ResolvedFusionConfig {
	const merged: FusionConfig = {
		...config,
		...(overrides.max_completion_tokens ? { maxCompletionTokens: overrides.max_completion_tokens } : {}),
		...(overrides.temperature !== undefined ? { temperature: overrides.temperature } : {}),
		...(overrides.panel_tools !== undefined ? { panelTools: overrides.panel_tools } : {}),
		...(overrides.max_tool_calls !== undefined ? { maxToolCalls: overrides.max_tool_calls } : {}),
	};
	// Single source of truth for defaults: callers can read these numeric knobs directly.
	return {
		...merged,
		maxPanelModels: merged.maxPanelModels ?? DEFAULT_MAX_PANEL_MODELS,
		maxPanelOutputTokens: merged.maxPanelOutputTokens ?? DEFAULT_MAX_PANEL_OUTPUT_TOKENS,
		maxCompletionTokens: merged.maxCompletionTokens ?? DEFAULT_MAX_COMPLETION_TOKENS,
		temperature: merged.temperature ?? DEFAULT_TEMPERATURE,
		maxToolCalls: merged.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
	};
}

export function generateConfigExample(panel?: string[], judge?: string): FusionConfig {
	return {
		panel: panel ?? [
			"anthropic/claude-sonnet-4-5",
			"openai/gpt-4.1",
			"google/gemini-2.5-pro",
		],
		judge: judge ?? "anthropic/claude-opus-4-5",
		maxPanelModels: DEFAULT_MAX_PANEL_MODELS,
		maxPanelOutputTokens: DEFAULT_MAX_PANEL_OUTPUT_TOKENS,
		maxCompletionTokens: DEFAULT_MAX_COMPLETION_TOKENS,
		temperature: DEFAULT_TEMPERATURE,
		panelTools: "none",
		maxToolCalls: DEFAULT_MAX_TOOL_CALLS,
	};
}
