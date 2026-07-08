/**
 * file-changes.js
 *
 * Extracted VERBATIM from claude-hud v0.1.0 dist/index.js (original lines
 * 124-690): the getFileChanges(tools, cwd) function plus every helper it
 * depends on. This is the data layer of the file-modification-tree feature -
 * it turns a list of tool invocations (Write / Edit / Bash rm|mv|cp|mkdir|
 * touch|unzip) into a ModifiedFileSummary[] that the tree renderer consumes.
 *
 * The ONLY change from the original: export was added to getFileChanges so it
 * can be imported as a module. No other logic was modified.
 *
 * Source: claude-hud by Jarrod Watts (MIT, (c) 2026 Jarrod Watts)
 * Runtime: Node.js >= 18. Uses only the process.cwd() global - no imports.
 */

// ---- helpers ----------------------------------------------------------------
function normalizeWinPath(p) {
    return p.replace(/\\/g, '/')
        .replace(/^\/\/([a-zA-Z])\//, (_, d) => d.toUpperCase() + ':/')
        .replace(/^\/([a-zA-Z])\//, (_, d) => d.toUpperCase() + ':/')
        .replace(/^([a-zA-Z]):\//, (_, d) => d.toUpperCase() + ':/');
}
function makeDisplayPath(p) { return normalizeWinPath(p); }
function safeBasename(t) {
    const s = t.split(/[/\\]/).filter(Boolean);
    return s.length > 0 ? s[s.length - 1] : null;
}
function countLines(t) {
    if (!t)
        return 0;
    const n = t.split('\n').length;
    return t.endsWith('\n') ? n - 1 : n;
}
function splitLines(t) {
    if (!t)
        return [];
    const s = t.endsWith('\n') ? t.slice(0, -1) : t;
    return s.length === 0 ? [] : s.split('\n');
}
function lcsLen(a, b) {
    const [R, C] = a.length >= b.length ? [a, b] : [b, a];
    let p = new Uint32Array(C.length + 1), c = new Uint32Array(C.length + 1);
    for (let i = 0; i < R.length; i++) {
        for (let j = 0; j < C.length; j++) {
            c[j + 1] = R[i] === C[j] ? p[j] + 1 : Math.max(p[j + 1], c[j]);
        }
        [p, c] = [c, p];
        c.fill(0);
    }
    return p[C.length];
}
function diffEditStrings(o, n) {
    const O = splitLines(o), N = splitLines(n);
    const c = lcsLen(O, N);
    return { added: N.length - c, removed: O.length - c };
}
function parseDiffResult(r) {
    if (!r)
        return null;
    const a = r.match(/Added\s+(\d+)\s+lines?/i), d = r.match(/[Rr]emoved\s+(\d+)\s+lines?/);
    if (!a && !d)
        return null;
    return { added: a ? parseInt(a[1], 10) : 0, removed: d ? parseInt(d[1], 10) : 0 };
}
function pushOp(seq, op) {
    if (seq.length === 0 || seq[seq.length - 1] !== op)
        seq.push(op);
}
function resolveRel(base, rel) {
    if (!rel)
        return base;
    if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel))
        return normalizeWinPath(rel);
    const p = normalizeWinPath(base).split('/');
    for (const x of rel.split('/')) {
        if (x === '..')
            p.pop();
        else if (x !== '.')
            p.push(x);
    }
    return p.join('/');
}
function findLcaPaths(paths) {
    const p = paths.map(x => x.replace(/\\/g, '/').split('/'));
    const l = [], n = Math.min(...p.map(x => x.length));
    for (let i = 0; i < n; i++) {
        if (p.every(x => x[i] === p[0][i]))
            l.push(p[0][i]);
        else
            break;
    }
    return { lcaLen: l.length };
}
// Longest common ancestor path (as joined segments) over a set of normalized posix paths.
// Returns [] when the paths share no meaningful common root — including the degenerate case
// where they share only the filesystem root "/" (or a lone drive letter), since that is not
// a useful project root and would otherwise make isAncestor() match every absolute path.
function computeLca(paths) {
    if (paths.length === 0)
        return [];
    const p = paths.map(x => x.replace(/\\/g, '/').split('/'));
    const l = [], n = Math.min(...p.map(x => x.length));
    for (let i = 0; i < n; i++) {
        if (p.every(x => x[i] === p[0][i]))
            l.push(p[0][i]);
        else
            break;
    }
    return l.length <= 1 ? [] : l;
}
function relFromLca(abs, n) {
    return abs.replace(/\\/g, '/').split('/').slice(n).join('/');
}
// ---- shell tokenizer -------------------------------------------------------
function tokenizeArgs(str) {
    const a = [];
    let i = 0;
    while (i < str.length) {
        if (str[i] === ' ' || str[i] === '\t') {
            i++;
            continue;
        }
        if (str[i] === '\'') {
            const e = str.indexOf('\'', i + 1);
            const v = e > -1 ? str.slice(i + 1, e) : str.slice(i + 1);
            a.push(v);
            i = e > -1 ? e + 1 : str.length;
            continue;
        }
        if (str[i] === '"') {
            const e = str.indexOf('"', i + 1);
            const v = e > -1 ? str.slice(i + 1, e) : str.slice(i + 1);
            a.push(v);
            i = e > -1 ? e + 1 : str.length;
            continue;
        }
        let j = i;
        while (j < str.length && str[j] !== ' ' && str[j] !== '\t')
            j++;
        a.push(str.slice(i, j));
        i = j;
    }
    return a;
}
function splitSubCommands(cmd) {
    const r = [];
    let cur = '', i = 0;
    while (i < cmd.length) {
        if (cmd[i] === '\'') {
            const e = cmd.indexOf('\'', i + 1);
            cur += cmd.slice(i, (e > -1 ? e + 1 : cmd.length));
            i = e > -1 ? e + 1 : cmd.length;
            continue;
        }
        if (cmd[i] === '"') {
            const e = cmd.indexOf('"', i + 1);
            cur += cmd.slice(i, (e > -1 ? e + 1 : cmd.length));
            i = e > -1 ? e + 1 : cmd.length;
            continue;
        }
        if (cmd.slice(i, i + 2) === '&&') {
            r.push(cur.trim());
            cur = '';
            i += 2;
            continue;
        }
        if (cmd[i] === ';') {
            r.push(cur.trim());
            cur = '';
            i += 1;
            continue;
        }
        if (cmd[i] === '\n' || cmd[i] === '\r') {
            if (cur.trim())
                r.push(cur.trim());
            cur = '';
            i += 1;
            continue;
        }
        cur += cmd[i];
        i++;
    }
    if (cur.trim())
        r.push(cur.trim());
    return r;
}
function isFlag(s) { return s.startsWith('-') || s.startsWith('$'); }
function isLikelyPath(s) {
    if (s === '' || s === '/' || isFlag(s))
        return false;
    if (/^[0-9]+$/.test(s))
        return false;
    if (/[{}<>|!@#%^&]/.test(s))
        return false;
    // * in a path token is almost always a shell glob, not a literal filename
    if (s.includes('*'))
        return false;
    // : is only valid as a Windows drive letter (e.g., C:/..., D:\...)
    const colonIdx = s.indexOf(':');
    if (colonIdx !== -1) {
        // Drive letter must be at position 1 (second char), preceded by A-Z/a-z
        if (colonIdx !== 1 || !/^[A-Za-z]$/.test(s[0]))
            return false;
    }
    return true;
}
// Extract a GNU-style target-directory (-t DIR / --target-directory DIR / --target-directory=DIR)
// from a command's argument list. Returns the target dir (raw token) and the remaining args
// with the flag and its value removed. Used by mv/cp where sources move INTO the target dir.
function takeTargetDir(args) {
    const rest = [];
    let target = null;
    for (let k = 1; k < args.length; k++) {
        const a = args[k];
        if (target === null) {
            if (a === '-t' || a === '--target-directory') {
                if (k + 1 < args.length) {
                    target = args[k + 1];
                    k++;
                }
                continue;
            }
            if (a.startsWith('--target-directory=')) {
                target = a.slice('--target-directory='.length);
                continue;
            }
        }
        rest.push(a);
    }
    return { target, rest };
}
function joinDir(dir, base) {
    return (dir.endsWith('/') ? dir : dir + '/') + base;
}
function parseBashCommand(cmd, cwdAbs) {
    const ops = [];
    let curBase = normalizeWinPath(cwdAbs);
    const R = (rel) => resolveRel(curBase, rel);
    for (const sub of splitSubCommands(cmd)) {
        const args = tokenizeArgs(sub);
        if (args.length === 0)
            continue;
        const cmdName = args[0];
        if (cmdName === 'cd' && args.length > 1) {
            curBase = resolveRel(curBase, args[1]);
            continue;
        }
        const paths = args.slice(1).filter(isLikelyPath);
        if (cmdName === 'rm' || cmdName === 'del') {
            for (const p of paths) {
                if (safeBasename(p))
                    ops.push({ type: 'delete', path: R(p), isDir: p.endsWith('/') });
            }
        }
        else if (cmdName === 'mv') {
            const { target: tdir, rest } = takeTargetDir(args);
            if (tdir && isLikelyPath(tdir)) {
                // `mv -t DIR a b c` → move every source INTO DIR
                for (const src of rest.filter(isLikelyPath)) {
                    const base = safeBasename(src);
                    if (base)
                        ops.push({ type: 'mv_add', path: R(joinDir(tdir, base)), isDir: src.endsWith('/'), cpSrcRaw: R(src) });
                }
            }
            else if (paths.length >= 2) {
                const last = paths[paths.length - 1];
                const destDir = last.endsWith('/') || last === '.' || last === '..' || paths.length > 2;
                for (let k = 0; k < paths.length - 1; k++) {
                    const src = paths[k];
                    if (!safeBasename(src))
                        continue;
                    if (destDir) {
                        const base = safeBasename(src);
                        if (base) {
                            const d = last === '.' ? '' : last === '..' ? '../' : (last.endsWith('/') ? last : last + '/');
                            ops.push({ type: 'mv_add', path: R(d + base), isDir: src.endsWith('/'), cpSrcRaw: R(src) });
                        }
                    }
                    else {
                        const d = paths[paths.length - 1];
                        if (safeBasename(d))
                            ops.push({ type: 'mv_add', path: R(d), isDir: false, cpSrcRaw: R(src) });
                    }
                }
            }
        }
        else if (cmdName === 'cp') {
            const { target: tdir, rest } = takeTargetDir(args);
            if (tdir && isLikelyPath(tdir)) {
                // `cp -t DIR a b c` → copy every source INTO DIR
                for (const s of rest.filter(isLikelyPath)) {
                    const base = safeBasename(s);
                    if (base)
                        ops.push({ type: 'copy', path: R(joinDir(tdir, base)), isDir: false, cpSrcRaw: R(s) });
                }
            }
            else if (paths.length >= 2) {
                const dest = paths[paths.length - 1], destDirFlag = dest.endsWith('/');
                const srcs = paths.slice(0, -1).filter(p => safeBasename(p));
                if (destDirFlag) {
                    for (const s of srcs) {
                        const base = safeBasename(s);
                        if (base) {
                            const target = dest.replace(/\/$/, '') + '/' + base;
                            ops.push({ type: 'copy', path: R(target), isDir: false, cpSrcRaw: R(s) });
                        }
                    }
                }
                else {
                    for (const s of srcs)
                        ops.push({ type: 'copy', path: R(dest), isDir: false, cpSrcRaw: R(s) });
                }
            }
        }
        else if (cmdName === 'mkdir') {
            for (const p of paths) {
                if (safeBasename(p.replace(/\/$/, '')))
                    ops.push({ type: 'create', path: R(p.endsWith('/') ? p : p + '/'), isDir: true });
            }
        }
        else if (cmdName === 'touch') {
            for (const p of paths) {
                if (safeBasename(p))
                    ops.push({ type: 'create', path: R(p), isDir: false });
            }
        }
        else if (cmdName === 'unzip' || cmdName === 'tar' || cmdName === '7z') {
            let extractDir = null;
            for (let k = 1; k < args.length; k++) {
                if ((args[k] === '-d' || args[k] === '-C') && k + 1 < args.length) {
                    extractDir = args[k + 1];
                    break;
                }
                if (args[k].startsWith('-o') && args[k].length > 2) {
                    extractDir = args[k].slice(2);
                    break;
                }
                if (args[k].startsWith('-d') && args[k].length > 2) {
                    extractDir = args[k].slice(2);
                    break;
                }
            }
            if (extractDir && isLikelyPath(extractDir) && safeBasename(extractDir.replace(/\/$/, ''))) {
                ops.push({ type: 'create', path: R(extractDir.endsWith('/') ? extractDir : extractDir + '/'), isDir: true });
            }
        }
        // Note: shell redirects (`> file`, `>> file`) are intentionally NOT treated
        // as file changes. They almost always capture throwaway output from
        // read-only commands (e.g. `git log > out.txt`, `node -e ... > x.txt`),
        // which pollutes the file tree with non-modifications. Real file writes
        // are already captured by the Write/Edit tool entries.
    }
    return ops;
}
// Resolve a path that may be relative against cwd, returning an absolute path
function toAbsoluteToolPath(p, cwd) {
    // Already absolute: Unix /foo/bar or Windows C:/foo/bar or C:\foo\bar
    if (p.startsWith('/') || /^[A-Za-z]:/.test(p))
        return normalizeWinPath(p);
    // Relative path — resolve against cwd
    return resolveRel(normalizeWinPath(cwd), p);
}
export function getFileChanges(tools, cwd) {
    const m = new Map();
    for (const t of tools) {
        if (t.status !== 'completed')
            continue;
        if (t.name === 'Write') {
            if (!t.target)
                continue;
            const rawPath = t.target;
            if (!safeBasename(rawPath))
                continue;
            const k = toAbsoluteToolPath(rawPath, cwd);
            const d = parseDiffResult(t.resultText);
            const op = d && d.removed > 0 ? 'modified' : 'added';
            const dp = makeDisplayPath(k);
            const ex = m.get(k);
            if (ex) {
                if (d) {
                    ex.added += d.added;
                    ex.removed = (ex.removed ?? 0) + d.removed;
                }
                else {
                    ex.added += typeof t.content === 'string' ? countLines(t.content) : 0;
                }
                pushOp(ex.typeSeq, op);
                ex.lastTime = t.startTime;
            }
            else {
                const ad = typeof t.content === 'string' ? countLines(t.content) : undefined;
                m.set(k, { path: k, basename: dp, typeSeq: [op], added: d ? d.added : (ad ?? 0), removed: d ? d.removed : 0, lastTime: t.startTime });
            }
        }
        else if (t.name === 'Edit') {
            const rawPath = t.target;
            if (!rawPath || !safeBasename(rawPath))
                continue;
            const k = toAbsoluteToolPath(rawPath, cwd);
            const et = t;
            const d = parseDiffResult(et.resultText) ?? diffEditStrings(et.oldString ?? '', et.newString ?? '');
            const dp = makeDisplayPath(k);
            const ex = m.get(k);
            if (ex) {
                ex.added += d.added;
                ex.removed = (ex.removed ?? 0) + d.removed;
                pushOp(ex.typeSeq, 'modified');
                ex.lastTime = t.startTime;
            }
            else {
                m.set(k, { path: k, basename: dp, typeSeq: ['modified'], added: d.added, removed: d.removed, lastTime: t.startTime });
            }
        }
        else if (t.name === 'Bash' && t.command) {
            const ops = parseBashCommand(t.command, normalizeWinPath(cwd));
            for (const op of ops) {
                const res = op.path, dp = makeDisplayPath(res);
                const dn = op.isDir ? (dp.endsWith('/') ? dp : dp + '/') : dp;
                const ex = m.get(res);
                if (op.type === 'delete') {
                    if (ex) {
                        ex.removed = undefined;
                        ex.basename = dn;
                        pushOp(ex.typeSeq, 'deleted');
                        ex.lastTime = t.startTime;
                    }
                    else {
                        m.set(res, { path: res, basename: dn, typeSeq: ['deleted'], added: 0, removed: undefined, batch: true, lastTime: t.startTime });
                    }
                }
                else if (op.type === 'mv_add' || op.type === 'copy') {
                    const srcRes = op.cpSrcRaw || null;
                    let cpSrc = '';
                    if (srcRes) {
                        const allP = [srcRes, res];
                        const { lcaLen } = findLcaPaths(allP);
                        const cut = lcaLen > 0 ? lcaLen - 1 : 0;
                        const parts = srcRes.split('/');
                        const lcaName = cut < parts.length ? parts[cut] + '/' : '';
                        const rel = relFromLca(srcRes, cut + 1);
                        cpSrc = rel ? lcaName + rel : lcaName.replace(/\/$/, '');
                    }
                    const mvType = op.type === 'mv_add' ? 'mv_added' : 'added';
                    if (ex) {
                        pushOp(ex.typeSeq, mvType);
                        if (cpSrc)
                            ex.cpSource = cpSrc;
                        ex.lastTime = t.startTime;
                    }
                    else {
                        m.set(res, { path: res, basename: dn, typeSeq: [mvType], added: 0, removed: undefined, cpSource: cpSrc || undefined, batch: true, lastTime: t.startTime });
                    }
                }
                else if (op.type === 'create') {
                    if (ex) {
                        pushOp(ex.typeSeq, 'added');
                        ex.lastTime = t.startTime;
                    }
                    else {
                        m.set(res, { path: res, basename: dn, typeSeq: ['added'], added: 0, removed: undefined, batch: true, lastTime: t.startTime });
                    }
                }
            }
        }
    }
    const rawEntries = Array.from(m.values());
    if (rawEntries.length === 0)
        return undefined;
    const nCwd = cwd ? normalizeWinPath(cwd).replace(/\/$/, '') : null;
    let procCwd = null;
    try {
        procCwd = normalizeWinPath(process.cwd()).replace(/\/$/, '');
    }
    catch {
        procCwd = null;
    }
    // Case-insensitive "anc is p or an ancestor dir of p".
    const isAncestor = (anc, p) => {
        const a = anc.toLowerCase(), b = p.toLowerCase();
        return b === a || b.startsWith(a + '/');
    };
    // split internal (under cwd) / external (elsewhere). When cwd is unknown, everything is internal.
    const internal = [], external = [];
    for (const e of rawEntries) {
        const p = e.basename.replace(/\/$/, '');
        if (!nCwd || isAncestor(nCwd, p))
            internal.push(e);
        else
            external.push(e);
    }
    // External files (not under cwd) reveal the real project root when they live ABOVE cwd -
    // i.e. cwd was a subfolder. Group them by root segment (drive letter / leading-slash root)
    // first, so unrelated roots (e.g. C:/ vs /tmp) don't poison each other's LCA: a single /tmp
    // file mixed with C:/ project files would otherwise make the global LCA empty, leaving the
    // C:/ files rooted at the drive and collapsing to "C:/+...".
    const cwdSeg = nCwd ? nCwd.replace(/\\/g, '/').split('/')[0] : null;
    const externalGroups = new Map();
    if (external.length > 0) {
        for (const e of external) {
            const seg = e.basename.replace(/\/$/, '').replace(/\\/g, '/').split('/')[0];
            if (!externalGroups.has(seg))
                externalGroups.set(seg, []);
            externalGroups.get(seg).push(e);
        }
    }
    // The "primary" external group = same root as cwd (the project drive). Its LCA, anchored with
    // cwd, reveals the real project root when cwd was a subfolder.
    const primaryGroup = (cwdSeg && externalGroups.get(cwdSeg)) || [];
    const externalLca = primaryGroup.length > 0
        ? computeLca([nCwd, ...primaryGroup.map(e => e.basename.replace(/\/$/, ''))].filter((x) => !!x))
        : [];
    // Derive the root for INTERNAL files from cwd + internal paths only. Internal files are
    // always rooted relative to cwd (cwd IS the project) - never merged under an external LCA,
    // even when externals sit above cwd: externals are often unrelated to the cwd project (e.g.
    // ~/.claude plugin/memory edits while cwd is a project subfolder), and merging would nest
    // cwd files under the wrong root (e.g. "qyf06/Desktop/test/..." instead of "test/...").
    // process.cwd() is added when it is cwd's parent (cwd a subfolder, procCwd the project root).
    const inputs = [];
    if (nCwd)
        inputs.push(nCwd);
    if (procCwd && nCwd && isAncestor(procCwd, nCwd) && procCwd !== nCwd)
        inputs.push(procCwd);
    if (procCwd && !nCwd && internal.some(e => isAncestor(procCwd, e.basename.replace(/\/$/, ''))))
        inputs.push(procCwd);
    inputs.push(...internal.map(e => e.basename.replace(/\/$/, '')));
    const internalLca = computeLca(inputs);
    const internalRoot = internalLca.join('/');
    const internalRootName = internalLca.length > 0 ? internalLca[internalLca.length - 1] : '';
    const rewriteUnder = (e, root, rootName) => {
        const isDir = e.basename.endsWith('/');
        const p = e.basename.replace(/\/$/, '');
        const rel = root && isAncestor(root, p) ? p.slice(root.length + 1) : p;
        e.basename = (rootName ? rootName + '/' : '') + rel + (isDir ? '/' : '');
    };
    for (const e of internal)
        rewriteUnder(e, internalRoot, internalRootName);
    // Re-root the primary external group (same root as cwd) under its own LCA. Other groups (e.g.
    // /tmp on a different root) keep their full path - they share no project root with cwd, and
    // re-rooting them under their own LCA would strip the meaningful leading root (e.g. "/tmp/").
    if (primaryGroup.length > 0) {
        const extRoot = externalLca.join('/');
        const extRootName = externalLca.length > 0 ? externalLca[externalLca.length - 1] : '';
        for (const e of primaryGroup)
            rewriteUnder(e, extRoot, extRootName);
    }
    // merge same-basename multi-extension batch entries
    const merged = [];
    const extGroups = new Map();
    for (const e of [...internal, ...external]) {
        if (e.basename.endsWith('/') || !e.batch) {
            merged.push(e);
            continue;
        }
        const lastSlash = e.basename.lastIndexOf('/');
        const dir = lastSlash > -1 ? e.basename.slice(0, lastSlash + 1) : '';
        const name = lastSlash > -1 ? e.basename.slice(lastSlash + 1) : e.basename;
        const dot = name.lastIndexOf('.');
        const base = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : '';
        const key = dir + base + '|' + (e.typeSeq || []).join(',');
        const g = extGroups.get(key);
        if (g) {
            g.exts.push(ext);
            g.first.extsForMerge = g.exts;
        }
        else {
            const arr = [ext];
            extGroups.set(key, { exts: arr, first: e });
            merged.push(e);
        }
    }
    for (const e of merged) {
        if (e.extsForMerge && e.extsForMerge.length > 1) {
            const unique = [...new Set(e.extsForMerge)].sort();
            if (unique.length > 1) {
                e.basename = e.basename + '(' + unique.slice(1).join(' ') + ')';
            }
        }
        delete e.extsForMerge;
    }
    return merged.length > 0 ? merged : undefined;
}
