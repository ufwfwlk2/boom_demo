export type ApiEnvelope<T> = {
  code?: number | string
  status?: string
  data?: T
  content?: T
  message?: string | string[]
}

export type Project = {
  projectId: number
  userId?: number
  userName?: string
  projectName: string
  categoryId?: number | null
  domain?: string | null
  rules?: string | null
  remark?: string | null
  coverPath?: string | null
  coverUrl?: string | null
  hasCover?: number | boolean
  materialCount?: number
  createdAt?: string | null
  gameInfoForm?: {
    exists: boolean
    formStatus: string
  } | null
}

export type Template = {
  id: number
  userId?: number
  name: string
  filePath?: string | null
  thumbnailPath?: string | null
  storageType?: string | null
  thumbnailUrl?: string | null
  thumbnail_url?: string | null
  previewUrl?: string | null
  preview_url?: string | null
  downloadUrl?: string | null
  download_url?: string | null
  duration?: number | null
  aspectRatio?: string | null
  videoSize?: string | null
  format?: string | null
  size?: number | null
  isAnalyzed?: number | boolean
  analyzeStatus?: string | null
  analyzeTaskId?: string | null
  analyzeProgress?: number | null
  analyzeErrorMessage?: string | null
  metaStatus?: string | null
  createdAt?: string | null
  removed?: number
  script?: {
    duration?: string
    scriptSummary?: string
    promptSimple?: string
    promptDetailed?: string
    segments?: Array<Record<string, unknown>>
  } | null
  scriptSegments?: Array<Record<string, unknown>>
}

export type PaginationQuery = {
  page?: number
  pageSize?: number
  keyword?: string
}

export type ProjectListQuery = PaginationQuery

export type TemplateListQuery = PaginationQuery & {
  isAnalyzed?: boolean
}

export type ProjectListResponse = {
  projects: Project[]
  total: number
  page?: number
  pageSize?: number
  page_size?: number
}

export type TemplateListResponse = {
  templates: Template[]
  total: number
  page?: number
  pageSize?: number
  page_size?: number
}

export type DomainId = 1 | 2 | 3

export type DomainCategory = {
  categoryId: number
  categoryName: string
  sortOrder?: number
}

export type DomainCategoryListResponse = {
  categories: DomainCategory[]
}

export type PasswordLoginRequest = {
  phone: string
  password: string
}

export type LoginResponse = {
  accessToken: string
  tokenType: string
  user?: {
    id: number
    phone?: string | null
    email?: string | null
    nickname?: string | null
    avatar?: string | null
    hasPassword?: boolean
    isNewUser?: boolean
  }
}

export type AiVideoProvider = {
  value: string
  displayName: string
  recommended?: boolean
  voiceModeAvailable?: boolean
}

export type PreviewTaskStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'partial_failed'
  | 'failed'

export type PreviewExecutionStatus = 'idle' | 'processing' | 'completed' | 'failed'

export type PreviewStatus = 'ready' | 'expired' | 'consumed' | 'failed'

export type AudienceFacet = {
  facetId: string
  optionIds: string[]
}

export type GeneratePreviewRequest = {
  templateId: number
  projectId: number
  gameName: string
  categoryId: number
  scriptCount: number
  materialIds?: number[]
  audienceFacets?: AudienceFacet[]
  targetDurationMinSeconds?: number
  targetDurationMaxSeconds?: number
  aiVideoProvider?: string
}

export type GeneratePreviewResponse = {
  taskId: string
  taskType?: 'preview_generate'
  status?: PreviewTaskStatus
}

export type PreviewTaskMessage = {
  taskId?: string
  taskType?: 'preview_generate'
  status?: PreviewTaskStatus
  progress?: number
  scriptCount?: number
  completedCount?: number
  failedCount?: number
  previewIds?: string[]
  errorCode?: string
  userMessage?: string
  error?: string
  done?: boolean
}

export type RecommendedBgm = {
  trackId?: number
  title?: string
  confidence?: number
  previewUrl?: string | null
}

export type PreviewFinalSegment = Record<string, unknown> & {
  finalSegmentIndex?: number
  executionSource?: string
  dialogueTts?: unknown
  dialogue?: unknown
  storyboard?: unknown
  aiVideoPrompt?: unknown
}

export type PreviewDetail = {
  previewId: string
  status: PreviewStatus
  templateId: number
  projectId: number
  gameName: string
  categoryId: number
  resolvedCategoryId?: number | null
  resolvedVoiceProfile?: {
    displayName?: string
    provider?: string
    apiVoiceName?: string
    voiceType?: string
  } | null
  resolvedVoiceRate?: string | null
  latestExecutionStatus: PreviewExecutionStatus
  selectedMaterialIds?: number[] | null
  finalSegments: PreviewFinalSegment[]
  recommendedBgm?: RecommendedBgm | null
  warnings?: Array<{ code: string; message: string }>
  errorCode?: string
  userMessage?: string
}

export type GenerateVideosRequest = {
  previewIds?: string[]
  retryFailedExecution?: boolean
  bgmChoices?: Record<string, boolean>
}

export type GenerateVideosResponse = {
  taskId: string
  taskType: 'video_generate'
  previewTaskId: string
  status: VideoTaskStatus
}

export type PreviewTaskListQuery = {
  page?: number
  pageSize?: number
  status?: PreviewTaskStatus
  projectId?: number
}

export type PreviewTaskListItem = {
  taskId: string
  status: PreviewTaskStatus
  projectId: number
  templateId: number
  scriptCount: number
  progress: number
  completedCount: number
  failedCount: number
  createdAt?: string | null
  updatedAt?: string | null
  errorCode?: string | null
  userMessage?: string | null
  errorMessage?: string | null
}

export type PreviewTaskListResponse = {
  tasks: PreviewTaskListItem[]
  total: number
  page: number
  pageSize: number
}

export type UpdatePreviewFinalSegment = {
  finalSegmentIndex: number
  aiVideoPrompt: string
}

export type AiVideoPromptFailure = {
  finalSegmentIndex: number
  reason: string
  reasonCode?: string
}

export type UpdatePreviewFinalSegmentsRequest = {
  segments: UpdatePreviewFinalSegment[]
}

export type UpdatePreviewFinalSegmentsResponse = {
  previewId: string
  updatedSegmentIndexes: number[]
}

export type VideoTaskStatus = 'queued' | 'processing' | 'completed' | 'partial_failed' | 'failed'

export type VideoTaskMessage = {
  taskId?: string
  taskType?: 'video_generate'
  previewTaskId?: string
  videoId?: number | null
  videoPath?: string | null
  status?: VideoTaskStatus
  progress?: number
  completedCount?: number
  failedCount?: number
  scriptFailures?: Array<{
    scriptIndex?: number
    phase?: string
    errorCode?: string
    userMessage?: string
  }>
  errorCode?: string
  userMessage?: string
  error?: string
  done?: boolean
}

export type HotScriptVideoItemStatus = 'queued' | 'processing' | 'completed' | 'failed'

export type HotScriptVideoItem = {
  itemType: 'video' | 'placeholder'
  itemStatus: HotScriptVideoItemStatus
  videoTaskId?: string | null
  previewTaskId?: string | null
  previewId?: string | null
  scriptIndex?: number | null
  progress?: number | null
  videoId?: number | null
  videoUrl?: string | null
  thumbnailUrl?: string | null
  scriptTitle?: string | null
  audienceFacets?: unknown[] | null
  errorCode?: string | null
  userMessage?: string | null
  createdAt?: string | null
}

export type HotScriptVideoListQuery = {
  page?: number
  pageSize?: number
  includeProcessing?: boolean
  activeVideoTaskIds?: string[]
}

export type HotScriptVideoListResponse = {
  total: number
  page: number
  pageSize: number
  videos: HotScriptVideoItem[]
}

export type WorkbenchConfig = {
  apiBaseUrl: string
  authBaseUrl: string
  promptLabApiBaseUrl: string
  token: string
  devPreviewFields: boolean
}

export type ModerationPromptResponse = {
  prompt: string
  version: 'v1'
}

export type ModerationProbeRequest = {
  previewId: string
  finalSegmentIndexes: number[]
  promptOverride: string
  storyboardOverrides: StoryboardOverride[]
}

export type StoryboardOverride = {
  finalSegmentIndex: number
  inputText: string
}

export type ModerationProbeResult = {
  finalSegmentIndex: number
  inputText: string
  passed: boolean
  reason: string
}

export type ModerationProbeTokenUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  source: string
}

export type ModerationProbeResponse = {
  requestId: string
  previewId: string
  provider: string
  model: string
  results: ModerationProbeResult[]
  warnings: string[]
  tokenUsage: ModerationProbeTokenUsage
  latencyMs: number
  rawText: string
}

export type ModerationProbeErrorData = {
  errorCode: string
}

export type TimelineEvent = {
  id: string
  at: string
  title: string
  detail?: string
  tone: 'info' | 'success' | 'warning' | 'danger'
}
