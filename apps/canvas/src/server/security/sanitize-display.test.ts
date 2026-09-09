import { describe, expect, it } from 'vitest';

import { sanitizeDisplayContent } from './sanitize-display.js';

describe('sanitizeDisplayContent', () => {
  it('retains every approved HTML family and validated global and table attributes', () => {
    const html = `
      <main lang="en-US" dir="RTL" class="message _safe --wide" title="Synthetic">
        <header><h1>Subject</h1></header>
        <section><article><p>Body<br><strong>bold</strong> <em>em</em>
          <u>u</u><s>s</s><small>small</small><sub>sub</sub><sup>sup</sup></p>
          <blockquote><pre><code>code</code></pre></blockquote>
          <ul><li>one</li></ul><ol><li>two</li></ol>
          <dl><dt>term</dt><dd>definition</dd></dl>
          <div><span>b</span><i>i</i><hr></div>
          <table><caption>cap</caption><thead><tr><th colspan="02" rowspan="3"
            scope="COL">head</th></tr></thead><tbody><tr><td>cell</td></tr></tbody>
            <tfoot><tr><td>foot</td></tr></tfoot></table>
        </article></section>
        <footer>End</footer>
      </main>
    `;

    const result = sanitizeDisplayContent({ html, css: '' });

    expect(result.warnings).toEqual([]);
    expect(result.html).toContain(
      '<main lang="en-US" dir="rtl" class="message _safe --wide" title="Synthetic">',
    );
    expect(result.html).toContain(
      '<th colspan="2" rowspan="3" scope="col">head</th>',
    );
    for (const tag of [
      'header',
      'h1',
      'section',
      'article',
      'p',
      'br',
      'strong',
      'em',
      'u',
      's',
      'small',
      'sub',
      'sup',
      'blockquote',
      'pre',
      'code',
      'ul',
      'ol',
      'li',
      'dl',
      'dt',
      'dd',
      'div',
      'span',
      'i',
      'hr',
      'table',
      'caption',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
      'footer',
      'main',
    ]) {
      expect(result.html).toContain(`<${tag}`);
    }
    expect(result.text).toContain('Subject');
    expect(result.text).toContain('definition');
  });

  it('drops active and resource subtrees, handlers, and arbitrary embedded markup', () => {
    const result = sanitizeDisplayContent({
      html: `
        <script src="https://example.invalid/a.js">script text</script>
        <style>style text</style><template>template text</template>
        <noscript>noscript text</noscript><iframe srcdoc="bad">frame text</iframe>
        <object data="x">object text</object><embed src="x"><form action="x">
        form text<input value="secret"><button>button text</button></form>
        <svg><text>svg text</text></svg><math>math text</math>
        <video poster="x"><source src="x">media text</video>
        <img src="https://example.invalid/pixel" alt="tracking">
        <link href="https://example.invalid/x"><meta content="x"><base href="/">
        <p onclick="run()">Retained body</p>
      `,
      css: '',
    });

    expect(result.html).toContain('<p>Retained body</p>');
    expect(result.html).not.toMatch(
      /<(?:script|style|template|noscript|iframe|object|embed|form|input|button|svg|math|video|source|img|link|meta|base)\b/,
    );
    expect(result.text).toContain('Retained body');
    expect(result.text).not.toMatch(
      /script text|style text|template text|form text|svg text|math text|media text/,
    );
    expect(result.warnings).toEqual([
      'active-content',
      'external-resource',
      'unsupported-markup',
    ]);
  });

  it('unwraps navigation and unsupported structures while stripping their attributes', () => {
    const result = sanitizeDisplayContent({
      html: `
        <a href="https://example.invalid" target="_blank" class="link">Link text</a>
        <custom data-note="x"><p id="authored" aria-label="x">Nested text</p></custom>
      `,
      css: '',
    });

    expect(result.html).toContain('Link text');
    expect(result.html).toContain('<p>Nested text</p>');
    expect(result.html).not.toContain('<a');
    expect(result.html).not.toContain('<custom');
    expect(result.html).not.toMatch(
      /href|target|class|data-note|id=|aria-label/,
    );
    expect(result.warnings).toEqual(['navigation', 'unsupported-markup']);
  });

  it('drops metadata title text but unwraps noninteractive meter and progress content', () => {
    const result = sanitizeDisplayContent({
      html: '<title>Metadata only</title><meter>42 percent</meter><progress>Halfway</progress>',
      css: '',
    });

    expect(result.html).toBe('42 percentHalfway');
    expect(result.text).toBe('42 percentHalfway');
    expect(result.warnings).toEqual(['unsupported-markup']);
  });

  it('validates attribute values and removes invalid attributes as units', () => {
    const result = sanitizeDisplayContent({
      html: `
        <div class="safe bad:token" lang="not_a_tag" dir="sideways">Body</div>
        <table><tr><th colspan="0" rowspan="101" scope="page">Head</th>
        <td colspan="2.5">Cell</td></tr></table>
      `,
      css: '',
    });

    expect(result.html).toContain('<div>Body</div>');
    expect(result.html).toContain('<th>Head</th>');
    expect(result.html).toContain('<td>Cell</td>');
    expect(result.warnings).toEqual(['unsupported-markup']);
  });

  it('retains standard, private-use, and grandfathered BCP 47 language tags', () => {
    const result = sanitizeDisplayContent({
      html: '<p lang="zh-Hant-TW">One</p><p lang="x-private">Two</p><p lang="i-klingon">Three</p>',
      css: '',
    });

    expect(result.html).toBe(
      '<p lang="zh-Hant-TW">One</p><p lang="x-private">Two</p><p lang="i-klingon">Three</p>',
    );
    expect(result.warnings).toEqual([]);
  });

  it('normalizes inline styles to unique generated IDs after field CSS', () => {
    const result = sanitizeDisplayContent({
      html: `
        <p id="authored" style="color: red; position: fixed">First</p>
        <p style="color: rgb(1 2 3); margin: 1px">Second</p>
      `,
      css: 'p { color: blue; }',
    });

    expect(result.html).toContain('<p id="agent-canvas-inline-1">First</p>');
    expect(result.html).toContain('<p id="agent-canvas-inline-2">Second</p>');
    expect(result.html).not.toContain('style=');
    expect(result.html).not.toContain('authored');
    expect(result.css).toBe(
      'p{color:blue}#agent-canvas-inline-1{color:red}#agent-canvas-inline-2{color:rgb(1 2 3);margin:1px}',
    );
    expect(result.warnings).toEqual(['unsupported-markup', 'unsupported-css']);
  });

  it('decodes CSS escapes and HTML entities before URL/function classification', () => {
    const result = sanitizeDisplayContent({
      html: `
        <p style="background-color:u&#114;l(https://example.invalid/x);color:v\\61r(--x)">
          Body
        </p>
      `,
      css: '@\\69mport "https://example.invalid/x";p{color:blue}',
    });

    expect(result.css).toBe('p{color:blue}');
    expect(result.html).not.toContain('style=');
    expect(result.warnings).toEqual(['external-resource', 'unsupported-css']);
  });

  it('counts only retained decoded body text as meaningful content', () => {
    const retained = sanitizeDisplayContent({
      html: '<p>&lt;&amp;&gt;</p>',
      css: '',
    });
    const whitespace = sanitizeDisplayContent({
      html: '<div title="attribute"><!-- comment -->&#x20;&nbsp;</div><script>text</script>',
      css: 'p::before{content:"text"}',
    });

    expect(retained.text).toBe('<&>');
    expect(whitespace.text.trim()).toBe('');
    expect(whitespace.warnings).toEqual(['active-content', 'unsupported-css']);
  });

  it('discards malformed CSS and style-breakout attempts without passing markup through', () => {
    const result = sanitizeDisplayContent({
      html: '<p style="color:red}</style><script>run()</script>">Body</p>',
      css: 'p{color:red}</style><script>run()</script>',
    });

    expect(result.html).toBe('<p>Body</p>');
    expect(result.css).toBe('');
    expect(result.css).not.toContain('</style');
    expect(result.warnings).toEqual(['unsupported-css']);
  });

  it('demonstrates real normalization expansion without retaining raw style attributes', () => {
    const input = '<p style="color:red">x</p>';
    const result = sanitizeDisplayContent({ html: input, css: '' });

    expect(
      Buffer.byteLength(result.html) + Buffer.byteLength(result.css),
    ).toBeGreaterThan(Buffer.byteLength(input));
    expect(result.html).not.toContain('style=');
  });
});
