// ─── AR namespace & shared state ──────────────────────────────────────────────
window.AR = window.AR || {};

// ─── Mutable application state ───────────────────────────────────────────────
AR.state = {
  midi: {
    access:    null,   // WebMIDI MIDIAccess
    input:     null,   // MIDIInput port
    output:    null,   // MIDIOutput port
    sysexBuf:  [],     // accumulating incoming SysEx bytes
    inSysex:   false,  // currently inside a SysEx message
  },
  pattern: {
    raw:          null,   // Uint8Array — decoded pattern bytes (mutable during edits)
    kit:          null,   // Uint8Array — decoded kit bytes
    kitSyx:       null,   // Uint8Array — original kit SysEx (for round-trip save)
    syxMeta:      null,   // { devId, dumpId, verHi, verLo, objNr }
    name:         '',     // "Workbuffer" or "A01" etc.
    dirty:        false,  // true once pattern has been edited since load/new
    plocks:       null,   // Array[13] of Map<type, Uint8Array[64]>
    plockFine:    null,   // Array[13] of Map<type, Uint8Array[64]> (0x80 companions)
    soundPool:    new Map(),  // slot (0-127) → decoded raw sound bytes
    soundPoolSyx: new Map(),  // slot (0-127) → original SysEx bytes (for saving)
  },
  settings: {
    raw:          null,   // Uint8Array — decoded settings bytes (project BPM at 0x04-0x05)
  },
  global: {
    raw:          null,   // Uint8Array — decoded global bytes (MIDI config, routing, etc.)
  },
  ui: {
    stepPage:       0,     // 0 or 1
    openPanel:      null,  // { t, s, el } or null
    openTrackPanel: null,  // { t, el } or null
    mutedTracks:    new Set(),  // session-only preview mutes (Set<int>)
    soloedTracks:   new Set(),  // session-only preview solos (Set<int>)
    trackLevels:    new Array(12).fill(100),  // 0-100 per-track preview level
    preMuteLevels:  new Array(12).fill(100),  // level before mute, for restore
  },
  requests: {
    pendingSounds: new Set(),  // slot numbers awaiting SysEx response
    savePending:   false,      // true while waiting for full pool before saving
  },
};

// ─── State mutation helpers ──────────────────────────────────────────────────
AR.loadPattern = function(raw, meta, name) {
  // Restart audio preview so it picks up the new pattern buffer
  // (cached trigBits subarrays point to the old Uint8Array)
  var wasPlaying = AR.audio && AR.audio._state && AR.audio._state.playing;
  if (wasPlaying) AR.audio.stop();
  var P = AR.state.pattern;
  P.raw     = raw;
  P.syxMeta = meta;
  P.name    = name;
  P.dirty   = false;
  P.soundPool.clear();
  P.soundPoolSyx.clear();
  AR.state.requests.pendingSounds.clear();
  AR.state.requests.savePending = false;
  // Defer restart so callers can finish setting up plocks/kit first
  if (wasPlaying) Promise.resolve().then(function () { AR.audio.start(); });
};

AR.loadKit = function(kit, syx) {
  AR.state.pattern.kit    = kit;
  AR.state.pattern.kitSyx = syx;
};

AR.loadPlocks = function(coarse, fine) {
  AR.state.pattern.plocks    = coarse;
  AR.state.pattern.plockFine = fine;
};

// Preview-only audibility check.  If anything is soloed, only soloed tracks
// are audible.  Otherwise, audible iff not in the muted set.  Mutes/solos
// are session-only state — never persisted, never written to pattern data.
AR.isTrackAudible = function(t) {
  var ui = AR.state.ui;
  if (ui.soloedTracks.size > 0) return ui.soloedTracks.has(t);
  return !ui.mutedTracks.has(t);
};

// ─── Track level persistence (localStorage) ─────────────────────────────────
(function () {
  var LS_KEY = 'plock_trackLevels';
  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY));
    if (Array.isArray(saved) && saved.length === 12) {
      AR.state.ui.trackLevels = saved.map(function (v) {
        return Math.max(0, Math.min(100, Number(v) || 100));
      });
      // Restore mutes derived from level=0
      for (var i = 0; i < 12; i++) {
        if (AR.state.ui.trackLevels[i] === 0) AR.state.ui.mutedTracks.add(i);
      }
    }
  } catch (e) {}
  AR.saveTrackLevels = function () {
    try { localStorage.setItem(LS_KEY, JSON.stringify(AR.state.ui.trackLevels)); } catch (e) {}
  };
})();

// ─── Session persistence (localStorage) ─────────────────────────────────────
(function () {
  var LS_KEY = 'plock_session';

  // Uint8Array → base64 string
  function u8ToB64(u8) {
    var bin = '';
    for (var i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  }
  // base64 string → Uint8Array
  function b64ToU8(b64) {
    var bin = atob(b64);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  // Serialize a Map<number, Uint8Array> → Array of [key, base64]
  function serializeMap(map) {
    var arr = [];
    map.forEach(function (v, k) { arr.push([k, u8ToB64(v)]); });
    return arr;
  }
  // Deserialize Array of [key, base64] → Map<number, Uint8Array>
  function deserializeMap(arr) {
    var map = new Map();
    if (!arr) return map;
    for (var i = 0; i < arr.length; i++) map.set(arr[i][0], b64ToU8(arr[i][1]));
    return map;
  }

  AR.saveSession = function () {
    var P = AR.state.pattern;
    if (!P.raw) return;
    try {
      var data = {
        raw:          u8ToB64(P.raw),
        kit:          P.kit    ? u8ToB64(P.kit)    : null,
        kitSyx:       P.kitSyx ? u8ToB64(P.kitSyx) : null,
        syxMeta:      P.syxMeta,
        name:         P.name,
        soundPool:    serializeMap(P.soundPool),
        soundPoolSyx: serializeMap(P.soundPoolSyx),
      };
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch (e) {}
  };

  // Debounced version for use after edits
  var _saveTimer = null;
  AR.saveSessionDebounced = function () {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () { _saveTimer = null; AR.saveSession(); }, 500);
  };

  AR.hasSavedSession = function () {
    return !!localStorage.getItem(LS_KEY);
  };

  // Returns the restored pattern state, or null if nothing saved.
  // Does NOT call renderMeta/renderGrid — caller must do that.
  AR.restoreSession = function () {
    try {
      var json = localStorage.getItem(LS_KEY);
      if (!json) return null;
      var data = JSON.parse(json);
      if (!data || !data.raw) return null;

      var raw  = b64ToU8(data.raw);
      var kit  = data.kit    ? b64ToU8(data.kit)    : null;
      var kSyx = data.kitSyx ? b64ToU8(data.kitSyx) : null;

      AR.loadPattern(raw, data.syxMeta, data.name);
      AR.loadKit(kit, kSyx);

      var P = AR.state.pattern;
      P.soundPool    = deserializeMap(data.soundPool);
      P.soundPoolSyx = deserializeMap(data.soundPoolSyx);

      return raw;
    } catch (e) { return null; }
  };

  AR.clearSavedSession = function () {
    localStorage.removeItem(LS_KEY);
  };
})();

// ─── Auto-zoom to fit browser window ─────────────────────────────────────────
(function () {
  var naturalW = null;

  AR.fitToWindow = function () {
    // Reset zoom so we can measure the natural content width
    document.body.style.zoom = '';
    if (!naturalW) {
      var grid = document.getElementById('grid');
      if (!grid) return;
      // Body is fit-content, so scrollWidth = actual content width
      naturalW = document.body.scrollWidth;
    }
    var V = document.documentElement.clientWidth;
    var zoom = V / naturalW;
    // Minimum zoom: 16-step equivalent (~55% of full 32-step width).
    // Below this, the page scrolls horizontally instead of shrinking further.
    var minZoom = 1;
    document.body.style.zoom = Math.max(zoom, minZoom);
  };

  window.addEventListener('resize', AR.fitToWindow);
})();

// ─── UI element references (populated by AR.initUI after DOM ready) ──────────
AR.ui = {};

AR.initUI = function() {
  AR.ui.btnConnect  = document.getElementById('btn-connect');
  AR.ui.btnConnectLabel = document.getElementById('btn-connect-label');
  AR.ui.midiPicker  = document.getElementById('midi-picker');
  AR.ui.btnNew      = document.getElementById('btn-new');
  AR.ui.btnRefresh  = document.getElementById('btn-refresh');
  AR.ui.btnLoadSyx  = document.getElementById('btn-load-syx');
  AR.ui.btnSaveSyx  = document.getElementById('btn-save-syx');
  AR.ui.btnSend     = document.getElementById('btn-send');
  AR.ui.syxFileIn   = document.getElementById('syx-file');
  AR.ui.btnPage0    = document.getElementById('btn-page0');
  AR.ui.btnPage1    = document.getElementById('btn-page1');
  AR.ui.statusEl    = document.getElementById('status');
  AR.ui.metaEl      = document.getElementById('pattern-meta');
  AR.ui.gridEl      = document.getElementById('grid');
  AR.ui.btnLog      = document.getElementById('btn-log');
  AR.ui.logPanel    = document.getElementById('log-panel');

  // ── Log panel toggle ────────────────────────────────────────────────────
  AR.ui.btnLog.addEventListener('click', function() {
    var panel = AR.ui.logPanel;
    var open  = panel.hidden;
    panel.hidden = !open;
    AR.ui.btnLog.textContent = open ? 'Hide Log' : 'Show Log';
    if (open) {
      // Populate panel from log history and clear badge
      AR.ui.btnLog.classList.remove('log-has-errors');
      AR._unreadErrors = 0;
      panel.innerHTML = '';
      for (var i = 0; i < AR.log.length; i++) {
        panel.appendChild(AR._makeLogEntry(AR.log[i]));
      }
      panel.scrollTop = panel.scrollHeight;
    }
  });
};

// ─── Log accumulator ─────────────────────────────────────────────────────────
var LOG_MAX = 200;
AR.log = [];
AR._unreadErrors = 0;

AR._makeLogEntry = function(entry) {
  var div = document.createElement('div');
  div.className = 'log-entry' + (entry.cls ? ' ' + entry.cls : '');
  div.textContent = entry.ts + '  ' + entry.msg;
  return div;
};

// ─── UI helpers ──────────────────────────────────────────────────────────────
AR.setStatus = function(msg, cls) {
  // Update inline status bar (truncated via CSS; full text on hover)
  AR.ui.statusEl.textContent = msg;
  AR.ui.statusEl.title       = msg;
  AR.ui.statusEl.className   = cls || '';

  // Append to log history
  var now = new Date();
  var ts  = ('0' + now.getHours()).slice(-2) + ':' +
            ('0' + now.getMinutes()).slice(-2) + ':' +
            ('0' + now.getSeconds()).slice(-2);
  var entry = { ts: ts, msg: msg, cls: cls || '' };
  AR.log.push(entry);
  if (AR.log.length > LOG_MAX) AR.log.shift();

  // If log panel is open, append live; otherwise badge on errors
  var panel = AR.ui.logPanel;
  if (panel && !panel.hidden) {
    panel.appendChild(AR._makeLogEntry(entry));
    panel.scrollTop = panel.scrollHeight;
  } else if (cls === 'err') {
    AR._unreadErrors++;
    if (AR.ui.btnLog) AR.ui.btnLog.classList.add('log-has-errors');
  }
};
