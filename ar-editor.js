// ─── Editor: grid rendering, panels, parameter editing, display helpers ──────
// Depends on: ar-state.js, ar-constants.js, ar-sysex.js
var S = AR.state;
var U = AR.ui;
var setStatus = AR.setStatus;

    // ─── Grid layout constants ────────────────────────────────────────────────
    const GRID_GROUPS   = 2;
    const GRID_GROUP_SZ = 16;
    const GRID_STEP_W   = 32;
    const GRID_STEP_GAP = 2;
    const GRID_GROUP_GAP = 8;
    const GRID_BEAT_SZ  = 4;

    // ─── Display conversion helpers ─────────────────────────────────────────
    // Shared formatters for parameter values → display strings.  Used by both
    // track param sections and FX param sections to avoid duplicate inline lambdas.

    function displayBipolar(v) {
      if (v >= 128) return 'TRK';
      const sv = v - 64;
      return (sv >= 0 ? '+' : '') + sv;
    }
    function displayPan(v) {
      if (v >= 128) return 'TRK';
      if (v === 64) return 'C';
      return v < 64 ? 'L' + (64 - v) : 'R' + (v - 64);
    }
    function displayInf127(v) {
      return v >= 128 ? 'TRK' : v === 127 ? '\u221E' : String(v);
    }
    function displayLfoPhase(v) {
      return v >= 128 ? 'TRK' : Math.round(v * 360 / 128) + '\u00B0';
    }
    function displayPct200(v) {
      return v >= 128 ? 'TRK' : Math.round(v * 200 / 128);
    }
    function displayPlain(v) {
      return v >= 128 ? 'TRK' : v;
    }

    // ─── Click-to-edit helper ──────────────────────────────────────────────
    // Attaches a click handler that replaces a span's text with an input field.
    // Used by track settings, metadata fields, and master length/change fields.
    //
    // el:          the span element to make editable
    // displayText: text to restore on cancel (string)
    // editVal:     initial input value
    // opts:        { type, className, width, onCommit(inputValue), onCancel? }
    //              onCancel defaults to restoring displayText

    function attachClickToEdit(el, displayText, editVal, opts) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (el.querySelector('input')) return;
        const inp = document.createElement('input');
        inp.type = opts.type || 'text';
        inp.className = opts.className || 'meta-input';
        if (opts.width) inp.style.width = opts.width;
        inp.value = editVal;
        el.textContent = '';
        el.appendChild(inp);
        inp.focus();
        inp.select();
        let done = false;
        const commit = () => {
          if (done) return;
          done = true;
          opts.onCommit(inp.value);
        };
        const cancel = () => {
          if (done) return;
          done = true;
          if (opts.onCancel) opts.onCancel();
          else el.textContent = displayText;
        };
        inp.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter')  { ke.preventDefault(); commit(); }
          if (ke.key === 'Escape') { ke.preventDefault(); cancel(); }
          ke.stopPropagation();
        });
        inp.addEventListener('blur', () => {
          setTimeout(() => { if (!done) commit(); }, 0);
        });
      });
    }

    function gridStepCenterX(pageIdx) {
      const g = Math.floor(pageIdx / GRID_GROUP_SZ);
      const s = pageIdx % GRID_GROUP_SZ;
      const gw = GRID_GROUP_SZ * GRID_STEP_W + (GRID_GROUP_SZ - 1) * GRID_STEP_GAP;
      return g * (gw + GRID_GROUP_GAP) + s * (GRID_STEP_W + GRID_STEP_GAP) + GRID_STEP_W / 2;
    }

    // ── Ruler row ──────────────────────────────────────────────────────────
    function buildRuler(stepOffset) {
      const ruler = document.createElement('div');
      ruler.className = 'ruler-row';
      const rulerSpace = document.createElement('div');
      rulerSpace.className = 'track-label-space';
      ruler.appendChild(rulerSpace);
      const rulerGroups = document.createElement('div');
      rulerGroups.className = 'ruler-groups';
      for (let g = 0; g < GRID_GROUPS; g++) {
        const grp = document.createElement('div');
        grp.className = 'ruler-group';
        for (let b = 0; b < GRID_GROUP_SZ / 4; b++) {
          const beat = document.createElement('div');
          beat.className = 'ruler-beat';
          for (let s = 0; s < 4; s++) {
            const n = document.createElement('div');
            n.className = 'ruler-num';
            const stepNum = stepOffset + g * GRID_GROUP_SZ + b * 4 + s + 1;
            if (stepNum % 4 === 1) n.textContent = stepNum;
            beat.appendChild(n);
          }
          grp.appendChild(beat);
        }
        rulerGroups.appendChild(grp);
      }
      ruler.appendChild(rulerGroups);
      return ruler;
    }

    // ── Single step cell (visual decorators only, no listeners) ───────────
    function buildStepCell(raw, t, trackBase, stepIdx, trigBits, numSteps,
                           plockMap, swingAmount) {
      const flags    = getTrigFlags(trigBits, stepIdx);
      const isOn     = (flags & AR_TRIG_ENABLE) !== 0;
      const isAccent = (flags & AR_TRIG_ACCENT) !== 0;
      const isMute   = (flags & AR_TRIG_MUTE)   !== 0;
      const isRetrig = (flags & AR_TRIG_RETRIG) !== 0;
      const hasSwing = (flags & AR_TRIG_SWING)  !== 0;
      const isSlide  = (flags & AR_TRIG_SLIDE)  !== 0;
      const beyond   = stepIdx >= numSteps;

      const noteRaw    = raw[trackBase + NOTE_OFFSET     + stepIdx];
      const veloRaw    = raw[trackBase + VELOCITY_OFFSET + stepIdx];
      const lenRaw     = raw[trackBase + NOTE_LEN_OFFSET + stepIdx];
      const hasTrigCond  = !beyond && (noteRaw & NOTE_CONDITION_BIT) === 0;
      const noteLocked   = !beyond && (noteRaw & NOTE_VALUE_MASK) !== NOTE_UNLOCKED;
      const veloLocked   = !beyond && veloRaw !== PLOCK_NO_VALUE;
      const lenLocked    = !beyond && lenRaw  !== PLOCK_NO_VALUE;
      const microRaw     = raw[trackBase + MICRO_TIMING_OFFSET + stepIdx];
      const microVal     = microRaw & UTIME_VALUE_MASK;
      const microSigned  = (microVal & UTIME_SIGN_BIT) ? microVal - 64 : microVal;
      const hasPlock = !beyond && (
        plockMap[t][stepIdx] !== 0 ||
        noteLocked || veloLocked || lenLocked || hasTrigCond || microSigned !== 0
      );
      const sndLock  = raw[trackBase + SOUND_LOCK_OFFSET + stepIdx];
      const hasSoundLock = !beyond && sndLock !== SOUND_LOCK_NONE;

      const SYN_SMP_EN = AR_TRIG_SYN_PL_EN | AR_TRIG_SMP_PL_EN;
      const isLockTrig = !beyond && isOn &&
        (flags & SYN_SMP_EN) === SYN_SMP_EN &&
        (flags & (AR_TRIG_SYN_PL_SW | AR_TRIG_SMP_PL_SW)) === 0;

      const cell = document.createElement('div');
      let cls = 'step';

      if (isLockTrig) {
        cls += ' lock-trig';
        if (hasPlock) cls += ' has-plock';
      } else if (isOn) {
        cls += ' on';
        if (isAccent && !isMute) cls += ' accent';
        if (isMute)              cls += ' mute';
        if (hasPlock)            cls += ' has-plock';
      }
      if (hasSoundLock) cls += ' has-sound-lock';
      if (beyond) cls += ' inactive';
      cell.className = cls;
      cell.dataset.step = stepIdx;

      if (isOn) {
        if (isRetrig) { const d = document.createElement('div'); d.className = 'trig-dot retrig'; cell.appendChild(d); }
        if (hasSwing && swingAmount !== 0) { const d = document.createElement('div'); d.className = 'trig-dot swing'; cell.appendChild(d); }
      }
      if ((isOn || isLockTrig) && microSigned !== 0) {
        const arr = document.createElement('div');
        arr.className = 'utime-arrow ' + (microSigned > 0 ? 'late' : 'early');
        cell.appendChild(arr);
      }
      if (isOn && !beyond) {
        const defLen = raw[trackBase + DEFAULT_NOTE_LEN_OFFSET];
        const lenDisp = lenRaw !== PLOCK_NO_VALUE ? lenRaw : defLen;
        if (lenDisp === NOTE_LEN_INF) {
          const bar = document.createElement('div');
          bar.className = 'note-len-bar inf';
          cell.appendChild(bar);
        } else if (lenDisp !== PLOCK_NO_VALUE) {
          const bar = document.createElement('div');
          bar.className = 'note-len-bar';
          bar.style.width = Math.round(lenDisp / 126 * 100) + '%';
          cell.appendChild(bar);
        }
      }

      // Tooltip
      const modParts = [];
      if (hasPlock) modParts.push('PLOCK');
      if (isAccent) modParts.push('ACCENT');
      if (isMute)   modParts.push('MUTE');
      if (isRetrig) modParts.push('RETRIG');
      if (hasSwing && swingAmount !== 0) modParts.push('SWING');
      if (isSlide)      modParts.push('SLIDE');
      if (hasSoundLock) {
        let sndTip = 'SND:' + (sndLock + 1);
        if (S.pattern.soundPool.has(sndLock)) {
          const ps = S.pattern.soundPool.get(sndLock);
          if (ps.length > MACHINE_TYPE_OFFSET) {
            const mt = ps[MACHINE_TYPE_OFFSET];
            if (mt < MACHINES.length) sndTip += ' ' + MACHINES[mt].name;
          }
        }
        modParts.push(sndTip);
      }
      cell.title = TRACK_NAMES[t] + ' · step ' + (stepIdx + 1)
        + (isLockTrig ? ' · LOCK' : isOn ? ' · TRIG' : '')
        + (modParts.length ? ' [' + modParts.join(', ') + ']' : '')
        + (beyond ? ' · beyond' : '')
        + '\nclick: trig · alt: lock · shift: mute · ⌘: inspect';

      return { cell, isOn, isSlide, isLockTrig, beyond };
    }

    // ── Step click handler ─────────────────────────────────────────────────
    function attachStepListener(cell, raw, t, trackBase, stepIdx, trigBits, beyond) {
      cell.addEventListener('click', (e) => {
        if (beyond || !S.pattern.raw) return;
        e.preventDefault();

        if (e.metaKey || e.ctrlKey) {
          if (S.ui.openPanel && S.ui.openPanel.t === t && S.ui.openPanel.s === stepIdx) {
            closeStepPanel();
          } else {
            openStepPanel(t, stepIdx);
          }
          return;
        }

        const curFlags  = getTrigFlags(trigBits, stepIdx);
        const curOn     = (curFlags & AR_TRIG_ENABLE) !== 0;
        const SYN_SMP   = AR_TRIG_SYN_PL_SW | AR_TRIG_SMP_PL_SW;

        const defTrigFlags = readU16BE(S.pattern.raw, trackBase + DEFAULT_TRIG_FLAGS_OFFSET);

        if (e.shiftKey) {
          if (curOn) {
            setTrigFlags(trigBits, stepIdx, curFlags ^ AR_TRIG_MUTE);
            refreshAfterEdit();
          }
          return;
        }

        if (e.altKey) {
          const SYN_SMP_EN = AR_TRIG_SYN_PL_EN | AR_TRIG_SMP_PL_EN;
          if (!curOn) {
            const base = curFlags === 0 ? defTrigFlags : curFlags;
            setTrigFlags(trigBits, stepIdx,
              (base | AR_TRIG_ENABLE | SYN_SMP_EN) & ~SYN_SMP);
          } else if ((curFlags & SYN_SMP) !== 0) {
            setTrigFlags(trigBits, stepIdx,
              (curFlags | SYN_SMP_EN) & ~SYN_SMP);
          } else {
            setTrigFlags(trigBits, stepIdx, curFlags & ~AR_TRIG_ENABLE);
          }
          refreshAfterEdit();
          return;
        }

        if (curOn) {
          setTrigFlags(trigBits, stepIdx, curFlags & ~AR_TRIG_ENABLE);
        } else {
          let nf;
          if (curFlags === 0) {
            nf = defTrigFlags | AR_TRIG_ENABLE;
          } else {
            nf = curFlags | AR_TRIG_ENABLE;
            if ((nf & SYN_SMP) === 0) {
              nf = (nf | SYN_SMP) & ~(AR_TRIG_SYN_PL_EN | AR_TRIG_SMP_PL_EN);
            }
          }
          setTrigFlags(trigBits, stepIdx, nf);
        }
        refreshAfterEdit();
      });
    }

    // ── Slide connecting lines ─────────────────────────────────────────────
    function drawSlideLines(container, slideSteps, activeSteps) {
      for (let i = 0; i < 32; i++) {
        if (!slideSteps[i]) continue;
        for (let j = i + 1; j < 32; j++) {
          if (activeSteps[j]) {
            const x1 = gridStepCenterX(i);
            const x2 = gridStepCenterX(j);
            const line = document.createElement('div');
            line.className = 'slide-line';
            line.style.left  = x1 + 'px';
            line.style.width = (x2 - x1) + 'px';
            container.appendChild(line);
            break;
          }
        }
      }
    }

    // ─── Render grid ──────────────────────────────────────────────────────────

    function renderGrid(raw, page) {
      closeStepPanel();
      closeTrackPanel();
      U.gridEl.innerHTML = '';

      const stepOffset = page * 32;
      const swingAmount = readU8(raw, SWING_AMOUNT_OFFSET);
      const gridScaleMode = readU8(raw, SCALE_MODE_OFFSET);
      const gridMasterLenRaw = readU16BE(raw, MASTER_LENGTH_OFFSET);
      const gridMasterSteps = (gridMasterLenRaw === 0 || gridMasterLenRaw === 1)
        ? 64 : Math.min(gridMasterLenRaw, 64);

      const plockMap = parsePlocks(raw);

      // Page button state
      let maxSteps = 0;
      for (let t = 0; t < AR_NUM_TRACKS; t++) {
        const ns = gridScaleMode
          ? raw[4 + t * TRACK_V5_SZ + NUM_STEPS_OFFSET]
          : gridMasterSteps;
        maxSteps = Math.max(maxSteps, ns);
      }
      const page1Avail = maxSteps > 32;
      U.btnPage1.disabled = !page1Avail;
      U.btnPage1.style.opacity = page1Avail ? '' : '0.3';
      U.btnPage1.style.pointerEvents = page1Avail ? '' : 'none';
      if (!page1Avail && page === 1) {
        S.ui.stepPage = 0;
        U.btnPage0.classList.add('active');
        U.btnPage1.classList.remove('active');
        renderGrid(raw, 0);
        return;
      }

      U.gridEl.appendChild(buildRuler(stepOffset));

      // ── Track rows ────────────────────────────────────────────────────────
      for (let t = 0; t < AR_NUM_TRACKS; t++) {
        const trackBase = 4 + t * TRACK_V5_SZ;
        const trigBits  = raw.subarray(trackBase + TRIG_BITS_OFFSET, trackBase + 112);
        const numSteps  = gridScaleMode ? raw[trackBase + NUM_STEPS_OFFSET] : gridMasterSteps;

        const row = document.createElement('div');
        row.className = 'track-row';
        row.dataset.track = t;
        if (t === 12) row.style.marginTop = '10px';

        // ── Label ──
        const label = document.createElement('div');
        label.className = 'track-label';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = TRACK_NAMES[t];
        label.appendChild(nameSpan);
        const machType = getTrackMachineType(t);
        if (machType !== null) {
          const machSpan = document.createElement('span');
          machSpan.className = 'track-meta track-machine';
          machSpan.textContent = MACHINES[machType].name;
          label.appendChild(machSpan);
        }
        label.style.cursor = 'pointer';
        label.addEventListener('click', (e) => {
          e.stopPropagation();
          if (S.ui.openTrackPanel && S.ui.openTrackPanel.t === t) {
            closeTrackPanel();
          } else {
            openTrackSettingsPanel(t);
          }
        });
        row.appendChild(label);

        // ── Steps ──
        const stepsOuter = document.createElement('div');
        stepsOuter.className = 'steps-outer';
        const stepsWrap = document.createElement('div');
        stepsWrap.className = 'track-steps';

        const slideSteps  = new Array(32).fill(false);
        const activeSteps = new Array(32).fill(false);

        for (let g = 0; g < GRID_GROUPS; g++) {
          const grp = document.createElement('div');
          grp.className = 'step-group';

          for (let b = 0; b < GRID_GROUP_SZ / GRID_BEAT_SZ; b++) {
            const beat = document.createElement('div');
            beat.className = 'beat-group' + (b % 2 ? ' odd' : ' even');

            for (let s = 0; s < GRID_BEAT_SZ; s++) {
              const pageIdx = g * GRID_GROUP_SZ + b * GRID_BEAT_SZ + s;
              const stepIdx = stepOffset + pageIdx;

              const step = buildStepCell(raw, t, trackBase, stepIdx, trigBits,
                                         numSteps, plockMap, swingAmount);
              attachStepListener(step.cell, raw, t, trackBase, stepIdx, trigBits,
                                 step.beyond);

              if (!step.beyond) {
                if (step.isOn || step.isLockTrig) activeSteps[pageIdx] = true;
                if (step.isOn && step.isSlide)    slideSteps[pageIdx]  = true;
              }

              beat.appendChild(step.cell);
            }
            grp.appendChild(beat);
          }
          stepsWrap.appendChild(grp);
        }

        stepsOuter.appendChild(stepsWrap);
        drawSlideLines(stepsOuter, slideSteps, activeSteps);
        row.appendChild(stepsOuter);
        U.gridEl.appendChild(row);
      }
    }

    // ─── Step inspector panel ─────────────────────────────────────────────────

    function openStepPanel(t, s) {
      closeStepPanel();

      const trackRow = U.gridEl.querySelector(`.track-row[data-track="${t}"]`);
      if (!trackRow) return;

      const panel = buildStepPanel(t, s);
      U.gridEl.insertBefore(panel, trackRow);
      S.ui.openPanel = { t, s, el: panel };

      // Highlight the inspected step cell
      const stepEl = trackRow.querySelector(`.step[data-step="${s}"]`);
      if (stepEl) stepEl.classList.add('inspected');
    }

    function closeStepPanel() {
      if (!S.ui.openPanel) return;
      // Remove highlight
      const trackRow = U.gridEl.querySelector(`.track-row[data-track="${S.ui.openPanel.t}"]`);
      if (trackRow) {
        const stepEl = trackRow.querySelector(`.step[data-step="${S.ui.openPanel.s}"]`);
        if (stepEl) stepEl.classList.remove('inspected');
      }
      S.ui.openPanel.el.remove();
      S.ui.openPanel = null;
    }

    // ─── Track settings panel ───────────────────────────────────────────────

    function openTrackSettingsPanel(t) {
      closeTrackPanel();
      const trackRow = U.gridEl.querySelector(`.track-row[data-track="${t}"]`);
      if (!trackRow) return;
      const panel = buildTrackSettingsPanel(t);
      U.gridEl.insertBefore(panel, trackRow);
      S.ui.openTrackPanel = { t, el: panel };
    }

    function closeTrackPanel() {
      if (!S.ui.openTrackPanel) return;
      S.ui.openTrackPanel.el.remove();
      S.ui.openTrackPanel = null;
    }

    function buildTrackSettingsPanel(t) {
      if (!S.pattern.raw) return document.createElement('div');
      const trackBase = 4 + t * TRACK_V5_SZ;
      const raw = S.pattern.raw;

      const panel = document.createElement('div');
      panel.className = 'track-settings-panel';

      // Title
      const title = document.createElement('span');
      title.className = 'ts-title';
      const machType = getTrackMachineType(t);
      title.textContent = TRACK_NAMES[t] +
        (machType !== null ? ' · ' + MACHINES[machType].name : '');
      panel.appendChild(title);

      // Inline editable value helper
      const addVal = (lbl, displayText, editVal, width, onCommit) => {
        const grp = document.createElement('span');
        grp.className = 'ts-group';
        const label = document.createElement('span');
        label.className = 'ts-lbl';
        label.textContent = lbl;
        const v = document.createElement('span');
        v.className = 'ts-val';
        v.textContent = displayText;
        grp.appendChild(label);
        grp.appendChild(v);
        panel.appendChild(grp);

        attachClickToEdit(v, displayText, editVal, {
          type: 'number', className: 'ts-input', width: width || '40px',
          onCommit,
        });
      };

      // Scale mode check
      const tsScaleMode = readU8(raw, SCALE_MODE_OFFSET);

      // Scale section: Normal → "Std", Advanced → Len + Spd
      const numSteps = raw[trackBase + NUM_STEPS_OFFSET];
      const tsDenom = (n) => n <= 16 ? 16 : n <= 32 ? 32 : n <= 48 ? 48 : 64;
      const speedByte = raw[trackBase + TRACK_SPEED_OFFSET];
      const speedIdx  = speedByte & SPEED_VALUE_MASK;
      const tsMakeArrow = (text, handler) => {
        const b = document.createElement('span');
        b.textContent = text; b.className = 'ts-arrow';
        b.addEventListener('click', (e) => { e.stopPropagation(); handler(); refreshAfterEdit(); });
        return b;
      };

      if (!tsScaleMode) {
        // Normal mode: just "Std"
        const grp = document.createElement('span');
        grp.className = 'ts-group';
        const lbl = document.createElement('span');
        lbl.className = 'ts-lbl'; lbl.textContent = 'Scale';
        const val = document.createElement('span');
        val.className = 'ts-val'; val.style.cursor = 'default'; val.textContent = 'Std';
        grp.appendChild(lbl); grp.appendChild(val);
        panel.appendChild(grp);
      } else {
        // Advanced: Len N/D with text + arrows
        const lenGrp = document.createElement('span');
        lenGrp.className = 'ts-group';
        const lenLbl = document.createElement('span');
        lenLbl.className = 'ts-lbl'; lenLbl.textContent = 'Len';
        const lenVal = document.createElement('span');
        lenVal.className = 'ts-val'; lenVal.textContent = String(numSteps);
        lenGrp.appendChild(lenLbl); lenGrp.appendChild(lenVal);
        lenGrp.appendChild(tsMakeArrow('▼', () => {
          let n = raw[trackBase + NUM_STEPS_OFFSET]; n = n <= 1 ? 64 : n - 1;
          raw[trackBase + NUM_STEPS_OFFSET] = n;
        }));
        lenGrp.appendChild(tsMakeArrow('▲', () => {
          let n = raw[trackBase + NUM_STEPS_OFFSET]; n = n >= 64 ? 1 : n + 1;
          raw[trackBase + NUM_STEPS_OFFSET] = n;
        }));
        panel.appendChild(lenGrp);
        // Text entry on click
        attachClickToEdit(lenVal, String(numSteps), numSteps, {
          type: 'number', className: 'ts-input', width: '40px',
          onCommit: (v) => {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n >= 1 && n <= 64) raw[trackBase + NUM_STEPS_OFFSET] = n;
            refreshAfterEdit();
          },
          onCancel: refreshAfterEdit,
        });

        // Advanced: Spd arrows-only
        const spdGrp = document.createElement('span');
        spdGrp.className = 'ts-group';
        const spdLbl = document.createElement('span');
        spdLbl.className = 'ts-lbl'; spdLbl.textContent = 'Spd';
        const spdVal = document.createElement('span');
        spdVal.className = 'ts-val'; spdVal.style.cursor = 'default';
        spdVal.textContent = TRACK_SPEED_LABELS[speedIdx] || '1x';
        spdGrp.appendChild(spdLbl); spdGrp.appendChild(spdVal);
        spdGrp.appendChild(tsMakeArrow('▼', () => {
          const cur = raw[trackBase + TRACK_SPEED_OFFSET] & SPEED_VALUE_MASK;
          raw[trackBase + TRACK_SPEED_OFFSET] = (speedByte & SPEED_FLAGS_MASK) | (cur === 0 ? 6 : cur - 1);
        }));
        spdGrp.appendChild(tsMakeArrow('▲', () => {
          const cur = raw[trackBase + TRACK_SPEED_OFFSET] & SPEED_VALUE_MASK;
          raw[trackBase + TRACK_SPEED_OFFSET] = (speedByte & SPEED_FLAGS_MASK) | (cur >= 6 ? 0 : cur + 1);
        }));
        panel.appendChild(spdGrp);
      }

      // ── Separator between scale and trig defaults ──
      const sep = document.createElement('span');
      sep.className = 'ts-separator';
      panel.appendChild(sep);

      // Default Note
      const defNote = raw[trackBase + DEFAULT_NOTE_OFFSET];
      addVal('Note', midiNoteToName(defNote), defNote, '40px', (val) => {
        const n = parseInt(val, 10);
        if (!isNaN(n) && n >= 0 && n <= 127) raw[trackBase + DEFAULT_NOTE_OFFSET] = n;
        refreshAfterEdit();
      });

      // Default Velocity
      const defVelo = raw[trackBase + DEFAULT_VELOCITY_OFFSET];
      addVal('Vel', String(defVelo), defVelo, '40px', (val) => {
        const n = parseInt(val, 10);
        if (!isNaN(n) && n >= 0 && n <= 127) raw[trackBase + DEFAULT_VELOCITY_OFFSET] = n;
        refreshAfterEdit();
      });

      // Default Note Length
      const defLen = raw[trackBase + DEFAULT_NOTE_LEN_OFFSET];
      addVal('NLen', noteLenStr(defLen), defLen, '40px', (val) => {
        const n = parseInt(val, 10);
        if (!isNaN(n) && n >= 0 && n <= 127) raw[trackBase + DEFAULT_NOTE_LEN_OFFSET] = n;
        refreshAfterEdit();
      });

      // Default Trig Flags
      const defFlags = readU16BE(raw, trackBase + DEFAULT_TRIG_FLAGS_OFFSET);

      const flagGrp = document.createElement('span');
      flagGrp.className = 'ts-group';
      const flagLbl = document.createElement('span');
      flagLbl.className = 'ts-lbl';
      flagLbl.textContent = 'Flags';
      flagGrp.appendChild(flagLbl);

      const flagDefs = [
        { lbl: 'SYN', bit: AR_TRIG_SYN_PL_SW },
        { lbl: 'SMP', bit: AR_TRIG_SMP_PL_SW },
        { lbl: 'ENV', bit: AR_TRIG_ENV_PL_SW },
        { lbl: 'LFO', bit: AR_TRIG_LFO_PL_SW },
      ];
      for (const f of flagDefs) {
        const el = document.createElement('span');
        el.className = 'ts-flag' + ((defFlags & f.bit) ? ' on' : '');
        el.textContent = f.lbl;
        el.title = 'Default ' + f.lbl + ((defFlags & f.bit) ? ' ON' : ' OFF');
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const nf = defFlags ^ f.bit;
          writeU16BE(raw, trackBase + DEFAULT_TRIG_FLAGS_OFFSET, nf);
          refreshAfterEdit();
        });
        flagGrp.appendChild(el);
      }
      panel.appendChild(flagGrp);

      return panel;
    }

    function buildStepPanel(t, s) {
      const trackBase = 4 + t * TRACK_V5_SZ;
      const trigBits  = S.pattern.raw.subarray(trackBase + TRIG_BITS_OFFSET, trackBase + 112);
      const flags     = getTrigFlags(trigBits, s);
      const isOn      = (flags & AR_TRIG_ENABLE) !== 0;
      const spScaleMode = readU8(S.pattern.raw, SCALE_MODE_OFFSET);
      const spMasterLenRaw = readU16BE(S.pattern.raw, MASTER_LENGTH_OFFSET);
      const spMasterSteps = (spMasterLenRaw === 0 || spMasterLenRaw === 1) ? 64 : Math.min(spMasterLenRaw, 64);
      const numSteps  = spScaleMode ? S.pattern.raw[trackBase + NUM_STEPS_OFFSET] : spMasterSteps;
      const beyond    = s >= numSteps;
      const SYN_SMP_EN = AR_TRIG_SYN_PL_EN | AR_TRIG_SMP_PL_EN;
      const isLockTrig = !beyond && isOn &&
        (flags & SYN_SMP_EN) === SYN_SMP_EN &&
        (flags & (AR_TRIG_SYN_PL_SW | AR_TRIG_SMP_PL_SW)) === 0;
      const trigType = beyond ? 'BEYOND' : isLockTrig ? 'PARAMETER LOCK' : isOn ? 'TRIG' : 'EMPTY';

      // Determine machine type: sound-locked → pool sound, else → kit
      const sndLock = S.pattern.raw[trackBase + SOUND_LOCK_OFFSET + s];
      const hasSoundLock = sndLock !== SOUND_LOCK_NONE;
      let stepMachineType = getTrackMachineType(t);
      let poolSound = null;
      if (hasSoundLock && S.pattern.soundPool.has(sndLock)) {
        poolSound = S.pattern.soundPool.get(sndLock);
        if (poolSound.length > MACHINE_TYPE_OFFSET) {
          const mt = poolSound[MACHINE_TYPE_OFFSET];
          if (mt < MACHINES.length) stepMachineType = mt;
        }
      }

      const machName = (stepMachineType !== null) ? MACHINES[stepMachineType].name : '';

      const panel = document.createElement('div');
      panel.className = 'step-panel';

      // Header
      const hdr = document.createElement('div');
      hdr.className = 'sp-header';
      const title = document.createElement('span');
      title.textContent = TRACK_NAMES[t] + ' · Step ' + (s + 1) + ' · ' + trigType
        + (machName ? ' · ' + machName : '');
      const closeBtn = document.createElement('button');
      closeBtn.className = 'sp-close';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', closeStepPanel);
      hdr.appendChild(title);
      hdr.appendChild(closeBtn);
      panel.appendChild(hdr);

      // Sections row
      const secs = document.createElement('div');
      secs.className = 'sp-sections';

      secs.appendChild(buildFlagsSection(flags, t, s));
      secs.appendChild(buildTrigSection(t, s, flags));
      secs.appendChild(buildRetrigSection(t, s, flags));
      if (t === 12) {
        for (const secKey of FX_SECTION_KEYS) {
          secs.appendChild(buildFxParamSection(secKey, t, s));
        }
      } else {
        for (const secKey of SECTION_KEYS) {
          secs.appendChild(buildParamSection(secKey, t, s, stepMachineType, poolSound));
        }
      }

      panel.appendChild(secs);
      return panel;
    }

    // FLAGS section: ACC / MUT / SWG / SLD / RTG
    function buildFlagsSection(flags, t, s) {
      const flagDefs = [
        { lbl: 'ACC', bit: AR_TRIG_ACCENT },
        { lbl: 'MUT', bit: AR_TRIG_MUTE   },
        { lbl: 'SWG', bit: AR_TRIG_SWING  },
        { lbl: 'SLD', bit: AR_TRIG_SLIDE  },
        { lbl: 'RTG', bit: AR_TRIG_RETRIG },
      ];
      const body = document.createElement('div');
      body.className = 'sp-flags';
      for (const f of flagDefs) {
        const on = (flags & f.bit) !== 0;
        const el = document.createElement('div');
        el.className = 'sp-flag' + (on ? ' on' : '');
        el.textContent = f.lbl;
        el.addEventListener('click', () => toggleTrigFlag(t, s, f.bit));
        body.appendChild(el);
      }
      return makeSec('FLAGS', body);
    }

    // ─── Meta UI helpers ──────────────────────────────────────────────────────

    function metaLabel(lbl, val, target) {
      const s = document.createElement('span');
      s.innerHTML = lbl + ': <span>' + val + '</span>';
      target.appendChild(s);
    }

    function metaField(lbl, displayVal, editVal, onCommit, inputOpts, target) {
      const wrap = document.createElement('span');
      const label = document.createTextNode(lbl + ': ');
      const v = document.createElement('span');
      v.className = 'meta-val editable';
      v.textContent = displayVal;
      wrap.appendChild(label);
      wrap.appendChild(v);
      target.appendChild(wrap);

      attachClickToEdit(v, displayVal, editVal, {
        width: inputOpts?.width,
        onCommit,
      });
    }

    function metaArrowField(lbl, displayVal, onDown, onUp, target) {
      const wrap = document.createElement('span');
      wrap.appendChild(document.createTextNode(lbl + ': '));
      const v = document.createElement('span');
      v.className = 'meta-val';
      v.textContent = displayVal;
      wrap.appendChild(v);
      wrap.appendChild(metaArrowBtn('▼', onDown));
      wrap.appendChild(metaArrowBtn('▲', onUp));
      target.appendChild(wrap);
    }

    function metaArrowBtn(text, handler) {
      const b = document.createElement('span');
      b.textContent = text;
      b.className = 'meta-arrow';
      b.addEventListener('click', (e) => { e.stopPropagation(); handler(); refreshAfterEdit(); });
      return b;
    }

    function metaAppendArrows(container, onDown, onUp) {
      const wrap = container.lastElementChild;
      wrap.appendChild(metaArrowBtn('▼', onDown));
      wrap.appendChild(metaArrowBtn('▲', onUp));
    }

    function metaStepDenom(n) {
      return n <= 16 ? 16 : n <= 32 ? 32 : n <= 48 ? 48 : 64;
    }

    // ─── Meta line 1: Pattern, Kit, BPM, Swing ─────────────────────────────

    function buildMetaLine1(raw) {
      const line = document.createElement('span');
      line.className = 'meta-line';

      metaLabel('Pattern', S.pattern.name, line);

      // Kit number: 0-127 → 1-128, 0xFF → unassigned
      const kitNum = raw.length > KIT_NUMBER_OFFSET ? raw[KIT_NUMBER_OFFSET] : 0xFF;
      const kitStr = (kitNum === 0xFF) ? '—' : String(kitNum + 1).padStart(2, '0');
      metaField('Kit', kitStr, kitNum === 0xFF ? '' : kitNum + 1, (val) => {
        const n = parseInt(val, 10);
        if (!isNaN(n) && n >= 1 && n <= 128) {
          raw[KIT_NUMBER_OFFSET] = n - 1;
        } else {
          raw[KIT_NUMBER_OFFSET] = 0xFF;
        }
        refreshAfterEdit();
      }, {}, line);
      metaAppendArrows(line,
        () => { const c = raw[KIT_NUMBER_OFFSET]; let n = (c === 0xFF ? 0 : c) - 1; if (n < 0) n = 127; raw[KIT_NUMBER_OFFSET] = n; },
        () => { const c = raw[KIT_NUMBER_OFFSET]; let n = (c === 0xFF ? 0 : c) + 1; if (n > 127) n = 0; raw[KIT_NUMBER_OFFSET] = n; }
      );

      // BPM: 16-bit BE, rawValue = BPM × 120
      const bpmRaw = readU16BE(raw, BPM_MSB_OFFSET);
      const bpmStr = bpmRaw ? (bpmRaw / 120).toFixed(1) : '—';
      metaField('BPM', bpmStr, bpmRaw ? (bpmRaw / 120).toFixed(1) : '120.0', (val) => {
        const bpm = parseFloat(val);
        if (!isNaN(bpm) && bpm >= 30 && bpm <= 300) {
          const rv = Math.round(bpm * 120);
          writeU16BE(raw, BPM_MSB_OFFSET, rv);
        }
        refreshAfterEdit();
      }, { width: '52px' }, line);

      // Swing: raw 0-30, displayed as 50-80%
      const swingAmt = readU8(raw, SWING_AMOUNT_OFFSET);
      metaField('Swing', (50 + swingAmt) + '%', 50 + swingAmt, (val) => {
        let n = parseInt(val, 10);
        if (isNaN(n)) n = 50;
        n = Math.max(50, Math.min(80, n));
        raw[SWING_AMOUNT_OFFSET] = n - 50;
        refreshAfterEdit();
      }, { width: '36px' }, line);

      return line;
    }

    // ─── Meta line 2: Scale, Length, Change, Speed ──────────────────────────

    function buildMetaLine2(raw) {
      const line = document.createElement('span');
      line.className = 'meta-line';

      // Scale mode: arrows-only toggle (NRM / ADV)
      const scaleMode = readU8(raw, SCALE_MODE_OFFSET);
      const toggleScale = () => {
        const wasAdv = raw[SCALE_MODE_OFFSET];
        raw[SCALE_MODE_OFFSET] = wasAdv ? 0 : 1;
        if (wasAdv) {
          let ml = readU16BE(raw, MASTER_LENGTH_OFFSET);
          if (ml === 0 || ml === 1 || ml > 64) {
            ml = 64;
            raw[MASTER_LENGTH_OFFSET] = 0;
            raw[MASTER_LENGTH_OFFSET + 1] = 64;
          }
          for (let t = 0; t < 13; t++)
            raw[4 + t * TRACK_V5_SZ + NUM_STEPS_OFFSET] = ml;
        }
      };
      metaArrowField('Scale', scaleMode ? 'ADV' : 'NRM', toggleScale, toggleScale, line);

      // Master length
      buildMasterLenField(raw, scaleMode, line);

      // Master change length: only in advanced mode
      if (scaleMode) buildMasterChgField(raw, line);

      // Master speed: arrows-only
      const masterSpd = raw.length > MASTER_SPEED_OFFSET ? raw[MASTER_SPEED_OFFSET] : 2;
      metaArrowField('Spd', TRACK_SPEED_LABELS[masterSpd] || '1x',
        () => { let s = raw[MASTER_SPEED_OFFSET]; raw[MASTER_SPEED_OFFSET] = s === 0 ? 6 : s - 1; },
        () => { let s = raw[MASTER_SPEED_OFFSET]; raw[MASTER_SPEED_OFFSET] = s >= 6 ? 0 : s + 1; },
        line
      );

      return line;
    }

    // Master length field (N/D with text entry + arrows)
    // Encoding: 0=1024, 1=INF, 2-1023=2-1023
    function buildMasterLenField(raw, scaleMode, container) {
      let masterLenRaw = readU16BE(raw, MASTER_LENGTH_OFFSET);
      if (!scaleMode && (masterLenRaw === 0 || masterLenRaw === 1 || masterLenRaw > 64)) {
        masterLenRaw = 64;
        raw[MASTER_LENGTH_OFFSET] = 0;
        raw[MASTER_LENGTH_OFFSET + 1] = 64;
      }
      const disp = masterLenRaw === 1 ? 'INF'
        : (masterLenRaw === 0 ? '1024' : String(masterLenRaw));

      const wrap = document.createElement('span');
      wrap.appendChild(document.createTextNode('Len: '));
      const v = document.createElement('span');
      v.className = 'meta-val editable';
      v.textContent = disp;
      wrap.appendChild(v);
      if (masterLenRaw !== 1) {
        const displayNum = masterLenRaw === 0 ? 1024 : masterLenRaw;
        const suf = document.createElement('span');
        suf.className = 'meta-suffix';
        suf.textContent = '/' + metaStepDenom(displayNum);
        wrap.appendChild(suf);
      }

      const readLen = () => readU16BE(raw, MASTER_LENGTH_OFFSET);
      const writeLen = (n) => {
        writeU16BE(raw, MASTER_LENGTH_OFFSET, n);
        if (!scaleMode) {
          const perTrack = (n === 0 || n === 1) ? 64 : Math.min(n, 64);
          for (let t = 0; t < 13; t++)
            raw[4 + t * TRACK_V5_SZ + NUM_STEPS_OFFSET] = perTrack;
        }
      };

      attachClickToEdit(v, disp, disp, {
        width: '40px',
        onCommit: (val) => {
          const upper = val.trim().toUpperCase();
          let n;
          if (!scaleMode) {
            n = parseInt(upper, 10);
            if (isNaN(n) || n < 2) n = 2;
            if (n > 64) n = 64;
          } else {
            if (upper === 'INF' || upper === '') n = 1;
            else { n = parseInt(upper, 10); if (isNaN(n) || n < 2) n = 1; if (n > 1024) n = 0; if (n === 1024) n = 0; }
          }
          writeLen(n);
          refreshAfterEdit();
        },
        onCancel: refreshAfterEdit,
      });

      wrap.appendChild(metaArrowBtn('▼', () => {
        const n = readLen();
        if (!scaleMode) {
          const cur = (n === 0 || n === 1) ? 64 : Math.min(n, 64);
          if (cur > 2) writeLen(cur - 1);
        } else {
          if (n === 1) writeLen(0);
          else if (n === 0) writeLen(1023);
          else if (n === 2) writeLen(1);
          else writeLen(n - 1);
        }
      }));
      wrap.appendChild(metaArrowBtn('▲', () => {
        const n = readLen();
        if (!scaleMode) {
          const cur = (n === 0 || n === 1) ? 64 : Math.min(n, 64);
          if (cur < 64) writeLen(cur + 1);
        } else {
          if (n === 1) writeLen(2);
          else if (n === 1023) writeLen(0);
          else if (n === 0) writeLen(1);
          else writeLen(n + 1);
        }
      }));
      container.appendChild(wrap);
    }

    // Master change length field (advanced mode only)
    // Encoding: 0=1024, 1=OFF, 2-1023=2-1023
    function buildMasterChgField(raw, container) {
      const chgRaw = readU16BE(raw, MASTER_CHG_OFFSET);
      const disp = chgRaw === 1 ? 'OFF'
        : (chgRaw === 0 ? '1024' : String(chgRaw));

      const wrap = document.createElement('span');
      wrap.appendChild(document.createTextNode('Chg: '));
      const v = document.createElement('span');
      v.className = 'meta-val editable';
      v.textContent = disp;
      wrap.appendChild(v);

      attachClickToEdit(v, disp, disp, {
        width: '40px',
        onCommit: (val) => {
          const upper = val.trim().toUpperCase();
          let n;
          if (upper === 'OFF' || upper === '') n = 1;
          else { n = parseInt(upper, 10); if (isNaN(n) || n < 2) n = 1; if (n >= 1024) n = 0; }
          writeU16BE(raw, MASTER_CHG_OFFSET, n);
          refreshAfterEdit();
        },
        onCancel: refreshAfterEdit,
      });

      const readChg = () => readU16BE(raw, MASTER_CHG_OFFSET);
      const writeChg = (n) => { writeU16BE(raw, MASTER_CHG_OFFSET, n); };

      wrap.appendChild(metaArrowBtn('▼', () => {
        const n = readChg();
        if (n === 1) writeChg(0);
        else if (n === 0) writeChg(1023);
        else if (n === 2) writeChg(1);
        else writeChg(n - 1);
      }));
      wrap.appendChild(metaArrowBtn('▲', () => {
        const n = readChg();
        if (n === 1) writeChg(2);
        else if (n === 1023) writeChg(0);
        else if (n === 0) writeChg(1);
        else writeChg(n + 1);
      }));
      container.appendChild(wrap);
    }

    // ─── Pattern metadata display (editable) ─────────────────────────────────

    function renderMeta() {
      if (!S.pattern.raw) return;
      const raw = S.pattern.raw;
      U.metaEl.textContent = '';
      U.metaEl.appendChild(buildMetaLine1(raw));
      U.metaEl.appendChild(buildMetaLine2(raw));
    }

    function refreshAfterEdit() {
      const had = S.ui.openPanel ? { t: S.ui.openPanel.t, s: S.ui.openPanel.s } : null;
      const hadTrack = S.ui.openTrackPanel ? { t: S.ui.openTrackPanel.t } : null;
      renderMeta();
      renderGrid(S.pattern.raw, S.ui.stepPage);
      if (had) openStepPanel(had.t, had.s);
      if (hadTrack) openTrackSettingsPanel(hadTrack.t);
    }

    // Map from PL_SW bit → corresponding PL_EN bit
    const PL_SW_TO_EN = {
      [AR_TRIG_SYN_PL_SW]: AR_TRIG_SYN_PL_EN,
      [AR_TRIG_SMP_PL_SW]: AR_TRIG_SMP_PL_EN,
      [AR_TRIG_ENV_PL_SW]: AR_TRIG_ENV_PL_EN,
      [AR_TRIG_LFO_PL_SW]: AR_TRIG_LFO_PL_EN,
    };

    function toggleTrigFlag(t, s, bit) {
      if (!S.pattern.raw) return;
      const trackBase = 4 + t * TRACK_V5_SZ;
      const trigBits  = S.pattern.raw.subarray(trackBase + TRIG_BITS_OFFSET, trackBase + 112);
      let flags     = getTrigFlags(trigBits, s);
      const enBit = PL_SW_TO_EN[bit];
      if (enBit) {
        // Determine effective state: PL_EN ? PL_SW : track default
        const defFlags = readU16BE(S.pattern.raw, trackBase + DEFAULT_TRIG_FLAGS_OFFSET);
        const effectiveOn = (flags & enBit)
          ? (flags & bit) !== 0
          : (defFlags & bit) !== 0;
        if (effectiveOn) {
          // Turn OFF: set PL_EN, clear PL_SW
          flags = (flags | enBit) & ~bit;
        } else {
          // Turn ON: set PL_EN, set PL_SW
          flags = flags | enBit | bit;
        }
      } else {
        flags ^= bit;
      }
      setTrigFlags(trigBits, s, flags);
      refreshAfterEdit();
    }

    // TRIG section: NOTE, VELO, LEN, PROB, then SYN/SMP/ENV/LFO
    // Returns the trig condition index (0–56, see TRIG_COND_NAMES) if a per-step
    // trig condition is set, or null if the step plays unconditionally.
    // Condition bits are packed across notes/micro_timings/retrig_lengths/retrig_rates
    // (see ar_pattern_track_get_step_trig_condition in pattern.c).
    // When notes[s] bit 7 = 1 → no condition; bit 7 = 0 → has condition.
    function getTrigCondition(trackBase, s) {
      const noteRaw = S.pattern.raw[trackBase + NOTE_OFFSET + s];
      if ((noteRaw & NOTE_CONDITION_BIT) !== 0) return null; // bit 7 = 1 → no condition
      const microRaw  = S.pattern.raw[trackBase + MICRO_TIMING_OFFSET + s];
      const retLenRaw = S.pattern.raw[trackBase + RETRIG_LENGTH_OFFSET + s];
      const retRatRaw = S.pattern.raw[trackBase + RETRIG_RATE_OFFSET + s];
      let r = 0;
      r  = (noteRaw   & NOTE_CONDITION_BIT) >> 1;  // bit 6  (always 0 for valid conditions 0-56)
      r |= (microRaw  & UTIME_UPPER_MASK)   >> 2;  // bits 5..4
      r |= (retLenRaw & RETRIG_LEN_FLAG)    >> 4;  // bit 3
      r |= (retRatRaw & RETRIG_RATE_FLAGS)  >> 5;  // bits 2..0
      return r;
    }

    // Write a 7-bit trig condition, distributing bits across 4 byte arrays.
    // val=null clears the condition (sets notes bit 7 = 1, no condition).
    function setTrigCondition(trackBase, s, val) {
      if (!S.pattern.raw) return;
      const nOff = trackBase + NOTE_OFFSET + s;
      const mOff = trackBase + MICRO_TIMING_OFFSET + s;
      const lOff = trackBase + RETRIG_LENGTH_OFFSET + s;
      const rOff = trackBase + RETRIG_RATE_OFFSET + s;
      if (val === null) {
        // Clear condition: set notes bit 7 = 1
        S.pattern.raw[nOff] = S.pattern.raw[nOff] | NOTE_CONDITION_BIT;
        return;
      }
      // Distribute 7-bit value across scattered bits (matching C setter)
      S.pattern.raw[nOff] = (S.pattern.raw[nOff] & ~NOTE_CONDITION_BIT) | ((val & TRIG_COND_NOTE_SHIFT_BIT) << 1);
      S.pattern.raw[mOff] = (S.pattern.raw[mOff] & ~UTIME_UPPER_MASK)  | ((val & TRIG_COND_MICRO_BITS) << 2);
      S.pattern.raw[lOff] = (S.pattern.raw[lOff] & ~RETRIG_LEN_FLAG)   | ((val & TRIG_COND_LEN_BIT) << 4);
      S.pattern.raw[rOff] = (S.pattern.raw[rOff] & ~RETRIG_RATE_FLAGS) | ((val & TRIG_COND_RATE_BITS) << 5);
    }

    function buildTrigSection(t, s, flags) {
      const trackBase = 4 + t * TRACK_V5_SZ;

      const noteRaw  = S.pattern.raw[trackBase + NOTE_OFFSET + s];
      const defNote  = S.pattern.raw[trackBase + DEFAULT_NOTE_OFFSET];
      const noteLocked = (noteRaw !== PLOCK_NO_VALUE && (noteRaw & NOTE_VALUE_MASK) !== NOTE_UNLOCKED);
      const noteVal  = noteLocked ? midiNoteToName(noteRaw & NOTE_VALUE_MASK) : midiNoteToName(defNote);

      const veloRaw  = S.pattern.raw[trackBase + VELOCITY_OFFSET + s];
      const defVelo  = S.pattern.raw[trackBase + DEFAULT_VELOCITY_OFFSET];
      const veloLocked = veloRaw !== PLOCK_NO_VALUE;
      const veloVal  = veloLocked ? veloRaw : defVelo;

      const lenRaw   = S.pattern.raw[trackBase + NOTE_LEN_OFFSET + s];
      const defLen   = S.pattern.raw[trackBase + DEFAULT_NOTE_LEN_OFFSET];
      const lenLocked = lenRaw !== PLOCK_NO_VALUE;
      const lenVal   = noteLenStr(lenLocked ? lenRaw : defLen);

      const prob     = S.pattern.raw[trackBase + TRIG_PROBABILITY_OFFSET];

      // Per-step trig condition overrides the track-level probability
      const trigCond   = getTrigCondition(trackBase, s);
      const probStr    = trigCond !== null
        ? (TRIG_COND_NAMES[trigCond] ?? String(trigCond))
        : (prob + '%');
      const probLocked = trigCond !== null;

      const sndLock  = S.pattern.raw[trackBase + SOUND_LOCK_OFFSET + s];
      const hasSnd   = sndLock !== SOUND_LOCK_NONE;

      let sndDisplay = hasSnd ? (sndLock + 1) : 'TRK';
      if (hasSnd && S.pattern.soundPool.has(sndLock)) {
        const ps = S.pattern.soundPool.get(sndLock);
        if (ps.length > MACHINE_TYPE_OFFSET) {
          const mt = ps[MACHINE_TYPE_OFFSET];
          if (mt < MACHINES.length) sndDisplay = (sndLock + 1) + ' ' + MACHINES[mt].name;
        }
      }

      const body = document.createElement('div');
      body.className = 'sp-params';

      // Helper: write a byte to S.pattern.raw and refresh
      const writeByte = (off, val) => {
        S.pattern.raw[off] = val;
        refreshAfterEdit();
      };

      // SND: 0-127 = pool slot, display as slot+1; clear = no lock (TRK)
      const sndOff = trackBase + SOUND_LOCK_OFFSET + s;
      const sndRawVal = hasSnd ? sndLock : 128;
      const sndDispFn = (v) => {
        if (v >= 128) return 'TRK';
        let d = String(v + 1);
        if (S.pattern.soundPool.has(v)) {
          const ps = S.pattern.soundPool.get(v);
          if (ps.length > MACHINE_TYPE_OFFSET) {
            const mt = ps[MACHINE_TYPE_OFFSET];
            if (mt < MACHINES.length) d += ' ' + MACHINES[mt].name;
          }
        }
        return d;
      };
      body.appendChild(makeParamRow('SND', sndDisplay, hasSnd, {
        min: 0, max: 128, rawVal: sndRawVal, displayFn: sndDispFn,
        onChange: (v) => writeByte(sndOff, v >= 128 ? SOUND_LOCK_NONE : v),
      }));

      // NOTE: edit the 7-bit note value, preserve bit 7 (trig condition flag)
      const noteOff = trackBase + NOTE_OFFSET + s;
      const noteRawVal = noteLocked ? (noteRaw & NOTE_VALUE_MASK) : 128;
      const noteEffective = noteLocked ? (noteRaw & NOTE_VALUE_MASK) : defNote;
      body.appendChild(makeParamRow('NOTE', noteVal, noteLocked, {
        min: 0, max: 128, rawVal: noteRawVal, initVal: noteEffective,
        displayFn: (v) => v >= 128 ? 'TRK' : midiNoteToName(v),
        onChange: (v) => {
          if (v >= 128) { writeByte(noteOff, (noteRaw & NOTE_CONDITION_BIT) | NOTE_UNLOCKED); }
          else { writeByte(noteOff, (noteRaw & NOTE_CONDITION_BIT) | (v & NOTE_VALUE_MASK)); }
        },
      }));

      // VELO: 0-127 = value, 128 = clear (use default)
      const veloOff = trackBase + VELOCITY_OFFSET + s;
      const veloRawVal = veloLocked ? veloRaw : 128;
      body.appendChild(makeParamRow('VELO', veloVal, veloLocked, {
        min: 0, max: 128, rawVal: veloRawVal, initVal: veloLocked ? veloRaw : defVelo,
        displayFn: (v) => v >= 128 ? 'TRK' : v,
        onChange: (v) => writeByte(veloOff, v >= 128 ? PLOCK_NO_VALUE : v),
      }));

      // LEN: 0-127 = value (127=∞), 128 = clear (use default)
      const lenOff = trackBase + NOTE_LEN_OFFSET + s;
      const lenRawVal = lenLocked ? lenRaw : 128;
      body.appendChild(makeParamRow('LEN', lenVal, lenLocked, {
        min: 0, max: 128, rawVal: lenRawVal, initVal: lenLocked ? lenRaw : defLen,
        displayFn: (v) => v >= 128 ? 'TRK' : noteLenStr(v),
        onChange: (v) => writeByte(lenOff, v >= 128 ? PLOCK_NO_VALUE : v),
      }));

      // PROB: trig condition (0-64 = conditions, 65 = TRK = use track probability)
      const condCount = TRIG_COND_NAMES.length;  // 65 entries (0-64)
      const probRawVal = probLocked ? trigCond : condCount;
      const probDispFn = (v) => v >= condCount ? (prob + '%') : (TRIG_COND_NAMES[v] ?? String(v));
      body.appendChild(makeParamRow('PROB', probStr, probLocked, {
        min: 0, max: condCount, rawVal: probRawVal,
        initVal: probLocked ? trigCond : condCount,
        displayFn: probDispFn,
        onChange: (v) => {
          if (v >= condCount) {
            setTrigCondition(trackBase, s, null);
          } else {
            setTrigCondition(trackBase, s, v);
          }
          refreshAfterEdit();
        },
      }));

      // UTIME: -23..+23, stored in lower 6 bits, preserve upper bits (trig condition)
      const microRaw    = S.pattern.raw[trackBase + MICRO_TIMING_OFFSET + s];
      const microVal    = microRaw & UTIME_VALUE_MASK;
      const microSigned = (microVal & UTIME_SIGN_BIT) ? microVal - 64 : microVal;
      const utimeStr    = utimeFrac(microSigned);
      const utimeDispFn = (v) => utimeFrac(v);
      body.appendChild(makeParamRow('UTIME', utimeStr, microSigned !== 0, {
        min: -23, max: 23, rawVal: microSigned, displayFn: utimeDispFn, snap: 0,
        onChange: (v) => {
          // Encode signed value into 6-bit field, preserve upper 2 bits
          const enc = v < 0 ? (v + 64) & UTIME_VALUE_MASK : v & UTIME_VALUE_MASK;
          S.pattern.raw[trackBase + MICRO_TIMING_OFFSET + s] = (microRaw & UTIME_UPPER_MASK) | enc;
          refreshAfterEdit();
        },
      }));

      // SYN / SMP / ENV / LFO retrigger switches
      // For SYN/SMP: effective state = PL_EN ? PL_SW : track default
      const defFlags = readU16BE(S.pattern.raw, trackBase + DEFAULT_TRIG_FLAGS_OFFSET);
      const swDefs = [
        { lbl: 'SYN', bit: AR_TRIG_SYN_PL_SW, en: AR_TRIG_SYN_PL_EN },
        { lbl: 'SMP', bit: AR_TRIG_SMP_PL_SW, en: AR_TRIG_SMP_PL_EN },
        { lbl: 'ENV', bit: AR_TRIG_ENV_PL_SW, en: AR_TRIG_ENV_PL_EN },
        { lbl: 'LFO', bit: AR_TRIG_LFO_PL_SW, en: AR_TRIG_LFO_PL_EN },
      ];
      const swRow = document.createElement('div');
      swRow.className = 'sp-sw-row';
      for (const sw of swDefs) {
        // Effective state: if PL_EN is set, use PL_SW; otherwise use track default
        const on = (flags & sw.en)
          ? (flags & sw.bit) !== 0
          : (defFlags & sw.bit) !== 0;
        const el = document.createElement('div');
        el.className = 'sp-flag' + (on ? ' on' : '');
        el.textContent = sw.lbl;
        el.addEventListener('click', () => toggleTrigFlag(t, s, sw.bit));
        swRow.appendChild(el);
      }
      body.appendChild(swRow);

      return makeSec('TRIG', body);
    }

    // RETRIG section: RATE, LEN, VEL — always shown; highlighted when retrig is active
    function buildRetrigSection(t, s, flags) {
      const trackBase = 4 + t * TRACK_V5_SZ;
      const isRetrig  = (flags & AR_TRIG_RETRIG) !== 0;

      const rateRaw   = S.pattern.raw[trackBase + RETRIG_RATE_OFFSET   + s] & RETRIG_RATE_MASK;
      const lenRaw    = S.pattern.raw[trackBase + RETRIG_LENGTH_OFFSET  + s] & RETRIG_LEN_VALUE_MASK;
      const velRaw    = S.pattern.raw[trackBase + RETRIG_VELO_OFFSET    + s];
      const velSigned = velRaw > 127 ? velRaw - 256 : velRaw;

      const rateStr   = RETRIG_RATE_LABELS[rateRaw] ?? String(rateRaw);
      const lenStr    = noteLenDisplay(noteLenVal(lenRaw));
      const velStr    = (velSigned >= 0 ? '+' : '') + velSigned;

      const body = document.createElement('div');
      body.className = 'sp-params';

      // RATE: 0-16, stored in lower 5 bits; preserve upper bits (trig condition)
      const rateOff  = trackBase + RETRIG_RATE_OFFSET + s;
      const rateFull = S.pattern.raw[rateOff];
      body.appendChild(makeParamRow('RATE', rateStr, isRetrig, {
        min: 0, max: 16, rawVal: rateRaw,
        displayFn: (v) => RETRIG_RATE_LABELS[v] ?? String(v),
        onChange: (v) => {
          S.pattern.raw[rateOff] = (rateFull & RETRIG_RATE_FLAGS) | (v & RETRIG_RATE_MASK);
          refreshAfterEdit();
        },
      }));

      // LEN: 0-127, stored in lower 7 bits; preserve bit 7 (trig condition)
      const lenOff2  = trackBase + RETRIG_LENGTH_OFFSET + s;
      const lenFull  = S.pattern.raw[lenOff2];
      body.appendChild(makeParamRow('LEN', lenStr, isRetrig, {
        min: 0, max: 127, rawVal: lenRaw,
        displayFn: (v) => noteLenDisplay(noteLenVal(v)),
        onChange: (v) => {
          S.pattern.raw[lenOff2] = (lenFull & RETRIG_LEN_FLAG) | (v & RETRIG_LEN_VALUE_MASK);
          refreshAfterEdit();
        },
      }));

      // VEL: -128..+127, stored as unsigned byte interpreted as signed
      const velOff = trackBase + RETRIG_VELO_OFFSET + s;
      body.appendChild(makeParamRow('VEL', velStr, isRetrig && velSigned !== 0, {
        min: -128, max: 127, rawVal: velSigned, snap: 0, snapR: 5,
        displayFn: (v) => (v >= 0 ? '+' : '') + v,
        onChange: (v) => {
          S.pattern.raw[velOff] = v < 0 ? v + 256 : v;
          refreshAfterEdit();
        },
      }));

      return makeSec('RETRIG', body);
    }

    // Write a plock value into S.pattern.raw. Finds or allocates the plock sequence
    // slot for the given track + param type. Deallocates if all steps become PLOCK_NO_VALUE.
    // When deallocating, any fine companion in the adjacent slot is also cleaned up
    // to prevent orphaned fine slots (which would corrupt the coarse+fine pairing).
    function writePlock(t, pt, s, val) {
      if (!S.pattern.raw) return;
      const end = PLOCK_SEQS_BASE + NUM_PLOCK_SEQS * PLOCK_SEQ_SZ;
      if (S.pattern.raw.length < end) return;

      // Find existing slot for this track + param type
      let slotBase = -1;
      let slotIdx  = -1;
      let freeBase = -1;
      for (let si = 0; si < NUM_PLOCK_SEQS; si++) {
        const base = PLOCK_SEQS_BASE + si * PLOCK_SEQ_SZ;
        if (S.pattern.raw[base] === pt && S.pattern.raw[base + 1] === t) { slotBase = base; slotIdx = si; break; }
        if (freeBase < 0 && S.pattern.raw[base] === PLOCK_TYPE_UNUSED) freeBase = base;
      }

      if (slotBase >= 0) {
        // Existing slot — write the value
        S.pattern.raw[slotBase + 2 + s] = val;
        // If all steps are now empty, deallocate the slot
        let allEmpty = true;
        for (let i = 0; i < AR_NUM_STEPS; i++) {
          if (S.pattern.raw[slotBase + 2 + i] !== PLOCK_NO_VALUE) { allEmpty = false; break; }
        }
        if (allEmpty) {
          S.pattern.raw[slotBase] = PLOCK_TYPE_UNUSED;
          S.pattern.raw[slotBase + 1] = PLOCK_TYPE_UNUSED;
          // Also deallocate any fine companion in the next slot to prevent orphans
          const nextSi = slotIdx + 1;
          if (nextSi < NUM_PLOCK_SEQS) {
            const nb = PLOCK_SEQS_BASE + nextSi * PLOCK_SEQ_SZ;
            if (S.pattern.raw[nb] === PLOCK_FINE_FLAG && S.pattern.raw[nb + 1] === PLOCK_FINE_FLAG) {
              S.pattern.raw[nb] = PLOCK_TYPE_UNUSED;
              S.pattern.raw[nb + 1] = PLOCK_TYPE_UNUSED;
            }
          }
        }
      } else if (val !== PLOCK_NO_VALUE && freeBase >= 0) {
        // Allocate new slot
        S.pattern.raw[freeBase] = pt;
        S.pattern.raw[freeBase + 1] = t;
        for (let i = 0; i < AR_NUM_STEPS; i++) S.pattern.raw[freeBase + 2 + i] = PLOCK_NO_VALUE;
        S.pattern.raw[freeBase + 2 + s] = val;
      }
      // else: no slot found and val is cleared — nothing to do
    }

    // Clear the fine companion value for a single step.  Deallocates the fine
    // slot if all its steps become empty.
    // IMPORTANT: call BEFORE writePlock when clearing a coarse value — if
    // writePlock deallocates the coarse slot first, the fine companion becomes
    // orphaned (type/track 0x80 with no preceding coarse to pair with).
    function clearPlockFine(t, pt, s) {
      if (!S.pattern.raw) return;
      for (let si = 0; si < NUM_PLOCK_SEQS; si++) {
        const base = PLOCK_SEQS_BASE + si * PLOCK_SEQ_SZ;
        if (S.pattern.raw[base] === pt && S.pattern.raw[base + 1] === t) {
          // Found coarse slot; check if next slot is a fine companion
          const nextSi = si + 1;
          if (nextSi < NUM_PLOCK_SEQS) {
            const nb = PLOCK_SEQS_BASE + nextSi * PLOCK_SEQ_SZ;
            if (S.pattern.raw[nb] === PLOCK_FINE_FLAG && S.pattern.raw[nb + 1] === PLOCK_FINE_FLAG) {
              S.pattern.raw[nb + 2 + s] = PLOCK_NO_VALUE;
              let allEmpty = true;
              for (let i = 0; i < AR_NUM_STEPS; i++) {
                if (S.pattern.raw[nb + 2 + i] !== PLOCK_NO_VALUE) { allEmpty = false; break; }
              }
              if (allEmpty) { S.pattern.raw[nb] = PLOCK_TYPE_UNUSED; S.pattern.raw[nb + 1] = PLOCK_TYPE_UNUSED; }
            }
          }
          break;
        }
      }
    }

    // Write a fine value to the fine companion of a coarse plock.
    // If the companion slot doesn't exist yet, it is created in slot N+1
    // (requires that slot to be free).  If slot N+1 is occupied by another
    // coarse plock, the fine value is silently dropped — this matches the AR's
    // own behaviour when plock slots are exhausted.
    function writePlockFine(t, pt, s, fineVal) {
      if (!S.pattern.raw) return;
      // Find coarse slot
      for (let si = 0; si < NUM_PLOCK_SEQS; si++) {
        const base = PLOCK_SEQS_BASE + si * PLOCK_SEQ_SZ;
        if (S.pattern.raw[base] !== pt || S.pattern.raw[base + 1] !== t) continue;

        // Found coarse at si — check si+1 for companion
        const nextSi = si + 1;
        if (nextSi >= NUM_PLOCK_SEQS) return;
        const nb = PLOCK_SEQS_BASE + nextSi * PLOCK_SEQ_SZ;

        if (S.pattern.raw[nb] === PLOCK_FINE_FLAG && S.pattern.raw[nb + 1] === PLOCK_FINE_FLAG) {
          // Companion exists — update step value
          S.pattern.raw[nb + 2 + s] = fineVal;
        } else if (S.pattern.raw[nb] === PLOCK_TYPE_UNUSED) {
          // Next slot free — create companion
          S.pattern.raw[nb] = PLOCK_FINE_FLAG;
          S.pattern.raw[nb + 1] = PLOCK_FINE_FLAG;
          for (let i = 0; i < AR_NUM_STEPS; i++) S.pattern.raw[nb + 2 + i] = PLOCK_NO_VALUE;
          S.pattern.raw[nb + 2 + s] = fineVal;
        }
        // else: next slot occupied by another plock — can't create companion
        return;
      }
    }

    // Compute LFO effective speed label from current raw data
    function lfoSpeedLabel(t, s, poolSound) {
      const spdInfo = PLOCK_INFO[0x21];
      const mulInfo = PLOCK_INFO[0x22];
      const spdArr = S.pattern.plocks && S.pattern.plocks[t].get(0x21);
      const mulArr = S.pattern.plocks && S.pattern.plocks[t].get(0x22);
      const spdRaw = (spdArr && spdArr[s] !== PLOCK_NO_VALUE) ? spdArr[s]
        : (poolSound && spdInfo.sndOff < poolSound.length ? poolSound[spdInfo.sndOff]
        : getKitDefault(t, spdInfo.sndOff));
      const mulRaw = (mulArr && mulArr[s] !== PLOCK_NO_VALUE) ? mulArr[s]
        : (poolSound && mulInfo.sndOff < poolSound.length ? poolSound[mulInfo.sndOff]
        : getKitDefault(t, mulInfo.sndOff));
      if (spdRaw === null || mulRaw === null) return null;
      const spd = spdRaw - 64;
      const isDot = mulRaw >= 12;
      const mulIdx = isDot ? mulRaw - 12 : mulRaw;
      const mulFactor = Math.pow(2, mulIdx);
      const rev = spd < 0 ? ' rev' : '';
      if (spd === 0) return 'stopped';
      if (isDot) {
        const hz = 120 * Math.abs(spd) * mulFactor / (128 * 240);
        return (hz >= 1 ? hz.toFixed(2) + ' Hz' : (1/hz).toFixed(2) + ' s') + rev;
      }
      const cpb = Math.abs(spd) * mulFactor / 128;
      const spc = 16 / cpb;
      const str = spc === 1 ? '1/16' : spc === 2 ? '1/8' : spc === 4 ? '1/4'
        : spc === 8 ? '1/2' : spc === 16 ? '1 bar' : spc === 32 ? '2 bars'
        : spc === 64 ? '4 bars' : spc >= 16 ? (spc/16).toFixed(1) + ' bars'
        : spc < 1 ? '1/' + Math.round(4/spc) + ' beat'
        : spc.toFixed(1) + ' steps';
      return str + rev;
    }

    // FX LFO speed label (mirrors lfoSpeedLabel but reads from FX kit offsets)
    function fxLfoSpeedLabel(t, s) {
      const spdArr = S.pattern.plocks && S.pattern.plocks[t].get(29);
      const mulArr = S.pattern.plocks && S.pattern.plocks[t].get(30);
      const spdRaw = (spdArr && spdArr[s] !== PLOCK_NO_VALUE) ? spdArr[s]
        : getKitFxDefault(FX_PLOCK_INFO[29].kitOff);
      const mulRaw = (mulArr && mulArr[s] !== PLOCK_NO_VALUE) ? mulArr[s]
        : getKitFxDefault(FX_PLOCK_INFO[30].kitOff);
      if (spdRaw === null || mulRaw === null) return null;
      const spd = spdRaw - 64;
      const isDot = mulRaw >= 12;
      const mulIdx = isDot ? mulRaw - 12 : mulRaw;
      const mulFactor = Math.pow(2, mulIdx);
      const rev = spd < 0 ? ' rev' : '';
      if (spd === 0) return 'stopped';
      if (isDot) {
        const hz = 120 * Math.abs(spd) * mulFactor / (128 * 240);
        return (hz >= 1 ? hz.toFixed(2) + ' Hz' : (1/hz).toFixed(2) + ' s') + rev;
      }
      const cpb = Math.abs(spd) * mulFactor / 128;
      const spc = 16 / cpb;
      const str = spc === 1 ? '1/16' : spc === 2 ? '1/8' : spc === 4 ? '1/4'
        : spc === 8 ? '1/2' : spc === 16 ? '1 bar' : spc === 32 ? '2 bars'
        : spc === 64 ? '4 bars' : spc >= 16 ? (spc/16).toFixed(1) + ' bars'
        : spc < 1 ? '1/' + Math.round(4/spc) + ' beat'
        : spc.toFixed(1) + ' steps';
      return str + rev;
    }

    // DELAY / REVERB / DIST / COMP / FX_LFO sections (FX track only)
    function buildFxParamSection(secKey, t, s) {
      const body = document.createElement('div');
      body.className = 'sp-params';

      const order = FX_SECTION_ORDER[secKey]
        || Object.keys(FX_PLOCK_INFO).map(Number).filter(k => FX_PLOCK_INFO[k].sec === secKey);

      for (const pt of order) {
        const info = FX_PLOCK_INFO[pt];
        if (!info) continue;

        const lbl = info.lbl;
        const kitDef = getKitFxDefault(info.kitOff);
        const plArr  = S.pattern.plocks && S.pattern.plocks[t].get(pt);
        const plVal  = plArr ? plArr[s] : PLOCK_NO_VALUE;
        const locked = plVal !== PLOCK_NO_VALUE;

        const displayVal = locked ? plVal : (kitDef !== null ? kitDef : '?');
        const plRawVal = locked ? plVal : 128;
        const plInitVal = locked ? plVal : (kitDef !== null ? kitDef : 0);
        const ptCapture = pt;

        let displayFn, pMin = 0, pMax = 128, snap, snapR;

        if (info.enum) {
          const enumArr = info.enum;
          const enumLen = enumArr.length;
          displayFn = (v) => v >= enumLen ? 'TRK' : (enumArr[v] ?? String(v));
          pMax = enumLen;
        } else if (info.fxLfoDest) {
          const destCount = FX_LFO_DEST_UI_IDS.length;
          displayFn = (v) => {
            if (v >= destCount) return 'TRK';
            const internalId = FX_LFO_DEST_UI_IDS[v];
            return fxLfoDestName(internalId);
          };
          pMax = destCount;
        } else if (info.noteLen) {
          displayFn = (v) => v >= 128 ? 'TRK' : noteLenDisplay(noteLenVal(v));
        } else if (info.pct200) {
          displayFn = displayPct200;
        } else if (info.inf127) {
          displayFn = displayInf127;
        } else if (info.lfoPhase) {
          displayFn = displayLfoPhase;
        } else if (info.bipolar) {
          displayFn = displayBipolar;
          snap = 64; snapR = 3;
        } else {
          displayFn = displayPlain;
        }

        // Convert raw internal IDs to UI indices for FX LFO dest slider
        let sliderRawVal = plRawVal;
        let sliderInitVal = plInitVal;
        if (info.fxLfoDest) {
          sliderRawVal  = plRawVal >= 128  ? pMax : (FX_LFO_DEST_ID_TO_UI.get(plRawVal) ?? 0);
          sliderInitVal = plInitVal >= 128 ? 0    : (FX_LFO_DEST_ID_TO_UI.get(plInitVal) ?? 0);
        }

        let onChange;
        if (info.fxLfoDest) {
          onChange = (v) => {
            writePlock(t, ptCapture, s, v >= pMax ? PLOCK_NO_VALUE : FX_LFO_DEST_UI_IDS[v]);
            refreshAfterEdit();
          };
        } else {
          onChange = (v) => {
            writePlock(t, ptCapture, s, v >= pMax ? PLOCK_NO_VALUE : v);
            refreshAfterEdit();
          };
        }

        const opts = {
          min: pMin, max: pMax, rawVal: sliderRawVal, initVal: sliderInitVal,
          displayFn, onChange,
        };
        if (snap !== undefined) { opts.snap = snap; opts.snapR = snapR; }

        // FX LFO SPD/MUL: live-preview speed label while dragging
        if (secKey === 'FX_LFO' && (pt === 29 || pt === 30)) {
          opts.onPreview = (v) => {
            const sub = body.closest?.('.sp-sec')?.querySelector('.sp-sec-sub');
            if (!sub) return;
            const spdArr = S.pattern.plocks && S.pattern.plocks[t].get(29);
            const mulArr = S.pattern.plocks && S.pattern.plocks[t].get(30);
            let spdRaw = (spdArr && spdArr[s] !== PLOCK_NO_VALUE) ? spdArr[s]
              : getKitFxDefault(FX_PLOCK_INFO[29].kitOff);
            let mulRaw = (mulArr && mulArr[s] !== PLOCK_NO_VALUE) ? mulArr[s]
              : getKitFxDefault(FX_PLOCK_INFO[30].kitOff);
            if (pt === 29) spdRaw = (v >= pMax) ? getKitFxDefault(FX_PLOCK_INFO[29].kitOff) : v;
            if (pt === 30) mulRaw = (v >= pMax) ? getKitFxDefault(FX_PLOCK_INFO[30].kitOff) : v;
            if (spdRaw == null || mulRaw == null) return;
            const spd = spdRaw - 64;
            const isDot = mulRaw >= 12;
            const mulIdx = isDot ? mulRaw - 12 : mulRaw;
            const mulFactor = Math.pow(2, mulIdx);
            const rev = spd < 0 ? ' rev' : '';
            let label;
            if (spd === 0) { label = 'stopped'; }
            else if (isDot) {
              const hz = 120 * Math.abs(spd) * mulFactor / (128 * 240);
              label = (hz >= 1 ? hz.toFixed(2) + ' Hz' : (1/hz).toFixed(2) + ' s') + rev;
            } else {
              const spc = 16 * 128 / (Math.abs(spd) * mulFactor);
              label = spc === 1 ? '1/16' : spc === 2 ? '1/8' : spc === 4 ? '1/4'
                : spc === 8 ? '1/2' : spc === 16 ? '1 bar' : spc === 32 ? '2 bars'
                : spc === 64 ? '4 bars' : spc >= 16 ? (spc/16).toFixed(1) + ' bars'
                : spc < 1 ? '1/' + Math.round(4/spc) + ' beat'
                : spc.toFixed(1) + ' steps';
              label += rev;
            }
            sub.textContent = '(' + label + ')';
          };
        }

        const showInput = typeof displayVal === 'number'
          ? (info.fxLfoDest ? (FX_LFO_DEST_ID_TO_UI.get(displayVal) ?? 0) : displayVal)
          : displayVal;
        const showVal = typeof showInput === 'number' ? displayFn(showInput) : showInput;

        body.appendChild(makeParamRow(lbl, showVal, locked, opts));
      }

      // FX LFO: compute effective speed string for section header
      let lfoSpeedStr = null;
      if (secKey === 'FX_LFO') {
        lfoSpeedStr = fxLfoSpeedLabel(t, s);
      }

      return makeSec(secKey === 'FX_LFO' ? 'LFO' : secKey, body, lfoSpeedStr);
    }

    // ─── Param section helpers ─────────────────────────────────────────────────

    // Resolve display function, slider range, and type flags for a track param
    function buildParamDisplayConfig(info, secKey, pt, machineType, lbl) {
      let enumArr = info.enum;
      let isBipolar = info.bipolar;
      let decimalHR = null, machInf127 = false, isFreqParam = false;

      if (secKey === 'SRC' && pt <= PLOCK_SYNTH_PARAM_MAX && machineType !== null && machineType !== undefined) {
        const mach = MACHINES[machineType];
        if (mach.enums?.[pt]) enumArr = mach.enums[pt];
        if (mach.bipolar?.has(pt)) isBipolar = true;
        if (mach.decimal?.[pt] !== undefined) {
          decimalHR = mach.decimal[pt];
          isBipolar = true;
        }
        if (mach.freq?.has(pt)) isFreqParam = true;
        if (lbl === 'TUN') isBipolar = true;
        if (mach.inf127?.has(pt)) machInf127 = true;
      }

      let displayFn, pMin = 0, pMax = 128, snap, snapR;
      if (enumArr) {
        const enumLen = enumArr.length;
        displayFn = (v) => v >= enumLen ? 'TRK' : (enumArr[v] ?? String(v));
        pMax = enumLen;
      } else if (machInf127) {
        displayFn = displayInf127;
      } else if (isFreqParam) {
        pMin = 0; pMax = 16257;
        displayFn = (v) => v >= 16256 ? 'TRK' : v + 'Hz';
      } else if (isBipolar) {
        if (decimalHR !== null) {
          const hr = decimalHR;
          const sliderHalf = hr * 2;
          pMin = 0; pMax = sliderHalf * 2 + 1;
          displayFn = (v) => {
            if (v >= sliderHalf * 2) return 'TRK';
            const d = (v - sliderHalf) * 0.50;
            return (d >= 0 ? '+' : '') + d.toFixed(2);
          };
          snap = sliderHalf; snapR = 3;
        } else {
          displayFn = displayBipolar;
          snap = 64; snapR = 3;
        }
      } else if (info.pan) {
        displayFn = displayPan;
        snap = 64; snapR = 3;
      } else if (info.inf127) {
        displayFn = displayInf127;
      } else if (info.lfoDest) {
        const destCount = LFO_DEST_UI_IDS.length;
        displayFn = (v) => {
          if (v >= destCount) return 'TRK';
          return lfoDestName(LFO_DEST_UI_IDS[v], machineType);
        };
        pMax = destCount;
      } else if (info.lfoPhase) {
        displayFn = displayLfoPhase;
      } else {
        displayFn = displayPlain;
      }

      return { displayFn, pMin, pMax, snap, snapR, isFreqParam, decimalHR };
    }

    // Resolve slider raw/init values for freq and decimal params (coarse+fine encoding)
    function resolveSliderState(cfg, info, t, s, pt, locked, plVal, plRawVal, plInitVal, poolSound) {
      let sliderRawVal = plRawVal;
      let sliderInitVal = plInitVal;

      if (info.lfoDest) {
        sliderRawVal  = plRawVal >= 128  ? cfg.pMax : (LFO_DEST_ID_TO_UI.get(plRawVal) ?? 0);
        sliderInitVal = plInitVal >= 128 ? 0        : (LFO_DEST_ID_TO_UI.get(plInitVal) ?? 0);
      }

      if (cfg.isFreqParam) {
        const fineArr = S.pattern.plockFine && S.pattern.plockFine[t].get(pt);
        const fineVal = (fineArr && locked) ? fineArr[s] : PLOCK_NO_VALUE;
        const fine = (fineVal !== PLOCK_NO_VALUE) ? fineVal : 0;
        if (locked) {
          sliderRawVal = plVal * 128 + fine;
        } else {
          sliderRawVal = cfg.pMax;
        }
        const defFine = poolSound && info.sndOff + 1 < poolSound.length
          ? poolSound[info.sndOff + 1]
          : (getKitDefault(t, info.sndOff + 1) ?? 0);
        sliderInitVal = locked ? sliderRawVal : (plInitVal * 128 + (defFine >> 1));
      }

      if (cfg.decimalHR !== null) {
        const hr = cfg.decimalHR;
        const sliderCenter = hr * 2;
        const fineArr = S.pattern.plockFine && S.pattern.plockFine[t].get(pt);
        const fineVal = (fineArr && locked) ? fineArr[s] : PLOCK_NO_VALUE;
        const fine = (fineVal !== PLOCK_NO_VALUE) ? fineVal : 0;
        if (locked) {
          sliderRawVal = Math.round(((plVal - 64) + fine / 128) / 0.50) + sliderCenter;
        } else {
          sliderRawVal = cfg.pMax;
        }
        const coarseMin = 64 - hr;
        const kitCoarse = (plInitVal >= coarseMin && plInitVal <= 64 + hr) ? plInitVal : 64;
        const kitFine = poolSound && info.sndOff + 1 < poolSound.length
          ? poolSound[info.sndOff + 1]
          : (getKitDefault(t, info.sndOff + 1) ?? 0);
        const kitDecimal = (kitCoarse - 64) + kitFine / 256;
        const kitSlider  = Math.round(kitDecimal / 0.50) + hr * 2;
        sliderInitVal = locked ? sliderRawVal : kitSlider;
      }

      return { sliderRawVal, sliderInitVal };
    }

    // Build onChange callback for a track param
    function buildParamOnChange(cfg, info, t, s, pt) {
      const { pMax, isFreqParam, decimalHR } = cfg;

      if (info.lfoDest) {
        return (v) => {
          writePlock(t, pt, s, v >= pMax ? PLOCK_NO_VALUE : LFO_DEST_UI_IDS[v]);
          refreshAfterEdit();
        };
      }
      if (isFreqParam) {
        return (v) => {
          if (v >= 16256) {
            clearPlockFine(t, pt, s);
            writePlock(t, pt, s, PLOCK_NO_VALUE);
          } else {
            const coarse = Math.min(127, Math.floor(v / 128));
            const fine   = Math.min(127, v - coarse * 128);
            writePlock(t, pt, s, coarse);
            if (fine > 0) writePlockFine(t, pt, s, fine);
            else clearPlockFine(t, pt, s);
          }
          refreshAfterEdit();
        };
      }
      if (decimalHR !== null) {
        const hr = decimalHR;
        const sliderCenter = hr * 2;
        const coarseMin = 64 - hr;
        const coarseMax = 64 + hr;
        return (v) => {
          if (v >= sliderCenter * 2) {
            clearPlockFine(t, pt, s);
            writePlock(t, pt, s, PLOCK_NO_VALUE);
          } else {
            const halfV  = v / 2;
            const coarse = Math.min(coarseMax, coarseMin + Math.floor(halfV));
            const fine   = Math.min(127, Math.round((halfV - Math.floor(halfV)) * 128));
            writePlock(t, pt, s, coarse);
            if (fine > 0) writePlockFine(t, pt, s, fine);
            else clearPlockFine(t, pt, s);
          }
          refreshAfterEdit();
        };
      }
      return (v) => {
        writePlock(t, pt, s, v >= pMax ? PLOCK_NO_VALUE : v);
        refreshAfterEdit();
      };
    }

    // Compute display value for a track param (handles freq/decimal coarse+fine)
    function computeParamShowVal(cfg, info, t, s, pt, locked, plVal, kitDef, displayVal, poolSound) {
      const { displayFn, isFreqParam, decimalHR } = cfg;

      if (isFreqParam) {
        if (locked) {
          const fineArr = S.pattern.plockFine && S.pattern.plockFine[t].get(pt);
          const fineVal = fineArr ? fineArr[s] : PLOCK_NO_VALUE;
          const fine = (fineVal !== PLOCK_NO_VALUE) ? fineVal : 0;
          return (plVal * 128 + fine) + 'Hz';
        } else if (kitDef !== null) {
          const defFine = poolSound && info.sndOff + 1 < poolSound.length
            ? poolSound[info.sndOff + 1]
            : (getKitDefault(t, info.sndOff + 1) ?? 0);
          return (kitDef * 128 + (defFine >> 1)) + 'Hz';
        }
        return '?';
      }

      if (decimalHR !== null) {
        if (locked) {
          const fineArr = S.pattern.plockFine && S.pattern.plockFine[t].get(pt);
          const fineVal = fineArr ? fineArr[s] : PLOCK_NO_VALUE;
          const fine = (fineVal !== PLOCK_NO_VALUE) ? fineVal : 0;
          const d = (plVal - 64) + fine / 128;
          return (d >= 0 ? '+' : '') + d.toFixed(2);
        } else if (kitDef !== null) {
          const defFineD = poolSound && info.sndOff + 1 < poolSound.length
            ? poolSound[info.sndOff + 1]
            : (getKitDefault(t, info.sndOff + 1) ?? 0);
          const dKit = (kitDef - 64) + defFineD / 256;
          return (dKit >= 0 ? '+' : '') + dKit.toFixed(2);
        }
        return '?';
      }

      const showInput = typeof displayVal === 'number'
        ? (info.lfoDest ? (LFO_DEST_ID_TO_UI.get(displayVal) ?? 0) : displayVal)
        : displayVal;
      return typeof showInput === 'number' ? displayFn(showInput) : showInput;
    }

    // ─── SRC / SMPL / FLTR / AMP / LFO sections ────────────────────────────────

    function buildParamSection(secKey, t, s, machineType, poolSound) {
      const body = document.createElement('div');
      body.className = 'sp-params';

      const order = SECTION_ORDER[secKey]
        || Object.keys(PLOCK_INFO).map(Number).filter(k => PLOCK_INFO[k].sec === secKey);

      for (const pt of order) {
        const info = PLOCK_INFO[pt];
        if (!info) continue;

        // Override SRC labels with machine-specific names; skip unused params
        let lbl = info.lbl;
        if (secKey === 'SRC' && machineType !== null && machineType !== undefined
            && pt <= PLOCK_SYNTH_PARAM_MAX) {
          const ml = MACHINES[machineType].params[pt];
          if (ml === '-') continue;
          if (ml) lbl = ml;
        }

        // Resolve value state
        const kitDef = poolSound && info.sndOff < poolSound.length
          ? poolSound[info.sndOff] : getKitDefault(t, info.sndOff);
        const plArr  = S.pattern.plocks && S.pattern.plocks[t].get(pt);
        const plVal  = plArr ? plArr[s] : PLOCK_NO_VALUE;
        const locked = plVal !== PLOCK_NO_VALUE;
        const displayVal = locked ? plVal : (kitDef !== null ? kitDef : '?');
        const plRawVal  = locked ? plVal : 128;
        const plInitVal = locked ? plVal : (kitDef !== null ? kitDef : 0);

        // Build display config, slider state, onChange, and show value
        const cfg = buildParamDisplayConfig(info, secKey, pt, machineType, lbl);
        const sl = resolveSliderState(cfg, info, t, s, pt, locked, plVal, plRawVal, plInitVal, poolSound);
        const onChange = buildParamOnChange(cfg, info, t, s, pt);
        const showVal = computeParamShowVal(cfg, info, t, s, pt, locked, plVal, kitDef, displayVal, poolSound);

        const opts = {
          min: cfg.pMin, max: cfg.pMax, rawVal: sl.sliderRawVal, initVal: sl.sliderInitVal,
          displayFn: cfg.displayFn, onChange,
        };
        if (cfg.snap !== undefined) { opts.snap = cfg.snap; opts.snapR = cfg.snapR; }

        // LFO SPD/MUL: live-preview speed label while dragging
        if (secKey === 'LFO' && (pt === 0x21 || pt === 0x22)) {
          const poolSnd = poolSound;
          opts.onPreview = (v) => {
            const sub = body.closest?.('.sp-sec')?.querySelector('.sp-sec-sub');
            if (!sub) return;
            const spdOff = PLOCK_INFO[0x21].sndOff;
            const mulOff = PLOCK_INFO[0x22].sndOff;
            const getSrc = (off) => poolSnd && off < poolSnd.length
              ? poolSnd[off] : getKitDefault(t, off);
            const spdArr = S.pattern.plocks && S.pattern.plocks[t].get(0x21);
            const mulArr = S.pattern.plocks && S.pattern.plocks[t].get(0x22);
            let spdRaw = (spdArr && spdArr[s] !== PLOCK_NO_VALUE) ? spdArr[s] : getSrc(spdOff);
            let mulRaw = (mulArr && mulArr[s] !== PLOCK_NO_VALUE) ? mulArr[s] : getSrc(mulOff);
            if (pt === 0x21) spdRaw = (v >= cfg.pMax) ? getSrc(spdOff) : v;
            if (pt === 0x22) mulRaw = (v >= cfg.pMax) ? getSrc(mulOff) : v;
            if (spdRaw == null || mulRaw == null) return;
            const spd = spdRaw - 64;
            const isDot = mulRaw >= 12;
            const mulIdx = isDot ? mulRaw - 12 : mulRaw;
            const mulFactor = Math.pow(2, mulIdx);
            const rev = spd < 0 ? ' rev' : '';
            let label;
            if (spd === 0) { label = 'stopped'; }
            else if (isDot) {
              const hz = 120 * Math.abs(spd) * mulFactor / (128 * 240);
              label = (hz >= 1 ? hz.toFixed(2) + ' Hz' : (1/hz).toFixed(2) + ' s') + rev;
            } else {
              const spc = 16 * 128 / (Math.abs(spd) * mulFactor);
              label = spc === 1 ? '1/16' : spc === 2 ? '1/8' : spc === 4 ? '1/4'
                : spc === 8 ? '1/2' : spc === 16 ? '1 bar' : spc === 32 ? '2 bars'
                : spc === 64 ? '4 bars' : spc >= 16 ? (spc/16).toFixed(1) + ' bars'
                : spc < 1 ? '1/' + Math.round(4/spc) + ' beat'
                : spc.toFixed(1) + ' steps';
              label += rev;
            }
            sub.textContent = '(' + label + ')';
          };
        }

        // Freq params: number input shows/accepts Hz integers
        if (cfg.isFreqParam) {
          opts.numDisplay = (v) => v >= 16256 ? '' : String(v);
          opts.numParse = (str) => {
            const f = parseInt(str, 10);
            if (isNaN(f)) return null;
            return Math.max(0, Math.min(16256, f));
          };
          opts.numStep = '1';
          opts.numMin = 0;
          opts.numMax = 16256;
        }

        // Decimal params: number input shows/accepts display-unit decimals
        if (cfg.decimalHR !== null) {
          const hr = cfg.decimalHR;
          const sliderCenter = hr * 2;
          opts.numDisplay = (v) => v >= sliderCenter * 2 ? '' : ((v - sliderCenter) * 0.50).toFixed(2);
          opts.numParse = (str) => {
            const f = parseFloat(str);
            if (isNaN(f)) return null;
            return Math.max(-hr, Math.min(hr, f)) / 0.50 + sliderCenter;
          };
          opts.numStep = '0.01';
          opts.numMin = -hr;
          opts.numMax = hr;
        }

        body.appendChild(makeParamRow(lbl, showVal, locked, opts));
      }

      let lfoSpeedStr = null;
      if (secKey === 'LFO') lfoSpeedStr = lfoSpeedLabel(t, s, poolSound);

      return makeSec(secKey, body, lfoSpeedStr);
    }

    // ─── Panel helpers ────────────────────────────────────────────────────────

    function makeSec(title, bodyEl, subtitle) {
      const sec = document.createElement('div');
      sec.className = 'sp-sec';
      const head = document.createElement('div');
      head.className = 'sp-sec-head';
      head.textContent = title;
      if (subtitle !== undefined && subtitle !== null) {
        const sub = document.createElement('span');
        sub.className = 'sp-sec-sub';
        sub.style.cssText = 'margin-left:6px;';
        sub.textContent = '(' + subtitle + ')';
        head.appendChild(sub);
      }
      sec.appendChild(head);
      sec.appendChild(bodyEl);
      return sec;
    }

    function makeParamRow(lbl, val, locked, opts) {
      const row = document.createElement('div');
      row.className = 'sp-param';
      const l = document.createElement('span');
      l.className = 'sp-lbl';
      l.textContent = lbl;
      const v = document.createElement('span');
      v.className = 'sp-val' + (locked ? ' locked' : '')
                  + (opts ? ' editable' : '');
      v.textContent = val;
      row.appendChild(l);
      row.appendChild(v);

      if (opts) {
        const { min, max, rawVal, onChange, displayFn, initVal, snap } = opts;
        const startVal = initVal !== undefined ? initVal : rawVal;
        const hasSnap  = snap !== undefined;
        const snapR    = opts.snapR !== undefined ? opts.snapR : 2;  // snap dead-band radius

        // Snap mapping: slider range is extended by 2×snapR so all values
        // remain reachable. Positions within ±snapR of the snap point map
        // to the snap value; positions outside are shifted to fill the gap.
        const valToSlider = (val) => {
          if (!hasSnap) return val;
          if (val === snap) return snap;
          return val > snap ? val + snapR : val - snapR;
        };
        const sliderToVal = (sv) => {
          if (!hasSnap) return sv;
          if (Math.abs(sv - snap) <= snapR) return snap;
          return sv > snap ? sv - snapR : sv + snapR;
        };

        // ── Click: expand to slider + number input ──
        v.addEventListener('click', (e) => {
          e.stopPropagation();
          if (v.querySelector('.sp-editor')) return;

          const editor = document.createElement('div');
          editor.className = 'sp-editor';

          const sMin = hasSnap ? min - snapR : min;
          const sMax = hasSnap ? max + snapR : max;

          const slider = document.createElement('input');
          slider.type = 'range';
          slider.min  = sMin;
          slider.max  = sMax;
          slider.value = valToSlider(startVal);

          const hasCustomNum = opts.numDisplay && opts.numParse;
          const numInp = document.createElement('input');
          numInp.type  = 'number';
          numInp.min   = hasCustomNum ? (opts.numMin ?? min) : min;
          numInp.max   = hasCustomNum ? (opts.numMax ?? max) : max;
          if (hasCustomNum && opts.numStep) numInp.step = opts.numStep;
          numInp.value = hasCustomNum ? opts.numDisplay(startVal) : startVal;

          const disp = document.createElement('span');
          disp.className = 'sp-disp';
          if (displayFn) disp.textContent = displayFn(startVal);

          editor.appendChild(slider);
          editor.appendChild(numInp);
          if (displayFn) editor.appendChild(disp);

          v.textContent = '';
          v.appendChild(editor);
          numInp.focus();
          numInp.select();

          let curVal = rawVal;
          const updateDisp = (nv) => {
            curVal = nv;
            if (displayFn) disp.textContent = displayFn(nv);
          };

          // Guard: prevent slider→numInp feedback when numInp sets slider.value
          let numDriving = false;

          // Slider drag → update number + display in real-time
          slider.addEventListener('input', () => {
            if (numDriving) return;            // ignore echo from numInp handler
            const val = sliderToVal(parseInt(slider.value, 10));
            numInp.value = hasCustomNum ? opts.numDisplay(val) : val;
            updateDisp(val);
            if (opts.onPreview) opts.onPreview(val);
          });

          // Number input → update slider + display
          numInp.addEventListener('input', () => {
            const nv = hasCustomNum ? opts.numParse(numInp.value) : parseInt(numInp.value, 10);
            if (nv !== null && !isNaN(nv)) {
              const clamped = Math.max(min, Math.min(max, nv));
              numDriving = true;
              slider.value = valToSlider(clamped);
              numDriving = false;
              updateDisp(clamped);
              if (opts.onPreview) opts.onPreview(clamped);
            }
          });

          let done = false;
          const restore = () => { v.textContent = val; };
          const commit = () => {
            if (done) return;
            done = true;
            if (curVal !== rawVal) { onChange(curVal); return; }
            restore();
          };
          const cancel = () => {
            if (done) return;
            done = true;
            restore();
          };

          // Slider release → sync number input display and commit
          slider.addEventListener('pointerup', () => {
            numInp.value = hasCustomNum ? opts.numDisplay(curVal) : curVal;
            commit();
          });

          numInp.addEventListener('keydown', (ke) => {
            if (ke.key === 'Enter')  { ke.preventDefault(); commit(); }
            if (ke.key === 'Escape') { ke.preventDefault(); cancel(); }
            ke.stopPropagation();
          });

          // Focus leaves editor entirely → commit
          editor.addEventListener('focusout', () => {
            setTimeout(() => {
              if (!done && !editor.contains(document.activeElement)) commit();
            }, 0);
          });
        });
      }

      return row;
    }

    // ─── Kit default lookup ───────────────────────────────────────────────────
    // Returns the default value byte for a plock-able parameter from the decoded
    // kit. soundOff is the offset within ar_sound_t; for s_u16_t fields the hi
    // byte (first in memory, lower address) carries the 0-127 value.

    function getKitDefault(trackIdx, soundOff) {
      if (!S.pattern.kit || trackIdx >= 12) return null;  // FX track has no ar_sound_t
      const base = KIT_TRACKS_BASE + trackIdx * AR_SOUND_V5_SZ;
      if (base + soundOff >= S.pattern.kit.length) return null;
      return S.pattern.kit[base + soundOff];
    }

    function getKitFxDefault(kitOff) {
      if (!S.pattern.kit || kitOff >= S.pattern.kit.length) return null;
      return S.pattern.kit[kitOff];
    }

    function getTrackMachineType(trackIdx) {
      if (!S.pattern.kit || trackIdx >= 12) return null;
      const off = KIT_TRACKS_BASE + trackIdx * AR_SOUND_V5_SZ + MACHINE_TYPE_OFFSET;
      if (off >= S.pattern.kit.length) return null;
      const mt = S.pattern.kit[off];
      return (mt < MACHINES.length) ? mt : null;
    }



    // ─── Display helpers ──────────────────────────────────────────────────────

    // MIDI note → name using AR convention: note 60 = C3 (C0 = note 24)
    function midiNoteToName(n) {
      if (n > 127) return '?';
      const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
      return NAMES[n % 12] + (Math.floor(n / 12) - 2);
    }

    // Note/retrig length → display value (in 1/16-note steps)
    // Encoding: 9 ranges, each 16 values (except first = 14), step doubles per range.
    const NOTE_LEN_RANGES = [
      { start:   0, count: 14, base: 0.125,  step: 0.0625 },
      { start:  14, count: 16, base: 1,      step: 0.0625 },
      { start:  30, count: 16, base: 2,      step: 0.125  },
      { start:  46, count: 16, base: 4,      step: 0.25   },
      { start:  62, count: 16, base: 8,      step: 0.5    },
      { start:  78, count: 16, base: 16,     step: 1      },
      { start:  94, count: 16, base: 32,     step: 2      },
      { start: 110, count: 16, base: 64,     step: 4      },
    ];
    // Map of step-count → note label
    const NOTE_LEN_LABELS = {
      0.125: '1/128', 0.25: '1/64', 0.5: '1/32', 1: '1/16', 2: '1/8',
      4: '1/4', 8: '1/2', 16: '1/1', 32: '2/1', 64: '4/1', 128: '8/1',
    };
    function noteLenVal(v) {
      if (v >= 126) return v === 126 ? 128 : Infinity;
      for (let i = NOTE_LEN_RANGES.length - 1; i >= 0; i--) {
        const r = NOTE_LEN_RANGES[i];
        if (v >= r.start) return r.base + (v - r.start) * r.step;
      }
      return 0;
    }
    function noteLenDisplay(steps) {
      if (!isFinite(steps)) return '\u221E';
      const lbl = NOTE_LEN_LABELS[steps];
      if (lbl) return lbl;
      // Show decimal, trim trailing zeros
      const s = steps % 1 === 0 ? String(steps) : steps.toFixed(4).replace(/0+$/, '');
      return s;
    }
    function noteLenStr(v) {
      if (v === PLOCK_NO_VALUE) return 'DEF';
      return noteLenDisplay(noteLenVal(v));
    }

    // Micro-timing → musical fraction string
    // Each step = 1/16 note = 24 micro-timing units → 1 unit = 1/384 whole note
    function utimeFrac(n) {
      if (n === 0) return '0';
      const sign = n > 0 ? '+' : '-';
      const a = Math.abs(n);
      const g = gcd(a, 384);
      return sign + (a / g) + '/' + (384 / g);
    }
    function gcd(a, b) { while (b) { [a, b] = [b, a % b]; } return a; }

