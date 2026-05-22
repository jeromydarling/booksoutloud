// Tiny Markdown renderer for BooksOutLoud newsletters.
//
// Intentionally minimal — supports the subset that fits a literary salon
// dispatch: headings, paragraphs, bullets, blockquotes, **bold**, _italic_,
// and [links](url). No inline HTML, no code blocks, no images.
//
// This file is intentionally duplicated at public/admin/markdown.js for
// client-side live preview. Keep them in sync.

const RE_HEADING    = /^(#{1,3})\s+(.*)$/;
const RE_BLOCKQUOTE = /^>\s?(.*)$/;
const RE_LIST_ITEM  = /^[-*]\s+(.*)$/;
const RE_HR         = /^[-*_]{3,}\s*$/;

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function renderInline(s) {
  let out = escapeHtml(s);
  // Links: [text](https://...)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text, url) =>
    `<a href="${url}" style="color:#8a6432;">${text}</a>`);
  // Bold: **text**
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Italic: _text_  (use underscore to avoid colliding with bold)
  out = out.replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
  return out;
}

export function renderMarkdownToHtml(md) {
  if (!md) return '';
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    let line = lines[i];

    // Skip blank lines.
    if (!line.trim()) { i++; continue; }

    // Horizontal rule.
    if (RE_HR.test(line)) {
      out.push('<hr style="border:none; border-top:1px solid rgba(138,100,50,.2); margin:24px 0;" />');
      i++; continue;
    }

    // Heading.
    const h = line.match(RE_HEADING);
    if (h) {
      const level = h[1].length;
      const size = level === 1 ? '1.6rem' : level === 2 ? '1.3rem' : '1.1rem';
      out.push(`<h${level} style="font-family:Georgia,serif; font-size:${size}; margin:22px 0 10px; letter-spacing:-.01em;">${renderInline(h[2])}</h${level}>`);
      i++; continue;
    }

    // Blockquote: consume contiguous > lines.
    if (RE_BLOCKQUOTE.test(line)) {
      const buf = [];
      while (i < lines.length && RE_BLOCKQUOTE.test(lines[i])) {
        buf.push(lines[i].match(RE_BLOCKQUOTE)[1]);
        i++;
      }
      out.push(`<blockquote style="margin:14px 0; padding:6px 0 6px 16px; border-left:3px solid #8a6432; color:#655e55; font-style:italic;">${renderInline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // List: consume contiguous bullet lines.
    if (RE_LIST_ITEM.test(line)) {
      const items = [];
      while (i < lines.length && RE_LIST_ITEM.test(lines[i])) {
        items.push(`<li style="margin:0 0 6px;">${renderInline(lines[i].match(RE_LIST_ITEM)[1])}</li>`);
        i++;
      }
      out.push(`<ul style="margin:12px 0; padding-left:22px;">${items.join('')}</ul>`);
      continue;
    }

    // Paragraph: consume lines until blank or block trigger.
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() &&
           !RE_HEADING.test(lines[i]) &&
           !RE_BLOCKQUOTE.test(lines[i]) &&
           !RE_LIST_ITEM.test(lines[i]) &&
           !RE_HR.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p style="margin:0 0 14px; line-height:1.6;">${renderInline(buf.join(' '))}</p>`);
  }

  return out.join('\n');
}

export function renderMarkdownToText(md) {
  if (!md) return '';
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  for (const raw of lines) {
    let line = raw;
    // Heading: keep the text; double-newline after.
    const h = line.match(RE_HEADING);
    if (h) { out.push(h[2].toUpperCase()); out.push(''); continue; }
    // Blockquote: prefix with "> ".
    const bq = line.match(RE_BLOCKQUOTE);
    if (bq) { out.push(`> ${bq[1]}`); continue; }
    // Bullet: "• ".
    const li = line.match(RE_LIST_ITEM);
    if (li) { out.push(`  • ${li[1]}`); continue; }
    if (RE_HR.test(line)) { out.push('—'.repeat(40)); continue; }
    out.push(line);
  }
  // Strip inline markdown markers.
  return out.join('\n')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, '$1$2');
}
// NOTE: kept in sync with functions/_lib/markdown.js by hand.
