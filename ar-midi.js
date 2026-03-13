// ─── WebMIDI connection, SysEx dispatch, file I/O ────────────────────────────
// Depends on: ar-state.js, ar-constants.js, ar-sysex.js, ar-editor.js
var S = AR.state;
var U = AR.ui;
var setStatus = AR.setStatus;

// ─── MIDI connect ─────────────────────────────────────────────────────────

async function connectMidi() {
  setStatus('Connecting to MIDI…');
  try {
    S.midiAccess = await navigator.requestMIDIAccess({ sysex: true });
  } catch (e) {
    setStatus('MIDI access denied: ' + e.message, 'err');
    return;
  }
  S.midiAccess.onstatechange = () => {
    const hadRytm = !!(S.rytmInput && S.rytmOutput);
    findPorts();
    if (!hadRytm && S.rytmInput && S.rytmOutput) requestPattern();
  };
  findPorts();
  if (S.rytmInput && S.rytmOutput) requestPattern();
}

function requestPattern() {
  if (!S.rytmOutput) return;
  S.sysexBuf = [];
  S.inSysex  = false;
  setStatus('Requesting pattern…');
  S.rytmOutput.send(PATTERN_REQUEST_X);
  S.rytmOutput.send(KIT_REQUEST_X);
}

function findPorts() {
  S.rytmInput  = null;
  S.rytmOutput = null;

  const inNames  = [];
  const outNames = [];

  for (const [, p] of S.midiAccess.inputs) {
    inNames.push(p.name);
    if (p.name.toLowerCase().includes('rytm')) S.rytmInput = p;
  }
  for (const [, p] of S.midiAccess.outputs) {
    outNames.push(p.name);
    if (p.name.toLowerCase().includes('rytm')) S.rytmOutput = p;
  }

  U.portInfoEl.textContent =
    'IN: ' + (inNames.join(', ') || '—') +
    '   OUT: ' + (outNames.join(', ') || '—');

  if (S.rytmInput && S.rytmOutput) {
    S.rytmInput.onmidimessage = onMidiMessage;
    setStatus('Connected → ' + S.rytmInput.name, 'ok');
    U.btnRefresh.disabled = false;
  } else {
    setStatus('Analog Rytm not found — connect the device and try again.', 'err');
    U.btnRefresh.disabled = true;
  }
  updateSendBtn();
}

function updateSendBtn() {
  U.btnSend.disabled = !(S.rytmOutput && S.lastRaw);
}

// ─── Receive & reassemble SysEx ───────────────────────────────────────────

function onMidiMessage(ev) {
  const data = ev.data;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b === SYSEX_START) {
      S.inSysex  = true;
      S.sysexBuf = [SYSEX_START];
    } else if (S.inSysex) {
      S.sysexBuf.push(b);
      if (b === SYSEX_END) {
        S.inSysex = false;
        handleSysex(new Uint8Array(S.sysexBuf));
        S.sysexBuf = [];
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
    S.lastKit = raw;
    S.lastKitSyx = syx.slice();
    // Re-render grid to show machine names, and update open panels
    if (S.lastRaw) {
      renderGrid(S.lastRaw, S.stepPage);
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
    S.soundPool.set(slotNr, raw);
    S.soundPoolSyx.set(slotNr, syx.slice());
    S.pendingSoundReqs.delete(slotNr);
    // When all pending sounds received, refresh display
    if (S.pendingSoundReqs.size === 0 && S.lastRaw) {
      renderGrid(S.lastRaw, S.stepPage);
      if (S.openPanel) {
        const { t, s } = S.openPanel;
        S.openPanel.el.replaceWith(buildStepPanel(t, s));
        S.openPanel.el = U.gridEl.querySelector('.step-panel');
      }
      if (S.savePending) { S.savePending = false; doSaveBundle(); }
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

  S.lastRaw = raw;
  S.lastPatName = patName;
  renderMeta();
  S.lastSyxMeta = {
    devId: syx[5], dumpId: syx[6],
    verHi: syx[7], verLo: syx[8], objNr: syx[9]
  };
  U.btnSaveSyx.disabled = false;
  updateSendBtn();
  S.soundPool.clear();
  S.soundPoolSyx.clear();
  S.pendingSoundReqs.clear();
  S.savePending = false;
  parsePlocks(raw);
  renderGrid(raw, S.stepPage);

  // Request sound pool sounds for any sound-locked steps (MIDI only)
  if (S.rytmOutput) {
    const neededSlots = scanSoundLocks(raw);
    if (neededSlots.size > 0) requestSoundPoolSlots(neededSlots);
  }

  setStatus('Ready', 'ok');
}

// ─── Load / Save .syx ──────────────────────────────────────────────────

function doSaveBundle() {
  if (!S.lastRaw || !S.lastSyxMeta) return;
  const parts = [];
  // Pattern
  parts.push(buildSysexMessage(S.lastRaw, S.lastSyxMeta));
  // Kit
  if (S.lastKitSyx) parts.push(S.lastKitSyx);
  // Sound pool
  for (let i = 0; i < 128; i++) {
    if (S.soundPoolSyx.has(i)) parts.push(S.soundPoolSyx.get(i));
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
  if (!S.rytmOutput) return;
  for (const nr of slots) {
    if (S.soundPool.has(nr)) continue;
    S.pendingSoundReqs.add(nr);
    const req = new Uint8Array([
      SYSEX_START, 0x00, AR_ELEKTRON_MFR_1, AR_ELEKTRON_MFR_2, AR_PRODUCT_ID,
      0x00, AR_SYSEX_REQUEST_ID_SOUND, 0x01, 0x01, nr & 0x7F,
      0x00, 0x00, 0x00, 0x05, SYSEX_END
    ]);
    S.rytmOutput.send(req);
  }
}

// ─── Send pattern to AR workbuffer ──────────────────────────────────────

function sendPatternToAR() {
  if (!S.rytmOutput || !S.lastRaw || !S.lastSyxMeta) return;
  // Force workbuffer dump ID regardless of how pattern was loaded
  const meta = Object.assign({}, S.lastSyxMeta, {
    dumpId: AR_SYSEX_DUMPX_ID_PATTERN
  });
  const syx = buildSysexMessage(S.lastRaw, meta);
  S.rytmOutput.send(syx);
  setStatus('Pattern sent to workbuffer (' + syx.length + ' bytes)', 'ok');
}

// ─── Init: wire up event listeners ───────────────────────────────────────

AR.midi = {
  init: function() {
    U.btnConnect.addEventListener('click', connectMidi);
    U.btnRefresh.addEventListener('click', requestPattern);
    U.btnLoadSyx.addEventListener('click', () => U.syxFileIn.click());

    U.syxFileIn.addEventListener('change', () => {
      const file = U.syxFileIn.files[0];
      if (!file) return;
      S.soundPool.clear();
      S.soundPoolSyx.clear();
      S.pendingSoundReqs.clear();
      S.savePending = false;
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
      if (!S.lastRaw || !S.lastSyxMeta) return;
      if (S.rytmOutput) {
        const allSlots = new Set();
        for (let i = 0; i < 128; i++) allSlots.add(i);
        const needed = [...allSlots].filter(s => !S.soundPool.has(s));
        if (needed.length > 0) {
          S.savePending = true;
          setStatus('Requesting sound pool (' + needed.length + ' sounds)…');
          requestSoundPoolSlots(new Set(needed));
          setTimeout(() => {
            if (S.savePending) { S.savePending = false; doSaveBundle(); }
          }, 10000);
          return;
        }
      }
      doSaveBundle();
    });

    U.btnSend.addEventListener('click', sendPatternToAR);

    U.btnPage0.addEventListener('click', () => {
      S.stepPage = 0;
      U.btnPage0.classList.add('active');
      U.btnPage1.classList.remove('active');
      if (S.lastRaw) renderGrid(S.lastRaw, S.stepPage);
    });

    U.btnPage1.addEventListener('click', () => {
      S.stepPage = 1;
      U.btnPage1.classList.add('active');
      U.btnPage0.classList.remove('active');
      if (S.lastRaw) renderGrid(S.lastRaw, S.stepPage);
    });

    connectMidi();
  }
};
