import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // 从 Electron 宿主中启动时会继承该变量，导致 VS Code 以纯 Node 模式运行。
  delete process.env.ELECTRON_RUN_AS_NODE;
  const root = path.resolve(__dirname, '../..');
  const fixture = path.join(root, 'test-fixtures', 'rwdemo');
  const realProject = process.env.GO_RW_REAL_PROJECT;
  const workspace = realProject ?? fixture;
  const testEntry = realProject
    ? path.join(__dirname, 'integration', 'realProject.js')
    : path.join(__dirname, 'integration', 'index.js');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'go-rw-it-'));
  const userDataDir = path.join(sandbox, 'user-data');
  const extensionsDir = path.join(sandbox, 'extensions');
  fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });

  const goExtension = process.env.GO_EXTENSION_DIR;
  if (!goExtension || !fs.existsSync(goExtension)) {
    throw new Error('请通过 GO_EXTENSION_DIR 指定已安装的 golang.go 扩展目录');
  }
  const goExtensionName = path.basename(goExtension);
  fs.cpSync(goExtension, path.join(extensionsDir, goExtensionName), { recursive: true });
  const registry = path.join(path.dirname(goExtension), 'extensions.json');
  if (fs.existsSync(registry)) {
    const entries = JSON.parse(fs.readFileSync(registry, 'utf8')) as { relativeLocation?: string; location?: { path?: string; fsPath?: string } }[];
    const goEntries = entries
      .filter((entry) => entry.relativeLocation === goExtensionName)
      .map((entry) => {
        const target = path.join(extensionsDir, goExtensionName);
        return {
          ...entry,
          location: { ...(entry.location ?? {}), $mid: 1, fsPath: target, external: `file://${target}`, path: target, scheme: 'file' },
        };
      });
    fs.writeFileSync(path.join(extensionsDir, 'extensions.json'), JSON.stringify(goEntries));
  }

  const settings: Record<string, unknown> = {
    'go.toolsManagement.autoUpdate': false,
    'go.toolsManagement.checkForUpdates': 'off',
    'go.survey.prompt': false,
    'telemetry.telemetryLevel': 'off',
    'security.workspace.trust.enabled': false,
  };
  if (process.env.GOPLS_PATH) {
    settings['go.alternateTools'] = { gopls: process.env.GOPLS_PATH };
  }
  fs.writeFileSync(path.join(userDataDir, 'User', 'settings.json'), JSON.stringify(settings, null, 2));

  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
    extensionDevelopmentPath: root,
    extensionTestsPath: testEntry,
    launchArgs: [
      workspace,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
    ],
    extensionTestsEnv: {
      GO_RW_FIXTURE: fixture,
      GO_RW_REAL_PROJECT: realProject ?? '',
      GO_RW_REAL_FILE: process.env.GO_RW_REAL_FILE ?? '',
      GO_RW_REPORT: process.env.GO_RW_REPORT ?? path.join(root, 'test-results', 'integration-report.json'),
    },
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
