export type MarkdownAction = "bold" | "italic" | "code" | "quote" | "list" | "task" | "link" | "image";

export type MarkdownEdit = { value: string; start: number; end: number };

const LINE_PREFIXES = { quote: "> ", list: "- ", task: "- [ ] " } as const;

export function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(text.trim());
}

function splice(value: string, start: number, end: number, insert: string, selectStart: number, selectEnd: number): MarkdownEdit {
  return { value: value.slice(0, start) + insert + value.slice(end), start: start + selectStart, end: start + selectEnd };
}

function wrap(value: string, start: number, end: number, before: string, after: string, placeholder: string): MarkdownEdit {
  const selected = value.slice(start, end);
  if (!selected) return splice(value, start, end, before + placeholder + after, before.length, before.length + placeholder.length);
  const alreadyWrapped = value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after;
  if (alreadyWrapped) {
    return { value: value.slice(0, start - before.length) + selected + value.slice(end + after.length), start: start - before.length, end: end - before.length };
  }
  return splice(value, start, end, before + selected + after, before.length, before.length + selected.length);
}

function prefixLines(value: string, start: number, end: number, prefix: string): MarkdownEdit {
  const blockStart = value.lastIndexOf("\n", start - 1) + 1;
  const searchFrom = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const newline = value.indexOf("\n", searchFrom);
  const blockEnd = newline === -1 ? value.length : newline;
  const lines = value.slice(blockStart, blockEnd).split("\n");
  const content = lines.filter((line) => line.trim());
  const remove = content.length > 0 && content.every((line) => line.startsWith(prefix));
  const next = lines.map((line) => {
    if (!line.trim()) return line;
    return remove ? line.slice(prefix.length) : prefix + line;
  }).join("\n");
  return { value: value.slice(0, blockStart) + next + value.slice(blockEnd), start: blockStart, end: blockStart + next.length };
}

function insertLink(value: string, start: number, end: number, image: boolean): MarkdownEdit {
  const opener = image ? "![" : "[";
  const selected = value.slice(start, end);
  if (looksLikeUrl(selected)) {
    const label = image ? "alt text" : "link text";
    return splice(value, start, end, `${opener}${label}](${selected.trim()})`, opener.length, opener.length + label.length);
  }
  if (selected) {
    const urlStart = opener.length + selected.length + 2;
    return splice(value, start, end, `${opener}${selected}](url)`, urlStart, urlStart + 3);
  }
  const label = image ? "alt text" : "link text";
  return splice(value, start, end, `${opener}${label}](url)`, opener.length, opener.length + label.length);
}

export function applyMarkdownAction(value: string, start: number, end: number, action: MarkdownAction): MarkdownEdit {
  switch (action) {
    case "bold": return wrap(value, start, end, "**", "**", "bold text");
    case "italic": return wrap(value, start, end, "_", "_", "italic text");
    case "code": return value.slice(start, end).includes("\n")
      ? wrap(value, start, end, "```\n", "\n```", "code")
      : wrap(value, start, end, "`", "`", "code");
    case "quote":
    case "list":
    case "task": return prefixLines(value, start, end, LINE_PREFIXES[action]);
    case "link": return insertLink(value, start, end, false);
    case "image": return insertLink(value, start, end, true);
  }
}

/** Pasting a URL over selected text turns the selection into a link, like GitHub. */
export function linkSelectionToUrl(value: string, start: number, end: number, pasted: string): MarkdownEdit | null {
  const selected = value.slice(start, end);
  if (!selected || selected.includes("\n") || !looksLikeUrl(pasted)) return null;
  const url = pasted.trim();
  return splice(value, start, end, `[${selected}](${url})`, 1 + selected.length + 2, 1 + selected.length + 2 + url.length);
}
