import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import assert from 'node:assert/strict';
import type { GoRwApi } from '../../extension';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findPosition(doc: vscode.TextDocument, lineIncludes: string, symbol: string): vscode.Position {
  for (let line = 0; line < doc.lineCount; line++) {
    const text = doc.lineAt(line).text;
    const column = text.indexOf(lineIncludes);
    if (column < 0) {
      continue;
    }
    const at = text.indexOf(symbol, column);
    assert.ok(at >= 0, `第 ${line + 1} 行未找到 ${symbol}`);
    return new vscode.Position(line, at);
  }
  throw new Error(`未找到包含「${lineIncludes}」的行`);
}

async function waitForGopls(uri: vscode.Uri, position: vscode.Position): Promise<void> {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      uri,
      position,
    );
    if (locations && locations.length > 1) {
      return;
    }
    await sleep(1500);
  }
  throw new Error('等待目标工程的 gopls 就绪超时');
}

export async function run(): Promise<void> {
  const report: Record<string, unknown> = {};
  try {
    const goExt = vscode.extensions.getExtension('golang.go');
    assert.ok(goExt, 'Go 扩展未加载');
    await goExt.activate();

    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
    ) as { publisher: string; name: string };
    const ext = vscode.extensions.getExtension<GoRwApi>(`${manifest.publisher}.${manifest.name}`);
    assert.ok(ext, '待测插件未加载');
    const api = await ext.activate();

    const file = vscode.Uri.file(process.env.GO_RW_REAL_FILE!);
    const doc = await vscode.workspace.openTextDocument(file);
    const symbol = process.env.GO_RW_REAL_SYMBOL ?? 'Items';
    const declNeedle = process.env.GO_RW_REAL_DECL_NEEDLE ?? 'Items []string';
    const decl = findPosition(doc, declNeedle, symbol);
    await waitForGopls(file, decl);

    const result = await api.search(file, decl);
    assert.ok(result, '目标工程查询无结果');
    const write = result.references.filter((r) => r.kind === 'write');
    const read = result.references.filter((r) => r.kind === 'read');
    const declaration = result.references.filter((r) => r.kind === 'declaration');
    const illegal = result.references.filter(
      (r) => r.kind !== 'write' && r.kind !== 'read' && r.kind !== 'declaration',
    );

    report.file = path.basename(file.fsPath);
    report.symbol = result.symbol;
    report.total = result.references.length;
    report.write = write.length;
    report.read = read.length;
    report.declaration = declaration.length;
    report.declarationSamples = declaration.slice(0, 4).map(
      (r) => `${path.basename(r.uri.fsPath)}:${r.range.start.line + 1} ${r.lineText.trim().slice(0, 110)}`,
    );
    report.illegal = illegal.length;
    report.heuristic = result.heuristicCount;
    report.writeSamples = write.slice(0, 12).map(
      (r) => `${path.basename(r.uri.fsPath)}:${r.range.start.line + 1} ${r.lineText.trim().slice(0, 110)}`,
    );
    report.readSamples = read.slice(0, 8).map(
      (r) => `${path.basename(r.uri.fsPath)}:${r.range.start.line + 1} ${r.lineText.trim().slice(0, 110)}`,
    );

    assert.equal(illegal.length, 0, '目标工程里不允许出现写入/读取/声明之外的第四类');
    assert.ok(write.length > 0, '目标工程里应有写入引用');
    assert.ok(read.length > 0, '目标工程里应有读取引用');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    console.log(`GO_RW_REPORT_BEGIN${JSON.stringify(report)}GO_RW_REPORT_END`);
  }
}
