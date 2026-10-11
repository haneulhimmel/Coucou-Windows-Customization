import { Hub, type MediaSnapshot } from "../core/hub";
import { State } from "../core/state";
import { Bridge, onEvent } from "../core/bridge";
import { Sound } from "../core/sound";
import type { Island } from "./island";

export async function registerHub(island: Island) {
  Hub.subscribe(() => {
    State.notify();
    island.fsm.keepCompact = Hub.hasLiveActivity;
    if (Hub.hasLiveActivity && !State.paused && State.mode === "hidden") island.revealSilently();
    if (!Hub.hasLiveActivity && island.fsm.state === "petit") island.fsm.mouseLeft();
    if (!Hub.alertId && !State.pendingApproval) island.fsm.pinned = State.isPinned;
  });
  try { Hub.load(window.localStorage); } catch { Hub.storageError = "Activity storage is unavailable."; }
  await onEvent<MediaSnapshot>("hub-media", snapshot => Hub.updateMedia(snapshot));
  const media = await Bridge.mediaRefresh();
  if (media) Hub.updateMedia(media);
  let shownAlert: string | null = null;
  const checkTimers = () => {
    const ended = Hub.tick();
    if (!Hub.alertId) shownAlert = null;
    if (Hub.alertId && Hub.alertId !== shownAlert && !State.pendingApproval && !State.paused && State.view !== "greeting") {
      if (ended.length) Sound.play("finish");
      shownAlert = Hub.alertId;
      if (State.view !== "hub" || State.mode !== "expanded") {
        island.alert("hub");
      }
      island.fsm.pinned = true;
    }
  };
  window.setInterval(checkTimers, 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkTimers(); });
  Hub.notify();
  // Let the greeting finish before opening restored, unacknowledged alerts.
  window.setTimeout(checkTimers, 5000);
}
