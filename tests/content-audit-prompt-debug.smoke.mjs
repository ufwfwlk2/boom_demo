import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:4173'
const artifactDir = process.env.ARTIFACT_DIR ?? path.resolve('artifacts')
const playwrightModule = process.env.PLAYWRIGHT_MODULE
const chromeExecutable = process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

if (!playwrightModule) throw new Error('PLAYWRIGHT_MODULE is required')

const { chromium } = await import(pathToFileURL(playwrightModule).href)
await mkdir(artifactDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: chromeExecutable,
  headless: true,
  args: ['--disable-background-networking', '--disable-component-update', '--no-default-browser-check'],
})

const configKey = 'boomclip.hotScriptBatch.config'
const syntheticToken = 'synthetic-browser-smoke-token'
const authorizedPromptMarker = 'SYNTHETIC_AUTHORIZED_PROMPT_V1_DO_NOT_SHIP'
const initialConfig = {
  apiBaseUrl: 'http://127.0.0.1:4174',
  authBaseUrl: 'http://127.0.0.1:4176',
  promptLabApiBaseUrl: 'http://127.0.0.1:4175',
  token: '',
  devPreviewFields: false,
}

const tasksPayload = {
  code: 200,
  status: 'success',
  data: {
    tasks: [
      {
        taskId: 'task-synthetic-001',
        status: 'completed',
        projectId: 11,
        templateId: 21,
        scriptCount: 1,
        progress: 100,
        completedCount: 1,
        failedCount: 0,
        createdAt: '2026-07-22T12:00:00Z',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  },
  message: [],
}

const previewsPayload = {
  code: 200,
  status: 'success',
  data: [
    {
      previewId: 'preview-synthetic-001',
      status: 'ready',
      templateId: 21,
      projectId: 11,
      gameName: '合成测试游戏',
      categoryId: 31,
      latestExecutionStatus: 'idle',
      finalSegments: [
        { finalSegmentIndex: 7, executionSource: 'ai_video', aiVideoPrompt: '明亮的游戏胜利界面，不含敏感内容' },
        { finalSegmentIndex: 2, executionSource: 'ai_video', aiVideoPrompt: '角色进入关卡并展示任务目标' },
        { finalSegmentIndex: 4, executionSource: 'ai_video', aiVideoPrompt: '未选中的备用画面描述' },
        { finalSegmentIndex: 3.5, executionSource: 'ai_video', aiVideoPrompt: '异常索引正文不得展示' },
        { finalSegmentIndex: 5, executionSource: 'material', aiVideoPrompt: '这条素材分镜不得展示' },
        { finalSegmentIndex: 9, executionSource: 'ai_video', aiVideoPrompt: '   ' },
      ],
      warnings: [],
    },
    {
      previewId: 'preview-synthetic-002',
      status: 'ready',
      templateId: 21,
      projectId: 11,
      gameName: '第二个合成 Preview',
      categoryId: 31,
      latestExecutionStatus: 'idle',
      finalSegments: [
        { finalSegmentIndex: 1, executionSource: 'ai_video', aiVideoPrompt: '第二个 Preview 的原始画面描述' },
      ],
      warnings: [],
    },
    {
      previewId: 'preview-synthetic-003',
      status: 'ready',
      templateId: 21,
      projectId: 11,
      gameName: '全部异常 Preview',
      categoryId: 31,
      latestExecutionStatus: 'idle',
      finalSegments: [
        { finalSegmentIndex: 3.5, executionSource: 'ai_video', aiVideoPrompt: '异常半索引正文不得展示' },
        { finalSegmentIndex: -1, executionSource: 'ai_video', aiVideoPrompt: '异常负索引正文不得展示' },
      ],
      warnings: [],
    },
  ],
  message: [],
}

const probeSuccessPayload = {
  code: 200,
  status: 'success',
  data: {
    requestId: '00000000-0000-4000-8000-000000000000',
    previewId: 'preview-synthetic-001',
    provider: 'yunwu',
    model: 'gemini-2.5-flash',
    results: [
      { finalSegmentIndex: 7, inputText: '明亮的游戏胜利界面，不含敏感内容', passed: true, reason: '' },
      { finalSegmentIndex: 2, inputText: '角色进入关卡并展示任务目标', passed: false, reason: '合成拒绝原因满足长度要求' },
    ],
    warnings: ['synthetic warning'],
    tokenUsage: { inputTokens: 12, outputTokens: 5, totalTokens: 17, source: 'usageMetadata' },
    latencyMs: 240,
    rawText: '{"taskStatus":"success","results":[{"index":0},{"index":1}]}',
  },
  message: [],
}

const probeFailurePayload = {
  code: 503,
  status: 'fail',
  data: { errorCode: 'moderation_probe_upstream_unavailable' },
  message: ['Upstream service unavailable'],
}

function probeSuccessFor(body) {
  const overrideByIndex = new Map(
    body.storyboardOverrides.map((item) => [item.finalSegmentIndex, item.inputText]),
  )
  return {
    ...probeSuccessPayload,
    data: {
      ...probeSuccessPayload.data,
      previewId: body.previewId,
      results: body.finalSegmentIndexes.map((finalSegmentIndex) => ({
        finalSegmentIndex,
        inputText: overrideByIndex.get(finalSegmentIndex),
        passed: finalSegmentIndex !== 2,
        reason: finalSegmentIndex === 2 ? '合成拒绝原因满足长度要求' : '',
      })),
    },
  }
}

let taskMode = 'success'
let probeMode = 'success'
let promptMode = 'success'
let optionsCount = 0
let rejectedCorsRequests = 0
const previewUrls = []
const probeRequests = []
const promptRequests = []

function writeJson(response, status, payload) {
  response.writeHead(status, corsHeaders)
  response.end(JSON.stringify(payload))
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

const corsHeaders = {
  'Access-Control-Allow-Origin': appUrl,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
}

const picServer = createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    optionsCount += 1
    response.writeHead(204, corsHeaders)
    response.end()
    return
  }
  if (taskMode === 'forbidden' && request.url?.includes('/preview-tasks?')) {
    writeJson(response, 403, { code: 403, status: 'error', data: { errorCode: 'forbidden' }, message: ['Forbidden'] })
    return
  }
  if (request.url?.includes('/preview-tasks?')) {
    writeJson(response, 200, tasksPayload)
    return
  }
  if (request.url?.includes('/preview-tasks/task-synthetic-001/previews')) {
    previewUrls.push(`http://${request.headers.host}${request.url}`)
    writeJson(response, 200, previewsPayload)
    return
  }
  writeJson(response, 404, { code: 404, status: 'error', data: {}, message: ['Not found'] })
})

const labServer = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    optionsCount += 1
    response.writeHead(204, corsHeaders)
    response.end()
    return
  }
  if (request.method === 'GET' && request.url === '/api/v1/content-moderation/prompt') {
    const currentMode = promptMode
    promptRequests.push({
      authorization: request.headers.authorization,
      mode: currentMode,
    })
    if (currentMode === 'delayed-forbidden') {
      await new Promise((resolve) => setTimeout(resolve, 500))
      writeJson(response, 403, {
        code: 403,
        status: 'error',
        data: { errorCode: 'moderation_probe_forbidden' },
        message: ['Forbidden'],
      })
      return
    }
    if (currentMode === 'forbidden') {
      writeJson(response, 403, {
        code: 403,
        status: 'error',
        data: { errorCode: 'moderation_probe_forbidden' },
        message: ['Forbidden'],
      })
      return
    }
    writeJson(response, 200, {
      code: 200,
      status: 'success',
      data: {
        prompt: authorizedPromptMarker,
        version: 'v1',
      },
      message: [],
    })
    return
  }
  if (request.method !== 'POST' || request.url !== '/api/v1/content-moderation/probe') {
    writeJson(response, 404, { code: 404, status: 'error', data: {}, message: ['Not found'] })
    return
  }
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  probeRequests.push({
    url: `http://${request.headers.host}${request.url}`,
    authorization: request.headers.authorization,
    body,
  })
  await new Promise((resolve) => setTimeout(resolve, 350))
  if (probeMode === 'unavailable') {
    response.destroy()
    return
  }
  if (probeMode === 'failure') {
    writeJson(response, 503, probeFailurePayload)
    return
  }
  writeJson(response, 200, probeSuccessFor(body))
})

function createCorsDenyServer(mode) {
  return createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      optionsCount += 1
      const headers = { ...corsHeaders }
      if (mode === 'origin') delete headers['Access-Control-Allow-Origin']
      if (mode === 'method') headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
      if (mode === 'header') headers['Access-Control-Allow-Headers'] = 'Content-Type'
      response.writeHead(204, headers)
      response.end()
      return
    }
    rejectedCorsRequests += 1
    writeJson(response, 200, { ok: true })
  })
}

const corsDenyServers = [
  { mode: 'origin', port: 4177, server: createCorsDenyServer('origin') },
  { mode: 'method', port: 4178, server: createCorsDenyServer('method') },
  { mode: 'header', port: 4179, server: createCorsDenyServer('header') },
]

await Promise.all([
  listen(picServer, 4174),
  listen(labServer, 4175),
  ...corsDenyServers.map(({ server, port }) => listen(server, port)),
])

const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  serviceWorkers: 'block',
})
await context.addInitScript(({ key, config }) => {
  if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(config))
}, { key: configKey, config: initialConfig })

const page = await context.newPage()

try {
  const rootResponse = await page.goto(`${appUrl}/`, { waitUntil: 'networkidle' })
  assert.equal(rootResponse?.status(), 200, 'root route must return 200')
  await page.getByRole('heading', { name: '内容审核 Prompt 调试台' }).waitFor()
  await page.getByText('授权 Prompt 未加载').waitFor()
  assert.equal(await page.getByLabel('授权完整 Prompt').count(), 0, 'Prompt must not render before authorization')
  assert.equal(await page.getByLabel('登录密码').inputValue(), '', 'Prompt Lab password must start empty')
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '内容审核 Prompt 调试台' }).waitFor()
  await page.screenshot({ path: path.join(artifactDir, 'STEP3_ROOT_DESKTOP.png'), fullPage: true })

  await page.getByRole('link', { name: '打开 Preview 运营测试台' }).click()
  await page.waitForURL(`${appUrl}/preview-operations`)
  await page.getByRole('heading', { name: 'Heykool运营测试台' }).waitFor()

  const operationsResponse = await page.goto(`${appUrl}/preview-operations`, { waitUntil: 'networkidle' })
  assert.equal(operationsResponse?.status(), 200, 'Preview operations route must return 200')
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Heykool运营测试台' }).waitFor()
  assert.equal(await page.getByLabel('登录密码').inputValue(), '', 'operations password must start empty')

  const aliasResponse = await page.goto(`${appUrl}/content-audit-prompt-debug`, { waitUntil: 'networkidle' })
  assert.equal(aliasResponse?.status(), 200, 'Prompt Lab compatibility alias must return 200')
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: '内容审核 Prompt 调试台' }).waitFor()

  await page.evaluate((key) => {
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}')
    localStorage.setItem(key, JSON.stringify({
      ...stored,
      promptLabApiBaseUrl: 'https://legacy-user:legacy-password@example.test/path?key=legacy#fragment',
    }))
  }, configKey)
  await page.reload({ waitUntil: 'networkidle' })
  assert.equal(await page.getByLabel('Prompt Lab API Base URL').inputValue(), 'http://boomclip.heykoolai.com:5064')
  await page.waitForFunction((key) => {
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}')
    return stored.promptLabApiBaseUrl === 'http://boomclip.heykoolai.com:5064'
  }, configKey)
  assert.equal(probeRequests.length, 0, 'invalid legacy config must not send a probe')

  await page.getByRole('button', { name: '刷新' }).click()
  await page.getByRole('alert').filter({ hasText: '请先填写 Bearer Token' }).waitFor()

  await page.getByLabel('Prompt Lab API Base URL').fill('http://127.0.0.1:4175')
  await page.getByLabel('Bearer Token').fill(syntheticToken)
  await page.waitForFunction(({ key, token }) => JSON.parse(localStorage.getItem(key) ?? '{}').token === token, {
    key: configKey,
    token: syntheticToken,
  })

  promptMode = 'delayed-forbidden'
  await page.getByRole('button', { name: '加载授权 Prompt' }).click()
  await page.getByRole('button', { name: '加载中...' }).waitFor()
  await page.getByLabel('Bearer Token').fill(`${syntheticToken}-replacement`)
  promptMode = 'success'
  await page.getByRole('button', { name: '加载授权 Prompt' }).click()
  const authorizedPrompt = page.getByLabel('授权完整 Prompt')
  await authorizedPrompt.waitFor()
  assert.equal(await authorizedPrompt.inputValue(), authorizedPromptMarker)
  await page.waitForTimeout(600)
  assert.equal(await authorizedPrompt.inputValue(), authorizedPromptMarker, 'stale 403 must not hide the new Prompt')

  promptMode = 'forbidden'
  await page.getByRole('button', { name: '重新加载授权 Prompt' }).click()
  await page.getByRole('alert').filter({ hasText: '当前账号未加入 Prompt Lab 授权' }).waitFor()
  assert.equal(await page.getByLabel('授权完整 Prompt').count(), 0, '403 must keep Prompt hidden')

  promptMode = 'success'
  await page.getByRole('button', { name: '加载授权 Prompt' }).click()
  await page.getByLabel('授权完整 Prompt').waitFor()
  await page.getByLabel('Bearer Token').fill(syntheticToken)
  assert.equal(await page.getByLabel('授权完整 Prompt').count(), 0, 'token changes must clear Prompt')
  await page.getByRole('button', { name: '加载授权 Prompt' }).click()
  await page.getByLabel('授权完整 Prompt').waitFor()
  await page.getByLabel('Prompt Lab API Base URL').fill('http://127.0.0.1:4175/')
  assert.equal(await page.getByLabel('授权完整 Prompt').count(), 0, 'Prompt Lab URL changes must clear Prompt')
  await page.getByRole('button', { name: '加载授权 Prompt' }).click()
  await page.getByLabel('授权完整 Prompt').waitFor()

  const storedConfig = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), configKey)
  assert.equal(storedConfig.promptLabApiBaseUrl, 'http://127.0.0.1:4175')
  assert.equal(storedConfig.devPreviewFields, false)
  assert(!('promptOverride' in storedConfig), 'candidate prompt must not be persisted')
  taskMode = 'forbidden'
  await page.getByRole('button', { name: '刷新' }).click()
  await page.getByRole('alert').filter({ hasText: '当前账号没有访问权限' }).waitFor()

  taskMode = 'success'
  await page.getByRole('button', { name: '刷新' }).click()
  await page.getByText('合成测试游戏').waitFor()
  assert(previewUrls.some((url) => !url.includes('?dev=1')), 'default preview request must not include ?dev=1')

  await page.getByLabel('Preview 详情追加 ?dev=1').check()
  await page.getByRole('button', { name: '重载详情' }).click()
  await page.getByText('合成测试游戏').waitFor()
  assert(previewUrls.some((url) => url.endsWith('?dev=1')), 'dev preview request must include ?dev=1')

  assert.equal(await page.locator('.prompt-lab-segment-card').count(), 3, 'only auditable AI video segments render')
  assert.equal(await page.locator('.prompt-lab-segment-list input:checked').count(), 3, 'first auditable preview must auto-select every segment')
  await page.getByText('检测到 1 条旧版异常分镜索引，已跳过；请重新生成 Preview 后测试。').waitFor()
  assert.equal(await page.getByLabel('分镜 #3.5 画面描述').count(), 0, 'fractional segment must not be editable')
  assert.equal(await page.getByText('异常索引正文不得展示').count(), 0, 'invalid segment text must not render')
  const candidatePrompt = page.getByLabel('授权完整 Prompt')
  const baselinePrompt = await candidatePrompt.inputValue()
  assert.equal(baselinePrompt, authorizedPromptMarker)

  await candidatePrompt.fill('')
  await page.getByRole('button', { name: '执行审核' }).click()
  await page.getByRole('alert').filter({ hasText: '候选 Prompt 不能为空' }).waitFor()
  assert.equal(probeRequests.length, 0, 'blank candidate prompt must be blocked in browser')
  await page.getByRole('button', { name: '恢复基准 Prompt' }).click()
  assert.equal(await candidatePrompt.inputValue(), baselinePrompt)

  await page.getByRole('button', { name: '取消全选' }).click()
  assert.equal(await page.locator('.prompt-lab-segment-list input:checked').count(), 0)
  await page.getByRole('button', { name: '执行审核' }).click()
  await page.getByRole('alert').filter({ hasText: '请选择 Preview 和至少一条 AI 视频分镜' }).waitFor()
  assert.equal(probeRequests.length, 0, 'manual deselection must be blocked in browser')
  await page.getByRole('button', { name: '全选' }).click()

  const storyboardSeven = page.getByLabel('分镜 #7 画面描述')
  const storyboardTwo = page.getByLabel('分镜 #2 画面描述')
  const storyboardFour = page.getByLabel('分镜 #4 画面描述')
  const originalSeven = '明亮的游戏胜利界面，不含敏感内容'
  const overrideSeven = '临时覆盖后的胜利界面画面描述'
  const overrideTwo = '临时覆盖后的关卡任务画面描述'

  await storyboardSeven.fill('准备恢复的临时编辑')
  await page.getByRole('button', { name: '恢复分镜 #7 原文' }).click()
  assert.equal(await storyboardSeven.inputValue(), originalSeven)
  await storyboardSeven.fill(overrideSeven)
  await storyboardTwo.fill(overrideTwo)
  await storyboardFour.fill('未选中分镜的本地草稿不得提交')

  await page.getByRole('tab', { name: /第二个合成 Preview/ }).click()
  const secondPreviewStoryboard = page.getByLabel('分镜 #1 画面描述')
  assert.equal(await secondPreviewStoryboard.inputValue(), '第二个 Preview 的原始画面描述')
  assert.equal(await page.locator('.prompt-lab-segment-list input:checked').count(), 1, 'switched preview must auto-select its segments')
  await secondPreviewStoryboard.fill('第二个 Preview 的隔离草稿')
  await page.getByRole('tab', { name: /全部异常 Preview/ }).click()
  await page.getByText('检测到 2 条旧版异常分镜索引，已跳过；请重新生成 Preview 后测试。').waitFor()
  assert.equal(await page.locator('.prompt-lab-segment-card').count(), 0, 'all-invalid preview must have no auditable segments')
  const requestCountBeforeAllInvalidSubmit = probeRequests.length
  await page.getByRole('button', { name: '执行审核' }).click()
  await page.getByRole('alert').filter({ hasText: '请选择 Preview 和至少一条 AI 视频分镜' }).waitFor()
  assert.equal(probeRequests.length, requestCountBeforeAllInvalidSubmit, 'all-invalid preview must not send a probe')
  await page.getByRole('tab', { name: /合成测试游戏/ }).click()
  assert.equal(await page.locator('.prompt-lab-segment-list input:checked').count(), 3, 'switching back must auto-select that preview')
  assert.equal(await storyboardSeven.inputValue(), overrideSeven)
  assert.equal(await storyboardFour.inputValue(), '未选中分镜的本地草稿不得提交')

  await candidatePrompt.fill('临时候选 Prompt')
  await page.getByRole('button', { name: '恢复基准 Prompt' }).click()
  assert.equal(await candidatePrompt.inputValue(), baselinePrompt)
  assert.equal(await storyboardSeven.inputValue(), overrideSeven, 'restoring prompt must not reset storyboard drafts')

  await page.getByRole('checkbox', { name: '#4' }).uncheck()
  await page.getByLabel('Prompt Lab API Base URL').fill('http://127.0.0.1:4175/')
  await page.getByRole('button', { name: '加载授权 Prompt' }).click()
  await candidatePrompt.waitFor()

  await storyboardSeven.fill('   ')
  await page.getByRole('button', { name: '执行审核' }).click()
  await page.getByText('画面描述不能为空。').waitFor()
  assert.equal(probeRequests.length, 0, 'blank selected storyboard must be blocked in browser')
  await storyboardSeven.fill('x'.repeat(10_001))
  await page.getByRole('button', { name: '执行审核' }).click()
  await page.getByText('画面描述不能超过 10000 个字符。').waitFor()
  assert.equal(probeRequests.length, 0, 'oversized selected storyboard must be blocked in browser')
  await storyboardSeven.fill(overrideSeven)

  const successfulResponse = page.waitForResponse((response) =>
    response.url() === 'http://127.0.0.1:4175/api/v1/content-moderation/probe' && response.status() === 200,
  )
  await page.getByRole('button', { name: '执行审核' }).click()
  await page.getByRole('button', { name: '审核中' }).waitFor()
  assert(await page.getByRole('button', { name: '审核中' }).isDisabled(), 'probe submit must be disabled in flight')
  await successfulResponse
  await page.getByText('gemini-2.5-flash').waitFor()
  await page.waitForFunction((key) => {
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}')
    return stored.promptLabApiBaseUrl === 'http://127.0.0.1:4175'
  }, configKey)

  assert.equal(probeRequests.length, 1, 'one click must produce one probe request')
  assert.deepEqual(Object.keys(probeRequests[0].body).sort(), [
    'finalSegmentIndexes',
    'previewId',
    'promptOverride',
    'storyboardOverrides',
  ])
  assert.deepEqual(probeRequests[0].body.finalSegmentIndexes, [2, 7])
  assert(!probeRequests[0].body.finalSegmentIndexes.includes(3.5), 'fractional index must not enter payload')
  assert.deepEqual(probeRequests[0].body.storyboardOverrides, [
    { finalSegmentIndex: 2, inputText: overrideTwo },
    { finalSegmentIndex: 7, inputText: overrideSeven },
  ])
  assert(!probeRequests[0].body.storyboardOverrides.some((item) => item.finalSegmentIndex === 4))
  assert.equal(probeRequests[0].body.previewId, 'preview-synthetic-001')
  assert.equal(probeRequests[0].authorization, `Bearer ${syntheticToken}`)
  assert.equal(new URL(probeRequests[0].url).search, '', 'Prompt Lab request must not include query parameters')
  await page.getByLabel('审核结果').getByText(overrideSeven).waitFor()
  await page.getByLabel('审核结果').getByText(overrideTwo).waitFor()

  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert(desktopOverflow <= 1, `desktop horizontal overflow: ${desktopOverflow}`)
  await page.locator('.prompt-lab-segment-list').evaluate((element) => { element.scrollTop = 0 })
  await page.screenshot({ path: path.join(artifactDir, 'STEP3_PROMPT_LAB_DESKTOP.png'), fullPage: true })

  const invalidPromptLabOrigins = [
    'http://synthetic-user@127.0.0.1:4175',
    'http://:synthetic-password@127.0.0.1:4175',
    'http://127.0.0.1:4175/probe',
    'http://127.0.0.1:4175?key=synthetic',
    'http://127.0.0.1:4175#synthetic',
  ]
  for (const invalidOrigin of invalidPromptLabOrigins) {
    const requestCount = probeRequests.length
    const promptRequestCount = promptRequests.length
    await page.getByLabel('Prompt Lab API Base URL').fill(invalidOrigin)
    await page.getByRole('button', { name: '加载授权 Prompt' }).click()
    await page.getByRole('alert').filter({ hasText: '必须是仅包含协议、主机和端口的 origin' }).waitFor()
    await page.waitForTimeout(50)
    const persisted = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), configKey)
    assert.equal(persisted.promptLabApiBaseUrl, 'http://127.0.0.1:4175')
    assert.equal(promptRequests.length, promptRequestCount, `${invalidOrigin} must not request a Prompt`)
    assert.equal(probeRequests.length, requestCount, `${invalidOrigin} must not send a probe`)
  }

  probeMode = 'failure'
  const retainedPrompt = '失败后必须保留的合成候选 Prompt'
  await page.getByLabel('Prompt Lab API Base URL').fill('http://127.0.0.1:4175')
  await page.getByRole('button', { name: '加载授权 Prompt' }).click()
  await page.getByLabel('授权完整 Prompt').fill(retainedPrompt)
  await page.getByRole('button', { name: '执行审核' }).click()
  await page.getByRole('alert').filter({ hasText: '审核依赖暂时不可用' }).waitFor()
  assert.equal(await page.getByLabel('授权完整 Prompt').inputValue(), retainedPrompt)
  assert.equal(await storyboardSeven.inputValue(), overrideSeven)
  assert.equal(await storyboardTwo.inputValue(), overrideTwo)
  assert.equal(await page.locator('.prompt-lab-segment-list input:checked').count(), 2, 'failure must retain selection')

  for (const { mode, port } of corsDenyServers) {
    const rejected = await page.evaluate(async ({ url, token, method }) => {
      try {
        await fetch(url, {
          method,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: '{}',
        })
        return false
      } catch {
        return true
      }
    }, { url: `http://127.0.0.1:${port}/probe`, token: syntheticToken, method: mode === 'method' ? 'PUT' : 'POST' })
    assert(rejected, `missing CORS ${mode} permission must be rejected by the browser`)
  }
  assert.equal(rejectedCorsRequests, 0, 'rejected preflights must not reach the business request handler')

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert(mobileOverflow <= 1, `mobile horizontal overflow: ${mobileOverflow}`)
  await page.locator('.prompt-lab-segment-list').evaluate((element) => { element.scrollTop = 0 })
  await page.screenshot({ path: path.join(artifactDir, 'STEP3_PROMPT_LAB_MOBILE_ERROR.png'), fullPage: true })

  probeMode = 'unavailable'
  await page.goto(`${appUrl}/preview-operations`, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Heykool运营测试台' }).waitFor()
  assert(optionsCount > 0, 'cross-origin requests must perform OPTIONS preflight')

  process.stdout.write(JSON.stringify({
    status: 'PASS',
    probeRequests: probeRequests.length,
    invalidPromptLabOrigins: 5,
    optionsCount,
    desktopOverflow,
    mobileOverflow,
    screenshots: [
      'STEP3_ROOT_DESKTOP.png',
      'STEP3_PROMPT_LAB_DESKTOP.png',
      'STEP3_PROMPT_LAB_MOBILE_ERROR.png',
    ],
  }, null, 2))
} finally {
  await context.close()
  await browser.close()
  await Promise.all([close(picServer), close(labServer), ...corsDenyServers.map(({ server }) => close(server))])
}
