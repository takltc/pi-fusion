/**
 * Tests for pi-fusion setup picker selection helpers (independent panel + judge).
 */

import { modelBadges, togglePanelMember, toggleJudgeSelection } from "../ui.ts";
import { eq, test } from "./_harness.ts";

test("togglePanelMember adds and removes", () => {
	eq([...togglePanelMember(new Set<string>(), "a")], ["a"], "add");
	eq([...togglePanelMember(new Set(["a", "b"]), "a")], ["b"], "remove");
});

test("togglePanelMember respects the max (adding is a no-op at limit)", () => {
	const full = new Set(["1", "2", "3"]);
	eq([...togglePanelMember(full, "4", 3)], ["1", "2", "3"], "at limit, no add");
	eq([...togglePanelMember(full, "2", 3)], ["1", "3"], "removing still works at limit");
});

test("togglePanelMember returns a new set (does not mutate input)", () => {
	const ids = new Set(["a"]);
	const next = togglePanelMember(ids, "b");
	eq([...ids], ["a"], "input unchanged");
	eq([...next], ["a", "b"], "output has both");
});

test("toggleJudgeSelection sets and clears, independent of panel", () => {
	eq(toggleJudgeSelection(undefined, "b"), "b", "set judge");
	eq(toggleJudgeSelection("b", "b"), undefined, "clear when same");
	eq(toggleJudgeSelection("a", "b"), "b", "replace judge");
});

test("panel and judge are fully independent (the regression this fixes)", () => {
	// Pressing j on a model NOT in the panel sets judge WITHOUT adding to panel.
	const panel = new Set(["a"]);
	const judge = toggleJudgeSelection(undefined, "b");
	eq(judge, "b", "judge set to non-panel model");
	eq([...panel], ["a"], "panel untouched by judge toggle");

	// Pressing p does NOT change the judge.
	const judgeBefore = "b";
	const nextPanel = togglePanelMember(panel, "c");
	eq([...nextPanel], ["a", "c"], "panel toggled");
	eq(judgeBefore, "b", "judge untouched by panel toggle");
});

test("modelBadges reflects panel/judge state (right-column format)", () => {
	eq(modelBadges(false, false), "", "none");
	eq(modelBadges(true, false), "● panel", "panel only");
	eq(modelBadges(false, true), "◆ judge", "judge only");
	eq(modelBadges(true, true), "● panel  ◆ judge", "both");
});
