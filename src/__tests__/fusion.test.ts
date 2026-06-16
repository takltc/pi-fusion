/**
 * Tests for pi-fusion pipeline helpers.
 */

import { emptyPanelError } from "../fusion.ts";
import { eq, test } from "./_harness.ts";

test("emptyPanelError treats non-empty content as success", () => {
	eq(emptyPanelError("a real answer", false), undefined, "normal");
	eq(emptyPanelError("a real answer", true), undefined, "non-empty even if capped");
});

test("emptyPanelError flags blank/whitespace output as a failure", () => {
	eq(emptyPanelError("", false), "empty response", "empty");
	eq(emptyPanelError("   \n\t ", false), "empty response", "whitespace only");
});

test("emptyPanelError attributes a capped empty to the loop guard/budget", () => {
	eq(emptyPanelError("", true), "no text answer (tool-call budget or loop guard hit)", "capped + empty");
});
