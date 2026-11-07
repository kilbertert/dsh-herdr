# dsh-herdr

把「打开 PowerShell → 输入 `workspace-us` → 连上服务器上的 herdr 会话」变成 DSH 里的一个页面。

安装后，DSH **左侧主边栏**的面板列表里会多出一个 **Herdr** 入口（和「插件 / 插件市场 / 上下文洞察」排在一起）。点进去就是一个内嵌的终端，页面打开时会**自动执行**默认连接：

```
herdr --remote dev-us --session work
```

也就是 PowerShell 里 `workspace-us` 的定义（见 `Microsoft.PowerShell_profile.ps1`）。这条命令来自插件配置，可以改成任何机器、任何会话——见下面的[配置](#配置连接列表)。

## 它是什么 / 不是什么

- **是**：DSH 左侧边栏的一个页面，里面跑着一个真正的 PTY，用 xterm.js 渲染 herdr 的 TUI。
- **不是**：Herdr GUI（Electron 应用）的嵌入。Herdr 官方没有可被 iframe 嵌的 Web 版，本机 `herdr` 命令是 Rust 写的 TUI，所以只能走「PTY + 终端模拟器」这条路。

## 工作原理

| 部分 | 文件 | 作用 |
| --- | --- | --- |
| 宿主半 | `lib/index.js` | 注册 `/herdr` 前缀路由，分发 xterm 的 3 个静态文件（`xterm.js` / `xterm.css` / `addon-fit.js`），并按插件配置动态生成 `/herdr/config.json`（连接列表） |
| 客户端半 | `lib/client.js` | 通过 `ctx.slots` 注册左栏入口（`sidebar.panellist` 图标 + `main` 面板）；用宿主的 `ctx.webTerminals` 服务开 PTY，用 xterm.js 渲染 |
| 挂载 | `cordis.patch.yml` | 把 `dsh-herdr` 这一行插进 profile 的启动树 |

关键点：**插件自己不创建任何进程**。PTY 由 DSH 自己的终端服务（`ctx.webTerminals`，即 `@deepseek-ai/dsh-api-terminal-controller` 的客户端 half）创建和管理，所以 Herdr 页面和 DSH 内置终端享受同一套 shell 解析、进程生命周期和断线重连。

## 安装

已收录进 DSH 插件市场（[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)），其他人可以在市场里直接搜 **Herdr** 安装。

本机（Windows）在 PowerShell 里执行：

```powershell
dsh plugin --profile desktop add D:\workspace\dsh-herdr
```

如果上面的命令不接受本地路径，用等价的手动方式：

1. 编辑 `C:\Users\q1234\.dsh\profiles\desktop\package.json`，在 `dsh.profile.bundles` 里加一项：

   ```json
   "dsh-herdr": "file:D:/workspace/dsh-herdr"
   ```

2. 在 `C:\Users\q1234\.dsh\profiles\desktop` 下执行 `pnpm install`。

3. 确认 `cordis.patch.yml` 里的 `- insert: [{ id: herdr, name: 'dsh-herdr' }]` 已经合并进 profile 的 patch 文件（`dsh plugin add` 会做这一步）。

然后**完全重启 DSH**（不是刷新页面），再打开 Web GUI。

## 使用

- 左侧边栏点 **Herdr** → 页面打开后自动连上默认连接。
- 工具条左侧的下拉框（配置了多条连接时才出现）可以切换要连的远程 / 会话；切换等于开一个新终端（旧 PTY 由插件关掉）。
- **重连**：让宿主终端服务重试一次（进程还在就复用，不在就新建一个 PTY）。
- **重新执行**：重发一次启动命令（终端还活着，等于再敲一遍 `workspace-us`）。
- **新终端**：换一个新的 contentId，等于开一个全新的 PTY；旧的那一个由插件自己关掉（DSH 的契约是「视图脱离 DOM 不等于进程结束」，所以必须显式关，否则会留下看不见的残留进程）。
- 切换左侧边栏面板再切回来：PTY 不会重开，也不会重复执行启动命令（客户端复用一个共享视图）。

终端用等宽字体渲染（优先取主题的 `--dsw-font-mono`，否则回退 `Consolas, Cascadia Mono, Courier New`），所以 herdr 的 TUI 界面不会出现字符间距被拉宽的情况。

首次点开的等待也被压到最低：插件在**侧栏加载时**就预热 xterm 资源（最大的 `xterm.js` 约 490 KB），连接列表只是一个本地小请求；PTY 由宿主并行分配，终端在拿到输入控制权前会显示「正在连接…」而不是黑屏。

## 配置：连接列表

插件不再为某一台机器写死命令。宿主半把配置生成成 `/herdr/config.json`，客户端打开页面时读它，工具条据此渲染下拉框并决定自动执行哪一条。

在 profile 的 `cordis.patch.yml` 里给 `dsh-herdr` 这一行加 `config:`：

```yaml
- id: herdr
  name: 'dsh-herdr'
  config:
    connections:
      - label: US / work
        remote: dev-us
        session: work
      - label: 本地
        command: herdr
      - label: Dev
        command: herdr --remote dev --session work
```

规则：

- `connections` 是数组；每条要么直接给 `command`（原样执行），要么给 `remote` / `session`（宿主半拼成 `herdr --remote <target> [--session <name>]`）。
- `label` 是下拉框里显示的名字，缺省用 `command`。
- `command` 为空的条目回退成 `herdr`，不会被跳过。
- 不写 `connections` 时，可以用扁平的 `remote` / `session` / `command` / `label` 配一条。
- 什么都不配 → 默认 `herdr`（等价于直接打开一个 Herdr 终端）。
- 配置缺失或 `/herdr/config.json` 取不到时，页面仍可用（按默认连接执行），不会白屏。

只有 1 条连接时工具条不显示下拉框；多条时才出现。

## 换一个远程 / 会话（不改代码）

按上面的 `config:` 加一条即可。比如想用 `workspace`（`herdr --remote dev --session work`）：

```yaml
- id: herdr
  name: 'dsh-herdr'
  config:
    connections:
      - label: US / work
        remote: dev-us
        session: work
      - label: Dev / work
        remote: dev
        session: work
```

## 故障排查

| 现象 | 原因 / 处理 |
| --- | --- |
| 页面显示「终端组件加载失败」 | 宿主半没起来，`/herdr` 路由没注册。看 DSH 日志；确认 `lib/index.js` 里的 `resolvePackageDir()` 找到了 `@xterm/xterm`。 |
| 页面显示「没有提供宿主终端服务」 | 当前 DSH 部署没有 `ctx.webTerminals`（web profile 应该有）。 |
| 页面打开了但 herdr 没启动 | 终端还没拿到输入控制权（`writable`）。点「重新执行」。 |
| 侧栏里没有 Herdr 入口 | `ctx.slots` 服务不可用（DSH 版本过旧），或插件没启用。看 DSH 日志里有没有 `slots 服务不可用` 的告警。 |
| 终端能打开但工具条上的会话是 `herdr` | 宿主没有发布当前会话。插件按 `ctx.uiSession.current` → `ctx.sidebarRight.mounted` → `sessions.list` 里 `retainedBy.mainView > 0` 的会话 → `localStorage` 的 `dsh.sessions.current` 依次解析，全都没有时才回退到字面量 `herdr`。PTY 一样能跑，只是不归属某个 DSH 会话。 |
| 状态显示「连接失败：…」 | 冒号后面是宿主终端服务给出的原始错误（`state.error`），按它定位。 |
| 状态显示「连接失败：missingTerminal」 | 宿主把 `contentId → terminalId` 存在 `localStorage`（`dsh.terminal.binding.v1.*`）里，DSH 重启后那个进程已经没了，宿主只会一直回这个错、**自己不会清掉旧绑定**。插件检测到后会自动调 `service.close()` 丢弃旧绑定并重新分配一个 PTY，无需手动处理。 |
| 切走再切回 Herdr 会闪一下黑屏 / 「正在连接…」 | 视图脱离 DOM 不会结束进程（宿主契约），但重新挂载时宿主会先重连流。插件会记住上一帧画面并立刻重画，状态显示「正在恢复…」而不是冷启动。 |
| 切回后画面正常但键盘 / 点击没反应 | 模拟器的输入订阅必须跟着模拟器一起存活（模拟器是跨面板切换复用的）。插件已按此实现；若状态栏出现「（输入未送达：…）」，那是宿主拒绝了输入（`webTerminals.write()` 在终端不可写或没有流附件时**静默丢弃**，不抛错）。点「重连」，并把状态栏文案与诊断记录一起反馈。 |
| 主题色不对 | 颜色是从页面的 `--dsw-*` CSS 变量读的，跟随 DSH 主题。 |

## 诊断记录

插件会把最近一次的状态写进页面的 `localStorage`，键名 `dsh-herdr:state`，内容类似：

```json
{"t":"2026-11-07T06:20:00.000Z","sessionId":"session-1f07ac81-…","service":"webTerminals","assetsReady":true,"modelId":"b7c1…","contentId":"herdr:0:0","phase":"failed","error":"terminal/unavailable: …","connection":"US / work","command":"herdr --remote dev-us --session work"}
```

`contentId` 的格式是 `herdr:<连接序号>:<终端序号>`。

它只写在同一个 DSH 页面来源里，不上传、不跨站。**遇到「页面空白 / 连接失败」时，把这个键的值一起发出来**，就能直接看到插件解析到的会话 id、PTY 阶段和宿主给的原始错误，不用再猜。

## xterm 资源从哪来

`lib/index.js` 会按以下顺序找 `@xterm/xterm` 和 `@xterm/addon-fit` 的包目录：

1. 插件配置里的 `xtermDir` / `fitDir`（绝对路径，指向包目录本身）；
2. 插件自己的 `node_modules` 链（`createRequire`）；
3. 从插件目录和 `process.cwd()` 逐级向上找 `node_modules/<pkg>`。

DSH profile 用的是 pnpm `nodeLinker: hoisted`，所以通常第 3 步就能在
`C:\Users\q1234\.dsh\profiles\desktop\node_modules\@xterm\` 找到。
找不到时可以用配置覆盖，例如：

```json
{
  "herdr": {
    "xtermDir": "C:/Users/q1234/.dsh/profiles/desktop/node_modules/@xterm/xterm",
    "fitDir": "C:/Users/q1234/.dsh/profiles/desktop/node_modules/@xterm/addon-fit"
  }
}
```

## 安全说明

- `/herdr` 路由只暴露 3 个白名单文件，其他路径一律 404。
- 路由带连接层校验（`ctx.connection.requestRejection`），非本机浏览器请求会被拒。
- 插件不读写任何凭据文件，也不保存 herdr 的会话内容。
- 唯一持久化的是上面那个 `localStorage` 诊断键，且只存在于本机 DSH 页面。
