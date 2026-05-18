// Deep Copilot Desktop — Electron main process entry point.
'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, nativeTheme, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Early init ───────────────────────────────────────────────────────────
const { configStore, DEFAULTS } = require('./config-store');
const { Logger } = require('./logger');

const userDataPath = app.getPath('userData');
const logDir = path.join(userDataPath, 'logs');

configStore.init(userDataPath);
Logger.init(logDir, { enabled: configStore.get('enableDebugLog', true) });

// ── Locale ───────────────────────────────────────────────────────────────
// Robust Chinese locale detection
const appLocale = app.getLocale();
let isZh = appLocale && appLocale.startsWith('zh');
if (!isZh) {
    const lc = process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL || '';
    isZh = lc.startsWith('zh');
}
if (!isZh && process.platform === 'win32') {
    try {
        const out = require('child_process').execSync('chcp 2>&1', { encoding: 'utf8', timeout: 1000 });
        if (out.includes('936')) isZh = true;
    } catch {}
}

global.__deepcopilot = {
    configStore, Logger, locale: appLocale, isZh,
    onShowWarning: null, onShowInfo: null, onShowInput: null, onShowQuickPick: null,
};

// ── Agent bridge ─────────────────────────────────────────────────────────
const { AgentBridge } = require('./agent-bridge');

// ── State ────────────────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let isQuitting = false;

// ── System tray ─────────────────────────────────────────────────────────
function createTray() {
    if (tray) return;
    // Use native 16x16 icon — fallback to logo
    const iconPath = path.join(__dirname, '..', 'imgs', 'logo.png');
    try {
        tray = new Tray(iconPath);
        const ctx = Menu.buildFromTemplate([
            { label: isZh ? '显示/隐藏' : 'Show/Hide', click: toggleWindow },
            { type: 'separator' },
            { label: isZh ? '新建会话' : 'New Session', click: () => {
                if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
                AgentBridge.handleMessage({ type: 'sessionNew' });
            }},
            { type: 'separator' },
            { label: isZh ? '退出' : 'Quit', click: () => { isQuitting = true; app.quit(); }},
        ]);
        tray.setToolTip('Deep Copilot');
        tray.setContextMenu(ctx);
        tray.on('double-click', toggleWindow);
    } catch (e) {
        Logger.info('TRAY_FAILED', { error: e.message });
    }
}

function toggleWindow() {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
        mainWindow.hide();
    } else {
        mainWindow.show();
        mainWindow.focus();
    }
}

// ── Theme ────────────────────────────────────────────────────────────────
function applyTheme() {
    const stored = configStore.get('theme', 'system');
    let themeName;
    if (stored === 'system') {
        themeName = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    } else {
        themeName = stored;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('main:message', { type: 'themeChanged', theme: themeName });
    }
}

// ── Window ───────────────────────────────────────────────────────────────
function createWindow() {
    const bounds = configStore.get('windowBounds', { width: 1280, height: 860 });
    const isMaximized = configStore.get('windowMaximized', false);

    mainWindow = new BrowserWindow({
        width: bounds.width, height: bounds.height,
        minWidth: 800, minHeight: 500,
        x: bounds.x, y: bounds.y,
        title: 'Deep Copilot',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
        },
        show: false,
        backgroundColor: '#1e1e1e',
    });

    if (isMaximized) mainWindow.maximize();

    mainWindow.loadFile(path.join(__dirname, '..', 'webview', 'index.html'));

    mainWindow.webContents.on('console-message', (_e, level, message) => {
        const levels = ['V', 'I', 'W', 'E'];
        Logger.info('RENDERER_' + (levels[level] || '?'), message);
    });

    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
        Logger.info('LOAD_FAIL', { code, desc, url });
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        applyTheme();
    });

    // Minimize to tray instead of closing
    mainWindow.on('close', (e) => {
        const bounds = mainWindow.getBounds();
        configStore.set('windowBounds', { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
        configStore.set('windowMaximized', mainWindow.isMaximized());
        if (!isQuitting && tray) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => { mainWindow = null; });

    const { buildMenu } = require('./menu');
    buildMenu(mainWindow, configStore);
}

// ── IPC Handlers ─────────────────────────────────────────────────────────
function registerIpcHandlers() {
    ipcMain.on('webview:message', async (_event, msg) => {
        Logger.info('IPC_MAIN_RECV', { type: msg && msg.type });
        try {
            await AgentBridge.handleMessage(msg);
        } catch (e) {
            Logger.info('IPC_HANDLER_ERROR', { type: msg && msg.type, error: e.message });
            if (mainWindow) mainWindow.webContents.send('main:message', { type: 'error', text: e.message || 'Unknown error' });
        }
    });

    ipcMain.handle('config:get', (_e, key) => configStore.get(key));
    ipcMain.handle('config:set', (_e, key, value) => configStore.set(key, value));
    ipcMain.handle('config:getSecret', (_e, key) => configStore.getSecret(key));
    ipcMain.handle('config:setSecret', (_e, key, value) => configStore.setSecret(key, value));

    ipcMain.handle('app:openFile', async (_e, filePath, line) => {
        try { await shell.openPath(filePath); } catch {}
    });

    ipcMain.handle('app:openExternal', async (_e, url) => { await shell.openExternal(url); });
    ipcMain.handle('app:copyToClipboard', (_e, text) => { clipboard.writeText(text); });

    // ── File tree ──
    ipcMain.handle('fs:listDir', async (_e, dirPath) => {
        try {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            return entries
                .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
                .map(e => ({ name: e.name, isDirectory: e.isDirectory() }))
                .sort((a, b) => {
                    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
        } catch { return []; }
    });

    ipcMain.handle('fs:readFile', async (_e, filePath) => {
        try {
            const stat = await fs.promises.stat(filePath);
            if (stat.size > 512 * 1024) return '[File too large (>512KB)]';
            return await fs.promises.readFile(filePath, 'utf8');
        } catch (e) { return 'Error: ' + e.message; }
    });

    // ── Export ──
    ipcMain.handle('app:exportChat', async (_e, content, defaultName) => {
        if (!mainWindow) return;
        const result = await dialog.showSaveDialog(mainWindow, {
            title: isZh ? '导出对话' : 'Export Chat',
            defaultPath: defaultName || 'chat-export.md',
            filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
        if (!result.canceled && result.filePath) {
            try { fs.writeFileSync(result.filePath, content, 'utf8'); return true; }
            catch { return false; }
        }
        return false;
    });

    // ── Dialog ──
    ipcMain.handle('app:showDialog', async (_e, opts) => {
        if (!mainWindow) return;
        return dialog.showMessageBox(mainWindow, opts);
    });

    ipcMain.handle('app:getProjectDir', () => configStore.getProjectDir());
    ipcMain.handle('app:setProjectDir', async (_e, dir) => {
        configStore.setProjectDir(dir);
        if (mainWindow) mainWindow.webContents.send('main:message', { type: 'projectChanged', projectDir: dir });
    });

    ipcMain.handle('app:getTheme', () => configStore.get('theme', 'system'));
    ipcMain.handle('app:toggleTheme', () => {
        const cur = configStore.get('theme', 'system');
        const next = cur === 'dark' ? 'light' : cur === 'light' ? 'system' : 'dark';
        configStore.set('theme', next);
        applyTheme();
        return next;
    });
}

// ── Dialog callbacks ─────────────────────────────────────────────────────
function wireDialogCallbacks() {
    const zh = isZh;
    global.__deepcopilot.onShowWarning = async (message, ...buttons) => {
        if (!mainWindow) return;
        const r = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: zh ? 'Deep Copilot — 需要确认' : 'Deep Copilot — Approval Required',
            message: String(message),
            buttons: buttons.length ? buttons : (zh ? ['允许', '拒绝'] : ['Allow', 'Deny']),
            defaultId: 0, cancelId: (buttons.length || 2) - 1,
        });
        return buttons[r.response];
    };

    global.__deepcopilot.onShowInfo = async (message, ...buttons) => {
        if (!mainWindow) return;
        const r = await dialog.showMessageBox(mainWindow, {
            type: 'info', title: 'Deep Copilot', message: String(message),
            buttons: buttons.length ? buttons : ['OK'],
        });
        return buttons[r.response];
    };
}

// Catch unhandled errors for debugging
process.on('uncaughtException', (err) => {
    Logger.info('UNCAUGHT', { error: err.message, stack: String(err.stack||'').slice(0, 500) });
});
process.on('unhandledRejection', (reason) => {
    Logger.info('UNHANDLED', { reason: String(reason&&reason.message||reason).slice(0, 500) });
});

// ── App lifecycle ────────────────────────────────────────────────────────
app.whenReady().then(() => {
    Logger.info('APP_START', { version: app.getVersion(), platform: process.platform, locale: appLocale, isZh });

    wireDialogCallbacks();
    AgentBridge.init(_sendToRenderer);
    registerIpcHandlers();
    createWindow();
    createTray();

    // Auto theme follow
    nativeTheme.on('updated', () => {
        if (configStore.get('theme', 'system') === 'system') applyTheme();
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
        else if (!mainWindow.isVisible()) mainWindow.show();
    });

    // Auto-update (packaged only)
    if (app.isPackaged) {
        try {
            const { autoUpdater } = require('electron-updater');
            autoUpdater.autoDownload = false;
            autoUpdater.autoInstallOnAppQuit = true;
            autoUpdater.on('update-available', (info) => {
                dialog.showMessageBox(mainWindow, {
                    type: 'info',
                    title: isZh ? '发现新版本' : 'Update Available',
                    message: (isZh ? `新版本 ${info.version} 可用，是否下载？` : `Version ${info.version} available. Download?`),
                    buttons: [isZh ? '下载' : 'Download', isZh ? '稍后' : 'Later'],
                }).then(({ response }) => { if (response === 0) autoUpdater.downloadUpdate(); });
            });
            autoUpdater.on('update-downloaded', () => {
                dialog.showMessageBox(mainWindow, {
                    type: 'info', title: isZh ? '更新已下载' : 'Update Ready',
                    message: isZh ? '更新已下载，重启安装。' : 'Update downloaded. Restart to install.',
                    buttons: [isZh ? '立即重启' : 'Restart'],
                }).then(() => autoUpdater.quitAndInstall());
            });
            autoUpdater.on('error', (err) => Logger.info('UPDATE_ERROR', { error: err.message }));
            setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
        } catch (e) { Logger.info('UPDATE_INIT_FAILED', { error: e.message }); }
    }

    Logger.info('APP_READY', { projectDir: configStore.getProjectDir() });
});

app.on('before-quit', () => { isQuitting = true; Logger.info('APP_QUIT'); });

function _sendToRenderer(msg) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.webContents.send('main:message', msg); } catch {}
    }
}
