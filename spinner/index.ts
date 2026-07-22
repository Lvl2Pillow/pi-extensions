/**
 * Spinner — appends a turn duration timer to pi's "Working..." spinner
 * and shows "Took Ns" as a persistent session message after the agent settles.
 *
 * The timer starts at user `input` and counts elapsed seconds until
 * `agent_settled`. It persists through compaction/retry cycles so the
 * displayed time reflects the total turn duration, not individual attempts.
 */

import type { ExtensionAPI, ExtensionUIContext, SessionStartEvent } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOOK_CUSTOM_TYPE = "spinner-took";
export const DEFAULT_MESSAGE = "Working...";

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Format elapsed seconds into "(Ns)" or "(Xm Ys)" for the spinner display. */
export function formatMessage(elapsed: number): string {
  if (elapsed < 60) {
    return `(${elapsed}s)`;
  }
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `(${minutes}m ${seconds}s)`;
}

/** Format a duration in milliseconds to "45s" or "1m 12s". */
export function formatDuration(totalMs: number): string {
  const totalSec = Math.floor(totalMs / 1000);
  if (totalSec < 60) {
    return `${totalSec}s`;
  }
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}m ${seconds}s`;
}

/** Compose the full "Took" line with muted styling. */
export function formatTookLine(theme: { fg: (color: string, text: string) => string }, totalMs: number): string {
  return theme.fg("muted", `Took ${formatDuration(totalMs)}`);
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _pi: ExtensionAPI | null = null;
let _ui: ExtensionUIContext | null = null;
let _startMs: number | null = null;
let _interval: ReturnType<typeof setInterval> | null = null;

/** Took Ns entry data + tree position, preserved across session boundaries. */
interface TookEntry {
  data: { text: string };
  entryId: string;
  parentId: string | null;
}
const _tookEntries: TookEntry[] = [];

function updateDisplay(): void {
  if (!_ui || _startMs === null) return;
  const elapsed = Math.floor((Date.now() - _startMs) / 1000);
  _ui.setWorkingMessage(`${DEFAULT_MESSAGE} ${formatMessage(elapsed)}`);
}

function startTimer(ui: ExtensionUIContext): void {
  if (_interval !== null) {
    // Timer already active (e.g. retry after compaction) — keep original
    // start time so the elapsed display is cumulative.
    updateDisplay();
    return;
  }
  _ui = ui;
  _startMs ??= Date.now(); // use existing value set by `input`
  updateDisplay();
  _interval = setInterval(updateDisplay, 1000);
}

function stopTimer(): void {
  if (_interval !== null) {
    clearInterval(_interval);
    _interval = null;
  }
  if (_ui) {
    _ui.setWorkingMessage(); // restore default
    _ui = null;
  }
}

/** Reset all module-level state (exported for testing). */
export function resetState(): void {
  stopTimer();
  _startMs = null;
  // Note: _pi is NOT cleared here — it is set once by the factory function
  // and must remain valid across session_start/session_shutdown cycles.
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default async function (pi: ExtensionAPI): Promise<void> {
  _pi = pi;

  // Lazy-import Text so the module can be loaded in tests without pi-tui
  // (pi's extension loader resolves the alias at runtime).
  const { Text } = await import("@earendil-works/pi-tui");

  // Register a custom entry renderer for the "Took" line with muted styling.
  // Custom entries are purely visual — they are NOT sent to the LLM.
  pi.registerEntryRenderer(TOOK_CUSTOM_TYPE, (entry, _options, theme) => {
    const text = (entry.data as { text?: string })?.text ?? "";
    return new Text(theme.fg("muted", text), 1, 0);
  });

  pi.on("session_start", (event: SessionStartEvent, ctx) => {
    if (event.reason === "fork") {
      // Fork copies entries on the branch path (ancestors).  Took Ns entries
      // that are descendants of the fork leaf are excluded.  Re-append only
      // those whose parent is in the new session (they belong to a copied
      // turn) but whose entry ID is not (they weren't on the branch path).
      const ids = new Set<string>();
      const texts = new Set<string>();
      for (const e of ctx.sessionManager.getEntries()) {
        const entry = e as any;
        ids.add(entry.id);
        if (entry.type === "custom" && entry.customType === TOOK_CUSTOM_TYPE) {
          texts.add(entry.data?.text ?? "");
        }
      }
      for (const stored of _tookEntries) {
        if (ids.has(stored.entryId)) continue;        // already on branch path
        if (texts.has(stored.data.text)) continue;    // duplicate text guard
        if (!stored.parentId || !ids.has(stored.parentId)) continue; // future turn
        pi.appendEntry(TOOK_CUSTOM_TYPE, stored.data);
      }
    } else {
      // Populate from existing session entries (startup / resume / reload).
      _tookEntries.length = 0;
      for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type === "custom" && (entry as any).customType === TOOK_CUSTOM_TYPE) {
          const e = entry as any;
          _tookEntries.push({ data: e.data, entryId: e.id, parentId: e.parentId });
        }
      }
    }
    resetState();
  });
  pi.on("session_shutdown", () => resetState());

  pi.on("input", (_event, ctx) => {
    if (!ctx.hasUI) return;
    _startMs = Date.now();
  });

  pi.on("agent_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    startTimer(ctx.ui);
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (!ctx.hasUI) return;
    if (_startMs !== null) {
      const totalMs = Date.now() - _startMs;
      const data = { text: `Took ${formatDuration(totalMs)}` };
      const parentId = ctx.sessionManager.getLeafId();
      pi.appendEntry(TOOK_CUSTOM_TYPE, data);
      const entryId = ctx.sessionManager.getLeafId();
      _tookEntries.push({ data, entryId: entryId ?? "", parentId });
    }
    stopTimer();
    _startMs = null;
  });
}
