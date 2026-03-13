// ─── AR namespace & shared state ──────────────────────────────────────────────
window.AR = window.AR || {};

// ─── Mutable application state ───────────────────────────────────────────────
AR.state = {
  midiAccess:       null,
  rytmInput:        null,
  rytmOutput:       null,
  sysexBuf:         [],
  inSysex:          false,
  lastRaw:          null,    // decoded pattern bytes
  lastKit:          null,    // decoded kit bytes
  lastKitSyx:       null,    // original kit sysex bytes (for saving)
  lastSyxMeta:      null,    // { devId, dumpId, verHi, verLo, objNr }
  plockValues:      null,    // plockValues[track] = Map<plockType, Uint8Array[64]>
  plockFineValues:  null,    // plockFineValues[track] = Map<plockType, Uint8Array[64]> (0x80 companions)
  stepPage:         0,
  openPanel:        null,    // { t, s, el }
  openTrackPanel:   null,    // { t, el }
  soundPool:        new Map(),      // slot (0-127) → decoded raw sound bytes
  soundPoolSyx:     new Map(),      // slot (0-127) → original sysex bytes (for saving)
  pendingSoundReqs: new Set(),      // slot numbers awaiting response
  savePending:      false,          // true while waiting for full pool before saving
  lastPatName:      '',             // pattern name for meta display
};

// ─── UI element references (populated by AR.initUI after DOM ready) ──────────
AR.ui = {};

AR.initUI = function() {
  AR.ui.btnConnect  = document.getElementById('btn-connect');
  AR.ui.btnRefresh  = document.getElementById('btn-refresh');
  AR.ui.btnLoadSyx  = document.getElementById('btn-load-syx');
  AR.ui.btnSaveSyx  = document.getElementById('btn-save-syx');
  AR.ui.btnSend     = document.getElementById('btn-send');
  AR.ui.syxFileIn   = document.getElementById('syx-file');
  AR.ui.btnPage0    = document.getElementById('btn-page0');
  AR.ui.btnPage1    = document.getElementById('btn-page1');
  AR.ui.statusEl    = document.getElementById('status');
  AR.ui.portInfoEl  = document.getElementById('port-info');
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
  // Update inline status bar
  AR.ui.statusEl.textContent = msg;
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
