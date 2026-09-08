import { describe, expect, it } from 'vitest';

import {
  sanitizeDeclarationList,
  sanitizeStylesheet,
  serializeCssForStyleElement,
} from './css-policy.js';

describe('sanitizeStylesheet', () => {
  it('retains the approved selector, text, box, table, and flex families', () => {
    const result = sanitizeStylesheet(`
      div.notice, * > table .cell {
        color: rebeccapurple;
        background-color: rgb(1 2 3 / 40%);
        font-family: serif, system-ui;
        font-size: 1.25rem;
        font-weight: 700;
        font-style: italic;
        line-height: 1.4;
        letter-spacing: 1px;
        word-spacing: 0.2em;
        text-align: center;
        text-decoration-line: underline;
        text-decoration-color: #abc;
        text-decoration-style: dotted;
        text-transform: uppercase;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
        vertical-align: middle;
        margin: 1px 2%;
        padding-top: 1vh;
        border: 1px solid navy;
        border-left-color: hsl(120 50% 50%);
        border-radius: 4px;
        width: 50vw;
        min-width: 2em;
        max-width: 100%;
        height: auto;
        min-height: 1px;
        max-height: none;
        box-sizing: border-box;
        border-collapse: collapse;
        border-spacing: 1px 2px;
        table-layout: fixed;
        list-style-type: square;
        list-style-position: inside;
        display: flex;
        flex-direction: column;
        flex-wrap: wrap;
        flex-grow: 1;
        flex-shrink: 0;
        flex-basis: 10rem;
        justify-content: space-between;
        align-items: center;
        align-content: stretch;
        align-self: flex-start;
        gap: 1rem;
        row-gap: 2px;
        column-gap: 3%;
      }
    `);

    expect(result).toMatchObject({
      removedExternalResource: false,
      removedUnsupported: false,
    });
    expect(result.css).toContain('div.notice,*>table .cell{');
    expect(result.css).toContain('background-color:rgb(1 2 3/40%)');
    expect(result.css).toContain('font-family:serif,system-ui');
    expect(result.css).toContain('display:flex');
    expect(result.css).toContain('column-gap:3%');
  });

  it('permits only the approved CSS-wide, display, font, function, and unit values', () => {
    const result = sanitizeStylesheet(`
      p {
        color: inherit;
        margin: initial;
        padding: unset;
        display: grid;
        font-family: "Downloaded Font", sans-serif;
        width: 1cm;
        height: calc(100% - 1px);
        color: color(display-p3 1 0 0);
        border-color: rgba(1, 2, 3, 0.5);
      }
    `);

    expect(result.css).toBe(
      'p{color:inherit;margin:initial;padding:unset;border-color:rgba(1,2,3,0.5)}',
    );
    expect(result.removedUnsupported).toBe(true);
    expect(result.removedExternalResource).toBe(false);
  });

  it.each([
    '#authored',
    '[title]',
    'p:first-child',
    'p::before',
    'p + span',
    'p ~ span',
    'img',
    '.safe, #unsafe',
  ])('drops a whole rule for unsupported selector %s', (selector) => {
    const result = sanitizeStylesheet(
      `${selector}{color:red}p.safe > span{color:blue}`,
    );

    expect(result.css).toBe('p.safe>span{color:blue}');
    expect(result.removedUnsupported).toBe(true);
  });

  it('drops unsupported declarations while retaining unrelated valid declarations', () => {
    const result = sanitizeDeclarationList(`
      color: blue;
      position: fixed;
      --private: red;
      transform: rotate(1deg);
      opacity: 0;
      content: "injected";
      color: red !important;
      margin: 1px;
    `);

    expect(result.css).toBe('color:blue;margin:1px');
    expect(result.removedUnsupported).toBe(true);
    expect(result.removedExternalResource).toBe(false);
  });

  it('classifies decoded URL functions and imports as external resources', () => {
    const stylesheet = sanitizeStylesheet(`
      @\\69mport "https://example.invalid/theme.css";
      p {
        background-color: u\\72l("https://example.invalid/pixel");
        color: blue;
      }
    `);
    const inline = sanitizeDeclarationList(
      'background-color:u\\72l("https://example.invalid/pixel");color:red',
    );

    expect(stylesheet.css).toBe('p{color:blue}');
    expect(stylesheet).toMatchObject({
      removedExternalResource: true,
      removedUnsupported: false,
    });
    expect(inline.css).toBe('color:red');
    expect(inline).toMatchObject({
      removedExternalResource: true,
      removedUnsupported: false,
    });
  });

  it('tracks resource and unsupported declaration causes independently', () => {
    const result = sanitizeDeclarationList(`
      background-color: url("https://example.invalid/color");
      background-image: url("https://example.invalid/image");
      color: blue;
    `);

    expect(result).toEqual({
      css: 'color:blue',
      removedExternalResource: true,
      removedUnsupported: true,
    });
  });

  it('drops non-import at-rules, nesting, unsupported functions, and malformed input', () => {
    const atRules = sanitizeStylesheet(
      '@media screen { p { color:red } } @font-face { font-family:x } p{color:v\\61r(--x)}',
    );
    const nesting = sanitizeStylesheet('section{color:blue;& p{color:red}}');
    const malformed = sanitizeStylesheet('p{color:red;broken');
    const malformedInline = sanitizeDeclarationList('color:red;}');

    expect(atRules.css).toBe('');
    expect(atRules.removedUnsupported).toBe(true);
    expect(nesting.css).toBe('section{color:blue}');
    expect(nesting.removedUnsupported).toBe(true);
    expect(malformed).toEqual({
      css: '',
      removedExternalResource: false,
      removedUnsupported: true,
    });
    expect(malformedInline).toEqual({
      css: '',
      removedExternalResource: false,
      removedUnsupported: true,
    });
  });

  it('preserves external-resource classification inside rejected CSS subtrees', () => {
    const atRule = sanitizeStylesheet(
      '@font-face{font-family:x;src:url("https://example.invalid/font")}p{color:red}',
    );
    const selector = sanitizeStylesheet(
      '#authored{background-color:url("https://example.invalid/pixel")}',
    );
    const malformed = sanitizeDeclarationList(
      'color:red;broken:);background-color:url("https://example.invalid/pixel")',
    );

    expect(atRule).toEqual({
      css: 'p{color:red}',
      removedExternalResource: true,
      removedUnsupported: true,
    });
    expect(selector).toEqual({
      css: '',
      removedExternalResource: true,
      removedUnsupported: true,
    });
    expect(malformed).toEqual({
      css: '',
      removedExternalResource: true,
      removedUnsupported: true,
    });
  });
});

describe('serializeCssForStyleElement', () => {
  it('prevents CSS text from terminating a style element', () => {
    expect(serializeCssForStyleElement('p{color:red}</style><script>')).toBe(
      'p{color:red}\\3c /style>\\3c script>',
    );
    expect(serializeCssForStyleElement('p{color:red}')).not.toContain(
      '</style',
    );
  });
});
