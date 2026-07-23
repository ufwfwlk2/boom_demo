import type {
  AiVideoProvider,
  ApiEnvelope,
  DomainCategoryListResponse,
  DomainId,
  GeneratePreviewRequest,
  GeneratePreviewResponse,
  GenerateVideosRequest,
  GenerateVideosResponse,
  HotScriptVideoListQuery,
  HotScriptVideoListResponse,
  LoginResponse,
  ModerationProbeRequest,
  ModerationProbeResponse,
  PasswordLoginRequest,
  PreviewDetail,
  ProjectListQuery,
  ProjectListResponse,
  PreviewTaskListQuery,
  PreviewTaskListResponse,
  PreviewTaskMessage,
  TemplateListQuery,
  TemplateListResponse,
  UpdatePreviewFinalSegmentsRequest,
  UpdatePreviewFinalSegmentsResponse,
  VideoTaskMessage,
  WorkbenchConfig,
} from './types'

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

type StreamHandlers<T> = {
  onMessage: (message: T) => void
  onError: (error: Error) => void
  isTerminal?: (message: T) => boolean
  signal?: AbortSignal
}

const jsonHeaders = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
}

const messageText = (message?: string | string[]) => {
  if (!message) return ''
  return Array.isArray(message) ? message.join('；') : message
}

const normalizeBaseUrl = (url: string) => url.replace(/\/+$/, '')

export const WORKBENCH_CONFIG_KEY = 'boomclip.hotScriptBatch.config'
export const remoteApiBaseUrl = 'http://boomclip.heykoolai.com:8513'
export const remoteAuthBaseUrl = 'http://boomclip.heykoolai.com:8512'
export const localApiBaseUrl = 'http://localhost:8001'
export const localAuthBaseUrl = 'http://localhost:8200'
export const defaultPromptLabApiBaseUrl = 'http://localhost:8521'

const runtimeConfig: RuntimeConfig = typeof window === 'undefined' ? {} : (window.__HEYKOOL_RUNTIME_CONFIG__ ?? {})
const defaultApiBaseUrl =
  runtimeConfig.VITE_BOOMCLIP_API_BASE_URL ?? import.meta.env.VITE_BOOMCLIP_API_BASE_URL ?? remoteApiBaseUrl
const defaultAuthBaseUrl =
  runtimeConfig.VITE_BOOMCLIP_AUTH_BASE_URL ??
  import.meta.env.VITE_BOOMCLIP_AUTH_BASE_URL ??
  deriveAuthBaseUrl(defaultApiBaseUrl)
const defaultPreviewDevMode = (runtimeConfig.VITE_PREVIEW_DEV_MODE ?? import.meta.env.VITE_PREVIEW_DEV_MODE) === 'true'
const previousDefaultApiBaseUrl = 'http://localhost:8001'
const previousDefaultAuthBaseUrl = 'http://localhost:8200'

export const defaultLoginPhone =
  runtimeConfig.VITE_BOOMCLIP_LOGIN_PHONE ?? import.meta.env.VITE_BOOMCLIP_LOGIN_PHONE ?? '13800138000'

export const defaultWorkbenchConfig: WorkbenchConfig = {
  apiBaseUrl: defaultApiBaseUrl,
  authBaseUrl: defaultAuthBaseUrl,
  promptLabApiBaseUrl: defaultPromptLabApiBaseUrl,
  token: '',
  devPreviewFields: defaultPreviewDevMode,
}

export function deriveAuthBaseUrl(apiBaseUrl: string) {
  if (apiBaseUrl.includes('localhost:8001')) return apiBaseUrl.replace('localhost:8001', localAuthBaseUrl.replace('http://', ''))
  if (apiBaseUrl.includes('127.0.0.1:8001')) return apiBaseUrl.replace('127.0.0.1:8001', '127.0.0.1:8200')
  if (apiBaseUrl.includes('boomclip.heykoolai.com:8513')) {
    return apiBaseUrl.replace('boomclip.heykoolai.com:8513', remoteAuthBaseUrl.replace('http://', ''))
  }
  return apiBaseUrl
}

export function loadWorkbenchConfig(): WorkbenchConfig {
  const raw = localStorage.getItem(WORKBENCH_CONFIG_KEY)
  if (!raw) return { ...defaultWorkbenchConfig }
  try {
    const stored = { ...defaultWorkbenchConfig, ...JSON.parse(raw) } as WorkbenchConfig
    if (stored.apiBaseUrl === previousDefaultApiBaseUrl) stored.apiBaseUrl = defaultWorkbenchConfig.apiBaseUrl
    if (stored.authBaseUrl === previousDefaultAuthBaseUrl) stored.authBaseUrl = defaultWorkbenchConfig.authBaseUrl
    try {
      stored.promptLabApiBaseUrl = serviceOrigin(stored.promptLabApiBaseUrl)
    } catch {
      stored.promptLabApiBaseUrl = defaultWorkbenchConfig.promptLabApiBaseUrl
    }
    return stored
  } catch {
    return { ...defaultWorkbenchConfig }
  }
}

export function persistWorkbenchConfig(config: WorkbenchConfig) {
  try {
    localStorage.setItem(WORKBENCH_CONFIG_KEY, JSON.stringify({
      ...config,
      promptLabApiBaseUrl: serviceOrigin(config.promptLabApiBaseUrl),
    }))
    return true
  } catch {
    return false
  }
}

export function serviceOrigin(value: string) {
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('服务地址必须是仅包含 http(s) 协议、主机和端口的 origin')
  }
  return url.origin
}

async function request<T>(
  config: WorkbenchConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${normalizeBaseUrl(config.apiBaseUrl)}${path}`, {
    ...init,
    headers: {
      ...jsonHeaders,
      ...(init.headers ?? {}),
      Authorization: `Bearer ${config.token}`,
    },
  })

  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null
  const code = Number(payload?.code ?? response.status)

  if (!response.ok || code >= 400) {
    const error = new Error(messageText(payload?.message) || `请求失败: HTTP ${response.status}`)
    ;(error as Error & { payload?: ApiEnvelope<T> | null }).payload = payload
    throw error
  }

  if (payload && 'content' in payload) return payload.content as T
  if (payload && 'data' in payload) return payload.data as T
  return payload as T
}

async function authRequest<T>(
  config: WorkbenchConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${normalizeBaseUrl(config.authBaseUrl)}${path}`, {
    ...init,
    headers: {
      ...jsonHeaders,
      ...(init.headers ?? {}),
    },
  })

  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null
  const code = Number(payload?.code ?? response.status)

  if (!response.ok || code >= 400) {
    const error = new Error(messageText(payload?.message) || `请求失败: HTTP ${response.status}`)
    ;(error as Error & { payload?: ApiEnvelope<T> | null }).payload = payload
    throw error
  }

  if (payload && 'content' in payload) return payload.content as T
  if (payload && 'data' in payload) return payload.data as T
  return payload as T
}

async function streamSse<T>(
  config: WorkbenchConfig,
  path: string,
  { onMessage, onError, isTerminal, signal }: StreamHandlers<T>,
) {
  let closedByTerminalFrame = false
  try {
    const response = await fetch(`${normalizeBaseUrl(config.apiBaseUrl)}${path}`, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${config.token}`,
      },
      signal,
    })

    if (!response.ok || !response.body) {
      throw new Error(`SSE 连接失败: HTTP ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        if (!closedByTerminalFrame && !signal?.aborted) {
          throw new Error('SSE 连接提前关闭，未收到终态帧')
        }
        break
      }
      buffer += decoder.decode(value, { stream: true })

      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() ?? ''

      for (const chunk of chunks) {
        const dataLines = chunk
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())

        if (dataLines.length === 0) continue

        const raw = dataLines.join('\n')
        if (!raw) continue

        const parsed = JSON.parse(raw) as T
        if (isTerminal?.(parsed)) closedByTerminalFrame = true
        onMessage(parsed)
      }
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') return
    onError(error instanceof Error ? error : new Error(String(error)))
  }
}

export const boomclipApi = {
  loginWithPassword(config: WorkbenchConfig, body: PasswordLoginRequest) {
    return authRequest<LoginResponse>(config, '/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  getDomainCategoriesByDomainId(config: WorkbenchConfig, domainId: DomainId = 1) {
    return request<DomainCategoryListResponse>(config, `/api/v1/domain-categories/by-domain/${domainId}`)
  },

  getProjects(config: WorkbenchConfig, params: ProjectListQuery = {}) {
    const query = new URLSearchParams({
      page: String(params.page ?? 1),
      pageSize: String(params.pageSize ?? 100),
    })
    if (params.keyword?.trim()) query.set('keyword', params.keyword.trim())
    return request<ProjectListResponse>(config, `/api/v1/projects?${query}`)
  },

  getTemplates(config: WorkbenchConfig, params: TemplateListQuery = {}) {
    const query = new URLSearchParams({
      page: String(params.page ?? 1),
      pageSize: String(params.pageSize ?? 100),
    })
    if (params.isAnalyzed !== undefined) query.set('isAnalyzed', String(params.isAnalyzed))
    if (params.keyword?.trim()) query.set('keyword', params.keyword.trim())
    return request<TemplateListResponse>(config, `/api/v1/creative-templates?${query}`)
  },

  getAiVideoProviders(config: WorkbenchConfig) {
    return request<{ providers: AiVideoProvider[] }>(config, '/api/v1/hot-scripts/ai-video-providers')
  },

  createPreviewTask(config: WorkbenchConfig, body: GeneratePreviewRequest) {
    return request<GeneratePreviewResponse>(config, '/api/v1/hot-scripts/generate-preview', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  getPreviewTaskStatus(config: WorkbenchConfig, taskId: string) {
    return request<PreviewTaskMessage>(config, `/api/v1/hot-scripts/preview-tasks/${taskId}`)
  },

  getPreviewTasks(config: WorkbenchConfig, params: PreviewTaskListQuery = {}) {
    const query = new URLSearchParams({
      page: String(params.page ?? 1),
      pageSize: String(params.pageSize ?? 20),
    })
    if (params.status) query.set('status', params.status)
    if (params.projectId) query.set('projectId', String(params.projectId))
    return request<PreviewTaskListResponse>(config, `/api/v1/hot-scripts/preview-tasks?${query}`)
  },

  getPreviewTaskPreviews(config: WorkbenchConfig, taskId: string) {
    const suffix = config.devPreviewFields ? '?dev=1' : ''
    return request<PreviewDetail[]>(
      config,
      `/api/v1/hot-scripts/preview-tasks/${taskId}/previews${suffix}`,
    )
  },

  updatePreviewFinalSegments(
    config: WorkbenchConfig,
    previewId: string,
    body: UpdatePreviewFinalSegmentsRequest,
  ) {
    return request<UpdatePreviewFinalSegmentsResponse>(
      config,
      `/api/v1/hot-scripts/previews/${previewId}/final-segments`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
    )
  },

  generateVideos(config: WorkbenchConfig, taskId: string, body: GenerateVideosRequest) {
    return request<GenerateVideosResponse>(
      config,
      `/api/v1/hot-scripts/preview-tasks/${taskId}/generate-videos`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    )
  },

  getVideoTaskStatus(config: WorkbenchConfig, taskId: string) {
    return request<VideoTaskMessage>(config, `/api/v1/hot-scripts/video-tasks/${taskId}`)
  },

  getHotScriptVideos(config: WorkbenchConfig, params: HotScriptVideoListQuery = {}) {
    const query = new URLSearchParams({
      page: String(params.page ?? 1),
      pageSize: String(params.pageSize ?? 20),
      includeProcessing: String(params.includeProcessing ?? true),
    })
    for (const taskId of params.activeVideoTaskIds ?? []) {
      if (taskId.trim()) query.append('activeVideoTaskIds', taskId.trim())
    }
    return request<HotScriptVideoListResponse>(config, `/api/v1/hot-scripts/videos?${query}`)
  },

  streamPreviewTask(config: WorkbenchConfig, taskId: string, handlers: StreamHandlers<PreviewTaskMessage>) {
    return streamSse(config, `/api/v1/hot-scripts/preview-tasks/${taskId}/stream`, handlers)
  },

  streamVideoTask(config: WorkbenchConfig, taskId: string, handlers: StreamHandlers<VideoTaskMessage>) {
    return streamSse(config, `/api/v1/hot-scripts/video-tasks/${taskId}/stream`, handlers)
  },

  async probeContentModeration(config: WorkbenchConfig, body: ModerationProbeRequest) {
    const response = await fetch(`${serviceOrigin(config.promptLabApiBaseUrl)}/api/v1/content-moderation/probe`, {
      method: 'POST',
      headers: {
        ...jsonHeaders,
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify(body),
    })
    const payload = (await response.json().catch(() => null)) as ApiEnvelope<ModerationProbeResponse> | null
    const code = Number(payload?.code ?? response.status)
    if (!response.ok || code >= 400 || !payload?.data) {
      const error = new Error('内容审核探针请求失败')
      ;(error as Error & { payload?: ApiEnvelope<ModerationProbeResponse> | null }).payload = payload
      throw error
    }
    return payload.data
  },
}
