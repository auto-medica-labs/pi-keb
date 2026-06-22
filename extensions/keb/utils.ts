/**
 * utils.ts — Pure helper functions with no side effects.
 * Extracted from index.ts to keep commands focused on orchestration.
 */

import * as path from "node:path";

/** Convert text to a URL-safe slug: lowercase, hyphens, 80 chars max. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Derive a docName (slug) from a file path by stripping the extension. */
export function docNameFromFile(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

/**
 * Derive a docName from a URL.
 * Prefers the HTML metadata title if available, then falls back to
 * the last path segment, and finally the hostname.
 */
export function docNameFromUrl(
  url: string,
  metadataTitle?: string | null,
): string {
  if (metadataTitle) {
    const slug = slugify(metadataTitle);
    if (slug.length > 0) return slug;
  }
  try {
    const { pathname } = new URL(url);
    const lastSegment = pathname.split("/").filter(Boolean).pop();
    if (lastSegment) {
      const withoutExt = lastSegment.replace(/\.[^.]+$/, "");
      const candidate = slugify(withoutExt);
      if (candidate.length > 0) return candidate;
    }
  } catch {}
  try {
    const { hostname } = new URL(url);
    return slugify(hostname.replace(/^www\./, ""));
  } catch {
    return slugify(url).slice(0, 40);
  }
}

/**
 * Parse -w / --workspace flag from raw command args.
 * Returns the workspace name (if any) and the remaining args string.
 */
export function parseWorkspaceArgs(rawArgs: string): {
  workspace?: string;
  force: boolean;
  yes: boolean;
  rest: string;
} {
  let rest = rawArgs.trim();
  let workspace: string | undefined;
  let force = false;
  let yes = false;

  // Parse -w / --workspace
  const wsMatch = rest.match(/(?:^|\s)(?:-w|--workspace)\s+(\S+)/);
  if (wsMatch) {
    workspace = wsMatch[1];
    rest = rest.replace(wsMatch[0], " ").replace(/\s+/g, " ").trim();
  }

  // Parse -f / --force
  const forceMatch = rest.match(/(?:^|\s)(?:-f|--force)(?:\s|$)/);
  if (forceMatch) {
    force = true;
    rest = rest.replace(forceMatch[0], " ").replace(/\s+/g, " ").trim();
  }

  // Parse -y / --yes
  const yesMatch = rest.match(/(?:^|\s)(?:-y|--yes)(?:\s|$)/);
  if (yesMatch) {
    yes = true;
    rest = rest.replace(yesMatch[0], " ").replace(/\s+/g, " ").trim();
  }

  return { workspace, force, yes, rest };
}

/** Resolve a user-supplied path against the current working directory. */
export function resolvePath(input: string, cwd: string): string {
  if (path.isAbsolute(input)) return input;
  return path.resolve(cwd, input);
}

/** Check whether a string looks like an HTTP(S) URL. */
export function isUrl(str: string): boolean {
  return /^https?:\/\//i.test(str);
}

/** Current time as ISO 8601 string. */
export function isoNow(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// OKF frontmatter helpers
// ---------------------------------------------------------------------------

/**
 * Build an OKF-style YAML frontmatter string from a key-value map.
 * - All string values are double-quoted (avoids YAML edge cases)
 * - Arrays are serialized as inline YAML: [val1, val2]
 * - Booleans are unquoted
 * - Null/undefined values are skipped
 */
export function buildOkfFrontmatter(fields: Record<string, any>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const items = value.map((v: any) =>
        `"${String(v).replace(/"/g, '\\"')}"`,
      );
      lines.push(`${key}: [${items.join(", ")}]`);
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: "${String(value).replace(/"/g, '\\"')}"`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * Parse an OKF-style YAML frontmatter block.
 * Returns the parsed key-value map and the body text (everything after frontmatter).
 * If no frontmatter is found, returns an empty map and the full input as body.
 */
export function parseOkfFrontmatter(
  raw: string,
): { frontmatter: Record<string, any>; body: string } {
  const frontmatter: Record<string, any> = {};
  let body = raw;

  if (raw.startsWith("---")) {
    const end = raw.indexOf("---", 3);
    if (end !== -1) {
      const fm = raw.slice(3, end);
      body = raw.slice(end + 3).trimStart();

      for (const line of fm.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "---") continue;
        const colonIdx = trimmed.indexOf(":");
        if (colonIdx === -1) continue;
        const key = trimmed.slice(0, colonIdx).trim();
        let value: any = trimmed.slice(colonIdx + 1).trim();

        // Parse YAML inline array: [val1, val2]
        if (value.startsWith("[") && value.endsWith("]")) {
          value = value
            .slice(1, -1)
            .split(",")
            .map((s: string) =>
              s.trim().replace(/^["']|["']$/g, ""),
            )
            .filter(Boolean);
        } else if (value === "true") {
          value = true;
        } else if (value === "false") {
          value = false;
        } else {
          value = value.replace(/^["']|["']$/g, "");
        }
        frontmatter[key] = value;
      }
    }
  }

  return { frontmatter, body };
}

// ---------------------------------------------------------------------------
// Deterministic index rebuild
// ---------------------------------------------------------------------------

/**
 * Build index.md content from ground-truth disk state.
 * Uses OKF-style standard markdown links.
 * Used by Phase 1 of /keb:remove and by standalone repair utilities.
 */
export function buildIndexContent(
  summaries: string[],
  concepts: Array<{ slug: string; sources: string[] }>,
): string {
  const docLines =
    summaries.length > 0
      ? summaries.map((s) => `- [${s}](/summaries/${s}.md)`)
      : ["(none)"];

  const conceptLines =
    concepts.length > 0
      ? concepts.map((c) => `- [${c.slug}](/concepts/${c.slug}.md)`)
      : ["(none)"];

  return [
    "# Knowledge Base Index *(auto-rebuilt)*",
    "",
    "## Documents",
    ...docLines,
    "",
    "## Concepts",
    ...conceptLines,
    "",
  ].join("\n");
}
