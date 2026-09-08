import sanitizeHtml from 'sanitize-html';

import {
  displayWarningValues,
  type DisplayWarning,
} from '../../contracts/display.js';
import {
  sanitizeDeclarationList,
  sanitizeStylesheet,
  serializeCssForStyleElement,
} from './css-policy.js';

const allowedTags = [
  'div',
  'span',
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
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
  'table',
  'caption',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'section',
  'article',
  'header',
  'footer',
  'main',
] as const;

const allowedTagSet = new Set<string>(allowedTags);
const activeContentTags = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'option',
  'optgroup',
  'textarea',
  'fieldset',
  'legend',
  'datalist',
  'output',
  'details',
  'summary',
  'dialog',
  'svg',
  'math',
  'audio',
  'video',
  'picture',
  'source',
  'track',
  'canvas',
]);
const resourceTags = new Set(['img', 'link', 'meta', 'base']);
const droppedUnsupportedSubtreeTags = new Set(['title']);
const droppedSubtreeTags = [
  ...activeContentTags,
  ...resourceTags,
  ...droppedUnsupportedSubtreeTags,
];
const globalAttributes = new Set(['class', 'title', 'lang', 'dir', 'style']);
const cellAttributes = new Set(['colspan', 'rowspan']);
const navigationAttributes = new Set([
  'href',
  'target',
  'download',
  'ping',
  'rel',
  'referrerpolicy',
  'hreflang',
  'type',
]);
const resourceAttributes = new Set([
  'src',
  'srcset',
  'sizes',
  'poster',
  'href',
  'action',
  'formaction',
  'cite',
  'background',
  'data',
  'codebase',
  'archive',
  'profile',
  'manifest',
  'longdesc',
  'usemap',
  'xlink:href',
]);
const scopeValues = new Set(['row', 'col', 'rowgroup', 'colgroup']);
const directionValues = new Set(['ltr', 'rtl', 'auto']);
const grandfatheredLanguageTags = new Set([
  'art-lojban',
  'cel-gaulish',
  'en-gb-oed',
  'i-ami',
  'i-bnn',
  'i-default',
  'i-enochian',
  'i-hak',
  'i-klingon',
  'i-lux',
  'i-mingo',
  'i-navajo',
  'i-pwn',
  'i-tao',
  'i-tay',
  'i-tsu',
  'no-bok',
  'no-nyn',
  'sgn-be-fr',
  'sgn-be-nl',
  'sgn-ch-de',
  'zh-guoyu',
  'zh-hakka',
  'zh-min',
  'zh-min-nan',
  'zh-xiang',
]);
const asciiIdentifier = /^(?:-?(?:[A-Za-z_])|--)[A-Za-z0-9_-]*$/;

export interface SanitizedDisplayContent {
  html: string;
  css: string;
  text: string;
  warnings: DisplayWarning[];
}

function decodeEscapedText(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');
}

function languageTagIsValid(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  const normalized = value.toLowerCase();
  if (grandfatheredLanguageTags.has(normalized)) {
    return true;
  }
  if (
    normalized.startsWith('x-') &&
    normalized
      .slice(2)
      .split('-')
      .every(
        (subtag) =>
          subtag.length >= 1 &&
          subtag.length <= 8 &&
          /^[a-z0-9]+$/.test(subtag),
      )
  ) {
    return true;
  }
  try {
    Intl.getCanonicalLocales(value);
    return true;
  } catch {
    return false;
  }
}

function classListIsValid(value: string): boolean {
  const tokens = value.trim().split(/[\t\n\f\r ]+/);
  return (
    tokens.length > 0 && tokens.every((token) => asciiIdentifier.test(token))
  );
}

function tableSpan(value: string): string | undefined {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100
    ? String(parsed)
    : undefined;
}

function attributeCategory(
  tagName: string,
  attributeName: string,
): DisplayWarning | undefined {
  if (attributeName.startsWith('on')) {
    return 'active-content';
  }
  if (tagName === 'a' && navigationAttributes.has(attributeName)) {
    return 'navigation';
  }
  if (resourceAttributes.has(attributeName)) {
    return 'external-resource';
  }
  return undefined;
}

function elementCategory(tagName: string): DisplayWarning | undefined {
  if (activeContentTags.has(tagName)) {
    return 'active-content';
  }
  if (resourceTags.has(tagName)) {
    return 'external-resource';
  }
  if (!allowedTagSet.has(tagName)) {
    return 'unsupported-markup';
  }
  return undefined;
}

export function sanitizeDisplayContent(input: {
  html: string;
  css: string;
}): SanitizedDisplayContent {
  const warnings = new Set<DisplayWarning>();
  const inlineRules: string[] = [];
  const textParts: string[] = [];
  let generatedId = 0;

  const fieldCss = sanitizeStylesheet(input.css);
  if (fieldCss.removedExternalResource) {
    warnings.add('external-resource');
  }
  if (fieldCss.removedUnsupported) {
    warnings.add('unsupported-css');
  }

  const html = sanitizeHtml(input.html, {
    allowedTags: [...allowedTags],
    allowedAttributes: {
      '*': ['class', 'title', 'lang', 'dir', 'id'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
    },
    allowVulnerableTags: false,
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: false,
    nonTextTags: droppedSubtreeTags,
    parseStyleAttributes: false,
    parser: {
      decodeEntities: true,
      lowerCaseAttributeNames: true,
      lowerCaseTags: true,
    },
    textFilter(text) {
      textParts.push(decodeEscapedText(text));
      return text;
    },
    transformTags: {
      '*': (tagName, attributes) => {
        const normalizedTag = tagName.toLowerCase();
        const category = elementCategory(normalizedTag);
        if (category !== undefined) {
          warnings.add(category);
        }

        const retained: Record<string, string> = {};
        for (const [rawName, value] of Object.entries(attributes)) {
          const name = rawName.toLowerCase();
          const attributeWarning = attributeCategory(normalizedTag, name);
          if (attributeWarning !== undefined) {
            warnings.add(attributeWarning);
            continue;
          }
          if (!allowedTagSet.has(normalizedTag)) {
            if (!globalAttributes.has(name)) {
              warnings.add('unsupported-markup');
            }
            continue;
          }

          if (name === 'class') {
            if (classListIsValid(value)) {
              retained['class'] = value.trim();
            } else {
              warnings.add('unsupported-markup');
            }
            continue;
          }
          if (name === 'title') {
            retained['title'] = value;
            continue;
          }
          if (name === 'lang') {
            if (languageTagIsValid(value)) {
              retained['lang'] = value;
            } else {
              warnings.add('unsupported-markup');
            }
            continue;
          }
          if (name === 'dir') {
            const direction = value.trim().toLowerCase();
            if (directionValues.has(direction)) {
              retained['dir'] = direction;
            } else {
              warnings.add('unsupported-markup');
            }
            continue;
          }
          if (
            (normalizedTag === 'td' || normalizedTag === 'th') &&
            cellAttributes.has(name)
          ) {
            const span = tableSpan(value);
            if (span === undefined) {
              warnings.add('unsupported-markup');
            } else {
              retained[name] = span;
            }
            continue;
          }
          if (normalizedTag === 'th' && name === 'scope') {
            const scope = value.trim().toLowerCase();
            if (scopeValues.has(scope)) {
              retained['scope'] = scope;
            } else {
              warnings.add('unsupported-markup');
            }
            continue;
          }
          if (name === 'style') {
            const inlineCss = sanitizeDeclarationList(value);
            if (inlineCss.removedExternalResource) {
              warnings.add('external-resource');
            }
            if (inlineCss.removedUnsupported) {
              warnings.add('unsupported-css');
            }
            if (inlineCss.css.length > 0) {
              generatedId += 1;
              const id = `agent-canvas-inline-${String(generatedId)}`;
              retained['id'] = id;
              inlineRules.push(`#${id}{${inlineCss.css}}`);
            }
            continue;
          }

          warnings.add('unsupported-markup');
        }

        return { tagName: normalizedTag, attribs: retained };
      },
    },
  });

  const combinedCss = [fieldCss.css, ...inlineRules]
    .filter((part) => part.length > 0)
    .join('');

  return {
    html,
    css: serializeCssForStyleElement(combinedCss),
    text: textParts.join(''),
    warnings: displayWarningValues.filter((warning) => warnings.has(warning)),
  };
}
