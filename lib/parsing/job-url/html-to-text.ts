import { HTMLElement, NodeType, parse, type Node } from "node-html-parser";

import { normalizeText } from "@/lib/parsing/extract-text";

// HTML job description → plain text in the same shape as an uploaded file:
// one paragraph or list item per line, "- " for list items.

const BLOCK = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "ul",
  "ol",
  "table",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "dl",
  "dt",
  "dd",
]);
const SKIP = new Set(["script", "style", "noscript", "template", "svg", "button"]);

function walk(node: Node, out: string[]): void {
  if (node.nodeType === NodeType.TEXT_NODE) {
    // Collapse source whitespace; line breaks come from elements.
    out.push(node.text.replace(/\s+/g, " "));
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  const tag = node.tagName?.toLowerCase() ?? "";
  if (SKIP.has(tag)) return;
  if (tag === "br") {
    out.push("\n");
    return;
  }
  if (tag === "li") {
    // No break after the item: the next item or the list's end adds one, so
    // items stay on consecutive lines.
    out.push("\n- ");
    for (const child of node.childNodes) walk(child, out);
    return;
  }
  const block = BLOCK.has(tag);
  if (block) out.push("\n");
  for (const child of node.childNodes) walk(child, out);
  if (block) out.push("\n");
}

/**
 * Converts an HTML fragment to text. Descriptions that arrive entity-escaped
 * ("&lt;p&gt;…", common in JSON-LD) are unescaped and parsed as HTML.
 */
export function htmlToText(html: string): string {
  let root = parse(html);
  if (!/<[a-z]/i.test(html) && /&lt;[a-z]/i.test(html)) root = parse(root.text);
  const out: string[] = [];
  walk(root, out);
  return normalizeText(
    out
      .join("")
      .split("\n")
      .map((line) => line.trim())
      // A "- " left from an empty or whitespace-only list item.
      .filter((line) => line !== "-")
      .join("\n")
      .replace(/\n{2,}/g, "\n\n"),
  );
}
