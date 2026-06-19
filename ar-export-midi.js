// ─── MIDI file export ────────────────────────────────────────────────────────
// Renders the current pattern to Standard MIDI Files — one Type-0 file per
// track — so each voice can be dragged onto its own track in a DAW (e.g. Logic's
// Drum Machine Designer).  Each file triggers a single, user-configurable MIDI
// note for that track, so polymetric/per-track-length voices loop independently.
//
// The timing math here MIRRORS ar-audio.js so the exported MIDI matches what the
// built-in preview plays: 2880-PPQN grid, per-track speed, micro-timing, swing,
// and retrig expansion.  Constants/offsets come from ar-constants.js (globals);
// getTrigFlags() from ar-sysex.js.
//
// Depends on: ar-state.js, ar-constants.js, ar-sysex.js

(function () {
  'use strict';

  const S = AR.state;

  // ─── Timing constants (mirror ar-audio.js) ───────────────────────────────
  const TICKS_PER_WHOLE   = 11520;
  const TICKS_PER_STEP_1X = 720;        // 1/16 at 1× speed; also the MIDI PPQN×4
  const PPQN              = 2880;        // ticks per quarter note (MIDI division)
  const MIN_GATE          = 10;         // minimum note duration in ticks

  // Speed index (0–6) → ticks per step.  ['2x','3/2x','1x','3/4x','1/2x','1/4x','1/8x']
  const SPEED_TICKS = [
    TICKS_PER_STEP_1X / 2, (TICKS_PER_STEP_1X * 2) / 3, TICKS_PER_STEP_1X,
    (TICKS_PER_STEP_1X * 4) / 3, TICKS_PER_STEP_1X * 2, TICKS_PER_STEP_1X * 4,
    TICKS_PER_STEP_1X * 8,
  ];

  // Retrig rate index (0–16) → ticks.  Absolute, not speed-scaled.
  const RETRIG_DENOMS = [1,2,3,4,5,6,8,10,12,16,20,24,32,40,48,64,80];
  const RETRIG_TICKS  = RETRIG_DENOMS.map(d => TICKS_PER_WHOLE / d);

  // Note-length encoding → duration in 1/16-note steps.  127 = ∞.
  const NLEN_RANGES = [
    [0,0.125,0.0625],[14,1,0.0625],[30,2,0.125],[46,4,0.25],
    [62,8,0.5],[78,16,1],[94,32,2],[110,64,4],
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

  // ─── Note name helpers (Logic convention: middle C = 60 = "C3") ──────────
  const NOTE_LETTERS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  function noteName(n) {
    return NOTE_LETTERS[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 2);
  }
  function parseNote(str) {
    if (str == null) return null;
    str = String(str).trim();
    if (/^\d+$/.test(str)) {
      const n = parseInt(str, 10);
      return (n >= 0 && n <= 127) ? n : null;
    }
    const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(str);
    if (!m) return null;
    const base = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 }[m[1].toUpperCase()];
    const acc  = m[2] === '#' ? 1 : (m[2] === 'b' ? -1 : 0);
    const n    = base + acc + (parseInt(m[3], 10) + 2) * 12;
    return (n >= 0 && n <= 127) ? n : null;
  }

  // ─── Default per-track note map (GM drum map) ────────────────────────────
  // Indexed by track: BD SD RS CP BT LT MT HT CH OH CY CB FX
  const DEFAULT_NOTE_MAP = [36,38,37,39,41,45,47,50,42,46,49,56,60];

  // ─── Persisted settings ──────────────────────────────────────────────────
  const LS_KEY = 'plock.midiExport';
  const cfg = {
    noteMap: DEFAULT_NOTE_MAP.slice(),
    channel: 10,
    micro:   true,
    noteLen: true,
    retrigs: true,
  };
  (function loadCfg() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY));
      if (saved && Array.isArray(saved.noteMap) && saved.noteMap.length === 13) {
        cfg.noteMap = saved.noteMap.map((v, i) => {
          const n = Number(v);
          return (n >= 0 && n <= 127) ? n : DEFAULT_NOTE_MAP[i];
        });
      }
      if (saved && saved.channel >= 1 && saved.channel <= 16) cfg.channel = saved.channel;
      if (saved && typeof saved.micro   === 'boolean') cfg.micro   = saved.micro;
      if (saved && typeof saved.noteLen === 'boolean') cfg.noteLen = saved.noteLen;
      if (saved && typeof saved.retrigs === 'boolean') cfg.retrigs = saved.retrigs;
    } catch (e) {}
  })();
  function saveCfg() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  // ─── Pattern meta (mirror ar-audio.js getPatternMeta) ────────────────────
  function getMeta() {
    const raw = S.pattern.raw;
    if (!raw) return null;
    const settings = S.settings.raw;
    const isPrj = settings && settings.length > SETTINGS_BPM_MODE_OFFSET &&
                  settings[SETTINGS_BPM_MODE_OFFSET] === 0x00;
    const bpmRaw = isPrj
      ? (settings[SETTINGS_BPM_MSB_OFFSET] << 8) | settings[SETTINGS_BPM_LSB_OFFSET]
      : (raw[BPM_MSB_OFFSET] << 8) | raw[BPM_LSB_OFFSET];
    const rawMasterLen = (raw[MASTER_LENGTH_OFFSET] << 8) | raw[MASTER_LENGTH_OFFSET + 1];
    return {
      bpm:         bpmRaw ? bpmRaw / 120 : 120,
      swingAmount: raw[SWING_AMOUNT_OFFSET],
      scaleMode:   raw[SCALE_MODE_OFFSET],
      masterSpeed: raw[MASTER_SPEED_OFFSET] & SPEED_VALUE_MASK,
      masterLen:   rawMasterLen || 64,
    };
  }

  function trackBase(t)        { return 4 + t * AR_TRACK_V5_SZ; }
  function trackStepTicks(t, meta) {
    const speedByte = S.pattern.raw[trackBase(t) + TRACK_SPEED_OFFSET];
    const idx = meta.scaleMode ? (speedByte & SPEED_VALUE_MASK) : meta.masterSpeed;
    return SPEED_TICKS[idx];
  }
  function trackNumSteps(t, meta) {
    if (meta.scaleMode) {
      const n = S.pattern.raw[trackBase(t) + NUM_STEPS_OFFSET] || 16;
      return Math.max(1, Math.min(64, n));
    }
    const m = meta.masterLen;
    return (m === 0 || m === 1) ? 64 : Math.min(64, m);
  }

  // Ticks from `fromStep` to the next enabled trig on this track (for ∞ retrig).
  function ticksUntilNextTrig(trigBits, fromStep, nSteps, stepDur) {
    for (let i = 1; i <= nSteps; i++) {
      const ns = (fromStep + i) % nSteps;
      if ((getTrigFlags(trigBits, ns) & AR_TRIG_ENABLE) !== 0) return i * stepDur;
    }
    return nSteps * stepDur;
  }

  // ─── Build the note event list for one track ─────────────────────────────
  // Returns { events: [{tick, dur, vel}], loopTicks } or null if no audible trigs.
  function buildTrackNotes(t, meta) {
    const raw      = S.pattern.raw;
    const base     = trackBase(t);
    const trigBits = raw.subarray(base + TRIG_BITS_OFFSET, base + 112);
    const stepDur  = trackStepTicks(t, meta);
    const nSteps   = trackNumSteps(t, meta);
    const loopTicks = Math.round(nSteps * stepDur);
    const defVelo  = raw[base + DEFAULT_VELOCITY_OFFSET];
    const defLen   = raw[base + DEFAULT_NOTE_LEN_OFFSET];

    const events = [];

    for (let s = 0; s < nSteps; s++) {
      const flags    = getTrigFlags(trigBits, s);
      const enabled  = (flags & AR_TRIG_ENABLE) !== 0;
      const muted    = (flags & AR_TRIG_MUTE)   !== 0;
      // A trig with neither SYN nor SMP switch is a silent "lock trig".
      const voices   = (flags & (AR_TRIG_SYN_PL_SW | AR_TRIG_SMP_PL_SW)) !== 0;
      if (!enabled || muted || !voices) continue;

      const accent   = (flags & AR_TRIG_ACCENT) !== 0;
      const hasSwing = (flags & AR_TRIG_SWING)  !== 0;

      // Micro-timing (signed, in 1/384ths of 16 steps @ this track's speed).
      let microTicks = 0;
      if (cfg.micro) {
        const microRaw    = raw[base + MICRO_TIMING_OFFSET + s] & UTIME_VALUE_MASK;
        const microSigned = (microRaw & UTIME_SIGN_BIT) ? microRaw - 64 : microRaw;
        microTicks = microSigned * (stepDur / 24);
      }
      // Swing: delay odd-indexed steps.
      let swingTicks = 0;
      if (hasSwing && meta.swingAmount > 0 && (s & 1) === 1) {
        swingTicks = (meta.swingAmount / 50) * stepDur;
      }

      let hitTick = Math.round(s * stepDur + microTicks + swingTicks);
      if (hitTick < 0) hitTick = 0;

      // Velocity: per-step lock or track default, with accent boost.
      const veloLoc = raw[base + VELOCITY_OFFSET + s];
      const velo    = (veloLoc === PLOCK_NO_VALUE) ? defVelo : veloLoc;
      const baseVel = Math.max(1, Math.min(127, Math.round(velo * (accent ? 1.25 : 1))));

      // Note duration from note-length encoding.
      const lenLoc  = raw[base + NOTE_LEN_OFFSET + s];
      const lenVal  = (lenLoc === PLOCK_NO_VALUE) ? defLen : lenLoc;
      const lenSteps = cfg.noteLen ? noteLenToSteps(lenVal) : 1;
      let dur = isFinite(lenSteps)
        ? Math.round(lenSteps * TICKS_PER_STEP_1X)
        : Math.max(MIN_GATE, loopTicks - hitTick);   // ∞ → ring to end of loop
      dur = Math.max(MIN_GATE, dur);

      const retrigOn = (flags & AR_TRIG_RETRIG) !== 0;
      if (cfg.retrigs && retrigOn) {
        const rateIdx   = raw[base + RETRIG_RATE_OFFSET + s] & RETRIG_RATE_MASK;
        const rateTicks = RETRIG_TICKS[rateIdx] || TICKS_PER_STEP_1X;
        const lenRaw    = raw[base + RETRIG_LENGTH_OFFSET + s] & RETRIG_LEN_VALUE_MASK;
        const activeTicks = (lenRaw === 127)
          ? ticksUntilNextTrig(trigBits, s, nSteps, stepDur)
          : noteLenToSteps(lenRaw) * TICKS_PER_STEP_1X;
        const numHits = Math.max(1, Math.floor(activeTicks / rateTicks));
        const vOffRaw = raw[base + RETRIG_VELO_OFFSET + s];
        const vOffSigned = vOffRaw > 127 ? vOffRaw - 256 : vOffRaw;
        const subDur = Math.max(MIN_GATE, Math.round(rateTicks * 0.9));
        for (let i = 0; i < numHits; i++) {
          const subTick = hitTick + Math.round(i * rateTicks);
          const scale   = Math.max(0, Math.min(1,
            1 + (i / Math.max(1, numHits - 1)) * (vOffSigned / 127)));
          const v = Math.max(1, Math.min(127, Math.round(baseVel * scale)));
          events.push({ tick: subTick, dur: subDur, vel: v });
        }
      } else {
        events.push({ tick: hitTick, dur, vel: baseVel });
      }
    }

    return events.length ? { events, loopTicks } : null;
  }

  // ─── Standard MIDI File writer ───────────────────────────────────────────
  function writeVarLen(out, value) {
    let buffer = value & 0x7F;
    while ((value >>= 7) > 0) { buffer = (buffer << 8) | ((value & 0x7F) | 0x80); }
    while (true) { out.push(buffer & 0xFF); if (buffer & 0x80) buffer >>= 8; else break; }
  }
  function pushStr(out, str) { for (let i = 0; i < str.length; i++) out.push(str.charCodeAt(i) & 0xFF); }
  function push32(out, v) { out.push((v>>>24)&0xFF, (v>>>16)&0xFF, (v>>>8)&0xFF, v&0xFF); }

  // Build a Type-0 SMF for one track from its note list.
  function buildSMF(noteList, trackName, midiNote, channel, bpm) {
    const ch = (channel - 1) & 0x0F;
    const note = midiNote & 0x7F;

    // Flatten to on/off events with ordering: meta(0) < off(1) < on(2) at same tick.
    const evs = [];
    for (const n of noteList.events) {
      const off = Math.min(noteList.loopTicks, n.tick + n.dur);
      evs.push({ tick: n.tick, order: 2, bytes: [0x90 | ch, note, n.vel] });
      evs.push({ tick: off,    order: 1, bytes: [0x80 | ch, note, 0x40] });
    }
    evs.sort((a, b) => (a.tick - b.tick) || (a.order - b.order));

    const trk = [];
    // Track name
    trk.push(0x00, 0xFF, 0x03); writeVarLen(trk, trackName.length); pushStr(trk, trackName);
    // Tempo (µs per quarter)
    const usPerQ = Math.round(60000000 / bpm);
    trk.push(0x00, 0xFF, 0x51, 0x03, (usPerQ>>16)&0xFF, (usPerQ>>8)&0xFF, usPerQ&0xFF);
    // Time signature 4/4
    trk.push(0x00, 0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);

    let last = 0;
    for (const e of evs) {
      writeVarLen(trk, e.tick - last);
      last = e.tick;
      for (const b of e.bytes) trk.push(b);
    }
    // End of track at loop boundary so the region length matches the loop.
    writeVarLen(trk, Math.max(0, noteList.loopTicks - last));
    trk.push(0xFF, 0x2F, 0x00);

    const out = [];
    pushStr(out, 'MThd'); push32(out, 6); out.push(0x00, 0x00, 0x00, 0x01);
    out.push((PPQN >> 8) & 0xFF, PPQN & 0xFF);
    pushStr(out, 'MTrk'); push32(out, trk.length);
    for (const b of trk) out.push(b);
    return new Uint8Array(out);
  }

  function sanitize(s) { return (s || 'pattern').replace(/[^\w.-]+/g, '_'); }

  function download(bytes, filename) {
    const blob = new Blob([bytes], { type: 'audio/midi' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ─── Run the export ──────────────────────────────────────────────────────
  function runExport() {
    if (!S.pattern.raw) { AR.setStatus('No pattern to export', 'err'); return; }
    const meta = getMeta();
    if (!meta || !meta.bpm) { AR.setStatus('Cannot export: no BPM in pattern', 'err'); return; }

    const patName = sanitize(S.pattern.name);
    const files = [];
    for (let t = 0; t < AR_NUM_TRACKS; t++) {
      const notes = buildTrackNotes(t, meta);
      if (!notes) continue;
      const name  = TRACK_NAMES[t];
      const smf   = buildSMF(notes, name, cfg.noteMap[t], cfg.channel, meta.bpm);
      const idx   = String(t + 1).padStart(2, '0');
      files.push({ bytes: smf, filename: `${patName}_${idx}_${name}.mid` });
    }

    if (!files.length) { AR.setStatus('No active trigs to export', 'err'); return; }

    // Fire downloads staggered slightly so browsers don't drop any.
    files.forEach((f, i) => setTimeout(() => download(f.bytes, f.filename), i * 60));
    AR.setStatus('Exported ' + files.length + ' MIDI file' + (files.length > 1 ? 's' : ''), 'ok');
  }

  // ─── Dialog UI ───────────────────────────────────────────────────────────
  function openDialog() {
    if (document.getElementById('midi-export-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'midi-export-overlay';
    overlay.className = 'modal-overlay';

    const panel = document.createElement('div');
    panel.className = 'modal-panel';

    const h = document.createElement('h2');
    h.className = 'modal-title';
    h.textContent = 'Export MIDI';
    panel.appendChild(h);

    const desc = document.createElement('div');
    desc.className = 'modal-desc';
    desc.innerHTML = 'One Standard MIDI File per track (only tracks with trigs). ' +
      'Each file triggers the note set below, so per-track lengths loop independently ' +
      'for polymeters. Drag each onto its voice / Drum&nbsp;Machine&nbsp;Designer pad.';
    panel.appendChild(desc);

    // Note-map grid (two columns)
    const map = document.createElement('div');
    map.className = 'midi-map-grid';
    for (let t = 0; t < AR_NUM_TRACKS; t++) {
      const row = document.createElement('label');
      row.className = 'midi-map-row';
      const lbl = document.createElement('span');
      lbl.className = 'midi-map-name';
      lbl.textContent = TRACK_NAMES[t];
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'midi-map-input';
      inp.value = noteName(cfg.noteMap[t]);
      inp.dataset.track = t;
      inp.addEventListener('change', () => {
        const n = parseNote(inp.value);
        if (n === null) { inp.value = noteName(cfg.noteMap[t]); return; }
        cfg.noteMap[t] = n;
        inp.value = noteName(n);
      });
      row.appendChild(lbl);
      row.appendChild(inp);
      map.appendChild(row);
    }
    panel.appendChild(map);

    // Options
    const opts = document.createElement('div');
    opts.className = 'midi-opts';
    function checkbox(key, text) {
      const l = document.createElement('label');
      l.className = 'midi-opt';
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = cfg[key];
      c.addEventListener('change', () => { cfg[key] = c.checked; });
      l.appendChild(c);
      l.appendChild(document.createTextNode(' ' + text));
      return l;
    }
    opts.appendChild(checkbox('micro',   'Micro-timing'));
    opts.appendChild(checkbox('noteLen', 'Note length'));
    opts.appendChild(checkbox('retrigs', 'Expand retrigs'));

    const chWrap = document.createElement('label');
    chWrap.className = 'midi-opt midi-chan';
    chWrap.appendChild(document.createTextNode('Channel '));
    const chSel = document.createElement('select');
    for (let i = 1; i <= 16; i++) {
      const o = document.createElement('option');
      o.value = i; o.textContent = i;
      if (i === cfg.channel) o.selected = true;
      chSel.appendChild(o);
    }
    chSel.addEventListener('change', () => { cfg.channel = parseInt(chSel.value, 10); });
    chWrap.appendChild(chSel);
    opts.appendChild(chWrap);
    panel.appendChild(opts);

    // Buttons
    const btns = document.createElement('div');
    btns.className = 'modal-btns';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    const exp = document.createElement('button');
    exp.textContent = 'Export';
    exp.className = 'modal-primary';
    btns.appendChild(cancel);
    btns.appendChild(exp);
    panel.appendChild(btns);

    function close() {
      saveCfg();
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    cancel.addEventListener('click', close);
    exp.addEventListener('click', () => { close(); runExport(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  // ─── Wire up button ──────────────────────────────────────────────────────
  function init() {
    const btn = document.getElementById('btn-export-midi');
    if (btn) btn.addEventListener('click', openDialog);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  AR.midiExport = { open: openDialog, run: runExport };
})();
