/**
 * Tests for pi-fusion formatting.
 */

import { formatAnalysis, formatResult } from "../format.ts";
import type { FusionAnalysis, FusionDetails } from "../types.ts";

function test(name: string, fn: () => void | Promise<void>) {
	Promise.resolve(fn()).then(
		() => console.log(`✓ ${name}`),
		(err) => {
			console.error(`✗ ${name}:`, err);
			process.exitCode = 1;
		},
	);
}

test("formatAnalysis includes all sections", () => {
	const analysis: FusionAnalysis = {
		consensus: ["agreed"],
		contradictions: [{ topic: "t", stances: [{ model: "a/m", stance: "yes" }] }],
		partial_coverage: [{ models: ["a/m"], point: "p" }],
		unique_insights: [{ model: "a/m", insight: "i" }],
		blind_spots: ["missing"],
	};
	const text = formatAnalysis(analysis);
	for (const header of ["Consensus", "Contradictions", "Partial Coverage", "Unique Insights", "Blind Spots"]) {
		if (!text.includes(header)) throw new Error(`missing ${header}`);
	}
});

test("formatResult includes panel metadata", () => {
	const details: FusionDetails = {
		status: "ok",
		responses: [{ model: "a/m", content: "hello" }],
		failed_models: [],
		panel_models: ["a/m"],
		judge_model: "a/j",
	};
	const result = formatResult(undefined, [{ model: "a/m", provider: "a", id: "m", content: "hello" }], [], details);
	if (!result.includes("a/m")) throw new Error("missing panel model");
	if (!result.includes("a/j")) throw new Error("missing judge model");
});
