export type SkillMetadata = {
  name: string;
  description: string;
};

const frontmatterKey = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]*(.*))?$/;

function unquote(value: string) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'"))
    return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
}

function foldBlock(lines: string[]) {
  return lines
    .join('\n')
    .replace(/\n[ \t]*\n/g, '\n\n')
    .replace(/([^\n])\n([^\n])/g, '$1 $2')
    .trim();
}

function readBlock(lines: string[], start: number, folded: boolean) {
  const values: string[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '---' || (line.length > 0 && !/^\s/.test(line) && frontmatterKey.test(line)))
      break;
    values.push(line.startsWith('  ') ? line.slice(2) : line);
    index += 1;
  }
  return { value: folded ? foldBlock(values) : values.join('\n').trim(), next: index };
}

/** Parse only the portable metadata contract from a SKILL.md document. */
export function parseSkillMetadata(markdown: string): SkillMetadata | null {
  const lines = markdown.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;

  let name = '';
  let description = '';
  let closed = false;
  let index = 1;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '---') {
      closed = true;
      break;
    }
    const match = frontmatterKey.exec(line);
    if (!match) {
      index += 1;
      continue;
    }
    const key = match[1];
    const rawValue = match[2] ?? '';
    if (key === 'description' && (rawValue.trim() === '|' || rawValue.trim() === '>')) {
      const block = readBlock(lines, index + 1, rawValue.trim() === '>');
      description = block.value;
      index = block.next;
      continue;
    }
    if (key === 'name') name = unquote(rawValue);
    if (key === 'description') description = unquote(rawValue);
    index += 1;
  }
  if (!closed || !name || !description) return null;
  return { name, description };
}
