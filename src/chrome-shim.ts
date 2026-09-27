/**
 * Dark Reader's embeddable build routes its fetches through a fake `chrome.runtime`.
 * Inside a userscript manager the real extension `chrome` object may be visible, and
 * Dark Reader would forward its messages to it. The build maps every `chrome` /
 * `window.chrome` reference in the bundle to this private object instead.
 */
export const __darksafariChrome: Record<string, any> = {};
