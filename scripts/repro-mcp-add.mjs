import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const cases = [
  { name: 'missing --agent value', args: ['--agent'], expected: 'ignored' },
  { name: 'missing --command value', args: ['--command'], expected: 'ignored' },
  { name: '--agent swallowed as --command value', args: ['--command', '--agent', 'amp'], expected: 'swallowed' },
  { name: '--agent=value syntax', args: ['--agent=amp'], expected: 'equals-ignored' },
  { name: '--command=value syntax', args: ['--command=printf repro'], expected: 'equals-ignored' },
]

const observations = []
for (const testCase of cases) {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'incur-mcp-repro-'))
  try {
    const home = path.join(sandbox, 'home')
    const bin = path.join(sandbox, 'bin')
    mkdirSync(home, { recursive: true })
    mkdirSync(bin, { recursive: true })

    const stubLog = path.join(sandbox, 'add-mcp.log')
    const stub = path.join(bin, 'add-mcp')
    writeFileSync(stub, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$REPRO_ADD_MCP_LOG"\nprintf \'stubbed add-mcp invocation\\n\'\nexit 0\n')
    chmodSync(stub, 0o755)

    const env = {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      REPRO_ADD_MCP_LOG: stubLog,
      PATH: bin + ':' + (process.env.PATH ?? ''),
    }
    const result = spawnSync(
      'pnpm',
      ['exec', 'tsx', 'src/cli/index.ts', 'mcp', 'add', ...testCase.args],
      { cwd: root, env, encoding: 'utf8', timeout: 30_000 },
    )
    if (result.error) throw result.error
    let addMcpCalls = 0
    try { addMcpCalls = readFileSync(stubLog, 'utf8').trim().split('\n').filter(Boolean).length }
    catch {}
    const ampConfigPath = path.join(home, '.config', 'amp', 'settings.json')
    let ampConfig
    try { ampConfig = JSON.parse(readFileSync(ampConfigPath, 'utf8')) }
    catch {}

    const observation = {
      case: testCase.name,
      exitCode: result.status,
      addMcpCalls,
      ampCommand: ampConfig?.['amp.mcpServers']?.incur?.command,
    }
    observations.push(observation)

    assert.equal(result.status, 0, testCase.name + ': expected current implementation to exit 0')
    if (testCase.expected === 'ignored') assert.equal(addMcpCalls, 1)
    if (testCase.expected === 'swallowed') {
      assert.equal(addMcpCalls, 0)
      assert.equal(observation.ampCommand, '--agent')
    }
    if (testCase.expected === 'equals-ignored') {
      assert.equal(addMcpCalls, 1)
      assert.equal(observation.ampCommand, undefined)
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
}

console.log('Confirmed current mcp add parsing behavior:')
for (const item of observations) {
  console.log('- ' + item.case + ': exit=' + item.exitCode + ', add-mcp calls=' + item.addMcpCalls + ', Amp command=' + (item.ampCommand ?? '(none)'))
}
