# Analog Rytm Pattern Editor — TODO

## Code Quality Cleanup

### 1. ~~Split monolithic pattern_viewer.html into modules~~ ✅
Split into 7 files: `style.css`, `ar-state.js`, `ar-constants.js`,
`ar-sysex.js`, `ar-editor.js`, `ar-midi.js`, `plock.html` (shell).
Tagged `v1.0` before split.

### 2. ~~Magic hex offsets → named constants~~ ✅
~80 named constants added to `ar-constants.js`: SysEx framing, plock sentinels,
note/micro-timing/speed/retrig bit masks, trig condition encoding helpers,
40 `SND_*` offsets (ar_sound_t), 36 `KIT_FX_*` offsets (ar_kit_t).
~70+ hex literals replaced across `ar-sysex.js`, `ar-midi.js`, `ar-editor.js`.
Python test generator cross-references JS constant names.

### 3. ~~Silent error swallowing~~ ✅
Kit and sound pool decode errors now report via `setStatus`. Added persistent
log panel: `AR.setStatus` accumulates timestamped entries in `AR.log[]`, "Show
Log" button at bottom with error badge, scrollable panel with live updates.

### 4. ~~Global mutable state~~ ✅
`AR.state` grouped into sub-objects: `midi` (5 props), `pattern` (9 props),
`ui` (3 props), `requests` (2 props). Helper functions `AR.loadPattern()`,
`AR.loadKit()`, `AR.loadPlocks()` centralise multi-property mutations.
~130 references updated across `ar-editor.js`, `ar-midi.js`, `ar-sysex.js`.

### 5. ~~Large functions need decomposition~~ ✅
`renderGrid()` → 5 helpers (`buildRuler`, `buildStepCell`, `attachStepListener`,
`drawSlideLines`, `gridStepCenterX`) + grid layout constants; body ~70 lines.
`renderMeta()` → 8 helpers (`metaLabel`, `metaField`, `metaArrowField`, `metaArrowBtn`,
`metaAppendArrows`, `metaStepDenom`, `buildMetaLine1`, `buildMetaLine2`) +
sub-helpers `buildMasterLenField`, `buildMasterChgField`; body ~5 lines.
`buildParamSection()` → 4 helpers (`buildParamDisplayConfig`, `resolveSliderState`,
`buildParamOnChange`, `computeParamShowVal`); loop body ~60 lines.

### 6. ~~Struct schema for pattern layout~~ ✅
`TRACK_FIELDS` and `PATTERN_FIELDS` schema objects in `ar-constants.js`.
Each field: `{ off, sz, type }` where type is `u8`, `u16be`, `u8[]`, or `bitstream`.

### 7. ~~Repeated byte-reading boilerplate~~ ✅
Added `readU8`, `readU16BE`, `writeU8`, `writeU16BE` to `ar-constants.js`.
Migrated 6 safe-read patterns, 11 u16 reads, and 5 u16 writes in `ar-editor.js`.

### 8. ~~Fragile machine parameter tables~~ ✅
Consolidated 7 separate tables (`MACHINE_NAMES`, `MACHINE_PARAM_NAMES`,
`MACHINE_BIPOLAR`, `MACHINE_DECIMAL`, `MACHINE_INF127`, `MACHINE_FREQ`,
`MACHINE_ENUMS`) into one `MACHINES` array of per-machine objects. Each machine's
full config (name, params, bipolar, decimal, inf127, freq, enums) lives in one
place. All 34 machines are explicitly listed with index comments. Consumer lookups
simplified: `MACHINES[machineType].name`, `.params[pt]`, `.bipolar?.has(pt)`, etc.

### 9. ~~Plock fine-companion encoding undocumented~~ ✅
Fine-companion system fully documented in `ar-constants.js` header (slot layout,
combining formulas, adjacency invariant). `writePlock` now defensively deallocates
any fine companion when its coarse slot is freed. `parsePlocks` warns on orphaned
fine slots. All plock read/write functions have explanatory comments.

### 11. ~~Duplicate editable-field UI patterns~~ ✅
Extracted `attachClickToEdit(el, displayText, editVal, opts)` helper shared by
`addVal` (track settings), `metaField` (pattern metadata), `buildMasterLenField`,
`buildMasterChgField`, and the advanced-scale Len field. Removes ~100 lines of
duplicated click→input→commit/cancel/blur boilerplate.

### 12. ~~Inconsistent naming conventions~~ ✅
Renamed `TRACK_V5_SZ` → `AR_TRACK_V5_SZ` to match `AR_SOUND_V5_SZ` prefix
convention. Fixed stale comments referencing `soundOff` to match actual property
names (`sndOff` / `kitOff`). The `sndOff` vs `kitOff` difference is intentional:
they index into different structs (ar_sound_t vs ar_kit_t). The `*Raw` suffix
convention reviewed and found consistent: `*Raw` = raw byte from pattern data,
`*Off` = byte offset, no suffix = computed/display value.

### 13. ~~Bipolar/decimal/enum conversion scattered~~ ✅
Extracted shared display helpers (`displayBipolar`, `displayPan`, `displayInf127`,
`displayLfoPhase`, `displayPct200`, `displayPlain`) at top of `ar-editor.js`.
Both `buildFxParamSection` and `buildParamDisplayConfig` now use these instead of
duplicating inline lambdas. Decimal and freq display remain inline where they need
closure-captured config (slider half-range, etc.).

### 14. ~~`decodeSysex7to8` / `encodeSysex8to7` share no code~~ ✅
Rewrote both as group-based loops (7 data bytes per group) using the same
bit-position expression `1 << (6 - k)` for MSB flag mapping. Both now
clearly show the packet structure and read as true inverses. Header comment
documents the shared encoding scheme.

### 15. ~~No input validation on parameter writes~~ ✅
Added bounds clamping at all write chokepoints: `writePlock` (0–127 or 0xFF
sentinel), `writePlockFine` (0–127), `writeByte` (0–255). Also added explicit
clamping in onChange handlers for micro-timing (±23), retrig rate (0–16),
retrig length (0–127), and retrig velocity (−128–+127).

### 16. ~~MIDI as global side effects~~ ✅
`connectMidi()` was split into `requestAccess` / `connectToNamedDevice` /
`onConnectClick` with a device picker, persistence in `localStorage`, silent
reconnect gated by `navigator.permissions`, and an explicit Disconnect entry
in the picker that nulls input/output, clears the saved device, and resets
the Connect button. `onstatechange` now also drops a vanished device
mid-session. Browser-incompatibility warning shown when `requestMIDIAccess`
is missing.

## Features / Data

### 17. Request global settings for project BPM
- Pattern BPM field (`0x332A`) is only used when AR BPM mode = PTN
- When BPM mode = PRJ, the pattern stores a stale/default 120.0 — not the actual tempo
- Request the global/project settings SysEx to get the real BPM
- If project BPM mode: show project BPM as read-only with "(PRJ)" indicator
- If pattern BPM mode: show pattern BPM as editable (current behaviour)

### 18. ~~Audio preview engine (browser-based playback)~~ ✅
Sequencer + 909-flavour voices shipped: tick-based lookahead scheduler on a
2880 PPQN grid, all 13 tracks, sound-lock aware machine dispatch, AMP
volume/pan, accent, micro-timing, swing, retrig (incl. ∞), all 57 trig
conditions, FILL mode, advanced scale mode (per-track length+speed,
master-length restart), per-track playheads. Coverage panel in the editor
documents what is and isn't audible. See `NOTES-audio-preview.md` for the
full design notes plus the up-to-date Done / Open breakdown.

### 19. Request sound pool for sound lock awareness
- Pool entries are *consumed* when present (machine type, AMP vol/pan, step
  panel display) but we don't actively *request* the pool over SysEx
- Still TODO: send the sound-pool request, then:
  - Show the machine name for each sound lock in the grid
  - Warn when a sound lock's machine doesn't match the track
  - Use correct pool sound defaults when displaying plock values for locked steps

## Bug Fixes / Accuracy

### 20. ~~Fix parameter display order to correspond to hardware~~ ✅
SRC section now uses per-machine `srcOrder` arrays derived from Appendix D of the
Analog Rytm MKII manual. All 34 machines have display-order mappings. SMPL, FLTR,
AMP, LFO already had correct `SECTION_ORDER` overrides. Also fixed three label bugs:
`SWP`→`SWD` (BD CLASSIC), `SYN`→`SYM` (RS HARD), duplicate `LPF`→`HPF` (SD NATURAL).

### 21. Audit all parameters for correct scale and display
- Go through every parameter across all 34 machines and verify:
  - Slider range matches hardware range
  - Display value formatting matches what the AR shows
  - Bipolar/decimal/enum/freq flags are correct
  - Default values read correctly from kit/sound

## Documentation

### JSDoc comments
- Add JSDoc-style comments to major functions
- Document the `s_u16_t` encoding (hi-first, lo byte LSB-shifted)
- Document the plock fine byte system (`0x80+` companion slots)
- Document kit byte encoding vs plock encoding differences for freq params
