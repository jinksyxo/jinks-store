import { spawn } from 'node:child_process'

const root = process.cwd()
const children = []
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function runProcess(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  })

  children.push(child)

  child.on('exit', (code) => {
    if (code && code !== 0) {
      process.exitCode = code
    }

    shutdown()
  })
}

function shutdown() {
  while (children.length) {
    const child = children.pop()

    if (child && !child.killed) {
      child.kill('SIGTERM')
    }
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

runProcess(npmCommand, ['run', 'dev:server'])
runProcess(npmCommand, ['run', 'dev:client'])
