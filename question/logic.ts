/**
 * Pure types and functions for the question extension.
 * No runtime imports from pi packages — fully testable without pi runtime.
 */

import type { ThemeColor } from "@earendil-works/pi-coding-agent";

// ── Constants ──────────────────────────────────────────────────

export const OTHER_OPTION = "Other";
export const AUTO_EXPIRE_SECONDS = 30;

// ── Types ──────────────────────────────────────────────────────

export interface QuestionDetails {
	question: string;
	answer?: string | string[];
	cancelled: boolean;
	planModeDisengaged?: boolean;
	timedOut?: boolean;
}

export interface QuestionInput {
	question: string;
	options: string[];
	optionsMeta?: Record<string, { clearPlanMode?: boolean }>;
	multiSelect?: boolean;
}

export interface PanelState {
	question: string;
	options: string[];
	displayToOriginal: Map<string, string>;
	selectedIndex: number;
	answered: boolean;
	answer: string | string[];
	clearPlanMode: boolean;
	multiSelect: boolean;
	selectedIndices: Set<number>;
}

export interface QuestionAnswer {
	answer: string | string[];
	clearPlanMode: boolean;
}

export interface OptionMarker {
	marker: string;
	fg: ThemeColor;
}

// ── Pure helpers ───────────────────────────────────────────────

/**
 * Build the final options array: deduplicates and ensures "Other" is always present.
 */
export function buildOptions(options: string[]): string[] {
	const result = options.filter((opt, i) => options.indexOf(opt) === i);
	if (!result.includes(OTHER_OPTION)) result.push(OTHER_OPTION);
	return result;
}

/** Pure string content for renderCall — single question. */
export function formatToolCall(question: string, options: string[], multiSelect?: boolean): string {
	let text = `question ${question}`;
	if (multiSelect) text += " (multi-select)";
	for (const opt of options) {
		text += `\n  • ${opt}`;
	}
	return text;
}

/** Pure string content for renderCall — multiple questions. */
export function formatMultiToolCall(questions: QuestionInput[]): string {
	return questions
		.map((q, i) => {
			const lines = [`Q${i + 1}: ${q.question}${q.multiSelect ? " (multi-select)" : ""}`];
			for (const opt of q.options) {
				lines.push(`  • ${opt}`);
			}
			return lines.join("\n");
		})
		.join("\n\n");
}

// ── Pure state helpers (testable without TUI) ────────────────

/** Compute the next active panel index with wrap-around. */
export function computeNextPanelIndex(
	current: number,
	count: number,
	direction: 1 | -1,
): number {
	return (current + direction + count) % count;
}

/** Header marker character for a panel. */
export function getHeaderMarker(isActive: boolean, answered: boolean): string {
	if (isActive) return "●";
	if (answered) return "✓";
	return " ";
}

/** Header colour for a panel. */
export function getHeaderColor(isActive: boolean, answered: boolean): ThemeColor {
	if (isActive) return "accent";
	if (answered) return "success";
	return "dim";
}

/** Option marker and colour for one option row (single-select mode). */
export function getOptionMarker(
	isActive: boolean,
	answered: boolean,
	isSelected: boolean,
): OptionMarker {
	if (isActive && isSelected) return { marker: "→", fg: "accent" };
	if (answered && isSelected) return { marker: "✓", fg: "success" };
	return { marker: " ", fg: answered ? "dim" : "text" };
}

/** Option marker and colour for one option row (multi-select mode). */
export function getMultiOptionMarker(
	isFocused: boolean,
	answered: boolean,
	isSelected: boolean,
): OptionMarker {
	if (answered && isSelected) return { marker: "✓", fg: "success" };
	if (isFocused && isSelected) return { marker: "●", fg: "accent" };
	if (isFocused) return { marker: "○", fg: "accent" };
	if (isSelected) return { marker: "●", fg: "text" };
	return { marker: " ", fg: answered ? "dim" : "dim" };
}

/**
 * Commit a panel's current selection: mark answered, store answer.
 * Returns a new PanelState (immutable-style for testing).
 */
export function commitPanelState(
	panel: PanelState,
	optionsMeta?: Record<string, { clearPlanMode?: boolean }>,
): PanelState {
	if (panel.multiSelect) {
		// Multi-select: collect all selected originals
		const selectedAnswers: string[] = [];
		let clearPlanMode = false;
		for (const idx of panel.selectedIndices) {
			const display = panel.options[idx];
			const original = panel.displayToOriginal.get(display) ?? display;
			selectedAnswers.push(original);
			const meta = optionsMeta?.[original];
			if (meta?.clearPlanMode) clearPlanMode = true;
		}
		return {
			...panel,
			answer: selectedAnswers,
			clearPlanMode,
			answered: true,
		};
	}

	// Single-select
	const selected = panel.options[panel.selectedIndex];
	const original = panel.displayToOriginal.get(selected) ?? selected;
	const meta = optionsMeta?.[original];
	return {
		...panel,
		answer: original,
		clearPlanMode: meta?.clearPlanMode === true,
		answered: true,
	};
}

/** Check if all panels are answered. */
export function allPanelsAnswered(panels: PanelState[]): boolean {
	return panels.every((p) => p.answered);
}

/** Format answer for display (handles both single and multi-select). */
export function formatAnswer(answer: string | string[]): string {
	if (Array.isArray(answer)) {
		return answer.length > 0 ? answer.join(", ") : "(none)";
	}
	return answer;
}

/** Format timer display string. */
export function formatTimerDisplay(timeRemaining: number): string {
	if (timeRemaining <= 0) return "";
	return `⏱ ${timeRemaining}s remaining`;
}

/** Get timer color based on remaining time. */
export function getTimerColor(timeRemaining: number): ThemeColor {
	return timeRemaining <= 3 ? "error" : "warning";
}
