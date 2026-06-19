// ─── Groove / shuffle templates (auto micro-timing) ──────────────────────────
// Applies a per-track shuffle "feel" by writing the pattern's micro-timing
// bytes.  Templates are classic groove feels (16th/8th swing, triplet, laid-back
// backbeat, push, 3:3:2 clave, humanize) — the same families popularised by
// shuffle machines like Stolperbeats, none of which are novel inventions.
//
// Model (see discussion): each track keeps a BASELINE snapshot of its manual
// micro-timing, captured the moment a template is first engaged.  The written
// value is  clamp(baseline[s] + amount * template(s)) , recomputed from the
// baseline on every change — so the amount slider is continuous and reversible
// (dragging back to 0 restores the hand-tuned offsets) rather than cumulative.
//
// Micro-timing encoding (ar-constants.js): byte = (condition_bits<<6) | signed6,
// unit = 1/24 of a step.  We preserve bits 7..6 (trig conditions) and only
// touch the low 6 bits.  Values are clamped to the device-displayed ±23 range.
//
// Depends on: ar-state.js, ar-constants.js

(function () {
  'use strict';

  const S = AR.state;
  const LIMIT = 23;   // device-displayed micro-timing range (±23 units = ±~1 step)

  // ─── Templates ────────────────────────────────────────────────────────────
  // fn(stepIndex, trackIndex) → peak offset in micro-timing units at amount=100%.
  // Swing math: delay(units) = 24 * 2 * (swing% / 100 - 0.5).
  //   62% ≈ 6,  66.7% (triplet) = 8,  75% = 12.
  const TEMPLATES = {
    none:  { name: 'None' },
    sw16:  { name: '16th Swing', fn: (s) => (s % 2 === 1) ? 12 : 0 },
    sw8:   { name: '8th Swing',  fn: (s) => (s % 4 === 2) ? 12 : 0 },
    trip:  { name: 'Triplet',    fn: (s) => (s % 2 === 1) ? 8  : 0 },
    laid:  { name: 'Laid-back',  fn: (s) => { const m = s % 16; return (m === 4 || m === 12) ? 8 : 0; } },
    push:  { name: 'Push',       fn: (s) => (s % 4 === 3) ? -8 : 0 },
    clave: { name: 'Clave 3:3:2', fn: (s) => {
              const m = s % 16;
              if (m === 0 || m === 6 || m === 12) return 0;  // 3:3:2 anchors stay fixed
              return (s % 2 === 1) ? 10 : 0;                  // the rest swings around them
            } },
    human: { name: 'Humanize',   fn: (s, t) => {
              // Deterministic per (track, step) so re-renders are stable.
              let x = Math.sin((t + 1) * 12.9898 + (s + 1) * 78.233) * 43758.5453;
              x -= Math.floor(x);
              return Math.round((x * 2 - 1) * 6);
            } },
  };
  const ORDER = ['none','sw16','sw8','trip','laid','push','clave','human'];

  // ─── Per-track state (lives in session UI state) ─────────────────────────
  function ensure(t) {
    if (!S.ui.groove) S.ui.groove = {};
    if (!S.ui.groove[t]) S.ui.groove[t] = { tpl: 'none', amt: 0, base: null };
    return S.ui.groove[t];
  }

  function captureBaseline(t) {
    const raw = S.pattern.raw;
    if (!raw) return;
    const base = 4 + t * AR_TRACK_V5_SZ;
    const st = ensure(t);
    st.base = new Uint8Array(AR_NUM_STEPS);
    for (let s = 0; s < AR_NUM_STEPS; s++) {
      st.base[s] = raw[base + MICRO_TIMING_OFFSET + s] & UTIME_VALUE_MASK;
    }
  }

  function low6ToSigned(v) { return (v & UTIME_SIGN_BIT) ? v - 64 : v; }
  function clampUnit(v)    { return Math.max(-LIMIT, Math.min(LIMIT, v)); }

  // Recompute micro-timing bytes for track t from baseline + template*amount.
  function apply(t) {
    const raw = S.pattern.raw;
    if (!raw) return;
    const st  = ensure(t);
    const tpl = TEMPLATES[st.tpl] || TEMPLATES.none;
    const base = 4 + t * AR_TRACK_V5_SZ;
    const active = st.tpl !== 'none' && tpl.fn && st.amt > 0;
    for (let s = 0; s < AR_NUM_STEPS; s++) {
      const off    = raw[base + MICRO_TIMING_OFFSET + s];
      const upper  = off & UTIME_UPPER_MASK;             // preserve trig-condition bits
      const bl     = st.base ? st.base[s] : (off & UTIME_VALUE_MASK);
      const baseSigned = low6ToSigned(bl);
      const add    = active ? Math.round((st.amt / 100) * tpl.fn(s, t)) : 0;
      const v      = clampUnit(baseSigned + add);
      raw[base + MICRO_TIMING_OFFSET + s] = upper | (v & UTIME_VALUE_MASK);
    }
  }

  // ─── Public API (called from the track-defaults panel) ───────────────────
  AR.groove = {
    templates() { return ORDER.map(k => ({ key: k, name: TEMPLATES[k].name })); },
    ensure,

    setTemplate(t, key) {
      const st = ensure(t);
      if (!TEMPLATES[key]) return;
      // Snapshot the manual micro-timing the first time a feel is engaged.
      if (key !== 'none' && (st.tpl === 'none' || !st.base)) captureBaseline(t);
      st.tpl = key;
      apply(t);
    },

    setAmount(t, val) {
      const st = ensure(t);
      st.amt = Math.max(0, Math.min(100, val | 0));
      if (st.tpl !== 'none' && !st.base) captureBaseline(t);
      apply(t);
    },

    // Zero all micro-timing on the track (preserving trig-condition bits) and
    // clear the groove state — a clean slate.
    resetMicro(t) {
      const raw = S.pattern.raw;
      if (!raw) return;
      const base = 4 + t * AR_TRACK_V5_SZ;
      for (let s = 0; s < AR_NUM_STEPS; s++) {
        raw[base + MICRO_TIMING_OFFSET + s] &= UTIME_UPPER_MASK;
      }
      S.ui.groove[t] = { tpl: 'none', amt: 0, base: null };
    },

    // Forget all groove state (called when a new pattern is loaded; the loaded
    // micro-timing becomes the baseline again on next use).
    resetAll() { S.ui.groove = {}; },
  };
})();
