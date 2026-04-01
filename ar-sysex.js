// ─── SysEx codec, trig flags, plock parsing ──────────────────────────────────
// Depends on: ar-state.js, ar-constants.js

    function patternSlotName(n) {
      const bank = String.fromCharCode(65 + Math.floor(n / 16));
      const slot = String(1 + (n % 16)).padStart(2, '0');
      return bank + slot;
    }

    // ─── 7-bit SysEx → 8-bit raw decode ──────────────────────────────────────

    function decodeSysex7to8(syx) {
      const dataStart = 10;
      const dataEnd   = syx.length - 5;
      const syxDatSz  = dataEnd - dataStart;
      if (syxDatSz <= 0) throw new Error('Empty payload');

      const raw  = [];
      let pkbNr  = 0;
      let msbs   = 0;

      for (let i = 0; i < syxDatSz; i++) {
        const b = syx[dataStart + i];
        if (pkbNr === 0) {
          msbs = b;
        } else {
          raw.push(b | (msbs & 0x80));
        }
        msbs  = (msbs << 1) & 0xFF;
        pkbNr = (pkbNr + 1) & 7;
      }

      return new Uint8Array(raw);
    }

    // ─── 8-bit raw → 7-bit SysEx encode (inverse of decode) ─────────────────
    // Ported from libanalogrytm/sysex.c ar_sysex_encode

    function encodeSysex8to7(raw) {
      const out = [];
      let chksum = 0;
      let pkbNr = 0;
      let msbs = 0;
      let msbIdx = -1;

      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];

        if (pkbNr === 0) {
          msbs = (c & 0x80) >> 1;
          msbIdx = out.length;
          out.push(0);  // placeholder for MSB byte
        } else {
          msbs |= (c & 0x80) >> (1 + pkbNr);
        }

        out.push(c & 0x7F);
        chksum += (c & 0x7F);
        pkbNr++;

        if (pkbNr === 7) {
          chksum += msbs;
          out[msbIdx] = msbs;
          pkbNr = 0;
        }
      }

      // Finish last partial packet
      if (pkbNr > 0) {
        out[msbIdx] = msbs;
        chksum += msbs;
      }

      return { data: new Uint8Array(out), checksum: chksum & 0x3FFF };
    }

    // ─── Build complete sysex message from raw + metadata ────────────────────

    function buildSysexMessage(raw, meta) {
      const { data, checksum } = encodeSysex8to7(raw);
      const chkHi = (checksum >> 7) & 0x7F;
      const chkLo = checksum & 0x7F;
      const dataSz = data.length + 2 + 2 + 1; // payload + chksum + datasize + F7
      const dsHi = (dataSz >> 7) & 0x7F;
      const dsLo = dataSz & 0x7F;

      const syx = new Uint8Array(10 + data.length + 5);
      syx[0] = SYSEX_START;
      syx[1] = 0x00;
      syx[2] = AR_ELEKTRON_MFR_1;
      syx[3] = AR_ELEKTRON_MFR_2;
      syx[4] = AR_PRODUCT_ID;
      syx[5] = meta.devId;
      syx[6] = meta.dumpId;
      syx[7] = meta.verHi;
      syx[8] = meta.verLo;
      syx[9] = meta.objNr;
      syx.set(data, 10);
      const t = 10 + data.length;
      syx[t]     = chkHi;
      syx[t + 1] = chkLo;
      syx[t + 2] = dsHi;
      syx[t + 3] = dsLo;
      syx[t + 4] = SYSEX_END;
      return syx;
    }

    // ─── Trig flags from packed 14-bit bitstream ──────────────────────────────

    function getTrigFlags(trigBits, stepIdx) {
      const startBit = 14 * stepIdx;
      const numBits  = 14;
      let r        = 0;
      let byteOff  = startBit >> 3;
      let bitOff   = startBit - (byteOff << 3);
      let outShift = numBits;
      let bitsLeft = numBits;

      while (bitsLeft > 0) {
        const bitsAvail = 8 - bitOff;
        if (bitsLeft < bitsAvail) {
          outShift -= bitsLeft;
          r |= ((trigBits[byteOff] >> (bitsAvail - bitsLeft)) & ((1 << bitsLeft) - 1)) << outShift;
          bitsLeft = 0;
        } else {
          outShift -= bitsAvail;
          r |= (trigBits[byteOff] & ((1 << bitsAvail) - 1)) << outShift;
          bitsLeft -= bitsAvail;
          bitOff    = 0;
          byteOff++;
        }
      }
      return r;
    }

    function setTrigFlags(trigBits, stepIdx, val) {
      const startBit = 14 * stepIdx;
      const numBits  = 14;
      let byteOff  = startBit >> 3;
      let bitOff   = startBit - (byteOff << 3);
      let srcShift = numBits;
      let bitsLeft = numBits;

      while (bitsLeft > 0) {
        const bitsAvail = 8 - bitOff;
        if (bitsLeft < bitsAvail) {
          const shift = bitsAvail - bitsLeft;
          const mask  = ((1 << bitsLeft) - 1) << shift;
          srcShift -= bitsLeft;
          trigBits[byteOff] = (trigBits[byteOff] & ~mask) | (((val >> srcShift) & ((1 << bitsLeft) - 1)) << shift);
          bitsLeft = 0;
        } else {
          const mask = (1 << bitsAvail) - 1;
          srcShift -= bitsAvail;
          trigBits[byteOff] = (trigBits[byteOff] & ~mask) | ((val >> srcShift) & mask);
          bitsLeft -= bitsAvail;
          bitOff    = 0;
          byteOff++;
        }
      }
    }

    // ─── Plock parsing ────────────────────────────────────────────────────────
    // Scans plock_seqs sequentially and populates AR.state.pattern.plocks via
    // AR.loadPlocks.  Returns a plockMap[track][step] presence array for renderGrid.
    //
    // Fine-companion pairing: the scan tracks the last coarse slot seen.  When a
    // fine slot (type=0x80, track=0x80) appears, it is paired with that preceding
    // coarse slot.  An unused/invalid slot resets tracking, so a fine slot is only
    // valid when it immediately follows its coarse slot with no gaps.

    function parsePlocks(raw) {
      const values = Array.from({length: AR_NUM_TRACKS}, () => new Map());
      const fine   = Array.from({length: AR_NUM_TRACKS}, () => new Map());
      const map    = Array.from({length: AR_NUM_TRACKS}, () => new Uint8Array(AR_NUM_STEPS));

      const end = PLOCK_SEQS_BASE + NUM_PLOCK_SEQS * PLOCK_SEQ_SZ;
      if (raw.length >= end) {
        let lastCoarseType = -1, lastCoarseTrk = -1;

        for (let si = 0; si < NUM_PLOCK_SEQS; si++) {
          const base   = PLOCK_SEQS_BASE + si * PLOCK_SEQ_SZ;
          const plType = raw[base];
          const trkNr  = raw[base + 1];

          // Fine companion: type=PLOCK_FINE_FLAG, track=PLOCK_FINE_FLAG — pair with preceding coarse
          if (plType === PLOCK_FINE_FLAG && trkNr === PLOCK_FINE_FLAG && lastCoarseTrk < 0) {
            // Orphaned fine slot — no preceding coarse to pair with; skip it
            setStatus('warn: orphaned fine plock at slot ' + si + ' (no preceding coarse)');
            continue;
          }
          if (plType === PLOCK_FINE_FLAG && trkNr === PLOCK_FINE_FLAG && lastCoarseTrk >= 0) {
            let arr = fine[lastCoarseTrk].get(lastCoarseType);
            if (!arr) { arr = new Uint8Array(AR_NUM_STEPS).fill(PLOCK_NO_VALUE); fine[lastCoarseTrk].set(lastCoarseType, arr); }
            for (let s = 0; s < AR_NUM_STEPS; s++) {
              const v = raw[base + 2 + s];
              if (v !== PLOCK_NO_VALUE) arr[s] = v;
            }
            continue;
          }

          if (plType === PLOCK_TYPE_UNUSED || trkNr === PLOCK_TYPE_UNUSED || trkNr >= AR_NUM_TRACKS) {
            lastCoarseType = -1; lastCoarseTrk = -1;
            continue;
          }

          lastCoarseType = plType; lastCoarseTrk = trkNr;

          let arr = values[trkNr].get(plType);
          if (!arr) { arr = new Uint8Array(AR_NUM_STEPS).fill(PLOCK_NO_VALUE); values[trkNr].set(plType, arr); }

          for (let s = 0; s < AR_NUM_STEPS; s++) {
            const v = raw[base + 2 + s];
            if (v !== PLOCK_NO_VALUE) { arr[s] = v; map[trkNr][s] = 1; }
          }
        }
      }

      AR.loadPlocks(values, fine);
      return map;
    }

    function scanSoundLocks(raw) {
      const slots = new Set();
      for (let t = 0; t < AR_NUM_TRACKS; t++) {
        const trackBase = 4 + t * TRACK_V5_SZ;
        for (let s = 0; s < AR_NUM_STEPS; s++) {
          const v = raw[trackBase + SOUND_LOCK_OFFSET + s];
          if (v !== SOUND_LOCK_NONE) slots.add(v);
        }
      }
      return slots;
    }
