// AgentBridge — adapts AgentLoop, SessionStore, ToolExecutor to Electron IPC.
'use strict';

const os = require('os');
const fs = require('fs');

let vscodeShim;
try { vscodeShim = require('../src/vscode-shim'); } catch (_) {}

const { configStore } = require('./config-store');
const { Logger }      = require('./logger');

let AgentLoop, SessionStore, ToolExecutor;
let _store, _exec, _loop;

// In-memory runs map
const _runs = new Map();

function _ensureImports() {
    if (_store) return;
    AgentLoop      = require('../src/chat/agent-loop').AgentLoop;
    SessionStore   = require('../src/chat/session-store').SessionStore;
    ToolExecutor   = require('../src/chat/tool-executor').ToolExecutor;

    const context = new vscodeShim.ExtensionContext();

    _store = new SessionStore(context.globalState, {
        getCurrentWs: () => configStore.getProjectDir(),
        post:         (msg) => { if (_sendToRenderer) _sendToRenderer(msg); },
        getBusy:      (id)  => !!_runs.get(id)?.busy,
        onDeleteRun:  (id)  => {
            const run = _runs.get(id);
            if (run) { run.discarded = true; try { run.abortCtrl?.abort(); } catch {} _runs.delete(id); }
        },
    });

    _exec = new ToolExecutor(context, {
        postToRun: (run, msg) => _runPost(run, msg),
        post:      (msg)      => { if (_sendToRenderer) _sendToRenderer(msg); },
    });
}

let _sendToRenderer = null;

function setSendToRenderer(fn) {
    _sendToRenderer = fn;
}

function _runPost(run, msg) {
    run.events.push(msg);
    if (_sendToRenderer) _sendToRenderer(msg);
}

function _newRun(sessionId, seedMessages = []) {
    const run = {
        sessionId,
        messages:      seedMessages.length ? seedMessages.slice() : [],
        abortCtrl:     null,
        reply:         { user: '', asst: '', thoughts: '' },
        busy:          false,
        events:        [],
        toolCache:     new Map(),
        turnSnapshots: new Map(),
        plan:          null,
        planUpdatedIter: -1,
    };
    _runs.set(sessionId, run);
    return run;
}

// Auto-refresh balance helper
async function _autoRefreshBalance() {
    const { fetchBalance } = require('../src/api/deepseek');
    const apiKey = configStore.getSecret('deepseekAgent.apiKey');
    const baseUrl = configStore.get('apiBaseUrl') || 'https://api.deepseek.com';
    if (!apiKey || !baseUrl.includes('deepseek.com')) return;
    try {
        const balance = await fetchBalance({ apiKey, baseUrl });
        if (_sendToRenderer && balance) _sendToRenderer(Object.assign({ type: 'balanceUpdate' }, balance));
    } catch {}
}

const AgentBridge = {
    init(sendToRenderer) {
        _ensureImports();
        setSendToRenderer(sendToRenderer);

        // Initialize the AgentLoop with DI callbacks
        _loop = new AgentLoop({
            context:          new vscodeShim.ExtensionContext(),
            store:            _store,
            exec:             _exec,
            getRun:           (sid) => _runs.get(sid),
            newRun:           (sid, seed) => _newRun(sid, seed),
            deleteRun:        (sid) => { const r = _runs.get(sid); if (r) { r.discarded = true; try { r.abortCtrl?.abort(); } catch {} } _runs.delete(sid); },
            postToRun:        (run, msg) => _runPost(run, msg),
            post:             (msg) => {
                if (_sendToRenderer) _sendToRenderer(msg);
                if (msg && msg.type === 'replyEnd') _autoRefreshBalance();
            },
            postSessionList:  () => { if (_store) _store.postList(); },
            buildAttachment:  () => null,
            getIncludeCtx:    () => false,
        });

        // Auto-refresh balance on startup
        _autoRefreshBalance();

        Logger.info('AGENT_BRIDGE_READY');
    },

    // ── Message dispatch from renderer ──

    async handleMessage(msg) {
        Logger.info('IPC_RECV', { type: msg && msg.type });
        _ensureImports();
        switch (msg.type) {
            case 'send': {
                if (!_loop) {
                    if (_sendToRenderer) _sendToRenderer({ type: 'error', title: 'Not initialized', text: 'Agent not ready. Set up your API key first.' });
                    return;
                }
                const text = msg.text || '';
                const attachments = msg.attachments || [];
                const skillName = msg.skillName || null;

                let skillContent = null;
                if (skillName) {
                    try {
                        const { discoverSkills } = require('../src/skills');
                        const skills = discoverSkills();
                        const skill = skills.find(s => s.name === skillName);
                        if (skill) skillContent = skill;
                    } catch (e) { Logger.info('SKILL_LOAD_FAILED', { name: skillName, msg: e.message }); }
                }

                return _loop.handleSend(text, attachments, skillContent);
            }
            case 'stop': {
                const sid = _store ? _store.sessionId : null;
                const run = sid ? _runs.get(sid) : null;
                if (run && run.abortCtrl) {
                    try { run.abortCtrl.abort(); } catch {}
                    if (_sendToRenderer) _sendToRenderer({ type: 'stopped' });
                }
                return;
            }
            case 'sessionNew': {
                // session-store.newSession() internally sends sessionLoaded + postList
                if (_store) await _store.newSession();
                return;
            }
            case 'sessionLoad': {
                // session-store.load() internally sends sessionLoaded + postList
                if (_store) await _store.load(msg.id);
                return;
            }
            case 'sessionDelete': {
                if (_store) { await _store.delete(msg.id); _store.postList(); }
                return;
            }
            case 'sessionRename': {
                if (_store) { await _store.rename(msg.id, msg.title); _store.postList(); }
                return;
            }
            case 'sessionPin': {
                if (_store) { await _store.pin(msg.id); _store.postList(); }
                return;
            }
            case 'sessionUnread': {
                if (_store) { await _store.unread(msg.id); _store.postList(); }
                return;
            }
            case 'sessionArchive': {
                if (_store) { await _store.archive(msg.id); _store.postList(); }
                return;
            }
            case 'sessionList': {
                if (_store) _store.postList();
                return;
            }
            case 'clear': {
                const sid = _store ? _store.sessionId : null;
                const run = sid ? _runs.get(sid) : null;
                if (run) {
                    run.messages = [];
                    run.reply = { user: '', asst: '', thoughts: '' };
                    run.plan = null;
                    if (_sendToRenderer) _sendToRenderer({ type: 'sessionLoaded', id: sid, messages: [] });
                }
                return;
            }
            case 'ready': {
                const cfg = configStore;
                const model = cfg.get('defaultModel') || 'deepseek-v4-pro';
                const mode = cfg.get('approvalMode') || 'manual';
                const hasApiKey = !!cfg.getSecret('deepseekAgent.apiKey');

                if (_sendToRenderer) {
                    _sendToRenderer({ type: 'modelInfo', model, approvalMode: mode });
                    // If no API key, prompt to open settings
                    if (!hasApiKey) {
                        _sendToRenderer({ type: 'status', text: '请点击右下角 🔑 设置 DeepSeek API Key' });
                    }
                }
                if (_store) _store.postList();
                // Push skills
                try {
                    const { discoverSkills } = require('../src/skills');
                    const skills = discoverSkills().map(s => ({ name: s.name, desc: s.desc, hint: s.hint }));
                    if (skills.length && _sendToRenderer) _sendToRenderer({ type: 'skillList', skills });
                } catch {}
                return;
            }
            case 'setMode': {
                configStore.set('approvalMode', msg.mode);
                if (_sendToRenderer) _sendToRenderer({ type: 'modelInfo', approvalMode: msg.mode });
                return;
            }
            case 'setModel': {
                configStore.set('defaultModel', msg.model);
                if (_sendToRenderer) _sendToRenderer({ type: 'modelInfo', model: msg.model });
                return;
            }
            case 'openApiSettings': {
                const dsKey = configStore.getSecret('deepseekAgent.apiKey') || '';
                const tvKey = configStore.getSecret('deepseekAgent.tavilyKey') || '';
                const baseUrl = configStore.get('apiBaseUrl') || 'https://api.deepseek.com';
                const maskKey = (k) => k ? (k.slice(0, 6) + '...' + k.slice(-4)) : '';
                if (_sendToRenderer) {
                    _sendToRenderer({
                        type: 'settingsLoaded',
                        dsKeySet:   !!dsKey,
                        dsKeyHint:  maskKey(dsKey),
                        tvKeySet:   !!tvKey,
                        tvKeyHint:  maskKey(tvKey),
                        baseUrl:    baseUrl,
                    });
                }
                return;
            }
            case 'saveApiSettings': {
                if (msg.dsKey !== undefined) configStore.setSecret('deepseekAgent.apiKey', msg.dsKey);
                if (msg.tvKey !== undefined) configStore.setSecret('deepseekAgent.tavilyKey', msg.tvKey);
                if (msg.baseUrl !== undefined) configStore.set('apiBaseUrl', msg.baseUrl);
                Logger.info('API_SETTINGS_SAVED');
                return;
            }
            case 'testApiKey': {
                const { streamDeepSeek } = require('../src/api/deepseek');
                const which = msg.which === 'tv' ? 'tv' : 'ds';
                const key = which === 'tv'
                    ? (msg.key || configStore.getSecret('deepseekAgent.tavilyKey'))
                    : (msg.key || configStore.getSecret('deepseekAgent.apiKey'));
                const baseUrl = msg.baseUrl || configStore.get('apiBaseUrl') || 'https://api.deepseek.com';
                if (!key) {
                    if (_sendToRenderer) _sendToRenderer({ type: 'testApiKeyResult', which, ok: false, error: 'No key configured', latency: 0 });
                    return;
                }
                try {
                    if (which === 'tv') {
                        const https = require('https');
                        const t0 = Date.now();
                        const testResult = await new Promise((resolve) => {
                            const body = JSON.stringify({ query: 'test', max_results: 1 });
                            const req = https.request({
                                hostname: 'api.tavily.com',
                                path: '/search',
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
                                timeout: 10000,
                            }, (res) => {
                                let d = '';
                                res.on('data', c => d += c);
                                res.on('end', () => resolve(d));
                            });
                            req.on('error', () => resolve(''));
                            req.write(body);
                            req.end();
                        });
                        const ok = testResult.includes('results') && !testResult.includes('error');
                        const latency = Date.now() - t0;
                        if (_sendToRenderer) _sendToRenderer({ type: 'testApiKeyResult', which, ok, error: ok ? '' : 'Invalid key', latency });
                    } else {
                        const t0 = Date.now();
                        await streamDeepSeek({
                            apiKey: key,
                            baseUrl,
                            messages: [{ role: 'user', content: 'Hi' }],
                            model: 'deepseek-chat',
                            noTools: true,
                        }, { onDelta: () => {} }, null);
                        const latency = Date.now() - t0;
                        if (_sendToRenderer) _sendToRenderer({ type: 'testApiKeyResult', which: 'ds', ok: true, error: '', latency });
                    }
                } catch (e) {
                    if (_sendToRenderer) _sendToRenderer({ type: 'testApiKeyResult', which, ok: false, error: e.message, latency: 0 });
                }
                return;
            }
            case 'balanceRefresh': {
                const { fetchBalance } = require('../src/api/deepseek');
                const apiKey = configStore.getSecret('deepseekAgent.apiKey');
                const baseUrl = configStore.get('apiBaseUrl') || 'https://api.deepseek.com';
                if (apiKey && baseUrl.includes('deepseek.com')) {
                    try {
                        const balance = await fetchBalance({ apiKey, baseUrl });
                        if (_sendToRenderer && balance) _sendToRenderer(Object.assign({ type: 'balanceUpdate' }, balance));
                    } catch {}
                }
                return;
            }
            case 'feedback': {
                Logger.info('FEEDBACK', { type: msg.feedback, sessionId: _store?.sessionId });
                return;
            }
            case 'insert': {
                const { clipboard } = require('electron');
                clipboard.writeText(msg.code || '');
                if (_sendToRenderer) _sendToRenderer({ type: 'status', text: 'Copied to clipboard' });
                return;
            }
            case 'insertTerminal':
            case 'runTerminal': {
                if (_sendToRenderer) _sendToRenderer({ type: 'status', text: 'Terminal not available in standalone mode' });
                return;
            }
            case 'codeBlockApply': {
                const code = msg.code || '';
                const lang = msg.lang || 'txt';
                const tmpPath = os.tmpdir() + '/' + Date.now() + '-apply.' + lang;
                try { fs.writeFileSync(tmpPath, code, 'utf8'); } catch {}
                if (_sendToRenderer) _sendToRenderer({ type: 'status', text: 'Written to ' + tmpPath });
                return;
            }
            case 'codeBlockCreate': {
                const code = msg.code || '';
                const lang = msg.lang || 'txt';
                const tmpPath = os.tmpdir() + '/' + Date.now() + '-create.' + lang;
                try { fs.writeFileSync(tmpPath, code, 'utf8'); } catch {}
                if (_sendToRenderer) _sendToRenderer({ type: 'status', text: 'Saved to ' + tmpPath });
                return;
            }
            case 'copy': {
                const { clipboard } = require('electron');
                clipboard.writeText(msg.code || '');
                return;
            }
            case 'openExternal': {
                const { shell } = require('electron');
                shell.openExternal(msg.url || '');
                return;
            }
            case 'regenerate': {
                // Frontend (chat.js) already removed the DOM bubbles before sending this.
                // We just need to remove the last assistant message from run and session,
                // then re-send the last user message.
                const sid = _store ? _store.sessionId : null;
                const run = sid ? _runs.get(sid) : null;
                if (!run || !run.reply || !run.reply.user) return;

                const lastUserMsg = run.reply.user;

                // Remove last assistant message from run.messages
                for (let i = run.messages.length - 1; i >= 0; i--) {
                    if (run.messages[i].role === 'assistant') { run.messages.splice(i, 1); break; }
                }
                run.reply = { user: lastUserMsg, asst: '', thoughts: '' };

                // Also remove from session store
                if (_store) {
                    const list = _store.all();
                    const s = list.find(x => x.id === sid);
                    if (s && s.messages) {
                        for (let i = s.messages.length - 1; i >= 0; i--) {
                            if (s.messages[i].role === 'assistant') { s.messages.splice(i, 1); break; }
                        }
                        await _store.set(list);
                    }
                }

                run.busy = false;
                if (_loop) _loop.handleSend(lastUserMsg);
                return;
            }
            case 'editUserSubmit': {
                const sid = _store ? _store.sessionId : null;
                const run = sid ? _runs.get(sid) : null;
                if (run && msg.index !== undefined && msg.text) {
                    const idx = Number(msg.index);
                    let userCount = 0;
                    for (let i = 0; i < run.messages.length; i++) {
                        if (run.messages[i].role === 'user') {
                            if (userCount === idx) {
                                run.messages.length = i;
                                break;
                            }
                            userCount++;
                        }
                    }
                    return _loop?.handleSend(msg.text);
                }
                return;
            }
            case 'openFile': {
                const { shell } = require('electron');
                const p = msg.path || '';
                if (p) shell.openPath(p);
                return;
            }
            case 'contextToggle': {
                if (_sendToRenderer) _sendToRenderer({ type: 'status', text: 'Context toggle not available in standalone mode' });
                return;
            }
            case 'fileSearch': {
                try {
                    const glob = require('glob');
                    const q = msg.query || '';
                    const dir = configStore.getProjectDir();
                    const results = glob.sync('**/*' + q + '*', { cwd: dir, nodir: true, maxResults: 20 });
                    if (_sendToRenderer) _sendToRenderer({ type: 'fileSearchResults', results });
                } catch {}
                return;
            }
            case 'fileContent': {
                try {
                    const p = msg.path ? require('path').resolve(configStore.getProjectDir(), msg.path) : '';
                    const content = p ? fs.readFileSync(p, 'utf8') : '';
                    if (_sendToRenderer) _sendToRenderer({ type: 'fileContentResult', path: msg.path, content });
                } catch {}
                return;
            }
            case 'approve': {
                Logger.info('APPROVE', { id: msg.id, decision: msg.decision });
                return;
            }
            default:
                Logger.info('UNHANDLED_MSG', { type: msg.type });
        }
    },

    get store() { return _store; },
    get loop() { return _loop; },
    get exec() { return _exec; },
};

module.exports = { AgentBridge };
