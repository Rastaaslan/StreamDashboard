const certificateFile = process.env.WINDOWS_CERTIFICATE_FILE || undefined;
const certificatePassword = process.env.WINDOWS_CERTIFICATE_PASSWORD || undefined;

module.exports = {
  packagerConfig: {
    name: 'StreamDashboard',
    electronVersion: '43.0.0',
    executableName: 'StreamDashboard',
    appBundleId: 'com.rastaaslan.streamdashboard',
    icon: './resources/streamdashboard',
    asar: true,
    prune: true,
    // Runtime needs dist/**, apps/web/**, apps/mobile/**, resources/distribution.json,
    // package.json and production node_modules. Source/tests/tooling only increase the
    // attack/read surface and ASAR size, so exclude them from shipped builds.
    ignore: [
      /^\/(?:_integration_sources|tests|docs|scripts|data|\.github)(?:\/|$)/,
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
