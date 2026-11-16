/**
 * replayEngine.ts — the replay clock.
 *
 * Maps a virtual playhead over a ReplayTimeline to a stream of due frames,
 * exactly like the live event stream — so replay feeds the same ImpulseSystem
 * and HUD as reality does.
 *
 * Behaviors:
 *   - play/pause, speed (0.5×–100×), frame stepping
 *   - seek: forward = silent jump (only a short visual history window is
 *     re-spawned); backward = clear + respawn window (onClear hook)
 *   - frame sink callback receives { frame, index } in order
 *   - state sink callback fires (throttled) for UI updates
 */
import type { ReplayTimeline, TimelineFrame } from '@shared/protocol.js';

export interface ReplayState {
  t: number;
  playing: boolean;
  speed: number;
  index: number;
  duration: number;
  frameCount: number;
}

export const REPLAY_SPEEDS = [0.5, 1, 2, 10, 100];

const STATE_EMIT_MS = 80;
const HISTORY_WINDOW_S = 1.2;

export class ReplayEngine {
  timeline: ReplayTimeline | null = null;
  private t = 0;
  private playing = false;
  private speed = 1;
  private index = 0; // next frame to fire

  private frameSink: ((frame: TimelineFrame, index: number) => void) | null = null;
  private stateSink: ((state: ReplayState) => void) | null = null;
  private clearSink: (() => void) | null = null;
  private lastEmit = 0;

  /* ------------------------------ wiring ------------------------------ */

  setFrameSink(fn: (frame: TimelineFrame, index: number) => void): void {
    this.frameSink = fn;
  }

  setStateSink(fn: (state: ReplayState) => void): void {
    this.stateSink = fn;
  }

  setClearSink(fn: () => void): void {
    this.clearSink = fn;
  }

  /* ------------------------------- state ------------------------------- */

  get state(): ReplayState {
    return {
      t: this.t,
      playing: this.playing,
      speed: this.speed,
      index: this.index,
      duration: this.timeline?.duration ?? 0,
      frameCount: this.timeline?.frames.length ?? 0,
    };
  }

  private emitState(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastEmit < STATE_EMIT_MS) return;
    this.lastEmit = now;
    this.stateSink?.(this.state);
  }

  /* ------------------------------ controls ------------------------------ */

  load(timeline: ReplayTimeline): void {
    this.timeline = timeline;
    this.t = 0;
    this.index = 0;
    this.playing = false;
    this.speed = 1;
    this.clearSink?.();
    this.emitState(true);
  }

  unload(): void {
    this.timeline = null;
    this.playing = false;
    this.t = 0;
    this.index = 0;
    this.clearSink?.();
    this.emitState(true);
  }

  play(): void {
    if (!this.timeline) return;
    if (this.t >= this.timeline.duration) this.seek(0);
    this.playing = true;
    this.emitState(true);
  }

  pause(): void {
    this.playing = false;
    this.emitState(true);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.emitState(true);
  }

  seek(target: number): void {
    if (!this.timeline) return;
    const clamped = Math.min(Math.max(target, 0), this.timeline.duration);
    const backward = clamped < this.t - 0.001;
    this.t = clamped;

    // Find the next frame index for this time.
    const frames = this.timeline.frames;
    let i = 0;
    while (i < frames.length && frames[i].t <= clamped) i++;

    if (backward) {
      // Silent fast-forward: wipe the sky, then respawn a short history
      // window of frames so the view isn't empty at the playhead.
      this.clearSink?.();
      const from = clamped - HISTORY_WINDOW_S;
      let start = i - 1;
      while (start > 0 && frames[start - 1].t >= from) start--;
      for (let k = start; k < i; k++) this.frameSink?.(frames[k], k);
    }
    this.index = i;
    this.emitState(true);
  }

  /** Step to the previous/next frame boundary (pauses playback). */
  step(dir: 1 | -1): void {
    if (!this.timeline) return;
    const frames = this.timeline.frames;
    this.playing = false;
    if (dir > 0) {
      if (this.index < frames.length) this.seek(frames[this.index].t + 0.001);
    } else {
      const target = this.index >= 2 ? frames[this.index - 2].t : 0;
      this.seek(Math.max(0, target));
    }
    this.emitState(true);
  }

  /* ------------------------------- clock ------------------------------- */

  update(dt: number): void {
    if (!this.timeline || !this.playing) return;
    this.t += dt * this.speed;
    if (this.t >= this.timeline.duration) {
      this.t = this.timeline.duration;
      this.flush();
      this.playing = false;
      this.emitState(true);
      return;
    }
    this.flush();
    this.emitState();
  }

  private flush(): void {
    const frames = this.timeline?.frames;
    if (!frames) return;
    while (this.index < frames.length && frames[this.index].t <= this.t) {
      this.frameSink?.(frames[this.index], this.index);
      this.index++;
    }
  }
}
