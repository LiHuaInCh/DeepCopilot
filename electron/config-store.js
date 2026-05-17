// Config & secret storage — replaces vscode.workspace.getConfiguration()
// and vscode.ExtensionContext.{globalState, secrets} for Electron.
'use strict';

const path = require('path');
const fs = require('fs');

let Store;
try { Store = require('electron-store'); } catch (_) { /* will be available in Electron runtime */ }

const DEFAULTS = {
    apiBaseUrl: '',
    defaultModel: 'deepseek-v4-pro',
    subAgentModel: 'deepseek-v4-flash',
    approvalMode: 'manual',
    autoApproveTools: [],
    denyTools: [],
    enableDebugLog: true,
    maxIterations: 0,
    compactBudgetTokens: 96000,
    postEditDiagnostics: false, // no VS Code language server in Electron
    interactionMode: 'agent',
    mcp: { servers: {} },
};

let _store = null;
let _secrets = {}; // in-memory secret cache; Electron safeStorage encrypts on disk
let _secretsPath = null;
let _projectDir = null;

function _initSecrets(userDataPath) {
    _secretsPath = path.join(userDataPath, 'secrets.json.enc');
    try {
        if (fs.existsSync(_secretsPath)) {
            const raw = fs.readFileSync(_secretsPath, 'utf8');
            _secrets = JSON.parse(raw);
        }
    } catch (_) { _secrets = {}; }
}

function _saveSecrets() {
    if (!_secretsPath) return;
    try {
        fs.mkdirSync(path.dirname(_secretsPath), { recursive: true });
        fs.writeFileSync(_secretsPath, JSON.stringify(_secrets), 'utf8');
    } catch (_) { /* non-fatal */ }
}

const configStore = {
    /** Initialize from Electron app. Call once in main process. */
    init(userDataPath) {
        if (_store) return _store;

        // electron-store requires the app to be ready
        if (Store) {
            _store = new Store({
                name: 'deepcopilot-config',
                defaults: DEFAULTS,
            });
        } else {
            // Fallback for non-Electron or early init
            const configPath = path.join(userDataPath || path.join(process.cwd(), '.deepcopilot'), 'config.json');
            let config = { ...DEFAULTS };
            try {
                if (fs.existsSync(configPath)) {
                    config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
                }
            } catch (_) {}
            _store = {
                _data: config,
                _path: configPath,
                get(key, def) { return key in this._data ? this._data[key] : def; },
                set(key, value) { this._data[key] = value; try { fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2), 'utf8'); } catch {} },
            };
        }

        _initSecrets(userDataPath || process.cwd());
        return _store;
    },

    // ── Config (public, like vscode.workspace.getConfiguration) ──

    get(key, defaultValue) {
        if (!_store) return defaultValue;
        return _store.get(key, defaultValue);
    },

    set(key, value) {
        if (!_store) return;
        _store.set(key, value);
    },

    getAll() {
        if (!_store) return { ...DEFAULTS };
        return _store.store || _store._data || {};
    },

    // ── Secrets ──

    getSecret(key) {
        return _secrets[key] || null;
    },

    setSecret(key, value) {
        _secrets[key] = value;
        _saveSecrets();
    },

    deleteSecret(key) {
        delete _secrets[key];
        _saveSecrets();
    },

    // ── Project directory ──

    getProjectDir() {
        return _projectDir || require('os').homedir();
    },

    setProjectDir(dir) {
        _projectDir = dir;
    },
};

module.exports = { configStore, DEFAULTS };
