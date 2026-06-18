/**
 * utils.test.ts — Tests for pure helper functions in utils.ts.
 *
 * Run: node --import tsx --test extensions/keb/utils.test.ts
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { parseWorkspaceArgs } from "./utils";

describe("parseWorkspaceArgs", () => {
  it("parses positional rest only", () => {
    const result = parseWorkspaceArgs("my-doc");
    assert.deepEqual(result, { workspace: undefined, force: false, yes: false, rest: "my-doc" });
  });

  it("strips surrounding whitespace", () => {
    const result = parseWorkspaceArgs("  my-doc  ");
    assert.equal(result.rest, "my-doc");
  });

  it("parses -w short form", () => {
    const result = parseWorkspaceArgs("my-doc -w myproject");
    assert.equal(result.workspace, "myproject");
    assert.equal(result.rest, "my-doc");
    assert.equal(result.force, false);
    assert.equal(result.yes, false);
  });

  it("parses --workspace long form", () => {
    const result = parseWorkspaceArgs("my-doc --workspace myproject");
    assert.equal(result.workspace, "myproject");
    assert.equal(result.rest, "my-doc");
  });

  it("parses -w before positional arg", () => {
    const result = parseWorkspaceArgs("-w myproject my-doc");
    assert.equal(result.workspace, "myproject");
    assert.equal(result.rest, "my-doc");
  });

  it("parses -f short form", () => {
    const result = parseWorkspaceArgs("my-doc -f");
    assert.equal(result.force, true);
    assert.equal(result.rest, "my-doc");
  });

  it("parses --force long form", () => {
    const result = parseWorkspaceArgs("my-doc --force");
    assert.equal(result.force, true);
    assert.equal(result.rest, "my-doc");
  });

  it("parses -f before positional arg", () => {
    const result = parseWorkspaceArgs("-f my-doc");
    assert.equal(result.force, true);
    assert.equal(result.rest, "my-doc");
  });

  it("parses -y short form", () => {
    const result = parseWorkspaceArgs("my-doc -y");
    assert.equal(result.yes, true);
    assert.equal(result.rest, "my-doc");
  });

  it("parses --yes long form", () => {
    const result = parseWorkspaceArgs("my-doc --yes");
    assert.equal(result.yes, true);
    assert.equal(result.rest, "my-doc");
  });

  it("parses -y before positional arg", () => {
    const result = parseWorkspaceArgs("-y my-doc");
    assert.equal(result.yes, true);
    assert.equal(result.rest, "my-doc");
  });

  it("parses all flags together in any order", () => {
    const a = parseWorkspaceArgs("-w proj -f -y my-doc");
    assert.equal(a.workspace, "proj");
    assert.equal(a.force, true);
    assert.equal(a.yes, true);
    assert.equal(a.rest, "my-doc");

    const b = parseWorkspaceArgs("my-doc -y -f -w proj");
    assert.equal(b.workspace, "proj");
    assert.equal(b.force, true);
    assert.equal(b.yes, true);
    assert.equal(b.rest, "my-doc");

    const c = parseWorkspaceArgs("-y -w proj -f my-doc");
    assert.equal(c.workspace, "proj");
    assert.equal(c.force, true);
    assert.equal(c.yes, true);
    assert.equal(c.rest, "my-doc");
  });

  it("handles only flags with no positional arg", () => {
    const result = parseWorkspaceArgs("-f -y");
    assert.equal(result.force, true);
    assert.equal(result.yes, true);
    assert.equal(result.rest, "");
    assert.equal(result.workspace, undefined);
  });

  it("handles empty string", () => {
    const result = parseWorkspaceArgs("");
    assert.equal(result.rest, "");
    assert.equal(result.workspace, undefined);
    assert.equal(result.force, false);
    assert.equal(result.yes, false);
  });

  it("handles workspace value with special chars", () => {
    const result = parseWorkspaceArgs("my-doc -w my-project_123");
    assert.equal(result.workspace, "my-project_123");
    assert.equal(result.rest, "my-doc");
  });

  it("does not treat flag letters inside words as flags", () => {
    const result = parseWorkspaceArgs("my-file-f");
    assert.equal(result.force, false);
    assert.equal(result.rest, "my-file-f");
  });

  it("handles multiple positional args in rest", () => {
    const result = parseWorkspaceArgs("-w proj @file1.md https://example.com");
    assert.equal(result.workspace, "proj");
    assert.equal(result.rest, "@file1.md https://example.com");
  });

  it("handles real-world keb:remove usage", () => {
    const a = parseWorkspaceArgs("my-doc -w dev -y");
    assert.equal(a.yes, true);
    assert.equal(a.workspace, "dev");
    assert.equal(a.rest, "my-doc");

    const b = parseWorkspaceArgs("some-slug");
    assert.equal(b.yes, false);
    assert.equal(b.rest, "some-slug");
  });

  it("handles real-world keb:workspace:clear usage", () => {
    const result = parseWorkspaceArgs("-y default");
    assert.equal(result.yes, true);
    assert.equal(result.rest, "default");
  });
});
