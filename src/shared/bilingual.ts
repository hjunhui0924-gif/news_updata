import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Nodes, Root, RootContent } from 'mdast';

const parser = unified().use(remarkParse).use(remarkGfm);

function compatible(a: Nodes, b: Nodes): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'list' && b.type === 'list' && (a.ordered !== b.ordered || a.start !== b.start))
    return false;
  if (
    ['root', 'list', 'listItem', 'blockquote'].includes(a.type) &&
    'children' in a &&
    'children' in b
  ) {
    return (
      a.children.length === b.children.length &&
      a.children.every((child, i) => compatible(child, b.children[i]))
    );
  }
  return true;
}

function chinese<T extends RootContent>(node: T): T {
  return {
    ...node,
    data: {
      ...node.data,
      hProperties: {
        ...node.data?.hProperties,
        lang: 'zh-CN',
        className: ['bilingual-inline-chinese'],
      },
    },
  };
}

function interleave(original: RootContent[], translated: RootContent[]): RootContent[] {
  return original.flatMap((node, index): RootContent[] => {
    const zh = translated[index];
    if (
      node.type === 'heading' ||
      node.type === 'code' ||
      node.type === 'thematicBreak' ||
      node.type === 'html'
    )
      return [node];
    if (node.type === 'list' && zh.type === 'list') {
      return [
        {
          ...node,
          spread: true,
          children: node.children.map((item, i) => ({
            ...item,
            spread: true,
            children: interleave(item.children, zh.children[i].children) as typeof item.children,
          })),
        },
      ];
    }
    if (node.type === 'blockquote' && zh.type === 'blockquote') {
      return [
        { ...node, children: interleave(node.children, zh.children) as typeof node.children },
      ];
    }
    if (node.type === 'definition' || node.type === 'footnoteDefinition') return [node, zh];
    return [node, chinese(zh)];
  });
}

// Definitions and references from both languages must resolve independently in one document.
function namespaceReferences(root: Root, prefix: string) {
  function visit(node: Nodes) {
    if ('identifier' in node) node.identifier = prefix + node.identifier;
    if ('children' in node) node.children.forEach(visit);
  }
  visit(root);
}

export function bilingualTree(original: string, translation: string): Root {
  const source = parser.parse(original);
  const translated = parser.parse(translation);
  namespaceReferences(source, 'original-');
  namespaceReferences(translated, 'translated-');
  // Only structured saved pairs are passed here. A changed Markdown shape keeps a whole-block
  // comparison; it must not silently pair a new or missing list item with the wrong original.
  return {
    type: 'root',
    children: compatible(source, translated)
      ? interleave(source.children, translated.children)
      : [...source.children, ...translated.children.map(chinese)],
  };
}
