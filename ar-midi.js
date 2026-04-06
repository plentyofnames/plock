// ─── WebMIDI connection, SysEx dispatch, file I/O ────────────────────────────
// Depends on: ar-state.js, ar-constants.js, ar-sysex.js, ar-editor.js
var S = AR.state;
var U = AR.ui;
var setStatus = AR.setStatus;

// ─── MIDI connect ─────────────────────────────────────────────────────────

async function connectMidi() {
  setStatus('Connecting to MIDI…');
  try {
    S.midi.access = await navigator.requestMIDIAccess({ sysex: true });
  } catch (e) {
    setStatus('MIDI access denied', 'err');
    return;
  }
  S.midi.access.onstatechange = () => {
    const hadRytm = !!(S.midi.input && S.midi.output);
    findPorts();
    if (!hadRytm && S.midi.input && S.midi.output) requestPattern();
  };
  findPorts();
  if (S.midi.input && S.midi.output) requestPattern();
}

function requestPattern() {
  if (!S.midi.output) return;
  S.midi.sysexBuf = [];
  S.midi.inSysex  = false;
  setStatus('Requesting pattern…');
  S.midi.output.send(PATTERN_REQUEST_X);
  S.midi.output.send(KIT_REQUEST_X);
}

function findPorts() {
  S.midi.input  = null;
  S.midi.output = null;

  const inNames  = [];
  const outNames = [];

  for (const [, p] of S.midi.access.inputs) {
    inNames.push(p.name);
    if (p.name.toLowerCase().includes('rytm')) S.midi.input = p;
  }
  for (const [, p] of S.midi.access.outputs) {
    outNames.push(p.name);
    if (p.name.toLowerCase().includes('rytm')) S.midi.output = p;
  }

  U.portInfoEl.textContent =
    'IN: ' + (inNames.join(', ') || '—') +
    '   OUT: ' + (outNames.join(', ') || '—');

  if (S.midi.input && S.midi.output) {
    S.midi.input.onmidimessage = onMidiMessage;
    setStatus('Connected → ' + S.midi.input.name, 'ok');
    U.btnRefresh.disabled = false;
  } else {
    setStatus('Analog Rytm not found — connect the device and try again.', 'err');
    U.btnRefresh.disabled = true;
  }
  updateSendBtn();
}

function updateSendBtn() {
  U.btnSend.disabled = !(S.midi.output && S.pattern.raw);
}

// ─── Receive & reassemble SysEx ───────────────────────────────────────────

function onMidiMessage(ev) {
  const data = ev.data;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b === SYSEX_START) {
      S.midi.inSysex  = true;
      S.midi.sysexBuf = [SYSEX_START];
    } else if (S.midi.inSysex) {
      S.midi.sysexBuf.push(b);
      if (b === SYSEX_END) {
        S.midi.inSysex = false;
        handleSysex(new Uint8Array(S.midi.sysexBuf));
        S.midi.sysexBuf = [];
      }
    }
  }
}

// ─── SysEx handler ────────────────────────────────────────────────────────

function handleSysex(syx) {
  if (syx.length < 20) return;
  if (syx[0] !== SYSEX_START)        return;
  if (syx[1] !== 0x00)              return;
  if (syx[2] !== AR_ELEKTRON_MFR_1) return;
  if (syx[3] !== AR_ELEKTRON_MFR_2) return;
  if (syx[4] !== AR_PRODUCT_ID)     return;

  const dumpId = syx[6];

  // ── Kit dump ──────────────────────────────────────────────────────────
  if (dumpId === AR_SYSEX_DUMPX_ID_KIT || dumpId === AR_SYSEX_DUMP_ID_KIT) {
    let raw;
    try { raw = decodeSysex7to8(syx); } catch (e) {
      setStatus('Kit decode error: ' + e.message, 'err'); return;
    }
    AR.loadKit(raw, syx.slice());
    // Re-render grid to show machine names, and update open panels
    if (S.pattern.raw) {
      renderGrid(S.pattern.raw, S.ui.stepPage);
    }
    return;
  }

  // ── Sound pool dump ──────────────────────────────────────────────────
  if (dumpId === AR_SYSEX_DUMP_ID_SOUND) {
    let raw;
    try { raw = decodeSysex7to8(syx); } catch (e) {
      setStatus('Sound decode error: ' + e.message, 'err'); return;
    }
    const slotNr = syx[9];
    S.pattern.soundPool.set(slotNr, raw);
    S.pattern.soundPoolSyx.set(slotNr, syx.slice());
    S.requests.pendingSounds.delete(slotNr);
    // When all pending sounds received, refresh display
    if (S.requests.pendingSounds.size === 0 && S.pattern.raw) {
      renderGrid(S.pattern.raw, S.ui.stepPage);
      if (S.ui.openPanel) {
        const { t, s } = S.ui.openPanel;
        S.ui.openPanel.el.replaceWith(buildStepPanel(t, s));
        S.ui.openPanel.el = U.gridEl.querySelector('.step-panel');
      }
      if (S.requests.savePending) { S.requests.savePending = false; doSaveBundle(); }
    }
    return;
  }

  // ── Pattern dump ─────────────────────────────────────────────────────
  const isPattern =
    dumpId === AR_SYSEX_DUMP_ID_PATTERN ||
    dumpId === AR_SYSEX_DUMPX_ID_PATTERN;
  if (!isPattern) return;

  const objNr  = syx[9];
  const isWB   = (dumpId === AR_SYSEX_DUMPX_ID_PATTERN);
  const patName = isWB ? 'Workbuffer' : patternSlotName(objNr);

  setStatus('Decoding ' + syx.length + ' bytes…');

  let raw;
  try {
    raw = decodeSysex7to8(syx);
  } catch (e) {
    setStatus('Decode error: ' + e.message, 'err');
    return;
  }

  const meta = {
    devId: syx[5], dumpId: syx[6],
    verHi: syx[7], verLo: syx[8], objNr: syx[9]
  };
  AR.loadPattern(raw, meta, patName);
  renderMeta();
  U.btnSaveSyx.disabled = false;
  U.btnClear.disabled   = false;
  updateSendBtn();
  parsePlocks(raw);
  renderGrid(raw, S.ui.stepPage);

  // Request sound pool sounds for any sound-locked steps (MIDI only)
  if (S.midi.output) {
    const neededSlots = scanSoundLocks(raw);
    if (neededSlots.size > 0) requestSoundPoolSlots(neededSlots);
  }

  setStatus('Ready', 'ok');
}

// ─── Load / Save .syx ──────────────────────────────────────────────────

function doSaveBundle() {
  if (!S.pattern.raw || !S.pattern.syxMeta) return;
  const parts = [];
  // Pattern
  parts.push(buildSysexMessage(S.pattern.raw, S.pattern.syxMeta));
  // Kit
  if (S.pattern.kitSyx) parts.push(S.pattern.kitSyx);
  // Sound pool
  for (let i = 0; i < 128; i++) {
    if (S.pattern.soundPoolSyx.has(i)) parts.push(S.pattern.soundPoolSyx.get(i));
  }

  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const bundle = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) { bundle.set(p, off); off += p.length; }

  const blob = new Blob([bundle], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const patInfo = U.metaEl.querySelector('span');
  const name = patInfo ? patInfo.textContent.replace(/\s+/g, '_') : 'pattern';
  a.href = url;
  a.download = name + '.syx';
  a.click();
  URL.revokeObjectURL(url);
  setStatus('Saved ' + parts.length + ' sysex messages', 'ok');
}

function requestSoundPoolSlots(slots) {
  if (!S.midi.output) return;
  for (const nr of slots) {
    if (S.pattern.soundPool.has(nr)) continue;
    S.requests.pendingSounds.add(nr);
    const req = new Uint8Array([
      SYSEX_START, 0x00, AR_ELEKTRON_MFR_1, AR_ELEKTRON_MFR_2, AR_PRODUCT_ID,
      0x00, AR_SYSEX_REQUEST_ID_SOUND, 0x01, 0x01, nr & 0x7F,
      0x00, 0x00, 0x00, 0x05, SYSEX_END
    ]);
    S.midi.output.send(req);
  }
}

// ─── Send pattern to AR workbuffer ──────────────────────────────────────

function sendPatternToAR() {
  if (!S.midi.output || !S.pattern.raw || !S.pattern.syxMeta) return;
  // Force workbuffer dump ID regardless of how pattern was loaded
  const meta = Object.assign({}, S.pattern.syxMeta, {
    dumpId: AR_SYSEX_DUMPX_ID_PATTERN
  });
  const syx = buildSysexMessage(S.pattern.raw, meta);
  S.midi.output.send(syx);
  setStatus('Pattern sent to workbuffer (' + syx.length + ' bytes)', 'ok');
}

// ─── Init: wire up event listeners ───────────────────────────────────────

AR.midiInit = function() {
  U.btnConnect.addEventListener('click', connectMidi);
  U.btnRefresh.addEventListener('click', requestPattern);
  U.btnLoadSyx.addEventListener('click', () => U.syxFileIn.click());

  U.syxFileIn.addEventListener('change', () => {
    const file = U.syxFileIn.files[0];
    if (!file) return;
    S.pattern.soundPool.clear();
    S.pattern.soundPoolSyx.clear();
    S.requests.pendingSounds.clear();
    S.requests.savePending = false;
    const reader = new FileReader();
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result);
      let i = 0;
      let count = 0;
      while (i < bytes.length) {
        if (bytes[i] === SYSEX_START) {
          let j = i + 1;
          while (j < bytes.length && bytes[j] !== SYSEX_END) j++;
          if (j < bytes.length) {
            handleSysex(bytes.subarray(i, j + 1));
            count++;
            i = j + 1;
          } else break;
        } else {
          i++;
        }
      }
      if (count === 0) {
        setStatus('No valid sysex messages found in file', 'err');
      }
    };
    reader.readAsArrayBuffer(file);
    U.syxFileIn.value = '';
  });

  U.btnSaveSyx.addEventListener('click', () => {
    if (!S.pattern.raw || !S.pattern.syxMeta) return;
    if (S.midi.output) {
      const allSlots = new Set();
      for (let i = 0; i < 128; i++) allSlots.add(i);
      const needed = [...allSlots].filter(s => !S.pattern.soundPool.has(s));
      if (needed.length > 0) {
        S.requests.savePending = true;
        setStatus('Requesting sound pool (' + needed.length + ' sounds)…');
        requestSoundPoolSlots(new Set(needed));
        setTimeout(() => {
          if (S.requests.savePending) { S.requests.savePending = false; doSaveBundle(); }
        }, 10000);
        return;
      }
    }
    doSaveBundle();
  });

  U.btnClear.addEventListener('click', () => {
    if (!S.pattern.raw) return;
    if (confirm('Clear all trigs and parameter locks from this pattern?\n\n(Defaults, BPM, swing, kit, and length are preserved.)')) {
      AR.clearPattern();
    }
  });

  U.btnSend.addEventListener('click', sendPatternToAR);

  U.btnPage0.addEventListener('click', () => {
    S.ui.stepPage = 0;
    U.btnPage0.classList.add('active');
    U.btnPage1.classList.remove('active');
    if (S.pattern.raw) renderGrid(S.pattern.raw, S.ui.stepPage);
  });

  U.btnPage1.addEventListener('click', () => {
    S.ui.stepPage = 1;
    U.btnPage1.classList.add('active');
    U.btnPage0.classList.remove('active');
    if (S.pattern.raw) renderGrid(S.pattern.raw, S.ui.stepPage);
  });

  connectMidi();
};
