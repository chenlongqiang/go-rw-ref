import * as vscode from 'vscode';
import { SearchResult, searchReferences } from './finder';
import { ReferenceTreeProvider, RefNode } from './tree';

const VIEW_ID = 'goRwReferences';

export interface GoRwApi {
  search(uri: vscode.Uri, position: vscode.Position): Promise<SearchResult | undefined>;
}

export function activate(context: vscode.ExtensionContext): GoRwApi {
  const provider = new ReferenceTreeProvider();
  const treeView = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  treeView.message = '将光标放在 Go 标识符上，按 ⌥F7 或右键选择「Go: 查找读写引用」。';
  context.subscriptions.push(treeView);

  let searchCts: vscode.CancellationTokenSource | undefined;
  let lastQuery: { uri: vscode.Uri; position: vscode.Position } | undefined;

  const config = () => vscode.workspace.getConfiguration('goRw');

  const setTestsHidden = async (hidden: boolean) => {
    await provider.setHideTests(hidden);
    await vscode.commands.executeCommand('setContext', 'goRw.testsHidden', hidden);
    updateSummary();
  };

  const updateSummary = () => {
    const result = provider.current;
    if (!result) {
      treeView.description = undefined;
      treeView.message = '将光标放在 Go 标识符上，按 ⌥F7 或右键选择「Go: 查找读写引用」。';
      return;
    }
    const counts = provider.countByKind();
    const parts = [`写 ${counts.write}`, `读 ${counts.read}`];
    if (counts.declaration) {
      parts.push(`声明 ${counts.declaration}`);
    }
    treeView.description = `${result.symbol} · ${parts.join(' / ')}`;

    const messages: string[] = [];
    if (provider.visibleReferences().length === 0) {
      messages.push(result.references.length > 0 ? '当前已隐藏测试文件，未显示任何引用。' : `未找到「${result.symbol}」的引用。`);
    }
    if (result.heuristicCount > 0) {
      messages.push(`有 ${result.heuristicCount} 处 gopls 未给出读写类型，已按语法判定（条目标记为「启发式」）。`);
    }
    treeView.message = messages.length ? messages.join(' ') : undefined;
  };

  const runSearch = async (uri: vscode.Uri, position: vscode.Position, reveal: boolean): Promise<SearchResult | undefined> => {
    searchCts?.cancel();
    const cts = new vscode.CancellationTokenSource();
    searchCts = cts;
    lastQuery = { uri, position };

    if (reveal) {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }

    const cfg = config();
    const result = await vscode.window.withProgress(
      { location: { viewId: VIEW_ID }, title: '正在查找读写引用…' },
      () =>
        searchReferences(
          uri,
          position,
          {
            includeDeclaration: cfg.get<boolean>('includeDeclaration', true),
            concurrency: cfg.get<number>('classificationConcurrency', 8),
          },
          cts.token,
        ),
    );

    if (cts.token.isCancellationRequested) {
      return undefined;
    }
    await provider.setResult(result);
    updateSummary();
    return result;
  };

  const openReference = async (node: RefNode | undefined, toSide: boolean) => {
    if (!node || node.type !== 'ref') {
      return;
    }
    const cfg = config();
    const besides = toSide || cfg.get<string>('openLocation', 'activeGroup') === 'beside';
    const document = await vscode.workspace.openTextDocument(node.ref.uri);
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: besides ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
      preview: cfg.get<boolean>('previewMode', true),
      preserveFocus: toSide ? false : cfg.get<boolean>('preserveFocus', true),
      selection: node.ref.range,
    });
    editor.revealRange(node.ref.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('goRw.findReferences', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'go') {
        vscode.window.showWarningMessage('请在 Go 文件中，将光标放到要查找的标识符上。');
        return;
      }
      const position = editor.selection.active;
      if (!editor.document.getWordRangeAtPosition(position)) {
        vscode.window.showWarningMessage('光标位置没有可查找的标识符。');
        return;
      }
      try {
        await runSearch(editor.document.uri, position, true);
      } catch (error) {
        vscode.window.showErrorMessage(`查找读写引用失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }),
    vscode.commands.registerCommand('goRw.refresh', async () => {
      if (lastQuery) {
        await runSearch(lastQuery.uri, lastQuery.position, false);
      }
    }),
    vscode.commands.registerCommand('goRw.clear', async () => {
      searchCts?.cancel();
      lastQuery = undefined;
      await provider.setResult(undefined);
      updateSummary();
    }),
    vscode.commands.registerCommand('goRw.hideTests', () => setTestsHidden(true)),
    vscode.commands.registerCommand('goRw.showTests', () => setTestsHidden(false)),
    vscode.commands.registerCommand('goRw.openReference', (node: RefNode) => openReference(node, false)),
    vscode.commands.registerCommand('goRw.openReferenceToSide', (node: RefNode) => openReference(node, true)),
    { dispose: () => searchCts?.cancel() },
  );

  void setTestsHidden(config().get<boolean>('hideTestFiles', false));

  return {
    search: (uri, position) => runSearch(uri, position, false),
  };
}

export function deactivate(): void {}
