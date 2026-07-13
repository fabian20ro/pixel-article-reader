// jsdom intentionally leaves media playback unimplemented. Tests assert calls
// with local spies where behavior matters; the shared baseline prevents noise elsewhere.
if (typeof HTMLMediaElement !== 'undefined') {
  Object.defineProperties(HTMLMediaElement.prototype, {
    play: {
      configurable: true,
      value: () => Promise.resolve(),
    },
    pause: {
      configurable: true,
      value: () => {},
    },
  });
}
