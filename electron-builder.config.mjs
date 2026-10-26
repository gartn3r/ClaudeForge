// Packages the built app (`npm run build`, into out/) as ClaudeForge's Windows installer, in dist/.
// `npm run package` builds it; the release workflow (.github/workflows/release.yml) also publishes
// it to GitHub releases, where the installed app looks for its updates.
//
// Code signing switches on when its secrets are in the environment, and is skipped, saying so,
// when they are not:
// - Azure Artifact Signing: AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET (an app
//   registration allowed to sign), plus AZURE_SIGNING_ENDPOINT, AZURE_SIGNING_ACCOUNT,
//   AZURE_SIGNING_PROFILE and AZURE_SIGNING_PUBLISHER (the certificate's subject name);
// - or a certificate file: CSC_LINK (the .pfx, base64 or a path) and CSC_KEY_PASSWORD.
// A release sets CLAUDEFORGE_REQUIRE_SIGNING=true: it fails rather than ship unsigned, since a signed
// ClaudeForge refuses updates its publisher did not sign.

/** Read once, so that the variable GitHub Actions sets empty for a missing secret counts as unset. */
const env = (name) => process.env[name] || undefined

const AZURE = {
  AZURE_TENANT_ID: env('AZURE_TENANT_ID'),
  AZURE_CLIENT_ID: env('AZURE_CLIENT_ID'),
  AZURE_CLIENT_SECRET: env('AZURE_CLIENT_SECRET'),
  AZURE_SIGNING_ENDPOINT: env('AZURE_SIGNING_ENDPOINT'),
  AZURE_SIGNING_ACCOUNT: env('AZURE_SIGNING_ACCOUNT'),
  AZURE_SIGNING_PROFILE: env('AZURE_SIGNING_PROFILE'),
  AZURE_SIGNING_PUBLISHER: env('AZURE_SIGNING_PUBLISHER')
}

/** In GitHub Actions, a line the run's summary shows as well as its log. */
const notice = (message) => console.log(process.env.GITHUB_ACTIONS ? `::notice title=Code signing::${message}` : message)

/** The `win` options that sign the installer and the app, or none when there is nothing to sign with. */
function signing() {
  const azureSet = Object.entries(AZURE).filter(([, value]) => value)
  if (azureSet.length === Object.keys(AZURE).length) {
    notice(`Code signing: on, with Azure Artifact Signing (profile ${AZURE.AZURE_SIGNING_PROFILE}).`)
    return {
      forceCodeSigning: true,
      azureSignOptions: {
        endpoint: AZURE.AZURE_SIGNING_ENDPOINT,
        codeSigningAccountName: AZURE.AZURE_SIGNING_ACCOUNT,
        certificateProfileName: AZURE.AZURE_SIGNING_PROFILE,
        publisherName: AZURE.AZURE_SIGNING_PUBLISHER
      }
    }
  }
  if (azureSet.length) {
    const missing = Object.keys(AZURE).filter((name) => !AZURE[name])
    throw new Error(`Code signing: Azure Artifact Signing is half configured; ${missing.join(', ')} not set.`)
  }
  if (env('CSC_LINK') || env('WIN_CSC_LINK')) {
    notice('Code signing: on, with the certificate in CSC_LINK.')
    return { forceCodeSigning: true }
  }
  if (env('CLAUDEFORGE_REQUIRE_SIGNING') === 'true') {
    throw new Error('Code signing: required, but no certificate is configured (see electron-builder.config.mjs).')
  }
  notice('Code signing: skipped, no certificate configured. The installer and the app are unsigned.')
  return {}
}

// Never to change once released: the installer finds the installed ClaudeForge by it, and Windows
// shows its notifications under it (src/main/index.ts).
const APP_ID = 'io.github.gartn3r.claudeforge'

/** @type {import('electron-builder').Configuration} */
export default {
  appId: APP_ID,
  productName: 'ClaudeForge',
  copyright: 'Copyright © ClaudeForge contributors',
  directories: { output: 'dist', buildResources: 'build' },
  // node-pty ships prebuilt Node-API modules, which Electron loads as they are: nothing to compile.
  npmRebuild: false,
  files: [
    'out/**/*',
    // node-pty: only the Windows x64 build runs; its sources and copies of ConPTY are not needed.
    '!node_modules/node-pty/{binding.gyp,src,scripts,third_party,build,typings}/**',
    '!node_modules/node-pty/prebuilds/{darwin,linux}-*/**',
    '!node_modules/node-pty/prebuilds/win32-arm64/**',
    '!node_modules/node-pty/**/*.pdb'
  ],
  // Windows loads node-pty's native module, and the `conpty.dll` and `OpenConsole.exe` it ships
  // beside it, from real files: they cannot run from inside the app's archive (ADR 0001).
  asarUnpack: ['node_modules/node-pty/**'],
  extraResources: [{ from: 'THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' }],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    // Native modules are signed too; OpenConsole.exe keeps the Microsoft signature it ships with.
    signExts: ['.node', '!OpenConsole.exe'],
    ...signing()
  },
  nsis: {
    // One click, for the user only: no administrator rights, so updates install without a prompt.
    oneClick: true,
    perMachine: false,
    artifactName: 'ClaudeForge-Setup-${version}.${ext}',
    shortcutName: 'ClaudeForge',
    uninstallDisplayName: 'ClaudeForge',
    deleteAppDataOnUninstall: false
  },
  // A draft, until the release workflow has checked the installer it uploaded and publishes it.
  publish: [{ provider: 'github', owner: 'gartn3r', repo: 'ClaudeForge', releaseType: 'draft' }]
}
