/**
 * HTML that arrives from a model is rendered in a few places (dialog nodes, previews). These strip
 * it down to something safe to insert and pull it out of a fenced block.
 */
export function sanitizePreviewHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script").forEach((script) => script.remove());
  doc.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (
        /^(?:href|src|xlink:href|formaction)$/i.test(attribute.name)
        && /^\s*javascript:/i.test(attribute.value)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

export function extractHtmlFromCodeBlock(content: string): string | null {
  // Match ```html ... ``` code block
  const htmlBlockRegex = /```html\s*\n([\s\S]*?)```/;
  const match = content.match(htmlBlockRegex);

  if (match && match[1]) {
    let html = match[1].trim();

    // If it doesn't start with <html or <!DOCTYPE, wrap it
    if (!/<\s*html/i.test(html) && !/<\s*!DOCTYPE/i.test(html)) {
      html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body>${html}</body></html>`;
    }

    return html;
  }

  return null;
}
