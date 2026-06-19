// ─── Groove / shuffle templates (auto micro-timing) ──────────────────────────
// Applies a per-track timing "feel" by writing the pattern's micro-timing bytes.
// Two families, both anchored to the quarter-note pulse so they never re-meter:
//
//   SHUFFLE (shapes)  — keep the downbeats fixed, re-space the 4 sixteenths of
//     each beat onto an n-tuplet grid.  A shape is written as a pattern string
//     (e.g. "x-x-x-x"): n = string length, the 4 'x' positions are the tuplet
//     slots the sixteenths land on.  The offset of the j-th sixteenth, in
//     micro-timing units (1 unit = 1/24 step), is:
//                 offset_j = 96 · slot_j / n  −  24 · j
//     A 0–100% STRENGTH slider interpolates straight-16ths → full shape.
//
//   PULL / PUSH        — move every trig toward (or away from, slider goes ±)
//     its nearest anchor by a fraction of the distance.  Anchors are either the
//     quarters or a 3:3:2 clave.  At +100% a note lands on its anchor (far ones
//     clamp at the ±1-step ceiling, which is the natural cap).
//
//   HUMANIZE           — seeded (deterministic) random jitter.
//
// Non-cumulative baseline model: the manual micro-timing is snapshotted when a
// feel is first engaged; the written value is recomputed each change as
//   clamp(baseline + applied_offset, ±23) ,
// so the slider is continuous and reversible.  Trig-condition bits (7..6) are
// preserved — only the low 6 bits are touched.
//
// Depends on: ar-state.js, ar-constants.js

(function () {
  'use strict';

  const S = AR.state;
  const LIMIT = 23;          // device-displayed micro-timing range (±23 units)
  const UNITS_PER_STEP = 24; // micro-timing units per 16th step
  const HUMAN_PEAK = 10;     // ±units at 100% humanize

  // 3:3:2 clave (tresillo) onsets within a 16-step bar.
  const CLAVE_ANCHORS = [0, 3, 6, 8, 11, 14];

  // ─── Templates ────────────────────────────────────────────────────────────
  // Shuffle shapes, written in the pattern notation discussed.  n = length,
  // 'x' = a tuplet slot a sixteenth lands on (must be exactly 4 per shape).
  const SHAPE_PATTERNS = [
    'x-x-x-x',     // 7
    'x-x--x-x-',   // 9
    'xx-xx',       // 5
    'xx--xx',      // 6
    'xx---x-x',    // 8
    'xx----x-x',   // 9
  ];

  function shapeOffsets(pat) {
    const n = pat.length;
    const slots = [];
    for (let k = 0; k < n; k++) if (pat[k] === 'x') slots.push(k);
    // offset_j (µT units) = 96·slot_j/n − 24·j   (96 = 4 sixteenths × 24 units)
    return slots.map((sl, j) => (96 * sl / n) - (UNITS_PER_STEP * j));
  }

  const TEMPLATES = { none: { name: 'None' } };
  SHAPE_PATTERNS.forEach((pat, i) => {
    TEMPLATES['shape' + i] = {
      name: pat.length + ' · ' + pat,
      kind: 'shape',
      off: shapeOffsets(pat),   // 4-entry per-beat offset template, units, @100%
    };
  });
  TEMPLATES.pullQ = { name: 'Pull → Quarter',     kind: 'pull', anchors: 'quarters' };
  TEMPLATES.pullC = { name: 'Pull → Clave 3:3:2', kind: 'pull', anchors: 'clave'   };
  TEMPLATES.human = { name: 'Humanize',           kind: 'random' };

  function kindOf(key) { return (TEMPLATES[key] && TEMPLATES[key].kind) || null; }

  // Grouped list for the dropdown.
  function groups() {
    return [
      { label: '',                 items: [{ key: 'none', name: 'None' }] },
      { label: 'Shuffle (0–100%)', items: SHAPE_PATTERNS.map((_, i) => ({ key: 'shape' + i, name: TEMPLATES['shape' + i].name })) },
      { label: 'Pull / Push (±)',  items: [{ key: 'pullQ', name: TEMPLATES.pullQ.name }, { key: 'pullC', name: TEMPLATES.pullC.name }] },
      { label: 'Random (0–100%)',  items: [{ key: 'human', name: TEMPLATES.human.name }] },
    ];
  }

  // ─── Anchor distance (signed steps to nearest anchor) ────────────────────
  function nearestAnchorDist(s, anchors) {
    if (anchors === 'quarters') return Math.round(s / 4) * 4 - s;
    let best = 999;
    for (const a of CLAVE_ANCHORS) {
      for (let k = -1; k <= 1; k++) {
        const d = (a + 16 * k) - s;
        if (Math.abs(d) < Math.abs(best)) best = d;
      }
    }
    return best;
  }

  // Largest anchor-distance over a period — used to normalise the pull slider so
  // +100% slides the *farthest* note exactly one step (the µT ceiling), with
  // nearer notes proportionally less.  Quarters → 2 (the '&'); clave → 1.
  function maxAnchorDist(anchors) {
    const span = anchors === 'quarters' ? 4 : 16;
    let m = 0;
    for (let s = 0; s < span; s++) {
      const d = Math.abs(nearestAnchorDist(s, anchors));
      if (d > m) m = d;
    }
    return m || 1;
  }

  // Deterministic per (track, step) jitter in [-1, 1].
  function seeded(s, t) {
    let x = Math.sin((t + 1) * 12.9898 + (s + 1) * 78.233) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  }

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

  // Offset (µT units) the active template applies to step s, before strength=0 short-circuit.
  function templateOffset(tpl, s, t, amt) {
    if (tpl.kind === 'shape')  return (amt / 100) * tpl.off[s % 4];
    if (tpl.kind === 'pull') {
      if (tpl._maxD === undefined) tpl._maxD = maxAnchorDist(tpl.anchors);
      return (amt / 100) * (nearestAnchorDist(s, tpl.anchors) / tpl._maxD) * UNITS_PER_STEP;
    }
    if (tpl.kind === 'random') return (amt / 100) * seeded(s, t) * HUMAN_PEAK;
    return 0;
  }

  // Recompute micro-timing bytes for track t from baseline + template.
  function apply(t) {
    const raw = S.pattern.raw;
    if (!raw) return;
    const st  = ensure(t);
    const tpl = TEMPLATES[st.tpl] || TEMPLATES.none;
    const base = 4 + t * AR_TRACK_V5_SZ;
    const active = st.tpl !== 'none' && tpl.kind && st.amt !== 0;
    for (let s = 0; s < AR_NUM_STEPS; s++) {
      const byte   = raw[base + MICRO_TIMING_OFFSET + s];
      const upper  = byte & UTIME_UPPER_MASK;            // preserve trig-condition bits
      const bl     = st.base ? st.base[s] : (byte & UTIME_VALUE_MASK);
      const add    = active ? Math.round(templateOffset(tpl, s, t, st.amt)) : 0;
      const v      = clampUnit(low6ToSigned(bl) + add);
      raw[base + MICRO_TIMING_OFFSET + s] = upper | (v & UTIME_VALUE_MASK);
    }
  }

  // Default slider position when a template is selected.
  function defaultAmt(key) {
    const k = kindOf(key);
    if (k === 'shape')  return 100;
    if (k === 'random') return 50;
    return 0;  // pull starts centred (no effect); none → 0
  }

  // ─── Public API (called from the track-defaults panel) ───────────────────
  AR.groove = {
    groups, kindOf, ensure,

    setTemplate(t, key) {
      const st = ensure(t);
      if (!TEMPLATES[key]) return;
      if (key !== 'none' && (st.tpl === 'none' || !st.base)) captureBaseline(t);
      st.tpl = key;
      st.amt = defaultAmt(key);
      apply(t);
    },

    setAmount(t, val) {
      const st = ensure(t);
      const min = kindOf(st.tpl) === 'pull' ? -100 : 0;
      st.amt = Math.max(min, Math.min(100, val | 0));
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

    // Forget all groove state (called when a new pattern is loaded).
    resetAll() { S.ui.groove = {}; },
  };
})();
