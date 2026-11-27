import * as vscode from 'vscode';
import * as path from 'path';
import { AccessKind, GoReference, SearchResult, getGoEnv, relativeDisplayPath } from './finder';

const KIND_ORDER: AccessKind[] = ['write', 'read', 'declaration'];

const KIND_META: Record<AccessKind, { label: string; icon: string; color: string; tip: string }> = {
  write: { label: '写入 Write References', icon: 'edit', color: 'charts.red', tip: '写入' },
  read: { label: '读取 Read References', icon: 'eye', color: 'charts.blue', tip: '读取' },
  declaration: { label: '声明 Declaration', icon: 'symbol-field', color: 'charts.purple', tip: '声明' },
};

export class KindNode {
  readonly type = 'kind';
  constructor(
    readonly kind: AccessKind,
    readonly children: (DirNode | FileNode)[],
    readonly count: number,
  ) {}
}

export class DirNode {
  readonly type = 'dir';
  constructor(
    readonly id: string,
    readonly label: string,
    readonly children: FileNode[],
    readonly count: number,
  ) {}
}

export class FileNode {
  readonly type = 'file';
  constructor(
    readonly id: string,
    readonly uri: vscode.Uri,
    readonly label: string,
    readonly children: RefNode[],
  ) {}
}

export class RefNode {
  readonly type = 'ref';
  constructor(
    readonly id: string,
    readonly ref: GoReference,
    readonly displayPath: string,
  ) {}
}

export type Node = KindNode | DirNode | FileNode | RefNode;

export class ReferenceTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  private result: SearchResult | undefined;
  private roots: KindNode[] = [];
  private hideTests = false;

  get current(): SearchResult | undefined {
    return this.result;
  }

  get testsHidden(): boolean {
    return this.hideTests;
  }

  async setResult(result: SearchResult | undefined): Promise<void> {
    this.result = result;
    await this.rebuild();
  }

  async setHideTests(hide: boolean): Promise<void> {
    this.hideTests = hide;
    await this.rebuild();
  }

  visibleReferences(): GoReference[] {
    const refs = this.result?.references ?? [];
    return this.hideTests ? refs.filter((r) => !r.uri.fsPath.endsWith('_test.go')) : refs;
  }

  countByKind(): Record<AccessKind, number> {
    const counts: Record<AccessKind, number> = { write: 0, read: 0, declaration: 0 };
    for (const ref of this.visibleReferences()) {
      counts[ref.kind]++;
    }
    return counts;
  }

  private async rebuild(): Promise<void> {
    const env = await getGoEnv();
    const refs = this.visibleReferences();
    this.roots = [];
    for (const kind of KIND_ORDER) {
      const kindRefs = refs.filter((r) => r.kind === kind);
      if (kindRefs.length === 0) {
        continue;
      }
      this.roots.push(new KindNode(kind, buildPathTree(kind, kindRefs, (r) => relativeDisplayPath(r.uri, r.scope, env)), kindRefs.length));
    }
    this.changed.fire(undefined);
  }

  getChildren(element?: Node): Node[] {
    if (!element) {
      return this.roots;
    }
    if (element.type === 'ref') {
      return [];
    }
    return element.children;
  }

  getTreeItem(element: Node): vscode.TreeItem {
    switch (element.type) {
      case 'kind': {
        const meta = KIND_META[element.kind];
        const item = new vscode.TreeItem(meta.label, vscode.TreeItemCollapsibleState.Expanded);
        item.id = `kind:${element.kind}`;
        item.description = `${element.count}`;
        item.iconPath = new vscode.ThemeIcon(meta.icon, new vscode.ThemeColor(meta.color));
        item.contextValue = 'goRwKind';
        return item;
      }
      case 'dir': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
        item.id = element.id;
        item.description = `${element.count}`;
        item.iconPath = vscode.ThemeIcon.Folder;
        item.tooltip = element.label;
        item.contextValue = 'goRwDir';
        return item;
      }
      case 'file': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
        item.id = element.id;
        item.resourceUri = element.uri;
        item.description = `${element.children.length}`;
        item.iconPath = vscode.ThemeIcon.File;
        item.tooltip = element.uri.fsPath;
        item.contextValue = 'goRwFile';
        return item;
      }
      case 'ref':
        return refTreeItem(element);
    }
  }
}

function buildPathTree(
  kind: AccessKind,
  refs: GoReference[],
  displayPathOf: (ref: GoReference) => string,
): (DirNode | FileNode)[] {
  const dirs = new Map<string, Map<string, { uri: vscode.Uri; refs: RefNode[] }>>();
  for (const ref of refs) {
    const display = displayPathOf(ref);
    const dir = path.dirname(display);
    const files = dirs.get(dir) ?? new Map();
    const fileKey = ref.uri.toString();
    const entry = files.get(fileKey) ?? { uri: ref.uri, refs: [] };
    entry.refs.push(new RefNode(`${kind}:${fileKey}:${ref.range.start.line}:${ref.range.start.character}`, ref, display));
    files.set(fileKey, entry);
    dirs.set(dir, files);
  }

  const result: (DirNode | FileNode)[] = [];
  for (const dir of [...dirs.keys()].sort()) {
    const fileNodes = [...dirs.get(dir)!.values()]
      .sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath))
      .map((entry) => {
        entry.refs.sort((a, b) => a.ref.range.start.compareTo(b.ref.range.start));
        return new FileNode(`${kind}:file:${entry.uri.toString()}`, entry.uri, path.basename(entry.uri.fsPath), entry.refs);
      });
    if (dir === '.' || dir === '') {
      result.push(...fileNodes);
    } else {
      const count = fileNodes.reduce((sum, f) => sum + f.children.length, 0);
      result.push(new DirNode(`${kind}:dir:${dir}`, dir, fileNodes, count));
    }
  }
  return result;
}

function refTreeItem(node: RefNode): vscode.TreeItem {
  const { ref } = node;
  const raw = ref.lineText;
  const indent = raw.length - raw.trimStart().length;
  const maxLength = 180;
  let code = raw.trim();
  if (code.length > maxLength) {
    code = `${code.slice(0, maxLength)}…`;
  }
  const prefix = `${ref.range.start.line + 1}  `;
  const highlightStart = prefix.length + ref.range.start.character - indent;
  const symbolLength = ref.range.end.line === ref.range.start.line ? ref.range.end.character - ref.range.start.character : 0;
  const highlightEnd = highlightStart + symbolLength;
  const label: vscode.TreeItemLabel = { label: prefix + code };
  if (symbolLength > 0 && highlightStart >= prefix.length && highlightEnd <= label.label.length) {
    label.highlights = [[highlightStart, highlightEnd]];
  }

  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.id = node.id;
  const meta = KIND_META[ref.kind];
  const tags: string[] = [];
  // 声明已单独成组，不需要在条目上重复标注。
  if (!ref.semantic) {
    tags.push('启发式');
  }
  item.description = tags.join(' · ');
  item.iconPath = new vscode.ThemeIcon(meta.icon, new vscode.ThemeColor(meta.color));
  item.contextValue = 'goRwReference';

  const tooltip = new vscode.MarkdownString();
  tooltip.appendMarkdown(`**${meta.tip}**${ref.semantic ? '（gopls 语义判定）' : '（语法判定）'}${ref.isDeclaration ? ' · 声明' : ''}  \n`);
  tooltip.appendText(`${node.displayPath}:${ref.range.start.line + 1}:${ref.range.start.character + 1}`);
  tooltip.appendCodeblock(raw.trim(), 'go');
  item.tooltip = tooltip;
  item.command = { command: 'goRw.openReference', title: '打开', arguments: [node] };
  return item;
}
