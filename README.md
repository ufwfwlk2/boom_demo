# Heykool运营测试台

独立 React/Vite 工作台，用于验证 `generate-preview` 的批量 Preview 生成和按 Preview 子集生成视频流程。

## 为什么是独立项目

当前线上前端 `heycool-fron` 已有 hot-script preview 的 service 封装和 SSE 监听，但页面逻辑散在生成页与右侧栏；旧前端 `materiel-app-home` 没有真正接入 `generate-preview`。本项目先做独立工作台，降低对现有产品路由、状态管理和设计系统的影响，后续可以把 `src/api.ts`、`src/types.ts` 和页面状态机迁回 `heycool-fron`。

## 功能范围

- 读取 `GET /api/v1/projects` 选择项目。
- 支持 `POST /api/v1/auth/login` 手机号密码登录，成功后自动写入 Bearer Token。
- 读取 `GET /api/v1/creative-templates?isAnalyzed=true` 选择模板。
- 读取 `GET /api/v1/domain-categories/by-domain/1` 选择游戏分类。
- 调用 `POST /api/v1/hot-scripts/generate-preview` 一次生成 1~5 条 Preview，页面默认 `scriptCount=1`。
- 任务创建成功后立即进入“脚本任务列表”，按钮恢复可用，可继续提交新的 Preview 任务。
- 读取 `GET /api/v1/hot-scripts/preview-tasks` 恢复后端已有脚本任务列表。
- 监听 `GET /api/v1/hot-scripts/preview-tasks/{taskId}/stream`。
- 终态后读取 `GET /api/v1/hot-scripts/preview-tasks/{taskId}/previews`。
- 使用 `PATCH /api/v1/hot-scripts/previews/{previewId}/final-segments` 按单个 preview 保存 `aiVideoPrompt`。
- 勾选 `previewIds` 调用 `POST /api/v1/hot-scripts/preview-tasks/{taskId}/generate-videos`。
- 按 previewId 传 `bgmChoices`，并支持失败重试模式。
- 使用 `GET /api/v1/hot-scripts/preview-tasks/{taskId}/previews` 返回的 `recommendedBgm.previewUrl` 做背景音乐试听。
- 监听 `GET /api/v1/hot-scripts/video-tasks/{taskId}/stream`。
- 读取 `GET /api/v1/hot-scripts/videos?includeProcessing=true` 展示已生成视频，并提供播放入口。

项目/模板列表接口参数与参考前端保持一致：

- 项目列表：`GET /api/v1/projects?page=1&pageSize=100&keyword=`
- 模板列表：`GET /api/v1/creative-templates?page=1&pageSize=100&keyword=&isAnalyzed=true`
- 游戏分类：`GET /api/v1/domain-categories/by-domain/1`
- 脚本任务列表：`GET /api/v1/hot-scripts/preview-tasks?page=1&pageSize=20`
- 已生成视频：`GET /api/v1/hot-scripts/videos?page=1&pageSize=20&includeProcessing=true&activeVideoTaskIds=...`
- Query 使用 camelCase，尤其是 `pageSize`，不要使用 `page_size`。
- 页面支持分别刷新项目列表和模板列表，便于联调时单独定位接口问题。

## 非阻塞任务流

页面不再用一个全局 loading 等待脚本完成。每次点击“生成 Preview”都会创建一条本地任务记录：

- POST 创建任务时只短暂禁用提交按钮。
- 拿到 `taskId` 后任务进入左侧脚本任务列表，后台 SSE 独立更新该任务。
- 用户可继续选择相同或不同项目/模板，再提交新的 Preview 任务。
- 点击任务列表项会切换当前详情，Preview 选择、BGM 选择、失败重试模式和视频任务状态都按任务隔离。
- 点击后端恢复的历史任务时，如果本地还没有详情，会自动读取 `/preview-tasks/{taskId}/previews`。
- Preview 卡片展示 `finalSegments[].aiVideoPrompt`，可编辑的 `ai_video` 分镜按单个 preview 一次保存。
- 如果保存 `aiVideoPrompt` 返回 `data.failures[]`，页面会按 `finalSegmentIndex` 在对应输入框下展示服务端返回的失败原因，不向终端用户展示 `reasonCode`。
- 如果保存 `aiVideoPrompt` 返回 `ai_video_prompt_edit_rate_limited` 等非分镜级错误，页面会在当前 Preview 卡片内展示服务端 `message`，例如“操作过于频繁，请稍后再试”。
- 视频任务创建和终态后会刷新已生成视频列表；播放地址只使用 `/hot-scripts/videos` 返回的 `videoUrl`。
- 如果 Preview 详情包含 `recommendedBgm.previewUrl`，卡片内会展示“背景音乐试听”播放器和打开链接。

## 本地启动

```bash
cd "/Users/mac/ReactProjects/boomclip-hot-script-batch"
npm install
npm run dev
```

## Podman 部署

部署方式与 `boomclip-admin-fron-wangyb` 保持一致：镜像只负责 nginx，静态产物由宿主机 `dist` 目录挂载进去。

```bash
cd "/Users/mac/ReactProjects/boomclip-hot-script-batch"
npm install
npm run build
podman-compose -f podman.yml up -d --build
```

访问地址：

```text
http://<服务器IP>:8509
```

默认端口映射：

- 宿主机：`8509`
- 容器 nginx：`3002`

运行时配置由容器启动脚本生成 `/runtime-config.js`，可通过 `podman.yml` 环境变量调整，无需重新执行 `npm run build`：

- `VITE_BOOMCLIP_API_BASE_URL`，默认 `http://boomclip.heykoolai.com:8513`
- `VITE_BOOMCLIP_AUTH_BASE_URL`，默认 `http://boomclip.heykoolai.com:8512`
- `VITE_BOOMCLIP_LOGIN_PHONE`，默认 `13800138000`
- `VITE_PREVIEW_DEV_MODE`，默认 `false`

可选环境变量：

```bash
VITE_BOOMCLIP_API_BASE_URL="http://boomclip.heykoolai.com:8513"
VITE_BOOMCLIP_AUTH_BASE_URL="http://boomclip.heykoolai.com:8512"
VITE_BOOMCLIP_LOGIN_PHONE="13800138000"
VITE_PREVIEW_DEV_MODE="true"
```

默认 API Base URL 是 `http://boomclip.heykoolai.com:8513`，默认 Auth Base URL 是 `http://boomclip.heykoolai.com:8512`。如果 API Base URL 切到本地 `http://localhost:8001`，点击“推导 Auth”会把 Auth Base URL 改为 `http://localhost:8200`。远端域名默认会要求额外勾选“确认允许生产写接口”，避免误触发线上 Preview/视频生成。

页面内也可以直接修改 API Base URL、Auth Base URL 和 Bearer Token。请优先使用测试账号和测试项目。Token 仅存储在浏览器 `localStorage`，不写入代码；登录密码只保存在当前页面内存中，登录成功后会清空。

常用接口填写：

- 浏览器本机访问本地 pic：`http://localhost:8001`
- 浏览器本机访问本地 api_gateway：`http://localhost:8200`
- 容器内服务互访 pic：`http://pic:8001`
- 远端测试/线上映射：`http://boomclip.heykoolai.com:8513`
- 远端认证网关：`http://boomclip.heykoolai.com:8512`

不要把 Bearer Token 写入 `.env`、README 或提交记录；只在页面输入框临时粘贴。

## Dev 字段说明

页面勾选“Preview 详情追加 ?dev=1”只会在读取 Preview 详情时追加 query。后端仍必须设置：

```bash
PREVIEW_DEV_SHOW_FINAL_SEGMENTS_INTERNAL_FIELDS=true
```

否则 `?dev=1` 不会暴露 `finalSegments` 内部字段。该开关不是权限机制，只适合开发排查。

`AI画面描述` 使用后端返回的 `finalSegments[].aiVideoPrompt`。`?dev=1` 只用于排查内部字段，不再作为显示 AI 画面描述的前提。

## 视频播放说明

已生成视频面板使用 `GET /api/v1/hot-scripts/videos` 作为结果事实源：

- `videoUrl` 用于内嵌播放和“播放/打开”链接。
- 当前原型不做下载按钮，避免 signed URL 跨域或响应头差异导致体验不稳定。
- 不使用 `GET /video-tasks/{taskId}` 或 SSE 中的 `videoPath` 作为播放地址。

## 验证命令

```bash
npm run build
npm run lint
```

## 已知边界

- 当前工作台只实现手机号密码登录，不实现验证码、微信登录和注册。
- Preview 任务可多条后台运行；视频生成入口当前绑定到选中的单个脚本任务。
- 视频列表只接入第一页 20 条，正式产品可继续补分页和筛选。
- 前端无法读取后端内部 `executionFailureTrace.retriable`，失败重试只能提交后按后端错误码处理。
- 没有直接调用生产写接口的自动化测试；需要手动用测试账号和测试项目验证真实链路。
