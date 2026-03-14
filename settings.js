// ============================================
// Lark Web Saver — Settings Logic
// Tags CRUD + Webhook list CRUD
// ============================================

document.addEventListener('DOMContentLoaded', init);

const $ = (id) => document.getElementById(id);

// Default tags
const DEFAULT_TAGS = ['Tip', 'Tutorial', 'Template', 'News', 'Tool', 'Other'];

function init() {
  loadSettings();

  // Save & Clear
  $('btn-save').addEventListener('click', saveSettings);
  $('btn-clear').addEventListener('click', clearSettings);

  // Toggle password visibility
  $('toggle-secret-base').addEventListener('click', () => toggleVisibility('setting-app-secret'));
  $('toggle-secret').addEventListener('click', () => toggleVisibility('setting-sign-secret'));

  // Add tag
  $('btn-add-tag').addEventListener('click', addTag);
  $('new-tag-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTag(); });

  // Add webhook
  $('btn-add-webhook').addEventListener('click', addWebhook);
  $('new-webhook-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') addWebhook(); });
}

function toggleVisibility(inputId) {
  const input = $(inputId);
  input.type = input.type === 'password' ? 'text' : 'password';
}

// ===================== LOAD =====================
function loadSettings() {
  chrome.storage.local.get(
    ['appToken', 'tableId', 'appId', 'appSecret', 'signSecret', 'customTags', 'webhooks', 'sysUserId'],
    (data) => {
      let sysUserId = data.sysUserId;
      if (!sysUserId) {
        sysUserId = 'user_' + Math.random().toString(36).substr(2, 9);
        chrome.storage.local.set({ sysUserId });
      }

      $('setting-sys-user-id').value = sysUserId;
      $('setting-app-token').value = data.appToken || '';
      $('setting-table-id').value = data.tableId || '';
      $('setting-app-id').value = data.appId || '';
      $('setting-app-secret').value = data.appSecret || '';
      $('setting-sign-secret').value = data.signSecret || '';

      // Load tags (use defaults if none saved)
      const tags = data.customTags || DEFAULT_TAGS;
      renderTags(tags);

      // Load webhooks
      const webhooks = data.webhooks || [];
      renderWebhooks(webhooks);
    }
  );
}

// ===================== SAVE =====================
function saveSettings() {
  const tags = getTagsFromUI();
  const webhooks = getWebhooksFromUI();

  const settings = {
    appToken: $('setting-app-token').value.trim(),
    tableId: $('setting-table-id').value.trim(),
    appId: $('setting-app-id').value.trim(),
    appSecret: $('setting-app-secret').value.trim(),
    signSecret: $('setting-sign-secret').value.trim(),
    customTags: tags,
    webhooks: webhooks,
  };

  chrome.storage.local.remove(['cachedTenantToken', 'cachedTokenExpiry'], () => {
    chrome.storage.local.set(settings, () => {
      showStatus('success', '✅ Settings saved successfully!');
    });
  });
}

function clearSettings() {
  if (!confirm('Are you sure you want to clear all settings?')) return;

  chrome.storage.local.clear(() => {
    $('setting-app-token').value = '';
    $('setting-table-id').value = '';
    $('setting-app-id').value = '';
    $('setting-app-secret').value = '';
    $('setting-sign-secret').value = '';
    renderTags(DEFAULT_TAGS);
    renderWebhooks([]);
    showStatus('success', '🗑️ All settings cleared');
  });
}

// ===================== TAGS =====================
function renderTags(tags) {
  const list = $('tags-list');
  list.innerHTML = '';
  tags.forEach((tag, i) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.dataset.index = i;
    row.innerHTML = `
      <span class="item-label">🏷️ ${escapeHtml(tag)}</span>
      <div class="item-actions">
        <button class="btn-item-action btn-edit" title="Edit" data-action="edit-tag" data-index="${i}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-item-action btn-delete" title="Delete" data-action="delete-tag" data-index="${i}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `;
    list.appendChild(row);
  });

  // Delegate events
  list.onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index);
    if (btn.dataset.action === 'delete-tag') deleteTag(idx);
    if (btn.dataset.action === 'edit-tag') editTag(idx);
  };
}

function addTag() {
  const input = $('new-tag-name');
  const name = input.value.trim();
  if (!name) return;
  const tags = getTagsFromUI();
  if (tags.includes(name)) {
    showStatus('error', '⚠ Tag already exists');
    return;
  }
  tags.push(name);
  renderTags(tags);
  input.value = '';
  autoSaveLists();
}

function deleteTag(index) {
  const tags = getTagsFromUI();
  tags.splice(index, 1);
  renderTags(tags);
  autoSaveLists();
}

function editTag(index) {
  const tags = getTagsFromUI();
  const row = $('tags-list').children[index];
  const labelEl = row.querySelector('.item-label');
  const oldName = tags[index];

  // Replace label with input
  labelEl.innerHTML = `<input class="edit-input" type="text" value="${escapeHtml(oldName)}">`;
  const editInput = labelEl.querySelector('.edit-input');
  editInput.focus();
  editInput.select();

  const finishEdit = () => {
    const newName = editInput.value.trim();
    if (newName && newName !== oldName) {
      tags[index] = newName;
    }
    renderTags(tags);
    autoSaveLists();
  };

  editInput.addEventListener('blur', finishEdit);
  editInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finishEdit();
    if (e.key === 'Escape') { renderTags(tags); }
  });
}

function getTagsFromUI() {
  const list = $('tags-list');
  const tags = [];
  for (const row of list.children) {
    const editInput = row.querySelector('.edit-input');
    if (editInput) {
      tags.push(editInput.value.trim() || 'Untitled');
    } else {
      const label = row.querySelector('.item-label');
      // Remove emoji prefix
      tags.push(label.textContent.replace(/^🏷️\s*/, '').trim());
    }
  }
  return tags;
}

// ===================== WEBHOOKS =====================
function renderWebhooks(webhooks) {
  const list = $('webhooks-list');
  list.innerHTML = '';
  webhooks.forEach((wh, i) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.dataset.index = i;
    row.innerHTML = `
      <span class="item-name">${escapeHtml(wh.name)}</span>
      <span class="item-url" title="${escapeHtml(wh.url)}">${escapeHtml(wh.url)}</span>
      <div class="item-actions">
        <button class="btn-item-action btn-edit" title="Edit" data-action="edit-webhook" data-index="${i}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-item-action btn-delete" title="Delete" data-action="delete-webhook" data-index="${i}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `;
    list.appendChild(row);
  });

  list.onclick = (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index);
    if (btn.dataset.action === 'delete-webhook') deleteWebhook(idx);
    if (btn.dataset.action === 'edit-webhook') editWebhook(idx);
  };
}

function addWebhook() {
  const nameInput = $('new-webhook-name');
  const urlInput = $('new-webhook-url');
  const name = nameInput.value.trim();
  const url = urlInput.value.trim();
  if (!name || !url) {
    showStatus('error', '⚠ Both group name and webhook URL are required');
    return;
  }
  const webhooks = getWebhooksFromUI();
  webhooks.push({ name, url });
  renderWebhooks(webhooks);
  nameInput.value = '';
  urlInput.value = '';
  autoSaveLists();
}

function deleteWebhook(index) {
  const webhooks = getWebhooksFromUI();
  webhooks.splice(index, 1);
  renderWebhooks(webhooks);
  autoSaveLists();
}

function editWebhook(index) {
  const webhooks = getWebhooksFromUI();
  const wh = webhooks[index];
  const row = $('webhooks-list').children[index];

  row.innerHTML = `
    <input class="edit-input" type="text" value="${escapeHtml(wh.name)}" style="max-width:120px" placeholder="Name">
    <input class="edit-input edit-url" type="text" value="${escapeHtml(wh.url)}" placeholder="URL">
    <button class="btn-item-action btn-edit" title="Save" data-action="save-edit">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20,6 9,17 4,12"/></svg>
    </button>
  `;

  const inputs = row.querySelectorAll('.edit-input');
  inputs[0].focus();

  const save = () => {
    webhooks[index] = {
      name: inputs[0].value.trim() || wh.name,
      url: inputs[1].value.trim() || wh.url,
    };
    renderWebhooks(webhooks);
    autoSaveLists();
  };

  row.querySelector('[data-action="save-edit"]').addEventListener('click', save);
  inputs.forEach((inp) => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
      if (e.key === 'Escape') renderWebhooks(webhooks);
    });
  });
}

function getWebhooksFromUI() {
  const list = $('webhooks-list');
  const webhooks = [];
  for (const row of list.children) {
    const editInputs = row.querySelectorAll('.edit-input');
    if (editInputs.length >= 2) {
      webhooks.push({
        name: editInputs[0].value.trim() || 'Unnamed',
        url: editInputs[1].value.trim() || '',
      });
    } else {
      const name = row.querySelector('.item-name')?.textContent?.trim() || '';
      const url = row.querySelector('.item-url')?.textContent?.trim() || '';
      webhooks.push({ name, url });
    }
  }
  return webhooks;
}

// ===================== HELPERS =====================
function autoSaveLists() {
  const tags = getTagsFromUI();
  const webhooks = getWebhooksFromUI();
  chrome.storage.local.set({ customTags: tags, webhooks: webhooks });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showStatus(type, message) {
  const bar = $('status-bar');
  const text = $('status-text');
  bar.className = `status-bar ${type}`;
  text.textContent = message;
  setTimeout(() => { bar.className = 'status-bar hidden'; }, 3000);
}
