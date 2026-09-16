import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SkillFiles, SkillScope, SkillSummary } from '@/shared/skills';
import { parseSkillMetadata } from './metadata';

export type LocalSkillRoot = {
  id: string;
  path: string;
  label: string;
  scope: Exclude<SkillScope, 'github'>;
};

export type LocalSkillRecord = SkillSummary & {
  source: 'local';
  rootId: string;
  filePath: string;
};

const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', '.next']);

function normalized(value: string) {
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();
}

function defaultRoots(): LocalSkillRoot[] {
  const home = os.homedir();
  return [
    {
      id: 'project',
      path: path.resolve(process.cwd(), '.agents', 'skills'),
      label: '当前项目',
      scope: 'project',
    },
    {
      id: 'user',
      path: path.join(home, '.agents', 'skills'),
      label: '用户目录',
      scope: 'user',
    },
    {
      id: 'codex',
      path: path.join(home, '.codex', 'skills'),
      label: 'Codex 本机目录',
      scope: 'user',
    },
    {
      id: 'codex-plugins',
      path: path.join(home, '.codex', 'plugins', 'cache'),
      label: 'Codex 插件',
      scope: 'plugin',
    },
  ];
}

export function getDefaultLocalSkillRoots() {
  const seen = new Set<string>();
  return defaultRoots().filter((root) => {
    const key = normalized(root.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scopeFor(root: LocalSkillRoot, relativePath: string): Exclude<SkillScope, 'github'> {
  const parts = relativePath.split(/[\\/]/).map((part) => part.toLowerCase());
  if (parts.includes('.system')) return 'system';
  if (parts.includes('plugins') || parts.includes('.codex-plugin')) return 'plugin';
  return root.scope;
}

async function skillFiles(directory: string): Promise<SkillFiles> {
  let names = new Set<string>();
  let interfaceFile = false;
  try {
    names = new Set((await readdir(directory)).map((name) => name.toLowerCase()));
  } catch {
    // The skill may disappear while the directory is being refreshed.
  }
  if (names.has('agents')) {
    try {
      interfaceFile = (await readdir(path.join(directory, 'agents'))).some(
        (name) => name.toLowerCase() === 'openai.yaml',
      );
    } catch {
      interfaceFile = false;
    }
  }
  return {
    scripts: names.has('scripts'),
    references: names.has('references'),
    assets: names.has('assets'),
    interface: interfaceFile,
  };
}

async function readUpdatedAt(filePath: string) {
  try {
    return (await stat(filePath)).mtime.toISOString();
  } catch {
    return null;
  }
}

async function walk(
  directory: string,
  root: LocalSkillRoot,
  depth: number,
  visited: Set<string>,
  found: LocalSkillRecord[],
) {
  if (depth > 8) return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
      let content: string;
      try {
        content = await readFile(fullPath, 'utf8');
      } catch {
        continue;
      }
      const metadata = parseSkillMetadata(content);
      if (!metadata) continue;
      const relativePath = path.relative(root.path, fullPath).split(path.sep).join('/');
      found.push({
        id: `local:${root.id}:${relativePath}`,
        source: 'local',
        scope: scopeFor(root, relativePath),
        name: metadata.name,
        description: metadata.description,
        relativePath,
        location: root.label,
        updatedAt: await readUpdatedAt(fullPath),
        files: await skillFiles(path.dirname(fullPath)),
        rootId: root.id,
        filePath: fullPath,
      });
      continue;
    }
    if (ignoredDirectories.has(entry.name.toLowerCase())) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    let isDirectory = entry.isDirectory();
    if (!isDirectory) {
      try {
        isDirectory = (await stat(fullPath)).isDirectory();
      } catch {
        isDirectory = false;
      }
    }
    if (!isDirectory) continue;
    let realPath: string;
    try {
      realPath = (await stat(fullPath)).isDirectory() ? path.resolve(fullPath) : '';
    } catch {
      continue;
    }
    const visitKey = normalized(realPath);
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    await walk(fullPath, root, depth + 1, visited, found);
  }
}

export async function scanLocalSkills(roots = getDefaultLocalSkillRoots()) {
  const found: LocalSkillRecord[] = [];
  const seenRoots = new Set<string>();
  for (const root of roots) {
    const rootPath = path.resolve(root.path);
    const rootKey = normalized(rootPath);
    if (seenRoots.has(rootKey)) continue;
    seenRoots.add(rootKey);
    await walk(rootPath, { ...root, path: rootPath }, 0, new Set([rootKey]), found);
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getLocalSkill(id: string, roots = getDefaultLocalSkillRoots()) {
  const skill = (await scanLocalSkills(roots)).find((item) => item.id === id);
  if (!skill) return null;
  try {
    const content = await readFile(skill.filePath, 'utf8');
    return { ...skill, content };
  } catch {
    return null;
  }
}
