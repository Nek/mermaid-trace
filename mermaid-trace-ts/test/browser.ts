import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium, firefox } from 'playwright';

const browserName = process.env.TRACE_TEST_BROWSER ?? 'chromium';
if (browserName !== 'chromium' && browserName !== 'firefox') {
  throw new Error(`Unsupported TRACE_TEST_BROWSER: ${browserName}`);
}
export const clipboardPermissions = browserName === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [];

export async function launchBrowser() {
  if (browserName === 'chromium') return chromium.launch();
  // Firefox has no Playwright clipboard grant. This permits the real clipboard in tests.
  const options = { firefoxUserPrefs: { 'dom.events.testing.asyncClipboard': true } };
  if (process.platform !== 'darwin') return firefox.launch(options);

  // Playwright #42768: macOS protects the installed Firefox application's data directory.
  // Isolate test application data without changing the browser bundle or OS permissions.
  const executable = firefox.executablePath();
  const resources = resolve(dirname(executable), '../Resources');
  const directory = await mkdtemp(join(tmpdir(), 'trace-firefox-app-'));
  const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
  try {
    await symlink(join(resources, 'browser/omni.ja'), join(directory, 'omni.ja'));
    const configuration = (await readFile(join(resources, 'application.ini'), 'utf8'))
      .replace(/^Vendor=.*$/m, 'Vendor=MermaidTraceTests')
      .replace(/^Name=.*$/m, 'Name=MermaidTraceTests');
    await writeFile(join(directory, 'application.ini'), configuration);
    const launcher = join(directory, 'launch');
    // -app must precede Playwright's arguments; its profile and preferences remain intact.
    await writeFile(launcher, `#!/bin/sh\nexec ${quote(executable)} -app ${quote(join(directory, 'application.ini'))} "$@"\n`, { mode: 0o700 });
    const browser = await firefox.launch({ ...options, executablePath: launcher });
    browser.on('disconnected', () => { void rm(directory, { recursive: true, force: true }); });
    return browser;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
