// Browser storage that never throws. Private windows and blocked site data make storage fail,
// and the site has to work without it.

export function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function storageRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* storage is not available */
  }
}
