import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SessionSelectorComponent } from "@earendil-works/pi-coding-agent";

const SessionSelectorProto = SessionSelectorComponent.prototype as any;
const orig = SessionSelectorProto.loadCurrentSessions as (this: any) => void;

SessionSelectorProto.loadCurrentSessions = function () {
  this.sortMode = "recent";
  if (this.header) this.header.setSortMode?.("recent");
  if (this.sessionList) this.sessionList.setSortMode?.("recent");
  return orig.call(this);
};

export default function (_pi: ExtensionAPI) {
  // Monkey-patch at module load time because Pi does not expose API for us to
  // customize the sessions menu.
}
