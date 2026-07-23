import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const roots = ['src', 'dist']
const forbidden = [
  '你是一个专业的内容安全与形态审核助手。你的唯一任务是批量评估一批视频分镜描述',
  'CONTENT_MODERATION_BASELINE_PROMPT',
  'contentModerationBaselinePrompt',
  'VITE_BOOMCLIP_LOGIN_PASSWORD',
]

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(entryPath) : [entryPath]
  }))
  return files.flat()
}

const leaks = []
for (const root of roots) {
  for (const file of await filesUnder(root)) {
    const content = await readFile(file, 'utf8')
    for (const marker of forbidden) {
      if (content.includes(marker)) leaks.push(`${file}: ${marker}`)
    }
  }
}

if (leaks.length > 0) {
  throw new Error(`Prompt leakage detected:\n${leaks.join('\n')}`)
}

process.stdout.write('Prompt leakage scan passed for src and dist.\n')
