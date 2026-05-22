// Server-side HTML pipeline for the newsletter composer:
//   sanitizeHtml(raw)       → allowed-tag-only HTML, safe to store and send
//   styleHtmlForEmail(html) → inlines styles on the allowed tags for email clients
//   htmlToPlainText(html)   → reasonable plain-text fallback for the text part
//
// The editor in the browser also restricts what it produces, but the server is
// authoritative — anything that doesn't match the allowlist is dropped.

const ALLOWED_TAGS = new Set([
  'h1','h2','h3','p','br','hr',
  'strong','b','em','i','u',
  'a','ul','ol','li','blockquote',
]);
const VOID_TAGS = new Set(['br','hr']);
const ALLOWED_HREF_PROTOCOL = /^(https?:|mailto:)/i;

// Strip whole dangerous elements (script/style/iframe/etc) including their content.
const DANGEROUS_BLOCK_RE = /<(script|style|iframe|object|embed|svg|math|template|link|meta|noscript)\b[\s\S]*?<\/\1\s*>/gi;
const DANGEROUS_OPEN_RE  = /<(script|style|iframe|object|embed|svg|math|template|link|meta|noscript)\b[^>]*>/gi;
const COMMENT_RE         = /<!--[\s\S]*?-->/g;

function decodeHrefAttr(attrs) {
  const m = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!m) return '';
  return (m[2] ?? m[3] ?? m[4] ?? '').trim();
}

export function sanitizeHtml(input) {
  if (!input) return '';
  let html = String(input);
  html = html.replace(COMMENT_RE, '');
  html = html.replace(DANGEROUS_BLOCK_RE, '');
  html = html.replace(DANGEROUS_OPEN_RE, '');

  // Walk every tag and emit a safe rewrite.
  return html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_match, slash, tag, attrs) => {
    const t = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(t)) return '';

    // Closing tag — emit bare.
    if (slash === '/') return `</${t}>`;

    // Anchor — keep href only, normalize, force noopener.
    if (t === 'a') {
      const href = decodeHrefAttr(attrs);
      if (!href || !ALLOWED_HREF_PROTOCOL.test(href)) return '';
      const safeHref = href
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<a href="${safeHref}" rel="noopener noreferrer" target="_blank">`;
    }

    // Void tag — emit self-closing.
    if (VOID_TAGS.has(t)) return `<${t} />`;

    // Everything else — drop attributes entirely.
    return `<${t}>`;
  });
}

// Inline styles map for email-safe rendering. Email clients ignore <style>
// blocks and external stylesheets reliably, so every visible tag needs a
// style attribute.
const EMAIL_STYLES = {
  h1: 'font-family:Georgia,serif; font-size:1.7rem; margin:24px 0 10px; letter-spacing:-.015em; color:#1f1d1a;',
  h2: 'font-family:Georgia,serif; font-size:1.35rem; margin:22px 0 10px; letter-spacing:-.01em; color:#1f1d1a;',
  h3: 'font-family:Georgia,serif; font-size:1.1rem;  margin:20px 0 8px;  letter-spacing:-.005em; color:#1f1d1a;',
  p:  'margin:0 0 14px; line-height:1.6;',
  ul: 'margin:12px 0 14px; padding-left:22px;',
  ol: 'margin:12px 0 14px; padding-left:22px;',
  li: 'margin:0 0 6px;',
  blockquote: 'margin:14px 0; padding:6px 0 6px 16px; border-left:3px solid #8a6432; color:#655e55; font-style:italic;',
  hr: 'border:none; border-top:1px solid rgba(138,100,50,.22); margin:24px 0;',
  strong: 'font-weight:700;',
  b: 'font-weight:700;',
  em: 'font-style:italic;',
  i: 'font-style:italic;',
};

export function styleHtmlForEmail(html) {
  if (!html) return '';
  return html.replace(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (m, tag, rest) => {
    const t = tag.toLowerCase();
    const style = EMAIL_STYLES[t];
    if (!style) {
      if (t === 'a') {
        // Inject color while preserving existing href / rel / target attributes.
        return m.replace(/<a\b/i, '<a style="color:#8a6432;"');
      }
      return m;
    }
    // Already void? <hr /> arrives with a trailing slash.
    const isVoid = /\/\s*$/.test(rest);
    return `<${t} style="${style}"${isVoid ? ' /' : ''}>`;
  });
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

export function htmlToPlainText(html) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(COMMENT_RE, '');
  // Block-aware substitutions, in order.
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, inner) => `\n${stripInline(inner).toUpperCase()}\n${'='.repeat(40)}\n\n`);
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, inner) => `\n${stripInline(inner)}\n${'-'.repeat(40)}\n\n`);
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, inner) => `\n${stripInline(inner)}\n\n`);
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => `  • ${stripInline(inner)}\n`);
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner) => {
    const cleaned = stripInline(inner).split('\n').map(l => `> ${l}`).join('\n');
    return `\n${cleaned}\n\n`;
  });
  s = s.replace(/<hr\s*\/?>/gi, `\n${'—'.repeat(40)}\n\n`);
  s = s.replace(/<a\b[^>]*\bhref\s*=\s*("([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi,
                (_m, _q, h1, h2, inner) => {
    const href = h1 || h2 || '';
    return `${stripInline(inner)} (${href})`;
  });
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner) => `${stripInline(inner)}\n\n`);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Drop list wrappers (their items are already handled).
  s = s.replace(/<\/?ul[^>]*>/gi, '\n');
  s = s.replace(/<\/?ol[^>]*>/gi, '\n');
  // Strip anything that survived.
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, m => ENTITIES[m] || ' ');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

function stripInline(s) {
  return String(s).replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, m => ENTITIES[m] || ' ').replace(/\s+/g, ' ').trim();
}
