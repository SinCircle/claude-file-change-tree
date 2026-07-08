import { green, yellow, red, magenta } from "../colors.js";
const TYPE_SYMBOL_MAP = {
    added: [green, '+'], modified: [yellow, '~'], deleted: [red, '-'],
    mv_added: [magenta, '+'],
};
function buildTree(files) {
    const root = new Map();
    for (const file of files) {
        const dp = file.basename, isTermDir = dp.endsWith('/');
        const parts = dp.replace(/\/$/, '').split('/');
        if (parts[0] === '')
            parts[0] = '/';
        let cur = root;
        for (let i = 0; i < parts.length; i++) {
            const name = parts[i], last = i === parts.length - 1;
            if (!cur.has(name))
                cur.set(name, { name, isDir: !last || isTermDir, file: null, children: new Map() });
            const node = cur.get(name);
            if (last) {
                node.isDir = isTermDir;
                node.file = file;
            }
            cur = node.children;
        }
    }
    return root;
}
function sortedEntries(map) {
    return [...map.entries()].sort((a, b) => {
        if (a[1].isDir !== b[1].isDir)
            return a[1].isDir ? -1 : 1;
        return a[0].localeCompare(b[0]);
    });
}
function showDirName(name) { return name === '/' ? '/' : name + '/'; }
function compressChain(node) {
    let path = showDirName(node.name), cur = node;
    while (cur.children.size === 1 && cur.isDir && !cur.file) {
        [cur] = cur.children.values();
        if (cur.isDir && !cur.file)
            path += showDirName(cur.name);
    }
    return { path, terminal: cur };
}
function fmtCompressedPath(path, _terminal) { return path; }
function formatFileChange(file, displayName) {
    const seq = file.typeSeq?.length > 0 ? file.typeSeq : (file.types instanceof Set ? [...file.types] : [file.type || 'modified']);
    const symbol = seq.map(op => { const [color, sym] = TYPE_SYMBOL_MAP[op] || [yellow, '~']; return color(sym); }).join('');
    const hasDiff = seq.some((op) => op === 'added' || op === 'modified');
    let suffix = '';
    if (file.cpSource)
        suffix = '(' + magenta('←') + file.cpSource + ')';
    else if (hasDiff) {
        const p = [];
        if (file.added > 0)
            p.push(green('+' + file.added));
        if (file.removed > 0)
            p.push(red('-' + file.removed));
        suffix = p.length > 0 ? '(' + p.join('') + ')' : '';
    }
    return symbol + (displayName ?? file.basename) + suffix;
}
function formatNode(node) {
    if (!node.file)
        return showDirName(node.name);
    return formatFileChange(node.file, node.isDir ? showDirName(node.name) : node.name);
}
function renderChildren(parent, prefix) {
    const lines = [];
    for (const [i, [, child]] of sortedEntries(parent.children).entries()) {
        const last = i === parent.children.size - 1, conn = last ? '└── ' : '├── ';
        const cp = prefix + (last ? '    ' : '│   ');
        if (child.isDir && child.children.size === 1 && !child.file) {
            const { path, terminal } = compressChain(child);
            lines.push(prefix + conn + fmtCompressedPath(path, terminal));
            if (terminal.children.size > 0) {
                if (terminal.file) {
                    lines.push(cp + '└── ' + formatNode(terminal));
                    lines.push(...renderChildren(terminal, cp + '    '));
                }
                else
                    lines.push(...renderChildren(terminal, cp));
            }
            else if (terminal.file)
                lines.push(cp + '└── ' + formatNode(terminal));
        }
        else {
            lines.push(prefix + conn + formatNode(child));
            if (child.children.size > 0)
                lines.push(...renderChildren(child, cp));
        }
    }
    return lines;
}
// Max visible lines for the file tree. When the full tree would exceed this,
// subtrees are collapsed (showing a per-folder count) to fit within it.
const MAX_TREE_LINES = 6;
const EMPTY_SET = new Set();
// Categorize one file into a single summary bucket by its typeSeq:
// deleted wins; then added/mv_added (new file); otherwise modified.
function fileChangeBucket(file) {
    const seq = file.typeSeq?.length > 0 ? file.typeSeq : (file.types instanceof Set ? [...file.types] : [file.type || 'modified']);
    if (seq.includes('deleted'))
        return 'deleted';
    if (seq.some((op) => op === 'added' || op === 'mv_added'))
        return 'added';
    return 'modified';
}
// Format a bucket summary like "+3 added, ~4 modified, -1 deleted" (zero buckets omitted).
function formatBucketSummary(buckets) {
    const parts = [];
    if (buckets.added > 0)
        parts.push(`${green('+')}${buckets.added} added`);
    if (buckets.modified > 0)
        parts.push(`${yellow('~')}${buckets.modified} modified`);
    if (buckets.deleted > 0)
        parts.push(`${red('-')}${buckets.deleted} deleted`);
    return parts.join(', ');
}
// Per-folder count suffix, e.g. "+3 added, ~4 modified, -1 deleted".
function bucketSuffix(buckets) {
    return formatBucketSummary(buckets);
}
// Follow a chain of single-child no-file non-collapsed dirs from `node`,
// returning the compressed path, the terminal where the chain stops, and the
// terminal kind: 'collapsed' (chain ends at a collapsed dir), 'file' (a file
// leaf), 'fileevent' (a dir with its own file event), or 'branch' (a
// multi-child / leaf dir whose name is already included in `path`).
function compressChainCollapsed(node, collapsed) {
    let path = showDirName(node.name);
    let cur = node;
    while (cur.children.size === 1 && cur.isDir && !cur.file && !collapsed.has(cur)) {
        const next = cur.children.values().next().value;
        cur = next;
        if (collapsed.has(cur)) {
            path += showDirName(cur.name);
            return { path, terminal: cur, kind: 'collapsed' };
        }
        if (cur.isDir && !cur.file) {
            path += showDirName(cur.name);
        }
        else {
            return { path, terminal: cur, kind: cur.isDir ? 'fileevent' : 'file' };
        }
    }
    return { path, terminal: cur, kind: 'branch' };
}
// Render a node's children (with tree connectors), collapse- and chain-aware.
// `inlineSet` holds chain terminals to render inline (path+file on one line).
function renderChildrenCollapsed(parent, prefix, collapsed, inlineSet) {
    const lines = [];
    const kids = sortedEntries(parent.children);
    kids.forEach(([, child], i) => {
        const last = i === kids.length - 1;
        const conn = last ? '└── ' : '├── ';
        const cp = prefix + (last ? '    ' : '│   ');
        lines.push(...renderNodeCollapsed(child, prefix, conn, cp, collapsed, inlineSet));
    });
    return lines;
}
// Render a single node given its connector and the prefix for its children.
function renderNodeCollapsed(node, prefix, conn, cp, collapsed, inlineSet) {
    if (collapsed.has(node)) {
        return [prefix + conn + showDirName(node.name) + bucketSuffix(node.buckets)];
    }
    if (node.children.size === 0) {
        return [prefix + conn + formatNode(node)];
    }
    if (node.isDir && !node.file && node.children.size === 1) {
        const { path, terminal, kind } = compressChainCollapsed(node, collapsed);
        if (kind === 'collapsed') {
            return [prefix + conn + path + bucketSuffix(terminal.buckets)];
        }
        const lines = [prefix + conn + path];
        if (kind === 'file') {
            if (inlineSet.has(terminal))
                lines[0] += formatNode(terminal);
            else
                lines.push(cp + '└── ' + formatNode(terminal));
        }
        else if (kind === 'fileevent') {
            lines.push(cp + '└── ' + formatNode(terminal));
            lines.push(...renderChildrenCollapsed(terminal, cp + '    ', collapsed, inlineSet));
        }
        else {
            lines.push(...renderChildrenCollapsed(terminal, cp, collapsed, inlineSet));
        }
        return lines;
    }
    const lines = [prefix + conn + formatNode(node)];
    lines.push(...renderChildrenCollapsed(node, cp, collapsed, inlineSet));
    return lines;
}
// Top-level render (no connectors on root entries), collapse- and chain-aware.
// `inlineSet` holds chain terminals to render inline (path+file on one line).
// Used both for the final output and for line counting (via .length).
function renderTree(tree, ctx, collapsed, inlineSet) {
    const lines = [];
    const cwdName = ctx.stdin?.cwd?.replace(/\\/g, '/')
        .replace(/^\/\/([a-zA-Z])\//, (_, d) => d.toUpperCase() + ':/')
        .replace(/^\/([a-zA-Z])\//, (_, d) => d.toUpperCase() + ':/')
        .split('/').pop() || null;
    const entries = sortedEntries(tree).sort((a, b) => {
        if (a[0] === cwdName)
            return -1;
        if (b[0] === cwdName)
            return 1;
        return 0;
    });
    for (const [, node] of entries) {
        if (collapsed.has(node)) {
            lines.push(showDirName(node.name) + bucketSuffix(node.buckets));
        }
        else if (node.children.size === 0) {
            lines.push(formatNode(node));
        }
        else if (node.isDir && !node.file && node.children.size === 1) {
            const { path, terminal, kind } = compressChainCollapsed(node, collapsed);
            if (kind === 'collapsed') {
                lines.push(path + bucketSuffix(terminal.buckets));
            }
            else if (kind === 'file') {
                if (inlineSet.has(terminal))
                    lines.push(path + formatNode(terminal));
                else {
                    lines.push(path);
                    lines.push('└── ' + formatNode(terminal));
                }
            }
            else {
                lines.push(path);
                if (kind === 'fileevent') {
                    lines.push('└── ' + formatNode(terminal));
                    lines.push(...renderChildrenCollapsed(terminal, '    ', collapsed, inlineSet));
                }
                else {
                    lines.push(...renderChildrenCollapsed(terminal, '', collapsed, inlineSet));
                }
            }
        }
        else {
            lines.push(formatNode(node));
            lines.push(...renderChildrenCollapsed(node, '', collapsed, inlineSet));
        }
    }
    return lines;
}
// --- Tier 3: budgeted tree render with per-folder `└── ` summaries ---
//
// Keeps the tree structure. Instead of collapsing a whole folder to one count
// line (which wastes the line budget when one folder has many files), each
// folder expands its most-recently-updated files and collapses that folder's
// OLDER direct files into a single `└── +a added, ~m modified, -d deleted`
// summary line as the last child of that folder. A folder whose subtree has NO
// shown files collapses to one count line (the old behavior) - this only kicks
// in when even showing one recent file wouldn't fit (e.g. many 1-file
// subfolders). Top-level (root) files with no folder get a trailing summary.
//
// `shownFiles` = the set of file records to expand. renderTreeBudgeted picks
// the largest K such that the K most-recent files (by `lastTime`) shown still
// fits <= MAX_TREE_LINES. lines(K) is non-decreasing in K (showing a file never
// reduces line count), so scanning K from high to low, the first fit is the
// most files we can keep visible.
function annotateShown(node, shownFiles) {
    let fileCount = 0, shownCount = 0;
    const buckets = { added: 0, modified: 0, deleted: 0 };
    if (node.file) {
        fileCount += 1;
        buckets[fileChangeBucket(node.file)] += 1;
        if (shownFiles.has(node.file))
            shownCount += 1;
    }
    for (const [, child] of node.children) {
        annotateShown(child, shownFiles);
        fileCount += child.fileCount;
        shownCount += child.shownCount;
        buckets.added += child.buckets.added;
        buckets.modified += child.buckets.modified;
        buckets.deleted += child.buckets.deleted;
    }
    node.fileCount = fileCount;
    node.shownCount = shownCount;
    node.buckets = buckets;
    node.hasShown = shownCount > 0;
}
// A folder collapses to one count line when its subtree has files but none are
// shown (all older than the recency cutoff).
function isCollapsedNode(node) {
    return node.fileCount > 0 && node.shownCount === 0;
}
function compressChainShown(node) {
    let path = showDirName(node.name);
    let cur = node;
    while (cur.children.size === 1 && cur.isDir && !cur.file && !isCollapsedNode(cur)) {
        const next = cur.children.values().next().value;
        cur = next;
        if (isCollapsedNode(cur)) {
            path += showDirName(cur.name);
            return { path, terminal: cur, kind: 'collapsed' };
        }
        if (cur.isDir && !cur.file) {
            path += showDirName(cur.name);
        }
        else {
            return { path, terminal: cur, kind: cur.isDir ? 'fileevent' : 'file' };
        }
    }
    return { path, terminal: cur, kind: 'branch' };
}
// A collapsed folder whose subtree holds exactly ONE file: render it inline
// (path + file, 1 line, shows the filename) instead of a count summary - same
// 1-line cost, strictly more informative.
function renderCollapsedSingleFile(node) {
    if (node.file)
        return formatNode(node);
    const { path, terminal } = compressChain(node);
    return path + formatNode(terminal);
}
function renderNodeShown(node, prefix, conn, cp, shownFiles) {
    if (isCollapsedNode(node)) {
        if (node.fileCount === 1)
            return [prefix + conn + renderCollapsedSingleFile(node)];
        return [prefix + conn + showDirName(node.name) + bucketSuffix(node.buckets)];
    }
    if (node.children.size === 0) {
        return [prefix + conn + formatNode(node)];
    }
    if (node.isDir && !node.file && node.children.size === 1) {
        const { path, terminal, kind } = compressChainShown(node);
        if (kind === 'collapsed') {
            return [prefix + conn + path + bucketSuffix(terminal.buckets)];
        }
        const lines = [prefix + conn + path];
        if (kind === 'file') {
            lines[0] += formatNode(terminal);
        }
        else if (kind === 'fileevent') {
            lines.push(cp + '└── ' + formatNode(terminal));
            lines.push(...renderChildrenShown(terminal, cp + '    ', shownFiles));
        }
        else {
            lines.push(...renderChildrenShown(terminal, cp, shownFiles));
        }
        return lines;
    }
    const lines = [prefix + conn + formatNode(node)];
    lines.push(...renderChildrenShown(node, cp, shownFiles));
    return lines;
}
// Render a folder's children: subfolders (recursed) + shown direct files
// (most-recent first) + one `└── ` summary line for the older direct files.
function renderChildrenShown(parent, prefix, shownFiles) {
    const lines = [];
    const folders = [];
    const fileLeaves = [];
    for (const [, child] of sortedEntries(parent.children)) {
        if (child.children.size > 0)
            folders.push(child);
        else if (child.file)
            fileLeaves.push(child);
    }
    fileLeaves.sort((a, b) => {
        const ta = a.file?.lastTime?.getTime?.() || 0;
        const tb = b.file?.lastTime?.getTime?.() || 0;
        return tb - ta;
    });
    const shownLeaves = fileLeaves.filter((c) => shownFiles.has(c.file));
    const hiddenBuckets = { added: 0, modified: 0, deleted: 0 };
    for (const c of fileLeaves)
        if (!shownFiles.has(c.file))
            hiddenBuckets[fileChangeBucket(c.file)] += 1;
    const hasSummary = hiddenBuckets.added + hiddenBuckets.modified + hiddenBuckets.deleted > 0;
    const items = [];
    for (const f of folders)
        items.push({ kind: 'node', node: f });
    for (const f of shownLeaves)
        items.push({ kind: 'leaf', node: f });
    if (hasSummary)
        items.push({ kind: 'summary', buckets: hiddenBuckets });
    items.forEach((item, i) => {
        const last = i === items.length - 1;
        const conn = last ? '└── ' : '├── ';
        const cp = prefix + (last ? '    ' : '│   ');
        if (item.kind === 'summary') {
            lines.push(prefix + conn + formatBucketSummary(item.buckets));
        }
        else {
            lines.push(...renderNodeShown(item.node, prefix, conn, cp, shownFiles));
        }
    });
    return lines;
}
function renderTreeShown(tree, ctx, shownFiles) {
    const lines = [];
    const cwdName = ctx.stdin?.cwd?.replace(/\\/g, '/')
        .replace(/^\/\/([a-zA-Z])\//, (_, d) => d.toUpperCase() + ':/')
        .replace(/^\/([a-zA-Z])\//, (_, d) => d.toUpperCase() + ':/')
        .split('/').pop() || null;
    const entries = sortedEntries(tree).sort((a, b) => {
        if (a[0] === cwdName)
            return -1;
        if (b[0] === cwdName)
            return 1;
        return 0;
    });
    const fileLeaves = [];
    for (const [, node] of entries) {
        if (node.children.size === 0 && node.file)
            fileLeaves.push(node);
    }
    fileLeaves.sort((a, b) => {
        const ta = a.file?.lastTime?.getTime?.() || 0;
        const tb = b.file?.lastTime?.getTime?.() || 0;
        return tb - ta;
    });
    const hiddenTop = { added: 0, modified: 0, deleted: 0 };
    for (const n of fileLeaves)
        if (!shownFiles.has(n.file))
            hiddenTop[fileChangeBucket(n.file)] += 1;
    const hasTopSummary = hiddenTop.added + hiddenTop.modified + hiddenTop.deleted > 0;
    for (const [, node] of entries) {
        if (node.children.size > 0) {
            if (isCollapsedNode(node)) {
                lines.push(node.fileCount === 1 ? renderCollapsedSingleFile(node) : showDirName(node.name) + bucketSuffix(node.buckets));
            }
            else if (node.isDir && !node.file && node.children.size === 1) {
                const { path, terminal, kind } = compressChainShown(node);
                if (kind === 'collapsed') {
                    lines.push(path + bucketSuffix(terminal.buckets));
                }
                else if (kind === 'file') {
                    lines.push(path + formatNode(terminal));
                }
                else {
                    lines.push(path);
                    if (kind === 'fileevent') {
                        lines.push('└── ' + formatNode(terminal));
                        lines.push(...renderChildrenShown(terminal, '    ', shownFiles));
                    }
                    else {
                        lines.push(...renderChildrenShown(terminal, '', shownFiles));
                    }
                }
            }
            else {
                lines.push(formatNode(node));
                lines.push(...renderChildrenShown(node, '', shownFiles));
            }
        }
        else if (node.file && shownFiles.has(node.file)) {
            lines.push(formatNode(node));
        }
    }
    if (hasTopSummary)
        lines.push('└' + formatBucketSummary(hiddenTop));
    return lines;
}
function renderTreeBudgeted(ctx, files) {
    const tree = buildTree(files);
    const sorted = [...files].sort((a, b) => {
        const ta = a.lastTime ? a.lastTime.getTime() : 0;
        const tb = b.lastTime ? b.lastTime.getTime() : 0;
        return tb - ta;
    });
    let k0Lines = null;
    for (let K = sorted.length; K >= 0; K--) {
        const shown = new Set(sorted.slice(0, K));
        for (const [, node] of tree)
            annotateShown(node, shown);
        const lines = renderTreeShown(tree, ctx, shown);
        if (K === 0)
            k0Lines = lines;
        if (lines.length <= MAX_TREE_LINES)
            return lines.join('\n');
    }
    return k0Lines.join('\n');
}
// Collect every "file chain" (a run of single-child no-file dirs ending at a
// file leaf) in the tree. Each can render multi-line (`path/` + `└── file`,
// 2 lines) or inline (`path/file`, 1 line). `prefix` is the display path down
// to (not including) `node`, so the full inline length is prefix+chainPath+name.
function collectFileChains(node, prefix, out) {
    if (node.isDir && !node.file && node.children.size === 1) {
        const { path, terminal, kind } = compressChainCollapsed(node, EMPTY_SET);
        if (kind === 'file') {
            out.push({ terminal, len: (prefix + path + terminal.name).length });
            return;
        }
        const childPrefix = kind === 'fileevent'
            ? prefix + path + showDirName(terminal.name)
            : prefix + path;
        for (const [, c] of sortedEntries(terminal.children))
            collectFileChains(c, childPrefix, out);
        return;
    }
    const childPrefix = prefix + showDirName(node.name);
    for (const [, c] of sortedEntries(node.children))
        collectFileChains(c, childPrefix, out);
}
// Tier 2: per-position inline. A single-file folder chain is either multi-line
// (2 lines) or inline (1 line). Instead of inlining ALL chains at once (which
// under-fills the budget, e.g. 6 -> 3), inline only the SHORTEST-named chains
// (by full path length), just enough to fit <= MAX_TREE_LINES, keeping the
// longer-named ones multi-line so the budget is filled and long paths avoid
// width truncation. Returns null if even all-inlined overflows (caller falls
// back to the budgeted tier).
function renderTreeMixed(tree, ctx) {
    const chains = [];
    for (const [, node] of tree)
        collectFileChains(node, '', chains);
    chains.sort((a, b) => a.len - b.len);
    const inlineSet = new Set();
    let lines = renderTree(tree, ctx, EMPTY_SET, inlineSet);
    if (lines.length <= MAX_TREE_LINES)
        return lines;
    for (const { terminal } of chains) {
        inlineSet.add(terminal);
        lines = renderTree(tree, ctx, EMPTY_SET, inlineSet);
        if (lines.length <= MAX_TREE_LINES)
            return lines;
    }
    return null;
}
export function renderNewFilesLine(ctx) {
    if (ctx.config?.display?.showModifiedFiles === false)
        return null;
    const files = ctx.modifiedFiles;
    if (!files || files.length === 0)
        return null;
    const tree = buildTree(files);
    // 1) Full tree, each file on its own line (no inlining, no collapsing).
    const fullLines = renderTree(tree, ctx, new Set(), new Set());
    if (fullLines.length <= MAX_TREE_LINES) {
        return fullLines.join('\n');
    }
    // 2) Still too tall: inline only the shortest single-file chains, keeping
    //    the longer ones multi-line so the line budget is filled (not
    //    under-filled by inlining everything at once).
    const mixedLines = renderTreeMixed(tree, ctx);
    if (mixedLines && mixedLines.length <= MAX_TREE_LINES) {
        return mixedLines.join('\n');
    }
    // 3) Still too tall: keep the tree, but show only the most-recent files per
    //    folder and collapse each folder's older direct files into a per-folder
    //    count summary line under that folder (not one global summary).
    return renderTreeBudgeted(ctx, files);
}
//# sourceMappingURL=new-files.js.map