import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { boomclipApi } from './api'
import type {
  AiVideoProvider,
  AiVideoPromptFailure,
  DomainCategory,
  GeneratePreviewRequest,
  HotScriptVideoItem,
  PreviewDetail,
  PreviewFinalSegment,
  PreviewTaskListItem,
  PreviewTaskMessage,
  PreviewTaskStatus,
  Project,
  Template,
  TimelineEvent,
  VideoTaskMessage,
  VideoTaskStatus,
  WorkbenchConfig,
} from './types'
import './App.css'

type RuntimeConfig = Partial<{
  VITE_BOOMCLIP_API_BASE_URL: string
  VITE_BOOMCLIP_AUTH_BASE_URL: string
  VITE_BOOMCLIP_LOGIN_PHONE: string
  VITE_PREVIEW_DEV_MODE: string
}>

declare global {
  interface Window {
    __HEYKOOL_RUNTIME_CONFIG__?: RuntimeConfig
  }
}

const CONFIG_KEY = 'boomclip.hotScriptBatch.config'
const TERMINAL_PREVIEW_STATES: PreviewTaskStatus[] = ['completed', 'partial_failed', 'failed']
const TERMINAL_VIDEO_STATES: VideoTaskStatus[] = ['completed', 'partial_failed', 'failed']
const remoteApiBaseUrl = 'http://boomclip.heykoolai.com:8513'
const remoteAuthBaseUrl = 'http://boomclip.heykoolai.com:8512'
const localApiBaseUrl = 'http://localhost:8001'
const localAuthBaseUrl = 'http://localhost:8200'
const runtimeConfig: RuntimeConfig = typeof window === 'undefined' ? {} : (window.__HEYKOOL_RUNTIME_CONFIG__ ?? {})
const defaultApiBaseUrl =
  runtimeConfig.VITE_BOOMCLIP_API_BASE_URL ?? import.meta.env.VITE_BOOMCLIP_API_BASE_URL ?? remoteApiBaseUrl
const defaultAuthBaseUrl =
  runtimeConfig.VITE_BOOMCLIP_AUTH_BASE_URL ??
  import.meta.env.VITE_BOOMCLIP_AUTH_BASE_URL ??
  deriveAuthBaseUrl(defaultApiBaseUrl)
const defaultLoginPhone =
  runtimeConfig.VITE_BOOMCLIP_LOGIN_PHONE ?? import.meta.env.VITE_BOOMCLIP_LOGIN_PHONE ?? '13800138000'
const defaultPreviewDevMode = (runtimeConfig.VITE_PREVIEW_DEV_MODE ?? import.meta.env.VITE_PREVIEW_DEV_MODE) === 'true'
const previousDefaultApiBaseUrl = 'http://localhost:8001'
const previousDefaultAuthBaseUrl = 'http://localhost:8200'

function deriveAuthBaseUrl(apiBaseUrl: string) {
  if (apiBaseUrl.includes('localhost:8001')) return apiBaseUrl.replace('localhost:8001', localAuthBaseUrl.replace('http://', ''))
  if (apiBaseUrl.includes('127.0.0.1:8001')) return apiBaseUrl.replace('127.0.0.1:8001', '127.0.0.1:8200')
  if (apiBaseUrl.includes('boomclip.heykoolai.com:8513')) {
    return apiBaseUrl.replace('boomclip.heykoolai.com:8513', remoteAuthBaseUrl.replace('http://', ''))
  }
  return apiBaseUrl
}

type PreviewJob = {
  localId: string
  taskId: string
  submitStatus: 'submitting' | 'accepted' | 'failed'
  message: PreviewTaskMessage | null
  videoTask: VideoTaskMessage | null
  previews: PreviewDetail[]
  selectedPreviewIds: Set<string>
  bgmChoices: Record<string, boolean>
  retryMode: boolean
  request: GeneratePreviewRequest
  projectName: string
  templateName: string
  categoryName: string
  apiBaseUrl: string
  createdAt: string
  events: TimelineEvent[]
}

const defaultConfig: WorkbenchConfig = {
  apiBaseUrl: defaultApiBaseUrl,
  authBaseUrl: defaultAuthBaseUrl,
  token: '',
  devPreviewFields: defaultPreviewDevMode,
}

function loadConfig(): WorkbenchConfig {
  const raw = localStorage.getItem(CONFIG_KEY)
  if (!raw) return defaultConfig
  try {
    const stored = { ...defaultConfig, ...JSON.parse(raw) } as WorkbenchConfig
    if (stored.apiBaseUrl === previousDefaultApiBaseUrl) {
      stored.apiBaseUrl = defaultConfig.apiBaseUrl
    }
    if (stored.authBaseUrl === previousDefaultAuthBaseUrl) {
      stored.authBaseUrl = defaultConfig.authBaseUrl
    }
    return stored
  } catch {
    return defaultConfig
  }
}

function eventId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function nowLabel() {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date())
}

function toMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function apiErrorDetail(error: unknown) {
  const payload = (error as { payload?: { data?: Record<string, unknown>; message?: string | string[] } })
    ?.payload
  const data = payload?.data
  if (!data) return undefined
  return Object.entries(data)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(' / ')
}

function apiErrorMessage(error: unknown) {
  const payload = (error as { payload?: { data?: Record<string, unknown>; message?: string | string[] } })
    ?.payload
  const message = payload?.message
  if (Array.isArray(message) && message.length > 0) return message.join('；')
  if (typeof message === 'string' && message.trim()) return message
  if (payload?.data?.errorCode === 'ai_video_prompt_edit_rate_limited') return '操作过于频繁，请稍后再试'
  return toMessage(error)
}

function aiVideoPromptFailures(error: unknown): AiVideoPromptFailure[] {
  const payload = (error as { payload?: { data?: { failures?: unknown } } }).payload
  const failures = payload?.data?.failures
  if (!Array.isArray(failures)) return []

  return failures.flatMap((failure) => {
    if (!failure || typeof failure !== 'object') return []
    const item = failure as Record<string, unknown>
    if (typeof item.finalSegmentIndex !== 'number' || typeof item.reason !== 'string') return []
    return [
      {
        finalSegmentIndex: item.finalSegmentIndex,
        reason: item.reason,
        reasonCode: typeof item.reasonCode === 'string' ? item.reasonCode : undefined,
      },
    ]
  })
}

function templateThumb(template?: Template | null) {
  return template?.thumbnailUrl ?? template?.thumbnail_url ?? ''
}

function templatePreviewUrl(template?: Template | null) {
  return template?.previewUrl ?? template?.preview_url ?? ''
}

function isPreviewInitialExecutable(preview: PreviewDetail) {
  return preview.status === 'ready' && preview.latestExecutionStatus === 'idle'
}

function isPreviewRetryExecutable(preview: PreviewDetail) {
  return preview.status === 'ready' && preview.latestExecutionStatus === 'failed'
}

function statusLabel(status?: string) {
  const labels: Record<string, string> = {
    queued: '排队中',
    processing: '生成中',
    completed: '已完成',
    partial_failed: '部分失败',
    failed: '失败',
    ready: '可生成',
    idle: '待执行',
    expired: '已过期',
    consumed: '已使用',
  }
  return status ? labels[status] ?? status : '未开始'
}

function segmentText(preview: PreviewDetail) {
  const segments = preview.finalSegments ?? []
  return segments
    .slice(0, 4)
    .map((segment, index) => {
      const dialogue = segment.dialogueTts ?? segment.dialogue ?? segment.storyboard ?? '无口播文本'
      return `${index + 1}. ${String(dialogue)}`
    })
    .join('\n')
}

function textValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function segmentIndex(segment: PreviewFinalSegment, fallback: number) {
  return typeof segment.finalSegmentIndex === 'number' ? segment.finalSegmentIndex : fallback
}

function aiVideoPromptValue(segment: PreviewFinalSegment) {
  return textValue(segment.aiVideoPrompt)
}

function segmentAiVideoPromptText(preview: PreviewDetail) {
  const segments = preview.finalSegments ?? []
  return segments
    .slice(0, 4)
    .map((segment, index) => {
      const prompt = aiVideoPromptValue(segment)
      return prompt ? `${segmentIndex(segment, index)}. ${prompt}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function editableAiVideoSegments(preview: PreviewDetail) {
  if (preview.status !== 'ready' || preview.latestExecutionStatus !== 'idle') return []
  return (preview.finalSegments ?? []).filter(
    (segment) => segment.executionSource === 'ai_video' && aiVideoPromptValue(segment),
  )
}

function aiVideoPromptDraftFromPreview(preview: PreviewDetail) {
  const draft: Record<number, string> = {}
  for (const [fallbackIndex, segment] of (preview.finalSegments ?? []).entries()) {
    if (segment.executionSource !== 'ai_video') continue
    draft[segmentIndex(segment, fallbackIndex)] = aiVideoPromptValue(segment)
  }
  return draft
}

function isProductionApi(url: string) {
  return /api\.boomclip\.heykoolai\.com|boomclip\.heykoolai\.com:8513/i.test(url)
}

function previewTaskDetail(message: PreviewTaskMessage) {
  return [
    `进度 ${message.progress ?? 0}%`,
    `成功 ${message.completedCount ?? 0}`,
    `失败 ${message.failedCount ?? 0}`,
    message.errorCode ? `错误码 ${message.errorCode}` : '',
    message.userMessage ? `提示 ${message.userMessage}` : '',
  ]
    .filter(Boolean)
    .join(' / ')
}

function scriptFailureSummary(failures: VideoTaskMessage['scriptFailures']) {
  if (!failures?.length) return ''
  return failures
    .map((failure) =>
      [
        `脚本#${failure.scriptIndex ?? '?'}`,
        failure.phase ? `阶段 ${failure.phase}` : '',
        failure.errorCode ? `错误码 ${failure.errorCode}` : '',
        failure.userMessage ? `提示 ${failure.userMessage}` : '',
      ]
        .filter(Boolean)
        .join(' / '),
    )
    .join('；')
}

function videoTaskDetail(message: VideoTaskMessage) {
  return [
    `进度 ${message.progress ?? 0}%`,
    `成功 ${message.completedCount ?? 0}`,
    `失败 ${message.failedCount ?? 0}`,
    message.errorCode ? `错误码 ${message.errorCode}` : '',
    message.userMessage ? `提示 ${message.userMessage}` : '',
    scriptFailureSummary(message.scriptFailures),
  ]
    .filter(Boolean)
    .join(' / ')
}

function formatDateLabel(value?: string | null) {
  if (!value) return '未知时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function videoDisplayTitle(video: HotScriptVideoItem) {
  return video.scriptTitle || video.previewId || (video.videoId ? `视频 #${video.videoId}` : '视频生成占位')
}

function formatConfidence(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return ''
  return `匹配度 ${Math.round(value * 100)}%`
}

function App() {
  const [config, setConfig] = useState<WorkbenchConfig>(loadConfig)
  const [projects, setProjects] = useState<Project[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [providers, setProviders] = useState<AiVideoProvider[]>([])
  const [categories, setCategories] = useState<DomainCategory[]>([])
  const [videos, setVideos] = useState<HotScriptVideoItem[]>([])
  const [projectTotal, setProjectTotal] = useState(0)
  const [templateTotal, setTemplateTotal] = useState(0)
  const [videoTotal, setVideoTotal] = useState(0)
  const [projectSearch, setProjectSearch] = useState('')
  const [templateSearch, setTemplateSearch] = useState('')
  const deferredProjectSearch = useDeferredValue(projectSearch)
  const deferredTemplateSearch = useDeferredValue(templateSearch)
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null)
  const [gameName, setGameName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [scriptCount, setScriptCount] = useState(1)
  const [durationMin, setDurationMin] = useState('')
  const [durationMax, setDurationMax] = useState('')
  const [aiProvider, setAiProvider] = useState('')
  const [loginPhone, setLoginPhone] = useState(defaultLoginPhone)
  const [loginPassword, setLoginPassword] = useState(import.meta.env.VITE_BOOMCLIP_LOGIN_PASSWORD ?? '')
  const [loggingIn, setLoggingIn] = useState(false)
  const [previewJobs, setPreviewJobs] = useState<PreviewJob[]>([])
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [allowProductionWrites, setAllowProductionWrites] = useState(false)
  const [submittingPreview, setSubmittingPreview] = useState(false)
  const [submittingVideoJobId, setSubmittingVideoJobId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingPreviewTasks, setLoadingPreviewTasks] = useState(false)
  const [loadingVideos, setLoadingVideos] = useState(false)
  const [aiVideoPromptDrafts, setAiVideoPromptDrafts] = useState<Record<string, Record<number, string>>>({})
  const [aiVideoPromptErrors, setAiVideoPromptErrors] = useState<Record<string, Record<number, AiVideoPromptFailure>>>({})
  const [aiVideoPromptPreviewErrors, setAiVideoPromptPreviewErrors] = useState<Record<string, string>>({})
  const [savingPromptPreviewId, setSavingPromptPreviewId] = useState<string | null>(null)
  const [globalEvents, setGlobalEvents] = useState<TimelineEvent[]>([])
  const previewStreamsRef = useRef<Record<string, AbortController>>({})
  const videoStreamsRef = useRef<Record<string, AbortController>>({})

  const selectedProject = projects.find((project) => project.projectId === selectedProjectId) ?? null
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null
  const filteredProjects = projects.filter((project) =>
    project.projectName.toLowerCase().includes(deferredProjectSearch.toLowerCase()),
  )
  const filteredTemplates = templates.filter((template) =>
    template.name.toLowerCase().includes(deferredTemplateSearch.toLowerCase()),
  )
  const activeJob = previewJobs.find((job) => job.localId === activeJobId) ?? previewJobs[0] ?? null
  const selectedPreviewCount = activeJob?.selectedPreviewIds.size ?? 0
  const productionApi = isProductionApi(config.apiBaseUrl)
  const usingRemoteEnvironment =
    config.apiBaseUrl === remoteApiBaseUrl && config.authBaseUrl === remoteAuthBaseUrl
  const previewProgress = activeJob?.message?.progress ?? 0
  const videoProgress = activeJob?.videoTask?.progress ?? 0
  const activeVideoRunning = Boolean(
    activeJob?.videoTask?.status && !TERMINAL_VIDEO_STATES.includes(activeJob.videoTask.status),
  )
  const visibleEvents = activeJob?.events ?? globalEvents
  const activeVideoTaskIds = Array.from(
    new Set(
      previewJobs
        .map((job) => job.videoTask?.taskId)
        .filter((taskId): taskId is string => Boolean(taskId)),
    ),
  ).slice(0, 20)
  const canSubmitPreview =
    Boolean(config.token.trim()) &&
    Boolean(selectedProjectId) &&
    Boolean(selectedTemplateId) &&
    Boolean(gameName.trim()) &&
    Number(categoryId) > 0 &&
    (!productionApi || allowProductionWrites) &&
    !submittingPreview
  const canSubmitVideos =
    Boolean(activeJob?.taskId) &&
    selectedPreviewCount > 0 &&
    (!productionApi || allowProductionWrites) &&
    !activeVideoRunning &&
    submittingVideoJobId !== activeJob?.localId

  useEffect(() => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  }, [config])

  useEffect(() => {
    const previewStreams = previewStreamsRef.current
    const videoStreams = videoStreamsRef.current
    return () => {
      Object.values(previewStreams).forEach((controller) => controller.abort())
      Object.values(videoStreams).forEach((controller) => controller.abort())
    }
  }, [])

  function addEvent(title: string, detail: string | undefined, tone: TimelineEvent['tone'] = 'info') {
    setGlobalEvents((items) => [
      {
        id: eventId(),
        at: nowLabel(),
        title,
        detail,
        tone,
      },
      ...items,
    ])
  }

  function updateJob(localId: string, updater: (job: PreviewJob) => PreviewJob) {
    setPreviewJobs((items) => items.map((job) => (job.localId === localId ? updater(job) : job)))
  }

  function addJobEvent(
    localId: string,
    title: string,
    detail: string | undefined,
    tone: TimelineEvent['tone'] = 'info',
  ) {
    updateJob(localId, (job) => ({
      ...job,
      events: [
        {
          id: eventId(),
          at: nowLabel(),
          title,
          detail,
          tone,
        },
        ...job.events,
      ],
    }))
  }

  function projectNameFor(projectId: number) {
    return projects.find((project) => project.projectId === projectId)?.projectName ?? `Project #${projectId}`
  }

  function templateNameFor(templateId: number) {
    return templates.find((template) => template.id === templateId)?.name ?? `Template #${templateId}`
  }

  function previewTaskToJob(task: PreviewTaskListItem): PreviewJob {
    const createdAt = task.createdAt ? formatDateLabel(task.createdAt) : nowLabel()
    return {
      localId: task.taskId,
      taskId: task.taskId,
      submitStatus: 'accepted',
      message: {
        taskId: task.taskId,
        taskType: 'preview_generate',
        status: task.status,
        progress: task.progress,
        scriptCount: task.scriptCount,
        completedCount: task.completedCount,
        failedCount: task.failedCount,
        errorCode: task.errorCode ?? undefined,
        userMessage: task.userMessage ?? task.errorMessage ?? undefined,
      },
      videoTask: null,
      previews: [],
      selectedPreviewIds: new Set(),
      bgmChoices: {},
      retryMode: false,
      request: {
        projectId: task.projectId,
        templateId: task.templateId,
        gameName: projectNameFor(task.projectId),
        categoryId: 0,
        scriptCount: task.scriptCount,
      },
      projectName: projectNameFor(task.projectId),
      templateName: templateNameFor(task.templateId),
      categoryName: '历史任务',
      apiBaseUrl: config.apiBaseUrl,
      createdAt,
      events: [
        {
          id: eventId(),
          at: nowLabel(),
          title: '从后端任务列表恢复',
          detail: `projectId=${task.projectId} / templateId=${task.templateId}`,
          tone: 'info',
        },
      ],
    }
  }

  async function loadPreviewTasks(runConfig: WorkbenchConfig = config, options: { silent?: boolean } = {}) {
    if (!runConfig.token.trim()) {
      if (!options.silent) addEvent('缺少 token', '请先登录或填入 Bearer token，再刷新脚本任务列表。', 'warning')
      return
    }

    setLoadingPreviewTasks(true)
    try {
      const result = await boomclipApi.getPreviewTasks(runConfig, { page: 1, pageSize: 20 })
      const incomingJobs = (result.tasks ?? []).map((task) => previewTaskToJob(task))
      setPreviewJobs((current) => {
        const existingByTaskId = new Map(current.filter((job) => job.taskId).map((job) => [job.taskId, job]))
        const merged = incomingJobs.map((incoming) => {
          const existing = existingByTaskId.get(incoming.taskId)
          if (!existing) return incoming
          return {
            ...incoming,
            localId: existing.localId,
            videoTask: existing.videoTask,
            previews: existing.previews,
            selectedPreviewIds: existing.selectedPreviewIds,
            bgmChoices: existing.bgmChoices,
            retryMode: existing.retryMode,
            events: existing.events.length ? existing.events : incoming.events,
          }
        })
        const localOnly = current.filter((job) => !job.taskId || !incomingJobs.some((incoming) => incoming.taskId === job.taskId))
        return [...localOnly, ...merged]
      })
      if (!activeJobId && incomingJobs[0]) setActiveJobId(incomingJobs[0].localId)
      if (!options.silent) {
        addEvent('脚本任务列表已刷新', `返回 ${result.tasks?.length ?? 0} 条 / total=${result.total ?? 0}`, 'success')
      }
    } catch (error) {
      addEvent('脚本任务列表刷新失败', apiErrorDetail(error) ?? toMessage(error), 'danger')
    } finally {
      setLoadingPreviewTasks(false)
    }
  }

  function updateConfig(partial: Partial<WorkbenchConfig>) {
    setConfig((current) => ({ ...current, ...partial }))
  }

  function toggleEnvironment(useRemote: boolean) {
    updateConfig({
      apiBaseUrl: useRemote ? remoteApiBaseUrl : localApiBaseUrl,
      authBaseUrl: useRemote ? remoteAuthBaseUrl : localAuthBaseUrl,
    })
    setAllowProductionWrites(false)
  }

  async function loginWithPassword() {
    if (!loginPhone.trim() || !loginPassword) {
      addEvent('登录信息不完整', '请填写手机号和密码。', 'warning')
      return
    }

    setLoggingIn(true)
    try {
      const result = await boomclipApi.loginWithPassword(config, {
        phone: loginPhone.trim(),
        password: loginPassword,
      })
      const authedConfig = { ...config, token: result.accessToken }
      updateConfig({ token: result.accessToken })
      setLoginPassword('')
      addEvent(
        '登录成功',
        `${result.user?.nickname ?? result.user?.phone ?? loginPhone.trim()} / tokenType=${result.tokenType}`,
        'success',
      )
      void loadPreviewTasks(authedConfig, { silent: true })
      void loadVideos(authedConfig, { silent: true })
    } catch (error) {
      addEvent('登录失败', apiErrorDetail(error) ?? toMessage(error), 'danger')
    } finally {
      setLoggingIn(false)
    }
  }

  async function loadReferenceData() {
    if (!config.token.trim()) {
      addEvent('缺少 token', '请先填入 Bearer token，再刷新项目、模板和分类。', 'warning')
      return
    }

    setRefreshing(true)
    try {
      const [categoryResult, projectResult, templateResult, providerResult] = await Promise.all([
        boomclipApi.getDomainCategoriesByDomainId(config, 1),
        boomclipApi.getProjects(config, { page: 1, pageSize: 100, keyword: deferredProjectSearch }),
        boomclipApi.getTemplates(config, {
          page: 1,
          pageSize: 100,
          keyword: deferredTemplateSearch,
          isAnalyzed: true,
        }),
        boomclipApi.getAiVideoProviders(config).catch(() => ({ providers: [] })),
      ])
      setCategories(categoryResult.categories ?? [])
      setProjects(projectResult.projects ?? [])
      setTemplates(templateResult.templates ?? [])
      setProjectTotal(projectResult.total ?? 0)
      setTemplateTotal(templateResult.total ?? 0)
      setProviders(providerResult.providers ?? [])
      const recommended = providerResult.providers?.find((provider) => provider.recommended)
      if (!aiProvider && recommended) setAiProvider(recommended.value)
      addEvent(
        '基础数据已刷新',
        `分类 ${categoryResult.categories?.length ?? 0} 个，项目 ${projectResult.projects?.length ?? 0} 个，已分析模板 ${templateResult.templates?.length ?? 0} 个。`,
        'success',
      )
      void loadPreviewTasks(config, { silent: true })
      void loadVideos(config, { silent: true })
    } catch (error) {
      addEvent('基础数据刷新失败', toMessage(error), 'danger')
    } finally {
      setRefreshing(false)
    }
  }

  async function loadProjectsOnly() {
    if (!config.token.trim()) {
      addEvent('缺少 token', '请先填入 Bearer token，再刷新项目列表。', 'warning')
      return
    }
    setRefreshing(true)
    try {
      const result = await boomclipApi.getProjects(config, {
        page: 1,
        pageSize: 100,
        keyword: deferredProjectSearch,
      })
      setProjects(result.projects ?? [])
      setProjectTotal(result.total ?? 0)
      addEvent('项目列表已刷新', `返回 ${result.projects?.length ?? 0} 个 / total=${result.total ?? 0}`, 'success')
    } catch (error) {
      addEvent('项目列表刷新失败', toMessage(error), 'danger')
    } finally {
      setRefreshing(false)
    }
  }

  async function loadCategoriesOnly() {
    setRefreshing(true)
    try {
      const result = await boomclipApi.getDomainCategoriesByDomainId(config, 1)
      setCategories(result.categories ?? [])
      addEvent('分类列表已刷新', `返回 ${result.categories?.length ?? 0} 个游戏分类`, 'success')
    } catch (error) {
      addEvent('分类列表刷新失败', toMessage(error), 'danger')
    } finally {
      setRefreshing(false)
    }
  }

  async function loadTemplatesOnly() {
    if (!config.token.trim()) {
      addEvent('缺少 token', '请先填入 Bearer token，再刷新模板列表。', 'warning')
      return
    }
    setRefreshing(true)
    try {
      const result = await boomclipApi.getTemplates(config, {
        page: 1,
        pageSize: 100,
        keyword: deferredTemplateSearch,
        isAnalyzed: true,
      })
      setTemplates(result.templates ?? [])
      setTemplateTotal(result.total ?? 0)
      addEvent('模板列表已刷新', `返回 ${result.templates?.length ?? 0} 个 / total=${result.total ?? 0}`, 'success')
    } catch (error) {
      addEvent('模板列表刷新失败', toMessage(error), 'danger')
    } finally {
      setRefreshing(false)
    }
  }

  async function loadVideos(
    runConfig: WorkbenchConfig = config,
    options: { extraActiveVideoTaskIds?: string[]; silent?: boolean } = {},
  ) {
    if (!runConfig.token.trim()) {
      if (!options.silent) addEvent('缺少 token', '请先登录或填入 Bearer token，再刷新已生成视频。', 'warning')
      return
    }

    const taskIds = Array.from(
      new Set([...(options.extraActiveVideoTaskIds ?? []), ...activeVideoTaskIds]),
    ).slice(0, 20)

    setLoadingVideos(true)
    try {
      const result = await boomclipApi.getHotScriptVideos(runConfig, {
        page: 1,
        pageSize: 20,
        includeProcessing: true,
        activeVideoTaskIds: taskIds,
      })
      setVideos(result.videos ?? [])
      setVideoTotal(result.total ?? 0)
      if (!options.silent) {
        addEvent(
          '已生成视频已刷新',
          `返回 ${result.videos?.length ?? 0} 条，完成视频 total=${result.total ?? 0}`,
          'success',
        )
      }
    } catch (error) {
      addEvent('已生成视频刷新失败', toMessage(error), 'danger')
    } finally {
      setLoadingVideos(false)
    }
  }

  function executablePreviewIds(content: PreviewDetail[], mode: boolean) {
    return content
      .filter((preview) => (mode ? isPreviewRetryExecutable(preview) : isPreviewInitialExecutable(preview)))
      .map((preview) => preview.previewId)
  }

  async function refreshPreviewDetailsForJob(
    localId: string,
    taskId: string,
    mode: boolean,
    runConfig: WorkbenchConfig = config,
  ) {
    if (!taskId) return
    const content = await boomclipApi.getPreviewTaskPreviews(runConfig, taskId)
    const executableIds = executablePreviewIds(content, mode)
    setAiVideoPromptDrafts((current) => {
      const next = { ...current }
      for (const preview of content) {
        next[preview.previewId] = {
          ...aiVideoPromptDraftFromPreview(preview),
          ...(current[preview.previewId] ?? {}),
        }
      }
      return next
    })
    updateJob(localId, (job) => {
      const nextBgmChoices: Record<string, boolean> = {}
      for (const preview of content) {
        nextBgmChoices[preview.previewId] = Boolean(job.bgmChoices[preview.previewId])
      }
      return {
        ...job,
        previews: content,
        selectedPreviewIds: new Set(executableIds),
        bgmChoices: nextBgmChoices,
      }
    })
    addJobEvent(localId, 'Preview 详情已刷新', `可执行 ${executableIds.length} 条，返回 ${content.length} 条。`, 'success')
  }

  async function refreshActivePreviewDetails(mode = activeJob?.retryMode ?? false) {
    if (!activeJob?.taskId) return
    await refreshPreviewDetailsForJob(activeJob.localId, activeJob.taskId, mode)
  }

  function selectPreviewJob(job: PreviewJob) {
    setActiveJobId(job.localId)
    if (job.taskId && job.previews.length === 0 && job.submitStatus === 'accepted') {
      void refreshPreviewDetailsForJob(job.localId, job.taskId, job.retryMode).catch((error) => {
        addJobEvent(job.localId, 'Preview 详情拉取失败', toMessage(error), 'warning')
      })
    }
  }

  async function recoverPreviewAfterStreamError(
    localId: string,
    taskId: string,
    error: Error,
    runConfig: WorkbenchConfig,
  ) {
    addJobEvent(localId, 'Preview SSE 异常关闭', error.message, 'warning')
    try {
      const status = await boomclipApi.getPreviewTaskStatus(runConfig, taskId)
      updateJob(localId, (job) => ({ ...job, message: status }))
      addJobEvent(localId, `Preview 状态回查：${statusLabel(status.status)}`, previewTaskDetail(status), 'info')
      if (status.status && TERMINAL_PREVIEW_STATES.includes(status.status)) {
        await refreshPreviewDetailsForJob(localId, taskId, false, runConfig)
      }
    } catch (fallbackError) {
      addJobEvent(localId, 'Preview 状态回查失败', toMessage(fallbackError), 'danger')
    }
  }

  async function recoverVideoAfterStreamError(
    localId: string,
    videoTaskId: string,
    previewTaskId: string,
    mode: boolean,
    runConfig: WorkbenchConfig,
  ) {
    addJobEvent(localId, '视频 SSE 异常关闭', `videoTaskId=${videoTaskId}`, 'warning')
    try {
      const status = await boomclipApi.getVideoTaskStatus(runConfig, videoTaskId)
      updateJob(localId, (job) => ({ ...job, videoTask: status }))
      addJobEvent(localId, `视频状态回查：${statusLabel(status.status)}`, videoTaskDetail(status), 'info')
      if (status.status && TERMINAL_VIDEO_STATES.includes(status.status)) {
        await refreshPreviewDetailsForJob(localId, previewTaskId, mode, runConfig)
        await loadVideos(runConfig, { extraActiveVideoTaskIds: [videoTaskId], silent: true })
      }
    } catch (fallbackError) {
      addJobEvent(localId, '视频状态回查失败', toMessage(fallbackError), 'danger')
    }
  }

  function onProjectSelect(project: Project) {
    setSelectedProjectId(project.projectId)
    setGameName(project.projectName)
    setCategoryId(project.categoryId ? String(project.categoryId) : '')
    addEvent('已选择项目', `${project.projectName} / projectId=${project.projectId}`, 'info')
  }

  function onTemplateSelect(template: Template) {
    setSelectedTemplateId(template.id)
    addEvent('已选择模板', `${template.name} / templateId=${template.id}`, 'info')
  }

  async function submitPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmitPreview || !selectedProjectId || !selectedTemplateId) return

    const body: GeneratePreviewRequest = {
      templateId: selectedTemplateId,
      projectId: selectedProjectId,
      gameName: gameName.trim(),
      categoryId: Number(categoryId),
      scriptCount,
      ...(aiProvider ? { aiVideoProvider: aiProvider } : {}),
      ...(durationMin ? { targetDurationMinSeconds: Number(durationMin) } : {}),
      ...(durationMax ? { targetDurationMaxSeconds: Number(durationMax) } : {}),
    }

    const localId = eventId()
    const createdAt = nowLabel()
    const runConfig = config
    const categoryName =
      categories.find((category) => String(category.categoryId) === categoryId)?.categoryName ?? `#${categoryId}`

    const pendingJob: PreviewJob = {
      localId,
      taskId: '',
      submitStatus: 'submitting',
      message: {
        status: 'queued',
        progress: 0,
        scriptCount,
      },
      videoTask: null,
      previews: [],
      selectedPreviewIds: new Set(),
      bgmChoices: {},
      retryMode: false,
      request: body,
      projectName: selectedProject?.projectName ?? `Project #${selectedProjectId}`,
      templateName: selectedTemplate?.name ?? `Template #${selectedTemplateId}`,
      categoryName,
      apiBaseUrl: runConfig.apiBaseUrl,
      createdAt,
      events: [
        {
          id: eventId(),
          at: createdAt,
          title: '提交 Preview 任务',
          detail: JSON.stringify(body),
          tone: 'info',
        },
      ],
    }

    setSubmittingPreview(true)
    setPreviewJobs((items) => [pendingJob, ...items])
    setActiveJobId(localId)

    try {
      const created = await boomclipApi.createPreviewTask(runConfig, body)
      updateJob(localId, (job) => ({
        ...job,
        taskId: created.taskId,
        submitStatus: 'accepted',
        message: {
          taskId: created.taskId,
          taskType: created.taskType,
          status: created.status ?? 'queued',
          progress: 0,
          scriptCount: body.scriptCount,
        },
      }))
      addJobEvent(localId, 'Preview 任务已创建', created.taskId, 'success')

      const controller = new AbortController()
      previewStreamsRef.current[localId]?.abort()
      previewStreamsRef.current[localId] = controller
      setSubmittingPreview(false)
      void boomclipApi.streamPreviewTask(runConfig, created.taskId, {
        signal: controller.signal,
        isTerminal: (message) =>
          Boolean(message.done || (message.status && TERMINAL_PREVIEW_STATES.includes(message.status))),
        onMessage: async (message) => {
          if (message.done) return
          if (message.error) {
            addJobEvent(localId, 'Preview SSE 错误', message.error, 'danger')
            return
          }
          updateJob(localId, (job) => ({ ...job, message }))
          if (message.status) {
            addJobEvent(
              localId,
              `Preview ${statusLabel(message.status)}`,
              previewTaskDetail(message),
              message.status === 'failed' ? 'danger' : 'info',
            )
          }
          if (message.status && TERMINAL_PREVIEW_STATES.includes(message.status)) {
            controller.abort()
            delete previewStreamsRef.current[localId]
            try {
              await refreshPreviewDetailsForJob(localId, created.taskId, false, runConfig)
            } catch (error) {
              addJobEvent(localId, 'Preview 详情拉取失败', toMessage(error), 'danger')
            }
          }
        },
        onError: (error) => {
          delete previewStreamsRef.current[localId]
          void recoverPreviewAfterStreamError(localId, created.taskId, error, runConfig)
        },
      })
    } catch (error) {
      setSubmittingPreview(false)
      updateJob(localId, (job) => ({
        ...job,
        submitStatus: 'failed',
        message: {
          ...job.message,
          status: 'failed',
          progress: 0,
          error: apiErrorDetail(error) ?? toMessage(error),
        },
      }))
      addJobEvent(localId, 'Preview 任务提交失败', apiErrorDetail(error) ?? toMessage(error), 'danger')
    }
  }

  async function submitVideos() {
    if (!canSubmitVideos || !activeJob) return

    const jobSnapshot = activeJob
    const runConfig = config
    const previewIds = Array.from(jobSnapshot.selectedPreviewIds)
    const scopedBgmChoices = Object.fromEntries(
      previewIds.map((previewId) => [previewId, Boolean(jobSnapshot.bgmChoices[previewId])]),
    )

    videoStreamsRef.current[jobSnapshot.localId]?.abort()
    setSubmittingVideoJobId(jobSnapshot.localId)
    updateJob(jobSnapshot.localId, (job) => ({
      ...job,
      videoTask: {
        taskType: 'video_generate',
        previewTaskId: jobSnapshot.taskId,
        status: 'queued',
        progress: 0,
      },
    }))

    try {
      const body = {
        previewIds,
        retryFailedExecution: jobSnapshot.retryMode,
        bgmChoices: scopedBgmChoices,
      }
      addJobEvent(jobSnapshot.localId, '提交视频生成任务', JSON.stringify(body), 'info')
      const created = await boomclipApi.generateVideos(runConfig, jobSnapshot.taskId, body)
      updateJob(jobSnapshot.localId, (job) => ({
        ...job,
        videoTask: {
          taskId: created.taskId,
          taskType: created.taskType,
          previewTaskId: created.previewTaskId,
          status: created.status,
          progress: 0,
        },
      }))
      addJobEvent(jobSnapshot.localId, '视频任务已创建', created.taskId, 'success')
      void loadVideos(runConfig, { extraActiveVideoTaskIds: [created.taskId], silent: true })

      const controller = new AbortController()
      videoStreamsRef.current[jobSnapshot.localId] = controller
      setSubmittingVideoJobId(null)
      void boomclipApi.streamVideoTask(runConfig, created.taskId, {
        signal: controller.signal,
        isTerminal: (message) =>
          Boolean(message.done || (message.status && TERMINAL_VIDEO_STATES.includes(message.status))),
        onMessage: (message) => {
          if (message.done) return
          if (message.error) {
            addJobEvent(jobSnapshot.localId, '视频 SSE 错误', message.error, 'danger')
            return
          }
          updateJob(jobSnapshot.localId, (job) => ({ ...job, videoTask: message }))
          if (message.status) {
            addJobEvent(
              jobSnapshot.localId,
              `视频 ${statusLabel(message.status)}`,
              videoTaskDetail(message),
              message.status === 'failed' ? 'danger' : 'info',
            )
          }
          if (message.status && TERMINAL_VIDEO_STATES.includes(message.status)) {
            controller.abort()
            delete videoStreamsRef.current[jobSnapshot.localId]
            void refreshPreviewDetailsForJob(
              jobSnapshot.localId,
              jobSnapshot.taskId,
              jobSnapshot.retryMode,
              runConfig,
            ).catch((error) => {
              addJobEvent(jobSnapshot.localId, '视频后置刷新失败', toMessage(error), 'warning')
            })
            void loadVideos(runConfig, { extraActiveVideoTaskIds: [created.taskId], silent: true })
          }
        },
        onError: (error) => {
          delete videoStreamsRef.current[jobSnapshot.localId]
          addJobEvent(jobSnapshot.localId, '视频 SSE 连接失败', error.message, 'warning')
          void recoverVideoAfterStreamError(
            jobSnapshot.localId,
            created.taskId,
            jobSnapshot.taskId,
            jobSnapshot.retryMode,
            runConfig,
          )
        },
      })
    } catch (error) {
      setSubmittingVideoJobId(null)
      updateJob(jobSnapshot.localId, (job) => ({ ...job, videoTask: null }))
      addJobEvent(jobSnapshot.localId, '视频任务提交失败', apiErrorDetail(error) ?? toMessage(error), 'danger')
    }
  }

  function togglePreview(localId: string, previewId: string) {
    updateJob(localId, (job) => {
      const selectedPreviewIds = new Set(job.selectedPreviewIds)
      if (selectedPreviewIds.has(previewId)) selectedPreviewIds.delete(previewId)
      else selectedPreviewIds.add(previewId)
      return { ...job, selectedPreviewIds }
    })
  }

  function toggleBgm(localId: string, previewId: string) {
    updateJob(localId, (job) => ({
      ...job,
      bgmChoices: { ...job.bgmChoices, [previewId]: !job.bgmChoices[previewId] },
    }))
  }

  function toggleRetryMode(localId: string, checked: boolean) {
    updateJob(localId, (job) => ({ ...job, retryMode: checked }))
    const job = previewJobs.find((item) => item.localId === localId)
    if (job?.taskId) {
      void refreshPreviewDetailsForJob(localId, job.taskId, checked).catch((error) => {
        addJobEvent(localId, '重试模式刷新失败', toMessage(error), 'warning')
      })
    }
  }

  function updateAiVideoPromptDraft(previewId: string, finalSegmentIndex: number, value: string) {
    setAiVideoPromptDrafts((current) => ({
      ...current,
      [previewId]: {
        ...(current[previewId] ?? {}),
        [finalSegmentIndex]: value,
      },
    }))
    setAiVideoPromptErrors((current) => {
      const previewErrors = current[previewId]
      if (!previewErrors?.[finalSegmentIndex]) return current
      const nextPreviewErrors = { ...previewErrors }
      delete nextPreviewErrors[finalSegmentIndex]
      return {
        ...current,
        [previewId]: nextPreviewErrors,
      }
    })
    setAiVideoPromptPreviewErrors((current) => {
      if (!current[previewId]) return current
      const next = { ...current }
      delete next[previewId]
      return next
    })
  }

  async function savePreviewAiVideoPrompt(job: PreviewJob, preview: PreviewDetail) {
    if (productionApi && !allowProductionWrites) {
      addJobEvent(job.localId, '保存画面描述被拦截', '远端环境需先勾选“确认允许生产写接口”。', 'warning')
      return
    }

    const editableSegments = editableAiVideoSegments(preview)
    if (editableSegments.length === 0) {
      addJobEvent(job.localId, '无可保存画面描述', '仅 status=ready 且 latestExecutionStatus=idle 的 ai_video 分镜可编辑。', 'warning')
      return
    }

    const draft = aiVideoPromptDrafts[preview.previewId] ?? aiVideoPromptDraftFromPreview(preview)
    const segments = editableSegments.map((segment, fallbackIndex) => {
      const index = segmentIndex(segment, fallbackIndex)
      return {
        finalSegmentIndex: index,
        aiVideoPrompt: (draft[index] ?? '').trim(),
      }
    })

    setSavingPromptPreviewId(preview.previewId)
    setAiVideoPromptErrors((current) => {
      const next = { ...current }
      delete next[preview.previewId]
      return next
    })
    setAiVideoPromptPreviewErrors((current) => {
      if (!current[preview.previewId]) return current
      const next = { ...current }
      delete next[preview.previewId]
      return next
    })
    try {
      const result = await boomclipApi.updatePreviewFinalSegments(config, preview.previewId, { segments })
      addJobEvent(
        job.localId,
        'AI画面描述已保存',
        `${preview.previewId} / indexes=${result.updatedSegmentIndexes.join(',')}`,
        'success',
      )
      await refreshPreviewDetailsForJob(job.localId, job.taskId, job.retryMode)
    } catch (error) {
      const failures = aiVideoPromptFailures(error)
      if (failures.length > 0) {
        setAiVideoPromptErrors((current) => ({
          ...current,
          [preview.previewId]: Object.fromEntries(
            failures.map((failure) => [failure.finalSegmentIndex, failure]),
          ),
        }))
      } else {
        setAiVideoPromptPreviewErrors((current) => ({
          ...current,
          [preview.previewId]: apiErrorMessage(error),
        }))
      }
      addJobEvent(job.localId, 'AI画面描述保存失败', apiErrorDetail(error) ?? toMessage(error), 'danger')
    } finally {
      setSavingPromptPreviewId(null)
    }
  }

  function onSearchChange(setter: (value: string) => void) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value
      startTransition(() => setter(value))
    }
  }

  return (
    <main className="workbench-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Heykool运营测试台</p>
          <h1>Heykool运营测试台</h1>
          <p className="hero-copy">
            选择一个项目和一个已分析模板，一次生成 1~5 条 Preview；Preview 落库后可选择子集生成视频，
            并按 previewId 独立控制推荐 BGM。
          </p>
        </div>
        <div className="hero-meter">
          <span>{selectedPreviewCount}</span>
          <small>已选 Preview</small>
        </div>
      </section>

      <section className="config-strip">
        <label className={`dev-toggle environment-toggle ${usingRemoteEnvironment ? 'is-remote' : ''}`}>
          <input
            checked={usingRemoteEnvironment}
            onChange={(event) => toggleEnvironment(event.target.checked)}
            type="checkbox"
          />
          <span>{usingRemoteEnvironment ? '远端环境 8513/8512' : '本地环境 8001/8200'}</span>
        </label>
        <label>
          <span>API Base URL</span>
          <input
            value={config.apiBaseUrl}
            onChange={(event) => updateConfig({ apiBaseUrl: event.target.value })}
            placeholder="http://boomclip.heykoolai.com:8513"
          />
        </label>
        <label>
          <span>Auth Base URL</span>
          <input
            value={config.authBaseUrl}
            onChange={(event) => updateConfig({ authBaseUrl: event.target.value })}
            placeholder="http://boomclip.heykoolai.com:8512"
          />
        </label>
        <label className="token-field">
          <span>Bearer Token</span>
          <input
            value={config.token}
            onChange={(event) => updateConfig({ token: event.target.value })}
            placeholder="测试账号 Bearer token"
            type="password"
          />
        </label>
        <label>
          <span>手机号登录</span>
          <input
            inputMode="tel"
            value={loginPhone}
            onChange={(event) => setLoginPhone(event.target.value)}
            placeholder="13800138000"
          />
        </label>
        <label>
          <span>登录密码</span>
          <input
            autoComplete="current-password"
            value={loginPassword}
            onChange={(event) => setLoginPassword(event.target.value)}
            placeholder="输入测试账号密码"
            type="password"
          />
        </label>
        <button
          className="secondary-button"
          disabled={loggingIn || !loginPhone.trim() || !loginPassword}
          onClick={loginWithPassword}
          type="button"
        >
          {loggingIn ? '登录中...' : '账号密码登录'}
        </button>
        <button
          className="secondary-button"
          onClick={() => updateConfig({ authBaseUrl: deriveAuthBaseUrl(config.apiBaseUrl) })}
          type="button"
        >
          推导 Auth
        </button>
        <label className="dev-toggle">
          <input
            checked={config.devPreviewFields}
            onChange={(event) => updateConfig({ devPreviewFields: event.target.checked })}
            type="checkbox"
          />
          <span>Preview 详情追加 ?dev=1</span>
        </label>
        <label className={`dev-toggle production-gate ${productionApi ? 'is-production' : ''}`}>
          <input
            checked={allowProductionWrites}
            disabled={!productionApi}
            onChange={(event) => setAllowProductionWrites(event.target.checked)}
            type="checkbox"
          />
          <span>{productionApi ? '确认允许生产写接口' : '当前非生产域名'}</span>
        </label>
        <button className="secondary-button" disabled={refreshing} onClick={loadReferenceData} type="button">
          {refreshing ? '刷新中...' : '刷新项目/模板'}
        </button>
      </section>

      <form className="workspace-grid" onSubmit={submitPreview}>
        <section className="card-panel selector-panel">
          <div className="panel-title">
            <span>01</span>
            <div>
              <h2>选择项目</h2>
              <p>项目提供 projectId、默认 gameName 和 categoryId。total={projectTotal}</p>
            </div>
          </div>
          <div className="inline-search">
            <input
              className="search-input"
              onChange={onSearchChange(setProjectSearch)}
              placeholder="搜索项目"
              value={projectSearch}
            />
            <button className="secondary-button" disabled={refreshing} onClick={loadProjectsOnly} type="button">
              刷新项目
            </button>
          </div>
          <div className="scroll-list">
            {filteredProjects.map((project) => (
              <button
                className={`project-card ${project.projectId === selectedProjectId ? 'is-selected' : ''}`}
                key={project.projectId}
                onClick={() => onProjectSelect(project)}
                type="button"
              >
                <span className="project-avatar">{project.projectName.slice(0, 1)}</span>
                <span>
                  <strong>{project.projectName}</strong>
                  <small>
                    #{project.projectId} · {project.domain ?? '未标领域'} · category {project.categoryId ?? '未填'}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="card-panel selector-panel">
          <div className="panel-title">
            <span>02</span>
            <div>
              <h2>选择模板</h2>
              <p>列表默认请求 isAnalyzed=true，避免提交不可用模板。total={templateTotal}</p>
            </div>
          </div>
          <div className="inline-search">
            <input
              className="search-input"
              onChange={onSearchChange(setTemplateSearch)}
              placeholder="搜索模板"
              value={templateSearch}
            />
            <button className="secondary-button" disabled={refreshing} onClick={loadTemplatesOnly} type="button">
              刷新模板
            </button>
          </div>
          <div className="scroll-list template-list">
            {filteredTemplates.map((template) => (
              <button
                className={`template-card ${template.id === selectedTemplateId ? 'is-selected' : ''}`}
                key={template.id}
                onClick={() => onTemplateSelect(template)}
                type="button"
              >
                {templateThumb(template) ? (
                  <img alt="" src={templateThumb(template)} />
                ) : (
                  <span className="template-fallback">No Thumb</span>
                )}
                <span>
                  <strong>{template.name}</strong>
                  <small>
                    #{template.id} · {template.duration ? `${Math.round(template.duration)}s` : '未知时长'} ·{' '}
                    {template.aspectRatio ?? '未知比例'}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="card-panel control-panel">
          <div className="panel-title">
            <span>03</span>
            <div>
              <h2>生成参数</h2>
              <p>只保留当前接口真实消费的字段，避免旧项目中的死配置。</p>
            </div>
          </div>
          <div className="field-grid">
            <label>
              <span>gameName</span>
              <input value={gameName} onChange={(event) => setGameName(event.target.value)} />
            </label>
            <label>
              <span>游戏分类</span>
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                <option value="">请选择分类</option>
                {categories.map((category) => (
                  <option key={category.categoryId} value={category.categoryId}>
                    {category.categoryName} · #{category.categoryId}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>scriptCount</span>
              <input
                max="5"
                min="1"
                type="number"
                value={scriptCount}
                onChange={(event) => setScriptCount(Math.min(5, Math.max(1, Number(event.target.value) || 1)))}
              />
            </label>
            <label>
              <span>AI Provider</span>
              <select value={aiProvider} onChange={(event) => setAiProvider(event.target.value)}>
                <option value="">后端默认</option>
                {providers.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.displayName}
                    {provider.recommended ? ' · 推荐' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>时长下限</span>
              <input
                max="120"
                min="10"
                placeholder="可选"
                type="number"
                value={durationMin}
                onChange={(event) => setDurationMin(event.target.value)}
              />
            </label>
            <label>
              <span>时长上限</span>
              <input
                max="120"
                min="10"
                placeholder="可选"
                type="number"
                value={durationMax}
                onChange={(event) => setDurationMax(event.target.value)}
              />
            </label>
          </div>

          <div className="selection-summary">
            <div>
              <small>项目</small>
              <strong>{selectedProject?.projectName ?? '未选择'}</strong>
            </div>
            <div>
              <small>分类</small>
              <strong>
                {categories.find((category) => String(category.categoryId) === categoryId)?.categoryName ??
                  (categoryId ? `#${categoryId}` : '未选择')}
              </strong>
            </div>
            <div>
              <small>模板</small>
              <strong>{selectedTemplate?.name ?? '未选择'}</strong>
            </div>
          </div>

          <button className="secondary-button full-width" disabled={refreshing} onClick={loadCategoriesOnly} type="button">
            刷新分类列表
          </button>

          {selectedTemplate && templatePreviewUrl(selectedTemplate) ? (
            <video className="template-preview" controls muted src={templatePreviewUrl(selectedTemplate)} />
          ) : null}

          <button className="primary-button" disabled={!canSubmitPreview} type="submit">
            {submittingPreview ? '提交中...' : `生成 ${scriptCount} 条 Preview`}
          </button>
        </section>
      </form>

      <section className="result-grid">
        <section className="card-panel task-list-panel">
          <div className="result-header">
            <div>
              <p className="eyebrow">Script Tasks</p>
              <h2>脚本任务列表</h2>
            </div>
            <div className="task-header-actions">
              <span className="task-count">{previewJobs.length}</span>
              <button
                className="secondary-button"
                disabled={loadingPreviewTasks}
                onClick={() => void loadPreviewTasks()}
                type="button"
              >
                {loadingPreviewTasks ? '刷新中...' : '刷新任务'}
              </button>
            </div>
          </div>

          <div className="task-list">
            {previewJobs.length === 0 ? (
              <div className="empty-state">点击“生成 Preview”后，任务会先进入这里，后台继续更新进度。</div>
            ) : (
              previewJobs.map((job) => {
                const status =
                  job.submitStatus === 'failed' ? 'failed' : (job.message?.status ?? 'queued')
                const progress = job.message?.progress ?? 0
                return (
                  <button
                    className={`task-row ${job.localId === activeJob?.localId ? 'is-active' : ''} status-${status}`}
                    key={job.localId}
                    onClick={() => selectPreviewJob(job)}
                    type="button"
                  >
                    <span className="task-row-head">
                      <strong>{job.taskId || '提交中...'}</strong>
                      <small>{statusLabel(status)}</small>
                    </span>
                    <span className="task-row-copy">
                      {job.projectName} / {job.templateName}
                    </span>
                    <span className="task-row-copy">
                      {job.categoryName} · {job.request.scriptCount} 条 · {job.createdAt}
                    </span>
                    <span className="task-progress">
                      <i style={{ width: `${progress}%` }} />
                    </span>
                    <span className="task-row-copy">
                      成功 {job.message?.completedCount ?? 0} / 失败 {job.message?.failedCount ?? 0} / Preview{' '}
                      {job.previews.length}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </section>

        <section className="card-panel preview-panel">
          <div className="result-header">
            <div>
              <p className="eyebrow">Preview Queue</p>
              <h2>
                {activeJob?.taskId ||
                  (activeJob?.submitStatus === 'submitting' ? '任务提交中' : '等待提交任务')}
              </h2>
              <p className="result-subtitle">
                {activeJob
                  ? `${activeJob.projectName} / ${activeJob.templateName} / 已选 ${selectedPreviewCount} 条`
                  : '先提交一个脚本任务，再查看 Preview 明细。'}
              </p>
            </div>
            <div className="progress-block">
              <span>{previewProgress}%</span>
              <div className="progress-track">
                <div style={{ width: `${previewProgress}%` }} />
              </div>
            </div>
          </div>

          <div className="task-actions">
            <label className="dev-toggle">
              <input
                checked={Boolean(activeJob?.retryMode)}
                disabled={!activeJob?.taskId}
                onChange={(event) => {
                  if (activeJob) toggleRetryMode(activeJob.localId, event.target.checked)
                }}
                type="checkbox"
              />
              <span>失败重试模式</span>
            </label>
            <button
              className="secondary-button"
              disabled={!activeJob?.taskId}
              onClick={() => void refreshActivePreviewDetails()}
              type="button"
            >
              刷新 Preview
            </button>
            <button className="primary-button compact" disabled={!canSubmitVideos} onClick={submitVideos} type="button">
              {activeVideoRunning ? '视频运行中...' : '生成选中视频'}
            </button>
          </div>

          <div className="preview-list">
            {!activeJob ? (
              <div className="empty-state">还没有脚本任务。提交后会立即出现在左侧列表。</div>
            ) : activeJob.previews.length === 0 ? (
              <div className="empty-state">
                {activeJob.submitStatus === 'failed'
                  ? activeJob.message?.error || '任务提交失败，请查看右侧事件。'
                  : 'Preview 完成后会在这里逐条展示脚本、执行状态和 BGM 选择。'}
              </div>
            ) : (
              activeJob.previews.map((preview, index) => {
                const executable = activeJob.retryMode
                  ? isPreviewRetryExecutable(preview)
                  : isPreviewInitialExecutable(preview)
                const editableSegments = editableAiVideoSegments(preview)
                const aiVideoPromptText = segmentAiVideoPromptText(preview)
                const promptDraft = aiVideoPromptDrafts[preview.previewId] ?? aiVideoPromptDraftFromPreview(preview)
                const promptErrors = aiVideoPromptErrors[preview.previewId] ?? {}
                const promptPreviewError = aiVideoPromptPreviewErrors[preview.previewId]
                const canSaveAiPrompt =
                  editableSegments.length > 0 &&
                  (!productionApi || allowProductionWrites) &&
                  savingPromptPreviewId !== preview.previewId
                return (
                  <article className={`preview-card status-${preview.status}`} key={preview.previewId}>
                    <div className="preview-card-head">
                      <label className="preview-check">
                        <input
                          checked={activeJob.selectedPreviewIds.has(preview.previewId)}
                          disabled={!executable}
                          onChange={() => togglePreview(activeJob.localId, preview.previewId)}
                          type="checkbox"
                        />
                        <span>#{index + 1}</span>
                      </label>
                      <div className="status-pills">
                        <span>{statusLabel(preview.status)}</span>
                        <span>{statusLabel(preview.latestExecutionStatus)}</span>
                      </div>
                    </div>
                    <div className="preview-text-block">
                      <span>口播/分镜摘要</span>
                      <pre>{segmentText(preview) || preview.userMessage || '暂无分镜内容'}</pre>
                    </div>
                    {aiVideoPromptText || editableSegments.length > 0 ? (
                      <div className="preview-text-block ai-prompt-block">
                        <div className="ai-prompt-title">
                          <span>AI画面描述</span>
                          <small>
                            {editableSegments.length > 0
                              ? '可编辑，本条 Preview 一次提交'
                              : '只读，仅 ai_video 且未执行成片前可编辑'}
                          </small>
                        </div>
                        {editableSegments.length > 0 ? (
                          <>
                            {editableSegments.map((segment, segmentOrder) => {
                              const indexValue = segmentIndex(segment, segmentOrder)
                              const segmentError = promptErrors[indexValue]
                              return (
                                <div
                                  className={`ai-prompt-editor ${segmentError ? 'has-error' : ''}`}
                                  key={`${preview.previewId}-${indexValue}`}
                                >
                                  <label>
                                    <span>finalSegmentIndex {indexValue}</span>
                                    <textarea
                                      value={promptDraft[indexValue] ?? ''}
                                      onChange={(event) =>
                                        updateAiVideoPromptDraft(preview.previewId, indexValue, event.target.value)
                                      }
                                      rows={4}
                                    />
                                  </label>
                                  {segmentError ? (
                                    <p className="segment-error-copy">{segmentError.reason}</p>
                                  ) : null}
                                </div>
                              )
                            })}
                            <button
                              className="secondary-button full-width"
                              disabled={!canSaveAiPrompt}
                              onClick={() => void savePreviewAiVideoPrompt(activeJob, preview)}
                              type="button"
                            >
                              {savingPromptPreviewId === preview.previewId ? '保存中...' : '保存本条画面描述'}
                            </button>
                            {promptPreviewError ? (
                              <p className="preview-save-error">{promptPreviewError}</p>
                            ) : null}
                            {productionApi && !allowProductionWrites ? (
                              <p className="warning-copy">远端环境需先勾选“确认允许生产写接口”才可保存。</p>
                            ) : null}
                          </>
                        ) : (
                          <pre>{aiVideoPromptText || '暂无 AI 视频画面描述'}</pre>
                        )}
                      </div>
                    ) : null}
                    <div className="preview-meta">
                      <span>{preview.previewId}</span>
                      <span>{preview.resolvedVoiceProfile?.displayName ?? '默认音色'}</span>
                    </div>
                    {preview.userMessage ? <p className="error-copy">{preview.userMessage}</p> : null}
                    {preview.recommendedBgm ? (
                      <div className="bgm-row">
                        <label>
                          <input
                            checked={Boolean(activeJob.bgmChoices[preview.previewId])}
                            disabled={!activeJob.selectedPreviewIds.has(preview.previewId)}
                            onChange={() => toggleBgm(activeJob.localId, preview.previewId)}
                            type="checkbox"
                          />
                          <span>混入 BGM：{preview.recommendedBgm.title ?? `Track ${preview.recommendedBgm.trackId}`}</span>
                        </label>
                        <div className="bgm-detail">
                          <strong>背景音乐试听</strong>
                          <span>
                            {preview.recommendedBgm.title ?? `Track ${preview.recommendedBgm.trackId ?? '-'}`}
                            {formatConfidence(preview.recommendedBgm.confidence)
                              ? ` · ${formatConfidence(preview.recommendedBgm.confidence)}`
                              : ''}
                          </span>
                        </div>
                        {preview.recommendedBgm.previewUrl ? (
                          <div className="bgm-player">
                            <audio controls preload="metadata" src={preview.recommendedBgm.previewUrl} />
                            <a
                              className="link-button"
                              href={preview.recommendedBgm.previewUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              打开试听
                            </a>
                          </div>
                        ) : (
                          <span className="muted-inline">暂无试听音频</span>
                        )}
                      </div>
                    ) : null}
                  </article>
                )
              })
            )}
          </div>
        </section>

        <aside className="card-panel timeline-panel">
          <div className="result-header">
            <div>
              <p className="eyebrow">Video Queue</p>
              <h2>{activeJob?.videoTask?.taskId || '未提交视频任务'}</h2>
            </div>
            <div className="progress-block">
              <span>{videoProgress}%</span>
              <div className="progress-track">
                <div style={{ width: `${videoProgress}%` }} />
              </div>
            </div>
          </div>
          <div className="timeline-list">
            {visibleEvents.length === 0 ? (
              <div className="empty-state">任务事件、错误码和 SSE 状态会保留在这里，方便调试。</div>
            ) : (
              visibleEvents.map((item) => (
                <article className={`timeline-item tone-${item.tone}`} key={item.id}>
                  <span>{item.at}</span>
                  <strong>{item.title}</strong>
                  {item.detail ? <p>{item.detail}</p> : null}
                </article>
              ))
            )}
          </div>
        </aside>
      </section>

      <section className="card-panel video-feed-section">
        <div className="result-header">
          <div>
            <p className="eyebrow">Generated Videos</p>
            <h2>已生成视频</h2>
            <p className="result-subtitle">
              播放入口以 <code>/api/v1/hot-scripts/videos</code> 返回的 videoUrl 为准，不使用 SSE
              中的内部 videoPath。
            </p>
          </div>
          <div className="video-feed-actions">
            <span className="task-count">{videoTotal}</span>
            <button className="secondary-button" disabled={loadingVideos} onClick={() => void loadVideos()} type="button">
              {loadingVideos ? '刷新中...' : '刷新视频'}
            </button>
          </div>
        </div>

        <div className="video-grid">
          {videos.length === 0 ? (
            <div className="empty-state">
              暂无视频结果。生成视频任务创建后会显示 processing 占位，终态后刷新为可播放的视频。
            </div>
          ) : (
            videos.map((video) => (
                <article className={`video-card status-${video.itemStatus}`} key={`${video.itemType}-${video.previewId ?? video.videoId ?? video.videoTaskId}`}>
                  <div className="video-thumb">
                    {video.videoUrl ? (
                      <video controls poster={video.thumbnailUrl ?? undefined} preload="metadata" src={video.videoUrl} />
                    ) : video.thumbnailUrl ? (
                      <img alt="" src={video.thumbnailUrl} />
                    ) : (
                      <span>{statusLabel(video.itemStatus)}</span>
                    )}
                  </div>
                  <div className="video-card-body">
                    <div className="video-card-head">
                      <strong>{videoDisplayTitle(video)}</strong>
                      <span>{statusLabel(video.itemStatus)}</span>
                    </div>
                    <div className="video-meta">
                      <span>videoId: {video.videoId ?? '-'}</span>
                      <span>previewId: {video.previewId ?? '-'}</span>
                      <span>taskId: {video.videoTaskId ?? '-'}</span>
                      <span>{formatDateLabel(video.createdAt)}</span>
                    </div>
                    {video.itemStatus !== 'completed' ? (
                      <span className="task-progress">
                        <i style={{ width: `${video.progress ?? 0}%` }} />
                      </span>
                    ) : null}
                    {video.userMessage ? <p className="error-copy">{video.userMessage}</p> : null}
                    <div className="video-card-actions">
                      {video.videoUrl ? (
                        <a className="link-button" href={video.videoUrl} rel="noreferrer" target="_blank">
                          播放/打开
                        </a>
                      ) : null}
                      {!video.videoUrl ? <span className="muted-inline">等待后端返回 videoUrl</span> : null}
                    </div>
                  </div>
                </article>
              ))
          )}
        </div>
      </section>
    </main>
  )
}

export default App
