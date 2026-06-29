/**
 * prompts.ts — Prompt templates for the Knowledge Base extension.
 *
 * These are injected into the pi session via sendUserMessage when a command
 * runs. The LLM uses the keb_* tools to carry out the instructions.
 *
 * All prompt builders accept an optional `workspace` parameter. When set,
 * the prompt instructs the LLM to pass that workspace name to every tool call.
 */

// ---------------------------------------------------------------------------
// Compile prompt (for /keb:add)
// ---------------------------------------------------------------------------

export function buildCompilePrompt(
  sourceName: string,
  docName: string,
  content: string,
  workspace?: string,
): string {
  const wsContext = workspace
    ? [
        `**Workspace:** \`${workspace}\``,
        ``,
        `IMPORTANT: Pass \`workspace="${workspace}"\` to EVERY keb_* tool call.`,
      ].join("\n")
    : `**Workspace:** default (no workspace param needed)`;

  return [
    `[knowledge-base-compile] Add the following document to the knowledge base.`,
    ``,
    wsContext,
    ``,
    `**Source file:** ${sourceName}`,
    `**Doc name (slug for summaries/concepts):** ${docName}`,
    ``,
    `## Document content`,
    ``,
    content,
    ``,
    `---`,
    ``,
    `## Knowledge Base Compilation Instructions`,
    ``,
    `You are compiling a personal knowledge base. The wiki has this structure:`,
    ``,
    `- \`wiki/index.md\` — One-liner index of ALL pages (Documents and Concepts sections)`,
    `- \`wiki/summaries/{docName}.md\` — One summary per source document`,
    `- \`wiki/concepts/{slug}.md\` — Cross-document topic synthesis pages`,
    ``,
    `**Important:** Before writing ANYTHING, always read the current state. Never`,
    `assume the wiki is empty.`,
    ``,
    `### Step 0: Verify content quality`,
    `Inspect the document content. If it appears to be:`,
    `- A captcha, "verify you are human", or bot-detection page`,
    `- A login wall, paywall, or access-denied page`,
    `- A blank/near-empty skeleton (JS-only SPA with no real text)`,
    `- An error page, soft 404, or "please enable JavaScript" message`,
    `- Any page that is NOT substantive article/blog/documentation content`,
    ``,
    `Then STOP. Do NOT call any keb_write_* or keb_update_* tools.`,
    `Instead, tell the user clearly what you found and suggest:`,
    `"Try adding this content directly via right-click → Add this content into Knowledge base instead."`,
    `Do not write a summary, create concepts, or update the index. Just explain why the page was rejected.`,
    ``,
    `### Step 1: Read current state`,
    `Call \`keb_read_index\` to see the current index.`,
    `Call \`keb_list_concepts\` to see existing concept slugs.`,
    `Call \`keb_list_tags\` to see existing tags and reuse them for consistency.`,
    ``,
    `### Step 2: Write the summary`,
    `Write a concise summary (200-400 words) for this document. Call:`,
    `\`keb_write_summary(docName="${docName}", content=<summary>)\``,
    `The summary should capture key ideas, findings, and contributions.`,
    ``,
    `### Step 3: Extract and integrate concepts`,
    `For each cross-cutting topic this document touches:`,
    ``,
    `* **If the topic matches an EXISTING concept:**`,
    `  1. Call \`keb_read_concept(slug)\` to read its current content`,
    `  2. Call \`keb_update_concept(slug, content, source="summary/${docName}")\``,
    `     to rewrite the body with new info integrated. The new source is`,
    `     automatically merged — old sources are preserved.`,
    ``,
    `* **If the topic is NEW and substantive:**`,
    `  Call \`keb_write_concept(slug, content, sources=["summary/${docName}"])\` to create from scratch.`,
    ``,
    `**IMPORTANT:** The \`sources\` parameter expects summary page references like`,
    `\`["summary/${docName}"]\`, NOT raw filenames like \`["${docName}.md"]\`.`,
    ``,
    `Concept slug rules: lowercase, hyphens, 4 words max.`,
    `  Good: "caching-strategy", "api-authentication"`,
    `  Bad: "Cache", "Stuff about APIs and things"`,
    ``,
    `Do not create one-concept-per-document — merge overlapping themes.`,
    ``,
    `### Step 4: Update the index`,
    `Call \`keb_update_index(entries)\`. The index is rebuilt from disk automatically,`,
    `so you only need to pass entries for pages you created or updated with fresh briefs.`,
    `Disk supplies all existing pages — you cannot accidentally drop them.`,
    `Each entry: \`{ type: "summary"|"concept", slug: "...", brief: "one-liner" }\``,
    ``,
    `### Step 5: Summarize what you did`,
    `After all writes are complete, output a brief summary of your work.`,
    `List each page you created or updated using backtick references:`,
    `\`summary/<docName>\` for summaries, \`concept/<slug>\` for concepts.`,
    ``,
    `### Formatting rules`,
    `- Concepts MUST be cross-document synthesis, not single-document regurgitation`,
    `- Be concise. Wiki content should be scannable.`,
    `- Use standard markdown links in body text: [text](/concepts/slug.md), [text](/summaries/doc.md)`,
    `- Include a brief \`description\` in the frontmatter — it feeds the index`,
    `- ALWAYS include \`tags\` for cross-cutting categorization. Call \`keb_list_tags\` first to see existing tags and reuse them for consistency.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Compile prompt for /keb:add:content (inline text, no file/URL)
// ---------------------------------------------------------------------------

export function buildCompilePromptInline(
  tempDocName: string,
  content: string,
  workspace?: string,
): string {
  const wsContext = workspace
    ? [
        `**Workspace:** \`${workspace}\``,
        ``,
        `IMPORTANT: Pass \`workspace="${workspace}"\` to EVERY keb_* tool call.`,
      ].join("\n")
    : `**Workspace:** default (no workspace param needed)`;

  return [
    `[knowledge-base-compile] Add the following inline content to the knowledge base.`,
    ``,
    wsContext,
    ``,
    `**Temporary docName:** ${tempDocName}`,
    ``,
    `## Document content`,
    ``,
    content,
    ``,
    `---`,
    ``,
    `## Knowledge Base Compilation Instructions`,
    ``,
    `### Step 0: Choose a meaningful docName`,
    `This content came from an inline paste (no file or URL). It has`,
    `an auto-generated temporary docName: \`${tempDocName}\`.`,
    ``,
    `Read the content, pick a meaningful docName slug, and call:`,
    `\`keb_set_docname(oldDocName="${tempDocName}", newDocName="<your-slug>")\``,
    ``,
    `This renames the source file and updates the registry.`,
    `You MUST call \`keb_set_docname\` before any other tool call.`,
    `Use the new docName in all subsequent calls.`,
    ``,
    `### Important: before writing ANYTHING, always read current state`,
    `Call \`keb_read_index\` to see the current index.`,
    `Call \`keb_list_concepts\` to see existing concept slugs.`,
    `Call \`keb_list_tags\` to see existing tags and reuse them for consistency.`,
    ``,
    `### Step 1: Verify content quality`,
    `Inspect the inline content. If it appears to be:`,
    `- A captcha, "verify you are human", or bot-detection page`,
    `- A login wall, paywall, or access-denied page`,
    `- A blank/near-empty skeleton (JS-only SPA with no real text)`,
    `- An error page, soft 404, or "please enable JavaScript" message`,
    `- Any page that is NOT substantive article/blog/documentation content`,
    ``,
    `Then STOP. Do NOT call keb_set_docname or any keb_write_* or keb_update_* tools.`,
    `Instead, tell the user clearly what you found and suggest:`,
    `"This content doesn't appear to be substantive. If it's from a webpage, try right-click → Add this content into Knowledge base instead."`,
    `Do not write a summary, create concepts, or update the index. Just explain why the content was rejected.`,
    ``,
    `### Step 2: Write the summary`,
    `Write a concise summary (200-400 words) for this document. Call:`,
    `\`keb_write_summary(docName=<newDocName>, content=<summary>)\``,
    `The summary should capture key ideas, findings, and contributions.`,
    ``,
    `### Step 3: Extract and integrate concepts`,
    `For each cross-cutting topic this document touches:`,
    ``,
    `* **If the topic matches an EXISTING concept:**`,
    `  1. Call \`keb_read_concept(slug)\` to read its current content`,
    `  2. Call \`keb_update_concept(slug, content, source="summary/<newDocName>")\``,
    `     to rewrite the body with new info integrated. The new source is`,
    `     automatically merged — old sources are preserved.`,
    ``,
    `* **If the topic is NEW and substantive:**`,
    `  Call \`keb_write_concept(slug, content, sources=["summary/<newDocName>"])\` to create from scratch.`,
    ``,
    `**IMPORTANT:** The \`sources\` parameter expects summary page references like`,
    `\`["summary/<newDocName>"]\`, NOT raw filenames like \`["<newDocName>.md"]\`.`,
    ``,
    `Concept slug rules: lowercase, hyphens, 4 words max.`,
    `  Good: "caching-strategy", "api-authentication"`,
    `  Bad: "Cache", "Stuff about APIs and things"`,
    ``,
    `Do not create one-concept-per-document — merge overlapping themes.`,
    ``,
    `### Step 4: Update the index`,
    `Call \`keb_update_index(entries)\`. The index is rebuilt from disk automatically,`,
    `so you only need to pass entries for pages you created or updated with fresh briefs.`,
    `Disk supplies all existing pages — you cannot accidentally drop them.`,
    `Each entry: \`{ type: "summary"|"concept", slug: "...", brief: "one-liner" }\``,
    ``,
    `### Step 5: Summarize what you did`,
    `After all writes are complete, output a brief summary of your work.`,
    `List each page you created or updated using backtick references:`,
    `\`summary/<docName>\` for summaries, \`concept/<slug>\` for concepts.`,
    ``,
    `### Formatting rules`,
    `- Concepts MUST be cross-document synthesis, not single-document regurgitation`,
    `- Be concise. Wiki content should be scannable.`,
    `- Use standard markdown links in body text: [text](/concepts/slug.md), [text](/summaries/doc.md)`,
    `- Include a brief \`description\` in the frontmatter — it feeds the index`,
    `- ALWAYS include \`tags\` for cross-cutting categorization. Call \`keb_list_tags\` first to see existing tags and reuse them for consistency.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Query prompt (for /keb:query)
// ---------------------------------------------------------------------------

export function buildQueryPrompt(question: string, workspace?: string): string {
  const wsContext = workspace
    ? [
        `**Workspace:** \`${workspace}\``,
        ``,
        `IMPORTANT: Pass \`workspace="${workspace}"\` to EVERY keb_* tool call.`,
      ].join("\n")
    : `**Workspace:** default (no workspace param needed)`;

  return [
    `[knowledge-base-query] Answer the following question using ONLY the knowledge base.`,
    ``,
    wsContext,
    ``,
    `## Search strategy`,
    `1. Call \`keb_read_index\` to see all documents and concepts with brief descriptions.`,
    `2. Based on the index, identify which summaries are relevant.`,
    `3. Call \`keb_read_summary(docName)\` on the relevant ones.`,
    `4. If deeper detail is needed, call \`keb_read_concept(slug)\` on relevant concepts.`,
    `5. Synthesize a clear, concise answer grounded in knowledge base content.`,
    ``,
    `If the knowledge base does not contain relevant information, say so clearly.`,
    ``,
    `## Formatting rules`,
    `- Cite every source so the user can verify the answer. Use backtick format: \`summary/docname\` or \`concept/slug\`.`,
    `- Use standard markdown links in body text: [text](/concepts/slug.md), [text](/summaries/doc.md)`,
    `- Keep answers concise and scannable.`,
    ``,
    `**Question:** ${question}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Remove Phase 2 prompt (surgical excision, not from-scratch rewrite)
//
// Phase 1 (deterministic) has already:
//   - Deleted the summary
//   - Removed the source from each concept's sources list
//   - Set `needs_review: true` in affected concept frontmatter
//   - Deleted concepts that had no sources left
//   - Rebuilt the index
//   - Deleted the source file
//   - Deleted the registry entry
//
// Phase 2 (this prompt) asks the LLM to surgically remove content traceable
// to the deleted document from remaining concept bodies.
// ---------------------------------------------------------------------------

export function buildRemovePrompt(
  docName: string,
  sourceName: string,
  affectedConceptSlugs: string[],
  workspace?: string,
): string {
  const wsContext = workspace
    ? [
        `**Workspace:** \`${workspace}\``,
        ``,
        `IMPORTANT: Pass \`workspace="${workspace}"\` to EVERY keb_* tool call.`,
      ].join("\n")
    : `**Workspace:** default (no workspace param needed)`;

  const slugList = affectedConceptSlugs
    .map((s) => `- \`concepts/${s}.md\``)
    .join("\n");

  return [
    `[knowledge-base-remove-phase-2] The document "${sourceName}" (docName: ${docName}) was removed from the knowledge base.`,
    `Phase 1 has already: deleted the summary, updated concept source lists, rebuilt the index, and removed the registry entry.`,
    ``,
    `The following concept pages previously referenced "${sourceName}" and have \`needs_review: true\` in their frontmatter:`,
    ``,
    slugList,
    ``,
    wsContext,
    ``,
    `### Instructions`,
    `For EACH concept listed above:`,
    ``,
    `1. Call \`keb_read_concept(slug)\` to read the current body.`,
    `   It will show \`⚠ needs_review: true\` in the output.`,
    ``,
    `2. Identify content that came from the removed document "${sourceName}".`,
    `   Remove ONLY that content. Keep everything traceable to the remaining sources.`,
    ``,
    `3. Call \`keb_write_concept(slug, cleanedBody, sources)\`.`,
    `   **IMPORTANT:** The sources list in the frontmatter is ALREADY CORRECT.`,
    `   Read it from the concept (\`keb_read_concept\` shows sources), verify it does NOT`,
    `   contain \`summary/${docName}\`, and pass it through UNCHANGED.`,
    `   The \`needs_review\` flag will be reset to false on write.`,
    ``,
    `If you cannot confidently identify which content came from "${sourceName}",`,
    `still call \`keb_write_concept\` with the body unchanged — the write will`,
    `clear \`needs_review\` and the concept will be marked as clean.`,
    ``,
    `DO NOT call \`keb_update_index\` — the index was already rebuilt in Phase 1.`,
    ``,
    `### Formatting rules`,
    `- When referencing other documents or concepts in the rewritten body, use standard markdown links:`,
    `  [text](/summaries/docname.md) or [text](/concepts/slug.md)`,
  ].join("\n");
}
