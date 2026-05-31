/** 轻量 Markdown → HTML 渲染器（无依赖）。 */

export function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderMarkdown(text) {
  if (!text) return "";
  const htmlBlocks = [];
  const stashHtml = (html) => {
    const key = `@@CHAT_HTML_${htmlBlocks.length}@@`;
    htmlBlocks.push(html);
    return key;
  };
  const textWithTables = text.replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
    return "\n" + stashHtml(renderHtmlTable(tableHtml)) + "\n";
  });

  let lines = textWithTables.split("\n");
  const out = [];
  let inTable = false;
  let tableRows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("@@CHAT_HTML_")) {
      if (inTable) { out.push(stashHtml(renderMdTable(tableRows))); tableRows = []; inTable = false; }
      out.push(line);
      continue;
    }
    if (line.startsWith("|") && line.endsWith("|")) {
      if (!inTable) { inTable = true; tableRows = []; }
      tableRows.push(line);
    } else {
      if (inTable) { out.push(stashHtml(renderMdTable(tableRows))); tableRows = []; inTable = false; }
      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
        out.push(stashHtml("<hr>"));
        continue;
      }
      out.push(line);
    }
  }
  if (inTable) out.push(stashHtml(renderMdTable(tableRows)));
  let h = out.join("\n")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">')
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/\n{2,}/g, "\n\n")
    .replace(/\n(?!<|@@CHAT_HTML_)/g, "<br>")
    .replace(/(<li>.*?<\/li>(<br>)?)+/g, "<ul>$&</ul>")
    .replace(/@@CHAT_HTML_(\d+)@@/g, (_, idx) => htmlBlocks[Number(idx)] || "")
    .replace(/<br>(<(?:table|hr)\b)/g, "$1")
    .replace(/(<\/table>|<hr>)<br>/g, "$1");
  return h;
}

export function renderMdTable(rows) {
  if (!rows.length) return "";
  const bodyRows = rows.filter(row => !isMdTableSeparator(row));
  if (!bodyRows.length) return "";
  let html = "<table>";
  for (let i = 0; i < bodyRows.length; i++) {
    const cells = splitMdRow(bodyRows[i]);
    const tag = i === 0 ? "th" : "td";
    html += "<tr>" + cells.map(c => `<${tag}>${inlineMd(c)}</${tag}>`).join("") + "</tr>";
  }
  html += "</table>";
  return html;
}

export function renderHtmlTable(tableHtml) {
  const rows = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  if (!rows.length) return "";
  let html = "<table>";
  for (const row of rows) {
    const cells = [...row.matchAll(/<(th|td)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
    if (!cells.length) continue;
    const normalizedCells = cells.map(([, tag, cell]) => ({
      tag: tag.toLowerCase() === "th" ? "th" : "td",
      text: htmlToText(cell),
    }));
    if (isTableSeparatorCells(normalizedCells.map(cell => cell.text))) continue;
    html += "<tr>" + normalizedCells.map(cell => {
      return `<${cell.tag}>${inlineMd(cell.text)}</${cell.tag}>`;
    }).join("") + "</tr>";
  }
  html += "</table>";
  return html === "<table></table>" ? "" : html;
}

export function splitMdRow(row) {
  return row.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
}

export function isMdTableSeparator(row) {
  return isTableSeparatorCells(splitMdRow(row));
}

export function isTableSeparatorCells(cells) {
  return cells.length > 0 && cells.every(c => /^:?-{3,}:?$/.test(c.replace(/\s/g, "")));
}

export function inlineMd(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function htmlToText(html) {
  const withoutTags = html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = withoutTags;
    return textarea.value.trim();
  }
  return withoutTags.trim();
}
