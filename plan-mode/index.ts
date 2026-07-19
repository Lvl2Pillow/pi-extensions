/**
 * plan-mode — blocks edit/write when user message starts with `??`
 * and prepends a plan-only reminder to the LLM context.
 */
import type { ExtensionAPI, ContextEvent, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";

/** Strip leading/trailing ?? and wrap with plan-mode marker. Pure. */
export function transformUserMessage(text: string): string {
	const stripped = text.trim().replace(/^\?\?/, "").replace(/\?\?$/, "");
	return "?? [plan-mode only]\n" + stripped.trim() + "\n";
}

export function detectPlanMode(messages: AgentMessage[]): boolean {
	const last = messages.at(-1);
	if (last?.role !== "user") return false;
	const text = typeof last.content === "string"
		? last.content
		: Array.isArray(last.content)
			? last.content.reduce((acc, block) => acc + (block.type === "text" ? block.text : ""), "")
			: "";
	const trimmed = text.trim();
	return trimmed.startsWith("??") || trimmed.endsWith("??");
}

export function isBlockedTool(toolName: string): boolean {
	return toolName === "edit" || toolName === "write";
}

let planOnly = false;

export default function (pi: ExtensionAPI) {
	pi.on("agent_start", () => { planOnly = false; });

	// Allow question tool to disengage plan-mode via cross-extension event
	pi.events.on("plan-mode:disengage", () => {
		planOnly = false;
	});

	// When plan mode is detected, strip the leading ?? and replace it
	// with a plan-mode marker for the LLM. Also set planOnly flag.
	pi.on("context", (event: ContextEvent) => {
		const msgs = event.messages;
		const last = msgs.at(-1);
		if (last?.role !== "user") return;
		if (!detectPlanMode(msgs)) return;

		planOnly = true;

		// Transform the user message: strip ??, prepend plan-mode marker.
		// content is string (direct input) or (TextContent | ImageContent)[] (steer/follow-up).
		if (typeof last.content === "string") {
			last.content = transformUserMessage(last.content);
		} else if (Array.isArray(last.content)) {
			// Narrow the union by type discriminant — preserve image blocks
			const textParts: string[] = [];
			const imageBlocks: ImageContent[] = [];
			for (const block of last.content) {
				if (block.type === "text") {
					textParts.push(block.text);
				} else {
					imageBlocks.push(block);
				}
			}
			last.content = [
				{ type: "text", text: transformUserMessage(textParts.join("")) },
				...imageBlocks,
			];
		}
		// else: unknown content type — leave unchanged

		return { messages: msgs };
	});

	pi.on("tool_call", (event: ToolCallEvent) => {
		if (!planOnly) return;
		if (event.toolName === "edit" || event.toolName === "write") {
			return {
				block: true,
				reason: `BLOCKED by plan-mode (??). Wait for user approval before making changes.`,
			} satisfies ToolCallEventResult;
		}
	});
}
