// backend/src/modules/platform/state.js
// In-memory platform pause state. Resets on server restart (intentional).

let _paused = false;

export function isPaused()       { return _paused; }
export function setPaused(value) { _paused = Boolean(value); }
