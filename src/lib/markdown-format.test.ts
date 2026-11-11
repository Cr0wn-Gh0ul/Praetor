import { describe, expect, it } from "vitest";
import { applyMarkdownAction, linkSelectionToUrl, looksLikeUrl } from "./markdown-format";

function run(value: string, selected: string, action: Parameters<typeof applyMarkdownAction>[3]) {
  const start = value.indexOf(selected);
  const result = applyMarkdownAction(value, start, start + selected.length, action);
  return { ...result, selection: result.value.slice(result.start, result.end) };
}

describe("applyMarkdownAction", () => {
  it("wraps the selection in bold and selects the inner text", () => {
    const result = run("make this loud", "this", "bold");
    expect(result.value).toBe("make **this** loud");
    expect(result.selection).toBe("this");
  });

  it("removes bold when the selection is already wrapped", () => {
    expect(run("make **this** loud", "this", "bold").value).toBe("make this loud");
  });

  it("inserts a selected placeholder when nothing is selected", () => {
    const result = applyMarkdownAction("", 0, 0, "italic");
    expect(result.value).toBe("_italic text_");
    expect(result.value.slice(result.start, result.end)).toBe("italic text");
  });

  it("uses a fenced block for multi-line code and inline code otherwise", () => {
    expect(run("a\nb", "a\nb", "code").value).toBe("```\na\nb\n```");
    expect(run("use foo here", "foo", "code").value).toBe("use `foo` here");
  });

  it("prefixes every selected line and toggles it off again", () => {
    const quoted = run("one\ntwo", "one\ntwo", "quote");
    expect(quoted.value).toBe("> one\n> two");
    expect(applyMarkdownAction(quoted.value, quoted.start, quoted.end, "quote").value).toBe("one\ntwo");
  });

  it("creates lists and task lists, skipping blank lines", () => {
    expect(run("a\n\nb", "a\n\nb", "list").value).toBe("- a\n\n- b");
    expect(run("do it", "do it", "task").value).toBe("- [ ] do it");
  });

  it("turns a selection into a link with the url selected", () => {
    const result = run("see docs now", "docs", "link");
    expect(result.value).toBe("see [docs](url) now");
    expect(result.selection).toBe("url");
  });

  it("uses a selected URL as the link target", () => {
    const result = run("https://example.com", "https://example.com", "link");
    expect(result.value).toBe("[link text](https://example.com)");
    expect(result.selection).toBe("link text");
  });

  it("inserts image syntax", () => {
    expect(applyMarkdownAction("", 0, 0, "image").value).toBe("![alt text](url)");
    expect(run("a diagram", "diagram", "image").value).toBe("a ![diagram](url)");
  });
});

describe("linkSelectionToUrl", () => {
  it("links selected text when a URL is pasted over it", () => {
    const result = linkSelectionToUrl("read the guide", 9, 14, "https://example.com/guide");
    expect(result?.value).toBe("read the [guide](https://example.com/guide)");
  });

  it("ignores pasted text that is not a URL or has no selection", () => {
    expect(linkSelectionToUrl("text", 0, 4, "not a url")).toBeNull();
    expect(linkSelectionToUrl("text", 2, 2, "https://example.com")).toBeNull();
  });

  it("only treats http(s) URLs as links", () => {
    expect(looksLikeUrl("https://example.com/a?b=1")).toBe(true);
    expect(looksLikeUrl("javascript:alert(1)")).toBe(false);
  });
});
