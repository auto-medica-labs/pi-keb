/**
 * tools.test.ts — Core write operations tested directly against the store.
 *
 * Tests the deterministic behavior that the tools delegate to:
 *   - writeSummary (frontmatter + footer)
 *   - writeConcept (creation with sources)
 *   - updateConcept (source merging — the key new behavior)
 *
 * Run: node --import tsx --test extensions/keb/tools.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { FilesystemStore } from "./adapters/filesystem-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readRaw(
  store: FilesystemStore,
  dir: "summaries" | "concepts",
  name: string,
  workspace = "test-ws",
): string {
  const wp = store.getWorkspaceRoot(workspace);
  return fs.readFileSync(path.join(wp.wikiDir, dir, `${name}.md`), "utf-8");
}

function parseSources(content: string): string[] {
  // Match both legacy "sources:" and OKF "keb_sources:"
  const m = content.match(/(?:keb_)?sources:\s*\[([^\]]*)\]/);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function wsDir(): string {
  return path.join(os.homedir(), ".pi/agent/keb/workspaces/test-ws");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function setup() {
  const store = new FilesystemStore();
  store.ensureKebDir("test-ws");
  return store;
}

function teardown() {
  fs.rmSync(wsDir(), { recursive: true, force: true });
}

describe("writeSummary", () => {
  let store: FilesystemStore;

  beforeEach(() => {
    store = setup();
  });
  afterEach(() => teardown());

  it("writes OKF frontmatter for summaries", () => {
    store.writeSummary(
      "test-doc",
      "## Overview\nThis describes caching.\n\nSee [caching](/concepts/caching-strategy.md).\n",
      "test-doc.md",
      "2024-01-01T00:00:00.000Z",
      "test-ws",
      { title: "Test Doc", description: "A test document", tags: ["test", "caching"] },
    );

    const raw = readRaw(store, "summaries", "test-doc");

    assert.ok(raw.startsWith("---"), "should have frontmatter");
    assert.ok(raw.includes('type: "Summary"'), "should have OKF type");
    assert.ok(raw.includes('keb_name: "test-doc"'));
    assert.ok(raw.includes('keb_source: "test-doc.md"'));
    assert.ok(raw.includes('timestamp: "2024-01-01T00:00:00.000Z"'));

    // OKF optional fields
    assert.ok(raw.includes('title: "Test Doc"'));
    assert.ok(raw.includes('description: "A test document"'));
    assert.ok(raw.includes('tags: ["test", "caching"]'));

    // No footers
    assert.ok(!raw.includes("**Concepts**"), "should NOT have Concepts footer");
    assert.ok(!raw.includes("[[concept/"), "should NOT have wiki-links in footer");
  });

  it("writes summary without optional OKF fields", () => {
    store.writeSummary(
      "plain-doc",
      "Just text.",
      "plain.md",
      "2024-01-01T00:00:00.000Z",
      "test-ws",
    );

    const raw = readRaw(store, "summaries", "plain-doc");
    assert.ok(raw.includes('type: "Summary"'));
    assert.ok(raw.includes('keb_name: "plain-doc"'));
    // No footer, no concepts
    assert.ok(!raw.includes("**Concepts**"));
    assert.ok(!raw.includes("No concepts reference"));
  });
});

describe("writeConcept", () => {
  let store: FilesystemStore;

  beforeEach(() => {
    store = setup();
  });
  afterEach(() => teardown());

  it("creates concept with OKF frontmatter", () => {
    store.writeConcept(
      "caching-strategy",
      "## Overview\nUse Redis for hot paths.",
      ["summary/test-doc"],
      "test-ws",
    );

    const raw = readRaw(store, "concepts", "caching-strategy");

    assert.ok(raw.startsWith("---"), "should have frontmatter");
    assert.ok(raw.includes('type: "Concept"'), "should have OKF type");
    assert.ok(raw.includes('keb_name: "caching-strategy"'));
    assert.ok(raw.includes("keb_needs_review: false"));

    const sources = parseSources(raw);
    assert.deepEqual(sources, ["summary/test-doc"]);

    // No footers
    assert.ok(!raw.includes("**Sources**"), "should NOT have Sources footer");
    assert.ok(!raw.includes("[[summary/"), "should NOT have wiki-links in footer");
  });

  it("stores multiple initial sources and optional OKF fields", () => {
    store.writeConcept(
      "error-handling",
      "## Patterns\nAlways use structured errors.",
      ["summary/api-design", "summary/backend-bible"],
      "test-ws",
      undefined,
      { title: "Error Handling", description: "Error patterns", tags: ["errors"] },
    );

    const raw = readRaw(store, "concepts", "error-handling");
    const sources = parseSources(raw);
    assert.deepEqual(sources.sort(), ["summary/api-design", "summary/backend-bible"].sort());
    assert.ok(raw.includes('title: "Error Handling"'));
    assert.ok(raw.includes('description: "Error patterns"'));
    assert.ok(raw.includes('tags: ["errors"]'));
  });

  it("writes keb_needs_review: true when flag is set", () => {
    store.writeConcept(
      "under-review",
      "## Body",
      ["summary/a"],
      "test-ws",
      true, // needsReview
    );

    const raw = readRaw(store, "concepts", "under-review");
    assert.ok(raw.includes("keb_needs_review: true"));
  });
});

describe("updateConcept (deterministic source merge)", () => {
  let store: FilesystemStore;

  beforeEach(() => {
    store = setup();
  });
  afterEach(() => teardown());

  // Simulates what keb_update_concept does:
  function updateConcept(slug: string, body: string, newSource: string, workspace = "test-ws") {
    const existing = store.readConcept(slug, workspace);
    if (!existing) throw new Error(`Concept "${slug}" does not exist`);
    const merged = [...new Set([...existing.sources, newSource])];
    store.writeConcept(slug, body, merged, workspace);
    return merged;
  }

  it("merges new source with existing ones", () => {
    // Seed: concept with 2 sources
    store.writeConcept(
      "caching",
      "## Old body\nUse Redis.",
      ["summary/doc-a", "summary/doc-b"],
      "test-ws",
    );

    // Update: add a 3rd source
    const merged = updateConcept("caching", "## New body\nRedis + Memcached.", "summary/doc-c");

    assert.deepEqual(merged.sort(), ["summary/doc-a", "summary/doc-b", "summary/doc-c"].sort());

    const raw = readRaw(store, "concepts", "caching");
    assert.ok(raw.includes("## New body"));
    assert.ok(raw.includes('keb_sources: ["summary/doc-a", "summary/doc-b", "summary/doc-c"]'));
  });

  it("deduplicates identical source", () => {
    store.writeConcept("dedup", "## Original", ["summary/x"], "test-ws");

    const merged = updateConcept("dedup", "## Updated", "summary/x");
    assert.deepEqual(merged, ["summary/x"]);
  });

  it("throws when concept does not exist", () => {
    assert.throws(() => updateConcept("nonexistent", "## Body", "summary/x"), /does not exist/);
  });

  it("preserves old sources regardless of what caller passes", () => {
    // Seed: 3 sources
    store.writeConcept(
      "multi",
      "## Multi-source",
      ["summary/a", "summary/b", "summary/c"],
      "test-ws",
    );

    // Simulate LLM only knowing about the new one —
    // the merge is computed from disk, so old sources survive.
    const merged = updateConcept("multi", "## Updated", "summary/d");

    assert.deepEqual(merged.sort(), ["summary/a", "summary/b", "summary/c", "summary/d"].sort());
  });
});
