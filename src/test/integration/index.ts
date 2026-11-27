import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import assert from 'node:assert/strict';
import type { GoRwApi } from '../../extension';
import type { GoReference } from '../../finder';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positionOf(doc: vscode.TextDocument, lineIncludes: string, symbol: string, occurrence = 0): vscode.Position {
  for (let line = 0; line < doc.lineCount; line++) {
    const text = doc.lineAt(line).text;
    if (!text.includes(lineIncludes)) {
      continue;
    }
    let column = -1;
    for (let i = 0; i <= occurrence; i++) {
      column = text.indexOf(symbol, column + 1);
    }
    assert.ok(column >= 0, `第 ${line + 1} 行未找到 ${symbol}`);
    return new vscode.Position(line, column);
  }
  throw new Error(`未找到包含「${lineIncludes}」的行`);
}

async function waitForGopls(uri: vscode.Uri, position: vscode.Position): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const locations = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri, position);
    if (locations && locations.length > 1) {
      return;
    }
    await sleep(1000);
  }
  throw new Error('等待 gopls 就绪超时');
}

function kindAt(refs: GoReference[], doc: vscode.TextDocument, pos: vscode.Position): string {
  const ref = refs.find((r) => r.uri.toString() === doc.uri.toString() && r.range.start.isEqual(pos));
  assert.ok(ref, `结果中缺少 ${path.basename(doc.uri.fsPath)}:${pos.line + 1}:${pos.character + 1}`);
  return `${ref.kind}${ref.semantic ? '' : '(heuristic)'}`;
}

export async function run(): Promise<void> {
  const report: Record<string, unknown> = {};
  try {
    await runChecks(report);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    console.log(`GO_RW_REPORT_BEGIN${JSON.stringify(report)}GO_RW_REPORT_END`);
    const out = process.env.GO_RW_REPORT;
    if (out) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(report, null, 2));
    }
  }
}

async function runChecks(report: Record<string, unknown>): Promise<void> {
  const fixture = process.env.GO_RW_FIXTURE!;

  const goExt = vscode.extensions.getExtension('golang.go');
  assert.ok(goExt, 'Go 扩展未加载');
  await goExt.activate();

  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8')) as {
    publisher: string;
    name: string;
  };
  const ext = vscode.extensions.getExtension<GoRwApi>(`${manifest.publisher}.${manifest.name}`);
  assert.ok(ext, '待测插件未加载');
  const api = await ext.activate();

  const contentUri = vscode.Uri.file(path.join(fixture, 'content.go'));
  const testUri = vscode.Uri.file(path.join(fixture, 'content_test.go'));
  const content = await vscode.workspace.openTextDocument(contentUri);
  const testDoc = await vscode.workspace.openTextDocument(testUri);
  await vscode.window.showTextDocument(content, vscode.ViewColumn.One);

  const itemsDecl = positionOf(content, 'Items []string', 'Items');
  await waitForGopls(contentUri, itemsDecl);

  // 1. 字段的读写分类
  const items = await api.search(contentUri, itemsDecl);
  assert.ok(items, '字段查询无结果');
  const itemCases: [vscode.TextDocument, string, number, string][] = [
    [content, 'Items []string', 0, 'declaration'],
    [content, 'Items: input', 0, 'write'],
    [content, 'Items: makeItems(targets)', 0, 'write'],
    [content, 'Items: makeItemsMulti(', 0, 'write'],
    [content, 'c.Items = append(c.Items', 0, 'write'],
    [content, 'c.Items = append(c.Items', 1, 'read'],
    [content, 'n := len(c.Items)', 0, 'read'],
    [content, 'c.Name = c.Items[0]', 0, 'read'],
    [content, 'bag.Children[0].Items = nil', 0, 'write'],
    [content, 'range bag.Children[0].Items', 0, 'read'],
    [content, '{{Items: []string{"a"}}}', 0, 'write'],
    [testDoc, 'len(c.Items) == 0', 0, 'read'],
    [testDoc, 'c.Items[0] = "y"', 0, 'read'],
    [testDoc, 'c.Items = c.Items[:1]', 0, 'write'],
    [testDoc, 'c.Items = c.Items[:1]', 1, 'read'],
  ];
  const itemActual: Record<string, string> = {};
  const mismatches: string[] = [];
  report.itemsAll = items.references.map(
    (r) => `${path.basename(r.uri.fsPath)}:${r.range.start.line + 1}:${r.range.start.character + 1} ${r.kind}${r.semantic ? '' : '(heuristic)'}${r.isDeclaration ? '+decl' : ''}`,
  );
  for (const [doc, line, occurrence, expected] of itemCases) {
    const pos = positionOf(doc, line, 'Items', occurrence);
    const actual = kindAt(items.references, doc, pos);
    itemActual[`${path.basename(doc.uri.fsPath)}:${pos.line + 1} ${line} #${occurrence}`] = `${actual} (期望 ${expected})`;
    if (actual !== expected) {
      mismatches.push(`${line} #${occurrence}: 实际 ${actual}，期望 ${expected}`);
    }
  }
  const illegalKinds = items.references.filter(
    (r) => r.kind !== 'read' && r.kind !== 'write' && r.kind !== 'declaration',
  );
  report.groupKinds = {
    total: items.references.length,
    write: items.references.filter((r) => r.kind === 'write').length,
    read: items.references.filter((r) => r.kind === 'read').length,
    declaration: items.references.filter((r) => r.kind === 'declaration').length,
    illegal: illegalKinds.length,
  };
  report.items = { total: items.references.length, heuristic: items.heuristicCount, cases: itemActual };
  assert.equal(illegalKinds.length, 0, '不允许出现写入/读取/声明之外的第四类分组');
  assert.deepEqual(mismatches, [], mismatches.join('; '));

  // 2. 局部变量 n 的读写分类（:= 为声明）
  const nDecl = positionOf(content, 'n := len', 'n');
  const nResult = await api.search(contentUri, nDecl);
  assert.ok(nResult);
  const nDeclRef = nResult.references.find((r) => r.range.start.isEqual(nDecl));
  assert.equal(nDeclRef?.kind, 'declaration');
  assert.equal(nDeclRef?.isDeclaration, true);
  assert.match(kindAt(nResult.references, content, positionOf(content, 'n++', 'n')), /^write/);
  assert.match(kindAt(nResult.references, content, positionOf(content, 'if n > 0', 'n')), /^read/);
  report.localVar = nResult.references.map((r) => `${r.range.start.line + 1}:${r.kind}${r.isDeclaration ? '+decl' : ''}`);

  // 3. 函数引用统一归入读取或声明，不能出现「其他引用」
  const buildPos = positionOf(content, 'func Build', 'Build');
  const buildResult = await api.search(contentUri, buildPos);
  assert.ok(buildResult);
  assert.match(kindAt(buildResult.references, testDoc, positionOf(testDoc, 'Build([]string', 'Build')), /^read/);
  assert.equal(
    buildResult.references.filter((r) => r.kind !== 'read' && r.kind !== 'write' && r.kind !== 'declaration').length,
    0,
  );
  report.function = buildResult.references.map((r) => `${path.basename(r.uri.fsPath)}:${r.range.start.line + 1}:${r.kind}`);

  // 4. 点击结果应在当前活动分组打开，而不是新开右侧分组
  const writeRef = items.references.find((r) => r.uri.toString() === testUri.toString() && r.kind === 'write');
  assert.ok(writeRef);
  await vscode.window.showTextDocument(content, vscode.ViewColumn.One);
  await vscode.commands.executeCommand('goRw.openReference', { type: 'ref', ref: writeRef, displayPath: 'content_test.go' });
  await sleep(500);
  const groups = vscode.window.tabGroups.all.length;
  const visible = vscode.window.visibleTextEditors.map((e) => ({ file: path.basename(e.document.uri.fsPath), column: e.viewColumn }));
  report.openInActiveGroup = { groups, visible };
  assert.equal(groups, 1, '不应新开编辑器分组');
  assert.ok(visible.some((e) => e.file === 'content_test.go' && e.column === vscode.ViewColumn.One), '应在第一分组打开目标文件');
}
