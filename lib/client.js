/**
 * dsh-herdr — client half.
 *
 * Puts a "Herdr" entry in DSH's left sidebar (the panel list plus the main
 * panel, both registered through `ctx.slots`). Opening it allocates a
 * host-owned PTY through `ctx.webTerminals` and automatically types the
 * workspace-us command, so the page is the GUI equivalent of opening
 * PowerShell and running `workspace-us`.
 *
 * This file is a classic script evaluated by the shell's module loader — it has
 * no import/export statements, and the loader's `require` only resolves the
 * shell's platform module table (React). Everything else is loaded from the
 * plugin's own `/herdr` asset route.
 */
window.__ModuleLoader__.load({
  id: "dsh-herdr",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var h = React.createElement;
    var useCallback = React.useCallback;
    var useEffect = React.useEffect;
    var useLayoutEffect = React.useLayoutEffect;
    var useMemo = React.useMemo;
    var useRef = React.useRef;
    var useState = React.useState;
    var useSyncExternalStore = React.useSyncExternalStore;

    /**
     * Used only when the host half's config route cannot be read. The real
     * connection list comes from `/herdr/config.json`, which the host half
     * generates from the plugin config (`connections`, or the flat
     * `remote` / `session` / `command` keys).
     */
    var DEFAULT_CONNECTION = { label: "Herdr", command: "herdr" };
    var ASSET_BASE = "/herdr";

    /** Panel id in the left sidebar (`sidebar.panellist` id and `main` key). */
    var PANEL_ID = "dsh-herdr";

    /**
     * Used only when no real DSH session can be resolved (the left panel is a
     * global panel, and DSH publishes the current session through the right
     * sidebar's mounted seat). The PTY itself does not depend on the id.
     */
    var FALLBACK_SESSION = "herdr";

    var STYLE_ID = "dsh-herdr-style";
    var CSS = [
      ".dsh-herdr-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-bg-secondary,#1b1b1b);color:var(--dsw-text-primary,#e6e6e6);}",
      ".dsh-herdr-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 8px;border-bottom:1px solid var(--dsw-border-subtle,rgba(127,127,127,.25));font-size:12px;}",
      ".dsh-herdr-command{font-family:var(--dsw-font-mono,Consolas,\"Courier New\",monospace);opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".dsh-herdr-spacer{flex:1 1 auto;}",
      ".dsh-herdr-status{opacity:.7;}",
      ".dsh-herdr-session{opacity:.55;font-family:var(--dsw-font-mono,Consolas,\"Courier New\",monospace);}",
      ".dsh-herdr-btn{appearance:none;border:1px solid var(--dsw-border-subtle,rgba(127,127,127,.35));background:var(--dsw-bg-tertiary,transparent);color:inherit;border-radius:6px;padding:2px 8px;font-size:12px;cursor:pointer;}",
      ".dsh-herdr-btn:hover{background:var(--dsw-bg-hover,rgba(127,127,127,.12));}",
      ".dsh-herdr-btn:disabled{opacity:.45;cursor:default;}",
      ".dsh-herdr-btn:disabled:hover{background:var(--dsw-bg-tertiary,transparent);}",
      ".dsh-herdr-stage{position:relative;flex:1 1 auto;min-height:0;display:flex;}",
      ".dsh-herdr-screen{flex:1 1 auto;min-height:0;padding:2px 4px;}",
      ".dsh-herdr-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;opacity:.75;pointer-events:none;}",
      ".dsh-herdr-overlay-text{animation:dsh-herdr-pulse 1.2s ease-in-out infinite;}",
      "@keyframes dsh-herdr-pulse{0%,100%{opacity:.4}50%{opacity:1}}",
      ".dsh-herdr-picker{appearance:none;border:1px solid var(--dsw-border-subtle,rgba(127,127,127,.35));background:var(--dsw-bg-tertiary,transparent);color:inherit;border-radius:6px;padding:2px 6px;font-size:12px;cursor:pointer;max-width:200px;}",
      ".dsh-herdr-placeholder{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:16px;text-align:center;opacity:.85;}",
      ".dsh-herdr-notice{padding:16px;font-size:13px;line-height:1.5;}",
      ".dsh-herdr-notice code{font-family:var(--dsw-font-mono,Consolas,\"Courier New\",monospace);}",
    ].join("\n");

    function ensureStyle() {
      if (document.getElementById(STYLE_ID) !== null) return;
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);
    }

    function loadAsset(href, kind) {
      return new Promise((resolve, reject) => {
        var el;
        if (kind === "style") {
          el = document.createElement("link");
          el.rel = "stylesheet";
          el.href = href;
        } else {
          el = document.createElement("script");
          el.src = href;
          el.async = false;
        }
        el.onload = () => resolve();
        el.onerror = () => reject(new Error("无法加载 " + href));
        (document.head || document.documentElement).appendChild(el);
      });
    }

    /**
     * The xterm UMD bundles are served by the host half. They are classic
     * scripts that attach to globalThis, so they need no bundler here.
     */
    function ensureTerminalAssets() {
      if (window.__dshHerdrAssetsLoaded === true) return Promise.resolve();
      if (window.__dshHerdrAssetsLoading) return window.__dshHerdrAssetsLoading;
      var pending = Promise.all([
        loadAsset(ASSET_BASE + "/xterm.css", "style"),
        loadAsset(ASSET_BASE + "/xterm.js", "script"),
        loadAsset(ASSET_BASE + "/addon-fit.js", "script"),
      ])
        .then(() => {
          window.__dshHerdrAssetsLoaded = true;
          delete window.__dshHerdrAssetsLoading;
        })
        .catch((error) => {
          delete window.__dshHerdrAssetsLoading;
          throw error;
        });
      window.__dshHerdrAssetsLoading = pending;
      return pending;
    }

    /**
     * The connection list is generated by the host half from the plugin config,
     * so the page is not tied to one machine's remote/session pair.
     */
    function loadConnections() {
      if (window.__dshHerdrConnectionsLoaded === true) {
        return Promise.resolve(window.__dshHerdrConnections);
      }
      if (window.__dshHerdrConnectionsLoading) {
        return window.__dshHerdrConnectionsLoading;
      }
      // Deferred through a promise so an unavailable `fetch` (or a relative
      // URL that the host cannot resolve) becomes a rejection instead of a
      // synchronous throw inside the effect.
      //
      // The config is served by DSH itself so it should arrive instantly; the
      // race only guards against a hung request leaving the terminal unusable.
      var pending = Promise.resolve()
        .then(function () {
          return Promise.race([
            fetch(ASSET_BASE + "/config.json"),
            new Promise(function (_, reject) {
              setTimeout(function () {
                reject(new Error("config request timed out"));
              }, 3000);
            }),
          ]);
        })
        .then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        })
        .then(function (payload) {
          var list = Array.isArray(payload && payload.connections)
            ? payload.connections.filter(function (item) {
                return (
                  item &&
                  typeof item.command === "string" &&
                  item.command.trim() !== ""
                );
              })
            : [];
          if (list.length === 0) list = [DEFAULT_CONNECTION];
          window.__dshHerdrConnections = list;
          window.__dshHerdrConnectionsLoaded = true;
          delete window.__dshHerdrConnectionsLoading;
          return list;
        })
        .catch(function (error) {
          delete window.__dshHerdrConnectionsLoading;
          throw error;
        });
      window.__dshHerdrConnectionsLoading = pending;
      return pending;
    }

    /** Accept either the class itself or a namespace object holding it. */
    function pickClass(value, name) {
      if (!value) return undefined;
      if (typeof value === "function") return value;
      if (typeof value[name] === "function") return value[name];
      return undefined;
    }

    function readTheme(node) {
      var style = window.getComputedStyle(node);
      var background = style.backgroundColor || "#1b1b1b";
      var foreground = style.color || "#e6e6e6";
      return {
        background: background,
        foreground: foreground,
        cursor: foreground,
        cursorAccent: background,
        selectionBackground: foreground,
        selectionForeground: background,
      };
    }

    /**
     * xterm must be given a monospace face. The font inherited from the DSH
     * chrome is proportional, which smears every line of a TUI across the
     * panel (the host's own terminal tab sets a mono font on its container, so
     * it never hits this). Prefer the theme's mono stack so the page still
     * matches DSH, and fall back to a Windows-safe one.
     */
    function readFontFamily(node) {
      var fallback = 'Consolas, "Cascadia Mono", "Courier New", monospace';
      try {
        var fromTheme = window
          .getComputedStyle(node)
          .getPropertyValue("--dsw-font-mono")
          .trim();
        if (fromTheme !== "") return fromTheme;
      } catch {
        /* fall through to the fallback */
      }
      return fallback;
    }

    /** Compact form of a session id for the toolbar; the full value is in title. */
    function shortSessionId(id) {
      if (typeof id !== "string" || id === "") return "";
      return id.length > 14 ? id.slice(0, 12) + "…" : id;
    }

    /** Stable store accessors for useSyncExternalStore, rebound per model. */
    function useTerminalState(model) {
      var handlersRef = useRef(null);
      if (handlersRef.current === null || handlersRef.current.model !== model) {
        handlersRef.current = {
          model: model,
          subscribe: (listener) => model.state.subscribe(listener),
          getSnapshot: () => model.state.getSnapshot(),
        };
      }
      var handlers = handlersRef.current;
      return useSyncExternalStore(handlers.subscribe, handlers.getSnapshot, handlers.getSnapshot);
    }

    /**
     * Read an optional host service WITHOUT tripping the Cordis proxy guard.
     *
     * A Cordis `Context` is a Proxy (`ReflectService.handler`): reading
     * `ctx.<name>` for a service this fiber did not declare in `inject` throws
     * `cannot get property "<name>" without inject`. `ctx.get(name, false)` is
     * the non-throwing accessor — it returns `undefined` when the service is
     * absent or its providing fiber is not active — so every optional service
     * must go through it. The direct property read is kept only as a last
     * resort and always inside try/catch.
     */
    function readService(ctx, name) {
      try {
        if (typeof ctx.get === "function") {
          var value = ctx.get(name, false);
          if (value !== undefined) return value;
        }
      } catch {}
      try {
        return ctx[name];
      } catch {}
      return undefined;
    }

    /**
     * Structural detection only: the host service is not in the platform module
     * table, and a deployment without it must still activate the plugin.
     */
    function findWebTerminals(ctx) {
      var service = readService(ctx, "webTerminals");
      if (!service || typeof service.view !== "function" || typeof service.close !== "function") {
        return undefined;
      }
      return service;
    }

    /**
     * The slot service is how a plugin adds a left-sidebar panel. dshmarket and
     * dsh-context both register `sidebar.panellist` (the icon row) and `main`
     * (the panel body) this way.
     */
    function findSlots(ctx) {
      var slots = readService(ctx, "slots");
      if (!slots || typeof slots.register !== "function" || typeof slots.inject !== "function") {
        return undefined;
      }
      return slots;
    }

    /**
     * The host publishes the session retained by the main view through
     * `ctx.uiSession.current` — a binding whose `key` is the session id. That is
     * the host's own idea of "the current conversation", and a global panel
     * cannot see a session scope. Older hosts only publish the mounted seat
     * (`ctx.sidebarRight.mounted`, a plain session id string); hosts that
     * publish neither still expose the same fact on the session list rows
     * (`retainedBy.mainView`). Every source is optional — the panel must never
     * crash when one is missing.
     */
    var sessionsListObserver;

    function readKeyId(source) {
      if (source === undefined || source === null || typeof source.getSnapshot !== "function") {
        return undefined;
      }
      try {
        var value = source.getSnapshot();
        if (typeof value === "string") return value !== "" ? value : undefined;
        if (value && typeof value.key === "string" && value.key !== "") return value.key;
        return undefined;
      } catch {
        return undefined;
      }
    }

    function mainListSessionId(ctx) {
      var sessions = readService(ctx, "sessions");
      var list = sessions ? sessions.list : undefined;
      if (list === undefined || typeof list.getSnapshot !== "function") return undefined;
      try {
        var byId = list.getSnapshot().byId;
        if (!byId) return undefined;
        var found = Object.values(byId).find(function (row) {
          return (
            row &&
            row.retainedBy &&
            typeof row.retainedBy.mainView === "number" &&
            row.retainedBy.mainView > 0
          );
        });
        return found && typeof found.id === "string" ? found.id : undefined;
      } catch {
        return undefined;
      }
    }

    function seatSessionId(ctx) {
      var uiSession = readService(ctx, "uiSession");
      var fromUi = readKeyId(uiSession ? uiSession.current : undefined);
      if (fromUi !== undefined) return fromUi;
      var controller = readService(ctx, "sidebarRight");
      var fromMounted = readKeyId(controller ? controller.mounted : undefined);
      if (fromMounted !== undefined) return fromMounted;
      var fromList = mainListSessionId(ctx);
      if (fromList !== undefined) return fromList;
      return storedSessionId();
    }

    /**
     * Last resort: the DSH UI itself persists the selected session id under
     * this key. It is an implementation detail of the host, so it is only read
     * when every service-backed route failed.
     */
    function storedSessionId() {
      try {
        var raw = window.localStorage.getItem("dsh.sessions.current");
        if (raw === null || raw === "") return undefined;
        var parsed = JSON.parse(raw);
        return parsed && typeof parsed.sessionId === "string" && parsed.sessionId !== ""
          ? parsed.sessionId
          : undefined;
      } catch {
        return undefined;
      }
    }

    function seatObserver(ctx) {
      var uiSession = readService(ctx, "uiSession");
      var current = uiSession ? uiSession.current : undefined;
      if (current !== undefined && typeof current.subscribe === "function") {
        return current;
      }
      var controller = readService(ctx, "sidebarRight");
      var mounted = controller ? controller.mounted : undefined;
      if (mounted !== undefined && typeof mounted.subscribe === "function") {
        return mounted;
      }
      var sessions = readService(ctx, "sessions");
      var list = sessions ? sessions.list : undefined;
      if (list === undefined || typeof list.subscribe !== "function") return undefined;
      if (sessionsListObserver === undefined) {
        sessionsListObserver = {
          getSnapshot: () => undefined,
          subscribe: (listener) => list.subscribe(listener),
        };
      }
      return sessionsListObserver;
    }

    function HerdrIcon(size) {
      var s = typeof size === "number" && size > 0 ? size : 16;
      return h(
        "svg",
        {
          width: s,
          height: s,
          viewBox: "0 0 16 16",
          fill: "none",
          "aria-hidden": "true",
          focusable: "false",
        },
        h("rect", {
          x: 1.5,
          y: 2.5,
          width: 13,
          height: 11,
          rx: 1.5,
          stroke: "currentColor",
          strokeWidth: 1.2,
        }),
        h("path", {
          d: "M4 6.5l2.2 2L4 10.5",
          stroke: "currentColor",
          strokeWidth: 1.2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }),
        h("path", {
          d: "M7.5 11h3.5",
          stroke: "currentColor",
          strokeWidth: 1.2,
          strokeLinecap: "round",
        }),
      );
    }

    function phaseLabel(phase) {
      switch (phase) {
        case "connected":
          return "已连接";
        case "connecting":
          return "正在连接…";
        case "creating":
          return "正在创建终端…";
        case "loading":
          return "正在加载…";
        case "disconnected":
          return "已断开";
        case "failed":
          return "连接失败";
        case "closing":
          return "正在关闭…";
        case "closed":
          return "已关闭";
        default:
          return "准备中";
      }
    }

    /** The phase badge subscribes on its own so it tracks the host state. */
    function StatusText(props) {
      var state = useTerminalState(props.model);
      var phase = state ? state.phase : "idle";
      var text = phaseLabel(phase);
      // Surface the host's own reason: without it a failed PTY is a dead end.
      if ((phase === "failed" || phase === "disconnected") && state && state.error) {
        text += "：" + state.error;
      }
      return h("span", { className: "dsh-herdr-status", title: text }, text);
    }

    /**
     * Fit the emulator to its box and publish the size, clamped to the host's
     * per-terminal limits (a size the host refuses would leave the shell's own
     * idea of the window wrong).
     */
    function fitScreen(terminal, addon, environment, model) {
      var dimensions = addon ? addon.proposeDimensions() : undefined;
      if (dimensions === undefined || environment === undefined) return;
      var cols = Math.min(dimensions.cols, environment.maxCols);
      var rows = Math.min(dimensions.rows, environment.maxRows);
      if (cols < 2 || rows < 1) return;
      terminal.resize(cols, rows);
      model.resize(cols, rows);
    }

    /**
     * One Herdr connection is one shared remote session, so the client keeps a
     * single view across panel mounts: the first resolved session id is frozen,
     * the contentId only changes on "新终端", and a key change closes the view
     * it replaces (the host's `view()` is idempotent per key, and detaching a
     * view deliberately does NOT end its process).
     */
    var runtime = {
      run: 0,
      connectionIndex: 0,
      sessionId: "",
      model: undefined,
      modelKey: "",
    };

    /**
     * Last-known panel state, mirrored into localStorage under one small key.
     *
     * The host wraps every slot entry in an error boundary that renders an
     * invisible marker and abdicates the entry, so a failure in here is
     * otherwise impossible to see from outside the page. This record is what
     * makes the panel's real state readable afterwards (the DSH profile
     * persists localStorage to disk), and it is the first thing to attach to a
     * bug report.
     */
    var DIAG_KEY = "dsh-herdr:state";
    var diag = {};

    function recordDiag(patch) {
      Object.assign(diag, patch);
      try {
        window.localStorage.setItem(
          DIAG_KEY,
          JSON.stringify({ ...diag, t: new Date().toISOString() }),
        );
      } catch {
        /* storage can be unavailable (private mode, quota); nothing to do */
      }
    }

    /**
     * Wall-clock marks for the open pipeline.
     *
     * "Feels slow" is not actionable; these are. Every mark is `performance.now()`
     * in milliseconds since the page started, and the record shows the deltas
     * between them, so a report can say which leg actually costs the time
     * (panel mount, emulator creation, PTY allocation, shell start) instead of
     * guessing.
     */
    var TIMES = {};

    function markTime(name) {
      try {
        var now =
          typeof window !== "undefined" &&
          window.performance &&
          typeof window.performance.now === "function"
            ? window.performance.now()
            : Date.now();
        TIMES[name] = Math.round(now);
        recordDiag({ timings: Object.assign({}, TIMES) });
      } catch {
        /* timing must never break the panel */
      }
    }

    /**
     * The "startup command already typed" marker.
     *
     * It is keyed by the host terminal id (`model.id`), which identifies ONE
     * live PTY: the same `(sessionId, contentId)` reattaches to the same
     * process across a page reload, while "新终端" — or a session id that only
     * resolved after the first render — gets a different one. Keying on the id
     * (and mirroring it into sessionStorage) is what keeps the command from
     * being typed twice into one live PTY without suppressing it for a new one.
     */
    var SENT_PREFIX = "dsh-herdr:sent:";

    function sentKeyOf(model, sessionId, contentId) {
      var id = model && typeof model.id === "string" && model.id !== "" ? model.id : "";
      return SENT_PREFIX + (id !== "" ? id : sessionId + "|" + contentId);
    }

    function hasSent(key) {
      try {
        return window.sessionStorage.getItem(key) === "1";
      } catch {
        return false;
      }
    }

    function markSent(key) {
      try {
        window.sessionStorage.setItem(key, "1");
      } catch {
        /* storage disabled: this page's marker is simply not persisted */
      }
    }

    function clearSent(key) {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }

    function obtainModel(service, sessionId, contentId) {
      var key = sessionId + "|" + contentId;
      if (runtime.model !== undefined && runtime.modelKey === key) return runtime.model;
      var model;
      try {
        model = service.view(sessionId, contentId, contentId);
      } catch {
        return undefined;
      }
      var previous = runtime.model;
      runtime.model = model;
      runtime.modelKey = key;
      if (previous !== undefined && previous !== model) {
        try {
          var closing = previous.close();
          if (closing && typeof closing.catch === "function") closing.catch(() => {});
        } catch {
          /* the old view is already gone */
        }
      }
      return model;
    }

    /**
     * The emulator cell. It is bound to the MODEL, so a state change only
     * re-renders around it; a new terminal (a new contentId) remounts it.
     */
    function TerminalScreen(props) {
      var hostRef = useRef(null);
      var emulatorRef = useRef(undefined);
      var fitRef = useRef(undefined);
      var lastRevision = useRef(0);
      var model = props.model;
      var contentId = props.contentId;
      var state = useTerminalState(model);
      var writable = state && state.writable === true;
      var environment = state ? state.environment : undefined;
      var info = state ? state.info : undefined;

      // Mirror the host's terminal state so a failed PTY is readable afterwards
      // instead of just a dark rectangle.
      var diagPhase = state ? state.phase : "idle";
      var diagError = state ? state.error : undefined;
      var diagIssue = state ? state.issue : undefined;
      useEffect(() => {
        // The last leg: the shell is up and the host accepts input.
        if (writable && TIMES.writable === undefined) markTime("writable");
        recordDiag({
          phase: diagPhase,
          writable: writable,
          error: diagError,
          issue: diagIssue,
          modelId: typeof model.id === "string" ? model.id : undefined,
          contentId: contentId,
        });
      }, [diagPhase, writable, diagError, diagIssue, contentId, model]);

      // Read inside the xterm effects without re-creating the emulator on every
      // snapshot: the emulator is bound to the MODEL, live flags go through here.
      var liveRef = useRef({ visible: props.visible, writable: false, environment: undefined });
      liveRef.current.visible = props.visible;
      liveRef.current.writable = writable;
      liveRef.current.environment = environment;

      // Create the emulator once per model and attach the host terminal.
      useLayoutEffect(() => {
        var node = hostRef.current;
        if (node === null) return undefined;
        var TerminalClass = pickClass(window.Terminal, "Terminal");
        if (TerminalClass === undefined) return undefined;
        var terminal = new TerminalClass({
          fontFamily: readFontFamily(node),
          fontSize: 13,
          // The surrounding UI sets its own tracking; a terminal needs none.
          letterSpacing: 0,
          lineHeight: 1,
          minimumContrastRatio: 4.5,
          cursorBlink: true,
          scrollback: environment && environment.scrollback ? environment.scrollback : 0,
          theme: readTheme(node),
        });
        var FitAddonClass = pickClass(window.FitAddon, "FitAddon");
        var addon = FitAddonClass === undefined ? undefined : new FitAddonClass();
        if (addon !== undefined) terminal.loadAddon(addon);
        terminal.open(node);
        terminal.textarea?.setAttribute("aria-label", "Herdr 终端");
        emulatorRef.current = terminal;
        fitRef.current = addon;
        lastRevision.current = 0;
        var input = terminal.onData((data) => {
          model.write(data);
        });
        var measure = () => {
          var live = liveRef.current;
          if (!live.visible || !live.writable) return;
          if (node.clientWidth === 0 || node.clientHeight === 0) return;
          fitScreen(terminal, addon, live.environment, model);
        };
        var observer =
          typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
        observer?.observe(node);
        var detach = model.mount();
        markTime("mount");
        measure();
        return () => {
          observer?.disconnect();
          input.dispose();
          emulatorRef.current = undefined;
          fitRef.current = undefined;
          try {
            if (typeof detach === "function") detach();
          } catch {
            /* the process outlives the DOM lifetime */
          }
          terminal.dispose();
        };
        // `environment` arrives asynchronously from the host; it is read live
        // through liveRef instead of re-creating the emulator.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [model]);

      // xterm needs concrete colors, so they are read off the element the
      // stylesheet paints from tokens, and re-read on a phase change.
      useLayoutEffect(() => {
        var terminal = emulatorRef.current;
        var node = hostRef.current;
        if (terminal === undefined || node === null) return;
        terminal.options.theme = readTheme(node);
      }, [state ? state.phase : undefined, model]);

      // The frame protocol: replay a snapshot, append output, then ACK — the
      // host withholds the next frame until this write's callback runs.
      useLayoutEffect(() => {
        var terminal = emulatorRef.current;
        var render = state ? state.render : undefined;
        if (terminal === undefined || render === undefined) return;
        if (render.revision <= lastRevision.current) return;
        lastRevision.current = render.revision;
        if (render.frame.type === "snapshot") {
          terminal.reset();
          var frameInfo = render.frame.info;
          if (frameInfo) terminal.resize(frameInfo.cols, frameInfo.rows);
          terminal.write(render.frame.screen, () => model.acknowledge(render.revision));
          return;
        }
        if (render.frame.type === "output") {
          terminal.write(render.frame.data, () => model.acknowledge(render.revision));
          return;
        }
        model.acknowledge(render.revision);
      }, [state ? state.render : undefined, model]);

      // Input control follows the host's attachment state.
      useLayoutEffect(() => {
        var terminal = emulatorRef.current;
        if (terminal === undefined) return;
        terminal.options.disableStdin = !writable;
        if (props.visible && writable) {
          fitScreen(terminal, fitRef.current, environment, model);
        } else if (info !== undefined && !writable) {
          terminal.resize(info.cols, info.rows);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [props.visible, writable, environment, info, model]);

      // Type the startup command once the host hands us input control. The
      // marker is keyed by the terminal id and mirrored into sessionStorage,
      // so re-mounting the panel or reloading the page reattaches to the SAME
      // PTY without typing the command twice — while a new terminal (or a
      // session id that resolved late) still gets it.
      var lastResend = useRef(0);
      useLayoutEffect(() => {
        var key = sentKeyOf(model, props.sessionId, contentId);
        var forced =
          props.resendSignal > 0 && lastResend.current !== props.resendSignal;
        lastResend.current = props.resendSignal;
        if (forced) clearSent(key);
        // `ready` waits for the connection list: typing the built-in default
        // before the config arrives would run the wrong command in the shell.
        if (!writable || !props.ready || hasSent(key)) return;
        try {
          model.write(props.command +"\r");
        } catch {
          return;
        }
        markSent(key);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [writable, props.resendSignal, model, contentId, props.command, props.ready]);

      useEffect(() => {
        if (props.visible && writable) {
          var emulator = emulatorRef.current;
          if (emulator && typeof emulator.focus === "function") emulator.focus();
        }
      }, [props.visible, writable]);

      // The host takes a moment to allocate the PTY and start the shell; say so
      // instead of showing a dark rectangle that looks like a hang.
      var connecting =
        !writable &&
        state !== null &&
        state !== undefined &&
        (state.phase === "idle" ||
          state.phase === "loading" ||
          state.phase === "creating" ||
          state.phase === "connecting");
      return h(
        "div",
        { className: "dsh-herdr-stage" },
        h("div", { className: "dsh-herdr-screen", ref: hostRef }),
        connecting
          ? h(
              "div",
              { className: "dsh-herdr-overlay" },
              h(
                "span",
                { className: "dsh-herdr-overlay-text" },
                phaseLabel(state.phase),
              ),
            )
          : null,
      );
    }

    /**
     * The host wraps every slot entry in its own error boundary, but that one
     * renders an invisible marker (`<div data-slot-error="main">`) and abdicates
     * the entry — i.e. a render throw shows up as a blank panel with nothing in
     * the DOM. This local boundary turns any future throw into readable text.
     */
    class HerdrBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error) {
        // eslint-disable-next-line no-console
        console.error("dsh-herdr: panel render failed:", error);
      }
      render() {
        if (this.state.error) {
          return h(
            "div",
            { className: "dsh-herdr-notice" },
            "Herdr 页面渲染失败：" +
              (this.state.error && this.state.error.message
                ? this.state.error.message
                : String(this.state.error)),
          );
        }
        return this.props.children;
      }
    }

    function HerdrView(props) {
      var ctx = props.ctx;
      var visible = props.visible !== false;
      // First mount of the panel body: the first leg of the open pipeline.
      if (TIMES.render === undefined) markTime("render");
      var service = useMemo(() => findWebTerminals(ctx), [ctx]);
      var [run, setRun] = useState(runtime.run);
      var [resendSignal, setResendSignal] = useState(0);
      var [assetsReady, setAssetsReady] = useState(window.__dshHerdrAssetsLoaded === true);
      var [assetsError, setAssetsError] = useState(null);

      useEffect(() => {
        if (assetsReady) return undefined;
        ensureTerminalAssets()
          .then(() => {
            markTime("assets");
            setAssetsReady(true);
          })
          .catch((error) => setAssetsError(error));
        return undefined;
      }, [assetsReady]);

      // The connection list is the plugin config, so one install serves any
      // machine. Until the route answers, the built-in default keeps the page
      // usable (and a failed route leaves it that way).
      var [connections, setConnections] = useState(
        Array.isArray(window.__dshHerdrConnections) &&
          window.__dshHerdrConnections.length > 0
          ? window.__dshHerdrConnections
          : [DEFAULT_CONNECTION],
      );
      var [connectionIndex, setConnectionIndex] = useState(runtime.connectionIndex);
      var [connectionsReady, setConnectionsReady] = useState(
        window.__dshHerdrConnectionsLoaded === true,
      );
      var connection =
        connections[connectionIndex] ?? connections[0] ?? DEFAULT_CONNECTION;

      useEffect(() => {
        loadConnections()
          .then((list) => {
            setConnections(list);
            setConnectionIndex((current) => Math.min(current, list.length - 1));
            setConnectionsReady(true);
          })
          .catch(() => {
            /* keep the default connection */
            setConnectionsReady(true);
          });
        return undefined;
      }, []);

      // The current session, when the host publishes one.
      var seat = useSyncExternalStore(
        useCallback(
          (listener) => {
            var observer = seatObserver(ctx);
            if (!observer || typeof observer.subscribe !== "function") return () => {};
            return observer.subscribe(listener);
          },
          [ctx],
        ),
        () => seatSessionId(ctx),
      );

      var ownerSession =
        props.owner && typeof props.owner.sessionId === "string" ? props.owner.sessionId : "";
      var scopeSession =
        props.scope && typeof props.scope.sessionId === "string" ? props.scope.sessionId : "";
      var candidate = scopeSession || seat || ownerSession;

      // Freeze the first real session id so panel mounts never swap the PTY.
      var sessionId = useMemo(() => {
        if (!runtime.sessionId && candidate) runtime.sessionId = candidate;
        return runtime.sessionId || candidate || FALLBACK_SESSION;
      }, [candidate]);

      var contentId = "herdr:" + connectionIndex + ":" + run;
      var model = useMemo(() => {
        if (!service || !sessionId) return undefined;
        return obtainModel(service, sessionId, contentId);
      }, [service, sessionId, contentId]);
      // The host allocates the PTY here, so this is the second leg.
      if (model !== undefined && TIMES.model === undefined) markTime("model");

      useEffect(() => {
        recordDiag({
          sessionId: sessionId,
          service: service ? "webTerminals" : "missing",
          assetsReady: assetsReady,
          assetsError: assetsError ? String(assetsError.message || assetsError) : undefined,
          modelId: model && typeof model.id === "string" ? model.id : undefined,
          connection: connection.label,
          command: connection.command,
        });
      }, [sessionId, service, assetsReady, assetsError, model, connection]);

      var onNewTerminal = useCallback(() => {
        runtime.run += 1;
        setRun(runtime.run);
      }, []);

      // Switching connection is the same as "new terminal" for the host: the
      // contentId changes, so the old view is closed and a fresh PTY is made.
      var onPickConnection = useCallback(
        (event) => {
          var next = Number(event.target.value);
          if (!Number.isInteger(next) || next < 0 || next >= connections.length) return;
          if (next === connectionIndex) return;
          runtime.connectionIndex = next;
          setConnectionIndex(next);
        },
        [connections.length, connectionIndex],
      );

      var onResend = useCallback(() => setResendSignal((value) => value + 1), []);

      // `refresh()` is the host's "retry this tab": it adopts the live process
      // when there is one and only allocates a new PTY when there is not.
      var onReconnect = useCallback(() => {
        if (!model) return;
        try {
          var pending = model.refresh();
          if (pending && typeof pending.catch === "function") pending.catch(() => {});
        } catch {
          /* the host reports the failure through the state snapshot */
        }
      }, [model]);

      var body;
      if (assetsError) {
        body = h(
          "div",
          { className: "dsh-herdr-notice" },
          "终端组件加载失败：",
          h("code", null, String(assetsError.message || assetsError)),
          h("br", null),
          "请确认插件的宿主半已注册 /herdr 资源路由。",
        );
      } else if (!assetsReady) {
        body = h("div", { className: "dsh-herdr-placeholder" }, "正在加载终端组件…");
      } else if (!service) {
        body = h(
          "div",
          { className: "dsh-herdr-notice" },
          "当前 DSH 部署没有提供宿主终端服务（webTerminals），因此无法内嵌 Herdr。",
        );
      } else if (model === undefined) {
        body = h("div", { className: "dsh-herdr-placeholder" }, "无法创建终端。");
      } else {
        body = h(TerminalScreen, {
          model: model,
          contentId: contentId,
          sessionId: sessionId,
          command: connection.command,
          ready: connectionsReady,
          visible: visible,
          resendSignal: resendSignal,
        });
      }

      return h(
        HerdrBoundary,
        null,
        h(
          "div",
          { className: "dsh-herdr-root" },
          h(
            "div",
            { className: "dsh-herdr-toolbar" },
            connections.length > 1
              ? h(
                  "select",
                  {
                    className: "dsh-herdr-picker",
                    value: String(connectionIndex),
                    title: "选择要连接的 Herdr 会话",
                    onChange: onPickConnection,
                  },
                  connections.map((item, index) =>
                    h("option", { key: String(index), value: String(index) }, item.label),
                  ),
                )
              : null,
            h("span", { className: "dsh-herdr-command", title: connection.command }, connection.command),
            h("span", { className: "dsh-herdr-spacer" }),
            h("span", { className: "dsh-herdr-session", title: sessionId }, shortSessionId(sessionId)),
            model ? h(StatusText, { model: model }) : null,
            h("button", { type: "button", className: "dsh-herdr-btn", onClick: onReconnect, disabled: model === undefined }, "重连"),
            h("button", { type: "button", className: "dsh-herdr-btn", onClick: onResend }, "重新执行"),
            h("button", { type: "button", className: "dsh-herdr-btn", onClick: onNewTerminal }, "新终端"),
          ),
          body,
        ),
      );
    }

    var inject = ["slots", "sessions"];

    function apply(ctx) {
      markTime("apply");
      ensureStyle();
      // Warm the asset cache while the sidebar is still being read, so opening
      // the panel does not pay the xterm download (the largest asset is ~490 KB).
      ensureTerminalAssets().catch(() => {
        /* the panel reports the failure if the route is really unavailable */
      });
      // Warm the connection list too: it is one small request, and having it
      // ready means the first command does not wait for a round trip.
      loadConnections().catch(() => {
        /* the panel falls back to the default connection */
      });
      var slots = findSlots(ctx);
      if (slots === undefined) {
        ctx.logger?.warn?.("dsh-herdr: slots 服务不可用，未注册 Herdr 侧栏入口。");
        return;
      }
      var disposers = [];
      // The icon row in the left sidebar's panel list.
      disposers.push(
        slots.inject("sidebar.panellist", () =>
          slots.register(
            {
              name: "sidebar.panellist",
              id: PANEL_ID,
              order: 30,
              label: () => "Herdr",
            },
            (owner) =>
              h(HerdrIcon, {
                size: owner && typeof owner.size === "number" ? owner.size : undefined,
              }),
          ),
        ),
      );
      // The panel body shown when that entry is selected.
      disposers.push(
        slots.inject("main", () =>
          slots.register({ name: "main", key: PANEL_ID }, (owner) =>
            h(HerdrView, { ctx: ctx, owner: owner }),
          ),
        ),
      );
      ctx.effect(
        () => () => {
          disposers.forEach((disposer) => {
            try {
              if (typeof disposer === "function") disposer();
            } catch {
              /* the slot is already gone */
            }
          });
        },
        "dsh-herdr: Herdr left sidebar entry",
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
