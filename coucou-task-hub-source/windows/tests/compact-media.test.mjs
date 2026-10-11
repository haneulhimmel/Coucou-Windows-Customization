import { test } from "node:test";
import assert from "node:assert/strict";
import { ActivityHub } from "../src/core/hub.ts";
import { compactMediaControl } from "../src/core/media-controls.ts";

const player = (id, playing = true) => ({ id, app: id, title: "Track", artist: "Artist", artwork: null,
  playing, position: 0, duration: 180, sampledAt: Date.now(),
  canPlay: true, canPause: true, canNext: true, canPrevious: false, canSeek: true });

test("compact pause stays selected and available for resuming", async () => {
  const hub = new ActivityHub();
  const media = player("music");
  hub.updateMedia({ currentId: media.id, sessions: [media] });
  const calls = [];
  const transport = {
    mediaControl: async (id, action) => { calls.push([id, action]); return true; },
    mediaRefresh: async () => ({ currentId: media.id, sessions: [{ ...media, playing: false }] }),
  };
  assert.equal(await compactMediaControl(hub, media.id, "toggle", transport), true);
  assert.deepEqual(calls, [["music", "pause"]]);
  assert.equal(hub.focusId, "media:music");
  assert.equal(hub.hasLiveActivity, true);
  await compactMediaControl(hub, media.id, "toggle", transport);
  assert.deepEqual(calls[1], ["music", "play"]);
});

test("a compact control targets its displayed player even after selection changes", async () => {
  const hub = new ActivityHub();
  hub.updateMedia({ currentId: "second", sessions: [player("first"), player("second")] });
  hub.select("media:second");
  const calls = [];
  await compactMediaControl(hub, "first", "next", {
    mediaControl: async (id, action) => { calls.push([id, action]); return true; },
    mediaRefresh: async () => null,
  });
  assert.deepEqual(calls, [["first", "next"]]);
});

test("missing players and unsupported controls never send playback commands", async () => {
  const hub = new ActivityHub();
  hub.updateMedia({ currentId: "music", sessions: [player("music")] });
  const transport = { mediaControl: async () => { assert.fail("unexpected playback command"); }, mediaRefresh: async () => null };
  assert.equal(await compactMediaControl(hub, "missing", "toggle", transport), false);
  assert.equal(await compactMediaControl(hub, "music", "previous", transport), false);
});

test("failed compact playback leaves the reported state intact and exposes an error", async () => {
  const hub = new ActivityHub();
  hub.updateMedia({ currentId: "music", sessions: [player("music")] });
  assert.equal(await compactMediaControl(hub, "music", "toggle", {
    mediaControl: async () => false,
    mediaRefresh: async () => { assert.fail("must not refresh after failure"); },
  }), false);
  assert.equal(hub.selectedMedia.playing, true);
  assert.match(hub.error, /couldn’t apply/);
});
