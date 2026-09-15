// How a sign-in is kept, and when an idle one is dropped.
//
// Ticking "keep me signed in" puts the session in Firebase's local persistence,
// so it survives closing the browser and no idle timer runs. Left unticked, the
// session lives in the tab's session storage — it is gone once the tab closes —
// and it is also dropped after a stretch of no activity, so a station left
// unattended on the floor does not stay open on someone else's account.

export const IDLE_LIMIT_MS = 30 * 60 * 1000;
export const IDLE_LIMIT_MINUTES = Math.round(IDLE_LIMIT_MS / 60000);

const KEEP_KEY = 'datbike.keepSignedIn';
const IDLE_KEY = 'datbike.signedOutIdle';

// Storage throws rather than returning null in some locked-down browsers, and
// the stricter session (no keep, idle timer armed) is the safe answer there.
function readFlag(store, key) {
  try {
    return window[store].getItem(key) === 'true';
  } catch (err) {
    return false;
  }
}

function writeFlag(store, key, on) {
  try {
    if (on) window[store].setItem(key, 'true');
    else window[store].removeItem(key);
  } catch (err) {
    /* nothing to keep — the session stays the stricter kind */
  }
}

export function rememberKeepSignedIn(keep) {
  writeFlag('localStorage', KEEP_KEY, keep);
}

export function keepSignedIn() {
  return readFlag('localStorage', KEEP_KEY);
}

export function markIdleSignOut() {
  writeFlag('sessionStorage', IDLE_KEY, true);
}

export function wasIdleSignOut() {
  return readFlag('sessionStorage', IDLE_KEY);
}

export function clearIdleSignOut() {
  writeFlag('sessionStorage', IDLE_KEY, false);
}

// Activity is tracked in the module rather than in React state so that both the
// pointer/keyboard listeners in App and every backend call can feed it. Camera
// scans never touch the keyboard, but they do call SAP, so the call itself
// counts as someone standing at the station.
let lastActivity = Date.now();

export function noteActivity() {
  lastActivity = Date.now();
}

export function idleMs() {
  return Date.now() - lastActivity;
}
