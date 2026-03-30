# foai-backend: Chat 模块开发与扩展指南

本文档旨在详述 `routes/chat.js` 下聊天相关核心能力的现状与未来针对“模型选择器”、“多模态文件上传”特性的扩展方向，便于前后端快速协同开发。

## 1. 现状：聊天上下文体系架构

目前项目采用了基于 OpenAI 规范的高级流式传输逻辑，对接 DeepSeek 底座模型。核心能力依靠 SSE (Server-Sent Events) 打通，分为以下层级：

- **API Client 初始化配置**:
  使用了 `openai` Node SDK 并重定向 `baseURL` 至 `https://api.deepseek.com/v1` 以全面接管。
- **长链接对话流管理 (`POST /completions`)**:
  - 监听前端长请求，建立基于 `text/event-stream` 内容类型的长连接响应管道。
  - 流式（`stream: true`）请求远端 AI。
  - **双流解析引擎 (Dual-Stream)**: 针对 DeepSeek-R1 等具备深度思考能力的模型，同时提取和透传 `reasoning_content`（推理内容）与 `content`（正式回答），保证前端能够实现“思考过程”的实时渲染。
  - **异常拦截（断连优化）**: 借助 `req.on('close')` 实现，当客户端主动关闭页面时，通过 `stream.controller.abort()` 阻断模型持续消耗 Token。

### 现存接口标准

- `GET /sessions`: 拿取当前用户经过轻量化反序列化（`is_pinned` 处理）的分组对话。
- `POST /completions`: 对话生出引擎，吐出块数据。
- `POST/PUT/DELETE /sessions`: 本地对话索引的同步持久层封装。

## 2. 现状与成就二：多模型动态切换引擎

**目标与实现状态（已完成）**：全面支撑前端 `<Select Model />` 组件的选项诉求；允许在一次对话的请求粒度去灵活更换推理脑体（如 `deepseek-chat` 或 `deepseek-reasoner`，或外部导入的兼容模型）。

### API 实现方案：

1.  **新增挂载点**: `GET /api/chat/models`
2.  **逻辑处理**:
    - 可以通过后端静态配置一组白名单，返回友好别名格式。
    - 也可以调用 `await openai.models.list()`（如果 DeepSeek 层兼容该查询）。
3.  **返回示例**:
    ```json
    {
      "code": 200,
      "data": [
        { "id": "deepseek-chat", "name": "DeepSeek-V3", "type": "v3" },
        { "id": "deepseek-reasoner", "name": "DeepSeek-R1", "type": "r1" }
      ]
    }
    ```
4.  **`POST /completions` 请求头改动**:
    由原先硬编码的：
    ```javascript
    const stream = await openai.chat.completions.create({
      model: "deepseek-chat",
      // ...
    });
    ```
    变为支持前端通过 JSON `body` 透传 `req.body.model` 并提供默认兜底。

## 3. 现状与成就三：输入流前置附件预处理与文件解析

**目标与实现状态（已完成）**：响应页面下方的 `+` 回形针触发，前台选取文件推流，服务端调用强力中间件集群（如 `mammoth`/`pdf-parse`/`tesseract`/`xlsx`）对文档提取文本，向 AI 预注入到系统上下文。

### 架构侧实现方案建议：

1.  **媒体暂存中心 (`POST /api/chat/upload`)**:
    - **前端职责**: 点击图标触发 `chooseFile` 拿取实体并使用 `FormData` multipart 推送上来。
    - **后端职责**: 使用 `multer` 将流写入服务器的暂存区或私有 OSS 存储桶，记录返回类似 `file_id` 或者内部预览 `url` 的凭据返回前端。
2.  **携带上下文注入**:
    当请求流发入 `/completions` 时，附加新的 `req.body.attachments[]`。根据 AI 平台的支持力度，将文件进行相应的多模态转译后塞进上下文数组发给大模型的上行链路中。
3.  **文件引用关系落地**:
    当客户端最后调用 `POST /sessions` 时，确保本地 SQLite `chat_sessions` 表或者单独的文件映射表固化这些附着资源的归属，方便刷新和二次点开读取。

## 4. 后端核心防渗漏设计 (Defensive Design)

在 `upload-avatar` (微信资料补完) 和附件上传链路中，遵循以下最高等级防御标准：

- **C++ 级容错降级 (Sharp Try-Catch)**：所有的静态图片缩放（例如 Avatar 的预裁剪），统一利用 `multer.memoryStorage()` 放入 Buffer 后。通过 `sharp()` 包裹 Try-Catch。一切非法图或者伪装文本篡改格式的恶意 payload 都会被隔离并抛出 400 警告，防止 Node.js 底层崩溃。
- **跨目录防穿透 (Path Traversal Guard)**：凡是系统尝试按路径覆盖更新物理文件或读取本地磁盘资产时，必须加入强校验防御机制（如 `!avatar.includes('..')` 以及严控 `startsWith('/avatars/')` 等白名单）。
- **空间黑洞防堆积 (Orphan File Prevention)**：对极高频修改区（如头像编辑），舍弃原有的散列型 UUID 随机命名，转而采用以 `userId` 主键为主键名的硬覆盖绑定式（例如 `avatar-{userId}.png`）。即使由于异常客户端逻辑狂发修改包落库，硬盘空间占用永远恒定 1 份，坚决不成为“孤儿文件垃圾场”。
