// Shared by the fake executables: appends one invocation to <FAKE_ENV_LOG_DIR>/<tool>.jsonl.
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

const RECORDED_ENV = /^(CLAUDE_|CLAUDEFORGE_CLI_|TERM_PROGRAM|FORCE_COLOR|GH_)/

export function record(tool, args) {
  const dir = process.env.FAKE_ENV_LOG_DIR
  if (!dir) return
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => RECORDED_ENV.test(key)))
  appendFileSync(join(dir, `${tool}.jsonl`), JSON.stringify({ args, cwd: process.cwd(), env }) + '\n')
}
