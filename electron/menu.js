// Application menu for Deep Copilot Desktop.
// Auto-detects system language for Chinese / English labels.
'use strict';

const { Menu, shell, dialog, app } = require('electron');

function isZh() {
    const locale = app.getLocale();
    if (locale && locale.startsWith('zh')) return true;
    const lc = process.env.LANG || process.env.LANGUAGE || process.env.LC_ALL || '';
    if (lc.startsWith('zh')) return true;
    return false;
}

const zh = isZh();

function L(zhText, enText) {
    return zh ? zhText : enText;
}

function buildMenu(mainWindow, configStore) {
    const isMac = process.platform === 'darwin';

    const template = [
        ...(isMac ? [{
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
            ],
        }] : []),
        {
            label: L('文件(&F)', '&File'),
            submenu: [
                {
                    label: L('打开项目...(&O)', '&Open Project...'),
                    accelerator: 'CmdOrCtrl+O',
                    click: async () => {
                        const result = await dialog.showOpenDialog(mainWindow, {
                            properties: ['openDirectory'],
                            title: L('选择项目文件夹', 'Open Project Folder'),
                        });
                        if (!result.canceled && result.filePaths[0]) {
                            configStore.setProjectDir(result.filePaths[0]);
                            mainWindow.webContents.send('main:message', {
                                type: 'projectChanged',
                                projectDir: result.filePaths[0],
                            });
                        }
                    },
                },
                { type: 'separator' },
                {
                    label: L('新建会话(&N)', '&New Session'),
                    accelerator: 'CmdOrCtrl+Shift+N',
                    click: () => {
                        mainWindow.webContents.send('main:message', { type: 'sessionNew' });
                    },
                },
                { type: 'separator' },
                {
                    label: L('设置(&S)...', '&Settings...'),
                    accelerator: 'CmdOrCtrl+,',
                    click: () => {
                        mainWindow.webContents.send('main:message', { type: 'openSettings' });
                    },
                },
                { type: 'separator' },
                isMac ? { role: 'close' } : {
                    label: L('退出(&X)', '&Quit'),
                    accelerator: 'Alt+F4',
                    role: 'quit',
                },
            ],
        },
        {
            label: L('编辑(&E)', '&Edit'),
            submenu: [
                {
                    label: L('撤销(&U)', '&Undo'),
                    accelerator: 'CmdOrCtrl+Z',
                    role: 'undo',
                },
                {
                    label: L('重做(&R)', '&Redo'),
                    accelerator: 'CmdOrCtrl+Shift+Z',
                    role: 'redo',
                },
                { type: 'separator' },
                {
                    label: L('剪切(&T)', 'Cu&t'),
                    accelerator: 'CmdOrCtrl+X',
                    role: 'cut',
                },
                {
                    label: L('复制(&C)', '&Copy'),
                    accelerator: 'CmdOrCtrl+C',
                    role: 'copy',
                },
                {
                    label: L('粘贴(&P)', '&Paste'),
                    accelerator: 'CmdOrCtrl+V',
                    role: 'paste',
                },
                {
                    label: L('全选(&A)', 'Select &All'),
                    accelerator: 'CmdOrCtrl+A',
                    role: 'selectAll',
                },
            ],
        },
        {
            label: L('查看(&V)', '&View'),
            submenu: [
                {
                    label: L('切换深色/浅色/系统主题(&T)', '&Toggle Dark/Light/System Theme'),
                    accelerator: 'CmdOrCtrl+Shift+T',
                    click: () => {
                        const cur = configStore.get('theme', 'system');
                        const next = cur === 'dark' ? 'light' : cur === 'light' ? 'system' : 'dark';
                        configStore.set('theme', next);
                        const { nativeTheme } = require('electron');
                        const themeName = next === 'system'
                            ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
                            : next;
                        mainWindow.webContents.send('main:message', { type: 'themeChanged', theme: themeName });
                    },
                },
                { type: 'separator' },
                {
                    label: L('放大(&I)', 'Zoom &In'),
                    accelerator: 'CmdOrCtrl+Plus',
                    role: 'zoomIn',
                },
                {
                    label: L('缩小(&O)', 'Zoom &Out'),
                    accelerator: 'CmdOrCtrl+-',
                    role: 'zoomOut',
                },
                {
                    label: L('重置缩放(&R)', '&Reset Zoom'),
                    accelerator: 'CmdOrCtrl+0',
                    role: 'resetZoom',
                },
                {
                    label: L('全屏(&F)', 'Toggle &Full Screen'),
                    accelerator: 'F11',
                    role: 'togglefullscreen',
                },
                { type: 'separator' },
                {
                    label: L('开发者工具(&D)', 'Toggle &Developer Tools'),
                    accelerator: 'CmdOrCtrl+Shift+I',
                    role: 'toggleDevTools',
                },
            ],
        },
        {
            label: L('帮助(&H)', '&Help'),
            submenu: [
                {
                    label: L('Deep Copilot 项目主页', 'Deep Copilot on GitHub'),
                    click: () => shell.openExternal('https://github.com/ZhouChaunge/DeepCopilot'),
                },
                { type: 'separator' },
                {
                    label: L('打开日志文件夹', 'Open Logs Folder'),
                    click: () => {
                        const { Logger } = require('./logger');
                        const fp = Logger.getFilePath();
                        if (fp) shell.showItemInFolder(fp);
                    },
                },
                { type: 'separator' },
                {
                    label: L('关于(&A)', '&About'),
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: L('关于 Deep Copilot Desktop', 'About Deep Copilot Desktop'),
                            message: 'Deep Copilot Desktop v0.1.0',
                            detail: L(
                                'AI 编程助手，基于 DeepSeek V4 驱动。\nVS Code 扩展的 Electron 桌面移植版。',
                                'AI coding agent powered by DeepSeek V4.\nElectron desktop port of the VS Code extension.'
                            ),
                        });
                    },
                },
            ],
        },
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

module.exports = { buildMenu };
