/** Pure helpers for issue-draft Markdown. Safe to use from client and server code. */

export type IssueParts = { title: string; body: string };

function stripWrappingFence(text: string): string {
  return /^```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```$/i.exec(text)?.[1]?.trim() ?? text;
}

/**
 * Splits model or user Markdown into an issue title and body. The title is taken from a leading
 * H1 only; headings later in the document stay in the body.
 */
export function splitIssueMarkdown(markdown: string): IssueParts {
  const text = stripWrappingFence(markdown.replace(/\r\n?/g, "\n").trim());
  const lines = text.split("\n");
  const firstIndex = lines.findIndex((line) => line.trim() !== "");
  if (firstIndex === -1) return { title: "", body: "" };

  const heading = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(lines[firstIndex]!.trim());
  if (!heading) return { title: "", body: text };

  let title = heading[1]!.trim();
  let rest = lines.slice(firstIndex + 1);
  // Some models emit a literal "# Title" heading followed by the actual title on the next line.
  if (/^title:?$/i.test(title)) {
    const titleIndex = rest.findIndex((line) => line.trim() !== "");
    const candidate = titleIndex >= 0 ? rest[titleIndex]!.trim() : "";
    if (candidate && !candidate.startsWith("#")) {
      title = candidate;
      rest = rest.slice(titleIndex + 1);
    } else {
      title = "";
    }
  }
  return { title: title.replace(/^title:\s*/i, "").slice(0, 256), body: rest.join("\n").trim() };
}

/** Produces the title and body to publish, tolerating legacy drafts that kept the H1 in the body. */
export function issueFromDraft(draft: IssueParts): IssueParts {
  const split = splitIssueMarkdown(draft.body);
  const title = draft.title.trim() || split.title;
  const body = split.title ? split.body : draft.body.trim();
  return { title, body };
}
