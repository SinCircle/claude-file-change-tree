# claude-file-change-tree

从修改过的 [`claude-hud`](https://github.com/jarrodwatts/claude-hud) 插件中
提取出来的**文件修改树**（file-modification-tree）功能——
这是一个 claude-hud 原本**不具备**的特性，在 claude-hud 分支中
从零设计实现并集成，现整理成独立、可直接运行的仓库。

当 Claude Code 在会话期间编辑文件时，底部状态栏会渲染一棵树，列出所有被添加 /
修改 / 删除 / 移动的文件，带有 `├── │ └──` 连接线、彩色符号、每个文件的
`(+N/-M)` 行数差异，以及自动折叠机制，使其始终控制在 ~6 行的预算内。

```
myproject/
├── +reports/
├── src/
│   ├── +app.js(+1)
│   └── +index.js(+2)
└── ~README.md(+1)
```

> `+` 符号为绿色（新增），`~` 为黄色（修改），`-` 为红色（删除），
> 移动的文件会显示一个洋红色的 `+` 及其来源路径。运行演示即可看到真实的 ANSI 颜色。

---

## 背景

[`claude-hud`](https://github.com/jarrodwatts/claude-hud) 是
[Jarrod Watts](https://github.com/jarrodwatts) 开发的一个优秀的 Claude Code
状态栏插件（MIT 协议），它本身提供了项目路径、上下文窗口用量、工具活动、
Git 状态、Token 配额等功能，但**不包含文件修改树**。

由于原版 claude-hud 缺少直观的文件变更概览，该文件修改树模块
在 claude-hud 分支中从零实现，随后作为独立功能提取到此仓库，
方便单独使用或集成。

---

## 归属与许可

- **文件修改树实现**（`src/file-changes.js`、`src/render/lines/new-files.js`、
  `example/demo.js`、`src/types.d.ts`）——由 SinCircle 原创编写。
- **颜色辅助模块**（`src/render/colors.js`）——逐字节复制自 claude-hud，
  版权 © 2026 Jarrod Watts。

本项目整体基于 **MIT 许可证** 发布，详见 [`LICENSE`](./LICENSE)。

---

## 仓库结构

```
.
├── LICENSE                 # MIT — 双重版权（SinCircle + © Jarrod Watts）
├── package.json
├── README.md               # 本文件
├── example/
│   └── demo.js             # 可运行演示：tools -> getFileChanges -> render
└── src/
    ├── file-changes.js     # getFileChanges(tools, cwd) + 所有辅助函数（数据层）
    ├── types.d.ts          # ModifiedFileSummary、ToolEntry、精简的 RenderContext
    └── render/
        ├── colors.js       # ANSI 颜色辅助函数（源自 claude-hud，© Jarrod Watts）
        ├── colors.d.ts
        └── lines/
            ├── new-files.js   # renderNewFilesLine(ctx) — 树形渲染器
            └── new-files.d.ts
```


---

## 工作原理

分为**数据层**和**渲染层**：

- **`getFileChanges(tools, cwd)`** — 将工具调用记录（Write、Edit、Bash 等）转换为每个文件的聚合变更摘要，自动处理路径规范化和目录树重根。
- **`renderNewFilesLine(ctx)`** — 根据变更列表构建并渲染彩色树形输出，内置行数预算控制，在变更较多时自动折叠以保持简洁。

---

## 运行演示

需要 Node.js ≥ 18。

```bash
node example/demo.js
```

输出（一个包含 4 次变更的会话：两个新文件、一次编辑、一次 `mkdir`）：

```
myproject/
├── +reports/
├── src/
│   ├── +app.js(+1)
│   └── +index.js(+2)
└── ~README.md(+1)
```

---

## 集成到你自己的状态栏

```js
import { getFileChanges } from './src/file-changes.js';
import { renderNewFilesLine } from './src/render/lines/new-files.js';

// `tools` 是会话记录中的工具调用列表；
// 每个条目匹配 src/types.d.ts 中的 ToolEntry 类型。
const modifiedFiles = getFileChanges(tools, stdin.cwd);

const tree = renderNewFilesLine({
  stdin,                                   // { cwd }
  config: { display: { showModifiedFiles: true } },
  modifiedFiles,
});

if (tree) console.log(tree);               // 没有任何变更时返回 null
```

关键字段：

- `tools: ToolEntry[]` — 参见 [`src/types.d.ts`](./src/types.d.ts)。仅
  `status === 'completed'` 的条目会被计算在内。
- `ctx.config.display.showModifiedFiles === false` 会完全隐藏文件树。
- `ctx.stdin.cwd` 用于将树根植于当前项目目录。

---

## 致谢

- [Jarrod Watts](https://github.com/jarrodwatts) 的
  [`claude-hud`](https://github.com/jarrodwatts/claude-hud) 插件为本项目提供了
  ANSI 颜色基础设施（`colors.js`），以及一个优秀的扩展平台。

---

## 许可证

MIT — 详见 [`LICENSE`](./LICENSE)。其中：
- `src/render/colors.js` 版权 © 2026 Jarrod Watts
- 其余代码版权 © 2026 SinCircle
