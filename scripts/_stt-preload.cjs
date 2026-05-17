// Preloaded before tsx scripts that import from src/. Next.js's `server-only`
// package always throws when loaded outside the Next bundler, so we shim it
// to an empty module. This file is CJS so it runs synchronously via --require.
const Module = require("node:module");
const path = require("node:path");

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "server-only" || request === "client-only") {
    return path.join(__dirname, "_stt-empty.cjs");
  }
  return origResolve.call(this, request, parent, ...rest);
};
