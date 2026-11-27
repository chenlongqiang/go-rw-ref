import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { guessAccessKind } from './heuristic';

/** 写入、读取、声明三组；不再有「其他引用」，每处引用都必须落到其中一组。 */
export type AccessKind = 'write' | 'read' | 'declaration';
export type Scope = 'workspace' | 'goroot' | 'external';

export interface GoReference {
  uri: vscode.Uri;
  range: vscode.Range;
  kind: AccessKind;
  isDeclaration: boolean;
  /** true 表示读写类型来自 gopls 语义分析；false 表示使用兜底规则。 */
  semantic: boolean;
  scope: Scope;
  lineText: string;
}

export interface SearchResult {
  symbol: string;
  uri: vscode.Uri;
  position: vscode.Position;
  references: GoReference[];
  heuristicCount: number;
}

export interface SearchOptions {
  includeDeclaration: boolean;
  concurrency: number;
}

interface GoEnv {
  goroot?: string;
  gomodcache?: string;
}

const UNKNOWN = -1;
let goEnvPromise: Promise<GoEnv> | undefined;

function positionKey(pos: vscode.Position): string {
  return `${pos.line}:${pos.character}`;
}

function locationKey(uri: vscode.Uri, pos: vscode.Position): string {
  return `${uri.toString()}#${positionKey(pos)}`;
}

function highlightPriority(kind: number): number {
  if (kind === vscode.DocumentHighlightKind.Write) {
    return 3;
  }
  if (kind === vscode.DocumentHighlightKind.Read) {
    return 2;
  }
  if (kind === vscode.DocumentHighlightKind.Text) {
    return 1;
  }
  return 0;
}

function resolveGoBinary(): string {
  const goroot = vscode.workspace.getConfiguration('go').get<string>('goroot');
  if (goroot) {
    return path.join(goroot, 'bin', process.platform === 'win32' ? 'go.exe' : 'go');
  }
  return 'go';
}

function loadGoEnv(): Promise<GoEnv> {
  if (!goEnvPromise) {
    goEnvPromise = new Promise((resolve) => {
      execFile(resolveGoBinary(), ['env', 'GOROOT', 'GOMODCACHE'], { timeout: 5000 }, (err, stdout) => {
        if (err) {
          resolve({});
          return;
        }
        const [goroot, gomodcache] = stdout.split(/\r?\n/).map((s) => s.trim());
        resolve({ goroot: goroot || undefined, gomodcache: gomodcache || undefined });
      });
    });
  }
  return goEnvPromise;
}

function isUnder(filePath: string, dir?: string): boolean {
  if (!dir) {
    return false;
  }
  const rel = path.relative(dir, filePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function detectScope(uri: vscode.Uri, env: GoEnv): Scope {
  if (vscode.workspace.getWorkspaceFolder(uri)) {
    return 'workspace';
  }
  if (isUnder(uri.fsPath, env.goroot)) {
    return 'goroot';
  }
  return 'external';
}

export function relativeDisplayPath(uri: vscode.Uri, scope: Scope, env: GoEnv): string {
  if (scope === 'workspace') {
    return vscode.workspace.asRelativePath(uri, (vscode.workspace.workspaceFolders?.length ?? 0) > 1);
  }
  if (scope === 'goroot' && env.goroot) {
    return path.join('GOROOT', path.relative(env.goroot, uri.fsPath));
  }
  if (env.gomodcache && isUnder(uri.fsPath, env.gomodcache)) {
    return path.join('外部依赖', path.relative(env.gomodcache, uri.fsPath));
  }
  return uri.fsPath;
}

export function getGoEnv(): Promise<GoEnv> {
  return loadGoEnv();
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      await fn(items[index]);
    }
  });
  await Promise.all(workers);
}

/**
 * 获取单个文件内各引用位置的语义读写类型。
 * DocumentHighlight 会返回当前文件中同一符号的全部出现位置，通常一次请求即可覆盖整个文件；
 * 若某个引用未被覆盖，再针对该引用位置单独补查一次。
 */
async function semanticKinds(
  uri: vscode.Uri,
  refs: vscode.Location[],
  token: vscode.CancellationToken,
): Promise<Map<string, number>> {
  const kinds = new Map<string, number>();
  for (const ref of refs) {
    if (token.isCancellationRequested) {
      break;
    }
    const refKey = positionKey(ref.range.start);
    if (kinds.has(refKey)) {
      continue;
    }
    let highlights: vscode.DocumentHighlight[] | undefined;
    try {
      highlights = await vscode.commands.executeCommand<vscode.DocumentHighlight[]>(
        'vscode.executeDocumentHighlights',
        uri,
        ref.range.start,
      );
    } catch {
      highlights = undefined;
    }
    for (const highlight of highlights ?? []) {
      const key = positionKey(highlight.range.start);
      const kind = highlight.kind ?? vscode.DocumentHighlightKind.Text;
      const existing = kinds.get(key);
      if (existing === undefined || highlightPriority(kind) > highlightPriority(existing)) {
        kinds.set(key, kind);
      }
    }
    if (!kinds.has(refKey)) {
      kinds.set(refKey, UNKNOWN);
    }
  }
  return kinds;
}

async function definitionKeys(uri: vscode.Uri, position: vscode.Position): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const defs = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      'vscode.executeDefinitionProvider',
      uri,
      position,
    );
    for (const def of defs ?? []) {
      if ('targetUri' in def) {
        const range = def.targetSelectionRange ?? def.targetRange;
        keys.add(locationKey(def.targetUri, range.start));
      } else {
        keys.add(locationKey(def.uri, def.range.start));
      }
    }
  } catch {
    // 没有定义信息时不影响读写分类。
  }
  return keys;
}

export async function searchReferences(
  uri: vscode.Uri,
  position: vscode.Position,
  options: SearchOptions,
  token: vscode.CancellationToken,
): Promise<SearchResult | undefined> {
  const document = await vscode.workspace.openTextDocument(uri);
  const wordRange = document.getWordRangeAtPosition(position);
  if (!wordRange) {
    return undefined;
  }
  const symbol = document.getText(wordRange);
  const queryPosition = wordRange.start;

  const [locations, defKeys, env] = await Promise.all([
    vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri, queryPosition),
    definitionKeys(uri, queryPosition),
    loadGoEnv(),
  ]);

  const byFile = new Map<string, vscode.Location[]>();
  const seen = new Set<string>();
  for (const location of locations ?? []) {
    const key = locationKey(location.uri, location.range.start);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const fileKey = location.uri.toString();
    const list = byFile.get(fileKey) ?? [];
    list.push(location);
    byFile.set(fileKey, list);
  }

  const references: GoReference[] = [];
  let heuristicCount = 0;

  await mapLimit([...byFile.values()], options.concurrency, async (fileRefs) => {
    if (token.isCancellationRequested) {
      return;
    }
    const fileUri = fileRefs[0].uri;
    let refDocument: vscode.TextDocument;
    try {
      refDocument = await vscode.workspace.openTextDocument(fileUri);
    } catch {
      return;
    }
    fileRefs.sort((a, b) => a.range.start.compareTo(b.range.start));
    const kinds = await semanticKinds(fileUri, fileRefs, token);
    const scope = detectScope(fileUri, env);

    for (const ref of fileRefs) {
      const start = ref.range.start;
      const isDeclaration = defKeys.has(locationKey(fileUri, start));
      if (isDeclaration && !options.includeDeclaration) {
        continue;
      }
      const lineText = start.line < refDocument.lineCount ? refDocument.lineAt(start.line).text : '';
      const semantic = kinds.get(positionKey(start)) ?? UNKNOWN;

      let kind: AccessKind;
      let isSemantic = true;
      if (isDeclaration) {
        // 声明是确定信息，单独成组，不计入「启发式」统计。
        kind = 'declaration';
      } else if (semantic === vscode.DocumentHighlightKind.Write) {
        kind = 'write';
      } else if (semantic === vscode.DocumentHighlightKind.Read) {
        kind = 'read';
      } else {
        // gopls 对结构体字段经常返回 Text（或不带 kind），此时必须按语法兜底，
        // 否则所有引用都会掉进「其他引用」，Read/Write 分组就是空的。
        kind = guessAccessKind(lineText, start.character, symbol);
        isSemantic = false;
        heuristicCount++;
      }

      references.push({
        uri: fileUri,
        range: ref.range,
        kind,
        isDeclaration,
        semantic: isSemantic,
        scope,
        lineText,
      });
    }
  });

  return { symbol, uri, position: queryPosition, references, heuristicCount };
}
