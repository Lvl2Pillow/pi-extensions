/**
 * question — ask the user a multiple-choice question via interactive select menu.
 *
 * - Inline dialog in execute(): no queue, no agent_settled steer messages.
 * - "Other" is automatically appended to choices, with dedup.
 * - executionMode "sequential" prevents batching with side-effect tools.
 * - Gated by ctx.hasUI — naturally unavailable to subagents (JSON mode).
 */

import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export interface QuestionDetails {
	question: string;
	answer?: string;
	cancelled: boolean;
	planModeDisengaged?: boolean;
}

// ── Pure helpers ───────────────────────────────────────────────

/**
 * Build the final options array: deduplicates and ensures "Other" is always present.
 */
export function buildOptions(options: string[]): string[] {
	const result = options.filter((opt, i) => options.indexOf(opt) === i);
	if (!result.includes("Other")) result.push("Other");
	return result;
}

/** Pure string content for renderCall — no theme/pi-tui deps. */
export function formatToolCall(question: string, options: string[]): string {
	let text = `question ${question}`;
	for (const opt of options) {
		text += `\n  • ${opt}`;
	}
	return text;
}

// ── Extension entry point ──────────────────────────────────────

export default async function (pi: ExtensionAPI): Promise<void> {
	// ── question tool (model-callable) ──
	pi.registerTool({
		name: "question",
		label: "Question",
		description:
			"Ask the user a multiple-choice question via an interactive select menu. " +
			"An 'Other' option is always included so the user can type free-form text.",
		promptSnippet:
			"Use `question` when you need the user to make a decision or provide custom input.",
		promptGuidelines: [
			"Call `question` when you need the user to make a decision from a set of options, or to provide custom free-form input.",
			"Pass a clear question and at least one option.",
			"An 'Other' option is automatically appended for free text input — do not add it yourself.",
			"Use `optionsMeta` with `clearPlanMode: true` on the approval option to disengage plan-mode (??) when the user approves.",
		],
		executionMode: "sequential",
		parameters: Type.Object({
			question: Type.String({
				description: "The question to ask the user.",
			}),
			options: Type.Array(Type.String(), {
				minItems: 1,
				description:
					"The multiple-choice options to present. Must include at least one option.",
			}),
			optionsMeta: Type.Optional(
				Type.Record(
					Type.String(),
					Type.Object({
						clearPlanMode: Type.Optional(Type.Boolean({
							description:
								"If true and user selects this option, plan-mode (??) is disengaged, " +
								"allowing edit/write tools on subsequent turns.",
						})),
					}),
					{ description: "Per-option metadata keyed by option label." },
				),
			),
		}),
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
			if (!ctx.hasUI) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Question requires interactive mode — cannot present without UI.",
						},
					],
					details: { question: params.question, cancelled: true } satisfies QuestionDetails,
				};
			}

			// Build display labels: append [clears plan-mode] for options with clearPlanMode
			const displayToOriginal = new Map<string, string>();
			const displayLabels = params.options.map((opt) => {
				const meta = params.optionsMeta?.[opt];
				const display = meta?.clearPlanMode ? `${opt} [clears plan-mode]` : opt;
				displayToOriginal.set(display, opt);
				return display;
			});

			const allOptions = buildOptions(displayLabels);

			// Ask notify extension to alert the user (bell if terminal unfocused)
			pi.events.emit("notify:alert");

			const selection = await ctx.ui.select(params.question, allOptions);

			if (selection === undefined) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Question dismissed by the user without an answer.",
						},
					],
					details: { question: params.question, cancelled: true } satisfies QuestionDetails,
				};
			}

			if (selection === "Other") {
				const freeText = await ctx.ui.input(params.question, "Type your answer…");

				if (freeText === undefined) {
					return {
						content: [
							{
								type: "text" as const,
								text: "Question dismissed by the user without an answer.",
							},
						],
						details: { question: params.question, cancelled: true } satisfies QuestionDetails,
					};
				}

				return {
					content: [{ type: "text" as const, text: freeText }],
					details: {
						question: params.question,
						answer: freeText,
						cancelled: false,
					} satisfies QuestionDetails,
				};
			}

			// Map display label back to original option for metadata lookup
			const original = displayToOriginal.get(selection) ?? selection;

			// Check if this option has plan-mode clearing metadata
			const clearPlanMode = params.optionsMeta?.[original]?.clearPlanMode === true;
			if (clearPlanMode) {
				pi.events.emit("plan-mode:disengage");
			}

			return {
				content: [{
					type: "text" as const,
					text: clearPlanMode
						? `${original} (plan-mode disengaged)`
						: original,
				}],
				details: {
					question: params.question,
					answer: original,
					cancelled: false,
					planModeDisengaged: clearPlanMode,
				} satisfies QuestionDetails,
			};
		},

		renderCall(args, theme) {
			const question = (args.question as string) || "";
			const rawOptions = args.options as string[] | undefined;
			const options = rawOptions ?? [];
			const content = formatToolCall(question, options);
			// Re-apply theme to the plain format
			const [_firstLine, ...rest] = content.split("\n");
			let text = theme.fg("toolTitle", theme.bold("question ")) + theme.fg("text", question);
			for (const line of rest) {
				text += "\n" + theme.fg("dim", line);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, options, theme) {
			const details = result.details as QuestionDetails | undefined;

			if (!details || details.cancelled) {
				let text = theme.fg("error", "✗ ");
				text += theme.fg("accent", details?.question ?? "Cancelled");
				return new Text(text, 0, 0);
			}

			let text = theme.fg("success", "✓ ");
			text += theme.fg("accent", details.answer ?? "");

			if (details.planModeDisengaged) {
				text += " " + theme.fg("warning", "🔓 plan-mode disengaged");
			}

			if (options.expanded) {
				text += "\n" + theme.fg("dim", `Q: ${details.question}`);
			}

			return new Text(text, 0, 0);
		},
	});
}
