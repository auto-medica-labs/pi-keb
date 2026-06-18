/**
 * commands/workspaces.ts — Workspace management commands.
 *
 * Registers: /keb:workspace:init, /keb:workspace:status, /keb:workspace:clear, /keb:workspace:remove
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { KnowledgeBaseStore } from "../ports/types";
import { slugify, parseWorkspaceArgs } from "../utils";

export function registerWorkspaceCommands(
  pi: ExtensionAPI,
  store: KnowledgeBaseStore,
) {
  // ── /keb:workspace:init <workspace-name> ──────────────────────────────
  pi.registerCommand("keb:workspace:init", {
    description:
      "Create a new named workspace under keb/workspaces/ (e.g. /keb:workspace:init myproject)",
    handler: async (args, ctx) => {
      if (!args || !args.trim()) {
        ctx.ui.notify(
          "Usage: /keb:workspace:init <workspace-name>\n\n" +
            "Creates a named workspace. Use -w <name> on other commands to target it.\n" +
            "Example: /keb:workspace:init myproject",
          "warning",
        );
        return;
      }

      const name = slugify(args.trim());
      if (!name) {
        ctx.ui.notify(
          "Invalid workspace name. Use letters, numbers, hyphens.",
          "error",
        );
        return;
      }

      if (store.workspaceExists(name)) {
        ctx.ui.notify(
          `Workspace "${name}" already exists. Use /keb:add -w ${name} <file> to add documents.`,
          "warning",
        );
        return;
      }

      store.ensureKbDir(name);
      ctx.ui.notify(
        `Workspace created: ${name}\n` +
          `  Path: ${store.getWorkspaceRoot(name).root}\n\n` +
          `Usage:\n` +
          `  /keb:add -w ${name} <file>   Add documents\n` +
          `  /keb:query -w ${name} <q>    Search this workspace\n` +
          `  /keb:workspace:status        List all workspaces`,
        "info",
      );
    },
  });

  // ── /keb:workspace:status ────────────────────────────────────────
  pi.registerCommand("keb:workspace:status", {
    description: "List all workspaces and their stats",
    handler: async (_args, ctx) => {
      const lines: string[] = ["## Workspaces", ""];

      // Default workspace
      const defExists = store.kbExists();
      if (defExists) {
        const defSummaries = store.listSummaries();
        const defConcepts = store.listConcepts();
        const defReg = store.readRegistry();
        const defSrcs = Object.keys(defReg).length;
        const defLabel =
          defSrcs > 0 || defSummaries.length > 0
            ? `${defSrcs} sources, ${defSummaries.length} docs, ${defConcepts.length} concepts`
            : "empty";
        lines.push(`  **default** — ${defLabel}`);
      } else {
        lines.push("  **default** — not initialized");
      }

      const named = store.listWorkspaces();
      if (named.length === 0) {
        lines.push("");
        lines.push(
          "No named workspaces. Use /keb:workspace:init <name> to create one.",
        );
      } else {
        lines.push("");
        for (const ws of named) {
          const wSummaries = store.listSummaries(ws);
          const wConcepts = store.listConcepts(ws);
          const wReg = store.readRegistry(ws);
          const wSrcs = Object.keys(wReg).length;
          lines.push(
            `  **${ws}** — ${wSrcs} sources, ${wSummaries.length} docs, ${wConcepts.length} concepts`,
          );
        }
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ── /keb:workspace:clear <workspace-name> [-y] ──────────────────
  pi.registerCommand("keb:workspace:clear", {
    description:
      "Clear all wiki content (source/, wiki/, registry) from a workspace " +
      "while keeping the workspace directory. Works for both default and named " +
      "workspaces. Pass -y to skip confirmation.",
    handler: async (args, ctx) => {
      const { yes, rest: outerName } = parseWorkspaceArgs(args ?? "");
      if (!outerName) {
        ctx.ui.notify(
          "Usage: /keb:workspace:clear [-y] <workspace-name>\n\n" +
            "Clears all wiki content but keeps the workspace directory.\n" +
            "Works for both default and named workspaces.\n" +
            "Examples:\n" +
            "  /keb:workspace:clear default\n" +
            "  /keb:workspace:clear myproject\n" +
            "  /keb:workspace:clear -y default   # skip confirmation",
          "warning",
        );
        return;
      }

      const wsParam = outerName === "default" ? undefined : outerName;

      if (!store.workspaceExists(outerName)) {
        const label =
          outerName === "default"
            ? "Default workspace"
            : `Workspace "${outerName}"`;
        ctx.ui.notify(
          `${label} does not exist or has not been initialized.`,
          "error",
        );
        return;
      }

      const label =
        outerName === "default"
          ? "the default workspace"
          : `workspace "${outerName}"`;

      if (!yes) {
        const confirmed = await ctx.ui.confirm(
          "Clear workspace?",
          `Are you sure you want to clear ${label}?\n` +
            "All sources, summaries, concepts, and the index will be permanently removed, " +
            "but the workspace directory will be kept.",
        );
        if (!confirmed) {
          ctx.ui.notify("Clear cancelled.", "info");
          return;
        }
      }

      try {
        const clearedPath = store.clearWorkspace(wsParam);
        ctx.ui.notify(
          `Workspace cleared: ${outerName}\n  Path: ${clearedPath}`,
          "info",
        );
      } catch (e: any) {
        ctx.ui.notify(
          `Failed to clear workspace "${outerName}": ${e.message}`,
          "error",
        );
      }
    },
  });

  // ── /keb:workspace:remove <workspace-name> [-y] ────────────────────
  pi.registerCommand("keb:workspace:remove", {
    description:
      "Delete a named workspace entirely (its whole folder). " +
      "Does not support the default workspace — use /keb:workspace:clear default instead. " +
      "Pass -y to skip confirmation.",
    handler: async (args, ctx) => {
      const { yes, rest: name } = parseWorkspaceArgs(args ?? "");

      if (!name) {
        ctx.ui.notify(
          "Usage: /keb:workspace:remove [-y] <workspace-name>\n\n" +
            "Deletes the entire named workspace folder.\n" +
            "To clear the default workspace, use /keb:workspace:clear default instead.\n" +
            "Examples:\n" +
            "  /keb:workspace:remove myproject\n" +
            "  /keb:workspace:remove -y myproject   # skip confirmation",
          "warning",
        );
        return;
      }

      if (name === "default") {
        ctx.ui.notify(
          "/keb:workspace:remove does not support the default workspace. " +
            "Use /keb:workspace:clear default to clear it instead.",
          "error",
        );
        return;
      }

      if (!store.workspaceExists(name)) {
        ctx.ui.notify(
          `Workspace "${name}" does not exist or has not been initialized.`,
          "error",
        );
        return;
      }

      if (!yes) {
        const confirmed = await ctx.ui.confirm(
          "Delete workspace?",
          `Are you sure you want to delete workspace "${name}"?\n` +
            "The entire workspace folder and all its contents will be permanently removed.",
        );
        if (!confirmed) {
          ctx.ui.notify("Deletion cancelled.", "info");
          return;
        }
      }

      try {
        const removedPath = store.deleteWorkspace(name);
        ctx.ui.notify(
          `Workspace deleted: ${name}\n  Path: ${removedPath}`,
          "info",
        );
      } catch (e: any) {
        ctx.ui.notify(
          `Failed to delete workspace "${name}": ${e.message}`,
          "error",
        );
      }
    },
  });
}
