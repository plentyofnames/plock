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

### 8. Fragile machine parameter tables
- `MACHINE_PARAM_NAMES`: 8 rows × 34 columns, extremely long lines
- `MACHINE_BIPOLAR/DECIMAL/ENUMS/FREQ/INF127`: use numeric machine/param IDs
- No validation that all 34 machines are covered
- Consider restructuring as per-machine objects instead of per-parameter arrays

### 9. Plock fine-companion encoding undocumented
- `0x80` type/track magic for fine companion plocks has zero comments
- Implicit "fine always follows coarse" assumption has no guard
- Add JSDoc + defensive error handling

### 10. Full grid re-render on every edit
- `refreshAfterEdit()` re-renders all 832 cells + metadata + panels for any change
- Consider incremental update: only re-render affected step/track/panel

### 11. Duplicate editable-field UI patterns
- `buildTrackSettingsPanel()` and `renderMeta()` both create similar inline-edit fields
- Extract a shared `makeEditableField()` helper

### 12. Inconsistent naming conventions
- `TRACK_V5_SZ` vs `AR_PATTERN_V5_SZ` (version suffix unclear)
- `sndOff` vs `kitOff` (different schemas for same concept in PLOCK_INFO vs FX_PLOCK_INFO)
- Mix of `Raw` suffix with unprefixed names

### 13. Bipolar/decimal/enum conversion scattered
- Conversion between raw bytes and display values is inlined in rendering code
- Extract reusable `bipolarToDisplay()`, `displayToBipolar()`, `decimalToDisplay()`, etc.

### 14. `decodeSysex7to8` / `encodeSysex8to7` share no code
- Inverse operations implemented independently
- Could share bit-manipulation helpers

### 15. No input validation on parameter writes
- Writing plock values or kit params has no bounds checking
- Values should be clamped to valid range for the parameter type

### 16. MIDI as global side effects
- `onstatechange` and `onmidimessage` registered globally
- No way to disconnect/reset without page reload

## Features / Data

### 17. Request global settings for project BPM
- Pattern BPM field (`0x332A`) is only used when AR BPM mode = PTN
- When BPM mode = PRJ, the pattern stores a stale/default 120.0 — not the actual tempo
- Request the global/project settings SysEx to get the real BPM
- If project BPM mode: show project BPM as read-only with "(PRJ)" indicator
- If pattern BPM mode: show pattern BPM as editable (current behaviour)

### 18. Request sound pool for sound lock awareness
- Currently sound locks show the pool slot number but we don't fetch pool sounds
- Without pool data we can't tell if a sound lock's machine is compatible with the track
- Request the full sound pool (128 sounds) so we can:
  - Show the machine name for each sound lock
  - Warn when a sound lock's machine doesn't match the track
  - Use correct pool sound defaults when displaying plock values for locked steps

## Documentation

### JSDoc comments
- Add JSDoc-style comments to major functions
- Document the `s_u16_t` encoding (hi-first, lo byte LSB-shifted)
- Document the plock fine byte system (`0x80+` companion slots)
- Document kit byte encoding vs plock encoding differences for freq params
