import { test, eq } from "./_harness.ts";
import { buildInitialState, fusionFooterText, normalizeFooterDisplay } from "../index.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

test("normalizeFooterDisplay accepts known footer modes", () => {
	eq(normalizeFooterDisplay("full"), "full", "full is accepted");
	eq(normalizeFooterDisplay("compact"), "compact", "compact is accepted");
	eq(normalizeFooterDisplay("off"), "off", "off is accepted");
});

test("normalizeFooterDisplay falls back to full", () => {
	eq(normalizeFooterDisplay(undefined), "full", "missing footer display falls back");
	eq(normalizeFooterDisplay("bad"), "full", "invalid footer display falls back");
});

test("fusionFooterText supports full, compact, and off display modes", () => {
	const panel = new Set(["anthropic/claude-sonnet-4-5", "openai/gpt-4.1"]);
	eq(
		fusionFooterText(panel, "anthropic/claude-opus-4-5", "available", "full"),
		"Fusion available • 2 panel • judge anthropic/claude-opus-4-5",
		"full footer includes judge",
	);
	eq(
		fusionFooterText(panel, "anthropic/claude-opus-4-5", "available", "compact"),
		"Fusion available • 2 panel",
		"compact footer omits judge",
	);
	eq(
		fusionFooterText(panel, "anthropic/claude-opus-4-5", "available", "off"),
		undefined,
		"off footer hides fusion text",
	);
});

function fakeContext(branch: unknown[] = []): ExtensionContext {
	return {
		sessionManager: {
			getBranch: () => branch,
		},
	} as ExtensionContext;
}

test("buildInitialState seeds panel tools from config when session has no tool choice", () => {
	const state = buildInitialState(
		fakeContext(),
		[{ display: "anthropic/claude-sonnet-4-5" }],
		{ display: "anthropic/claude-opus-4-5" },
		"readonly",
		"compact",
	);
	eq(state.panelTools, "readonly", "config panelTools initializes setup state");
	eq(state.footerDisplay, "compact", "config footerDisplay initializes setup state");
});

test("buildInitialState lets config panel tools replace session none", () => {
	const state = buildInitialState(
		fakeContext([{
			type: "custom",
			customType: "fusion-state",
			data: {
				selectedIds: ["anthropic/claude-sonnet-4-5"],
				panelTools: "none",
			},
		}]),
		[{ display: "anthropic/claude-sonnet-4-5" }],
		{ display: "anthropic/claude-opus-4-5" },
		"readonly",
		"full",
	);
	eq(state.panelTools, "readonly", "session none does not mask config panelTools");
});

test("buildInitialState prefers session footer display over config", () => {
	const state = buildInitialState(
		fakeContext([{
			type: "custom",
			customType: "fusion-state",
			data: {
				selectedIds: ["anthropic/claude-sonnet-4-5"],
				footerDisplay: "off",
			},
		}]),
		[{ display: "anthropic/claude-sonnet-4-5" }],
		{ display: "anthropic/claude-opus-4-5" },
		"readonly",
		"full",
	);
	eq(state.footerDisplay, "off", "session footerDisplay wins");
});
