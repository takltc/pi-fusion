import { test, eq, fakeModel } from "./_harness.ts";
import registerFusionExtension, {
	buildInitialState,
	formatExtensionStatusLine,
	fusionFooterText,
	normalizeFooterDisplay,
} from "../index.ts";
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

test("fusionFooterText hides footer text when panel is empty", () => {
	eq(fusionFooterText(new Set(), undefined, "available", "full"), undefined, "available mode with no panel hides text");
	eq(fusionFooterText(new Set(), undefined, "off", "full"), "Fusion off", "off mode still reports disabled state");
});

test("formatExtensionStatusLine sorts, sanitizes, and truncates statuses", () => {
	const statuses = new Map([
		["z-token-speed", "\x1B[31m⚡\x1B[0m TPS\n42\tfast\x07"],
		["a-honcho", " Honcho  ready  "],
	]);
	eq(
		formatExtensionStatusLine(statuses, 80),
		"Honcho ready ⚡ TPS 42 fast",
		"status text is sorted by key and sanitized",
	);
	eq(formatExtensionStatusLine(statuses, 12), "Honcho re...", "status text truncates to footer width");
	eq(formatExtensionStatusLine(new Map([["empty", "\n\t\x07"]]), 80), undefined, "empty sanitized statuses are omitted");
	eq(
		formatExtensionStatusLine(new Map([["link", "\x1B]8;;https://example.com\x07Token\x1B]8;;\x07 ready"]]), 80),
		"Token ready",
		"OSC hyperlinks keep visible text without leaking control payload",
	);
});

function fakeContext(branch: unknown[] = []): ExtensionContext {
	return {
		sessionManager: {
			getBranch: () => branch,
		},
	} as ExtensionContext;
}

test("registered footer refresh appends extension statuses", async () => {
	type FooterFactory = (tui: unknown, theme: { fg: (_color: string, value: string) => string }, footerData: unknown) => { render(width: number): string[] };
	type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown | Promise<unknown>;

	let footerFactory: FooterFactory | undefined;
	const handlers = new Map<string, EventHandler>();
	const branch = [{
		type: "custom",
		customType: "fusion-state",
		data: {
			selectedIds: ["anthropic/claude-sonnet-4-5"],
			judgeId: "anthropic/claude-opus-4-5",
			footerDisplay: "full",
		},
	}];
	const ctx = {
		cwd: "/tmp/pi-fusion",
		isProjectTrusted: () => false,
		getContextUsage: () => ({ percent: 0, contextWindow: 128000 }),
		model: fakeModel("anthropic", "anthropic/claude-sonnet-4-5"),
		modelRegistry: {
			isUsingOAuth: () => false,
		},
		sessionManager: {
			getBranch: () => branch,
			getEntries: () => [],
			getSessionName: () => undefined,
		},
		ui: {
			setStatus: () => {},
			setWidget: () => {},
			setFooter: (factory: typeof footerFactory) => {
				footerFactory = factory;
			},
		},
	} as unknown as ExtensionContext;
	const pi = {
		registerTool: () => {},
		registerCommand: () => {},
		on: (event: string, handler: EventHandler) => {
			handlers.set(event, handler);
		},
		getThinkingLevel: () => "off",
	};

	registerFusionExtension(pi as never);
	const refreshFooter = handlers.get("session_start");
	if (!refreshFooter) throw new Error("expected session_start handler to be registered");
	await refreshFooter({}, ctx);
	if (!footerFactory) throw new Error("expected custom footer to be installed");

	const component = footerFactory(
		{ requestRender: () => {} },
		{ fg: (_color: string, value: string) => value },
		{
			onBranchChange: () => () => {},
			getGitBranch: () => "feature",
			getAvailableProviderCount: () => 1,
			getExtensionStatuses: () => new Map([
				["z-token-speed", "⚡ TPS 42"],
				["a-honcho", "Honcho ready"],
			]),
		},
	);
	const lines = component.render(120);
	eq(lines.length, 3, "custom footer includes extension status line");
	eq(lines[2], "Honcho ready ⚡ TPS 42", "extension status line is appended in sorted order");
});

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
