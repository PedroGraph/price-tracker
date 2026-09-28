/**
 * Builds release/Price-Tracker-Installer.exe, the hand-made installer window
 * (installer/Installer.cs), with the C# compiler that ships with Windows.
 *
 *   npm run installer
 */
const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const FW = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319')
const csc = join(FW, 'csc.exe')
if (!existsSync(csc)) {
  console.error(`C# compiler not found at ${csc} (it ships with Windows / .NET Framework 4.8).`)
  process.exit(1)
}

const root = join(__dirname, '..')
const out = join(root, 'release', 'Price-Tracker-Installer.exe')
mkdirSync(join(root, 'release'), { recursive: true })

execFileSync(
  csc,
  [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    '/platform:anycpu',
    `/out:${out}`,
    `/win32icon:${join(root, 'resources', 'icon.ico')}`,
    `/win32manifest:${join(root, 'installer', 'app.manifest')}`,
    `/resource:${join(root, 'resources', 'icon.png')},icon.png`,
    `/reference:${join(FW, 'WPF', 'PresentationFramework.dll')}`,
    `/reference:${join(FW, 'WPF', 'PresentationCore.dll')}`,
    `/reference:${join(FW, 'WPF', 'WindowsBase.dll')}`,
    `/reference:${join(FW, 'System.Xaml.dll')}`,
    join(root, 'installer', 'Installer.cs')
  ],
  { stdio: 'inherit' }
)
console.log(`Built ${out}`)
