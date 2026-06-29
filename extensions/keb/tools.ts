/**
 * tools.ts — LLM-callable tools for the Keb extension.
 *
 * Registers: keb_read_index, keb_list_concepts, keb_read_concept,
 *            keb_read_summary, keb_write_summary, keb_write_concept,
 *            keb_update_concept, keb_update_index, keb_set_docname
 *
 * Every tool accepts an optional `workspace` parameter. The LLM receives
 * the workspace name in the prompt and passes it through.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { KnowledgeBaseStore } from "./ports/types";
import { isoNow, parseOkfFrontmatter } from "./utils";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the existing index.md to extract preserved briefs.
 * Returns a Map of "summary/foo" | "concept/bar" → brief text.
 * Matches OKF-style standard markdown links: - [Title](/summaries/slug.md) — brief
 */
function parseIndexBriefs(indexContent: string): Map<string, string> {
  const briefs = new Map<string, string>();
  const pattern = /^- \[([^\]]+)\]\(\/(summaries|concepts)\/([^)]+)\.md\)\s*(?:—\s*(.+))?$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(indexContent)) !== null) {
    const dir = match[2]; // "summaries" or "concepts"
    const slug = match[3]; // filename without .md
    const type = dir === "summaries" ? "summary" : "concept";
    const brief = match[4]?.trim() ?? "";
    briefs.set(`${type}/${slug}`, brief);
  }
  return briefs;
}

export function registerTools(pi: ExtensionAPI, store: KnowledgeBaseStore) {
  // ── keb_read_index ────────────────────────────────────────
  pi.registerTool({
    name: "keb_read_index",
    label: "Read Keb Index",
    description:
      "Read the knowledge base index.md file. Shows all documents and concepts with brief descriptions.",
    parameters: Type.Object({
      workspace: Type.Optional(Type.String({ description: "Workspace name (omit for default)" })),
    }),
    async execute(_toolCallId, params) {
      const content =
        store.readIndex(params.workspace) || "(index is empty — no documents or concepts yet)";
      return {
        content: [{ type: "text" as const, text: content }],
        details: {},
      };
    },
  });

  // ── keb_list_concepts ─────────────────────────────────────
  pi.registerTool({
    name: "keb_list_concepts",
    label: "List Keb Concepts",
    description: "List all concept slugs in the knowledge base.",
    parameters: Type.Object({
      workspace: Type.Optional(Type.String({ description: "Workspace name (omit for default)" })),
    }),
    async execute(_toolCallId, params) {
      const slugs = store.listConcepts(params.workspace);
      const text = slugs.length > 0 ? slugs.map((s) => `- ${s}`).join("\n") : "(no concepts yet)";
      return {
        content: [{ type: "text" as const, text }],
        details: {},
      };
    },
  });

  // ── keb_list_tags ─────────────────────────────────────────
  pi.registerTool({
    name: "keb_list_tags",
    label: "List Keb Tags",
    description:
      "List all tags used across the knowledge base, grouped by the documents that use each tag. " +
      "Call this before writing to see existing tags and reuse them for consistency.",
    parameters: Type.Object({
      workspace: Type.Optional(Type.String({ description: "Workspace name (omit for default)" })),
    }),
    async execute(_toolCallId, params) {
      // Scan summaries for tags
      const tagDocs = new Map<string, string[]>();
      for (const name of store.listSummaries(params.workspace)) {
        const raw = store.readSummary(name, params.workspace);
        if (!raw) continue;
        const { frontmatter } = parseOkfFrontmatter(raw);
        if (Array.isArray(frontmatter.tags)) {
          for (const tag of frontmatter.tags) {
            if (!tagDocs.has(tag)) tagDocs.set(tag, []);
            tagDocs.get(tag)!.push(`summary/${name}`);
          }
        }
      }
      for (const slug of store.listConcepts(params.workspace)) {
        const info = store.readConcept(slug, params.workspace);
        if (!info || !info.tags) continue;
        for (const tag of info.tags) {
          if (!tagDocs.has(tag)) tagDocs.set(tag, []);
          tagDocs.get(tag)!.push(`concept/${slug}`);
        }
      }

      if (tagDocs.size === 0) {
        return {
          content: [{ type: "text" as const, text: "(no tags yet)" }],
          details: {},
        };
      }

      const lines: string[] = ["Tags in knowledge base:", ""];
      for (const [tag, docs] of [...tagDocs.entries()].sort()) {
        lines.push(`${tag}:`);
        for (const doc of docs) {
          lines.push(`  - ${doc}`);
        }
        lines.push("");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: {},
      };
    },
  });

  // ── keb_read_concept ──────────────────────────────────────
  pi.registerTool({
    name: "keb_read_concept",
    label: "Read Keb Concept",
    description: "Read the full content of a concept page by its slug.",
    parameters: Type.Object({
      slug: Type.String({
        description: "Concept slug (e.g. 'caching-strategy')",
      }),
      workspace: Type.Optional(Type.String({ description: "Workspace name (omit for default)" })),
    }),
    async execute(_toolCallId, params) {
      const info = store.readConcept(params.slug, params.workspace);
      if (!info) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Concept "${params.slug}" not found.`,
            },
          ],
          details: {},
        };
      }
      const needsReviewNote = info.needsReview
        ? `\n⚠ needs_review: true (a source document was removed — body may need cleanup)`
        : "";
      let header = `## ${params.slug}\n`;
      if (info.title) header += `**Title:** ${info.title}\n`;
      header += `Sources: ${info.sources.join(", ")}`;
      if (info.tags && info.tags.length > 0) header += `\nTags: ${info.tags.join(", ")}`;
      header += `${needsReviewNote}\n\n`;
      return {
        content: [{ type: "text" as const, text: header + info.body }],
        details: {},
      };
    },
  });

  // ── keb_read_summary ──────────────────────────────────────
  pi.registerTool({
    name: "keb_read_summary",
    label: "Read Keb Summary",
    description: "Read the full content of a summary page by docName.",
    parameters: Type.Object({
      docName: Type.String({
        description: "Document name slug (e.g. 'architecture')",
      }),
      workspace: Type.Optional(Type.String({ description: "Workspace name (omit for default)" })),
    }),
    async execute(_toolCallId, params) {
      const text = store.readSummary(params.docName, params.workspace);
      if (!text) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Summary "${params.docName}" not found.`,
            },
          ],
          details: {},
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `## Summary: ${params.docName}\n\n${text}`,
          },
        ],
        details: {},
      };
    },
  });

  // ── keb_write_summary ─────────────────────────────────────
  pi.registerTool({
    name: "keb_write_summary",
    label: "Write Keb Summary",
    description:
      "Create or overwrite a summary page for a document. Use the docName passed to you in the compile instructions.",
    parameters: Type.Object({
      docName: Type.String({
        description: "Document name slug (e.g. 'architecture')",
      }),
      content: Type.String({
        description: "Full markdown summary (200-400 words)",
      }),
      workspace: Type.Optional(Type.String({ description: "Workspace name (omit for default)" })),
      title: Type.Optional(Type.String({ description: "Optional display title for the summary" })),
      description: Type.Optional(
        Type.String({ description: "Optional one-line description for the index" }),
      ),
      tags: Type.Array(Type.String(), {
        description:
          "Tags for categorization (call keb_list_tags first to see existing tags and reuse them)",
      }),
    }),
    async execute(_toolCallId, params) {
      // Guard: reject temporary inline-* docNames — LLM must call keb_set_docname first
      if (params.docName.startsWith("inline-")) {
        return {
          content: [
            {
              type: "text" as const,
              text: `"${params.docName}" is a temporary auto-generated name. Call keb_set_docname first to choose a meaningful slug, then use that name in keb_write_summary.`,
            },
          ],
          details: {},
        };
      }

      const reg = store.readRegistry(params.workspace);
      const entry = Object.values(reg).find((e) => e.docName === params.docName);
      const originalName = entry?.name ?? `${params.docName}.md`;
      const addedAt = entry?.addedAt ?? isoNow();

      // Populate OKF resource field when the source is an HTTP(S) URL
      const resource =
        entry?.originalPath &&
        (entry.originalPath.startsWith("http://") || entry.originalPath.startsWith("https://"))
          ? entry.originalPath
          : undefined;

      store.writeSummary(params.docName, params.content, originalName, addedAt, params.workspace, {
        title: params.title,
        description: params.description,
        resource,
        tags: params.tags,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Summary written: summaries/${params.docName}.md`,
          },
        ],
        details: {},
      };
    },
  });

  // ── keb_write_concept ─────────────────────────────────────
  pi.registerTool({
    name: "keb_write_concept",
    label: "Write Keb Concept",
    description:
      "Create a NEW concept page. Use keb_update_concept to add sources to an existing concept.",
    parameters: Type.Object({
      slug: Type.String({
        description: "Concept slug (lowercase, hyphens, e.g. 'caching-strategy')",
      }),
      content: Type.String({
        description: "Full markdown concept page body",
      }),
      sources: Type.Array(Type.String(), {
        description:
          "List of summary page references (e.g. ['summary/architecture', 'summary/design'])",
      }),
      workspace: Type.Optional(Type.String({ description: "Workspace name (omit for default)" })),
      title: Type.Optional(Type.String({ description: "Optional display title for the concept" })),
      description: Type.Optional(
        Type.String({ description: "Optional one-line description for the index" }),
      ),
      tags: Type.Array(Type.String(), {
        description:
          "Tags for categorization (call keb_list_tags first to see existing tags and reuse them)",
      }),
    }),
    async execute(_toolCallId, params) {
      const existed = store.listConcepts(params.workspace).includes(params.slug);

      store.writeConcept(params.slug, params.content, params.sources, params.workspace, undefined, {
        title: params.title,
        description: params.description,
        tags: params.tags,
      });
      const action = existed ? "updated" : "created";
      return {
        content: [
          {
            type: "text" as const,
            text: `Concept ${action}: concepts/${params.slug}.md (sources: ${params.sources.join(", ")})`,
          },
        ],
        details: {},
      };
    },
  });

  // ── keb_update_concept ───────────────────────────────────
  pi.registerTool({
    name: "keb_update_concept",
    label: "Update Keb Concept",
    description:
      "Update an EXISTING concept with new information from a document. " +
      "The new source is automatically merged with existing sources — you only need to pass the new one.",
    parameters: Type.Object({
      slug: Type.String({
        description: "Existing concept slug (e.g. 'caching-strategy')",
      }),
      content: Type.String({
        description: "Full rewritten markdown body with new info integrated",
      }),
      source: Type.String({
        description: "Single summary ref to add, e.g. 'summary/architecture'",
      }),
      workspace: Type.Optional(Type.String({ description: "Workspace name (omit for default)" })),
      title: Type.Optional(Type.String({ description: "Optional display title for the concept" })),
      description: Type.Optional(
        Type.String({ description: "Optional one-line description for the index" }),
      ),
      tags: Type.Array(Type.String(), {
        description:
          "Tags for categorization (call keb_list_tags first to see existing tags and reuse them)",
      }),
    }),
    async execute(_toolCallId, params) {
      const existing = store.readConcept(params.slug, params.workspace);
      if (!existing) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Concept "${params.slug}" does not exist. Use keb_write_concept to create it first.`,
            },
          ],
          details: {},
        };
      }

      // Deterministic union: old sources preserved, new source appended
      const mergedSources = [...new Set([...existing.sources, params.source])];

      // Preserve existing OKF fields, override with caller-provided values
      const okfFields: { title?: string; description?: string; tags?: string[] } = {
        title: params.title || existing.title,
        description: params.description || existing.description,
        tags: params.tags,
      };

      store.writeConcept(
        params.slug,
        params.content,
        mergedSources,
        params.workspace,
        undefined,
        okfFields,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `Concept updated: concepts/${params.slug}.md (sources: ${mergedSources.join(", ")})`,
          },
        ],
        details: {},
      };
    },
  });

  // ── keb_update_index ──────────────────────────────────────
  pi.registerTool({
    name: "keb_update_index",
    label: "Update Keb Index",
    description:
      "Rebuild the knowledge base index.md. Disk is authoritative for what exists — " +
      "pass entries only for pages you can provide a fresh brief/description for. " +
      "Pages you omit keep their existing description from the current index.",
    parameters: Type.Object({
      entries: Type.Array(
        Type.Object({
          type: StringEnum(["summary", "concept"] as const),
          slug: Type.String({
            description: "Summary docName or concept slug",
          }),
          brief: Type.String({
            description: "One-liner description (under 120 chars)",
          }),
        }),
        {
          description:
            "Entries you want to UPDATE with fresh briefs. Omitted pages keep existing briefs.",
        },
      ),
      workspace: Type.Optional(Type.String({ description: "Workspace name (omit for default)" })),
    }),
    async execute(_toolCallId, params) {
      const diskSummarySlugs = store.listSummaries(params.workspace);
      const diskConceptSlugs = store.listConcepts(params.workspace);

      // Parse existing index to preserve briefs for pages the LLM didn't touch
      const existingIndex = store.readIndex(params.workspace) ?? "";
      const preservedBriefs = parseIndexBriefs(existingIndex);

      // Build brief lookup from LLM's entries (advisory, not authoritative)
      const llmBriefs = new Map<string, string>();
      for (const entry of params.entries) {
        llmBriefs.set(`${entry.type}/${entry.slug}`, entry.brief);
      }

      // Resolve brief for a page: LLM > existing index > placeholder
      const resolveBrief = (type: string, slug: string, fallback: string): string => {
        const key = `${type}/${slug}`;
        return llmBriefs.get(key) ?? preservedBriefs.get(key) ?? fallback;
      };

      const docLines: string[] = [];
      const conceptLines: string[] = [];

      for (const slug of diskSummarySlugs) {
        const brief = resolveBrief("summary", slug, "(summary)");
        docLines.push(`- [${slug}](/summaries/${slug}.md) — ${brief}`);
      }

      for (const slug of diskConceptSlugs) {
        const concept = store.readConcept(slug, params.workspace);
        const sourcesFallback = concept ? `sources: ${concept.sources.join(", ")}` : "(concept)";
        const brief = resolveBrief("concept", slug, sourcesFallback);
        conceptLines.push(`- [${slug}](/concepts/${slug}.md) — ${brief}`);
      }

      const index = [
        "# Knowledge Base Index",
        "",
        "## Documents",
        ...(docLines.length > 0 ? docLines : ["(none)"]),
        "",
        "## Concepts",
        ...(conceptLines.length > 0 ? conceptLines : ["(none)"]),
        "",
      ].join("\n");

      store.writeIndex(index, params.workspace);

      // Mark all disk summary docs as fully compiled
      const reg = store.readRegistry(params.workspace);
      let markedCount = 0;
      const now = isoNow();
      for (const slug of diskSummarySlugs) {
        for (const [, regEntry] of Object.entries(reg)) {
          if (regEntry.docName === slug && !store.isEntryCompiled(regEntry)) {
            regEntry.compiled = true;
            regEntry.lastCompiledAt = now;
            markedCount++;
          }
        }
      }
      if (markedCount > 0) {
        store.writeRegistry(reg, params.workspace);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Index updated: ${docLines.length} documents, ${conceptLines.length} concepts.`,
          },
        ],
        details: {},
      };
    },
  });

  // ── keb_set_docname ─────────────────────────────────────
  pi.registerTool({
    name: "keb_set_docname",
    label: "Set Keb DocName",
    description:
      "Rename an inline document's temporary docName to a meaningful slug. Use during /keb:add:content compilation to pick a proper name.",
    parameters: Type.Object({
      oldDocName: Type.String({
        description: "Current temporary docName (e.g. 'inline-a1b2c3d4')",
      }),
      newDocName: Type.String({
        description: "New meaningful slug (lowercase, hyphens, 4 words max)",
      }),
      workspace: Type.Optional(Type.String({ description: "Workspace name (omit for default)" })),
    }),
    async execute(_toolCallId, params) {
      const reg = store.readRegistry(params.workspace);

      // Find the entry with this docName
      const match = Object.entries(reg).find(([_, e]) => e.docName === params.oldDocName);
      if (!match) {
        return {
          content: [
            {
              type: "text" as const,
              text: `DocName "${params.oldDocName}" not found in registry.`,
            },
          ],
          details: {},
        };
      }

      const [hash, entry] = match;

      // Check if newDocName is already taken by another entry
      const collision = Object.entries(reg).find(
        ([h, e]) => h !== hash && e.docName === params.newDocName,
      );
      if (collision) {
        return {
          content: [
            {
              type: "text" as const,
              text: `DocName "${params.newDocName}" is already taken by another document. Choose a different slug.`,
            },
          ],
          details: {},
        };
      }

      // Rename source file
      const wp = store.getWorkspaceRoot(params.workspace);
      const oldSourcePath = path.join(wp.root, entry.sourcePath);
      const newFilename = `${params.newDocName}.md`;
      const newSourceRel = `source/${newFilename}`;
      const newSourceAbs = path.join(wp.root, newSourceRel);

      if (fs.existsSync(newSourceAbs)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `A source file named "${newFilename}" already exists. Choose a different slug.`,
            },
          ],
          details: {},
        };
      }

      try {
        fs.renameSync(oldSourcePath, newSourceAbs);
      } catch (e: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to rename source file: ${e.message}`,
            },
          ],
          details: {},
        };
      }

      // Update registry
      entry.docName = params.newDocName;
      entry.name = newFilename;
      entry.sourcePath = newSourceRel;
      // Update originalPath only if it's an inline type
      if (entry.originalPath.startsWith("inline:")) {
        entry.originalPath = `inline:${params.newDocName}`;
      }
      store.writeRegistry(reg, params.workspace);

      return {
        content: [
          {
            type: "text" as const,
            text: `DocName updated: ${params.oldDocName} → ${params.newDocName}`,
          },
        ],
        details: {},
      };
    },
  });
}
