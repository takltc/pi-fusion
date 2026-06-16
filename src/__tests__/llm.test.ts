/**
 * Tests for provider/model request compatibility.
 */

import { getSupportsTemperature } from "../llm.ts";
import type { Api, Model } from "../types.ts";
import { fakeModel, test } from "./_harness.ts";

test("openai-codex provider rejects temperature even when id does not contain codex", () => {
	const model = fakeModel("openai-codex", "gpt-5.5");
	if (getSupportsTemperature(model)) throw new Error("expected openai-codex/gpt-5.5 to omit temperature");
});

test("anthropic compat.supportsTemperature=false is honored", () => {
	const model = fakeModel("anthropic", "claude-opus-4-8", {
		api: "anthropic-messages" as Api,
		compat: { supportsTemperature: false } as Model<Api>["compat"],
	});
	if (getSupportsTemperature(model)) throw new Error("expected compat.supportsTemperature=false to omit temperature");
});

test("anthropic model without a compat flag defaults to supporting temperature", () => {
	// Regression for the dropped ^claude-opus-4-[7-9] regex: behavior now follows metadata only.
	const model = fakeModel("anthropic", "claude-opus-4-8", { api: "anthropic-messages" as Api });
	if (!getSupportsTemperature(model)) throw new Error("expected temperature when no compat flag is set");
});

test("ordinary openai-compatible model keeps temperature", () => {
	const model = fakeModel("openai", "gpt-4.1");
	if (!getSupportsTemperature(model)) throw new Error("expected regular model to support temperature");
});
