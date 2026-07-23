import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  boomclipApi,
  deriveAuthBaseUrl,
  loadWorkbenchConfig,
  persistWorkbenchConfig,
  serviceOrigin,
} from '../api'
import { CONTENT_MODERATION_BASELINE_PROMPT } from '../contentModerationBaselinePrompt'
import type {
  ModerationProbeErrorData,
  ModerationProbeResponse,
  PreviewDetail,
  PreviewFinalSegment,
  PreviewTaskListItem,
  WorkbenchConfig,
} from '../types'
import '../App.css'
import './ContentAuditPromptDebugPage.css'

type AuditableSegment = PreviewFinalSegment & {
  finalSegmentIndex: number
  aiVideoPrompt: string
}

const ERROR_MESSAGES: Record<string, string> = {
  moderation_probe_invalid_request: '请求内容不符合审核探针约束，请检查 Prompt 和分镜选择。',
  moderation_probe_unauthorized: '身份凭据无效，请更新 Bearer Token 后重试。',
  moderation_probe_forbidden: '当前账号没有内容审核探针权限。',
  preview_not_found: 'Preview 不存在或当前账号无权访问。',
  moderation_probe_busy: '当前账号已有审核请求在执行，请稍后重试。',
  moderation_probe_invalid_provider_response: '审核服务返回了无法识别的结果，请稍后重试。',
  moderation_probe_upstream_unavailable: '审核依赖暂时不可用，请稍后重试。',
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function auditableSegments(preview?: PreviewDetail | null): AuditableSegment[] {
  if (!preview) return []
  return (preview.finalSegments ?? []).flatMap((segment) => {
    const prompt = typeof segment.aiVideoPrompt === 'string' ? segment.aiVideoPrompt.trim() : ''
    if (segment.executionSource !== 'ai_video' || !isNonNegativeInteger(segment.finalSegmentIndex) || !prompt) return []
    return [{ ...segment, finalSegmentIndex: segment.finalSegmentIndex, aiVideoPrompt: prompt }]
  })
}

function invalidAuditableSegmentIndexCount(preview?: PreviewDetail | null): number {
  if (!preview) return 0
  return (preview.finalSegments ?? []).reduce((count, segment) => {
    const prompt = typeof segment.aiVideoPrompt === 'string' ? segment.aiVideoPrompt.trim() : ''
    if (segment.executionSource !== 'ai_video' || !prompt || isNonNegativeInteger(segment.finalSegmentIndex)) return count
    return count + 1
  }, 0)
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    queued: '排队中',
    processing: '处理中',
    completed: '已完成',
    partial_failed: '部分失败',
    failed: '失败',
    ready: '可用',
  }
  return labels[status] ?? status
}

function dateLabel(value?: string | null) {
  if (!value) return '时间未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function apiErrorCode(error: unknown) {
  const payload = (error as { payload?: { code?: number | string; data?: ModerationProbeErrorData } }).payload
  return {
    code: Number(payload?.code),
    errorCode: payload?.data?.errorCode,
  }
}

function safeErrorMessage(error: unknown, fallback: string) {
  const { code, errorCode } = apiErrorCode(error)
  if (errorCode && ERROR_MESSAGES[errorCode]) return ERROR_MESSAGES[errorCode]
  if (code === 401) return '身份凭据无效，请更新 Bearer Token 后重试。'
  if (code === 403) return '当前账号没有访问权限。'
  if (code === 404) return '请求的数据不存在或当前账号无权访问。'
  if (error instanceof TypeError) return '服务连接失败，请检查 API 地址和服务状态。'
  return fallback
}

function ContentAuditPromptDebugPage() {
  const [config, setConfig] = useState<WorkbenchConfig>(loadWorkbenchConfig)
  const [promptLabApiBaseUrlDraft, setPromptLabApiBaseUrlDraft] = useState(config.promptLabApiBaseUrl)
  const [tasks, setTasks] = useState<PreviewTaskListItem[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [previews, setPreviews] = useState<PreviewDetail[]>([])
  const [selectedPreviewId, setSelectedPreviewId] = useState('')
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set())
  const [storyboardDrafts, setStoryboardDrafts] = useState<Record<string, Record<number, string>>>({})
  const [storyboardErrors, setStoryboardErrors] = useState<Record<string, Record<number, string>>>({})
  const [promptOverride, setPromptOverride] = useState(CONTENT_MODERATION_BASELINE_PROMPT)
  const [result, setResult] = useState<ModerationProbeResponse | null>(null)
  const [error, setError] = useState('')
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [loadingPreviews, setLoadingPreviews] = useState(false)
  const [probing, setProbing] = useState(false)
  const probeInFlight = useRef(false)

  const selectedPreview = previews.find((preview) => preview.previewId === selectedPreviewId) ?? null
  const segments = useMemo(() => auditableSegments(selectedPreview), [selectedPreview])
  const invalidSegmentIndexCount = useMemo(
    () => invalidAuditableSegmentIndexCount(selectedPreview),
    [selectedPreview],
  )
  const allSelected = segments.length > 0 && segments.every((segment) => selectedIndexes.has(segment.finalSegmentIndex))

  useEffect(() => {
    persistWorkbenchConfig(config)
  }, [config])

  useEffect(() => {
    document.title = '内容审核 Prompt 调试台'
    document.body.classList.add('prompt-lab-body')
    return () => document.body.classList.remove('prompt-lab-body')
  }, [])

  function updateConfig(partial: Partial<WorkbenchConfig>) {
    setConfig((current) => ({ ...current, ...partial }))
  }

  function selectPreview(preview: PreviewDetail) {
    setSelectedPreviewId(preview.previewId)
    setSelectedIndexes(new Set(
      auditableSegments(preview).map((segment) => segment.finalSegmentIndex),
    ))
    setResult(null)
    setError('')
  }

  async function loadPreviews(taskId: string, runConfig: WorkbenchConfig = config) {
    setSelectedTaskId(taskId)
    setLoadingPreviews(true)
    setError('')
    setResult(null)
    try {
      const loaded = await boomclipApi.getPreviewTaskPreviews(runConfig, taskId)
      setPreviews(loaded)
      const firstAuditable = loaded.find((preview) => auditableSegments(preview).length > 0) ?? loaded[0]
      if (firstAuditable) selectPreview(firstAuditable)
      else {
        setSelectedPreviewId('')
        setSelectedIndexes(new Set())
      }
    } catch (loadError) {
      setPreviews([])
      setSelectedPreviewId('')
      setSelectedIndexes(new Set())
      setError(safeErrorMessage(loadError, 'Preview 组详情加载失败，请稍后重试。'))
    } finally {
      setLoadingPreviews(false)
    }
  }

  async function loadTasks() {
    if (!config.token.trim()) {
      setTasks([])
      setPreviews([])
      setSelectedTaskId('')
      setSelectedPreviewId('')
      setSelectedIndexes(new Set())
      setError('请先填写 Bearer Token。')
      return
    }
    setLoadingTasks(true)
    setError('')
    try {
      const response = await boomclipApi.getPreviewTasks(config, { page: 1, pageSize: 20 })
      const loaded = response.tasks ?? []
      setTasks(loaded)
      const nextTaskId = loaded.some((task) => task.taskId === selectedTaskId) ? selectedTaskId : (loaded[0]?.taskId ?? '')
      if (nextTaskId) await loadPreviews(nextTaskId)
      else {
        setPreviews([])
        setSelectedPreviewId('')
      }
    } catch (loadError) {
      setTasks([])
      setPreviews([])
      setSelectedTaskId('')
      setSelectedPreviewId('')
      setSelectedIndexes(new Set())
      setError(safeErrorMessage(loadError, 'Preview 任务加载失败，请稍后重试。'))
    } finally {
      setLoadingTasks(false)
    }
  }

  function toggleSegment(index: number) {
    setSelectedIndexes((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function toggleAllSegments() {
    setSelectedIndexes(allSelected ? new Set() : new Set(segments.map((segment) => segment.finalSegmentIndex)))
  }

  function updateStoryboardDraft(previewId: string, finalSegmentIndex: number, value: string) {
    setStoryboardDrafts((current) => ({
      ...current,
      [previewId]: {
        ...(current[previewId] ?? {}),
        [finalSegmentIndex]: value,
      },
    }))
    setStoryboardErrors((current) => {
      if (!current[previewId]?.[finalSegmentIndex]) return current
      const previewErrors = { ...current[previewId] }
      delete previewErrors[finalSegmentIndex]
      return { ...current, [previewId]: previewErrors }
    })
  }

  async function submitProbe(event: FormEvent) {
    event.preventDefault()
    if (probeInFlight.current) return
    if (!config.token.trim()) {
      setError('请先填写 Bearer Token。')
      return
    }
    if (!selectedPreview || selectedIndexes.size === 0) {
      setError('请选择 Preview 和至少一条 AI 视频分镜。')
      return
    }
    const prompt = promptOverride.trim()
    if (!prompt || prompt.length > 50000) {
      setError('候选 Prompt 不能为空且不能超过 50000 个字符。')
      return
    }

    const selectedSegmentByIndex = new Map(
      segments.map((segment) => [segment.finalSegmentIndex, segment]),
    )
    const finalSegmentIndexes = [...selectedIndexes].sort((left, right) => left - right)
    const nextStoryboardErrors: Record<number, string> = {}
    const storyboardOverrides = finalSegmentIndexes.flatMap((finalSegmentIndex) => {
      const segment = selectedSegmentByIndex.get(finalSegmentIndex)
      if (!segment) {
        nextStoryboardErrors[finalSegmentIndex] = '该分镜已不可审核，请重新加载 Preview。'
        return []
      }
      const inputText = (
        storyboardDrafts[selectedPreview.previewId]?.[finalSegmentIndex] ?? segment.aiVideoPrompt
      ).trim()
      if (!inputText) {
        nextStoryboardErrors[finalSegmentIndex] = '画面描述不能为空。'
        return []
      }
      if (inputText.length > 10_000) {
        nextStoryboardErrors[finalSegmentIndex] = '画面描述不能超过 10000 个字符。'
        return []
      }
      return [{ finalSegmentIndex, inputText }]
    })
    if (Object.keys(nextStoryboardErrors).length > 0) {
      setStoryboardErrors((current) => ({
        ...current,
        [selectedPreview.previewId]: nextStoryboardErrors,
      }))
      setError('请修正标记的画面描述后再执行审核。')
      return
    }
    setStoryboardErrors((current) => ({
      ...current,
      [selectedPreview.previewId]: {},
    }))
    let promptLabApiBaseUrl: string
    try {
      promptLabApiBaseUrl = serviceOrigin(promptLabApiBaseUrlDraft)
    } catch {
      setError('Prompt Lab API 地址必须是仅包含协议、主机和端口的 origin。')
      return
    }

    const validatedConfig = { ...config, promptLabApiBaseUrl }
    setPromptLabApiBaseUrlDraft(promptLabApiBaseUrl)
    setConfig(validatedConfig)

    probeInFlight.current = true
    setProbing(true)
    setError('')
    setResult(null)
    try {
      const response = await boomclipApi.probeContentModeration(validatedConfig, {
        previewId: selectedPreview.previewId,
        finalSegmentIndexes,
        promptOverride: prompt,
        storyboardOverrides,
      })
      setResult(response)
    } catch (probeError) {
      setError(safeErrorMessage(probeError, '审核请求失败，请稍后重试。'))
    } finally {
      probeInFlight.current = false
      setProbing(false)
    }
  }

  return (
    <main className="prompt-lab-shell">
      <header className="prompt-lab-header">
        <div>
          <p className="eyebrow">OPERATIONS / CONTENT AUDIT</p>
          <h1>内容审核 Prompt 调试台</h1>
        </div>
        <a className="prompt-lab-back-link" href="/preview-operations">打开 Preview 运营测试台</a>
      </header>

      <section className="prompt-lab-config" aria-label="连接配置">
        <label>
          Pic API Base URL
          <input value={config.apiBaseUrl} onChange={(event) => updateConfig({ apiBaseUrl: event.target.value })} />
        </label>
        <label>
          Auth Base URL
          <div className="prompt-lab-inline-field">
            <input value={config.authBaseUrl} onChange={(event) => updateConfig({ authBaseUrl: event.target.value })} />
            <button type="button" onClick={() => updateConfig({ authBaseUrl: deriveAuthBaseUrl(config.apiBaseUrl) })}>推导</button>
          </div>
        </label>
        <label>
          Prompt Lab API Base URL
          <input
            aria-label="Prompt Lab API Base URL"
            value={promptLabApiBaseUrlDraft}
            onChange={(event) => setPromptLabApiBaseUrlDraft(event.target.value)}
          />
        </label>
        <label className="prompt-lab-token-field">
          Bearer Token
          <input
            aria-label="Bearer Token"
            type="password"
            autoComplete="off"
            value={config.token}
            onChange={(event) => updateConfig({ token: event.target.value })}
          />
        </label>
        <label className="prompt-lab-dev-toggle">
          <input
            type="checkbox"
            checked={config.devPreviewFields}
            onChange={(event) => updateConfig({ devPreviewFields: event.target.checked })}
          />
          Preview 详情追加 ?dev=1
        </label>
      </section>

      {error && <div className="prompt-lab-error" role="alert">{error}</div>}

      <div className="prompt-lab-workspace">
        <aside className="prompt-lab-task-column" aria-label="Preview 任务">
          <div className="prompt-lab-section-head">
            <div>
              <span>最近任务</span>
              <strong>{tasks.length}</strong>
            </div>
            <button type="button" disabled={loadingTasks || probing} onClick={() => void loadTasks()}>
              {loadingTasks ? '加载中' : '刷新'}
            </button>
          </div>
          <div className="prompt-lab-task-list">
            {tasks.map((task) => (
              <button
                className={task.taskId === selectedTaskId ? 'is-active' : ''}
                type="button"
                key={task.taskId}
                disabled={loadingPreviews || probing}
                onClick={() => void loadPreviews(task.taskId)}
              >
                <span>{statusLabel(task.status)}</span>
                <strong>{task.taskId}</strong>
                <small>{dateLabel(task.createdAt)} · {task.completedCount}/{task.scriptCount}</small>
              </button>
            ))}
            {!tasks.length && <p className="prompt-lab-empty">暂无 Preview 任务</p>}
          </div>
        </aside>

        <form className="prompt-lab-editor" onSubmit={submitProbe}>
          <section className="prompt-lab-preview-section">
            <div className="prompt-lab-section-head">
              <div>
                <span>Preview 组详情</span>
                <strong>{previews.length}</strong>
              </div>
              <button
                type="button"
                disabled={!selectedTaskId || loadingPreviews || probing}
                onClick={() => void loadPreviews(selectedTaskId)}
              >
                {loadingPreviews ? '加载中' : '重载详情'}
              </button>
            </div>
            <div className="prompt-lab-preview-tabs" role="tablist" aria-label="Preview 列表">
              {previews.map((preview, index) => (
                <button
                  className={preview.previewId === selectedPreviewId ? 'is-active' : ''}
                  type="button"
                  role="tab"
                  aria-selected={preview.previewId === selectedPreviewId}
                  key={preview.previewId}
                  disabled={probing}
                  onClick={() => selectPreview(preview)}
                >
                  <span>#{index + 1}</span>
                  <strong>{preview.gameName || preview.previewId}</strong>
                  <small>{statusLabel(preview.status)}</small>
                </button>
              ))}
              {!previews.length && <p className="prompt-lab-empty">选择任务后加载 Preview</p>}
            </div>
          </section>

          <section className="prompt-lab-segment-section">
            <div className="prompt-lab-section-head">
              <div>
                <span>AI 视频分镜</span>
                <strong>{selectedIndexes.size}/{segments.length}</strong>
              </div>
              <button type="button" disabled={!segments.length || probing} onClick={toggleAllSegments}>
                {allSelected ? '取消全选' : '全选'}
              </button>
            </div>
            {invalidSegmentIndexCount > 0 && (
              <p className="prompt-lab-segment-warning" role="status">
                检测到 {invalidSegmentIndexCount} 条旧版异常分镜索引，已跳过；请重新生成 Preview 后测试。
              </p>
            )}
            <div className="prompt-lab-segment-list">
              {segments.map((segment) => {
                const draft = storyboardDrafts[selectedPreviewId]?.[segment.finalSegmentIndex] ?? segment.aiVideoPrompt
                const segmentError = storyboardErrors[selectedPreviewId]?.[segment.finalSegmentIndex]
                return (
                  <article
                    className={`prompt-lab-segment-card ${selectedIndexes.has(segment.finalSegmentIndex) ? 'is-selected' : ''} ${segmentError ? 'has-error' : ''}`}
                    key={segment.finalSegmentIndex}
                  >
                    <div className="prompt-lab-segment-head">
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedIndexes.has(segment.finalSegmentIndex)}
                          disabled={probing}
                          onChange={() => toggleSegment(segment.finalSegmentIndex)}
                        />
                        <span>#{segment.finalSegmentIndex}</span>
                      </label>
                      <button
                        type="button"
                        aria-label={`恢复分镜 #${segment.finalSegmentIndex} 原文`}
                        disabled={probing || draft === segment.aiVideoPrompt}
                        onClick={() => updateStoryboardDraft(
                          selectedPreviewId,
                          segment.finalSegmentIndex,
                          segment.aiVideoPrompt,
                        )}
                      >
                        恢复原文
                      </button>
                    </div>
                    <textarea
                      aria-label={`分镜 #${segment.finalSegmentIndex} 画面描述`}
                      rows={3}
                      value={draft}
                      disabled={probing}
                      onChange={(event) => updateStoryboardDraft(
                        selectedPreviewId,
                        segment.finalSegmentIndex,
                        event.target.value,
                      )}
                    />
                    <div className="prompt-lab-segment-footer">
                      <small>{draft.length}/10000</small>
                      {segmentError && <p>{segmentError}</p>}
                    </div>
                  </article>
                )
              })}
              {selectedPreview && !segments.length && <p className="prompt-lab-empty">此 Preview 没有可审核的 AI 视频分镜</p>}
            </div>
          </section>

          <section className="prompt-lab-prompt-section">
            <div className="prompt-lab-prompt-head">
              <label htmlFor="content-moderation-prompt">候选完整 Prompt</label>
              <button
                type="button"
                disabled={probing || promptOverride === CONTENT_MODERATION_BASELINE_PROMPT}
                onClick={() => setPromptOverride(CONTENT_MODERATION_BASELINE_PROMPT)}
              >
                恢复基准 Prompt
              </button>
            </div>
            <textarea
              id="content-moderation-prompt"
              aria-label="候选完整 Prompt"
              maxLength={50000}
              value={promptOverride}
              disabled={probing}
              onChange={(event) => setPromptOverride(event.target.value)}
            />
            <div className="prompt-lab-submit-row">
              <span>{promptOverride.length}/50000</span>
              <button className="prompt-lab-submit" type="submit" disabled={probing}>
                {probing ? '审核中' : '执行审核'}
              </button>
            </div>
          </section>
        </form>

        <aside className="prompt-lab-result-column" aria-label="审核结果">
          <div className="prompt-lab-section-head">
            <div>
              <span>审核结果</span>
              <strong>{result?.results.length ?? 0}</strong>
            </div>
          </div>
          {!result && <p className="prompt-lab-empty">提交后显示本次审核结果</p>}
          {result && (
            <div className="prompt-lab-results">
              <dl className="prompt-lab-result-meta">
                <div><dt>Provider</dt><dd>{result.provider}</dd></div>
                <div><dt>Model</dt><dd>{result.model}</dd></div>
                <div><dt>耗时</dt><dd>{result.latencyMs} ms</dd></div>
                <div><dt>Token</dt><dd>{result.tokenUsage.totalTokens}</dd></div>
                <div><dt>输入 / 输出</dt><dd>{result.tokenUsage.inputTokens} / {result.tokenUsage.outputTokens}</dd></div>
                <div><dt>Usage 来源</dt><dd>{result.tokenUsage.source}</dd></div>
              </dl>
              {result.warnings.length > 0 && (
                <div className="prompt-lab-warnings">
                  <strong>Warnings</strong>
                  {result.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                </div>
              )}
              <div className="prompt-lab-result-list">
                {result.results.map((item) => (
                  <article className={item.passed ? 'is-passed' : 'is-rejected'} key={item.finalSegmentIndex}>
                    <header><strong>#{item.finalSegmentIndex}</strong><span>{item.passed ? '通过' : '拒绝'}</span></header>
                    <p>{item.inputText}</p>
                    {!item.passed && <small>{item.reason}</small>}
                  </article>
                ))}
              </div>
              <details className="prompt-lab-raw-text">
                <summary>成功原始响应</summary>
                <pre>{result.rawText}</pre>
              </details>
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}

export default ContentAuditPromptDebugPage
