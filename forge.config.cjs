module.exports = {
  packagerConfig: {
    name: 'StreamDashboard',
    electronVersion: '43.0.0',
    executableName: 'StreamDashboard',
    appBundleId: 'com.rastaaslan.streamdashboard',
    icon: './resources/streamdashboard',
    asar: true,
    prune: true,
    ignore: [/^\/(?:_integration_sources|tests|docs|scripts\/smoke|data)(?:\/|$)/],
  },
  rebuildConfig: {},
  makers: [{
    name: '@electron-forge/maker-squirrel',
    config: {
      name: 'StreamDashboard',
      setupExe: 'StreamDashboardSetup.exe',
      setupIcon: './resources/streamdashboard.ico',
      authors: 'Rastaaslan',
      description: 'Cockpit desktop Windows pour OBS et Twitch',
      certificateFile: process.env.WINDOWS_CERTIFICATE_FILE || undefined,
      certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD || undefined,
    },
  }],
};
