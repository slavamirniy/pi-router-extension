// Message versioning and branching system
export function createVersionManager() {
  let messageVersions = {}; // {messageIndex: [{text, timestamp}, ...]}
  let currentVersionIndex = {}; // {messageIndex: versionIndex}

  function syncFromServer(serverVersions, chatId) {
    // serverVersions format: {'chatId-index': {versions: [...], currentIndex: n}}
    messageVersions = {};
    currentVersionIndex = {};
    
    for (const [key, data] of Object.entries(serverVersions || {})) {
      if (!key.startsWith(chatId + '-')) continue;
      const index = parseInt(key.substring(chatId.length + 1));
      if (!isNaN(index) && data.versions && Array.isArray(data.versions) && data.versions.length > 0) {
        messageVersions[index] = data.versions;
        currentVersionIndex[index] = data.currentIndex ?? data.versions.length - 1;
      }
    }
  }

  function getVersionCount(messageIndex) {
    return messageVersions[messageIndex]?.length || 0;
  }

  function getCurrentVersionIndex(messageIndex) {
    return currentVersionIndex[messageIndex] ?? 0;
  }

  function hasMultipleVersions(messageIndex) {
    return getVersionCount(messageIndex) > 1;
  }

  function reset() {
    messageVersions = {};
    currentVersionIndex = {};
  }

  return {
    syncFromServer,
    getVersionCount,
    getCurrentVersionIndex,
    hasMultipleVersions,
    reset
  };
}
