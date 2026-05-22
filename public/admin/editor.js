// Minimal WYSIWYG editor for the newsletter composer.
//
// Built on contenteditable + document.execCommand. The output is a small
// allowed set of tags (h2/h3/p/strong/em/a/ul/li/blockquote/hr/br) which the
// server re-sanitizes before storage — defense in depth, since execCommand
// output varies across browsers.
//
// The editor exposes a tiny API: new Editor(host, opts), getHTML(), setHTML(),
// reset(), focus(). The host element is decorated in-place with a toolbar and
// an editable area.

const ALLOWED_LINK_PROTOCOL = /^(https?:|mailto:)/i;

export class Editor {
  constructor(host, opts = {}) {
    this.host = host;
    this.onChange = opts.onChange || (() => {});
    this.host.classList.add('bol-editor');
    this.host.innerHTML = '';

    this.toolbar = document.createElement('div');
    this.toolbar.className = 'bol-editor-toolbar';

    this.area = document.createElement('div');
    this.area.className = 'bol-editor-area';
    this.area.setAttribute('contenteditable', 'true');
    this.area.setAttribute('role', 'textbox');
    this.area.setAttribute('aria-multiline', 'true');
    this.area.setAttribute('spellcheck', 'true');
    this.area.dataset.placeholder = opts.placeholder || 'Start writing…';

    this.host.appendChild(this.toolbar);
    this.host.appendChild(this.area);

    this.buildToolbar();
    this.wireEvents();
  }

  buildToolbar() {
    const groups = [
      [
        { key: 'h2', label: 'H2', title: 'Heading',          cmd: () => this.format('h2') },
        { key: 'h3', label: 'H3', title: 'Subheading',       cmd: () => this.format('h3') },
        { key: 'p',  label: '¶',  title: 'Paragraph',        cmd: () => this.format('p') },
      ],
      [
        { key: 'bold',   label: 'B', title: 'Bold (Ctrl+B)',   cmd: () => this.exec('bold'),   style: 'font-weight:700;' },
        { key: 'italic', label: 'I', title: 'Italic (Ctrl+I)', cmd: () => this.exec('italic'), style: 'font-style:italic;' },
        { key: 'link',   label: '⌁', title: 'Link (Ctrl+K)',   cmd: () => this.link() },
      ],
      [
        { key: 'ul',    label: '•',  title: 'Bullet list', cmd: () => this.exec('insertUnorderedList') },
        { key: 'quote', label: '“ ”', title: 'Blockquote',  cmd: () => this.format('blockquote') },
        { key: 'hr',    label: '—',  title: 'Divider',     cmd: () => this.exec('insertHorizontalRule') },
      ],
      [
        { key: 'clear', label: '✕', title: 'Clear formatting', cmd: () => this.clearFormat() },
      ],
    ];
    for (const group of groups) {
      const wrap = document.createElement('div');
      wrap.className = 'bol-editor-group';
      for (const b of group) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = b.label;
        btn.title = b.title;
        btn.dataset.cmd = b.key;
        if (b.style) btn.setAttribute('style', b.style);
        // Prevent the editor from losing focus when the button is clicked.
        btn.addEventListener('mousedown', e => e.preventDefault());
        btn.addEventListener('click', b.cmd);
        wrap.appendChild(btn);
      }
      this.toolbar.appendChild(wrap);
    }
  }

  wireEvents() {
    this.area.addEventListener('input', () => this.onChange(this.getHTML()));

    // Paste — strip all formatting and inline only the plain text. This is
    // the cheap-but-effective XSS guard; pairing with server sanitization
    // gives defense in depth.
    this.area.addEventListener('paste', e => {
      e.preventDefault();
      const cd = e.clipboardData || window.clipboardData;
      const text = (cd && cd.getData('text/plain')) || '';
      document.execCommand('insertText', false, text);
    });

    // Drop — same treatment for drag-and-drop.
    this.area.addEventListener('drop', e => {
      e.preventDefault();
      const text = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || '';
      document.execCommand('insertText', false, text);
    });

    // Ctrl/Cmd + K for link.
    this.area.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.link();
      }
    });

    // Replace plain Enter at the very start (when empty) with a <p> wrapper.
    this.area.addEventListener('keyup', () => {
      // execCommand sometimes produces stray <div>s when the editor is empty;
      // normalize on a fresh empty editor to start in paragraph mode.
      if (this.area.innerHTML === '<br>' || this.area.innerHTML === '') {
        this.area.innerHTML = '';
      }
    });
  }

  exec(cmd, value = null) {
    this.area.focus();
    document.execCommand(cmd, false, value);
    this.onChange(this.getHTML());
  }

  format(block) {
    // Some browsers expect '<h2>' rather than 'h2'.
    this.exec('formatBlock', `<${block}>`);
  }

  link() {
    const selection = window.getSelection();
    const hasSelection = selection && selection.toString().trim().length > 0;
    if (!hasSelection) {
      alert('Select some text first, then add a link.');
      return;
    }
    const url = prompt('Link URL (https://… or mailto:…):', 'https://');
    if (!url) return;
    if (!ALLOWED_LINK_PROTOCOL.test(url)) {
      alert('Only https://, http://, and mailto: links are allowed.');
      return;
    }
    this.exec('createLink', url);
  }

  clearFormat() {
    this.exec('removeFormat');
    this.format('p');
  }

  getHTML() {
    // Trim trailing empty paragraphs and stray <br> tags.
    let html = this.area.innerHTML;
    html = html.replace(/(<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>\s*)+$/i, '');
    html = html.replace(/^\s*<br\s*\/?>/i, '');
    return html.trim();
  }

  setHTML(html) {
    this.area.innerHTML = html || '';
  }

  focus() {
    this.area.focus();
  }

  reset() {
    this.area.innerHTML = '';
  }

  isEmpty() {
    const stripped = this.getHTML().replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    return stripped.length === 0;
  }
}
