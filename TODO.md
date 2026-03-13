# Analog Rytm Pattern Editor — TODO

## Code Quality Cleanup

### 1. ~~Split monolithic pattern_viewer.html into modules~~ ✅
Split into 7 files: `style.css`, `ar-state.js`, `ar-constants.js`,
`ar-sysex.js`, `ar-editor.js`, `ar-midi.js`, `pattern_viewer.html` (shell).
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

### 4. Global mutable state
- 19 global `let` variables are now in `AR.state` but still mutated from everywhere
- Consider grouping related state (e.g., MIDI connection state, pattern data, UI state)
- Make state mutations more explicit / centralized where practical

### 5. Large functions need decomposition
- `renderGrid()` (~350 lines): ruler, track iteration, step rendering, listeners, slide lines
- `buildParamSection()` (~350 lines): parameter display, editing, bipolar/decimal/enum/freq
- `renderMeta()` (~300+ lines): pattern metadata display + inline editing
- Break each into 5-6 focused helper functions

### 6. Struct schema for pattern layout
- Pattern data accessed via `raw[trackBase + SOME_OFFSET]` everywhere
- Create a descriptor/schema system: `{ offset, size, type }` per field
- Would make access self-documenting and enable validation

### 7. Repeated byte-reading boilerplate
- `arr.length > offset ? arr[offset] : 0` pattern appears dozens of times
- Extract `readU8(arr, offset)` and `readU16BE(arr, offset)` helpers

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

## Documentation

### JSDoc comments
- Add JSDoc-style comments to major functions
- Document the `s_u16_t` encoding (hi-first, lo byte LSB-shifted)
- Document the plock fine byte system (`0x80+` companion slots)
- Document kit byte encoding vs plock encoding differences for freq params
