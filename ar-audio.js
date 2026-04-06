// ─── Audio preview engine ─────────────────────────────────────────────────
// Tick-based lookahead scheduler driving simple Web Audio drum voices.
// Reads pattern data directly from AR.state.pattern.raw.
//
// Tick grid: 2880 PPQN (11520 ticks/whole note).
//   720 ticks per 1/16 step at 1× speed. See NOTES-audio-preview.md.
//
// Depends on: ar-state.js, ar-constants.js, ar-sysex.js (getTrigFlags), ar-editor.js (refreshAfterEdit isn't needed)

(function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────
  const TICKS_PER_WHOLE   = 11520;
  const TICKS_PER_STEP_1X = 720;        // 1/16 at 1× speed
  const LOOKAHEAD_MS      = 25;         // scheduler poll interval
  const SCHEDULE_AHEAD    = 0.1;        // seconds of audio to queue ahead

  // Speed index (0–6) → ticks per step.
  // Labels: ['2x','3/2x','1x','3/4x','1/2x','1/4x','1/8x']
  const SPEED_TICKS = [
    TICKS_PER_STEP_1X / 2,              // 0: 2×    → 360
    (TICKS_PER_STEP_1X * 2) / 3,        // 1: 3/2×  → 480
    TICKS_PER_STEP_1X,                  // 2: 1×    → 720
    (TICKS_PER_STEP_1X * 4) / 3,        // 3: 3/4×  → 960
    TICKS_PER_STEP_1X * 2,              // 4: 1/2×  → 1440
    TICKS_PER_STEP_1X * 4,              // 5: 1/4×  → 2880
    TICKS_PER_STEP_1X * 8,              // 6: 1/8×  → 5760
  ];

  // Retrig rate index (0–16) → ticks.  Absolute, not speed-scaled.
  const RETRIG_DENOMS = [1,2,3,4,5,6,8,10,12,16,20,24,32,40,48,64,80];
  const RETRIG_TICKS  = RETRIG_DENOMS.map(d => TICKS_PER_WHOLE / d);

  // Note-length encoding (shared by NOTE_LEN and RETRIG_LEN fields): 8 ranges
  // of 16 values each (first range = 14), step size doubles per range.
  // Returns duration in units of 1/16-note steps.  127 = ∞.
  const NLEN_RANGES = [
    [  0, 0.125, 0.0625],
    [ 14, 1,     0.0625],
    [ 30, 2,     0.125 ],
    [ 46, 4,     0.25  ],
    [ 62, 8,     0.5   ],
    [ 78, 16,    1     ],
    [ 94, 32,    2     ],
    [110, 64,    4     ],
  ];
  function noteLenToSteps(v) {
    if (v >= 127) return Infinity;
    if (v === 126) return 128;
    for (let i = NLEN_RANGES.length - 1; i >= 0; i--) {
      const [start, base, step] = NLEN_RANGES[i];
      if (v >= start) return base + (v - start) * step;
    }
    return 0;
  }

  // Track index → drum role.  13th track (FX) has no voice.
  const VOICE_ROLES = ['BD','SD','RS','CP','BT','LT','MT','HT','CH','OH','CY','CB'];

  // ─── Engine state ───────────────────────────────────────────────────────
  const E = {
    ctx:           null,
    master:        null,    // master gain node
    noiseBuf:      null,
    playing:       false,
    fillMode:      false,
    timerId:       null,

    // Timing anchor: audioStartTime + (tick - tickAtStart)*tickDur = wall time
    startTime:     0,       // AudioContext time when this play session began
    tickCursor:    0,       // next tick that hasn't been scheduled yet
    bpm:           120,
    tickDur:       0,       // seconds per tick (derived from bpm)

    // Condition evaluation state per track
    cycleCount:    null,    // Int32Array[13]
    prevCondResult:null,    // Int8Array[13]: result of last conditional trig on this track (0/1/-1 if none yet)
    lastNeiResult: null,    // Int8Array[13]: last conditional trig result (any trig) on this track for NEI lookup from next track
    firstPlayCycle:null,    // Int8Array[13]: set to 0 after first cycle completes

    // Visual playhead
    highlightTrack: 0,
    highlightStep:  -1,
    rafId:          null,
  };

  // ─── Pattern reading helpers ────────────────────────────────────────────
  function readTrack(t) {
    const raw = AR.state.pattern.raw;
    if (!raw) return null;
    const base = 4 + t * AR_TRACK_V5_SZ;
    return {
      base,
      trigBits:     raw.subarray(base + TRIG_BITS_OFFSET, base + 112),
      notes:        base + NOTE_OFFSET,
      velos:        base + VELOCITY_OFFSET,
      lens:         base + NOTE_LEN_OFFSET,
      micros:       base + MICRO_TIMING_OFFSET,
      retrigLens:   base + RETRIG_LENGTH_OFFSET,
      retrigRates:  base + RETRIG_RATE_OFFSET,
      retrigVelos:  base + RETRIG_VELO_OFFSET,
      defNote:      raw[base + DEFAULT_NOTE_OFFSET],
      defVelo:      raw[base + DEFAULT_VELOCITY_OFFSET],
      defFlags:     (raw[base + DEFAULT_TRIG_FLAGS_OFFSET] << 8) | raw[base + DEFAULT_TRIG_FLAGS_OFFSET + 1],
      numSteps:     raw[base + NUM_STEPS_OFFSET] || 16,
      speedByte:    raw[base + TRACK_SPEED_OFFSET],
      probability:  raw[base + TRIG_PROBABILITY_OFFSET],
    };
  }

  function getPatternMeta() {
    const raw = AR.state.pattern.raw;
    if (!raw) return null;
    // BPM is stored as u16be × 120 (see editor meta line: bpmRaw / 120)
    const bpmRaw = (raw[BPM_MSB_OFFSET] << 8) | raw[BPM_LSB_OFFSET];
    return {
      bpm:          bpmRaw ? bpmRaw / 120 : 120,
      swingAmount:  raw[SWING_AMOUNT_OFFSET],   // 0..30; actual % = 50 + this
      scaleMode:    raw[SCALE_MODE_OFFSET],     // 0 normal, 1 advanced
      masterSpeed:  raw[MASTER_SPEED_OFFSET] & SPEED_VALUE_MASK,
      masterLen:    ((raw[MASTER_LENGTH_OFFSET] << 8) | raw[MASTER_LENGTH_OFFSET + 1]) || 64,
    };
  }

  function trackStepTicks(trk, meta) {
    // Normal scale mode → master speed applies.  Advanced → per-track speed.
    const speedIdx = meta.scaleMode ? (trk.speedByte & SPEED_VALUE_MASK) : meta.masterSpeed;
    return SPEED_TICKS[speedIdx];
  }

  function trackNumSteps(trk, meta) {
    if (meta.scaleMode) return Math.max(1, Math.min(64, trk.numSteps));
    const m = meta.masterLen;
    return (m === 0 || m === 1) ? 64 : Math.min(64, m);
  }

  // Distance (in ticks) from step `fromStep` to the next enabled trig on
  // the same track, using this track's current step duration.  Used to
  // bound "∞" retrig length.  Wraps at the end of the track's step loop;
  // if no other enabled trig is found, returns the full loop length so
  // the retrig covers exactly one pattern cycle.
  function ticksUntilNextTrig(ts, fromStep) {
    const trk = ts.trk;
    const n = ts.nSteps;
    for (let i = 1; i <= n; i++) {
      const ns = (fromStep + i) % n;
      const f = getTrigFlags(trk.trigBits, ns);
      if ((f & AR_TRIG_ENABLE) !== 0) return i * ts.stepDur;
    }
    return n * ts.stepDur;
  }

  // ─── Trig condition decode & evaluation ─────────────────────────────────
  function getStepCondition(trk, s) {
    const raw = AR.state.pattern.raw;
    const noteRaw = raw[trk.notes + s];
    if ((noteRaw & NOTE_CONDITION_BIT) !== 0) return null;
    const microRaw  = raw[trk.micros + s];
    const retLenRaw = raw[trk.retrigLens + s];
    const retRatRaw = raw[trk.retrigRates + s];
    let r = 0;
    r |= (microRaw  & UTIME_UPPER_MASK)  >> 2;
    r |= (retLenRaw & RETRIG_LEN_FLAG)   >> 4;
    r |= (retRatRaw & RETRIG_RATE_FLAGS) >> 5;
    return r;
  }

  // Probability table for condition indices 0..21 (1%..100%)
  const PROB_PCT = [1,3,4,6,9,13,19,25,33,41,50,59,67,75,81,87,91,94,96,98,99,100];

  function evalCondition(cond, t) {
    if (cond <= 21) return Math.random() * 100 < PROB_PCT[cond];
    if (cond === 22) return  E.fillMode;         // FILL
    if (cond === 23) return !E.fillMode;         // !FILL
    if (cond === 24) return E.prevCondResult[t] === 1;     // PRE
    if (cond === 25) return E.prevCondResult[t] === 0;     // !PRE
    if (cond === 26) return t > 0 && E.lastNeiResult[t - 1] === 1;  // NEI
    if (cond === 27) return t > 0 && E.lastNeiResult[t - 1] === 0;  // !NEI
    if (cond === 28) return E.firstPlayCycle[t] === 1;     // 1ST
    if (cond === 29) return E.firstPlayCycle[t] === 0;     // !1ST
    // Ratios: 30..64  layout is 1:2, 2:2, 1:3, 2:3, 3:3, 1:4..4:4, ...
    let idx = 30, y = 2;
    while (idx + y <= 65) {
      if (cond < idx + y) {
        const x = cond - idx + 1;
        return (E.cycleCount[t] % y) === (x - 1);
      }
      idx += y;
      y++;
    }
    return true;
  }

  // ─── Noise buffer ───────────────────────────────────────────────────────
  function makeNoise(ctx) {
    const sec = 1;
    const buf = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ─── Voice synthesis ────────────────────────────────────────────────────
  // Each `playXxx(when, opts)` spawns nodes that play at `when` and free
  // themselves when done.  opts: { gain, pitchRatio, pan, dest }.
  //
  // `gain`     — 0..1 (velocity + accent combined)
  // `pitchRatio`— multiplicative pitch (1.0 = default), applied only for tonal voices
  // `dest`     — output AudioNode

  function envGain(ctx, when, peak, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    return g;
  }

  // Simple AD with immediate attack (for punchier transients).
  function envAD(ctx, when, peak, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    return g;
  }

  function noiseSrc(ctx, when, dur) {
    const s = ctx.createBufferSource();
    s.buffer = E.noiseBuf;
    s.loop = false;
    s.start(when);
    s.stop(when + dur + 0.05);
    return s;
  }

  // TR-909-style voices.  Not sample-accurate emulations — just the right
  // ingredients in roughly the right proportions for familiar feel.

  // ── BD: sine with fast pitch sweep + click transient ──────────────────
  function playBD(when, opts) {
    const ctx = E.ctx;
    const pr = opts.pitchRatio || 1;
    // Main sine: starts ~200Hz, sweeps to ~48Hz fast, long exponential decay
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200 * pr, when);
    osc.frequency.exponentialRampToValueAtTime(55 * pr, when + 0.04);
    osc.frequency.exponentialRampToValueAtTime(48 * pr, when + 0.25);
    const g = envAD(ctx, when, opts.gain * 1.1, 0.45);
    osc.connect(g).connect(opts.dest);
    osc.start(when); osc.stop(when + 0.6);
    // Click transient: short high-pitched triangle blip
    const click = ctx.createOscillator();
    click.type = 'triangle';
    click.frequency.value = 1800;
    const cg = envAD(ctx, when, opts.gain * 0.35, 0.004);
    click.connect(cg).connect(opts.dest);
    click.start(when); click.stop(when + 0.01);
  }

  // ── SD: two tuned sines + filtered noise ──────────────────────────────
  function playSD(when, opts) {
    const ctx = E.ctx;
    const pr = opts.pitchRatio || 1;
    // Two sines: classic 909-ish ~180Hz and ~330Hz, short
    const mix = ctx.createGain();
    mix.gain.value = 1;
    mix.connect(opts.dest);

    const o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(320 * pr, when);
    o1.frequency.exponentialRampToValueAtTime(180 * pr, when + 0.03);
    const g1 = envAD(ctx, when, opts.gain * 0.55, 0.12);
    o1.connect(g1).connect(mix);
    o1.start(when); o1.stop(when + 0.2);

    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(520 * pr, when);
    o2.frequency.exponentialRampToValueAtTime(330 * pr, when + 0.02);
    const g2 = envAD(ctx, when, opts.gain * 0.35, 0.08);
    o2.connect(g2).connect(mix);
    o2.start(when); o2.stop(when + 0.15);

    // Noise: bandpass sweep, bright snap + longer tail
    const n = noiseSrc(ctx, when, 0.22);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1200;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 3000; bp.Q.value = 0.6;
    const ng = envAD(ctx, when, opts.gain * 0.95, 0.18);
    n.connect(hp).connect(bp).connect(ng).connect(mix);
  }

  // ── RS: short tuned click (two square pulses) ─────────────────────────
  function playRS(when, opts) {
    const ctx = E.ctx;
    const pr = opts.pitchRatio || 1;
    const o1 = ctx.createOscillator();
    o1.type = 'square';
    o1.frequency.value = 1600 * pr;
    const g1 = envAD(ctx, when, opts.gain * 0.5, 0.03);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 800;
    o1.connect(g1).connect(hp).connect(opts.dest);
    o1.start(when); o1.stop(when + 0.05);

    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = 2200 * pr;
    const g2 = envAD(ctx, when, opts.gain * 0.35, 0.018);
    o2.connect(g2).connect(opts.dest);
    o2.start(when); o2.stop(when + 0.03);
  }

  // ── CP: three quick noise bursts + one longer tail ────────────────────
  function playCP(when, opts) {
    const ctx = E.ctx;
    const offsets = [0, 0.010, 0.020];
    for (let i = 0; i < offsets.length; i++) {
      const n = noiseSrc(ctx, when + offsets[i], 0.015);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.9;
      const g = envAD(ctx, when + offsets[i], opts.gain * 0.7, 0.012);
      n.connect(bp).connect(g).connect(opts.dest);
    }
    // long tail burst
    const nt = noiseSrc(ctx, when + 0.028, 0.25);
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass'; bp2.frequency.value = 1200; bp2.Q.value = 0.7;
    const gt = envAD(ctx, when + 0.028, opts.gain * 0.9, 0.22);
    nt.connect(bp2).connect(gt).connect(opts.dest);
  }

  // ── Toms: sine sweep + subtle noise attack ────────────────────────────
  function playTom(when, opts, baseHz) {
    const ctx = E.ctx;
    const pr = opts.pitchRatio || 1;
    const f0 = baseHz * pr;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0 * 2.2, when);
    osc.frequency.exponentialRampToValueAtTime(f0, when + 0.06);
    const g = envAD(ctx, when, opts.gain * 0.95, 0.35);
    osc.connect(g).connect(opts.dest);
    osc.start(when); osc.stop(when + 0.45);
    // noise attack
    const n = noiseSrc(ctx, when, 0.02);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 400;
    const ng = envAD(ctx, when, opts.gain * 0.25, 0.015);
    n.connect(hp).connect(ng).connect(opts.dest);
  }

  // ── Metal section (shared by hats, cymbal, cowbell): 6 square oscs
  // at the classic TR-808/909 frequencies.  Ring-mod'ish cluster.
  const METAL_FREQS = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];

  function metalCluster(ctx, when, dur, gainTarget) {
    const mix = ctx.createGain();
    mix.gain.value = gainTarget;
    const stopAt = when + dur + 0.05;
    for (let i = 0; i < METAL_FREQS.length; i++) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = METAL_FREQS[i];
      o.connect(mix);
      o.start(when); o.stop(stopAt);
    }
    return mix;
  }

  // ── CH/OH: metal cluster → highpass → fast (CH) or slow (OH) decay ──
  function playHat(when, opts, decay, cutoff) {
    const ctx = E.ctx;
    // Metal body
    const cluster = metalCluster(ctx, when, decay, 0.22);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = cutoff;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 0.5;
    // Sharper attack for CH vs. OH
    const atk = decay < 0.1 ? 0.001 : 0.002;
    const g = envGain(ctx, when, opts.gain * 0.7, atk, decay);
    cluster.connect(hp).connect(bp).connect(g).connect(opts.dest);
    // A bit of noise sparkle on top
    const n = noiseSrc(ctx, when, decay);
    const nhp = ctx.createBiquadFilter();
    nhp.type = 'highpass'; nhp.frequency.value = cutoff + 1000;
    const ng = envAD(ctx, when, opts.gain * 0.25, decay * 0.8);
    n.connect(nhp).connect(ng).connect(opts.dest);
  }

  // ── CY: metal cluster with long decay + noise wash ────────────────────
  function playCY(when, opts) {
    const ctx = E.ctx;
    const decay = 0.9;
    const cluster = metalCluster(ctx, when, decay, 0.3);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 4000;
    const g = envGain(ctx, when, opts.gain * 0.55, 0.003, decay);
    cluster.connect(hp).connect(g).connect(opts.dest);
    // Noise sizzle
    const n = noiseSrc(ctx, when, decay);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 8000; bp.Q.value = 0.5;
    const ng = envGain(ctx, when, opts.gain * 0.3, 0.003, decay * 0.8);
    n.connect(bp).connect(ng).connect(opts.dest);
  }

  // ── CB: two square oscillators at 540/800 (classic 808 cowbell) ──────
  function playCB(when, opts) {
    const ctx = E.ctx;
    const pr = opts.pitchRatio || 1;
    const mix = ctx.createGain();
    mix.gain.value = 1;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 0.6;
    const g = envGain(ctx, when, opts.gain * 0.45, 0.001, 0.22);
    mix.connect(bp).connect(g).connect(opts.dest);
    const o1 = ctx.createOscillator();
    o1.type = 'square'; o1.frequency.value = 540 * pr;
    o1.connect(mix);
    o1.start(when); o1.stop(when + 0.3);
    const o2 = ctx.createOscillator();
    o2.type = 'square'; o2.frequency.value = 800 * pr;
    o2.connect(mix);
    o2.start(when); o2.stop(when + 0.3);
  }

  function playVoice(t, when, opts) {
    switch (t) {
      case 0:  playBD(when, opts); break;
      case 1:  playSD(when, opts); break;
      case 2:  playRS(when, opts); break;
      case 3:  playCP(when, opts); break;
      case 4:  playTom(when, opts,  65); break;  // BT (bass tom — lowest)
      case 5:  playTom(when, opts,  90); break;  // LT
      case 6:  playTom(when, opts, 120); break;  // MT
      case 7:  playTom(when, opts, 155); break;  // HT
      case 8:  playHat(when, opts, 0.04, 7000); break;  // CH
      case 9:  playHat(when, opts, 0.25, 6000); break;  // OH
      case 10: playCY(when, opts); break;
      case 11: playCB(when, opts); break;
    }
  }

  // ─── Trig flag & step evaluation ────────────────────────────────────────
  function effectiveFlags(trk, s) {
    const f = getTrigFlags(trk.trigBits, s);
    // If step has no per-step flags set (f == 0), the track default applies.
    // The editor uses the same rule.  A trig is "on" only if ENABLE bit is set.
    return f;
  }

  // ─── Scheduler ──────────────────────────────────────────────────────────
  // Per-track lookahead: for each track, maintain nextTickOfTrig (absolute,
  // in global tick units) and stepIdx (current position in track loop).
  // Each tick duration is E.tickDur seconds.
  //
  // On each scheduler wake-up, advance every track whose next trig time is
  // within the lookahead window and schedule the audible hits.

  const TS = [];   // per-track scheduler state

  function initTrackState(meta) {
    TS.length = 0;
    for (let t = 0; t < 12; t++) {
      const trk = readTrack(t);
      if (!trk) return false;
      TS.push({
        trk,
        stepDur:    trackStepTicks(trk, meta),
        nSteps:     trackNumSteps(trk, meta),
        stepIdx:    0,
        nextTick:   0,        // absolute tick of current step boundary
      });
    }
    E.cycleCount     = new Int32Array(12);
    E.prevCondResult = new Int8Array(12).fill(-1);
    E.lastNeiResult  = new Int8Array(12).fill(-1);
    E.firstPlayCycle = new Int8Array(12).fill(1);
    return true;
  }

  function scheduleStep(ts, t, tickOfStep) {
    const trk = ts.trk;
    const s = ts.stepIdx;
    const flags = effectiveFlags(trk, s);
    const enabled = (flags & AR_TRIG_ENABLE) !== 0;
    const muted   = (flags & AR_TRIG_MUTE)   !== 0;
    const accent  = (flags & AR_TRIG_ACCENT) !== 0;
    const hasSwing= (flags & AR_TRIG_SWING)  !== 0;
    // Lock trigs: SYN and SMP voices don't retrigger → no audible hit,
    // even though plocks on the step still apply on hardware.
    const voices  = (flags & (AR_TRIG_SYN_PL_SW | AR_TRIG_SMP_PL_SW)) !== 0;

    if (!enabled || muted || !voices) return;

    // Evaluate condition (or fall back to track probability)
    const cond = getStepCondition(trk, s);
    let plays;
    if (cond !== null) {
      plays = evalCondition(cond, t);
      E.prevCondResult[t] = plays ? 1 : 0;
      E.lastNeiResult[t]  = plays ? 1 : 0;
    } else {
      plays = Math.random() * 100 < trk.probability;
    }
    if (!plays) return;

    // Micro-timing (signed, in 1/384ths of 16 steps @ this track's speed)
    // µT unit = stepDur / 24 ticks (matches NOTES table)
    const raw = AR.state.pattern.raw;
    const microRaw = raw[trk.micros + s] & UTIME_VALUE_MASK;
    const microSigned = (microRaw & UTIME_SIGN_BIT) ? microRaw - 64 : microRaw;
    const microTicks = microSigned * (ts.stepDur / 24);

    // Swing: delay odd-indexed steps (s=1,3,5,...) by (pct-50)/50 * stepDur
    const meta = getPatternMeta();
    let swingTicks = 0;
    if (hasSwing && meta.swingAmount > 0 && (s & 1) === 1) {
      swingTicks = (meta.swingAmount / 50) * ts.stepDur;
    }

    const hitTick = tickOfStep + microTicks + swingTicks;
    // Clamp to ctx.currentTime so that all envelope setValueAtTime/ramp calls
    // happen in the future.  If `when` were in the past, the gain envelope
    // would complete instantly and the voice would be silent (bug we hit on
    // early/negative µT trigs scheduled slightly after their nominal time).
    const rawWhen = E.startTime + hitTick * E.tickDur;
    const when = Math.max(rawWhen, E.ctx.currentTime + 0.002);

    // Velocity: per-step lock or default
    const veloLoc = raw[trk.velos + s];
    const velo = (veloLoc === PLOCK_NO_VALUE) ? trk.defVelo : veloLoc;
    // Note: per-step lock or default
    const noteLoc = raw[trk.notes + s] & NOTE_VALUE_MASK;
    const note = (noteLoc === NOTE_UNLOCKED) ? trk.defNote : noteLoc;

    const gain = Math.min(1, (velo / 127) * (accent ? 1.35 : 1.0));
    // Tonal voices transpose from default note
    const pitchRatio = Math.pow(2, (note - trk.defNote) / 12);

    const opts = {
      gain,
      pitchRatio,
      dest: E.master,
    };

    // Retrig
    const retrigOn = (flags & AR_TRIG_RETRIG) !== 0;
    if (retrigOn) {
      const rateIdx = raw[trk.retrigRates + s] & RETRIG_RATE_MASK;
      const rateTicks = RETRIG_TICKS[rateIdx] || TICKS_PER_STEP_1X;

      // Retrig LEN uses the same note-length encoding as NOTE_LEN
      // (1/16-note step units).  1 step = 720 ticks absolute.
      // Value 127 = ∞ → run until the next enabled trig on this track
      // (or end of the pattern loop if there is none).
      const lenRaw = raw[trk.retrigLens + s] & RETRIG_LEN_VALUE_MASK;
      let activeTicks;
      if (lenRaw === 127) {
        activeTicks = ticksUntilNextTrig(ts, s);
      } else {
        activeTicks = noteLenToSteps(lenRaw) * TICKS_PER_STEP_1X;
      }

      // Number of hits including the initial one: floor(active / rate) + 1,
      // but cap at the natural "active duration / rate" count.
      const numHits = Math.max(1, Math.floor(activeTicks / rateTicks));

      // Velocity offset is signed around 0 (byte: 0..127 = 0..+127, 128..255 = -128..-1)
      const vOffRaw = raw[trk.retrigVelos + s];
      const vOffSigned = vOffRaw > 127 ? vOffRaw - 256 : vOffRaw;

      for (let i = 0; i < numHits; i++) {
        const subRaw = rawWhen + i * rateTicks * E.tickDur;
        const subWhen = Math.max(subRaw, E.ctx.currentTime + 0.002);
        const velScale = Math.max(0, Math.min(1,
          1 + (i / Math.max(1, numHits - 1)) * (vOffSigned / 127)));
        playVoice(t, subWhen, { ...opts, gain: gain * velScale });
      }
    } else {
      playVoice(t, when, opts);
    }
  }

  function schedulerTick() {
    if (!E.playing) return;
    const horizon = E.ctx.currentTime + SCHEDULE_AHEAD;
    const meta = getPatternMeta();
    if (!meta) { stop(); return; }

    // Convert horizon wall time → tick horizon
    const horizonTick = (horizon - E.startTime) / E.tickDur;

    // Advance each track
    for (let t = 0; t < 12; t++) {
      const ts = TS[t];
      // Recompute step duration each loop — editor might have changed speed
      ts.stepDur = trackStepTicks(ts.trk, meta);
      ts.nSteps  = trackNumSteps(ts.trk, meta);

      while (ts.nextTick < horizonTick) {
        scheduleStep(ts, t, ts.nextTick);
        ts.nextTick += ts.stepDur;
        ts.stepIdx++;
        if (ts.stepIdx >= ts.nSteps) {
          ts.stepIdx = 0;
          E.cycleCount[t]++;
          E.firstPlayCycle[t] = 0;
        }
      }
    }

    E.timerId = setTimeout(schedulerTick, LOOKAHEAD_MS);
  }

  // ─── Playhead highlight (visual feedback in grid) ───────────────────────
  function updatePlayhead() {
    if (!E.playing) return;
    const ctx = E.ctx;
    if (ctx) {
      // Track 0 step cursor based on BD track timing.
      // Compensate for audio output latency: what we HEAR at this instant
      // corresponds to ctx.currentTime - outputLatency.
      const ts0 = TS[0];
      if (ts0) {
        const lat = (ctx.outputLatency || ctx.baseLatency || 0);
        const nowTick = (ctx.currentTime - lat - E.startTime) / E.tickDur;
        const posInLoop = ((nowTick % (ts0.stepDur * ts0.nSteps)) + ts0.stepDur * ts0.nSteps) % (ts0.stepDur * ts0.nSteps);
        const curStep = Math.floor(posInLoop / ts0.stepDur);
        if (curStep !== E.highlightStep) {
          E.highlightStep = curStep;
          highlightGridStep(curStep);
        }
      }
    }
    E.rafId = requestAnimationFrame(updatePlayhead);
  }

  function highlightGridStep(step) {
    const grid = document.getElementById('grid');
    if (!grid) return;
    const prev = grid.querySelectorAll('.step.playhead');
    prev.forEach(el => el.classList.remove('playhead'));
    // Step index in 0..63; visible only if on current page
    const page = AR.state.ui.stepPage;
    const localStep = step - page * 32;
    if (localStep < 0 || localStep >= 32) return;
    const rows = grid.querySelectorAll('.track-row');
    rows.forEach(row => {
      const cells = row.querySelectorAll('.step');
      if (localStep < cells.length) cells[localStep].classList.add('playhead');
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────
  function start() {
    if (E.playing || !AR.state.pattern.raw) return;
    if (!E.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      E.ctx = new Ctx();
      E.master = E.ctx.createGain();
      E.master.gain.value = 0.8;
      E.master.connect(E.ctx.destination);
      E.noiseBuf = makeNoise(E.ctx);
    }
    if (E.ctx.state === 'suspended') E.ctx.resume();

    const meta = getPatternMeta();
    if (!meta || !meta.bpm) { AR.setStatus('audio: no BPM in pattern', 'err'); return; }

    E.bpm     = meta.bpm;
    E.tickDur = 60 / (meta.bpm * 2880);    // seconds per tick (2880 PPQN)
    E.startTime  = E.ctx.currentTime + 0.05;
    E.tickCursor = 0;
    if (!initTrackState(meta)) return;

    E.playing = true;
    const btn = document.getElementById('btn-play');
    if (btn) { btn.textContent = '■ Stop'; btn.classList.add('playing'); }
    schedulerTick();
    updatePlayhead();
  }

  function stop() {
    E.playing = false;
    if (E.timerId) { clearTimeout(E.timerId); E.timerId = null; }
    if (E.rafId)   { cancelAnimationFrame(E.rafId); E.rafId = null; }
    const btn = document.getElementById('btn-play');
    if (btn) { btn.textContent = '▶ Play'; btn.classList.remove('playing'); }
    // Clear highlight
    E.highlightStep = -1;
    const grid = document.getElementById('grid');
    if (grid) grid.querySelectorAll('.step.playhead').forEach(el => el.classList.remove('playhead'));
  }

  function toggle() { if (E.playing) stop(); else start(); }

  function setFillMode(on) {
    E.fillMode = !!on;
    const btn = document.getElementById('btn-fill');
    if (btn) btn.classList.toggle('active', E.fillMode);
  }

  // ─── Wire up buttons after DOM ready ────────────────────────────────────
  function init() {
    const btnPlay = document.getElementById('btn-play');
    const btnFill = document.getElementById('btn-fill');
    if (btnPlay) {
      btnPlay.addEventListener('click', toggle);
      btnPlay.disabled = false;
    }
    if (btnFill) {
      btnFill.addEventListener('click', () => setFillMode(!E.fillMode));
      btnFill.disabled = false;
    }
    // Keyboard shortcut: spacebar toggles play
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        toggle();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging
  AR.audio = { start, stop, toggle, setFillMode, _state: E };
})();
