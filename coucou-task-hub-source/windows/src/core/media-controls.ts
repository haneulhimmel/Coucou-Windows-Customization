import { Bridge } from "./bridge";
import { type ActivityHub, type MediaSnapshot } from "./hub";

export type PlaybackAction = "toggle" | "previous" | "next";
interface MediaTransport {
  mediaControl(id: string, action: string): Promise<boolean | null>;
  mediaRefresh(): Promise<MediaSnapshot | null>;
}

/** Resolve the displayed player at the moment of the click, never another player. */
export async function compactMediaControl(hub: ActivityHub, id: string, requested: PlaybackAction, transport: MediaTransport = Bridge): Promise<boolean> {
  const media = hub.media.sessions.find(s => s.id === id);
  if (!media) return false;
  const action = requested === "toggle" ? media.playing ? "pause" : "play" : requested;
  const supported = action === "pause" ? media.canPause : action === "play" ? media.canPlay : action === "next" ? media.canNext : media.canPrevious;
  if (!supported) return false;
  // Keep this player selected when pausing the automatically chosen activity.
  hub.select(`media:${id}`);
  const applied = await transport.mediaControl(id, action);
  if (applied !== true) {
    hub.error = "This player couldn’t apply that control.";
    hub.notify();
    return false;
  }
  hub.error = "";
  const snapshot = await transport.mediaRefresh();
  if (snapshot) hub.updateMedia(snapshot);
  else hub.notify();
  return true;
}
