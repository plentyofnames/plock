    // ─── Byte read/write helpers ────────────────────────────────────────────
    // Bounds-checked accessors that replace repeated inline boilerplate.

    function readU8(arr, off)         { return off < arr.length ? arr[off] : 0; }
    function readU16BE(arr, off)      { return off + 1 < arr.length ? (arr[off] << 8) | arr[off + 1] : 0; }
    function writeU8(arr, off, val)   { if (off < arr.length) arr[off] = val & 0xFF; }
    function writeU16BE(arr, off, val){
      if (off + 1 < arr.length) { arr[off] = (val >> 8) & 0xFF; arr[off + 1] = val & 0xFF; }
    }

    // ─── Constants from libanalogrytm/sysex.h and pattern.h ──────────────────

    const AR_PRODUCT_ID              = 0x07;
    const AR_ELEKTRON_MFR_1          = 0x20;
    const AR_ELEKTRON_MFR_2          = 0x3C;
    const AR_SYSEX_DUMP_ID_PATTERN   = 0x54;   // saved pattern dump
    const AR_SYSEX_DUMPX_ID_PATTERN  = 0x5A;   // workbuffer pattern dump
    const AR_SYSEX_DUMP_ID_KIT       = 0x52;   // stored kit dump
    const AR_SYSEX_DUMPX_ID_KIT      = 0x58;   // workbuffer kit dump

    // ─── SysEx protocol bytes ────────────────────────────────────────────────
    const SYSEX_START                = 0xF0;
    const SYSEX_END                  = 0xF7;

    // ─── Plock sentinel values ───────────────────────────────────────────────
    //
    // Plock (parameter lock) sequences live in the pattern as a flat array of
    // NUM_PLOCK_SEQS slots.  Each slot is PLOCK_SEQ_SZ bytes:
    //
    //   byte 0:  param type   (0x00–0x7F = coarse param id, 0x80 = fine companion, 0xFF = unused)
    //   byte 1:  track number (0–12, or 0x80 for fine companion, 0xFF = unused)
    //   bytes 2–65:  one value per step (0x00–0x7F = value, 0xFF = no lock on this step)
    //
    // Fine-companion encoding:
    //   Some parameters (frequency, decimal) need more than 7-bit resolution.
    //   The AR stores these as a coarse+fine pair of adjacent slots:
    //     slot N:    type=paramId, track=trackNr  → coarse values (0–127)
    //     slot N+1:  type=0x80,    track=0x80     → fine values   (0–127)
    //   The fine slot has NO independent identity — it inherits its param type
    //   and track from the immediately preceding coarse slot.  This adjacency
    //   invariant must be preserved when reading and writing.
    //
    //   Combined value for freq params:  coarse * 128 + fine  (range 0–16256)
    //   Combined value for decimal params: (coarse - 64) + fine / 128
    //
    const PLOCK_TYPE_UNUSED          = 0xFF;   // empty plock slot (type or track)
    const PLOCK_FINE_FLAG            = 0x80;   // marks fine-companion type/track byte
    const PLOCK_NO_VALUE             = 0xFF;   // step has no plock value
    const SOUND_LOCK_NONE            = 0xFF;   // no sound lock on step

    // ─── Note byte bit fields ────────────────────────────────────────────────
    const NOTE_CONDITION_BIT         = 0x80;   // bit 7: trig condition present
    const NOTE_VALUE_MASK            = 0x7F;   // bits 6..0: MIDI note (0-127)
    const NOTE_UNLOCKED              = 0x7F;   // note byte = 0x7F means "no note lock"

    // ─── Micro-timing byte bit fields ────────────────────────────────────────
    const UTIME_VALUE_MASK           = 0x3F;   // bits 5..0: timing offset magnitude
    const UTIME_SIGN_BIT             = 0x20;   // bit 5: 1 = negative (early)
    const UTIME_UPPER_MASK           = 0xC0;   // bits 7..6: trig condition bits

    // ─── Track speed byte bit fields ─────────────────────────────────────────
    const SPEED_VALUE_MASK           = 0x07;   // bits 2..0: speed index (0-6)
    const SPEED_FLAGS_MASK           = 0xF8;   // bits 7..3: preserved flags

    // ─── Retrig rate/length byte bit fields ──────────────────────────────────
    const RETRIG_RATE_MASK           = 0x1F;   // bits 4..0: rate value
    const RETRIG_RATE_FLAGS          = 0xE0;   // bits 7..5: trig condition bits
    const RETRIG_LEN_VALUE_MASK      = 0x7F;   // bits 6..0: length value
    const RETRIG_LEN_FLAG            = 0x80;   // bit 7: trig condition bit

    // ─── Note length sentinel ────────────────────────────────────────────────
    const NOTE_LEN_INF               = 0x7F;   // display as INF

    // ─── Trig condition encoding (7-bit value spread across 4 bytes) ─────────
    const TRIG_COND_NOTE_SHIFT_BIT   = 0x40;   // bit 6 in cond → bit 7 in note
    const TRIG_COND_MICRO_BITS       = 0x30;   // bits 5..4 in cond → bits 7..6 in micro
    const TRIG_COND_LEN_BIT          = 0x08;   // bit 3 in cond → bit 7 in retrig len
    const TRIG_COND_RATE_BITS        = 0x07;   // bits 2..0 in cond → bits 7..5 in retrig rate

    // ─── Synth param range ───────────────────────────────────────────────────
    const PLOCK_SYNTH_PARAM_MAX      = 0x07;   // plock types 0x00-0x07 are synth params

    // ─── ar_sound_t field offsets (s_u16_t: hi byte = value, lo byte = fine) ─
    // From libanalogrytm/sound.h
    const SND_SYNTH_PARAM_1          = 0x1C;
    const SND_SYNTH_PARAM_2          = 0x1E;
    const SND_SYNTH_PARAM_3          = 0x20;
    const SND_SYNTH_PARAM_4          = 0x22;
    const SND_SYNTH_PARAM_5          = 0x24;
    const SND_SYNTH_PARAM_6          = 0x26;
    const SND_SYNTH_PARAM_7          = 0x28;
    const SND_SYNTH_PARAM_8          = 0x2A;
    const SND_SAMPLE_TUNE            = 0x2C;
    const SND_SAMPLE_FINE_TUNE       = 0x2E;
    const SND_SAMPLE_NR              = 0x30;
    const SND_SAMPLE_BR              = 0x32;
    const SND_SAMPLE_START           = 0x34;
    const SND_SAMPLE_END             = 0x36;
    const SND_SAMPLE_LOOP_FLAG       = 0x38;
    const SND_SAMPLE_VOLUME          = 0x3A;
    const SND_FLT_ATTACK             = 0x3C;
    const SND_FLT_SUSTAIN            = 0x3E;
    const SND_FLT_DECAY              = 0x40;
    const SND_FLT_RELEASE            = 0x42;
    const SND_FLT_CUTOFF             = 0x44;
    const SND_FLT_RES                = 0x46;
    const SND_FLT_TYPE               = 0x48;
    const SND_FLT_ENV                = 0x4A;
    const SND_AMP_ATTACK             = 0x4C;
    const SND_AMP_HOLD               = 0x4E;
    const SND_AMP_DECAY              = 0x50;
    const SND_AMP_OVERDRIVE          = 0x52;
    const SND_AMP_DELAY_SEND         = 0x54;
    const SND_AMP_REVERB_SEND        = 0x56;
    const SND_AMP_PAN                = 0x58;
    const SND_AMP_VOLUME             = 0x5A;
    // 0x5C: unused/padding
    const SND_LFO_SPEED              = 0x5E;
    const SND_LFO_MULTIPLIER         = 0x60;
    const SND_LFO_FADE               = 0x62;
    const SND_LFO_DEST               = 0x64;
    const SND_LFO_WAV                = 0x66;
    const SND_LFO_START_PHASE        = 0x68;
    const SND_LFO_MODE               = 0x6A;
    const SND_LFO_DEPTH              = 0x6C;

    // ─── ar_kit_t FX field offsets ───────────────────────────────────────────
    // From libanalogrytm/kit.h — each is s_u16_t (hi byte = value)
    const KIT_FX_DELAY_TIME          = 0x07CA;
    const KIT_FX_DELAY_PINGPONG      = 0x07CC;
    const KIT_FX_DELAY_WIDTH         = 0x07CE;
    const KIT_FX_DELAY_FEEDBACK      = 0x07D0;
    const KIT_FX_DELAY_HPF           = 0x07D2;
    const KIT_FX_DELAY_LPF           = 0x07D4;
    const KIT_FX_DELAY_REV_SEND      = 0x07D6;
    const KIT_FX_DELAY_VOLUME        = 0x07D8;
    const KIT_FX_DIST_REV_SEND       = 0x07DA;
    const KIT_FX_DIST_DELAY_PP       = 0x07DC;
    const KIT_FX_REVERB_PRE          = 0x07DE;
    const KIT_FX_REVERB_DECAY        = 0x07E0;
    const KIT_FX_REVERB_FREQ         = 0x07E2;
    const KIT_FX_REVERB_GAIN         = 0x07E4;
    const KIT_FX_REVERB_HPF          = 0x07E6;
    const KIT_FX_REVERB_LPF          = 0x07E8;
    const KIT_FX_REVERB_VOLUME       = 0x07EA;
    const KIT_FX_DIST_REV_PP         = 0x07EC;
    const KIT_FX_DIST_AMOUNT         = 0x07EE;
    const KIT_FX_DIST_SYM            = 0x07F0;
    // 0x07F2: unused/padding
    const KIT_FX_COMP_THRESHOLD      = 0x07F4;
    const KIT_FX_COMP_ATTACK         = 0x07F6;
    const KIT_FX_COMP_RELEASE        = 0x07F8;
    const KIT_FX_COMP_RATIO          = 0x07FA;
    const KIT_FX_COMP_SEQ            = 0x07FC;
    const KIT_FX_COMP_GAIN           = 0x07FE;
    const KIT_FX_COMP_MIX            = 0x0800;
    const KIT_FX_COMP_VOLUME         = 0x0802;
    const KIT_FX_LFO_SPEED           = 0x0804;
    const KIT_FX_LFO_MULTIPLIER      = 0x0806;
    const KIT_FX_LFO_FADE            = 0x0808;
    const KIT_FX_LFO_DEST            = 0x080A;
    const KIT_FX_LFO_WAV             = 0x080C;
    const KIT_FX_LFO_START_PHASE     = 0x080E;
    const KIT_FX_LFO_MODE            = 0x0810;
    const KIT_FX_LFO_DEPTH           = 0x0812;

    // ─── Trig flags ──────────────────────────────────────────────────────────
    const AR_TRIG_ENABLE             = 0x0001;  // bit 0
    const AR_TRIG_RETRIG             = 0x0002;  // bit 1
    const AR_TRIG_MUTE               = 0x0004;  // bit 2
    const AR_TRIG_ACCENT             = 0x0008;  // bit 3
    const AR_TRIG_SWING              = 0x0010;  // bit 4
    const AR_TRIG_SLIDE              = 0x0020;  // bit 5: slide
    const AR_TRIG_LFO_PL_EN          = 0x0040;  // bit  6: enable LFO p-lock
    const AR_TRIG_SYN_PL_SW          = 0x0080;  // bit  7: SYN voices retrigger
    const AR_TRIG_SMP_PL_SW          = 0x0100;  // bit  8: SMP voice retrigger
    const AR_TRIG_ENV_PL_SW          = 0x0200;  // bit  9: ENV retrigger
    const AR_TRIG_LFO_PL_SW          = 0x0400;  // bit 10: LFO retrigger
    const AR_TRIG_SYN_PL_EN          = 0x0800;  // bit 11: enable SYN p-lock
    const AR_TRIG_SMP_PL_EN          = 0x1000;  // bit 12: enable SMP p-lock
    const AR_TRIG_ENV_PL_EN          = 0x2000;  // bit 13: enable ENV p-lock

    const AR_NUM_TRACKS              = 13;
    const AR_NUM_STEPS               = 64;
    const AR_TRACK_V5_SZ                = 0x0281;  // 641 bytes / track (FW1.70)
    const TRIG_BITS_OFFSET           = 0;       // trig_bits[112] at track offset 0

    // Track field offsets from track start in raw decoded pattern.
    // Formula: @comment_in_pattern_h - 4 (the 4 magic bytes at pattern start).
    const SOUND_LOCK_OFFSET          = 0x0237;  // sound_locks[64] @0x023B  0xFF=no lock, 0x00-0x7F=pool slot 1-128 (0-indexed)
    const NOTE_OFFSET                = 0x0070;  // notes[64]       @0x0074
    const VELOCITY_OFFSET            = 0x00B0;  // velocities[64]  @0x00B4
    const NOTE_LEN_OFFSET            = 0x00F0;  // note_lengths[64]@0x00F4
    const MICRO_TIMING_OFFSET        = 0x0130;  // micro_timings[64]  @0x0134
    const RETRIG_LENGTH_OFFSET       = 0x0170;  // retrig_lengths[64] @0x0174
    const RETRIG_RATE_OFFSET         = 0x01B0;  // retrig_rates[64]   @0x01B4
    const RETRIG_VELO_OFFSET         = 0x01F0;  // retrig_velocity_offsets[64] @0x01F4
    const DEFAULT_NOTE_OFFSET        = 0x0230;  // default_note    @0x0234
    const DEFAULT_VELOCITY_OFFSET    = 0x0231;  // default_velocity@0x0235
    const DEFAULT_NOTE_LEN_OFFSET    = 0x0232;  // default_note_len@0x0236
    const DEFAULT_TRIG_FLAGS_OFFSET  = 0x0233;  // default_trig_flags (s_u16_t, hi byte first) @0x0237
    const NUM_STEPS_OFFSET           = 0x0235;  // num_steps       @0x0239
    const TRACK_SPEED_OFFSET         = 0x0277;  // flags_and_speed @0x027B
    const TRIG_PROBABILITY_OFFSET    = 0x0278;  // trig_probability@0x027C

    // P-Lock sequences
    const PLOCK_SEQS_BASE            = 0x2091;
    const PLOCK_SEQ_SZ               = 0x42;    // 66 bytes
    const NUM_PLOCK_SEQS             = 72;

    // Pattern-level metadata
    const MASTER_LENGTH_OFFSET       = 0x3321;  // u16 LE, master length (0=INF, 1-128)
    const MASTER_CHG_OFFSET          = 0x3323;  // u16 LE, master change length (1-128)
    const KIT_NUMBER_OFFSET          = 0x3325;
    const SWING_AMOUNT_OFFSET        = 0x3326;
    const SCALE_MODE_OFFSET          = 0x3327;  // 0=normal, 1=advanced
    const MASTER_SPEED_OFFSET        = 0x3328;  // 0=2x,1=3/2x,2=1x,3=3/4x,4=1/2x,5=1/4x,6=1/8x
    const BPM_MSB_OFFSET             = 0x332A;
    const BPM_LSB_OFFSET             = 0x332B;

    // ─── Struct schemas ────────────────────────────────────────────────────
    // Declarative layout descriptors for self-documenting access and validation.
    // type: 'u8' = single byte, 'u16be' = big-endian 16-bit,
    //       'u8[]' = byte array (sz = element count), 'bitstream' = packed bits

    const TRACK_FIELDS = {
      trigBits:        { off: TRIG_BITS_OFFSET,         sz: 112, type: 'bitstream' },
      notes:           { off: NOTE_OFFSET,              sz: 64,  type: 'u8[]' },
      velocities:      { off: VELOCITY_OFFSET,          sz: 64,  type: 'u8[]' },
      noteLengths:     { off: NOTE_LEN_OFFSET,          sz: 64,  type: 'u8[]' },
      microTimings:    { off: MICRO_TIMING_OFFSET,      sz: 64,  type: 'u8[]' },
      retrigLengths:   { off: RETRIG_LENGTH_OFFSET,     sz: 64,  type: 'u8[]' },
      retrigRates:     { off: RETRIG_RATE_OFFSET,       sz: 64,  type: 'u8[]' },
      retrigVelo:      { off: RETRIG_VELO_OFFSET,       sz: 64,  type: 'u8[]' },
      soundLocks:      { off: SOUND_LOCK_OFFSET,        sz: 64,  type: 'u8[]' },
      defaultNote:     { off: DEFAULT_NOTE_OFFSET,      sz: 1,   type: 'u8' },
      defaultVelocity: { off: DEFAULT_VELOCITY_OFFSET,  sz: 1,   type: 'u8' },
      defaultNoteLen:  { off: DEFAULT_NOTE_LEN_OFFSET,  sz: 1,   type: 'u8' },
      defaultTrigFlags:{ off: DEFAULT_TRIG_FLAGS_OFFSET,sz: 2,   type: 'u16be' },
      numSteps:        { off: NUM_STEPS_OFFSET,         sz: 1,   type: 'u8' },
      speed:           { off: TRACK_SPEED_OFFSET,       sz: 1,   type: 'u8' },
      trigProbability: { off: TRIG_PROBABILITY_OFFSET,  sz: 1,   type: 'u8' },
    };

    const PATTERN_FIELDS = {
      masterLength:  { off: MASTER_LENGTH_OFFSET,  sz: 2, type: 'u16be' },
      masterChg:     { off: MASTER_CHG_OFFSET,     sz: 2, type: 'u16be' },
      kitNumber:     { off: KIT_NUMBER_OFFSET,     sz: 1, type: 'u8' },
      swingAmount:   { off: SWING_AMOUNT_OFFSET,   sz: 1, type: 'u8' },
      scaleMode:     { off: SCALE_MODE_OFFSET,     sz: 1, type: 'u8' },
      masterSpeed:   { off: MASTER_SPEED_OFFSET,   sz: 1, type: 'u8' },
      bpm:           { off: BPM_MSB_OFFSET,        sz: 2, type: 'u16be' },
    };

    // Kit raw layout
    const KIT_TRACKS_BASE            = 0x002E;  // ar_sound_t tracks[12] @kit+0x002E
    const AR_SOUND_V5_SZ             = 162;     // sizeof(ar_sound_t)

    // Track speed labels
    const TRACK_SPEED_LABELS = ['2x', '3/2x', '1x', '3/4x', '1/2x', '1/4x', '1/8x'];

    // Machine type offset within ar_sound_t
    const MACHINE_TYPE_OFFSET = 0x7C;

    // Machine names (indexed by machine_type 0-33, from libanalogrytm/sound.c)
    // ─── Per-machine configuration ──────────────────────────────────────────
    // Each entry: { name, params[0-7], bipolar?, decimal?, inf127?, freq?, enums? }
    // params:  synth param short names (P1-P8); '-' = unused
    // bipolar: Set of param indices where 64 = center/zero
    // decimal: { paramIdx: halfRange } for coarse+fine display (±halfRange.00)
    // inf127:  Set of param indices where value 127 = ∞
    // freq:    Set of param indices using frequency encoding (coarse*128 + fine Hz)
    // enums:   { paramIdx: string[] } for enum-valued params
    //
    // Ported from libanalogrytm/sound.c (ar_sound_machine_param_short_names et al.)

    // srcOrder: display order of SRC params on AR screen (indices into params[])
    // Derived from Appendix D of the Analog Rytm MKII manual.
    const MACHINES = [
      // 0  — manual: TUN, SWT, SNP, DEC, WAV, HLD, TIC, LEV
      { name: 'BD HARD', params: ['LEV','TUN','DEC','HLD','SWT','SNP','WAV','TIC'],
        srcOrder: [1,4,5,2,6,3,7,0],
        decimal: { 1: 32 }, enums: { 6: ['sin','asin','tri'] } },
      // 1  — manual: TUN, SWT, SWD, DEC, WAV, HLD, TRA, LEV
      { name: 'BD CLASSIC', params: ['LEV','TUN','DEC','HLD','SWT','SWD','WAV','TRA'],
        srcOrder: [1,4,5,2,6,3,7,0],
        decimal: { 1: 32 },
        enums: { 6: ['sin','asin','tri'],
          7: ['OFF','Tic',
              'A1','B1','C1','D1','E1', 'A2','B2','C2','D2','E2',
              'A3','B3','C3','D3','E3', 'A4','B4','C4','D4','E4',
              'A5','B5','C5','D5','E5'] } },
      // 2  — manual: TUN, SWT, SWD, DEC, TIC, NOD, NOL, LEV
      { name: 'SD HARD', params: ['LEV','TUN','DEC','SWD','TIC','NOD','NOL','SWT'],
        srcOrder: [1,7,3,2,4,5,6,0],
        decimal: { 1: 32 } },
      // 3  — manual: TUN, DET, BAL, DEC, SNP, NOD, NOL, LEV
      { name: 'SD CLASSIC', params: ['LEV','TUN','DEC','DET','SNP','NOD','NOL','BAL'],
        srcOrder: [1,3,7,2,4,5,6,0],
        decimal: { 1: 32 }, bipolar: new Set([7]) },
      // 4  — manual: TUN, SWT, SWD, DEC, SYM, TIC, NOL, LEV
      { name: 'RS HARD', params: ['LEV','TUN','DEC','SWD','TIC','NOL','SYM','SWT'],
        srcOrder: [1,7,3,2,6,4,5,0],
        decimal: { 1: 32 } },
      // 5  — manual: T1, T2, BAL, DEC, SYM, TIC, NOL, LEV
      { name: 'RS CLASSIC', params: ['LEV','T1','DEC','BAL','T2','SYM','NOL','TIC'],
        srcOrder: [1,4,3,2,5,7,6,0],
        bipolar: new Set([3,4,5]), decimal: { 1: 32, 4: 32 } },
      // 6  — manual: RAT, NUM, RND, CPD, TON, NOD, NOL, LEV
      { name: 'CP CLASSIC', params: ['LEV','TON','NOD','NUM','RAT','NOL','RND','CPD'],
        srcOrder: [4,3,6,7,1,2,5,0] },
      // 7  — manual: TUN, SWD, DEC, SNP, NOL, LEV
      { name: 'BT CLASSIC', params: ['LEV','TUN','DEC','-','NOL','SNP','SWD','-'],
        srcOrder: [1,6,2,5,4,0],
        enums: { 5: ['1','2','3'] } },
      // 8  — manual: TUN, SWT, SWD, DEC, TON, NOD, NOL, LEV
      { name: 'XT CLASSIC', params: ['LEV','TUN','DEC','SWD','SWT','NOD','NOL','TON'],
        srcOrder: [1,4,3,2,7,5,6,0],
        bipolar: new Set([7]) },
      // 9  — manual: TUN, DEC, COL, LEV
      { name: 'CH CLASSIC', params: ['LEV','TUN','DEC','COL','-','-','-','-'],
        srcOrder: [1,2,3,0],
        bipolar: new Set([3]) },
      // 10 — manual: TUN, DEC, COL, LEV
      { name: 'OH CLASSIC', params: ['LEV','TUN','DEC','COL','-','-','-','-'],
        srcOrder: [1,2,3,0],
        bipolar: new Set([3]) },
      // 11 — manual: TUN, TON, DEC, COL, LEV
      { name: 'CY CLASSIC', params: ['LEV','TUN','DEC','COL','TON','-','-','-'],
        srcOrder: [1,4,2,3,0],
        bipolar: new Set([3,4]) },
      // 12 — manual: TUN, DEC, DET, PW1, PW2, LEV
      { name: 'CB CLASSIC', params: ['LEV','TUN','DEC','DET','PW1','PW2','-','-'],
        srcOrder: [1,2,3,4,5,0],
        bipolar: new Set([4,5]) },
      // 13 — manual: TUN, SWT, FMD, DEC, FMT, FMS, FMA, LEV
      { name: 'BD FM', params: ['LEV','TUN','DEC','FMA','SWT','FMS','FMD','FMT'],
        srcOrder: [1,4,6,2,7,5,3,0],
        bipolar: new Set([7]), decimal: { 1: 32, 7: 32 } },
      // 14 — manual: TUN, FMT, FMD, DEC, FMA, NOD, NOL, LEV
      { name: 'SD FM', params: ['LEV','TUN','DEC','FMT','FMD','NOD','NOL','FMA'],
        srcOrder: [1,3,4,2,7,5,6,0],
        bipolar: new Set([3,7]), decimal: { 1: 32, 3: 32 } },
      // 15 — manual: LPF, LPQ, ATK, DEC, HPF, SWD, SWT, LEV
      { name: 'UT NOISE', params: ['LEV','LPF','DEC','HPF','LPQ','ATK','SWT','SWD'],
        srcOrder: [1,4,5,2,3,7,6,0],
        bipolar: new Set([7]) },
      // 16 — manual: ATK, DEC, POL, LEV
      { name: 'UT IMPULSE', params: ['LEV','ATK','DEC','-','-','-','-','POL'],
        srcOrder: [1,2,7,0],
        enums: { 7: ['POS','NEG'] } },
      // 17 — manual: TUN, DEC, LEV
      { name: 'CH METALLIC', params: ['LEV','TUN','DEC','-','-','-','-','-'],
        srcOrder: [1,2,0] },
      // 18 — manual: TUN, DEC, LEV
      { name: 'OH METALLIC', params: ['LEV','TUN','DEC','-','-','-','-','-'],
        srcOrder: [1,2,0] },
      // 19 — manual: TUN, TON, TRD, DEC, LEV
      { name: 'CY METALLIC', params: ['LEV','TUN','DEC','TON','TRD','-','-','-'],
        srcOrder: [1,3,4,2,0],
        bipolar: new Set([3]) },
      // 20 — manual: TUN, DEC, DET, PW1, PW2, LEV
      { name: 'CB METALLIC', params: ['LEV','TUN','DEC','DET','PW1','PW2','-','-'],
        srcOrder: [1,2,3,4,5,0],
        bipolar: new Set([4,5]) },
      // 21 — manual: TUN, SWT, SWD, DEC, TYP, MOD, TIC, LEV
      { name: 'BD PLASTIC', params: ['LEV','TUN','DEC','TYP','MOD','SWT','SWD','TIC'],
        srcOrder: [1,5,6,2,3,4,7,0],
        decimal: { 1: 32 }, enums: { 3: ['A','B'] } },
      // 22 — manual: TUN, SWT, SWD, DEC, HLD, DUS, CLK, LEV
      { name: 'BD SILKY', params: ['LEV','TUN','DEC','HLD','SWT','SWD','DUS','CLK'],
        srcOrder: [1,4,5,2,3,6,7,0],
        decimal: { 1: 32 } },
      // 23 — manual: TUN, DEC, BAL, BDY, HPF, LPF, RES, LEV
      { name: 'SD NATURAL', params: ['LEV','TUN','BDY','DEC','BAL','HPF','LPF','RES'],
        srcOrder: [1,3,4,2,5,6,7,0],
        decimal: { 1: 32 } },
      // 24 — manual: TUN, TON, TRD, DEC, RST, LEV
      { name: 'HH BASIC', params: ['LEV','TUN','DEC','TON','TRD','RST','-','-'],
        srcOrder: [1,3,4,2,5,0],
        bipolar: new Set([3]), enums: { 5: ['OFF','ON'] } },
      // 25 — manual: TUN, TYP, HIT, DEC, C1, C2, C3, LEV
      { name: 'CY RIDE', params: ['LEV','TUN','DEC','TYP','HIT','C1','C2','C3'],
        srcOrder: [1,3,4,2,5,6,7,0],
        enums: { 3: ['A','B','C','D'] } },
      // 26 — manual: TUN, SWT, SWD, DEC, HLD, TIC, WAV, LEV
      { name: 'BD SHARP', params: ['LEV','TUN','DEC','HLD','SWT','SWD','WAV','TIC'],
        srcOrder: [1,4,5,2,3,7,6,0],
        decimal: { 1: 32 },
        enums: { 6: ['sinA','sinB','asinA','asinB','triA','triB',
                     'ssawA','ssawB','sawA','sawB','sqrA','sqrB'] } },
      // 27
      { name: 'DISABLE', params: ['-','-','-','-','-','-','-','-'],
        srcOrder: [] },
      // 28 — manual: TUN, DET, DEC1, DEC2, CFG, BND, BAL, LEV
      { name: 'SY DUAL VCO', params: ['LEV','TUN','DEC1','DET','DEC2','BAL','BND','CFG'],
        srcOrder: [1,3,2,4,7,6,5,0],
        bipolar: new Set([5,6]), decimal: { 1: 32, 3: 16 }, inf127: new Set([2,4]),
        enums: { 7: (() => {
              // 4 modes × 2 osc1 × 5 osc2 × 2 reset = 80
              const modes = ['+','R','F','RF'];
              const osc1  = ['sin','ssaw'];
              const osc2  = ['sin','sksin','tri','ssaw','saw'];
              const arr = [];
              for (const m of modes)
                for (const o1 of osc1)
                  for (const o2 of osc2)
                    for (const r of ['','R'])
                      arr.push(m + ' ' + o1 + '.' + o2 + (r ? '\u0332' : ''));
              return arr;
            })() } },
      // 29 — hardware: TUN, WAV, SPD, DEC, OF2, OF3, OF4, LEV
      { name: 'SY CHIP', params: ['LEV','TUN','DEC','OF2','OF3','OF4','WAV','SPD'],
        srcOrder: [1,6,7,2,3,4,5,0],
        bipolar: new Set([3,4,5]), decimal: { 1: 24 }, inf127: new Set([2]),
        enums: {
          6: ['sin','asin','tri','ssaw','saw','sqr','noise',
              'anm1','anm2','anm3','anm4','anm5','pwm+','pwm-',
              'triB','+tri','tri+','triX','sawB','+saw','saw+','sawX',
              'sqrB','+sqr','sqr+','sqrX','tbl1','tbl2','tbl3',
              ...Array.from({length: 99}, (_, i) => 'p' + (i + 1) + '%')],
          7: ['128T','128','64T','128d','64','32T','64d','32','16T','32d','16','8T',
              '16d','8','4T','8d','4','2T','4d','2','1T','2d','1','1d',
              '1.0Hz','1.56Hz','1.88Hz','2Hz','3.13Hz','3.75Hz','4Hz','5Hz',
              '6.25Hz','7.5Hz','10Hz','12.5Hz','15Hz','20Hz','25Hz','30Hz',
              '40Hz','50Hz','60Hz','75Hz','100Hz','120Hz','150Hz','180Hz',
              '200Hz','240Hz','250Hz','300Hz','350Hz','360Hz','400Hz','420Hz',
              '480Hz','240S','200S','150S','120S','100S',
              '60S','50S','30S','25S'] } },
      // 30 — manual: TUN, SWT, SWD, DEC, HLD, IMP, WAV, LEV
      { name: 'BD ACOUSTIC', params: ['LEV','TUN','DEC','HLD','SWT','SWD','WAV','IMP'],
        srcOrder: [1,4,5,2,3,7,6,0],
        decimal: { 1: 24 },
        enums: { 6: ['sinA','sinB','asinA','asinB','triA','triB',
                     'ssawA','ssawB','sawA','sawB','sqrA','sqrB'] } },
      // 31 — manual: TUN, NOD, NOL, BDY, HLD, IMP, SWD, LEV
      { name: 'SD ACOUSTIC', params: ['LEV','TUN','BDY','NOD','NOL','HLD','SWD','IMP'],
        srcOrder: [1,3,4,2,5,7,6,0],
        decimal: { 1: 24 } },
      // 32 — manual: TUN, DET, BAL, DCY, WAV1, WAV2, NOL, LEV
      { name: 'SY RAW', params: ['LEV','TUN','DCY','DET','NOL','WAV1','WAV2','BAL'],
        srcOrder: [1,3,7,2,5,6,4,0],
        bipolar: new Set([3,7]), decimal: { 1: 24, 3: 24 }, inf127: new Set([2]),
        enums: { 5: ['sin','asin','tri','ssaw','asaw','saw','ring'],
                 6: ['sineA','ssawA','sineB','ssawB'] } },
      // 33 — manual: OSC1–6, DEC, LEV
      { name: 'HH LAB', params: ['LEV','OSC1','DEC','OSC2','OSC3','OSC4','OSC5','OSC6'],
        srcOrder: [1,3,4,5,6,7,2,0],
        freq: new Set([1,3,4,5,6,7]) },
    ];

    // Sysex IDs for stored sound pool
    const AR_SYSEX_DUMP_ID_SOUND    = 0x53;
    const AR_SYSEX_REQUEST_ID_SOUND = 0x63;

    // Sysex IDs for settings (contains project BPM at 0x04-0x05)
    const AR_SYSEX_DUMP_ID_SETTINGS  = 0x56;
    const AR_SYSEX_DUMPX_ID_SETTINGS = 0x5C;
    const SETTINGS_BPM_MSB_OFFSET    = 0x04;   // project BPM, same encoding as pattern (×120)
    const SETTINGS_BPM_LSB_OFFSET    = 0x05;
    const SETTINGS_BPM_MODE_OFFSET   = 0x081F; // 0x01 = PTN (per-pattern), 0x00 = PRJ (project)

    // Sysex IDs for global (MIDI config, routing, metronome, etc.)
    const AR_SYSEX_DUMP_ID_GLOBAL    = 0x57;
    const AR_SYSEX_DUMPX_ID_GLOBAL   = 0x5D;

    // Workbuffer pattern request (0x6A)
    const PATTERN_REQUEST_X = new Uint8Array([
      SYSEX_START, 0x00, AR_ELEKTRON_MFR_1, AR_ELEKTRON_MFR_2, AR_PRODUCT_ID,
      0x00, 0x6A, 0x01, 0x01, 0x00,
      0x00, 0x00, 0x00, 0x05, SYSEX_END
    ]);

    // Workbuffer kit request (0x68)
    const KIT_REQUEST_X = new Uint8Array([
      SYSEX_START, 0x00, AR_ELEKTRON_MFR_1, AR_ELEKTRON_MFR_2, AR_PRODUCT_ID,
      0x00, 0x68, 0x01, 0x01, 0x00,
      0x00, 0x00, 0x00, 0x05, SYSEX_END
    ]);

    // Workbuffer settings request (0x6C)
    const SETTINGS_REQUEST_X = new Uint8Array([
      SYSEX_START, 0x00, AR_ELEKTRON_MFR_1, AR_ELEKTRON_MFR_2, AR_PRODUCT_ID,
      0x00, 0x6C, 0x01, 0x01, 0x00,
      0x00, 0x00, 0x00, 0x05, SYSEX_END
    ]);

    // Workbuffer global request (0x6D)
    const GLOBAL_REQUEST_X = new Uint8Array([
      SYSEX_START, 0x00, AR_ELEKTRON_MFR_1, AR_ELEKTRON_MFR_2, AR_PRODUCT_ID,
      0x00, 0x6D, 0x01, 0x01, 0x00,
      0x00, 0x00, 0x00, 0x05, SYSEX_END
    ]);

    const TRACK_NAMES = ['BD','SD','RS','CP','BT','LT','MT','HT','CH','OH','CY','CB','FX'];

    // ─── Enum / display lookup tables ──────────────────────────────────────

    const FLT_TYPE_NAMES  = ['LP2','LP1','BP','HP1','HP2','BS','PK'];
    const LFO_WAV_NAMES   = ['TRI','SIN','SQR','SAW','EXP','RMP','RND'];
    const LFO_TRIG_NAMES  = ['FRE','TRG','HLD','ONE','HLF'];
    const LFO_MUL_NAMES   = [
      '\u00D71','\u00D72','\u00D74','\u00D78','\u00D716','\u00D732',
      '\u00D764','\u00D7128','\u00D7256','\u00D7512','\u00D71k','\u00D72k',
      '\u00B71','\u00B72','\u00B74','\u00B78','\u00B716','\u00B732',
      '\u00B764','\u00B7128','\u00B7256','\u00B7512','\u00B71k','\u00B72k',
    ];

    // LFO destination names indexed by internal dest ID (0-41)
    const LFO_DEST_NAMES = [];
    LFO_DEST_NAMES[0]  = 'P1'; LFO_DEST_NAMES[1]  = 'P2'; LFO_DEST_NAMES[2]  = 'P3';
    LFO_DEST_NAMES[3]  = 'P4'; LFO_DEST_NAMES[4]  = 'P5'; LFO_DEST_NAMES[5]  = 'P6';
    LFO_DEST_NAMES[6]  = 'P7'; LFO_DEST_NAMES[7]  = 'P8';
    LFO_DEST_NAMES[8]  = 'S:TUN'; LFO_DEST_NAMES[9]  = 'S:FIN';
    LFO_DEST_NAMES[10] = 'S:SMP'; LFO_DEST_NAMES[11] = 'S:BR';
    LFO_DEST_NAMES[12] = 'S:STA'; LFO_DEST_NAMES[13] = 'S:END';
    LFO_DEST_NAMES[14] = 'S:LOP'; LFO_DEST_NAMES[15] = 'S:LEV';
    LFO_DEST_NAMES[16] = 'F:ATK'; LFO_DEST_NAMES[17] = 'F:SUS';
    LFO_DEST_NAMES[18] = 'F:DEC'; LFO_DEST_NAMES[19] = 'F:REL';
    LFO_DEST_NAMES[20] = 'F:FRQ'; LFO_DEST_NAMES[21] = 'F:RES';
    LFO_DEST_NAMES[23] = 'F:ENV';
    LFO_DEST_NAMES[24] = 'A:ATK'; LFO_DEST_NAMES[25] = 'A:HLD';
    LFO_DEST_NAMES[26] = 'A:DEC'; LFO_DEST_NAMES[27] = 'A:OVR';
    LFO_DEST_NAMES[28] = 'A:DLY'; LFO_DEST_NAMES[29] = 'A:REV';
    LFO_DEST_NAMES[30] = 'A:PAN'; LFO_DEST_NAMES[31] = 'A:VOL';
    LFO_DEST_NAMES[32] = 'A:ACC';
    LFO_DEST_NAMES[41] = 'OFF';

    // FX LFO destination names (indexed by FX-specific dest ID, 0-28 + 37=NONE)
    const FX_LFO_DEST_NAMES = [];
    FX_LFO_DEST_NAMES[0]  = 'DEL:TIM'; FX_LFO_DEST_NAMES[1]  = 'DEL:X';
    FX_LFO_DEST_NAMES[2]  = 'DEL:WID'; FX_LFO_DEST_NAMES[3]  = 'DEL:FDB';
    FX_LFO_DEST_NAMES[4]  = 'DEL:HPF'; FX_LFO_DEST_NAMES[5]  = 'DEL:LPF';
    FX_LFO_DEST_NAMES[6]  = 'DEL:REV'; FX_LFO_DEST_NAMES[7]  = 'DEL:VOL';
    FX_LFO_DEST_NAMES[8]  = 'DEL:DOV';
    FX_LFO_DEST_NAMES[10] = 'REV:PRE'; FX_LFO_DEST_NAMES[11] = 'REV:DEC';
    FX_LFO_DEST_NAMES[12] = 'REV:FRQ'; FX_LFO_DEST_NAMES[13] = 'REV:GAI';
    FX_LFO_DEST_NAMES[14] = 'REV:HPF'; FX_LFO_DEST_NAMES[15] = 'REV:LPF';
    FX_LFO_DEST_NAMES[16] = 'REV:VOL';
    FX_LFO_DEST_NAMES[18] = 'DST:AMT'; FX_LFO_DEST_NAMES[19] = 'DST:SYM';
    FX_LFO_DEST_NAMES[21] = 'CMP:THR'; FX_LFO_DEST_NAMES[22] = 'CMP:ATK';
    FX_LFO_DEST_NAMES[23] = 'CMP:REL'; FX_LFO_DEST_NAMES[24] = 'CMP:RAT';
    FX_LFO_DEST_NAMES[25] = 'CMP:SEQ'; FX_LFO_DEST_NAMES[26] = 'CMP:GAI';
    FX_LFO_DEST_NAMES[27] = 'CMP:MIX'; FX_LFO_DEST_NAMES[28] = 'CMP:VOL';
    FX_LFO_DEST_NAMES[37] = 'NONE';

    // FX LFO destinations in hardware UI order
    const FX_LFO_DEST_UI_IDS = [
      37,                              // NONE
      0, 1, 2, 3, 4, 5, 6, 7, 8,      // DEL params
      10, 11, 12, 13, 14, 15, 16,      // REV params
      18, 19,                           // DST params
      21, 22, 23, 24, 25, 26, 27, 28   // CMP params
    ];
    const FX_LFO_DEST_ID_TO_UI = new Map();
    FX_LFO_DEST_UI_IDS.forEach((id, idx) => FX_LFO_DEST_ID_TO_UI.set(id, idx));

    function fxLfoDestName(v) {
      return FX_LFO_DEST_NAMES[v] ?? String(v);
    }

    // Valid LFO destinations in hardware UI order (from ar_sound_lfo_dest_ids_ui)
    const LFO_DEST_UI_IDS = [
      41, 0, 1, 2, 3, 4, 5, 6, 7,        // OFF, P1-P8
      8, 9, 10, 11, 12, 13, 14, 15,       // SMP params
      23, 16, 18, 17, 19, 20, 21,          // FLT params (ENV, ATK, DEC, SUS, REL, FRQ, RES)
      24, 25, 26, 27, 31, 30, 32, 28, 29  // AMP params (ATK, HLD, DEC, OVR, VOL, PAN, ACC, DLY, REV)
    ];
    // Reverse map: internal ID → UI index
    const LFO_DEST_ID_TO_UI = new Map();
    LFO_DEST_UI_IDS.forEach((id, idx) => LFO_DEST_ID_TO_UI.set(id, idx));

    function lfoDestName(v, machineType) {
      // For SYN destinations (0-7), use machine-specific param names
      if (v <= 7 && machineType !== null && machineType !== undefined) {
        const ml = MACHINES[machineType]?.params[v];
        if (ml && ml !== '-') return ml;
      }
      return LFO_DEST_NAMES[v] ?? String(v);
    }

    // ─── Plock parameter info ─────────────────────────────────────────────────
    // Maps plock_type → { sec, lbl, sndOff, [bipolar], [enum], [pan], [inf127], [lfoDest] }
    // sndOff = byte offset within ar_sound_t (hi byte of s_u16_t carries 0-127 value)

    const PLOCK_INFO = {
      0x00: { sec:'SRC',  lbl:'P1',   sndOff:SND_SYNTH_PARAM_1 },
      0x01: { sec:'SRC',  lbl:'P2',   sndOff:SND_SYNTH_PARAM_2 },
      0x02: { sec:'SRC',  lbl:'P3',   sndOff:SND_SYNTH_PARAM_3 },
      0x03: { sec:'SRC',  lbl:'P4',   sndOff:SND_SYNTH_PARAM_4 },
      0x04: { sec:'SRC',  lbl:'P5',   sndOff:SND_SYNTH_PARAM_5 },
      0x05: { sec:'SRC',  lbl:'P6',   sndOff:SND_SYNTH_PARAM_6 },
      0x06: { sec:'SRC',  lbl:'P7',   sndOff:SND_SYNTH_PARAM_7 },
      0x07: { sec:'SRC',  lbl:'P8',   sndOff:SND_SYNTH_PARAM_8 },
      0x08: { sec:'SMPL', lbl:'TUN',  sndOff:SND_SAMPLE_TUNE, bipolar:true },
      0x09: { sec:'SMPL', lbl:'FIN',  sndOff:SND_SAMPLE_FINE_TUNE, bipolar:true },
      0x0A: { sec:'SMPL', lbl:'SMP',  sndOff:SND_SAMPLE_NR },
      0x0B: { sec:'SMPL', lbl:'BR',   sndOff:SND_SAMPLE_BR },
      0x0C: { sec:'SMPL', lbl:'STA',  sndOff:SND_SAMPLE_START },
      0x0D: { sec:'SMPL', lbl:'END',  sndOff:SND_SAMPLE_END },
      0x0E: { sec:'SMPL', lbl:'LOP',  sndOff:SND_SAMPLE_LOOP_FLAG, enum:['OFF','ON'] },
      0x0F: { sec:'SMPL', lbl:'LEV',  sndOff:SND_SAMPLE_VOLUME },
      0x10: { sec:'FLTR', lbl:'ATK',  sndOff:SND_FLT_ATTACK },
      0x11: { sec:'FLTR', lbl:'SUS',  sndOff:SND_FLT_SUSTAIN },
      0x12: { sec:'FLTR', lbl:'DEC',  sndOff:SND_FLT_DECAY, inf127:true },
      0x13: { sec:'FLTR', lbl:'REL',  sndOff:SND_FLT_RELEASE, inf127:true },
      0x14: { sec:'FLTR', lbl:'FRQ',  sndOff:SND_FLT_CUTOFF },
      0x15: { sec:'FLTR', lbl:'RES',  sndOff:SND_FLT_RES },
      0x16: { sec:'FLTR', lbl:'TYP',  sndOff:SND_FLT_TYPE, enum:FLT_TYPE_NAMES },
      0x17: { sec:'FLTR', lbl:'ENV',  sndOff:SND_FLT_ENV, bipolar:true },
      0x18: { sec:'AMP',  lbl:'ATK',  sndOff:SND_AMP_ATTACK },
      0x19: { sec:'AMP',  lbl:'HLD',  sndOff:SND_AMP_HOLD },
      0x1A: { sec:'AMP',  lbl:'DEC',  sndOff:SND_AMP_DECAY, inf127:true },
      0x1B: { sec:'AMP',  lbl:'OVR',  sndOff:SND_AMP_OVERDRIVE },
      0x1C: { sec:'AMP',  lbl:'DEL',  sndOff:SND_AMP_DELAY_SEND },
      0x1D: { sec:'AMP',  lbl:'REV',  sndOff:SND_AMP_REVERB_SEND },
      0x1E: { sec:'AMP',  lbl:'PAN',  sndOff:SND_AMP_PAN, pan:true },
      0x1F: { sec:'AMP',  lbl:'VOL',  sndOff:SND_AMP_VOLUME },
      // 0x20: unknown — skipped
      0x21: { sec:'LFO',  lbl:'SPD',  sndOff:SND_LFO_SPEED, bipolar:true },
      0x22: { sec:'LFO',  lbl:'MUL',  sndOff:SND_LFO_MULTIPLIER, enum:LFO_MUL_NAMES },
      0x23: { sec:'LFO',  lbl:'FAD',  sndOff:SND_LFO_FADE, bipolar:true },
      0x24: { sec:'LFO',  lbl:'DST',  sndOff:SND_LFO_DEST, lfoDest:true },
      0x25: { sec:'LFO',  lbl:'WAV',  sndOff:SND_LFO_WAV, enum:LFO_WAV_NAMES },
      0x26: { sec:'LFO',  lbl:'SPH',  sndOff:SND_LFO_START_PHASE, lfoPhase:true },
      0x27: { sec:'LFO',  lbl:'MOD',  sndOff:SND_LFO_MODE, enum:LFO_TRIG_NAMES },
      0x28: { sec:'LFO',  lbl:'DEP',  sndOff:SND_LFO_DEPTH, bipolar:true },
    };

    const SECTION_KEYS = ['SRC','SMPL','FLTR','AMP','LFO'];

    // Display order overrides (AR screen order differs from sysex byte order)
    const SECTION_ORDER = {
      'SMPL': [0x08, 0x09, 0x0B, 0x0A, 0x0C, 0x0D, 0x0E, 0x0F],
      'FLTR': [0x10, 0x12, 0x11, 0x13, 0x14, 0x15, 0x16, 0x17],
    };

    // ─── FX track parameter info ──────────────────────────────────────────────
    // Maps FX plock_type → { sec, lbl, kitOff, ... }
    // kitOff = byte offset within ar_kit_t; FX plock type n → kitOff 0x07CA + n*2
    const FX_KIT_BASE = 0x07CA;

    // Compressor enum labels
    const COMP_ATK_NAMES = ['0.03','0.1','0.3','1','3','10','30'];
    const COMP_REL_NAMES = ['0.1','0.2','0.4','0.6','1','2','A1','A2'];
    const COMP_RAT_NAMES = ['1:2','1:4','1:8','MAX'];

    const FX_PLOCK_INFO = {
      // DELAY (plock types 0-7)
      0:  { sec:'DELAY',  lbl:'TIM',  kitOff:KIT_FX_DELAY_TIME, noteLen:true },
      1:  { sec:'DELAY',  lbl:'X',    kitOff:KIT_FX_DELAY_PINGPONG, enum:['OFF','ON'] },
      2:  { sec:'DELAY',  lbl:'WID',  kitOff:KIT_FX_DELAY_WIDTH, bipolar:true },
      3:  { sec:'DELAY',  lbl:'FDB',  kitOff:KIT_FX_DELAY_FEEDBACK, pct200:true },
      4:  { sec:'DELAY',  lbl:'HPF',  kitOff:KIT_FX_DELAY_HPF },
      5:  { sec:'DELAY',  lbl:'LPF',  kitOff:KIT_FX_DELAY_LPF },
      6:  { sec:'DELAY',  lbl:'REV',  kitOff:KIT_FX_DELAY_REV_SEND },
      7:  { sec:'DELAY',  lbl:'VOL',  kitOff:KIT_FX_DELAY_VOLUME },
      // DISTORTION (plock types 8,9,17,18,19)
      8:  { sec:'DIST',   lbl:'DOV',  kitOff:KIT_FX_DIST_REV_SEND },
      9:  { sec:'DIST',   lbl:'DEL',  kitOff:KIT_FX_DIST_DELAY_PP, enum:['PRE','POST'] },
      17: { sec:'DIST',   lbl:'REV',  kitOff:KIT_FX_DIST_REV_PP, enum:['PRE','POST'] },
      18: { sec:'DIST',   lbl:'AMT',  kitOff:KIT_FX_DIST_AMOUNT },
      19: { sec:'DIST',   lbl:'SYM',  kitOff:KIT_FX_DIST_SYM, bipolar:true },
      // REVERB (plock types 10-16)
      10: { sec:'REVERB', lbl:'PRE',  kitOff:KIT_FX_REVERB_PRE },
      11: { sec:'REVERB', lbl:'DEC',  kitOff:KIT_FX_REVERB_DECAY, inf127:true },
      12: { sec:'REVERB', lbl:'FRQ',  kitOff:KIT_FX_REVERB_FREQ },
      13: { sec:'REVERB', lbl:'GAI',  kitOff:KIT_FX_REVERB_GAIN, bipolar:true },
      14: { sec:'REVERB', lbl:'HPF',  kitOff:KIT_FX_REVERB_HPF },
      15: { sec:'REVERB', lbl:'LPF',  kitOff:KIT_FX_REVERB_LPF },
      16: { sec:'REVERB', lbl:'VOL',  kitOff:KIT_FX_REVERB_VOLUME },
      // COMPRESSOR (plock types 21-28)
      21: { sec:'COMP',   lbl:'THR',  kitOff:KIT_FX_COMP_THRESHOLD },
      22: { sec:'COMP',   lbl:'ATK',  kitOff:KIT_FX_COMP_ATTACK, enum:COMP_ATK_NAMES },
      23: { sec:'COMP',   lbl:'REL',  kitOff:KIT_FX_COMP_RELEASE, enum:COMP_REL_NAMES },
      24: { sec:'COMP',   lbl:'RAT',  kitOff:KIT_FX_COMP_RATIO, enum:COMP_RAT_NAMES },
      25: { sec:'COMP',   lbl:'SEQ',  kitOff:KIT_FX_COMP_SEQ, enum:['OFF','LPF','HPF','HIT'] },
      26: { sec:'COMP',   lbl:'MUP',  kitOff:KIT_FX_COMP_GAIN },
      27: { sec:'COMP',   lbl:'MIX',  kitOff:KIT_FX_COMP_MIX },
      28: { sec:'COMP',   lbl:'VOL',  kitOff:KIT_FX_COMP_VOLUME },
      // FX LFO (plock types 29-36)
      29: { sec:'FX_LFO', lbl:'SPD',  kitOff:KIT_FX_LFO_SPEED, bipolar:true },
      30: { sec:'FX_LFO', lbl:'MUL',  kitOff:KIT_FX_LFO_MULTIPLIER, enum:LFO_MUL_NAMES },
      31: { sec:'FX_LFO', lbl:'FAD',  kitOff:KIT_FX_LFO_FADE, bipolar:true },
      32: { sec:'FX_LFO', lbl:'DST',  kitOff:KIT_FX_LFO_DEST, fxLfoDest:true },
      33: { sec:'FX_LFO', lbl:'WAV',  kitOff:KIT_FX_LFO_WAV, enum:LFO_WAV_NAMES },
      34: { sec:'FX_LFO', lbl:'SPH',  kitOff:KIT_FX_LFO_START_PHASE, lfoPhase:true },
      35: { sec:'FX_LFO', lbl:'MOD',  kitOff:KIT_FX_LFO_MODE, enum:LFO_TRIG_NAMES },
      36: { sec:'FX_LFO', lbl:'DEP',  kitOff:KIT_FX_LFO_DEPTH, bipolar:true },
    };

    const FX_SECTION_KEYS = ['DELAY','REVERB','DIST','COMP','FX_LFO'];

    // FX display order overrides (AR screen order differs from plock type order)
    const FX_SECTION_ORDER = {
      // COMP: manual order is THR, ATK, REL, MUP, RAT, SEQ, MIX, VOL
      'COMP': [21, 22, 23, 26, 24, 25, 27, 28],
      'DIST': [18, 19, 8, 9, 17],
    };

    // Retrig rate labels: index 0-16, matching AR display (0=1/1, 16=1/80)
    const RETRIG_RATE_LABELS = [
      '1/1','1/2','1/3','1/4','1/5','1/6','1/8','1/10',
      '1/12','1/16','1/20','1/24','1/32','1/40','1/48','1/64','1/80',
    ];

    // Trig condition names (indexed by AR_TRIG_CONDITION_* enum, 0-56)
    const TRIG_COND_NAMES = [
      '1%','3%','4%','6%','9%','13%','19%','25%','33%','41%',
      '50%','59%','67%','75%','81%','87%','91%','94%','96%','98%',
      '99%','100%','FILL','!FILL','PRE','!PRE','NEI','!NEI',
      '1ST','!1ST','1:2','2:2','1:3','2:3','3:3','1:4','2:4','3:4','4:4',
      '1:5','2:5','3:5','4:5','5:5','1:6','2:6','3:6','4:6','5:6','6:6',
      '1:7','2:7','3:7','4:7','5:7','6:7','7:7',
      '1:8','2:8','3:8','4:8','5:8','6:8','7:8','8:8',
    ];
