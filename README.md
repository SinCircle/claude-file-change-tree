# claude-file-change-tree

从 Claude Code 状态栏中提取的**文件修改树**（file-modification-tree）代码——
源自 [`claude-hud`](https://github.com/jarrodwatts/claude-hud) 插件（v0.1.0），
整理成一个精简、自包含、可直接运行的仓库。

当 Claude Code 在会话期间编辑文件时，底部状态栏会渲染一棵树，列出所有被添加 /
修改 / 删除 / 移动的文件，带有 `├── │ └──` 连接线、彩色符号、每个文件的
`(+N/-M)` 行数差异，以及自动折叠机制，使其始终控制在 ~6 行的预算内。
**本仓库就是该功能的独立提取版，并附有完整文档。**

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

## 归属与来源

- **原始作者：** © 2026 [Jarrod Watts](https://github.com/jarrodwatts)，
  基于 **MIT 许可证** 发布（详见 [`LICENSE`](./LICENSE)）。
- **来源：** `claude-hud` Claude Code 插件，版本 `0.1.0`。
- **复制内容：** 文件树渲染器（`render/lines/new-files.js`）、
  颜色辅助函数（`render/colors.js`）以及文件变更提取器
  （`getFileChanges` + 辅助函数，原始内联于 `index.js`）。这些都是
  插件发布版 `dist/` 输出的**逐字节复制**。
- **为什么是编译后的 JS 而非 TypeScript：** 插件仅发布编译后的
  `dist/*.js`（外加 `.d.ts`）；原始 `src/*.ts` 并未公开，且
  source map 中不包含 `sourcesContent`。因此最忠实、可读的产物
  就是编译后的 JS —— 它未经压缩并保留了所有原始注释。
- **唯一所做的修改：** 为 `getFileChanges` 添加了 `export`，使其可以作为模块导入。
  除此之外未更改任何逻辑。详见 [`src/file-changes.js`](./src/file-changes.js)
  中的确切来源说明。

---

## 仓库结构

```
.
├── LICENSE                 # MIT — 来自 claude-hud 的原样许可（© Jarrod Watts）
├── package.json
├── README.md               # 本文件
├── example/
│   └── demo.js             # 可运行演示：tools -> getFileChanges -> render
└── src/
    ├── file-changes.js     # getFileChanges(tools, cwd) + 所有辅助函数（数据层）
    ├── types.d.ts          # ModifiedFileSummary、ToolEntry、精简的 RenderContext
    └── render/
        ├── colors.js       # ANSI 颜色辅助函数（逐字节复制）
        ├── colors.d.ts
        └── lines/
            ├── new-files.js   # renderNewFilesLine(ctx) — 树形渲染器（逐字节复制）
            └── new-files.d.ts
```

`src/render/...` 的子目录结构被有意保留，以便原始相对导入
（`new-files.js` 中的 `../colors.js`）能够原封不动地正常工作。

---

## 工作原理

分为两层：数据层（data）和渲染层（render）：

### 1. 数据层 — `getFileChanges(tools, cwd)` → `ModifiedFileSummary[]`

将一系列工具调用记录转换为每个文件的聚合记录。它能识别：

| 工具 | 可识别的操作 |
|------|------------|
| `Write` | 新建文件（或删除行时视为修改） |
| `Edit` | 修改，根据 `resultText` 或 `oldString`/`newString` 的 LCS 差异计算 `+N/-M` |
| `Bash` | `rm`/`del`（删除）、`mv`（移动 → 带来源的 `mv_added`）、`cp`（复制 → 带来源的新增）、`mkdir`/`touch`（创建）、`unzip`/`tar`/`7z`（解压 → 创建目录） |

此外它还会：
- 规范化 Windows/Unix 路径，并将相对路径基于 `cwd` 进行解析。
- 将所有内容重新根植于项目的 LCA（最低公共祖先）之下（这样深层嵌套的绝对路径
  会折叠成一棵以项目名称为根的整洁树形结构）。
- 区分内部文件（位于 `cwd` 之下）和外部文件，并合并跨扩展名共享基础名称的
  批量条目（例如 `foo.js`、`foo.ts` → `foo(.ts)`）。

### 2. 渲染层 — `renderNewFilesLine(ctx)` → 树形字符串

根据 `ctx.modifiedFiles` 构建树并渲染。为了始终控制在
**6 行预算**（`MAX_TREE_LINES`）之内，它会按以下三级策略逐级回退：

1. **完整树** — 每个文件独占一行。在本身就符合预算时使用。
2. **混合内联** — 仅将*最短*的单文件目录链（`路径/文件`）内联到一行，
   以便在填满预算的同时不截断长路径。
3. **预算模式** — 保持树形结构，但每个文件夹只显示最近被修改过的文件；
   每个文件夹中较旧的直接文件会折叠成一条
   `├── +a added, ~m modified, -d deleted` 摘要行，放在该文件夹下。

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

## 许可证

MIT — © 2026 Jarrod Watts。详见 [`LICENSE`](./LICENSE)。
