/**
 * Last 8 seconds of the ride, ten samples a second would be coarse.
 * We keep 60 Hz so a replay can step the picture one frame at a time.
 * The buffer forgets anything older than the window.
 */

const WINDOW = 8 * 60;

export function createReplay() {
  const samples = [];
  let playing = false;
  let cursor = 0;
  return {
    push(sample) {
      if (playing) return;
      samples.push({
        s: sample.s,
        x: sample.x,
        v: sample.v,
        brake: sample.brake,
      });
      if (samples.length > WINDOW) samples.shift();
    },
    ready() {
      return samples.length > 30;
    },
    start() {
      if (samples.length < 2) return false;
      playing = true;
      cursor = 0;
      return true;
    },
    step() {
      if (!playing) return null;
      if (cursor >= samples.length) {
        playing = false;
        return null;
      }
      const sample = samples[cursor];
      cursor += 1;
      return sample;
    },
    playing() {
      return playing;
    },
  };
}
