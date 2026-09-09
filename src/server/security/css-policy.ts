import {
  generate,
  ident,
  lexer,
  parse,
  walk,
  type CssNode,
  type Declaration,
  type List,
  type Rule,
  type Selector,
  type WalkContext,
} from 'css-tree';

const allowedElements = new Set([
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
]);

const allowedProperties = new Set([
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-decoration-line',
  'text-decoration-color',
  'text-decoration-style',
  'text-transform',
  'white-space',
  'overflow-wrap',
  'word-break',
  'vertical-align',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-width',
  'border-style',
  'border-color',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-radius',
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  'box-sizing',
  'border-collapse',
  'border-spacing',
  'table-layout',
  'list-style-type',
  'list-style-position',
  'display',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'justify-content',
  'align-items',
  'align-content',
  'align-self',
  'gap',
  'row-gap',
  'column-gap',
]);

const allowedDisplayValues = new Set([
  'block',
  'inline',
  'inline-block',
  'flex',
  'inline-flex',
  'table',
  'table-row-group',
  'table-header-group',
  'table-footer-group',
  'table-row',
  'table-cell',
  'table-caption',
  'list-item',
]);

const allowedFunctions = new Set(['rgb', 'rgba', 'hsl', 'hsla']);
const allowedUnits = new Set(['px', 'em', 'rem', '%', 'vw', 'vh']);
const allowedGenericFamilies = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'system-ui',
]);
const cssWideValues = new Set(['inherit', 'initial', 'unset']);
const disallowedCssWideValues = new Set(['revert', 'revert-layer']);
const asciiIdentifier = /^(?:-?(?:[A-Za-z_])|--)[A-Za-z0-9_-]*$/;

export interface CssPolicyResult {
  css: string;
  removedExternalResource: boolean;
  removedUnsupported: boolean;
}

function parseCss(
  source: string,
  context: 'stylesheet' | 'declarationList',
): { ast?: CssNode; parseFailed: boolean } {
  try {
    return {
      ast: parse(source, {
        context,
        positions: false,
        parseCustomProperty: false,
        onParseError(error) {
          throw error;
        },
      }),
      parseFailed: false,
    };
  } catch {
    try {
      return {
        ast: parse(source, {
          context,
          positions: false,
          parseCustomProperty: false,
        }),
        parseFailed: true,
      };
    } catch {
      return { parseFailed: true };
    }
  }
}

function selectorIsAllowed(selector: Selector): boolean {
  for (const node of selector.children) {
    if (node.type === 'TypeSelector') {
      const name = ident.decode(node.name).toLowerCase();
      if (name !== '*' && !allowedElements.has(name)) {
        return false;
      }
      continue;
    }
    if (node.type === 'ClassSelector') {
      if (!asciiIdentifier.test(ident.decode(node.name))) {
        return false;
      }
      continue;
    }
    if (node.type === 'Combinator') {
      if (node.name !== ' ' && node.name !== '>') {
        return false;
      }
      continue;
    }
    return false;
  }

  return !selector.children.isEmpty;
}

function ruleSelectorIsAllowed(rule: Rule): boolean {
  if (rule.prelude.type !== 'SelectorList') {
    return false;
  }

  for (const node of rule.prelude.children) {
    if (node.type !== 'Selector' || !selectorIsAllowed(node)) {
      return false;
    }
  }

  return !rule.prelude.children.isEmpty;
}

function isSingleIdentifier(
  declaration: Declaration,
  allowed: ReadonlySet<string>,
): boolean {
  if (declaration.value.type !== 'Value') {
    return false;
  }
  const children = declaration.value.children.toArray();
  return (
    children.length === 1 &&
    children[0]?.type === 'Identifier' &&
    allowed.has(ident.decode(children[0].name).toLowerCase())
  );
}

function fontFamilyIsAllowed(declaration: Declaration): boolean {
  if (isSingleIdentifier(declaration, cssWideValues)) {
    return true;
  }
  if (declaration.value.type !== 'Value') {
    return false;
  }

  let expectFamily = true;
  for (const node of declaration.value.children) {
    if (expectFamily) {
      if (
        node.type !== 'Identifier' ||
        !allowedGenericFamilies.has(ident.decode(node.name).toLowerCase())
      ) {
        return false;
      }
    } else if (node.type !== 'Operator' || node.value !== ',') {
      return false;
    }
    expectFamily = !expectFamily;
  }

  return !expectFamily;
}

function valueNodesAreAllowed(
  value: CssNode,
  allowExternalResource = false,
): boolean {
  let valid = true;

  walk(value, function (this: WalkContext, node: CssNode) {
    if (!valid) {
      return;
    }

    switch (node.type) {
      case 'Value':
      case 'WhiteSpace':
      case 'Operator':
      case 'Hash':
        return;
      case 'Url':
        if (!allowExternalResource) {
          valid = false;
        }
        return;
      case 'String':
      case 'Raw':
        if (!(
          allowExternalResource &&
          this.function?.type === 'Function' &&
          ident.decode(this.function.name).toLowerCase() === 'url'
        )) {
          valid = false;
        }
        return;
      case 'Identifier':
        if (
          disallowedCssWideValues.has(ident.decode(node.name).toLowerCase())
        ) {
          valid = false;
        }
        return;
      case 'Number':
      case 'Percentage':
        if (!Number.isFinite(Number(node.value))) {
          valid = false;
        }
        return;
      case 'Dimension':
        if (
          !Number.isFinite(Number(node.value)) ||
          !allowedUnits.has(ident.decode(node.unit).toLowerCase())
        ) {
          valid = false;
        }
        return;
      case 'Function': {
        const functionName = ident.decode(node.name).toLowerCase();
        if (allowExternalResource && functionName === 'url') {
          return;
        }
        if (!allowedFunctions.has(functionName)) {
          valid = false;
        }
        return;
      }
      default:
        valid = false;
    }
  });

  return valid;
}

function containsExternalResource(value: CssNode): boolean {
  let containsResource = false;

  walk(value, (node) => {
    if (
      node.type === 'Url' ||
      (node.type === 'Function' &&
        ident.decode(node.name).toLowerCase() === 'url')
    ) {
      containsResource = true;
    }
  });

  return containsResource;
}

function declarationIsAllowed(declaration: Declaration): boolean {
  const property = ident.decode(declaration.property).toLowerCase();
  if (
    declaration.important ||
    property.startsWith('--') ||
    !allowedProperties.has(property)
  ) {
    return false;
  }
  if (!valueNodesAreAllowed(declaration.value)) {
    return false;
  }
  if (lexer.matchProperty(property, declaration.value).matched === null) {
    return false;
  }
  if (property === 'display') {
    return (
      isSingleIdentifier(declaration, allowedDisplayValues) ||
      isSingleIdentifier(declaration, cssWideValues)
    );
  }
  if (property === 'font-family') {
    return fontFamilyIsAllowed(declaration);
  }
  return true;
}

function declarationHasUnsupportedCause(
  declaration: Declaration,
  containsResource: boolean,
): boolean {
  const property = ident.decode(declaration.property).toLowerCase();
  if (
    declaration.important ||
    property.startsWith('--') ||
    !allowedProperties.has(property)
  ) {
    return true;
  }
  if (!containsResource) {
    return !declarationIsAllowed(declaration);
  }
  if (!valueNodesAreAllowed(declaration.value, true)) {
    return true;
  }
  if (property === 'display' || property === 'font-family') {
    return true;
  }
  return false;
}

function sanitizeDeclarations(children: List<CssNode>): CssPolicyResult {
  const declarations: string[] = [];
  let removedExternalResource = false;
  let removedUnsupported = false;

  for (const node of children) {
    if (node.type !== 'Declaration') {
      removedExternalResource ||= containsExternalResource(node);
      removedUnsupported = true;
      continue;
    }
    if (!declarationIsAllowed(node)) {
      const containsResource = containsExternalResource(node.value);
      if (containsResource) {
        removedExternalResource = true;
      }
      if (declarationHasUnsupportedCause(node, containsResource)) {
        removedUnsupported = true;
      }
      continue;
    }
    declarations.push(
      `${ident.decode(node.property).toLowerCase()}:${generate(node.value)}`,
    );
  }

  return {
    css: declarations.join(';'),
    removedExternalResource,
    removedUnsupported,
  };
}

export function sanitizeDeclarationList(source: string): CssPolicyResult {
  if (source.trim().length === 0) {
    return {
      css: '',
      removedExternalResource: false,
      removedUnsupported: false,
    };
  }

  const parsed = parseCss(source, 'declarationList');
  if (parsed.parseFailed || parsed.ast?.type !== 'DeclarationList') {
    return {
      css: '',
      removedExternalResource:
        parsed.ast === undefined ? false : containsExternalResource(parsed.ast),
      removedUnsupported: true,
    };
  }

  return sanitizeDeclarations(parsed.ast.children);
}

export function sanitizeStylesheet(source: string): CssPolicyResult {
  if (source.trim().length === 0) {
    return {
      css: '',
      removedExternalResource: false,
      removedUnsupported: false,
    };
  }

  const parsed = parseCss(source, 'stylesheet');
  if (parsed.parseFailed || parsed.ast?.type !== 'StyleSheet') {
    return {
      css: '',
      removedExternalResource:
        parsed.ast === undefined ? false : containsExternalResource(parsed.ast),
      removedUnsupported: true,
    };
  }

  const rules: string[] = [];
  let removedExternalResource = false;
  let removedUnsupported = false;

  for (const node of parsed.ast.children) {
    if (node.type === 'Atrule') {
      if (ident.decode(node.name).toLowerCase() === 'import') {
        removedExternalResource = true;
      } else {
        removedExternalResource ||= containsExternalResource(node);
        removedUnsupported = true;
      }
      continue;
    }
    if (node.type !== 'Rule' || !ruleSelectorIsAllowed(node)) {
      removedExternalResource ||= containsExternalResource(node);
      removedUnsupported = true;
      continue;
    }

    const declarations = sanitizeDeclarations(node.block.children);
    removedExternalResource ||= declarations.removedExternalResource;
    removedUnsupported ||= declarations.removedUnsupported;
    if (declarations.css.length > 0) {
      rules.push(`${generate(node.prelude)}{${declarations.css}}`);
    }
  }

  return {
    css: rules.join(''),
    removedExternalResource,
    removedUnsupported,
  };
}

export function serializeCssForStyleElement(source: string): string {
  return source.replaceAll('<', '\\3c ');
}
