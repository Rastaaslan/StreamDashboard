const certificateFile = process.env.WINDOWS_CERTIFICATE_FILE || undefined;
const certificatePassword = process.env.WINDOWS_CERTIFICATE_PASSWORD || undefined;
const electronVersion = require('./package.json').devDependencies.electron;
const applicationVersion = require('./package.json').version;

module.exports = {
  packagerConfig: {
    name: 'StreamDashboard',
    electronVersion,
    // Windows resources require numeric components. Restore the runtime SemVer before ASAR.
    appVersion: applicationVersion.split('-')[0],
    beforeAsar: [async ({ buildPath }) => {
      const fs = require('node:fs/promises');
      const manifestPath = require('node:path').join(buildPath, 'package.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      manifest.version = applicationVersion;
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    }],
    executableName: 'StreamDashboard',
    appBundleId: 'com.rastaaslan.streamdashboard',
    icon: './resources/streamdashboard',
    asar: true,
    prune: true,
    // Runtime needs dist/**, apps/web/**, apps/mobile/**, resources/distribution.json,
    // package.json and production node_modules. Source/tests/tooling only increase the
    // attack/read surface and ASAR size, so exclude them from shipped builds.
    ignore: [
      /^\/\.cb52-tmp(?:\/|$)/,
      /^\/[^/]*\.log$/,
      /^\/\.dependencies(?:\/|$)/,
      /^\/node_modules\/(?:\.cache|\.vite)(?:\/|$)/,
      /^\/(?:test-results|playwright-report)(?:\/|$)/,
      /^\/dist\/(?:tests|scripts)(?:\/|$)/,
      /^\/(?:_integration_sources|android|tests|docs|scripts|data|\.github|\.agents|\.codex)(?:\/|$)/,
      /^\/apps\/(?:desktop|server)\/src(?:\/|$)/,
      /^\/(?:integrations|packages)(?:\/|$)/,
      /^\/(?:README\.md|tsconfig\.json|vitest\.config\.ts|playwright(?:\.[^/]*)?\.ts|\.env\.example|Lancer_StreamDashboard\.cmd|package-lock\.json)$/,
    ],
    windowsSign: certificateFile ? {
      certificateFile,
      certificatePassword,
      description: 'StreamDashboard',
      continueOnError: false,
    } : undefined,
  },
  rebuildConfig: {},
  makers: [{
    name: '@electron-forge/maker-squirrel',
    config: {
      name: 'StreamDashboard',
      setupExe: 'StreamDashboardSetup.exe',
      setupIcon: './resources/streamdashboard.ico',
      authors: 'Rastaaslan',
      description: 'Cockpit Windows pour OBS, Twitch, Google Calendar et télécommande LAN',
      certificateFile,
      certificatePassword,
    },
  }],
};
