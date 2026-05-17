// Logger — replaces VS Code OutputChannel.
// Writes to file and console. In Electron, also sends to renderer if provided.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let _filePath = null;
let _stream = null;
let _enabled = true;
let _sendToRenderer = null; // optional: (msg) => void

function ts() { return new Date().toISOString(); }

function safeJson(o) {
    try {
        return JSON.stringify(o, (_k, v) => {
            if (typeof v === 'string' && v.length > 4000) return v.slice(0, 4000) + '...(+' + (v.length - 4000) + ' chars)';
            return v;
        });
    } catch (e) { return String(o); }
}

function _cleanOldLogs(dir) {
    const MAX_LOG_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    try {
        for (const entry of fs.readdirSync(dir)) {
            if (!entry.startsWith('session-') || !entry.endsWith('.log')) continue;
            const fp = path.join(dir, entry);
            try {
                if (now - fs.statSync(fp).mtimeMs > MAX_LOG_AGE_MS) fs.unlinkSync(fp);
            } catch {}
        }
    } catch {}
}

function _writeRaw(line) {
    if (!_enabled) return;
    try { console.log(line); } catch (_) {}
    try { _stream && _stream.write(line + '\n'); } catch (_) {}
    try { _sendToRenderer && _sendToRenderer({ type: 'log', line }); } catch (_) {}
}

const Logger = {
    init(logDir, opts = {}) {
        _enabled = opts.enabled !== false;
        _sendToRenderer = opts.sendToRenderer || null;
        try {
            const dir = logDir || path.join(os.homedir(), '.deepcopilot-desktop', 'logs');
            fs.mkdirSync(dir, { recursive: true });
            _cleanOldLogs(dir);
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            _filePath = path.join(dir, 'session-' + stamp + '.log');
            _stream = fs.createWriteStream(_filePath, { flags: 'a' });
            _writeRaw('[' + ts() + '] [INIT] Deep Copilot Desktop log started. file=' + _filePath);
        } catch (e) {
            console.error('[INIT-FAIL]', e.message);
        }
    },
    getFilePath() { return _filePath; },
    setEnabled(v) { _enabled = !!v; },
    info(tag, obj) {
        const body = obj === undefined ? '' : ' ' + (typeof obj === 'string' ? obj : safeJson(obj));
        _writeRaw('[' + ts() + '] [' + tag + ']' + body);
    },
    thinking(delta) {
        // Just log to file, no buffering needed for Electron
        if (!_enabled || !delta) return;
        try { _stream && _stream.write('[THINK] ' + delta + '\n'); } catch (_) {}
    },
    flush() { /* no-op in Electron, but kept for compatibility */ },
};

module.exports = { Logger };
