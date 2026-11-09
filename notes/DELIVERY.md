# 交付说明：dsh-prompt-stash / 提示词稿箱

## 一、还没确认的（先看这里）

1. **画面没有看过。** 这个会话能查 Client Slots、能读插件自己上报的运行状态，但控制不了运行中的 Electron 窗口（主进程没开 `--remote-debugging-port`，BrowserSkill 接不到桌面端）。所以这些**没有截图、没有点击证据**：右边栏窄宽度下的实际排版、亮/暗主题观感、卡片网格密度、小面板里的字号可读性、新增的「放弃并打开」确认条长什么样。CSS 里能推的（300px 下按钮换行、容器查询只作用于后代）已经按推断修过，但没有眼睛确认。
2. **真实输入框的手感没验。** 「注入」走 `inputActions.setDraft(全文)`，「发送」走 `setDraft + persistDraft + submit`；服务端渲染测试与 jsdom 真键盘事件测试都证明**调用序列正确、不抢焦点、发送没有快捷键**，但真实 contenteditable 替换后的光标位置/滚动观感属于真机手感，没验。
3. **`/prompt` 的名字冲突风险。** 客户端命令若与宿主命令重名，会在 `/` 菜单打开时抛错并让整个菜单空掉（注册时拦不住）。已确认 `@deepseek-ai/*` 里没有名为 `prompt` 的人类命令，但这属于「大概率安全」而非「证明安全」。
4. **附件式注入没做。** 需求里是可选项。DSH 有附件（`inputActions.addAttachments` + 宿主 `fileUploads`/`attachments`），但从字符串到 `attachmentId` 需要一次会话往返，语义也变成「模型读一个文件」而不是「提示词进输入框」。默认保持替换语义，理由见 README。
5. **跨进程并发没测。** README 里「同一进程内串行化」是准确的；两个 DSH 实例指向同一个存档目录时没有互斥保护，没有测过。

## 二、已确认的（证据）

### 安装

| 项 | 值 |
| --- | --- |
| 插件目录 | `E:home	estpluginsdsh-prompt-stash` |
| 包名 / bundle id | `dsh-prompt-stash` |
| 版本 | 0.1.0 |
| 安装方式 | `plugin_manager install_bundle`（本地目录 link），`application: applied`，`warnings: []` |
| profile | desktop |
| 外部运行时依赖 | 无（只用 `require('react')` 与主题 token；不引用任何 Harness Client 包） |
| profile 一致性 | `package.json` 依赖与 `pnpm-lock.yaml` 都已包含 `dsh-prompt-stash: link:...` |

### 端到端（真实页面，不只是单测）

`~/.dsh/prompt-stash/diagnostics.json` 是浏览器半自己上报的回执，最新一条（2026-11-05T03:35:01Z）：

| 字段 | 值 | 含义 |
| --- | --- | --- |
| `build` | `0.1.0` | 当前页面加载的构建标签 |
| `pageBase` | `dsh-app://app/` | 确认是桌面端自定义协议页 |
| `tabType` / `tabGuide` | `registered` / `registered` | 右侧栏标签页类型与 guide 条目都注册成功 |
| `tabBody` / `tabChip` | `registered` / `registered` | 标签页 body 与 chip 槽位（key `prompt-stash:editor`） |
| `command` | `registered` | `/prompt` 客户端命令 |
| `rail` / `main` | `registered` / `registered` | 左栏 `id` 与主面板 `key` 都是 `prompt-stash` |
| `editorMounted` | `2026-11-05T03:32:21Z` | **编辑器标签页 body 真的挂载了** |
| `composer` | `present` | **`inputActions` 到位**（注入/发送所需的会话输入面） |
| `openTab` | `{ ok: true, deferred: true }` | **真实页面里打开成功了**，而且走的是「全局面板占用中栏 → 先回对话 → 延迟打开」那条恢复路径 |
| `errors` | `[]` | 没有异常 |

### 真实使用留下的数据（不是测试造的）

`<dsh home>/prompt-stash` 里出现了一条**使用者自己**在界面上按 Ctrl+S 存下的稿件（内容属于私人写作，这里不复述）：

- `library.json` 里的一条 note 记录带齐了元数据字段：标题、标签数组、颜色（hex）、
  会话引用 `{id, title, cwd}`、工作区引用 `{id, name, path}`、`lines` / `chars` / 摘要，
  且摘要是正文的截断；
- 正文落在 `notes/<id>.md`，是独立的 UTF-8 markdown 文件，与元数据分离。

也就是说：编辑 → Ctrl+S → 落进全局 dsh 目录 → 元数据带会话/工作区/标签/颜色、正文单独成 .md，这条真实链路已经跑通了。

Slots 直查（`cordis_inspect_query`，不依赖插件自述）：`sidebar.panellist` 有 `id: "prompt-stash", order: 7, active: true`；`main` 有 `key: "prompt-stash"`；`sidebar.right.pane.tab` 与 `.title` 都有 `key: "prompt-stash:editor"`。

Host 侧：路由 `/prompt-stash/api` 以 `prefix` 挂载，未授权请求得 403（fence 失败即拒绝，fail-closed），页面自身发来的 20+ 次 POST 全部 `allowed=true`；`mount.json` 显示 Host 每次重挂的时间。

### 测试

`node --test tests/` **65 项全过**（model 14 / host 20 / ui 8 / dom 16 / entry 7）；`node build.mjs` 幂等（连跑两次 `client.js` 哈希不变）。

| 文件 | 覆盖 |
| --- | --- |
| `tests/model.test.mjs` | 翻译/lang/日期单位（中英）、标题推导、相对时间、时间分桶、范围/关键词/颜色/标签筛选、四种分组、排序、facets、文档映射、颜色归一、routeUrl 保留反向代理前缀 |
| `tests/host.test.mjs` | `WebRoute` 行为、目录解析（含 `profileContext.home`）、id 安全性、归一化、空库、创建、原地更新、正文读写、路径穿越拒绝、元数据不动正文、设置合并、模板生成草稿（空模板也能）、**删除动作不存在**、坏 JSON/未知动作/错误方法、connection fence、坏库文件降级、自定义目录、回执累积/读回/超长截断/顺序 |
| `tests/ui.test.mjs` | 服务端渲染：存档页控件/分组/卡片/空态/错误态重试/**无 delete 文案**；编辑器标题/正文/标签/三按键/快捷键徽章/未保存草稿恢复/无输入框时禁用；左栏图标；Markdown 渲染**原始 HTML 不注入**、发送按钮无快捷键徽章 |
| `tests/dom.test.mjs` | jsdom 真组件 + 真键盘事件：Ctrl+S 保存载荷、双击 Ctrl+S 只保存一次、**保存期间继续输入不被回滚**、Ctrl+Enter 替换且不抢焦点、发送=替换+提交且无快捷键、空稿无操作、无 composer/无 submit 时禁用、卡片点击打开、模板按钮只生草稿、**模板按钮上的按键不冒泡成卡片打开**、脏稿确认条、开文件夹失败弹提示 |
| `tests/entry.test.mjs` | 真 `entry.js` + 假 Cordis 上下文：五个注册的 id/key 对齐、`/prompt` 直接打开、`/prompt` 在全局面板占用中栏时先 `selectPanel(null)` 再延迟打开、模板生成草稿、空白草稿请求、`openDocument` 请求形状、回执上报 |

### 没有删除功能

- 存档页没有删除按钮或删除菜单；页脚明写「不做删除，文件都在磁盘上」。
- Host action 表里没有删除动作（`delete/remove/trash/destroy` 全部返回 `unknown-action`），也断言了 `deleteEntry`/`removeEntry` 不存在。
- DOM 测试断言存档页所有按钮文案都不含「删除/delete/remove」。

## 三、独立审查两轮（已修）
### 第二轮回审（R1–R6）

审查者在修完 B1/B2 后又看了一遍，确认两个 blocker 关闭（并独立观察到我这边真实页面回执里 `openTab: {ok:true, deferred:true}`），同时提出三条新的 should-fix 和三条 nit。处理如下：

| id | 问题 | 处理 |
| --- | --- | --- |
| R1 | 保存请求在途时继续打字，保存返回后会把编辑器**回滚成点击时的快照**（本地草稿也被清空） | 保存结果合并到 `latestDoc.current`，只有「提交的四个字段与最新文档一致」时才清本地草稿并标 saved，否则保留新文本并维持 dirty；DOM 测试「保存期间继续输入不被回滚」 |
| R2 | 在「用模板新建」按钮上按 Enter，按键冒泡到卡片 → 打开模板本身，`preventDefault` 又把按钮自己的激活吃掉 | 卡片 keydown 加 `event.target !== event.currentTarget` 早退；DOM 测试「模板按钮上的按键不冒泡成卡片打开」 |
| R3 | 无会话时「新建草稿」先发一个无会话请求并立刻提示成功，延迟打开再失败，且那条过期请求可能被下一个编辑器接走 | 改成 120ms 后再解析会话：拿到会话才 `requestOpen` + 打开 + 提示；拿不到就只提示「先在任意会话里按 /prompt」，不再留过期请求 |
| R4 | 80ms 延迟打开的定时器不归插件所有 | 插件层 `pendingTimers` + 一个 effect 在卸载时全部清掉 |
| R6 | 被丢弃的过期 `load` 会让状态卡在 loading | 丢弃结果时仍把 status 置回 ready |

未处理的 nit：会话标题/cwd 变化不会实时刷新到编辑器（挂载时读一次）；模板卡片「整卡点击=编辑模板」的交互可再商量；`formatExact` tooltip 是固定的 `YYYY-MM-DD HH:mm`。都不影响功能。

## 三之二、第一轮审查（B1/B2）

一位独立审查者（只读，不改文件）在 52 个用例的版本上做了对抗性审查，报告在 `notes/AUDIT.md`。两个 blocker 都真实存在，已修：

| id | 问题 | 修法 | 现在的证据 |
| --- | --- | --- | --- |
| B1 | 模板卡片的「用模板新建」其实是**打开模板本身**，保存会覆盖模板；`fromTemplate` 是死代码 | 新增 `runtime.newDraftFromTemplate(id)` → `M.fromTemplate` → 按**新草稿 id** 请求打开；卡片按钮改走它，卡片本身仍用于编辑模板 | `entry.test`「模板卡片生成草稿而不是打开模板」+ DOM「模板卡片只生草稿」 |
| B2 | 存档页是主面板时，右侧栏的 on-screen session 被清空（`activePanelId !== null`），新建/打开全部抛错；`goChat` 传的是 `'conversation'` 而宿主只认 `null` | `openEditorTab` 检测到无会话时先 `selectPanel(null)` 再延迟 80ms 打开，失败再展开右边栏重试；`goChat` 改为 `selectPanel(null)`；新增 `newBlankDraft` 走同样流程 | `entry.test` 模拟 mounted 为空：断言 `selectPanel(null)` 然后延迟 `openTab`；**真实页面回执 `openTab: { ok: true, deferred: true }`** |

同轮修掉的 should-fix：Ctrl+S 在途保护（双击只保存一次）、自动草稿只在 dirty 时写入并在卸载时同步 flush、`t.lang` 与日期单位双语、以及四条「测不出东西」的测试重写（其中新增 `entry.test.mjs`）。nits 里也顺手修了：Markdown 兄弟 key 唯一、窄栏按钮换行、`report` 回执超长截断+加锁+随机临时名、模板读取纳入同一个锁、注入/发送失败用各自的文案、脏稿确认按钮改叫「放弃并打开」、保存后用宿主归一化后的字段回填编辑器、fence 失败即拒绝、`load` 与 `save` 的竞态令牌。

仍未处理的 nits：会话标题/cwd 变化不会实时刷新到编辑器（只在挂载时读一次）；`formatExact` 的 tooltip 仍是 `YYYY-MM-DD HH:mm`。都不影响功能。

## 三之三、肉眼反馈修掉的一个真 bug（按钮字看不见）

使用者发来一张截图：存档页第一个按钮（「新建草稿」）是纯黑底、字完全看不见。

根因不是配色而是 CSS 优先级：基础规则 `.ps-root button { color: inherit }` 是 (0,1,1)，而填充按钮的 `.ps-btn-primary { color: … }` 只有 (0,1,0)——前者压过后者，按钮拿到的不是「主色上的前景色」，而是从父级继承下来的深色文字，于是黑底黑字。

修法：
- 基础重置降到零优先级 `.ps-root :where(button)`，并同理处理 input/textarea/select；
- 两个「有色底」的按钮（`.ps-btn-primary`）提到 `.ps-root .ps-btn-primary`（0,2,0），无论重置怎么写都不会再被抢；
- 顺手发现「发送」按钮的类名一直是 `ps-btn-send`，而填充样式写在从不匹配的 `.ps-send` 上——它其实一直是普通描边按钮。这里**保持描边**并写明理由：发送会立即提交且没有快捷键，不该做成编辑器里最抢眼的按钮。

回归测试：`tests/dom.test.mjs` 里 `getComputedStyle` 断言填充按钮的文字色必须解析到前景 token（且与底色不同），发送按钮则必须是描边语义。这条测试在修复前会失败。

## 四、安装过程中遇到的两件事

1. **`cpu-features` 每次 pnpm 安装都会重建失败**（`gyp: name 'enable_thin_lto' is not defined`），但 install exit code 0、依赖照常写入、bundle `application: applied`、`warnings: []`。这是 profile 里既有的 optional 包，不是本插件引入。
2. **一次 `remove_bundle` 撞上 `EPERM: rename package.json.tmp -> package.json`**（profile 目录被占用）。当时依赖与 bundle 行都还在，插件继续工作；之后重做了一次 remove+install，现在 `package.json` 与 `pnpm-lock.yaml` 一致。

## 五、重载方式（给后续改动用）

改完 `src/client/*.js` 后 `node build.mjs`，然后在 `plugin_manager` 里对这个 bundle 做一次 `set_bundle(false)` → `set_bundle(true)`；页面会掉一下再自动回来，新的 `client.js` 就被重新取用（本会话多次实测有效：`diagnostics` 的 `editorMounted` 时间戳会跟着变）。只改 `index.js`（Host 半）同样需要一次关/开，`mount.json` 的 `mountedAt` 会更新。

注意：这个「关/开」有时要等十几秒才轮到浏览器重新取模块；页面若一直没换，刷新一次即可。

## 六、还可以继续做的

- 在真实会话里按一次 `/prompt`：最新回执里 `openTab` 会带 `{ok:true}`，编辑器 body 挂载后 `editorMounted`/`composer` 也会刷新（当前回执里这两项已经出现过）。
- 若要附件式注入：加一个「注入方式」设置项，而不是改默认行为。
- 卡片的颜色/标签目前只能在编辑器里改；嫌绕的话可以加一个只含颜色/标签的小浮层——仍然不涉及删除。
- 会话改名/cwd 变化后的元数据刷新（需要订阅 sessions store）。
