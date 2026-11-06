/**
 * dsh-herdr — host half.
 *
 * This plugin owns no PTY process. It only serves the three static assets the
 * embedded terminal needs (xterm.js, xterm.css, addon-fit.js) from the copy of
 * @xterm/xterm that the DSH profile already has installed, and leaves all real
 * terminal work to the host's own session-scoped terminal service
 * (`ctx.webTerminals`), which the client half consumes.
 *
 * The host terminal service is what `dsh terminal` / the built-in terminal tab
 * use, so the Herdr page gets the same shell resolution, PTY lifetime and
 * reconnect behaviour as a native DSH terminal.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const inject = ["webServer", "connection"];

const HERE = dirname(fileURLToPath(import.meta.url));

const MEDIA_TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

/**
 * Walk up from `start` looking for node_modules/<pkg>/package.json.
 * DSH profiles hoist dependencies to <profile>/node_modules, so a plugin
 * installed into a profile normally finds them one or two levels up.
 */
function walkUpFor(start, pkg) {
  const segments = pkg.split("/");
  let dir = start;
  for (let depth = 0; depth < 16; depth++) {
    const manifest = join(dir, "node_modules", ...segments, "package.json");
    if (existsSync(manifest)) return dirname(manifest);
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/** Resolve an installed package directory across the layouts DSH uses. */
function resolvePackageDir(pkg, override) {
  if (typeof override === "string" && override !== "") {
    // Absolute package directory, or a file inside it.
    if (existsSync(join(override, "package.json"))) return override;
    const nested = walkUpFor(override, pkg);
    if (nested !== undefined) return nested;
  }
  // 1. the plugin's own node_modules chain (works when installed as a profile bundle)
  const local = createRequire(join(HERE, "index.js"));
  try {
    return dirname(local.resolve(`${pkg}/package.json`));
  } catch {
    /* fall through */
  }
  // 2. walk up from the plugin directory and from the host process cwd
  for (const start of [HERE, process.cwd()]) {
    const found = walkUpFor(start, pkg);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Build the route table. Keys are exact request paths; values are absolute files.
 * Only these three files are exposed — nothing else on disk is reachable.
 */
function collectAssets(config) {
  const assets = new Map();
  const xtermDir = resolvePackageDir("@xterm/xterm", config?.xtermDir);
  if (xtermDir !== undefined) {
    assets.set("/herdr/xterm.js", join(xtermDir, "lib", "xterm.js"));
    assets.set("/herdr/xterm.css", join(xtermDir, "css", "xterm.css"));
  }
  const fitDir = resolvePackageDir("@xterm/addon-fit", config?.fitDir);
  if (fitDir !== undefined) {
    assets.set("/herdr/addon-fit.js", join(fitDir, "lib", "addon-fit.js"));
  }
  return assets;
}

/**
 * Same shape as dsh-better-sidebar's createBundleRouteHandler: the browser is
 * only allowed to fetch these assets when the connection layer trusts the
 * request, and nothing outside the route table can be read.
 */
function createAssetsHandler(fence, assets) {
  return async (req, res) => {
    if (!fence(req)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    const pathname = new URL(req.url ?? "/", "http://dsh.invalid").pathname;
    const file = assets.get(pathname);
    if (file === undefined || !existsSync(file)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    let body;
    try {
      body = await readFile(file);
    } catch {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const etag = createHash("sha1").update(body).digest("hex").slice(0, 12);
    const headers = {
      "content-type": MEDIA_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-cache",
      etag,
    };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    if (req.method === "HEAD") {
      res.writeHead(200, { ...headers, "content-length": String(body.byteLength) });
      res.end();
      return;
    }
    res.writeHead(200, headers);
    res.end(body);
  };
}

export function apply(ctx, config) {
  const assets = collectAssets(config);
  if (assets.size === 0) {
    ctx.logger?.warn?.(
      "dsh-herdr: @xterm/xterm was not found, so no assets are served. The Herdr page will report an error; set the plugin config `xtermDir` to the package directory if the install layout differs.",
    );
    return;
  }
  const fence = (req) =>
    ctx.connection ? ctx.connection.requestRejection(req) === undefined : true;
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: "/herdr",
        handler: createAssetsHandler(fence, assets),
      }),
    "dsh-herdr: serve xterm assets for the embedded terminal",
  );
  ctx.logger?.info?.(
    `dsh-herdr: serving ${assets.size} asset(s) under /herdr (${[...assets.keys()].join(", ")})`,
  );
}

export const name = "dsh-herdr";

export { inject };
