/**
 * /side-quest — Fork immediately at the current position.
 *
 * Unlike the built-in /fork (which prompts you to select a fork point),
 * /side-quest forks at the last message entry and drops you straight in.
 *
 * Use /return to navigate back to the parent session when done.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default async function (pi: ExtensionAPI): Promise<void> {
	pi.registerCommand("side-quest", {
		description: [
			"Fork off into a new session to explore a side quest without",
			"disturbing the main conversation.",
			"",
			"Unlike the built-in /fork (which prompts you to select a fork",
			"point), /side-quest forks immediately at the current position.",
			"The forked session inherits all context up to that point.",
			"",
			"Use /return to navigate back to the parent session when done.",
		].join("\n"),

		handler: async (_args: string, ctx): Promise<void> => {
			const entries = ctx.sessionManager.getEntries();

			// Find the last message entry to fork from
			let forkEntryId: string | undefined;
			for (let i = entries.length - 1; i >= 0; i--) {
				if (entries[i].type === "message") {
					forkEntryId = entries[i].id;
					break;
				}
			}

			if (!forkEntryId) {
				ctx.ui.notify("No message entry to fork from.", "error");
				return;
			}

			await ctx.fork(forkEntryId, { position: "at" });
		},
	});
}
