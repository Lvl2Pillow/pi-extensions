/**
 * notify — Central notification extension.
 *
 * Tracks terminal focus via DECSET 1004. When other extensions emit
 * `notify:alert`, checks focus and rings the terminal bell if the
 * user is away. Also auto-notifies on `agent_settled` when the
 * terminal is unfocused (one-shot per input cycle).
 *
 * Events:
 *   Listen: notify:alert — ring bell if terminal unfocused
 *
 * Only fires in TUI mode (not subagents). One-shot per input cycle to
 * avoid double-firing when other extensions (e.g. `remember`) trigger
 * additional agent runs after `agent_settled`.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { startFocusTracking, stopFocusTracking, isTerminalFocused } from "./focus.ts";
import { playBell } from "./notify.ts";

export default function (pi: ExtensionAPI): void {
  let playedThisInput = false;

  // ── Focus tracking lifecycle ─────────────────────────────────

  pi.on("session_start", () => {
    startFocusTracking();
  });

  pi.on("session_shutdown", () => {
    stopFocusTracking();
  });

  pi.on("input", () => {
    playedThisInput = false;
  });

  // ── Cross-extension notification API ─────────────────────────

  pi.events.on("notify:alert", () => {
    if (isTerminalFocused()) return;
    playBell();
  });

  // ── Auto-notify on agent settled ─────────────────────────────

  pi.on("agent_settled", (_event, ctx: ExtensionContext) => {
    if (ctx.mode !== "tui") return;

    if (playedThisInput) {
      return;
    }

    if (isTerminalFocused()) {
      return;
    }

    playedThisInput = true;
    playBell();
  });
}
