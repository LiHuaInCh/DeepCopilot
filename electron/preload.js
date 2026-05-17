// Preload script — bridges renderer ↔ main process.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

console.log('[DeepCopilot] preload.js loaded, exposing electronAPI...');

let _state = {};

try {
    contextBridge.exposeInMainWorld('electronAPI', {
        // ── VS Code-compatible ──
        postMessage(msg) {
            ipcRenderer.send('webview:message', msg);
        },
        getState() { return _state; },
        setState(state) { _state = state; },
        onMessage(callback) {
            const handler = (_event, msg) => callback(msg);
            ipcRenderer.on('main:message', handler);
            return () => ipcRenderer.removeListener('main:message', handler);
        },

        // ── Native shortcuts ──
        openFile(filePath, line) { return ipcRenderer.invoke('app:openFile', filePath, line); },
        openExternal(url) { return ipcRenderer.invoke('app:openExternal', url); },
        showDialog(opts) { return ipcRenderer.invoke('app:showDialog', opts); },
        getConfig(key) { return ipcRenderer.invoke('config:get', key); },
        setConfig(key, value) { return ipcRenderer.invoke('config:set', key, value); },
        getSecret(key) { return ipcRenderer.invoke('config:getSecret', key); },
        setSecret(key, value) { return ipcRenderer.invoke('config:setSecret', key, value); },
        copyToClipboard(text) { return ipcRenderer.invoke('app:copyToClipboard', text); },
        getProjectDir() { return ipcRenderer.invoke('app:getProjectDir'); },
        setProjectDir(dir) { return ipcRenderer.invoke('app:setProjectDir', dir); },

        // ── File system ──
        listDir(dirPath) { return ipcRenderer.invoke('fs:listDir', dirPath); },
        readFile(path) { return ipcRenderer.invoke('fs:readFile', path); },
        exportChat(content, name) { return ipcRenderer.invoke('app:exportChat', content, name); },

        // ── Platform info ──
        platform: process.platform,
        isElectron: true,
    });

    console.log('[DeepCopilot] electronAPI exposed successfully');
} catch (e) {
    console.error('[DeepCopilot] Failed to expose electronAPI:', e.message);
}
