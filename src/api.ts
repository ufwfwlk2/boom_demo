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
}
