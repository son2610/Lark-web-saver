// ============================================
// Lark Web Saver — Background Service Worker
// ============================================

// --- Spaced Repetition (Forgetting Curve) Constants ---
// Review levels and their delays in days (1 month, 3 months, 6 months, 12 months)
const REVIEW_INTERVALS_DAYS = [30, 90, 180, 365];
const ALARM_NAME = 'check_reviews_alarm';

// --- Initialization ---
chrome.runtime.onInstalled.addListener(() => {
  // Context Menu
  chrome.contextMenus.create({
    id: 'lark-web-saver',
    title: '📌 Save to Lark Base',
    contexts: ['page', 'link'],
  });

  // Setup daily alarm for spaced repetition
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: 1440 // 24 hours
  });

  // Run a check immediately on install
  checkDueReviews();
});

chrome.runtime.onStartup.addListener(() => {
  checkDueReviews();
});

// --- Context Menu Handling ---
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'lark-web-saver') {
    const pageUrl = info.linkUrl || info.pageUrl || tab.url;
    const pageTitle = tab.title || pageUrl;

    chrome.storage.local.set({
      pendingPage: {
        title: pageTitle,
        url: pageUrl,
        timestamp: Date.now(),
      },
    }, () => {
      chrome.action.setBadgeText({ text: '1' });
      chrome.action.setBadgeBackgroundColor({ color: '#3370FF' });
    });
  }
});

// --- Alarms Handling ---
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkDueReviews();
  }
});

// --- Review Check Logic ---
function checkDueReviews() {
  chrome.storage.local.get(['review_queue', 'pendingPage'], (data) => {
    const queue = data.review_queue || [];
    const now = Date.now();
    let dueCount = 0;

    queue.forEach((item) => {
      const level = item.reviewLevel || 0;
      if (level < REVIEW_INTERVALS_DAYS.length) {
        const daysToWait = REVIEW_INTERVALS_DAYS[level];
        const dueDate = item.savedAt + (daysToWait * 24 * 60 * 60 * 1000);
        if (now >= dueDate) {
          dueCount++;
        }
      }
    });

    // We also need to preserve any pending context menu badge
    let totalBadgeCount = dueCount;
    if (data.pendingPage) {
      totalBadgeCount += 1;
    }

    if (totalBadgeCount > 0) {
      chrome.action.setBadgeText({ text: totalBadgeCount.toString() });
      chrome.action.setBadgeBackgroundColor({ color: dueCount > 0 ? '#FFD60A' : '#3370FF' }); // Yellow if reviews pending
    } else {
      chrome.action.setBadgeText({ text: '' });
    }

    // Show a notification if there are reviews due
    if (dueCount > 0) {
      chrome.notifications.create('review_reminder', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Lark Web Saver — Time to Review!',
        message: `You have ${dueCount} saved page(s) due for review today based on your forgetting curve. Click the extension to start reviewing.`,
        priority: 1
      });
    }
  });
}
