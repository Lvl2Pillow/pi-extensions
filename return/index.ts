/**
 * /return — Navigate back to the parent session from a forked session.
 *
 * Works with any extension that uses ctx.fork() internally:
 *   /side-quest, /remember, scout branches, etc.
 *
 * Usage:
 *   /return           Back to immediate parent
 *   /return root      Walk the full parent chain back to the root session
 *
 * /return root reads JSONL headers from disk to walk the chain
 * without loading each session into memory.
 */

import { readFileSync } from "node:fs";
import type { ExtensionAPI, SessionHeader } from "@earendil-works/pi-coding-agent";

export default async function (pi: ExtensionAPI): Promise<void> {
	pi.registerCommand("return", {
		description: [
			"Return to the parent session from a forked session.",
			"",
			"Usage:",
			"  /return           Back to immediate parent",
			"  /return root      Walk parent chain back to the root session",
		].join("\n"),

		handler: async (args: string, ctx): Promise<void> => {
			const arg = args.trim().toLowerCase();
			const walkToRoot = arg === "root" || arg === "home" || arg === "all";

			const header = ctx.sessionManager.getHeader();
			if (!header?.parentSession) {
				ctx.ui.notify("Not in a forked session.", "warning");
				return;
			}

			let targetSession: string;

			if (walkToRoot) {
				targetSession = walkParentChain(header.parentSession);
				if (targetSession === header.parentSession) {
					// Only one level deep
					await ctx.switchSession(targetSession);
					return;
				}
				ctx.ui.notify(
					`Returning to root session at ${targetSession}`,
					"info",
				);
			} else {
				targetSession = header.parentSession;
			}

			await ctx.switchSession(targetSession);
		},
	});
}

// ── Parent chain walker ───────────────────────────────────────

function walkParentChain(startPath: string): string {
	let currentPath = startPath;
	const visited = new Set<string>();
	visited.add(currentPath);

	for (let i = 0; i < 100; i++) {
		const parent = getParentSessionPath(currentPath);
		if (!parent) return currentPath;
		if (visited.has(parent)) return currentPath;
		visited.add(parent);
		currentPath = parent;
	}

	return currentPath;
}

function getParentSessionPath(sessionFilePath: string): string | null {
	try {
		const firstLine = readFileSync(sessionFilePath, "utf-8").split("\n")[0];
		if (!firstLine) return null;
		const header = JSON.parse(firstLine) as SessionHeader;
		return header.parentSession ?? null;
	} catch {
		return null;
	}
}
