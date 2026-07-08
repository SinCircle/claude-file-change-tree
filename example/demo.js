/**
 * demo.js - standalone demo of the file-modification-tree feature.
 *
 * Run:  node example/demo.js
 *
 * It fabricates a few tool invocations (Write / Edit / Bash mkdir), feeds them
 * through getFileChanges() to build the change records, then renders the tree
 * with renderNewFilesLine() and prints it (ANSI colors included).
 */
import { getFileChanges } from '../src/file-changes.js';
import { renderNewFilesLine } from '../src/render/lines/new-files.js';

const cwd = 'C:/Users/qyf06/Desktop/myproject';

/** @type {import('../src/types.d.ts').ToolEntry[]} */
const tools = [
    // new file (Write): the content's line count becomes the "added" count
    { id: '1', name: 'Write', target: 'src/index.js', status: 'completed', startTime: new Date(), content: 'import a\nimport b\n' },
    { id: '2', name: 'Write', target: 'src/app.js', status: 'completed', startTime: new Date(), content: 'export const app = 1\n' },
    // edited file (Edit): resultText carries the +/- line counts
    { id: '3', name: 'Edit', target: 'README.md', status: 'completed', startTime: new Date(), oldString: 'hello', newString: 'hello\nworld', resultText: 'The file has been updated. Added 1 line, Removed 0 lines.' },
    // shell op (Bash): mkdir -> a new directory entry
    { id: '4', name: 'Bash', command: 'mkdir reports', status: 'completed', startTime: new Date() },
];

const modifiedFiles = getFileChanges(tools, cwd);

/** @type {import('../src/types.d.ts').RenderContext} */
const ctx = {
    stdin: { cwd },
    config: { display: { showModifiedFiles: true } },
    modifiedFiles,
};

const out = renderNewFilesLine(ctx);
console.log(out ?? '(no file changes)');
