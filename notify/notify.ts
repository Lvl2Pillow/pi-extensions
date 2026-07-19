/**
 * Terminal bell notification.
 *
 * Pure function + safe side-effect. No pi types — importable in tests
 * without the pi runtime.
 */

/**
 * Ring the terminal bell (ASCII BEL character).
 * Triggers the terminal's native notification: visual flash or beep.
 */
export function playBell(): void {
  process.stdout.write("\x07");
}
