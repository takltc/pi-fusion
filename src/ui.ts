/**
 * Interactive UI helpers for pi-fusion.
 *
 * Uses pi's built-in SelectList plus a search Input for model selection.
 * Keys:
 *   - type to search
 *   - space toggles panel membership
 *   - j sets the selected model as judge
 *   - enter confirms
 *   - esc cancels
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getSelectListTheme } from "@earendil-works/pi-coding-agent";
import { Container, Input, Key, matchesKey, Text, type SelectItem, SelectList } from "@earendil-works/pi-tui";
import type { Api, Model } from "./types.ts";
import { modelDisplay } from "./models.ts";

interface ModelInfo {
	id: string;
	identifier: string;
	provider: string;
	name: string;
}

interface ModelSelectState {
	selectedIds: Set<string>;
	judgeId: string | undefined;
}

function makeItems(
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

export async function selectPanelAndJudge(
	ctx: ExtensionContext,
	available: Model<Api>[],
	initialSelectedIds: Set<string>,
	initialJudgeId: string | undefined,
): Promise<{ selectedIds: Set<string>; judgeId: string | undefined } | null> {
	if (!ctx.hasUI) return null;

	const models: ModelInfo[] = available.map((m) => ({
		id: m.id,
		identifier: modelDisplay(m),
		provider: m.provider,
		name: m.name,
	}));

	const state: ModelSelectState = {
		selectedIds: new Set(initialSelectedIds),
		judgeId: initialJudgeId,
	};

	const result = await ctx.ui.custom<{ selectedIds: Set<string>; judgeId: string | undefined } | null>(
		(tui, theme, _kb, done) => {
			let query = "";
			let searchFocused = false;
			let selectedIdentifier: string | undefined;

			const container = new Container();
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Configure Fusion Panel"))));

			const hint = new Text(
				theme.fg("dim", "Type to search. Space toggles panel, j sets judge, Enter confirms, Esc cancels. ↑↓ moves list."),
			);
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
					selectedIdentifier = undefined;
					refreshList();
				}
			};

			const filteredModels = () => filterModels(models, query);
			const allItems = () => makeItems(filteredModels(), state.selectedIds, state.judgeId);
			const itemIndex = (identifier: string) => allItems().findIndex((i) => i.value === identifier);

			const selectList = new SelectList(
				allItems(),
				Math.min(models.length, 10),
				getSelectListTheme(),
			);

			function refreshList() {
				const items = allItems();
				(selectList as any).items = items;
				(selectList as any).filteredItems = [...items];
				const idx = selectedIdentifier ? itemIndex(selectedIdentifier) : 0;
				(selectList as any).selectedIndex = Math.max(0, idx);
				selectList.invalidate();
				tui.requestRender();
			}

			function togglePanel(value: string) {
				selectedIdentifier = value;
				if (state.selectedIds.has(value)) {
					state.selectedIds.delete(value);
					if (state.judgeId === value) state.judgeId = undefined;
				} else {
					if (state.selectedIds.size >= 8) {
						hint.setText(theme.fg("warning", "Panel can have at most 8 models."));
						tui.requestRender();
						return;
					}
					state.selectedIds.add(value);
					if (!state.judgeId) state.judgeId = value;
				}
				refreshList();
			}

			function setJudge(value: string) {
				selectedIdentifier = value;
				if (!state.selectedIds.has(value)) {
					if (state.selectedIds.size >= 8) {
						hint.setText(theme.fg("warning", "Panel is full. Remove a model before setting judge."));
						tui.requestRender();
						return;
					}
					state.selectedIds.add(value);
				}
				state.judgeId = value;
				refreshList();
			}

			function confirm() {
				if (state.selectedIds.size === 0) {
					hint.setText(theme.fg("warning", "Select at least one panel model first."));
					tui.requestRender();
					return;
				}
				if (!state.judgeId || !state.selectedIds.has(state.judgeId)) {
					state.judgeId = Array.from(state.selectedIds)[0];
				}
				done({ selectedIds: new Set(state.selectedIds), judgeId: state.judgeId });
			}

			selectList.onSelect = () => {
				const item = selectList.getSelectedItem();
				if (item?.value) togglePanel(item.value);
			};

			selectList.onCancel = () => done(null);

			container.addChild(selectList);
			container.addChild(
				new Text(theme.fg("dim", "Type filters • Space toggles • j sets judge • Enter confirms • Esc cancels")),
			);
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
						// Arrow down/up switches to list without needing Enter.
						if (matchesKey(data, Key.down) || matchesKey(data, Key.up)) {
							searchFocused = false;
							originalListHandleInput(data);
							return;
						}
						handleSearchInput(data);
						return;
					}

					// List focused.
					if (matchesKey(data, Key.space)) {
						const selected = selectList.getSelectedItem();
						if (selected) {
							selectedIdentifier = selected.value;
							selectList.onSelect?.(selected);
						}
						return;
					}

					if (data === "j") {
						const item = selectList.getSelectedItem();
						if (item?.value) setJudge(item.value);
						return;
					}

					if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
						confirm();
						return;
					}

					originalListHandleInput(data);
				},
			};
		},
	);

	return result;
}

export function renderConfigStatus(configText: string, warnings: string[], errors: string[]): string {
	const lines: string[] = [];
	lines.push(configText);
	if (errors.length > 0) {
		lines.push("\nErrors:");
		for (const e of errors) lines.push(`- ${e}`);
	}
	if (warnings.length > 0) {
		lines.push("\nWarnings:");
		for (const w of warnings) lines.push(`- ${w}`);
	}
	return lines.join("\n");
}
