/**
 * Native pi TUI components for pi-fusion.
 *
 * Single unified model setup flow.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getSelectListTheme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	Input,
	Key,
	matchesKey,
	type SelectItem,
	SelectList,
	Text,
} from "@earendil-works/pi-tui";
import { modelDisplay } from "./models.ts";
import type { Api, Model } from "./types.ts";

interface ModelInfo {
	id: string;
	identifier: string;
	provider: string;
	name: string;
}

export type FusionMode = "available" | "forced" | "off";

export interface FusionSetupState {
	selectedIds: Set<string>;
	judgeId: string | undefined;
	/** Legacy boolean: true => forced, false/undefined => available. */
	enabled?: boolean;
	mode?: FusionMode;
}

function toModelInfo(available: Model<Api>[]): ModelInfo[] {
	return available.map((m) => ({
		id: m.id,
		identifier: modelDisplay(m),
		provider: m.provider,
		name: m.name,
	}));
}

function makeSelectItems(
	models: ModelInfo[],
	selectedIds: Set<string>,
	judgeId: string | undefined,
): SelectItem[] {
	return models.map((m) => {
		const isPanel = selectedIds.has(m.identifier);
		const isJudge = judgeId === m.identifier;
		let label = m.identifier;
		const badges: string[] = [];
		if (isPanel) badges.push("panel");
		if (isJudge) badges.push("judge");
		if (badges.length > 0) label += ` [${badges.join("+")}]`;
		return {
			value: m.identifier,
			label,
			description: `${m.provider} • ${m.name}`,
		};
	});
}

function filterModels(models: ModelInfo[], query: string): ModelInfo[] {
	const trimmed = query.trim().toLowerCase();
	if (!trimmed) return models;
	return models.filter(
		(m) =>
			m.identifier.toLowerCase().includes(trimmed) ||
			m.name.toLowerCase().includes(trimmed) ||
			m.provider.toLowerCase().includes(trimmed),
	);
}

function statusForState(state: FusionSetupState): string {
	const panel = Array.from(state.selectedIds);
	if (panel.length === 0) return "No panel selected";
	const judge = state.judgeId && state.selectedIds.has(state.judgeId) ? state.judgeId : "auto";
	return `${panel.length} panel model${panel.length === 1 ? "" : "s"}, judge: ${judge}`;
}

/**
 * Unified fusion setup UI.
 *
 * Controls:
 *   - type to search (search box is focused by default)
 *   - Tab switches between search box and list
 *   - ↑/↓ navigate the list (also works from search; it shifts focus to list)
 *   - p toggles panel membership
 *   - j sets/cycles judge (or removes judge if already set on this model)
 *   - c clears all selections
 *   - Enter confirms selection and returns state
 *   - Esc cancels (returns null)
 */
export async function selectFusionSetup(
	ctx: ExtensionContext,
	available: Model<Api>[],
	initial: FusionSetupState,
): Promise<FusionSetupState | null> {
	if (!ctx.hasUI) return null;

	const models = toModelInfo(available);
	const state: FusionSetupState = {
		selectedIds: new Set(initial.selectedIds),
		judgeId: initial.judgeId,
		enabled: initial.enabled ?? false,
	};

	return ctx.ui.custom<FusionSetupState | null>((tui, theme, _kb, done) => {
		let query = "";
		let searchFocused = true;
		let lastToggledIdentifier: string | undefined;

		const container = new Container();
		container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
		container.addChild(new Text(theme.fg("accent", theme.bold("Fusion Setup"))));
		container.addChild(new Text(theme.fg("dim", "Configure the panel and judge for fusion.")));

		const statusLine = new Text(theme.fg("dim", statusForState(state)));
		const hint = new Text(
			theme.fg(
				"dim",
				"Type search • Tab search/list • p panel • j judge • c clear • Enter confirm • Esc cancel",
			),
		);
		container.addChild(statusLine);
		container.addChild(hint);

		const searchInput = new Input();
		searchInput.setValue(query);
		searchInput.onSubmit = () => {
			searchFocused = false;
			tui.requestRender();
		};
		container.addChild(searchInput);

		const handleSearchInput = (data: string) => {
			const before = searchInput.getValue();
			searchInput.handleInput(data);
			const after = searchInput.getValue();
			if (after !== before) {
				query = after;
				lastToggledIdentifier = undefined;
				refreshList();
			}
		};

		const filteredModels = () => filterModels(models, query);
		const allItems = () => makeSelectItems(filteredModels(), state.selectedIds, state.judgeId);

		const selectList = new SelectList(allItems(), Math.min(models.length, 12), getSelectListTheme());

		function refreshList() {
			const items = allItems();
			(selectList as any).items = items;
			(selectList as any).filteredItems = [...items];
			let idx = 0;
			if (lastToggledIdentifier) {
				const found = items.findIndex((i) => i.value === lastToggledIdentifier);
				if (found >= 0) idx = found;
			}
			(selectList as any).selectedIndex = idx;
			statusLine.setText(theme.fg("dim", statusForState(state)));
			selectList.invalidate();
			tui.requestRender();
		}

		function togglePanel(value: string) {
			lastToggledIdentifier = value;
			if (state.selectedIds.has(value)) {
				state.selectedIds.delete(value);
				if (state.judgeId === value) state.judgeId = undefined;
			} else {
				if (state.selectedIds.size >= 8) {
					hint.setText(theme.fg("warning", "Panel can have at most 8 models (press c to clear)."));
					tui.requestRender();
					return;
				}
				state.selectedIds.add(value);
				if (!state.judgeId) state.judgeId = value;
			}
			refreshList();
		}

		function toggleJudge(value: string) {
			lastToggledIdentifier = value;
			if (state.judgeId === value) {
				state.judgeId = undefined;
				refreshList();
				return;
			}
			if (!state.selectedIds.has(value)) {
				if (state.selectedIds.size >= 8) {
					hint.setText(theme.fg("warning", "Panel full. Press c to clear or remove a model first."));
					tui.requestRender();
					return;
				}
				state.selectedIds.add(value);
			}
			state.judgeId = value;
			refreshList();
		}

		function clearAll() {
			state.selectedIds.clear();
			state.judgeId = undefined;
			lastToggledIdentifier = undefined;
			hint.setText(theme.fg("dim", "Selections cleared."));
			refreshList();
		}

		function confirm() {
			if (state.selectedIds.size === 0) {
				hint.setText(theme.fg("warning", "Select at least one panel model first (press p on a model)."));
				tui.requestRender();
				return;
			}
			if (!state.judgeId || !state.selectedIds.has(state.judgeId)) {
				state.judgeId = Array.from(state.selectedIds)[0];
			}
			done({ selectedIds: new Set(state.selectedIds), judgeId: state.judgeId, enabled: state.enabled });
		}

		selectList.onSelect = () => {
			const item = selectList.getSelectedItem();
			if (item?.value) togglePanel(item.value);
		};
		selectList.onCancel = () => done(null);

		container.addChild(selectList);
		container.addChild(hint);
		container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

		const originalListHandleInput = (selectList as any).handleInput.bind(selectList);
		return {
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				if (matchesKey(data, Key.escape)) {
					done(null);
					return;
				}

				if (matchesKey(data, Key.tab)) {
					searchFocused = !searchFocused;
					tui.requestRender();
					return;
				}

				if (searchFocused) {
					if (matchesKey(data, Key.down) || matchesKey(data, Key.up)) {
						searchFocused = false;
						originalListHandleInput(data);
						return;
					}
					handleSearchInput(data);
					return;
				}

				if (matchesKey(data, Key.space) || data === "p") {
					const selected = selectList.getSelectedItem();
					if (selected) {
						lastToggledIdentifier = selected.value;
						selectList.onSelect?.(selected);
					}
					return;
				}

				if (data === "j") {
					const item = selectList.getSelectedItem();
					if (item?.value) toggleJudge(item.value);
					return;
				}

				if (data === "c") {
					clearAll();
					return;
				}

				if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
					confirm();
					return;
				}

				originalListHandleInput(data);
			},
		};
	});
}
