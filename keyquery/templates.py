INDEX_TEMPLATE = """
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KeyQuery</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body {
      margin: 0;
      background: #0f172a;
      color: #e2e8f0;
    }
    main {
      max-width: 1080px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    .card {
      background: rgba(15, 23, 42, 0.86);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 16px 60px rgba(15, 23, 42, 0.4);
      margin-bottom: 20px;
    }
    h1, h2 { margin-top: 0; }
    .grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    }
    .muted { color: #94a3b8; font-size: 14px; }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(37, 99, 235, 0.18);
      color: #93c5fd;
      border: 1px solid rgba(59, 130, 246, 0.3);
      font-size: 13px;
      margin-right: 8px;
    }
    .badge.success {
      background: rgba(22, 163, 74, 0.16);
      color: #86efac;
      border-color: rgba(74, 222, 128, 0.3);
    }
    .badge.warning {
      background: rgba(217, 119, 6, 0.16);
      color: #fcd34d;
      border-color: rgba(251, 191, 36, 0.3);
    }
    .badge.error {
      background: rgba(220, 38, 38, 0.16);
      color: #fca5a5;
      border-color: rgba(248, 113, 113, 0.3);
    }
    .error {
      display: none;
      color: #fecaca;
      white-space: pre-wrap;
      margin-top: 12px;
      padding: 12px;
      border-radius: 12px;
      border: 1px solid rgba(248, 113, 113, 0.35);
      background: rgba(127, 29, 29, 0.25);
    }
    .error:not(:empty) { display: block; }
    .success { color: #86efac; }
    .loading {
      display: none;
      margin-top: 12px;
      color: #bfdbfe;
    }
    .loading.active { display: block; }
    .qr-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 320px;
      border: 1px dashed rgba(148, 163, 184, 0.25);
      border-radius: 16px;
      background: rgba(2, 6, 23, 0.4);
    }
    .qr-wrap img {
      max-width: 320px;
      width: 100%;
      height: auto;
      image-rendering: pixelated;
      background: white;
      padding: 12px;
      border-radius: 12px;
    }
    button, input, textarea {
      box-sizing: border-box;
      width: 100%;
      border-radius: 10px;
      border: 1px solid rgba(148, 163, 184, 0.3);
      background: rgba(15, 23, 42, 0.9);
      color: inherit;
      font: inherit;
      padding: 10px 12px;
    }
    textarea { min-height: 120px; resize: vertical; }
    button {
      cursor: pointer;
      font-weight: 600;
      background: linear-gradient(135deg, #2563eb, #7c3aed);
      border: none;
      margin-top: 8px;
    }
    button.secondary {
      background: rgba(71, 85, 105, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.2);
    }
    .row { display: flex; gap: 12px; flex-wrap: wrap; }
    .row > * { flex: 1 1 180px; }
    .user-grid {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      margin-top: 12px;
    }
    .user-item {
      padding: 12px;
      border-radius: 12px;
      background: rgba(2, 6, 23, 0.35);
      border: 1px solid rgba(148, 163, 184, 0.15);
    }
    .user-item .label { color: #94a3b8; font-size: 13px; margin-bottom: 6px; }
    .claim-list {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }
    .claim-item {
      padding: 12px;
      border-radius: 12px;
      background: rgba(2, 6, 23, 0.35);
      border: 1px solid rgba(148, 163, 184, 0.15);
    }
    .claim-id { font-weight: 700; color: #93c5fd; word-break: break-all; }
    .claim-meta { color: #94a3b8; font-size: 13px; margin-top: 6px; }
    .claim-copy {
      width: auto;
      margin-top: 10px;
      padding: 8px 12px;
    }
    .helper {
      margin-top: 10px;
      color: #94a3b8;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <main>
    <div class="card">
      <h1>Key 申领与查询</h1>
      <p class="muted">天码x索奥 AI编程挑战赛</p>
      <div id="message" class="muted" style="margin-top: 8px;">{{ state.message }}</div>
      <div id="error" class="error">{{ state.error }}</div>
    </div>

    <div>
      <div id="auth-card" class="card" {% if state.user %}hidden{% endif %}>
        <h2>扫码认证</h2>
        <div class="row">
          <button id="start-button" type="button">生成二维码并开始认证</button>
          <button id="reset-button" class="secondary" type="button">重置当前流程</button>
        </div>
        <div id="loading" class="loading">正在生成二维码，请稍候。</div>
        <div style="height: 12px"></div>
        <div class="qr-wrap">
          <img id="qr-image" alt="扫码二维码" {% if state.qr_data_url %}src="{{ state.qr_data_url }}"{% else %}hidden{% endif %}>
          <div id="qr-placeholder" class="muted" {% if state.qr_data_url %}hidden{% endif %}>点击上方按钮生成二维码。</div>
        </div>
      </div>

      <div id="user-card" class="card" {% if not state.user %}hidden{% endif %}>
        <h2>用户信息</h2>
        <div id="user-panel">
          <div class="user-grid">
            <div class="user-item"><div class="label">姓名</div><div id="user-name">{{ state.user.user_name if state.user else '' }}</div></div>
            <div class="user-item"><div class="label">学号</div><div id="user-id">{{ state.user.user_id if state.user else '' }}</div></div>
            <div class="user-item"><div class="label">院系</div><div id="user-school">{{ state.user.user_school if state.user else '' }}</div></div>
            <div class="user-item"><div class="label">英文姓名 / 院系</div><div id="user-extra">{{ state.user.user_name_alt if state.user else '' }}{% if state.user and state.user.user_school_alt %} / {{ state.user.user_school_alt }}{% endif %}</div></div>
          </div>
        </div>
      </div>
    </div>

    <div class="card" id="claim-card" {% if not state.user %}hidden{% endif %}>
      <h2>Key 申领</h2>
      <div id="claim-summary" class="helper"></div>
      <div id="claim-list" class="claim-list"></div>
      <div class="row">
        <button id="claim-button" type="button">申领一个 Key</button>
      </div>
      <div id="claim-message" class="helper"></div>
    </div>
  </main>

  <script>
    const messageEl = document.getElementById("message");
    const errorEl = document.getElementById("error");
    const loadingEl = document.getElementById("loading");
    const qrImageEl = document.getElementById("qr-image");
    const qrPlaceholderEl = document.getElementById("qr-placeholder");
    const authCardEl = document.getElementById("auth-card");
    const userCardEl = document.getElementById("user-card");
    const userPanelEl = document.getElementById("user-panel");
    const userNameEl = document.getElementById("user-name");
    const userIdEl = document.getElementById("user-id");
    const userSchoolEl = document.getElementById("user-school");
    const userExtraEl = document.getElementById("user-extra");
    const claimCardEl = document.getElementById("claim-card");
    const claimSummaryEl = document.getElementById("claim-summary");
    const claimButtonEl = document.getElementById("claim-button");
    const claimMessageEl = document.getElementById("claim-message");
    const claimListEl = document.getElementById("claim-list");
    let currentRunId = {{ state.run_id }};

    function renderClaims(claims) {
      claimListEl.innerHTML = "";
      if (!claims || !claims.length) {
        claimListEl.innerHTML = '<div class="muted">当前还没有领取记录。</div>';
        return;
      }
      claimListEl.innerHTML = claims.map((claim) => `
        <div class="claim-item">
          <div class="claim-id">${claim.key_value}</div>
          <button class="claim-copy secondary" type="button" data-copy-key="${claim.key_value}">复制 Key</button>
          <div class="claim-meta">绑定时间：${claim.bound_at || '-'}</div>
        </div>
      `).join("");
      claimListEl.querySelectorAll('[data-copy-key]').forEach((button) => {
        button.addEventListener('click', async () => {
          await navigator.clipboard.writeText(button.dataset.copyKey || '');
          button.textContent = '已复制';
          setTimeout(() => { button.textContent = '复制 Key'; }, 1200);
        });
      });
    }

    function renderUser(data) {
      const user = data.user;
      if (user) {
        authCardEl.hidden = true;
        userCardEl.hidden = false;
        userPanelEl.hidden = false;
        claimCardEl.hidden = false;
        userNameEl.textContent = user.user_name || '';
        userIdEl.textContent = user.user_id || '';
        userSchoolEl.textContent = user.user_school || '';
        userExtraEl.textContent = [user.user_name_alt, user.user_school_alt].filter(Boolean).join(' / ');
      } else {
        authCardEl.hidden = false;
        userCardEl.hidden = true;
        userPanelEl.hidden = true;
        claimCardEl.hidden = true;
      }

      claimSummaryEl.textContent = user
        ? `已领取 ${data.claim_count} 个，最多可领取 ${data.claim_limit} 个，还可领取 ${data.remaining_count} 个。`
        : '';
      claimButtonEl.disabled = !data.can_claim;
      claimButtonEl.textContent = data.can_claim ? '申领一个 Key' : '当前不可继续申领';
      renderClaims(data.claims || []);
    }

    async function refresh() {
      const response = await fetch(`/api/status?run_id=${currentRunId}`);
      const data = await response.json();
      currentRunId = data.run_id;
      messageEl.textContent = data.message || '';
      errorEl.textContent = data.error || '';
      loadingEl.classList.toggle('active', data.status === 'starting' || data.status === 'authenticating');

      if (data.qr_data_url) {
        qrImageEl.src = data.qr_data_url;
        qrImageEl.hidden = false;
        qrPlaceholderEl.hidden = true;
      } else {
        qrImageEl.hidden = true;
        qrPlaceholderEl.hidden = false;
      }

      renderUser(data);
    }

    async function startAuth() {
      errorEl.textContent = '';
      messageEl.textContent = '正在生成二维码，请稍候。';
      loadingEl.classList.add('active');
      const response = await fetch('/api/auth/start', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        loadingEl.classList.remove('active');
        errorEl.textContent = data.error || '启动认证失败';
        return;
      }
      currentRunId = data.run_id;
      await refresh();
    }

    async function resetAuth() {
      await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: currentRunId }),
      });
      currentRunId = 0;
      await refresh();
    }

    async function claimKey() {
      const response = await fetch('/api/auth/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: currentRunId }),
      });
      const data = await response.json();
      claimMessageEl.textContent = data.message || data.error || '';
      if (!response.ok) {
        errorEl.textContent = data.error || '申领失败';
      } else {
        errorEl.textContent = '';
      }
      await refresh();
    }

    document.getElementById('start-button').addEventListener('click', startAuth);
    document.getElementById('reset-button').addEventListener('click', resetAuth);
    claimButtonEl.addEventListener('click', claimKey);

    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>
"""

ADMIN_TEMPLATE = """
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KeyQuery 管理员页面</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body {
      margin: 0;
      background: #0f172a;
      color: #e2e8f0;
    }
    main {
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    .card {
      background: rgba(15, 23, 42, 0.86);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 16px;
      padding: 20px;
      box-shadow: 0 16px 60px rgba(15, 23, 42, 0.4);
      margin-bottom: 20px;
    }
    h1, h2 { margin-top: 0; }
    .muted { color: #94a3b8; font-size: 14px; }
    button, input, textarea {
      box-sizing: border-box;
      width: 100%;
      border-radius: 10px;
      border: 1px solid rgba(148, 163, 184, 0.3);
      background: rgba(15, 23, 42, 0.9);
      color: inherit;
      font: inherit;
      padding: 10px 12px;
    }
    textarea { min-height: 120px; resize: vertical; }
    button {
      cursor: pointer;
      font-weight: 600;
      background: linear-gradient(135deg, #2563eb, #7c3aed);
      border: none;
      margin-top: 8px;
    }
    button.secondary {
      background: rgba(71, 85, 105, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.2);
    }
    .row { display: flex; gap: 12px; flex-wrap: wrap; }
    .row > * { flex: 1 1 160px; }
    .list-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 12px;
    }
    .filter-bar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .filter-bar a {
      width: auto;
      text-decoration: none;
      display: inline-block;
      margin-top: 0;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid rgba(148, 163, 184, 0.22);
      background: rgba(71, 85, 105, 0.45);
      color: inherit;
    }
    .filter-bar a.active {
      background: linear-gradient(135deg, #2563eb, #7c3aed);
      border-color: transparent;
    }
    .toolbar-button {
      width: auto;
      margin-top: 0;
      white-space: nowrap;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      font-size: 14px;
    }
    th, td {
      padding: 10px 8px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.15);
      vertical-align: top;
      text-align: left;
    }
    th { color: #cbd5e1; }
    .small { font-size: 12px; color: #94a3b8; }
    .error { color: #fca5a5; white-space: pre-wrap; }
    .success { color: #86efac; }
    .table-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: nowrap;
      min-width: 300px;
    }
    .table-actions form {
      margin: 0;
      flex: 0 0 auto;
    }
    .table-actions .action-link,
    .table-actions button {
      width: auto;
      margin-top: 0;
      white-space: nowrap;
    }
    .action-link {
      width: 100%;
      margin-top: 0;
      background: rgba(71, 85, 105, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.2);
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(2, 6, 23, 0.72);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      z-index: 50;
    }
    .modal-backdrop.open { display: flex; }
    .modal {
      width: min(560px, 100%);
      background: rgba(15, 23, 42, 0.98);
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 18px;
      padding: 20px;
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.6);
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }
    .modal-header h3 {
      margin: 0;
    }
    .modal-close {
      width: auto;
      margin: 0;
      padding: 8px 12px;
    }
    .modal-grid {
      display: grid;
      gap: 10px;
    }
  </style>
</head>
<body>
  <main>
    <div class="card">
      <h1>管理员页面</h1>
      <div id="flash" class="muted">{{ flash }}</div>
    </div>

    <div class="card">
      <h2>Key 列表</h2>
      <div class="muted">总数 {{ keys|length }}，未绑定 {{ available_count }}。</div>
      <div class="list-toolbar">
        <div class="filter-bar">
          <a class="{% if current_filter == 'all' %}active{% endif %}" href="/admin?code={{ admin_code }}&filter=all">全部</a>
          <a class="{% if current_filter == 'bound' %}active{% endif %}" href="/admin?code={{ admin_code }}&filter=bound">已绑定</a>
          <a class="{% if current_filter == 'unbound' %}active{% endif %}" href="/admin?code={{ admin_code }}&filter=unbound">未绑定</a>
        </div>
        <button id="import-modal-open" class="toolbar-button" type="button">批量新增 Key</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>序号</th>
            <th>Key 值</th>
            <th>绑定时间</th>
            <th>已绑定用户信息</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {% for key in keys %}
          <tr>
            <td>#{{ key.id }}</td>
            <td>{{ key.key_value }}</td>
            <td>{{ key.bound_at or '-' }}</td>
            <td>
              {% if key.bound_student_id %}
                <div>{{ key.bound_user_name }} / {{ key.bound_student_id }}</div>
                <div class="small">{{ key.bound_user_school }}{% if key.bound_user_school_alt %} / {{ key.bound_user_school_alt }}{% endif %}</div>
              {% else %}
                <span class="muted">未绑定</span>
              {% endif %}
            </td>
            <td>
              <div class="table-actions">
                {% if key.bound_student_id %}
                <form method="post" action="/admin/keys/{{ key.id }}/unbind">
                  <input type="hidden" name="code" value="{{ admin_code }}">
                  <button class="secondary" type="submit">解绑</button>
                </form>
                {% else %}
                <button
                  class="action-link"
                  type="button"
                  data-bind-button
                  data-key-id="{{ key.id }}"
                  data-key-value="{{ key.key_value }}"
                >
                  手动绑定
                </button>
                {% endif %}
                <form method="post" action="/admin/keys/{{ key.id }}/delete" onsubmit="return confirm('确定删除这个 Key 吗？');">
                  <input type="hidden" name="code" value="{{ admin_code }}">
                  <button class="secondary" type="submit">删除</button>
                </form>
              </div>
            </td>
          </tr>
          {% endfor %}
        </tbody>
      </table>
    </div>
  </main>

  <div id="import-modal" class="modal-backdrop" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="import-modal-title">
      <div class="modal-header">
        <h3 id="import-modal-title">批量新增 Key</h3>
        <button id="import-modal-close" class="modal-close secondary" type="button">关闭</button>
      </div>
      <form id="import-form" method="post" action="/admin/keys/import">
        <input type="hidden" name="code" value="{{ admin_code }}">
        <label class="muted" for="keys">每行一个 Key，支持粘贴多行。</label>
        <textarea id="keys" name="keys" placeholder="key-1\nkey-2\nkey-3"></textarea>
        <button type="submit">导入 Key</button>
      </form>
    </div>
  </div>

  <div id="bind-modal" class="modal-backdrop" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="bind-modal-title">
      <div class="modal-header">
        <h3 id="bind-modal-title">手动绑定 Key</h3>
        <button id="bind-modal-close" class="modal-close secondary" type="button">关闭</button>
      </div>
      <form id="bind-form" method="post">
        <input type="hidden" name="code" value="{{ admin_code }}">
        <div id="bind-key-hint" class="muted" style="margin-bottom: 10px;"></div>
        <div class="modal-grid">
          <input name="student_id" placeholder="学号">
          <input name="user_name" placeholder="姓名">
          <input name="user_name_alt" placeholder="英文姓名（可选）">
          <input name="user_school" placeholder="院系">
          <input name="user_school_alt" placeholder="英文院系（可选）">
        </div>
        <button type="submit">确认绑定</button>
      </form>
    </div>
  </div>

  <script>
    const importModal = document.getElementById('import-modal');
    const importOpen = document.getElementById('import-modal-open');
    const importClose = document.getElementById('import-modal-close');
    const importForm = document.getElementById('import-form');
    const bindModal = document.getElementById('bind-modal');
    const bindForm = document.getElementById('bind-form');
    const bindKeyHint = document.getElementById('bind-key-hint');
    const bindClose = document.getElementById('bind-modal-close');

    function openModal(modal) {
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
    }

    function closeModal(modal, form) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      if (form) {
        form.reset();
      }
    }

    function openBindModal(keyId, keyValue) {
      bindForm.action = `/admin/keys/${keyId}/bind`;
      bindKeyHint.textContent = `当前 Key：#${keyId} / ${keyValue}`;
      openModal(bindModal);
    }

    document.querySelectorAll('[data-bind-button]').forEach((button) => {
      button.addEventListener('click', () => {
        openBindModal(button.dataset.keyId, button.dataset.keyValue);
      });
    });

    importOpen.addEventListener('click', () => openModal(importModal));
    importClose.addEventListener('click', () => closeModal(importModal, importForm));
    bindClose.addEventListener('click', () => closeModal(bindModal, bindForm));
    importModal.addEventListener('click', (event) => {
      if (event.target === importModal) {
        closeModal(importModal, importForm);
      }
    });
    bindModal.addEventListener('click', (event) => {
      if (event.target === bindModal) {
        closeModal(bindModal, bindForm);
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (importModal.classList.contains('open')) {
          closeModal(importModal, importForm);
        }
        if (bindModal.classList.contains('open')) {
          closeModal(bindModal, bindForm);
        }
      }
    });
  </script>
</body>
</html>
"""
