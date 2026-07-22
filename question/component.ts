/**
 * MultiQuestionComponent — TUI component for stacked question panels.
 *
 * Imports from @earendil-works/pi-tui for UI rendering and
 * type-only imports from @earendil-works/pi-coding-agent.
 */

import { Box, Container, getKeybindings, Spacer, Text } from "@earendil-works/pi-tui";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { PanelState, QuestionInput, QuestionAnswer } from "./logic.ts";
import {
	OTHER_OPTION,
	buildOptions,
	commitPanelState,
	formatTimerDisplay,
	getTimerColor,
	allPanelsAnswered,
	computeNextPanelIndex,
	getHeaderMarker,
	getHeaderColor,
	getOptionMarker,
	getMultiOptionMarker,
} from "./logic.ts";

/**
 * TUI component that renders 1–4 select panels stacked vertically.
 *
 * Keyboard:
 *   ↑/↓ (or j/k)  — move within the active panel
 *   Tab / ⇧Tab    — switch to the next/previous unanswered panel
 *   Enter          — confirm selection for the active panel
 *   Space          — toggle selection (multi-select mode only)
 *   Escape         — cancel all questions
 *
 * When all panels have a confirmed selection the `done` callback is
 * invoked with an array of answers.  On cancel it is invoked with
 * `undefined`.
 *
 * The component is designed for use with `ctx.ui.custom({ overlay: true })`.
 */
export class MultiQuestionComponent extends Container {
	private panels: PanelState[];
	private activePanel: number;
	private textInputPanelIndex: number | null = null;
	private textInputBuffer: string = "";
	private done: (result: QuestionAnswer[] | undefined) => void;
	private themeObj: Theme;
	private optionsMeta: (Record<string, { clearPlanMode?: boolean }> | undefined)[];
	private inputDetected: boolean = false;
	private onFirstInput?: () => void;
	private timeRemaining: number;
	private timerInterval: ReturnType<typeof setInterval> | null = null;

	constructor(
		questions: QuestionInput[],
		done: (result: QuestionAnswer[] | undefined) => void,
		theme: Theme,
		onFirstInput?: () => void,
		timerSeconds?: number,
	) {
		super();
		this.done = done;
		this.themeObj = theme;
		this.onFirstInput = onFirstInput;
		this.timeRemaining = timerSeconds ?? 0;

		this.optionsMeta = questions.map((q) => q.optionsMeta);

		this.panels = questions.map((q) => {
			const displayToOriginal = new Map<string, string>();
			const displayLabels = (q.options ?? []).map((opt) => {
				const meta = q.optionsMeta?.[opt];
				const display = meta?.clearPlanMode ? `${opt} [clears plan-mode]` : opt;
				displayToOriginal.set(display, opt);
				return display;
			});
			const allOptions = buildOptions(displayLabels);

			return {
				question: q.question,
				options: allOptions,
				displayToOriginal,
				selectedIndex: 0,
				answered: false,
				answer: q.multiSelect ? [] : "",
				clearPlanMode: false,
				multiSelect: q.multiSelect === true,
				selectedIndices: new Set<number>(),
			};
		});

		this.activePanel = 0;

		// Start countdown timer if specified
		if (timerSeconds && timerSeconds > 0) {
			this.timerInterval = setInterval(() => {
				this.timeRemaining--;
				this.buildLayout();
				if (this.timeRemaining <= 0) {
					this.stopTimer();
				}
			}, 1000);
		}

		this.buildLayout();
	}

	// ── helpers ──────────────────────────────────────────────

	private t(color: ThemeColor, text: string): string {
		return this.themeObj.fg(color, text);
	}

	private notifyFirstInput(): void {
		if (!this.inputDetected) {
			this.inputDetected = true;
			this.onFirstInput?.();
			// Stop countdown on first input
			this.stopTimer();
		}
	}

	private stopTimer(): void {
		if (this.timerInterval) {
			clearInterval(this.timerInterval);
			this.timerInterval = null;
		}
	}

	// ── layout ───────────────────────────────────────────────

	private buildLayout(): void {
		this.clear();

		this.addChild(new Spacer(1));

		// Timer display at top
		const timerText = formatTimerDisplay(this.timeRemaining);
		if (timerText) {
			const timerColor = getTimerColor(this.timeRemaining);
			this.addChild(new Text(
				` ${this.t(timerColor, timerText)}`,
				1, 0,
			));
			this.addChild(new Spacer(1));
		}

		for (let i = 0; i < this.panels.length; i++) {
			const panel = this.panels[i];
			const isActive = i === this.activePanel;

			// ── header ────────────────────────────────────
			const headMark = getHeaderMarker(isActive, panel.answered);
			const headColor = getHeaderColor(isActive, panel.answered);
			const multiTag = panel.multiSelect ? " [multi]" : "";
			this.addChild(new Text(` ${this.t(headColor, this.themeObj.bold(`${headMark} ${panel.question}${multiTag}`))}`, 1, 0));

			// Show options — "Other" shows inline input when editing
			this.addChild(new Spacer(1));
			const inTextMode = this.textInputPanelIndex === i;
			for (let j = 0; j < panel.options.length; j++) {
				const opt = panel.options[j];
				const isUnderCursor = j === panel.selectedIndex;

				let marker: string;
				let fg: ThemeColor;

				if (panel.multiSelect) {
					const isSelected = panel.selectedIndices.has(j);
					const markerObj = getMultiOptionMarker(isUnderCursor, panel.answered, isSelected);
					marker = markerObj.marker;
					fg = markerObj.fg;
				} else {
					// On inactive answered panels, checkmark follows actual answer, not cursor
					const answeredOptionMatch = panel.answered && !isActive
						? (opt === panel.answer || (opt === OTHER_OPTION && !panel.options.includes(panel.answer as string)))
						: isUnderCursor;
					const markerObj = getOptionMarker(isActive, panel.answered, answeredOptionMatch);
					marker = markerObj.marker;
					fg = markerObj.fg;
				}

				let displayText: string;
				let effectiveFg = fg;
				if (inTextMode && isUnderCursor && opt === OTHER_OPTION) {
					// Show input buffer with cursor
					displayText = `${OTHER_OPTION}: ${this.textInputBuffer}|`;
				} else if (panel.answered && panel.multiSelect) {
					// Multi-select answered: show selected state
					const isSelected = panel.selectedIndices.has(j);
					displayText = isSelected ? `${opt} ✓` : opt;
				} else if (!panel.multiSelect && panel.answered && (panel.answer as string) === opt && opt === OTHER_OPTION && !panel.options.includes(panel.answer as string)) {
					// Show "Other: <answer>" after commit (answer was custom-typed, not a normal selection)
					displayText = `${OTHER_OPTION}: ${panel.answer}`;
				} else if (isActive && isUnderCursor && opt === OTHER_OPTION && !panel.multiSelect) {
					// Placeholder hint when focused on "Other" (also when re-editing)
					displayText = "Input your own answer:    ↵ enter    Esc cancel";
					effectiveFg = "dim";
				} else {
					displayText = opt;
				}

				this.addChild(new Text(
					` ${marker} ${this.t(effectiveFg, displayText)}`,
					1, 0,
				));
			}

			// Show lock indicator for answered panels that disengaged plan-mode
			if (panel.answered && panel.clearPlanMode) {
				this.addChild(new Text(`    ${this.t("warning", "🔓 plan-mode disengaged")}`, 1, 0));
			}

			// ── separator ──────────────────────────────────
			if (i < this.panels.length - 1) {
				this.addChild(new Spacer(1));
				this.addChild(new Text(` ${this.t("dim", "─".repeat(50))}`, 1, 0));
				this.addChild(new Spacer(1));
			}
		}

		this.addChild(new Spacer(1));

		let hint: string;
		if (this.textInputPanelIndex !== null) {
			hint = "type and    ↵ confirm    Esc cancel";
		} else {
			hint = "↑↓ navigate    ⎵ select    ↵ confirm    Tab switch    Esc cancel";
		}
		this.addChild(new Text(
			` ${this.t("dim", hint)}`,
			1, 0,
		));
		this.addChild(new Spacer(1));
	}

	// ── input ───────────────────────────────────────────────

	handleInput(keyData: string): void {
		this.notifyFirstInput();

		// If in text-input mode, handle input directly
		if (this.textInputPanelIndex !== null) {
			if (keyData === "\n" || keyData === "\r") {
				// Enter — commit with typed text
				if (this.textInputBuffer) {
					const panel = this.panels[this.textInputPanelIndex];
					panel.answer = this.textInputBuffer;
					panel.answered = true;
					panel.clearPlanMode = false;
					this.textInputPanelIndex = null;
					this.textInputBuffer = "";
					if (allPanelsAnswered(this.panels)) {
						this.done(
							this.panels.map((p) => ({
								answer: p.answer,
								clearPlanMode: p.clearPlanMode,
							})),
						);
					} else {
						this.moveToNextPanel(1);
					}
				}
			} else if (keyData === "\u001b") {
				// Escape — cancel text input
				this.textInputPanelIndex = null;
				this.textInputBuffer = "";
				this.buildLayout();
			} else if (keyData === "\x7f" || keyData === "\b") {
				// Backspace
				this.textInputBuffer = this.textInputBuffer.slice(0, -1);
				this.buildLayout();
			} else if (keyData === "\t") {
				// Tab — ignored in text-input mode
			} else {
				// Printable characters — append if not a control char
				const hasControl = [...keyData].some((ch) => {
					const code = ch.charCodeAt(0);
					return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
				});
				if (!hasControl) {
					this.textInputBuffer += keyData;
					this.buildLayout();
				}
			}
			return;
		}

		const panel = this.panels[this.activePanel];
		if (!panel) return;

		const kb = getKeybindings();

		if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
			panel.selectedIndex = Math.max(0, panel.selectedIndex - 1);
			this.buildLayout();
		} else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
			panel.selectedIndex = Math.min(panel.options.length - 1, panel.selectedIndex + 1);
			this.buildLayout();
		} else if (keyData === " " && !panel.answered) {
			if (panel.multiSelect) {
				// Space — toggle selection in multi-select mode
				this.toggleMultiSelect(panel);
			} else {
				// Space — confirm selection in single-select mode (same as Enter)
				this.commitAndMaybeSubmit(panel);
			}
		} else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n") {
			if (panel.multiSelect && !panel.answered) {
				// Multi-select: Enter confirms the selection
				this.commitAndMaybeSubmit(panel);
			} else if (!panel.multiSelect) {
				// Single-select: Check if "Other" is selected — enter text-input mode
				const selected = panel.options[panel.selectedIndex];
				const original = panel.displayToOriginal.get(selected) ?? selected;
				if (original === OTHER_OPTION) {
					this.enterTextInputMode(this.activePanel);
				} else {
					this.commitAndMaybeSubmit(panel);
				}
			}
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.done(undefined);
		} else if (keyData === "\t") {
			this.moveToNextPanel(1);
		} else if (keyData === "\u001b[Z") {
			this.moveToNextPanel(-1);
		}
	}

	/** Toggle option in multi-select mode. */
	private toggleMultiSelect(panel: PanelState): void {
		const idx = panel.selectedIndex;
		// Don't allow toggling "Other" in multi-select
		const display = panel.options[idx];
		const original = panel.displayToOriginal.get(display) ?? display;
		if (original === OTHER_OPTION) return;

		if (panel.selectedIndices.has(idx)) {
			panel.selectedIndices.delete(idx);
		} else {
			panel.selectedIndices.add(idx);
		}
		this.buildLayout();
	}

	/** Enter text-input mode for the panel at the given index (user picked "Other"). */
	private enterTextInputMode(panelIndex: number): void {
		const panel = this.panels[panelIndex];
		this.textInputPanelIndex = panelIndex;
		// Pre-fill buffer when re-editing a previous "Other" answer
		if (panel.answered && !panel.options.includes(panel.answer as string)) {
			this.textInputBuffer = panel.answer as string;
		} else {
			this.textInputBuffer = "";
		}
		this.buildLayout();
	}

	/** Commit the current selection (mark panel answered) without submitting. */
	private commitPanel(panel: PanelState): void {
		const idx = this.panels.indexOf(panel);
		const updated = commitPanelState(panel, this.optionsMeta[idx]);
		this.panels[idx] = updated;
		this.buildLayout();
	}

	/** Commit, move to next panel, then submit if all answered. */
	private commitAndMaybeSubmit(panel: PanelState): void {
		this.commitPanel(panel);
		this.moveToNextPanel(1);
		if (allPanelsAnswered(this.panels)) {
			this.done(
				this.panels.map((p) => ({
					answer: p.answer,
					clearPlanMode: p.clearPlanMode,
				})),
			);
		}
	}

	private moveToNextPanel(direction: 1 | -1): void {
		this.activePanel = computeNextPanelIndex(this.activePanel, this.panels.length, direction);
		this.buildLayout();
	}
}
