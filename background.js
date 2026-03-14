// ============================================
// Lark Web Saver — Background Service Worker
// ============================================

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'lark-web-saver',
    title: '📌 Save to Lark Base',
    contexts: ['page', 'link'],
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'lark-web-saver') {
    // Open the popup programmatically is not possible in MV3,
    // so we'll save the page info to storage and trigger a notification badge
    const pageUrl = info.linkUrl || info.pageUrl || tab.url;
    const pageTitle = tab.title || pageUrl;

    chrome.storage.local.set({
      pendingPage: {
        title: pageTitle,
        url: pageUrl,
        timestamp: Date.now(),
      },
    }, () => {
      // Set badge to indicate pending action
      chrome.action.setBadgeText({ text: '1' });
      chrome.action.setBadgeBackgroundColor({ color: '#3370FF' });

      // Show a notification (optional)
      // Note: requires 'notifications' permission if you want chrome.notifications
    });
  }
});
