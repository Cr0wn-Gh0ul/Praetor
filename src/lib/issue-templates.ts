import { parse as parseYaml } from "yaml";

export type IssueTemplate = {
  id: string;
  name: string;
  title: string;
  body: string;
  labels: string[];
};

type TemplateMetadata = { name?: unknown; title?: unknown; labels?: unknown };

function labelsFrom(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(values.filter((label): label is string => typeof label === "string").map((label) => label.trim()).filter(Boolean))].slice(0, 50);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formBody(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.flatMap((field) => {
    if (!field || typeof field !== "object") return [];
    const item = field as { type?: unknown; attributes?: { label?: unknown; description?: unknown; value?: unknown; options?: unknown } };
    const attributes = item.attributes;
    if (item.type === "markdown") {
      const markdown = text(attributes?.value);
      return markdown ? [markdown] : [];
    }
    if (!attributes) return [];
    const heading = text(attributes?.label);
    if (!heading) return [];
    const description = text(attributes?.description);
    const options = Array.isArray(attributes?.options) ? attributes.options.flatMap((option) => {
      if (typeof option === "string") return [option];
      if (option && typeof option === "object" && "label" in option && typeof option.label === "string") return [option.label];
      return [];
    }) : [];
    const valueText = text(attributes?.value);
    const scaffold = item.type === "checkboxes"
      ? options.map((option) => `- [ ] ${option}`).join("\n")
      : item.type === "dropdown" && options.length
        ? options.map((option) => `- ${option}`).join("\n")
        : valueText;
    const details = [description, scaffold].filter(Boolean);
    return [`## ${heading}${details.length ? `\n\n${details.join("\n\n")}` : ""}`];
  }).join("\n\n").trim();
}

export function parseIssueTemplate(id: string, filename: string, source: string): IssueTemplate | null {
  const extension = filename.toLowerCase().split(".").pop();
  const fallbackName = filename.replace(/\.(md|ya?ml)$/i, "").replace(/[-_]+/g, " ").trim();
  if (extension === "md") {
    let body = source.trim();
    let metadata: TemplateMetadata = {};
    if (body.startsWith("---\n")) {
      const end = body.indexOf("\n---", 4);
      if (end < 0) return null;
      try {
        const parsed: unknown = parseYaml(body.slice(4, end));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as TemplateMetadata;
      } catch {
        return null;
      }
      body = body.slice(end + 4).trim();
    }
    return { id, name: text(metadata.name) || fallbackName, title: text(metadata.title), body, labels: labelsFrom(metadata.labels) };
  }
  if (extension === "yml" || extension === "yaml") {
    try {
      const parsed: unknown = parseYaml(source);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const metadata = parsed as TemplateMetadata & { body?: unknown };
      return { id, name: text(metadata.name) || fallbackName, title: text(metadata.title), body: formBody(metadata.body), labels: labelsFrom(metadata.labels) };
    } catch {
      return null;
    }
  }
  return null;
}
