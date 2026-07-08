/**
 * types.d.ts
 *
 * Type declarations for the file-modification-tree feature, taken from
 * claude-hud v0.1.0 `dist/types.d.ts`.
 *
 * - `ModifiedFileSummary` and `ToolEntry` are copied VERBATIM from the original.
 * - `RenderContext` is a TRIMMED subset containing only the fields that the
 *   file-tree code (`renderNewFilesLine` / `getFileChanges`) actually reads.
 *   The original RenderContext carries many more fields (git, usage, memory...)
 *   that belong to the rest of the HUD and are irrelevant here.
 */

/** A single file's aggregated change record, as consumed by the tree renderer. */
export interface ModifiedFileSummary {
    path: string;
    basename: string;
    type?: string;
    typeSeq?: string[];
    added: number;
    removed?: number;
    cpSource?: string;
    batch?: boolean;
    types?: Set<string>;
    // `lastTime` is set at runtime by getFileChanges() (not present in the
    // original type) and used by the renderer to pick the most-recent files
    // when the tree must be collapsed to fit a line budget.
    lastTime?: Date;
}

/** One tool invocation parsed from the session transcript. */
export interface ToolEntry {
    id: string;
    name: string;
    target?: string;
    status: 'running' | 'completed' | 'error';
    startTime: Date;
    endTime?: Date;
    command?: string;
    content?: string;
    resultText?: string;
    oldString?: string;
    newString?: string;
}

/** Trimmed render context - only the fields the file-tree code reads. */
export interface RenderContext {
    stdin: {
        cwd?: string;
    };
    config: {
        display?: {
            /** Set to false to hide the file tree entirely. */
            showModifiedFiles?: boolean;
        };
    };
    modifiedFiles?: ModifiedFileSummary[];
}
