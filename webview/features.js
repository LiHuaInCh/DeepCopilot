// Deep Copilot Desktop — UI enhancements.
// Requires window.electronAPI (via preload.js). Load after chat.js.
(function(){
  var eapi = window.electronAPI;
  if (!eapi || !eapi.isElectron) return;

  var projectDir = '';

  // Init: get project dir
  eapi.getProjectDir().then(function(d) { projectDir = d || ''; });

  function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function escAttr(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

  // ======================================================================
  // 1. THEME — listen for theme changes from main process
  // ======================================================================
  function applyTheme(name) {
    console.log('[theme] applying:', name);
    if (name === 'light') {
      document.body.classList.add('light');
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.body.classList.remove('light');
      document.documentElement.removeAttribute('data-theme');
    }
  }

  // Listen for theme changes from main process
  eapi.onMessage(function(m) {
    if (m && m.type === 'themeChanged') applyTheme(m.theme);
  });

  // ======================================================================
  // 2. DRAG & DROP — files into composer
  // ======================================================================
  (function(){
    var overlay = null;
    var dragCounter = 0;

    function showOverlay() {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'drag-overlay';
        overlay.innerHTML = '<div class="drag-hint"><span>📂</span> 拖放文件到此处</div>';
        document.body.appendChild(overlay);
      }
      overlay.style.display = 'flex';
    }
    function hideOverlay() {
      if (overlay) overlay.style.display = 'none';
    }

    // Use window-level listeners to catch all drag events
    window.addEventListener('dragenter', function(e) {
      e.preventDefault(); e.stopPropagation();
      dragCounter++;
      if (dragCounter === 1) showOverlay();
    });
    window.addEventListener('dragleave', function(e) {
      e.preventDefault(); e.stopPropagation();
      dragCounter--;
      if (dragCounter <= 0) { dragCounter = 0; hideOverlay(); }
    });
    window.addEventListener('dragover', function(e) {
      e.preventDefault(); e.stopPropagation();
    });
    window.addEventListener('drop', function(e) {
      e.preventDefault(); e.stopPropagation();
      dragCounter = 0;
      hideOverlay();
      var inp = document.getElementById('inp');
      if (!inp) return;
      var dt = e.dataTransfer;
      if (!dt || !dt.files || !dt.files.length) return;

      Array.from(dt.files).forEach(function(f) {
        console.log('[drag] file:', f.name, 'size:', f.size);

        // Only accept text files
        var ext = (f.name.match(/\.(\w+)$/) || [,''])[1].toLowerCase();
        var TEXT_EXTS = ['js','ts','jsx','tsx','py','rb','go','rs','java','c','cpp','h','hpp','cs','swift','kt',
          'txt','md','markdown','json','yaml','yml','toml','xml','html','css','scss','less','vue','svelte',
          'sh','bash','zsh','bat','cmd','ps1','ini','cfg','conf','log','env','gitignore','dockerfile',
          'sql','graphql','proto','r','m','mm','pl','php','lua','dart','ex','exs','erl','hrl','hs','ml',
          'makefile','cmake','gradle','lock','editorconfig','eslintrc','prettierrc'];
        var hasExt = ext.length > 0;
        var NO_EXT_OK = ['Makefile','Dockerfile','Gemfile','Rakefile','Vagrantfile','Procfile','Jenkinsfile',
          'LICENSE','README','CHANGELOG','CONTRIBUTING','NOTICE','AUTHORS'];
        if (hasExt && TEXT_EXTS.indexOf(ext) === -1) {
          console.log('[drag] unsupported file type:', ext);
          return;
        }
        if (!hasExt && NO_EXT_OK.indexOf(f.name) === -1) {
          console.log('[drag] skipping unknown no-ext file:', f.name);
          return;
        }
        // Reject large files
        if (f.size > 512 * 1024) {
          console.log('[drag] file too large:', f.name);
          return;
        }

        function insertContent(content) {
          if (!content || content.startsWith('Error') || content.startsWith('[File too')) return;
          var prefix = inp.value ? '\n\n' : '';
          var lang = ext || '';
          inp.value += prefix + '📄 ' + f.name + ':\n```' + lang + '\n' + content.slice(0, 8000) + '\n```\n';
          inp.dispatchEvent(new Event('input', {bubbles: true}));
          inp.style.height = 'auto';
          inp.style.height = Math.min(inp.scrollHeight || 100, 200) + 'px';
        }

        var filePath = f.path || '';
        if (filePath) {
          eapi.readFile(filePath).then(insertContent).catch(function(err) {
            console.log('[drag] IPC read failed, trying FileReader:', err);
            readWithFileReader(f, insertContent);
          });
        } else {
          readWithFileReader(f, insertContent);
        }
      });

      function readWithFileReader(file, callback) {
        if (file.size > 512 * 1024) {
          console.log('[drag] file too large:', file.name);
          return;
        }
        var reader = new FileReader();
        reader.onload = function() { callback(reader.result); };
        reader.onerror = function() { console.log('[drag] FileReader error'); };
        reader.readAsText(file);
      }
    });
  })();

  // ======================================================================
  // 3. FILE TREE — left sidebar
  // ======================================================================
  (function(){
    var ftBody = null;
    function init() {
      var left = document.getElementById('left');
      if (!left) return setTimeout(init, 500);
      // Create file tree section
      var sec = document.createElement('section');
      sec.className = 'pnl';
      sec.id = 'fileTreePnl';
      sec.setAttribute('data-open', '1');
      sec.innerHTML = '<div class="ph" id="ftHdr"><span class="pchev">▾</span> 文件</div>' +
        '<div class="pb" id="ftBody" style="max-height:300px;overflow-y:auto;overflow-x:hidden;font-size:12px"></div>';
      left.insertBefore(sec, left.firstChild);

      ftBody = document.getElementById('ftBody');
      document.getElementById('ftHdr').addEventListener('click', function() {
        var open = sec.getAttribute('data-open') === '1';
        sec.setAttribute('data-open', open ? '0' : '1');
        var c = this.querySelector('.pchev');
        if (c) c.textContent = open ? '▸' : '▾';
        ftBody.style.display = open ? 'none' : '';
      });

      loadDir(projectDir || '');
    }

    async function loadDir(dir) {
      if (!ftBody) return;
      var d = dir || projectDir || await eapi.getProjectDir();
      projectDir = d;
      var sep = d.includes('/') && !d.includes('\\') ? '/' : '\\';
      var entries = await eapi.listDir(d);
      var name = d.split(/[\\/]/).filter(Boolean).pop() || d;
      var h = '';
      // Parent directory ("..") — not shown at drive root
      var parts = d.split(/[\\/]/).filter(Boolean);
      var parent = parts.length > 1 ? parts.slice(0, -1).join(sep) : '';
      if (parent && parent !== d) {
        h += '<div class="ft-item" style="padding:3px 8px;cursor:pointer;border-radius:3px;color:var(--vscode-descriptionForeground,#888)" data-path="' + escAttr(parent) + '" data-dir="1">📂 ..</div>';
      }
      h += '<div class="ft-item" style="padding:3px 8px;cursor:pointer;font-weight:600;color:var(--vscode-textLink-foreground,#3794ff);border-radius:3px" data-path="' + escAttr(d) + '" data-dir="1">📁 ' + escHtml(name) + '</div>';
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var fp = d + sep + e.name;
        var icon = e.isDirectory ? '📁' : '📄';
        h += '<div class="ft-item" style="padding:2px 8px 2px 24px;cursor:pointer;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" data-path="' + escAttr(fp) + '" data-dir="' + (e.isDirectory ? '1' : '0') + '" title="' + escAttr(e.name) + '">' + icon + ' ' + escHtml(e.name) + '</div>';
      }
      ftBody.innerHTML = h;
      _bindTreeClicks(ftBody);
    }

    function _bindTreeClicks(container) {
      container.querySelectorAll('.ft-item').forEach(function(el) {
        el.addEventListener('click', async function(ev) {
          ev.stopPropagation();
          var p = el.getAttribute('data-path');
          if (el.getAttribute('data-dir') === '1') {
            loadDir(p);
          } else {
            var content = await eapi.readFile(p);
            if (!content || content.startsWith('Error') || content.startsWith('[File too')) return;
            var inp = document.getElementById('inp');
            if (!inp) return;
            var lang = (p.match(/\.(\w+)$/) || [,''])[1];
            inp.value = '📄 ' + p.split(/[\\/]/).pop() + ':\n```' + lang + '\n' + content.slice(0, 8000) + '\n```';
            var ev = new Event('input', {bubbles: true});
            inp.dispatchEvent(ev);
            if (inp.style) { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight || 100, 200) + 'px'; }
          }
        });
      });
    }

    init();
  })();

  // ======================================================================
  // 4. EXPORT chat — button in footer
  // ======================================================================
  (function(){
    function init() {
      var foot = document.getElementById('foot');
      if (!foot) return setTimeout(init, 1000);
      var ftRight = foot.querySelector('.ft-right');
      if (!ftRight) return;

      var btn = document.createElement('span');
      btn.className = 'pill';
      btn.id = 'exportBtn';
      btn.style.cssText = 'cursor:pointer;margin-left:6px';
      btn.title = '导出对话为 Markdown 文件';
      btn.textContent = '📥';
      btn.addEventListener('click', async function() {
        var msgs = document.querySelectorAll('.msgU, .msgA');
        var md = '# Deep Copilot 对话记录\n\n';
        var d = new Date();
        md += '> 导出时间: ' + d.toISOString() + '\n\n---\n\n';
        msgs.forEach(function(el) {
          if (el.classList.contains('msgU')) {
            md += '### 👤 用户\n\n' + (el.textContent || '').trim() + '\n\n';
          } else {
            md += '### 🤖 AI\n\n' + (el.textContent || '').trim() + '\n\n---\n\n';
          }
        });
        var name = 'chat-' + d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0') + '.md';
        var ok = await eapi.exportChat(md, name);
        if (ok) {
          var sb = document.getElementById('sb');
          if (sb) { sb.textContent = '✅ 已导出'; sb.style.display = 'block'; }
        }
      });
      ftRight.insertBefore(btn, ftRight.firstChild);
    }
    init();
  })();

})();
