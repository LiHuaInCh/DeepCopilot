// VS Code API shim for Electron.
// Provides the minimal VS Code API subset used by Deep Copilot source files,
// backed by Electron abstractions (config-store, logger, etc.).
'use strict';

const os = require('os');
const path = require('path');

function _app() { return global.__deepcopilot || {}; }

const workspace = {
    getConfiguration(section) {
        const cfg = _app().configStore;
        return {
            get(key, defaultValue) {
                if (cfg) return cfg.get(key, defaultValue);
                return defaultValue;
            },
            update(key, value) {
                if (cfg) cfg.set(key, value);
                return Promise.resolve();
            },
        };
    },
    get workspaceFolders() {
        const dir = _app().configStore ? _app().configStore.getProjectDir() : os.homedir();
        return [{ uri: { fsPath: dir }, name: path.basename(dir), index: 0 }];
    },
    get fs() {
        return {
            stat: async (uri) => {
                const fs = require('fs');
                const p = typeof uri === 'string' ? uri : (uri && uri.fsPath);
                try { return await fs.promises.stat(p); } catch (e) { throw e; }
            },
        };
    },
};

const window = {
    createOutputChannel(name) {
        const { Logger } = _app();
        return {
            appendLine(line) { if (Logger) Logger.info('OUTPUT', line); else console.log('[' + name + ']', line); },
            show() {},
            hide() {},
            dispose() {},
        };
    },
    async showWarningMessage(message, ...buttons) {
        const cb = _app().onShowWarning;
        if (cb) return cb(message, ...buttons);
        return buttons[0] || undefined;
    },
    async showInformationMessage(message, ...buttons) {
        const cb = _app().onShowInfo;
        if (cb) return cb(message, ...buttons);
        return buttons[0] || undefined;
    },
};

const env = {
    get language() {
        const lc = process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL || process.env.LC_MESSAGES || 'en';
        return lc;
    },
    async openExternal(uri) {
        const { shell } = require('electron');
        await shell.openExternal(typeof uri === 'string' ? uri : uri.toString());
    },
};

const Uri = {
    file(p) { return { fsPath: p, path: p, scheme: 'file' }; },
    joinPath(base, ...segments) {
        const basePath = typeof base === 'string' ? base : (base.fsPath || base.path || '');
        return { fsPath: path.join(basePath, ...segments), scheme: 'file' };
    },
    parse(p) { return { fsPath: p, scheme: 'file' }; },
};

class ExtensionContext {
    constructor() {
        this.globalState = {
            _data: {},
            get(key, defaultValue) {
                const cfg = _app().configStore;
                if (cfg) return cfg.get(key, defaultValue);
                return this._data[key] !== undefined ? this._data[key] : defaultValue;
            },
            update(key, value) {
                const cfg = _app().configStore;
                if (cfg) { cfg.set(key, value); return Promise.resolve(); }
                this._data[key] = value;
                return Promise.resolve();
            },
        };
        this.secrets = {
            get(key) {
                const cfg = _app().configStore;
                if (cfg) return Promise.resolve(cfg.getSecret(key));
                return Promise.resolve(null);
            },
            store(key, value) {
                const cfg = _app().configStore;
                if (cfg) cfg.setSecret(key, value);
                return Promise.resolve();
            },
            delete(key) {
                const cfg = _app().configStore;
                if (cfg) cfg.deleteSecret(key);
                return Promise.resolve();
            },
        };
        this.globalStorageUri = { fsPath: os.tmpdir() };
        this.extensionUri = { fsPath: path.join(__dirname, '..') };
    }
}

const languages = {
    getDiagnostics(uri) {
        return [];
    },
};

module.exports = {
    window,
    workspace,
    env,
    Uri,
    ExtensionContext,
    languages,
};
