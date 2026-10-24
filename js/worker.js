// Runs any exported function of algorithms.js off the UI thread.
// Message: { id, op, args } -> { id, result | error }
// app.js starts the worker with a ?v=<page load> query; it is forwarded to the import
// so a stale cached algorithms.js is never used (plain static servers send no cache headers).
const algorithms = import(`./algorithms.js${self.location.search}`);

self.onmessage = async ({ data: { id, op, args } }) => {
  try {
    const alg = await algorithms;
    if (typeof alg[op] !== "function") throw new Error(`Unknown op ${op}`);
    const result = alg[op](...args);
    self.postMessage({ id, result }, result instanceof Uint32Array ? [result.buffer] : []);
  } catch (e) {
    self.postMessage({ id, error: e.message || String(e) });
  }
};
