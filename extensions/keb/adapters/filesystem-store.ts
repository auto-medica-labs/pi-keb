/**
 * adapters/filesystem-store.ts — File I/O implementation of KnowledgeBaseStore.
 *
 * All paths are relative to KebRoot (~/.pi/agent/keb/).
 * Named workspaces live under ~/.pi/agent/keb/workspaces/<name>/.
 * The default workspace lives directly under KebRoot.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { homedir } from "node:os";
import type {
  KnowledgeBaseStore,
  WorkspacePaths,
  Registry,
  RegistryEntry,
  ConceptInfo,
  WikiDump,
  CopyResult,
} from "../ports/types";
import { buildOkfFrontmatter, parseOkfFrontmatter } from "../utils";

// ---------------------------------------------------------------------------
// Path constants
// ---------------------------------------------------------------------------

export const KebRoot = path.join(homedir(), ".pi", "agent", "keb");
export const WORKSPACES_DIR = path.join(KebRoot, "workspaces");

// ---------------------------------------------------------------------------
// FilesystemStore
// ---------------------------------------------------------------------------

export class FilesystemStore implements KnowledgeBaseStore {
  // ── Paths ───────────────────────────────────────────────

  getWorkspaceRoot(name?: string): WorkspacePaths {
    const base =
      name && name !== "default" ? path.join(WORKSPACES_DIR, name) : KebRoot;

    return {
      root: base,
      registryPath: path.join(base, "registry.json"),
      sourceDir: path.join(base, "source"),
      wikiDir: path.join(base, "wiki"),
      summariesDir: path.join(base, "wiki", "summaries"),
      conceptsDir: path.join(base, "wiki", "concepts"),
      indexPath: path.join(base, "wiki", "index.md"),
    };
  }

  // ── Workspaces ──────────────────────────────────────────

  listWorkspaces(): string[] {
    if (!fs.existsSync(WORKSPACES_DIR)) return [];
    return fs
      .readdirSync(WORKSPACES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  workspaceExists(name: string): boolean {
    if (!name || name === "default") return this.kebExists();
    return fs.existsSync(path.join(WORKSPACES_DIR, name));
  }

  ensureKebDir(workspace?: string): boolean {
    const wp = this.getWorkspaceRoot(workspace);
    const isNew = !fs.existsSync(wp.root);

    fs.mkdirSync(wp.root, { recursive: true });
    fs.mkdirSync(wp.sourceDir, { recursive: true });
    fs.mkdirSync(wp.summariesDir, { recursive: true });
    fs.mkdirSync(wp.conceptsDir, { recursive: true });

    if (!fs.existsSync(wp.registryPath)) {
      fs.writeFileSync(wp.registryPath, JSON.stringify({}, null, 2), "utf-8");
    }
    if (!fs.existsSync(wp.indexPath)) {
      fs.writeFileSync(
        wp.indexPath,
        "# Knowledge Base Index\n\n## Documents\n\n## Concepts\n",
        "utf-8",
      );
    }

    // Create log.md if not exists (OKF §7)
    const logPath = path.join(wp.wikiDir, "log.md");
    if (!fs.existsSync(logPath)) {
      const today = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(
        logPath,
        `# Workspace Update Log\n\n## ${today}\n* **Creation**: Workspace initialized with OKF v0.1 format.\n`,
        "utf-8",
      );
    }

    return isNew;
  }

  kebExists(workspace?: string): boolean {
    const wp = this.getWorkspaceRoot(workspace);
    return fs.existsSync(wp.root);
  }

  clearWorkspace(name?: string): string {
    const wp = this.getWorkspaceRoot(name);
    for (const p of [wp.sourceDir, wp.wikiDir, wp.registryPath]) {
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
      }
    }
    return wp.root;
  }

  deleteWorkspace(name?: string): string {
    // Only for named workspaces. Use clearWorkspace to clear the default workspace.
    const wsDir = path.join(WORKSPACES_DIR, name!);
    if (fs.existsSync(wsDir)) {
      fs.rmSync(wsDir, { recursive: true, force: true });
    }
    return wsDir;
  }

  // ── Hashing ─────────────────────────────────────────────

  hashContent(content: string): string {
    return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
  }

  hashFile(filePath: string): string {
    const content = fs.readFileSync(filePath, "utf-8");
    return this.hashContent(content);
  }

  // ── Registry ────────────────────────────────────────────

  readRegistry(workspace?: string): Registry {
    const wp = this.getWorkspaceRoot(workspace);
    if (!fs.existsSync(wp.registryPath)) return {};
    const raw = fs.readFileSync(wp.registryPath, "utf-8");
    try {
      return JSON.parse(raw) as Registry;
    } catch {
      return {};
    }
  }

  writeRegistry(registry: Registry, workspace?: string): void {
    const wp = this.getWorkspaceRoot(workspace);
    fs.writeFileSync(
      wp.registryPath,
      JSON.stringify(registry, null, 2),
      "utf-8",
    );
  }

  isDocNameUsed(docName: string, workspace?: string): boolean {
    const reg = this.readRegistry(workspace);
    return Object.values(reg).some((e) => e.docName === docName);
  }

  normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
        parsed.pathname = parsed.pathname.slice(0, -1);
      }
      if (
        (parsed.protocol === "https:" && parsed.port === "443") ||
        (parsed.protocol === "http:" && parsed.port === "80")
      ) {
        parsed.port = "";
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  isUrlInRegistry(url: string, workspace?: string): boolean {
    const normalized = this.normalizeUrl(url);
    const reg = this.readRegistry(workspace);
    return Object.values(reg).some(
      (e) => this.normalizeUrl(e.originalPath) === normalized,
    );
  }

  findByUrl(url: string, workspace?: string): RegistryEntry | null {
    const normalized = this.normalizeUrl(url);
    const reg = this.readRegistry(workspace);
    return (
      Object.values(reg).find(
        (e) => this.normalizeUrl(e.originalPath) === normalized,
      ) ?? null
    );
  }

  // ── Source files ────────────────────────────────────────

  copySource(absPath: string, workspace?: string): CopyResult {
    const wp = this.getWorkspaceRoot(workspace);
    const name = path.basename(absPath);
    const destAbs = path.join(wp.sourceDir, name);
    if (fs.existsSync(destAbs)) {
      throw new Error(
        `A file named "${name}" already exists in the Keb source/ directory.\n` +
          `Rename your file on disk before adding it.`,
      );
    }
    fs.copyFileSync(absPath, destAbs);
    return { destRel: `source/${name}`, destAbs };
  }

  writeSourceContent(
    filename: string,
    content: string,
    workspace?: string,
  ): CopyResult {
    const wp = this.getWorkspaceRoot(workspace);
    const destAbs = path.join(wp.sourceDir, filename);
    if (fs.existsSync(destAbs)) {
      throw new Error(
        `A file named "${filename}" already exists in the Keb source/ directory.`,
      );
    }
    fs.writeFileSync(destAbs, content, "utf-8");
    return { destRel: `source/${filename}`, destAbs };
  }

  readSource(destRel: string, workspace?: string): string {
    const wp = this.getWorkspaceRoot(workspace);
    return fs.readFileSync(path.join(wp.root, destRel), "utf-8");
  }

  deleteSource(sourcePath: string, workspace?: string): boolean {
    const wp = this.getWorkspaceRoot(workspace);
    const p = path.join(wp.root, sourcePath);
    if (!fs.existsSync(p)) return false;
    fs.unlinkSync(p);
    return true;
  }

  // ── Index ───────────────────────────────────────────────

  readIndex(workspace?: string): string {
    const wp = this.getWorkspaceRoot(workspace);
    if (!fs.existsSync(wp.indexPath)) return "";
    return fs.readFileSync(wp.indexPath, "utf-8");
  }

  writeIndex(content: string, workspace?: string): void {
    const wp = this.getWorkspaceRoot(workspace);
    fs.mkdirSync(wp.wikiDir, { recursive: true });
    fs.writeFileSync(wp.indexPath, content, "utf-8");
  }

  // ── Summaries ───────────────────────────────────────────

  listSummaries(workspace?: string): string[] {
    const wp = this.getWorkspaceRoot(workspace);
    if (!fs.existsSync(wp.summariesDir)) return [];
    return fs
      .readdirSync(wp.summariesDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
  }

  readSummary(docName: string, workspace?: string): string | null {
    const wp = this.getWorkspaceRoot(workspace);
    const p = path.join(wp.summariesDir, `${docName}.md`);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, "utf-8");
  }

  writeSummary(
    docName: string,
    content: string,
    originalName: string,
    addedAt: string,
    workspace?: string,
    okfFields?: { title?: string; description?: string; resource?: string; tags?: string[] }
  ): void {
    const wp = this.getWorkspaceRoot(workspace);
    fs.mkdirSync(wp.summariesDir, { recursive: true });

    const fields: Record<string, any> = {
      type: "Summary",
      timestamp: addedAt,
      keb_name: docName,
      keb_source: originalName,
    };
    if (okfFields?.title) fields.title = okfFields.title;
    if (okfFields?.description) fields.description = okfFields.description;
    if (okfFields?.resource) fields.resource = okfFields.resource;
    fields.tags = okfFields?.tags ?? [];

    const frontmatter = buildOkfFrontmatter(fields);
    const full = frontmatter + "\n\n" + content + "\n";
    fs.writeFileSync(
      path.join(wp.summariesDir, `${docName}.md`),
      full,
      "utf-8",
    );
  }

  deleteSummary(docName: string, workspace?: string): boolean {
    const wp = this.getWorkspaceRoot(workspace);
    const p = path.join(wp.summariesDir, `${docName}.md`);
    if (!fs.existsSync(p)) return false;
    fs.unlinkSync(p);
    return true;
  }

  // ── Concepts ────────────────────────────────────────────

  listConcepts(workspace?: string): string[] {
    const wp = this.getWorkspaceRoot(workspace);
    if (!fs.existsSync(wp.conceptsDir)) return [];
    return fs
      .readdirSync(wp.conceptsDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
  }

  readConcept(slug: string, workspace?: string): ConceptInfo | null {
    const wp = this.getWorkspaceRoot(workspace);
    const p = path.join(wp.conceptsDir, `${slug}.md`);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf-8");

    const { frontmatter, body } = parseOkfFrontmatter(raw);

    const sources: string[] = frontmatter.keb_sources ?? [];
    const dateAdded: string | undefined = frontmatter.timestamp ?? undefined;
    const needsReview = frontmatter.keb_needs_review === true;
    const title: string | undefined = frontmatter.title ?? undefined;
    const description: string | undefined = frontmatter.description ?? undefined;
    const tags: string[] | undefined = frontmatter.tags ?? undefined;

    return { slug, sources, dateAdded, needsReview, body, title, description, tags };
  }

  writeConcept(
    slug: string,
    content: string,
    sources: string[],
    workspace?: string,
    needsReview?: boolean,
    okfFields?: { title?: string; description?: string; tags?: string[] }
  ): void {
    const wp = this.getWorkspaceRoot(workspace);
    fs.mkdirSync(wp.conceptsDir, { recursive: true });
    const now = new Date().toISOString();

    const fields: Record<string, any> = {
      type: "Concept",
      timestamp: now,
      keb_name: slug,
      keb_sources: sources,
      keb_needs_review: needsReview === true,
    };
    if (okfFields?.title) fields.title = okfFields.title;
    if (okfFields?.description) fields.description = okfFields.description;
    fields.tags = okfFields?.tags ?? [];

    const frontmatter = buildOkfFrontmatter(fields);
    const full = frontmatter + "\n\n" + content + "\n";
    fs.writeFileSync(path.join(wp.conceptsDir, `${slug}.md`), full, "utf-8");
  }

  deleteConcept(slug: string, workspace?: string): boolean {
    const wp = this.getWorkspaceRoot(workspace);
    const p = path.join(wp.conceptsDir, `${slug}.md`);
    if (!fs.existsSync(p)) return false;
    fs.unlinkSync(p);
    return true;
  }

  // ── Compilation tracking ────────────────────────────────

  isEntryCompiled(entry: RegistryEntry): boolean {
    return entry.compiled !== false;
  }

  countPendingCompilations(workspace?: string): number {
    const reg = this.readRegistry(workspace);
    return Object.values(reg).filter((e) => !this.isEntryCompiled(e)).length;
  }

  // ── Wiki dump ───────────────────────────────────────────

  dumpWiki(workspace?: string): WikiDump {
    const summaries: Record<string, string> = {};
    for (const name of this.listSummaries(workspace)) {
      const s = this.readSummary(name, workspace);
      if (s) summaries[name] = s;
    }

    const concepts: Record<string, string> = {};
    for (const slug of this.listConcepts(workspace)) {
      const c = this.readConcept(slug, workspace);
      if (c) concepts[slug] = c.body;
    }

    return {
      index: this.readIndex(workspace),
      summaries,
      concepts,
    };
  }
}


