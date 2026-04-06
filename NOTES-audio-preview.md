# Audio Preview Engine — Design Notes

## Goal

Add browser-based audio preview so the user gets immediate rhythmic feedback
while editing patterns. The focus is on **sequencer accuracy**, not sound
fidelity — we synthesize simple generic drum tones, not faithful replicas of
the AR's 34 machine algorithms.

Key benefit: makes it obvious which UI controls (trigs, conditions, micro-timing,
retrig, velocity, swing, accent, mute) have a direct audible effect — important
for usability.

## Timing model

### Hardware test results (2026-04-05)

- **Micro-timing is step-relative.** µT offsets are 1/384ths of 16 steps,
  so they scale with the per-track speed multiplier. Confirmed by comparing
  a 1× track with +4 µT against a 3/4× track with +3 µT — perfectly in sync,
  no flam. This proves the 1/384th grid is exact even at non-power-of-2 speeds.

- **Retrig is absolute.** Retrig rates are fixed beat-relative subdivisions,
  independent of track speed. A 1/16 retrig fires at the same real-time rate
  regardless of the track multiplier.

### Tick grid: 2880 PPQN

The AR's internal clock uses a single high-resolution tick grid.

- **11520 ticks per whole note** (= 2880 PPQN)
- **720 ticks per 1/16 step** at 1× speed
- **Micro-timing**: 24 units per speed-adjusted step. Per-beat µT divisions
  at each track speed:

  | Speed | µT divs/beat | Ticks per µT unit |
  |-------|-------------|-------------------|
  | 1/8×  | 3           | 960               |
  | 1/4×  | 6           | 480               |
  | 1/2×  | 12          | 240               |
  | 3/4×  | 18          | 160               |
  | 1×    | 24          | 120               |
  | 3/2×  | 36          | 80                |
  | 2×    | 48          | 60                |

  All integer. 2880 = 2⁶ × 3² × 5. The factors of 3² cover the 3/4× and
  3/2× speed multipliers (which break power-of-2 PPQNs like 480 or 960).
  The factor of 5 covers retrig rates with a factor of 5 (1/5, 1/10, etc.).

- **Retrig rates** are fractions of a **whole note** (absolute, not speed-scaled):
  `1/1, 1/2, 1/3, 1/4, 1/5, 1/6, 1/8, 1/10, 1/12, 1/16, 1/20, 1/24, 1/32, 1/40, 1/48, 1/64, 1/80`
  — all divide evenly into 11520.

Everything (step timing, swing offsets, micro-timing, retrig sub-hits) lives
on this single grid. No floating-point subdivision needed.

## Sequencer engine

Implementation: Web Audio lookahead scheduler ("tale of two clocks" —
a JS `setTimeout` loop queues events ~100ms ahead using `AudioContext.currentTime`
for sample-accurate scheduling).

### Full feature set to implement

- **BPM** from pattern data
- **Swing** (shift even steps, raw 0–30 → 50–80%)
- **Per-track speed** multipliers (2×, 3/2×, 1×, 3/4×, 1/2×, 1/4×, 1/8×)
- **Trig enable / mute**
- **All 57 trig conditions**: probability (1%–100%), FILL/!FILL, PRE/!PRE,
  NEI/!NEI, 1ST/!1ST, ratio patterns (1:2 through 8:8)
- **FILL mode toggle** — UI button so FILL/!FILL conditions work
- **Micro-timing** — per-step signed offset (−23 to +23 units)
- **Retrig** — rate (fractions of whole note), velocity offset (ramp up/down)
- **Accent** — velocity boost
- **Velocity** — mapped to voice volume
- **Note** — mapped to pitch for tonal voices (BD, toms, CB)
- **Pattern length** — master length, per-track length (advanced scale mode),
  master change length
- **Scale mode** (normal vs advanced) — controls whether tracks share or
  have independent lengths

### Deliberately deferred

- **Note length / sustain** — drum sounds don't need it; decay-only envelopes
- **Slide** — parameter interpolation between steps
- **P-locks on synth/filter/amp/LFO** — would need richer voices to hear
- **Sample playback** — future phase (load user samples, AudioBufferSourceNode)
- **FX** (delay, reverb, distortion, compressor) — future phase
- **Sound locks** — requires sound pool and voice switching
- **LFO modulation** — future phase

## Drum voice synthesis

Minimal Web Audio voices — one per track role. No AudioWorklet needed.

| Track | Synthesis approach | Nodes |
|-------|-------------------|-------|
| **BD** | Sine + pitch envelope (sweep 150→40 Hz) | Osc → Gain (amp env) |
| **SD** | Sine body (~180 Hz) + noise burst (HP filtered) | Osc + Noise→BPF → Gain |
| **RS** | Short filtered click (HP noise, very short decay) | Noise→HPF → Gain |
| **CP** | Noise with double-hit envelope (two fast peaks) | Noise→BPF → Gain |
| **BT** | Sine, low-mid pitch (~100 Hz), short decay | Osc → Gain |
| **LT** | Sine ~80 Hz, medium decay | Osc → Gain |
| **MT** | Sine ~110 Hz, medium decay | Osc → Gain |
| **HT** | Sine ~140 Hz, medium decay | Osc → Gain |
| **CH** | HP-filtered noise, very short decay (~20ms) | Noise→HPF → Gain |
| **OH** | HP-filtered noise, longer decay (~200ms) | Noise→HPF → Gain |
| **CY** | BP-filtered noise + sine harmonic, long decay | Noise→BPF + Osc → Gain |
| **CB** | Two detuned square waves, short decay | 2× Osc → Gain |

### Parameters affecting voice

| Parameter | Voice effect |
|-----------|-------------|
| Velocity | Output gain (linear or dB-scaled) |
| Note | Pitch shift for tonal voices (BD, BT, LT, MT, HT, CB) |
| Accent | Additional gain boost |
| Pan | StereoPannerNode |
| Amp Decay (if exposed) | Envelope decay time |

## UI indicators

Two-pronged approach to show which controls are "live" (affect audio preview):

1. **Subtle indicator on live params** — small colored dot or icon next to
   controls that affect playback
2. **Slightly dim non-live params** — lower opacity on display-only parameters

This makes it instantly scannable. As more parameters gain audio support
(samples, filter, FX), the "live" set grows naturally.

## File structure

Single new file: **`ar-audio.js`**

- Sequencer clock (tick-based, lookahead scheduling)
- Voice pool (13 tracks, each with its drum synth)
- Noise buffer (shared, generated once)
- Public API: `start()`, `stop()`, `setFillMode(bool)`, called from ar-editor.js
- Reads pattern data directly from `AR.state.pattern.raw` — no copying

The editor adds a play/stop button (and FILL toggle) to the UI and calls
into ar-audio.js. Audio concerns stay out of the editor code.

## Implementation order

1. Sequencer clock + play/stop button (silent — just step counter with cursor)
2. Basic drum voices (BD, SD, CH — enough to hear a beat)
3. All 13 voices
4. Trig conditions + FILL toggle
5. Micro-timing + swing
6. Retrig
7. Velocity / accent / note → pitch
8. Per-track speed + scale mode + pattern length
9. UI "live" indicators
