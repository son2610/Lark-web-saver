// ============================================
// Lark Web Saver — Popup Logic
// Dynamic tags + Multi-webhook group sending
// ============================================

document.addEventListener('DOMContentLoaded', init);

const $ = (id) => document.getElementById(id);
const DEFAULT_TAGS = ['Tip', 'Tutorial', 'Template', 'News', 'Tool', 'Other'];

let els = {};

function init() {
  els = {
    title: $('field-title'),
    url: $('field-url'),
    description: $('field-description'),
    tags: $('field-tags'),
    notes: $('field-notes'),
    btnSaveBase: $('btn-save-base'),
    btnSendBot: $('btn-send-bot'),
    btnSettings: $('btn-settings'),
    statusBar: $('status-bar'),
    statusText: $('status-text'),
    groupCheckboxes: $('group-checkboxes'),
    checkAllGroups: $('check-all-groups'),
    ratingStars: $('rating-stars'),
    ratingValue: 0,
    
    // Reviews
    btnReviews: $('btn-reviews'),
    reviewBadge: $('review-badge'),
    reviewsView: $('reviews-view'),
    reviewsList: $('reviews-list'),
    formView: document.querySelector('.form'),
  };

  // Load current tab info (or pending page from context menu)
  loadTabInfo();

  // Load custom tags + webhooks from storage
  loadDynamicData();

  // Clear badge if any
  chrome.action.setBadgeText({ text: '' });

  // Event listeners
  els.btnSaveBase.addEventListener('click', handleSaveToBase);
  els.btnSendBot.addEventListener('click', handleSendToBot);
  els.btnSettings.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  });

  els.btnReviews.addEventListener('click', toggleReviewsView);

  // Load pending reviews
  loadDueReviews();

  // Select All toggle
  els.checkAllGroups.addEventListener('change', () => {
    const checked = els.checkAllGroups.checked;
    const boxes = els.groupCheckboxes.querySelectorAll('input[type="checkbox"]');
    boxes.forEach((cb) => { cb.checked = checked; });
  });

  // Star Rating Interaction
  const stars = document.querySelectorAll('.star');
  stars.forEach(star => {
    star.addEventListener('mouseover', () => {
      const val = parseInt(star.dataset.val);
      stars.forEach(s => s.classList.toggle('hover', parseInt(s.dataset.val) <= val));
    });
    star.addEventListener('mouseout', () => {
      stars.forEach(s => s.classList.remove('hover'));
    });
    star.addEventListener('click', () => {
      els.ratingValue = parseInt(star.dataset.val);
      stars.forEach(s => s.classList.toggle('active', parseInt(s.dataset.val) <= els.ratingValue));
    });
  });
}

// --- Load custom tags and webhook groups from storage ---
function loadDynamicData() {
  chrome.storage.local.get(['customTags', 'webhooks'], (data) => {
    // Populate tags dropdown
    const tags = data.customTags || DEFAULT_TAGS;
    const select = els.tags;
    // Keep the first "-- Select tag --" option
    select.innerHTML = '<option value="">-- Select tag --</option>';
    tags.forEach((tag) => {
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = tag;
      select.appendChild(opt);
    });

    // Populate webhook group checkboxes
    const webhooks = data.webhooks || [];
    if (webhooks.length > 0) {
      els.groupCheckboxes.innerHTML = '';
      webhooks.forEach((wh, i) => {
        const label = document.createElement('label');
        label.className = 'group-item';
        label.innerHTML = `
          <input type="checkbox" value="${i}" data-url="${escapeAttr(wh.url)}" data-name="${escapeAttr(wh.name)}">
          <span>${escapeHtml(wh.name)}</span>
        `;
        els.groupCheckboxes.appendChild(label);
      });
    }
    // If no webhooks, the HTML already has the empty hint
  });
}

// --- Load current page info ---
async function loadTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    els.title.value = tab.title || '';
    els.url.value = tab.url || '';

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const meta = document.querySelector('meta[name="description"]')
            || document.querySelector('meta[property="og:description"]');
          return meta ? meta.getAttribute('content') : '';
        },
      });
      if (results && results[0] && results[0].result) {
        els.description.value = results[0].result;
      }
    } catch (e) {
      console.log('Could not read meta description:', e.message);
    }
  } catch (err) {
    console.error('Failed to get tab info:', err);
  }
}

// --- Status helpers ---
function showStatus(type, message) {
  els.statusBar.className = `status-bar ${type}`;
  els.statusText.textContent = message;
  if (type === 'success') {
    setTimeout(() => { els.statusBar.className = 'status-bar hidden'; }, 4000);
  }
}

function setButtonLoading(btn, loading) {
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

// --- Load settings from storage ---
async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['appToken', 'tableId', 'appId', 'appSecret', 'signSecret',
       'cachedTenantToken', 'cachedTokenExpiry', 'webhooks', 'sysUserId'],
      (data) => resolve(data)
    );
  });
}

// --- Fetch tenant_access_token from app_id + app_secret ---
async function fetchTenantAccessToken(settings) {
  if (settings.cachedTenantToken && settings.cachedTokenExpiry) {
    const now = Date.now();
    if (now < settings.cachedTokenExpiry) {
      return settings.cachedTenantToken;
    }
  }

  const response = await fetch(
    'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        app_id: settings.appId,
        app_secret: settings.appSecret,
      }),
    }
  );

  const result = await response.json();

  if (result.code !== 0) {
    throw new Error(`Token error: ${result.msg || 'Failed to get tenant_access_token'}`);
  }

  const token = result.tenant_access_token;
  const expiry = Date.now() + 90 * 60 * 1000;

  chrome.storage.local.set({
    cachedTenantToken: token,
    cachedTokenExpiry: expiry,
  });

  return token;
}

// --- SAVE TO LARK BASE ---
async function handleSaveToBase() {
  const settings = await getSettings();

  if (!settings.appToken || !settings.tableId || !settings.appId || !settings.appSecret) {
    showStatus('error', '⚠ Please configure Lark Base settings first');
    return;
  }

  const title = els.title.value.trim();
  const url = els.url.value.trim();
  const description = els.description.value.trim();
  const tags = els.tags.value;
  const notes = els.notes.value.trim();

  if (!title || !url) {
    showStatus('error', '⚠ Title and URL are required');
    return;
  }

  setButtonLoading(els.btnSaveBase, true);
  showStatus('loading', '⏳ Getting access token...');

  try {
    const accessToken = await fetchTenantAccessToken(settings);
    showStatus('loading', '⏳ Saving to Lark Base...');

    const fields = {
      'Title': title,
      'URL': { text: title, link: url },
      'Description': description || '',
      'Notes': notes || '',
      'Saved At': Date.now(),
      'User ID': settings.sysUserId || 'Unknown'
    };

    if (tags) {
      fields['Tags'] = tags;
    }
    
    if (els.ratingValue > 0) {
      fields['Rating'] = els.ratingValue;
    }

    const apiUrl = `https://open.larksuite.com/open-apis/bitable/v1/apps/${settings.appToken}/tables/${settings.tableId}/records`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ fields }),
    });

    const result = await response.json();

    if (result.code === 0) {
      showStatus('success', '✅ Saved to Lark Base successfully!');
      
      // Save to Forgetting Curve review queue
      queueForReview(url, title);
      
    } else {
      showStatus('error', `❌ Error: ${result.msg || 'Unknown error'}`);
      console.error('Lark Base API error:', result);
    }
  } catch (err) {
    showStatus('error', `❌ ${err.message}`);
    console.error('Save to Base failed:', err);
  } finally {
    setButtonLoading(els.btnSaveBase, false);
  }
}

// --- SEND TO GROUP CHAT(S) VIA CUSTOM BOT ---
async function handleSendToBot() {
  const settings = await getSettings();

  // Get selected groups
  const selectedCheckboxes = els.groupCheckboxes.querySelectorAll('input[type="checkbox"]:checked');
  const selectedGroups = Array.from(selectedCheckboxes).map((cb) => ({
    name: cb.dataset.name,
    url: cb.dataset.url,
  }));

  if (selectedGroups.length === 0) {
    showStatus('error', '⚠ Please select at least one group to send to');
    return;
  }

  const title = els.title.value.trim();
  const url = els.url.value.trim();
  const description = els.description.value.trim();
  const tags = els.tags.value;
  const notes = els.notes.value.trim();

  if (!title || !url) {
    showStatus('error', '⚠ Title and URL are required');
    return;
  }

  setButtonLoading(els.btnSendBot, true);
  showStatus('loading', `⏳ Sending to ${selectedGroups.length} group(s)...`);

  try {
    // Build interactive card message
    let contentParts = [];
    contentParts.push(`**📄 ${title}**`);
    if (tags) contentParts.push(`🏷️ Tag: **${tags}**`);
    if (els.ratingValue > 0) contentParts.push(`⭐ Rating: **${els.ratingValue}/5**`);
    contentParts.push(`👤 User: **${settings.sysUserId || 'Unknown'}**`);
    if (description) contentParts.push(`📝 ${description}`);
    if (notes) contentParts.push(`💬 _${notes}_`);

    const cardBody = {
      msg_type: 'interactive',
      card: {
        header: {
          title: {
            content: '📌 New Page Saved — Lark Web Saver',
            tag: 'plain_text',
          },
          template: 'blue',
        },
        elements: [
          {
            tag: 'div',
            text: {
              content: contentParts.join('\n'),
              tag: 'lark_md',
            },
          },
          {
            tag: 'action',
            actions: [
              {
                tag: 'button',
                text: { content: '🔗 Open Page', tag: 'lark_md' },
                url: url,
                type: 'primary',
              },
            ],
          },
        ],
      },
    };

    // Signature verification if secret is given
    if (settings.signSecret) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const sign = await generateSign(timestamp, settings.signSecret);
      cardBody.timestamp = timestamp;
      cardBody.sign = sign;
    }

    // Send to all selected groups
    const results = await Promise.allSettled(
      selectedGroups.map((group) =>
        fetch(group.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(cardBody),
        }).then((r) => r.json())
      )
    );

    const succeeded = results.filter(
      (r) => r.status === 'fulfilled' && (r.value.code === 0 || r.value.StatusCode === 0)
    ).length;
    const failed = results.length - succeeded;

    if (failed === 0) {
      showStatus('success', `✅ Sent to ${succeeded} group(s) successfully!`);
    } else if (succeeded > 0) {
      showStatus('error', `⚠ Sent to ${succeeded}/${results.length} groups. ${failed} failed.`);
    } else {
      const firstError = results.find((r) => r.status === 'fulfilled')?.value?.msg
        || results.find((r) => r.status === 'rejected')?.reason?.message
        || 'Unknown error';
      showStatus('error', `❌ All sends failed: ${firstError}`);
    }
  } catch (err) {
    showStatus('error', `❌ ${err.message}`);
    console.error('Send to bot failed:', err);
  } finally {
    setButtonLoading(els.btnSendBot, false);
  }
}

// --- Signature generation for custom bot ---
async function generateSign(timestamp, secret) {
  const stringToSign = `${timestamp}\n${secret}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(stringToSign);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new Uint8Array(0));
  const base64Sign = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return base64Sign;
}

// --- Helpers ---
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ===================== REVIEWS & FORGETTING CURVE =====================
const REVIEW_INTERVALS_DAYS = [30, 90, 180, 365];

function toggleReviewsView() {
  const isHidden = els.reviewsView.classList.contains('hidden');
  if (isHidden) {
    els.formView.style.display = 'none';
    els.reviewsView.classList.remove('hidden');
    loadDueReviews();
  } else {
    els.formView.style.display = 'flex';
    els.reviewsView.classList.add('hidden');
  }
}

function queueForReview(url, title) {
  chrome.storage.local.get(['review_queue'], (data) => {
    const queue = data.review_queue || [];
    // Only queue if not already there to prevent duplicates
    if (!queue.find(q => q.url === url)) {
      queue.push({
        url: url,
        title: title,
        savedAt: Date.now(),
        reviewLevel: 0
      });
      chrome.storage.local.set({ review_queue: queue }, () => {
        loadDueReviews();
      });
    }
  });
}

function loadDueReviews() {
  chrome.storage.local.get(['review_queue'], (data) => {
    const queue = data.review_queue || [];
    const now = Date.now();
    
    // Find due items
    const dueItems = queue.filter(item => {
      const level = item.reviewLevel || 0;
      if (level >= REVIEW_INTERVALS_DAYS.length) return false;
      const daysToWait = REVIEW_INTERVALS_DAYS[level];
      const dueDate = item.savedAt + (daysToWait * 24 * 60 * 60 * 1000);
      return now >= dueDate;
    });

    // Update Badge
    if (dueItems.length > 0) {
      els.reviewBadge.classList.remove('hidden');
    } else {
      els.reviewBadge.classList.add('hidden');
    }

    // Render list
    els.reviewsList.innerHTML = '';
    
    if (dueItems.length === 0) {
      els.reviewsList.innerHTML = `<div class="empty-reviews">🎉 All caught up! No pages due for review today.</div>`;
      return;
    }

    dueItems.forEach(item => {
      const indexInQueue = queue.findIndex(q => q.url === item.url);
      
      const el = document.createElement('div');
      el.className = 'review-item';
      
      const nextLevelStr = `Level ${item.reviewLevel + 1}/${REVIEW_INTERVALS_DAYS.length}`;
      
      el.innerHTML = `
        <div class="review-meta">
          <span>${new Date(item.savedAt).toLocaleDateString()}</span>
          <span class="level">${nextLevelStr}</span>
        </div>
        <div class="review-info">${escapeHtml(item.title)}</div>
        <div class="review-actions">
          <button class="btn-review-act done" data-idx="${indexInQueue}" data-url="${escapeAttr(item.url)}">
            📖 Review Now
          </button>
          <button class="btn-review-act skip" data-idx="${indexInQueue}">
            ⏭ Skip
          </button>
        </div>
      `;
      els.reviewsList.appendChild(el);
    });

    // Setup action listeners
    const actionBtns = els.reviewsList.querySelectorAll('.btn-review-act');
    actionBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const isSkip = btn.classList.contains('skip');
        const idx = parseInt(btn.dataset.idx);
        
        if (!isSkip) {
          // Open URL to review
          chrome.tabs.create({ url: btn.dataset.url, active: false });
        }
        
        // Bump level
        queue[idx].reviewLevel = (queue[idx].reviewLevel || 0) + 1;
        chrome.storage.local.set({ review_queue: queue }, () => {
          loadDueReviews();
        });
      });
    });
  });
}
