/**
 * question — ask the user a multiple-choice question via interactive select menu.
 *
 * - Supports 1–4 parallel questions as stacked select panels in a TUI overlay.
 * - "Other" is automatically appended to choices, with dedup.
 * - executionMode "sequential" prevents batching with side-effect tools.
 * - Gated by ctx.hasUI — naturally unavailable to subagents (JSON mode).
 * - autoExpire: true auto-dismisses after 30s (cancelled on first input).
 * - Optional multiSelect per question (toggle options, confirm to finalize).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Box, Text } from "@earendil-works/pi-tui";
import type { QuestionInput, QuestionDetails, QuestionAnswer } from "./logic.ts";
import { AUTO_EXPIRE_SECONDS, formatToolCall, formatMultiToolCall, formatAnswer } from "./logic.ts";
import { MultiQuestionComponent } from "./component.ts";

// ── Extension entry point ──────────────────────────────────────

export default async function (pi: ExtensionAPI): Promise<void> {
	// ── question tool (model-callable) ──
	pi.registerTool({
		name: "question",
		label: "Question",
		description:
			"Ask the user one or more multiple-choice questions via an interactive select menu. " +
			"Pass up to 4 questions in the `questions` array to ask them all at once. " +
			"An 'Other' option is always included so the user can type free-form text. " +
			"Also known as AskUserQuestion or request_user_input in other contexts.",
		promptSnippet:
			"Use `question` (also called AskUserQuestion or request_user_input) when you need the user to make a decision or provide custom input. " +
			"Pass up to 4 questions in the `questions` array to ask them all at once.",
		promptGuidelines: [
			"Call `question` (also known as AskUserQuestion or request_user_input) when you need the user to make a decision from a set of options, or to provide custom free-form input.",
			"Pass up to 4 questions in the `questions` array to ask them all at once.",
			"Each question must have a clear question string and at least one option.",
			"An 'Other' option is automatically appended for free text input — do not add it yourself.",
			"Use `optionsMeta` with `clearPlanMode: true` on the approval option to disengage plan-mode (??) when the user approves.",
			"Use `multiSelect: true` on a question to allow the user to select multiple options (toggle with Space, confirm with Enter).",
			"Use `autoExpire: true` to auto-dismiss the questions after 30 seconds of inactivity — cancelled on first user input.",
		],
		executionMode: "sequential",
		parameters: Type.Object({
			questions: Type.Array(
				Type.Object({
					question: Type.String({ description: "The question to ask the user." }),
					options: Type.Array(Type.String(), {
						minItems: 1,
						description: "The multiple-choice options to present. Must include at least one option.",
					}),
					optionsMeta: Type.Optional(
						Type.Record(
							Type.String(),
							Type.Object({
								clearPlanMode: Type.Optional(
									Type.Boolean({
										description:
											"If true and user selects this option, plan-mode (??) is disengaged, " +
											"allowing edit/write tools on subsequent turns.",
									}),
								),
							}),
							{ description: "Per-option metadata keyed by option label." },
						),
					),
					multiSelect: Type.Optional(
						Type.Boolean({
							description:
								"If true, user can select multiple options (toggle with Space, confirm with Enter). " +
								"Default is false (single selection).",
						}),
					),
				}),
				{
					minItems: 1,
					maxItems: 4,
					description: "1–4 questions to ask the user in parallel.",
				},
			),
			autoExpire: Type.Optional(
				Type.Boolean({
					default: false,
					description:
						"If true, auto-dismiss the questions after 30 seconds of inactivity. " +
						"Timer is cancelled as soon as user provides any input. " +
						"Default false.",
				}),
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
					details: (params.questions ?? []).map((q) => ({
						question: q.question,
						cancelled: true,
						planModeDisengaged: false,
					})) satisfies QuestionDetails[],
				};
			}

			const questions: QuestionInput[] = params.questions ?? [];
			const autoExpire = params.autoExpire === true;
			const timerSeconds = autoExpire ? AUTO_EXPIRE_SECONDS : 0;

			// ── Show stacked overlay (always, even for 1 question) ───────
			pi.events.emit("notify:alert", undefined);

			// Timer state
			let timerHandle: ReturnType<typeof setTimeout> | null = null;
			let timerCancelled = false;
			let customDoneRef: ((result: QuestionAnswer[] | undefined) => void) | null = null;

			// Create a promise that resolves when the UI is done
			let uiResolve: ((result: QuestionAnswer[] | undefined) => void) | null = null;
			const uiPromise = new Promise<QuestionAnswer[] | undefined>((resolve) => {
				uiResolve = resolve;
			});

			// Show the UI — factory runs synchronously, setting customDoneRef
			ctx.ui.custom<QuestionAnswer[] | undefined>(
				(_, theme, _kb, customDone) => {
					customDoneRef = customDone;

					const wrappedDone = (result: QuestionAnswer[] | undefined) => {
						// Cancel timer on completion
						if (timerHandle) {
							clearTimeout(timerHandle);
							timerHandle = null;
						}
						customDone(result);
						uiResolve?.(result);
					};

					const onFirstInput = () => {
						// Cancel timer on first user input
						if (timerHandle && !timerCancelled) {
							clearTimeout(timerHandle);
							timerHandle = null;
						}
					};

					const mqc = new MultiQuestionComponent(questions, wrappedDone, theme, onFirstInput, timerSeconds);
					// Use userMessageBg (dark gray) for overlay to stay distinct from
					// the blue toolPendingBg used for session-history tool calls
					const bgFn = (text: string) => theme.bg("customMessageBg", text);
					const box = new Box(0, 0, bgFn);
					box.addChild(mqc);
					return Object.assign(box, {
						handleInput: (data: string) => mqc.handleInput(data),
					});
				},
				{ overlay: true, overlayOptions: { width: "75%", maxHeight: "75%" } },
			);

			// Set up timer BEFORE awaiting UI promise (so timer can fire during dialog)
			if (timerSeconds && timerSeconds > 0) {
				timerHandle = setTimeout(() => {
					timerCancelled = true;
					timerHandle = null;
					// Close the overlay by calling customDone
					customDoneRef?.(undefined);
					uiResolve?.(undefined);
				}, timerSeconds * 1000);
			}

			// Wait for UI completion
			const rawAnswers = await uiPromise;

			if (rawAnswers === undefined) {
				const timedOut = timerCancelled;
				return {
					content: [{
						type: "text" as const,
						text: timedOut
							? "Questions timed out after 30s without user input."
							: "Questions dismissed by the user without an answer.",
					}],
					details: questions.map((q) => ({
						question: q.question,
						cancelled: true,
						planModeDisengaged: false,
						timedOut,
					})) satisfies QuestionDetails[],
				};
			}

			// Inline text-input handled "Other" within the overlay — no post-resolution needed.
			const details: QuestionDetails[] = [];
			let anyClearPlanMode = false;

			for (let i = 0; i < questions.length; i++) {
				const q = questions[i];
				const ans = rawAnswers[i];
				if (ans.clearPlanMode) anyClearPlanMode = true;
				details.push({
					question: q.question,
					answer: ans.answer,
					cancelled: false,
					planModeDisengaged: ans.clearPlanMode,
				});
			}

			if (anyClearPlanMode) pi.events.emit("plan-mode:disengage", undefined);

			const answeredText = details
				.map((d) => {
					if (d.cancelled) return `✗ ${d.question}`;
					const ans = formatAnswer(d.answer!);
					return `✓ ${ans}`;
				})
				.join("\n");

			return {
				content: [{ type: "text" as const, text: answeredText }],
				details,
			};
		},

		// ── renderers ────────────────────────────────────────────

		renderCall(args, theme) {
			const rawQuestions = args.questions as QuestionInput[] | undefined;
			const autoExpire = args.autoExpire;
			if (!rawQuestions || rawQuestions.length === 0) {
				return new Text("question (empty)", 0, 0);
			}

			if (rawQuestions.length === 1) {
				const q = rawQuestions[0];
				const content = formatToolCall(q.question, q.options ?? [], q.multiSelect);
				const [, ...rest] = content.split("\n");
				let text = theme.fg("toolTitle", theme.bold("question ")) + theme.fg("text", q.question);
				if (q.multiSelect) text += theme.fg("dim", " [multi-select]");
				for (const line of rest) {
					text += "\n" + theme.fg("dim", line);
				}
				if (autoExpire) text += "\n" + theme.fg("dim", "  ⏱ auto-expire (30s)");
				return new Text(text, 0, 0);
			}

			// Multiple questions
			const text = formatMultiToolCall(rawQuestions);
			const lines = text.split("\n");
			let result = "";
			for (const line of lines) {
				if (result) result += "\n";
				if (line.startsWith("Q")) {
					result += theme.fg("toolTitle", theme.bold(line));
				} else {
					result += theme.fg("dim", line);
				}
			}
			if (autoExpire) result += "\n" + theme.fg("dim", "⏱ auto-expire (30s)");
			return new Text(result, 0, 0);
		},

		renderResult(result, options, theme) {
			const details = result.details as QuestionDetails[] | undefined;

			if (!details || details.length === 0) {
				return new Text(theme.fg("error", "✗ Cancelled"), 0, 0);
			}

			if (details.length === 1) {
				// Single answer — existing compact format
				const d = details[0];
				if (d.cancelled) {
					const reason = d.timedOut ? " (timed out)" : "";
					return new Text(theme.fg("error", "✗ ") + theme.fg("accent", d.question) + theme.fg("dim", reason), 0, 0);
				}
				const ans = formatAnswer(d.answer!);
				let text = theme.fg("success", "✓ ") + theme.fg("accent", ans);
				if (d.planModeDisengaged) text += " " + theme.fg("warning", "🔓 plan-mode disengaged");
				if (options.expanded) text += "\n" + theme.fg("dim", `Q: ${d.question}`);
				return new Text(text, 0, 0);
			}

			return new Text(
				details
					.map((d) => {
						if (d.cancelled) {
							const reason = d.timedOut ? " (timed out)" : "";
							return theme.fg("error", "✗ ") + theme.fg("accent", d.question) + theme.fg("dim", reason);
						}
						const ans = formatAnswer(d.answer!);
						let line = theme.fg("success", "✓ ") + theme.fg("accent", ans)
							+ (d.planModeDisengaged ? " " + theme.fg("warning", "🔓") : "");
						if (options.expanded) line += "\n" + theme.fg("dim", `  Q: ${d.question}`);
						return line;
					})
					.join("\n"),
				0, 0,
			);
		},
	});
}
