# Notify — Handoff Notes

## Current approach

Central notification extension. DECSET 1004 focus tracking + terminal bell.

```
session_start → startFocusTracking()
session_shutdown → stopFocusTracking()
input → reset playedThisInput flag
agent_settled → if TUI && !alreadyPlayed && !focused → playBell()
notify:alert (event) → if !focused → playBell()
```

Other extensions can emit `notify:alert` via `pi.events.emit("notify:alert")`.

No config — always rings terminal bell (ASCII BEL, `\x07`).

## Focus awareness

DECSET 1004 operates at OS window level. Does **not** distinguish tabs/panes.
`isTerminalFocused()` returns `true` even if user switches tab in the same window.

Conservative default: bell only fires when window is definitively unfocused.

## Known conflict: `remember` extension

`remember` calls `pi.sendUserMessage()` in its own `agent_settled`, triggering
another agent run. `playedThisInput` one-shot flag prevents double-fire.

## Testing

```bash
cd ~/.pi/agent/extensions/notify && npx vitest run
```

**Key patterns:**
- Pure functions in `notify.ts` and `focus.ts` — no pi types
- Focus tests mock `process.stdin`/`process.stdout`
- `resetFocusState()` helper for module-level state between tests
