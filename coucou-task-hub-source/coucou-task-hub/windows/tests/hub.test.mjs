import { test } from "node:test";
import assert from "node:assert/strict";
import { ActivityHub, clock, mediaPosition, timerRemaining, validShortcutTarget } from "../src/core/hub.ts";
import { State, DEFAULT_SETTINGS } from "../src/core/state.ts";

const player = (id, playing = true) => ({ id, app: id, title: `${id} track`, artist: "Artist", artwork: null,
  playing, position: 10, duration: 200, sampledAt: 1000, canPlay: true, canPause: true,
  canNext: false, canPrevious: false, canSeek: true });
const storage = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v) }; };

test("the default home is the everyday hub and services are opt-in", () => {
  State.pendingApproval = null;
  assert.equal(State.defaultView(), "hub");
  assert.deepEqual(DEFAULT_SETTINGS.activeIntegrations, []);
  State.pendingApproval = { requestId: "r", sessionId: "s", pillId: "p", tool: "Bash", command: "" };
  assert.equal(State.defaultView(), "approval");
  State.pendingApproval = null;
});
test("a deadline catches up after sleep and completes exactly once", () => {
  const hub = new ActivityHub();
  const timer = hub.startTimer(5, "Tea", 1000);
  assert.equal(timerRemaining(timer, 151000), 150000);
  assert.equal(hub.tick(900000).length, 1);
  assert.equal(hub.tick(900001).length, 0);
  assert.equal(hub.alertId, `timer:${timer.id}`);
  assert.equal(timer.status, "finished");
});
test("pausing freezes remaining time, resuming uses a fresh deadline", () => {
  const hub = new ActivityHub(); const timer = hub.startTimer(5, "Tea", 1000);
  hub.pauseTimer(timer.id, 61000);
  assert.equal(timerRemaining(timer, 900000), 240000);
  hub.resumeTimer(timer.id, 900000);
  assert.equal(timer.deadline, 1140000);
  assert.equal(hub.tick(1139999).length, 0);
  assert.equal(hub.tick(1140000).length, 1);
});
test("pausing at the deadline rings instead of creating a zero-duration paused timer", () => {
  const hub = new ActivityHub(); const timer = hub.startTimer(1, "Tea", 0);
  hub.pauseTimer(timer.id, 60000);
  assert.equal(timer.status, "finished");
});
test("saved timers and shortcuts survive an app restart", () => {
  const saved = storage(); const hub = new ActivityHub(); hub.load(saved);
  const timer = hub.startTimer(25, "Focus", 1000);
  hub.addShortcut("Example", "https://example.com");
  const reopened = new ActivityHub(); reopened.load(saved);
  assert.equal(reopened.timers[0].deadline, timer.deadline);
  assert.equal(reopened.shortcuts.at(-1).label, "Example");
  assert.equal(reopened.tick(1600000).length, 1);
  const again = new ActivityHub(); again.load(saved);
  assert.equal(again.alertId, `timer:${timer.id}`);
});
test("pinning prevents new players from taking the front, and missing sources fall back", () => {
  const hub = new ActivityHub();
  hub.updateMedia({ sessions: [player("Spotify")], currentId: "Spotify" });
  hub.togglePin();
  hub.updateMedia({ sessions: [player("Spotify"), player("Browser")], currentId: "Browser" });
  assert.equal(hub.focusId, "media:Spotify");
  hub.updateMedia({ sessions: [player("Browser")], currentId: "Browser" });
  assert.equal(hub.focusId, "media:Browser");
  assert.equal(hub.selectedMedia.id, "Browser");
});
test("a completion temporarily overrides pinned music, then restores it", () => {
  const hub = new ActivityHub();
  hub.updateMedia({ sessions: [player("Spotify")], currentId: "Spotify" });
  const timer = hub.startTimer(1, "Tea", 0);
  hub.select("media:Spotify"); hub.togglePin(); hub.tick(60000);
  assert.equal(hub.focusId, `timer:${timer.id}`);
  hub.removeTimer(timer.id);
  assert.equal(hub.focusId, "media:Spotify");
});
test("simultaneous completions stay actionable until each is acknowledged", () => {
  const hub = new ActivityHub(); const a = hub.startTimer(1, "A", 0); const b = hub.startTimer(1, "B", 0);
  assert.equal(hub.tick(60000).length, 2);
  hub.removeTimer(a.id); assert.equal(hub.alertId, `timer:${b.id}`);
  hub.removeTimer(b.id); assert.equal(hub.alertId, null);
});
test("live activity keeps the compact island relevant; closed players clear it", () => {
  const hub = new ActivityHub(); hub.updateMedia({ sessions: [player("Spotify")], currentId: "Spotify" });
  assert.ok(hub.hasLiveActivity);
  hub.updateMedia({ sessions: [], currentId: null });
  assert.equal(hub.hasLiveActivity, false); assert.equal(hub.focusId, "shortcuts");
});
test("media progress freezes when paused and clamps to the track duration", () => {
  assert.equal(mediaPosition(player("Spotify"), 11000), 20);
  assert.equal(mediaPosition(player("Spotify", false), 11000), 10);
  assert.equal(mediaPosition(player("Spotify"), 999999), 200);
  assert.equal(clock(59999), "1:00");
});
test("timer input and restored data are bounded", () => {
  const hub = new ActivityHub();
  for (const n of [NaN, Infinity, 0, -2, 1441]) assert.equal(hub.startTimer(n), null);
  const corrupted = { getItem: () => JSON.stringify({ timers: [{id:"x", label:"x", durationMs:NaN}], shortcuts:[{id:"s", label:"x", target:"javascript:alert(1)"}] }), setItem() {} };
  hub.load(corrupted); assert.deepEqual(hub.timers, []); assert.deepEqual(hub.shortcuts, []);
});
test("shortcut targets accept specific resources and reject shell command text", () => {
  for (const s of ["https://example.com", "spotify:", "shell:Downloads", "C:\\Apps\\player.exe"]) assert.ok(validShortcutTarget(s), s);
  for (const s of ["javascript:alert(1)", "cmd /c whoami", "powershell -Command x", "https://example.com\ncmd", "relative.exe"]) assert.equal(validShortcutTarget(s), false, s);
});
test("failed persistence is visible without losing the running timer", () => {
  const hub = new ActivityHub(); hub.load({ getItem: () => null, setItem() { throw new Error("full"); } });
  const timer = hub.startTimer(1);
  assert.ok(hub.storageError); assert.equal(hub.timers[0].id, timer.id);
});
