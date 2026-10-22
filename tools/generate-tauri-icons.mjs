import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.dirname(scriptDirectory)
const uiDirectory = path.join(repositoryRoot, 'ui')
const sourceDirectory = path.join(uiDirectory, 'src-tauri', 'icons-source')
const outputDirectory = path.join(uiDirectory, 'src-tauri', 'icons')
const python = process.platform === 'win32' ? 'python' : 'python3'
const tauriCli = path.join(uiDirectory, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')

execFileSync(
  python,
  [path.join(scriptDirectory, 'generate-icons.py'), '--out', sourceDirectory],
  { cwd: repositoryRoot, stdio: 'inherit' },
)
execFileSync(
  process.execPath,
  [tauriCli, 'icon', path.join(sourceDirectory, 'icon128.png'), '--output', outputDirectory],
  { cwd: uiDirectory, stdio: 'inherit' },
)
