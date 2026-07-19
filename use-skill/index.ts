/**
 * Use Skill — blocks all tools until the agent reads a SKILL.md.
 *
 * The lock is set once per session. On the first agent run the agent
 * must read a skill before it can use any tool. The state is persisted
 * via CustomEntry so it survives /reload and session resume.
 *
 * Pure functions exported for testability.
 */

import type {
	CustomEntry,
	ExtensionAPI,
	ToolCallEvent,
	ToolCallEventResult,
	SessionEntry,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

// ── Constants ────────────────────────────────────────────────────

export const STATE_CUSTOM_TYPE = "use-skill-state";

// ── Pure logic (exported for testing) ───────────────────────────

/**
 * Check if a read target is a skill file.
 *
 * Matches pi's built-in classification: any file named SKILL.md.
 */
export function isSkillFile(path: string): boolean {
	return path.endsWith("SKILL.md");
}

/**
 * Determine whether a tool call should be blocked.
 *
 * @param skillRead Whether a skill has been read yet.
 * @returns `{ block: true, reason }` to block, `undefined` to allow.
 */
export function checkToolCall(
	skillRead: boolean,
): ToolCallEventResult | undefined {
	if (skillRead) return undefined;

	return {
		block: true,
		reason: "All tools LOCKED until read some relevant skills first.",
	};
}

/**
 * Restore skill-read state from session entries.
 *
 * Scans backward from the latest entry, stopping at compaction boundary.
 * Returns `true` if a saved state entry with `skillRead: true` is found.
 */
export function loadSkillRead(entries: SessionEntry[]): boolean {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "compaction") continue;
		if (entry.type === "custom" && entry.customType === STATE_CUSTOM_TYPE) {
			return (entry as CustomEntry<{ skillRead: boolean }>).data?.skillRead ?? false;
		}
	}
	return false;
}

// ── Extension factory ───────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
	let skillRead = false;

	pi.on("session_start", (_event: SessionStartEvent, ctx) => {
		// Restore persisted state so /reload and session resume don't lose it
		skillRead = loadSkillRead(ctx.sessionManager.getEntries());
	});

	pi.on("tool_call", (event: ToolCallEvent) => {
		if (skillRead) return;

		// Only `read` on a SKILL.md is allowed; everything else blocked
		if (event.toolName === "read") {
			const path = (event.input as { path?: string }).path ?? "";
			if (isSkillFile(path)) {
				skillRead = true;
				pi.appendEntry(STATE_CUSTOM_TYPE, { skillRead: true });
				return;
			}
		}

		return checkToolCall(false);
	});
}
