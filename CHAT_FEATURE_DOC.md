# foai-backend: Chat 模块开发与扩展指南

本文档旨在详述 `routes/chat.js` 下聊天相关核心能力的现状与未来针对“模型选择器”、“多模态文件上传”特性的扩展方向，便于前后端快速协同开发。

## 1. 现状：聊天上下文体系架构

目前项目采用了基于 OpenAI 规范的高级流式传输逻辑，对接 DeepSeek 底座模型。核心能力依靠 SSE (Server-Sent Events) 打通，分为以下层级：

- **API Client 初始化配置**:
  使用了 `openai` Node SDK 并重定向 `baseURL` 至 `https://api.deepseek.com/v1` 以全面接管。
- **长链接对话流管理 (`POST /completions`)**:
  - 监听前端长请求，建立基于 `text/event-stream` 内容类型的长连接响应管道。
  - 流式（`stream: true`）请求远端 AI。
  - **异常拦截（断连优化）**: 借助 `req.on('close')` 实现，当客户端主动关闭页面时，通过 `stream.controller.abort()` 阻断模型持续消耗 Token。

### 现存接口标准

- `GET /sessions`: 拿取当前用户经过轻量化反序列化（`is_pinned` 处理）的分组对话。
- `POST /completions`: 对话生出引擎，吐出块数据。
- `POST/PUT/DELETE /sessions`: 本地对话索引的同步持久层封装。

## 2. 演进路线一：增加多模型切换支持

**目标**：满足前端 `<Select Model />` 组件的选项诉求；允许在一次对话的请求粒度去更换驱动的脑体（例如 `deepseek-chat` 或 `deepseek-reasoner`）。

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

## 3. 演进路线二：输入流前置附件预处理（文件上传支撑）

**目标**：响应页面下方的 `+` 回形针添加按钮事件。前台选取文件，服务端负责承载落地、向 AI 透传或作预处理阅读。

### 架构侧实现方案建议：

1.  **媒体暂存中心 (`POST /api/chat/upload`)**:
    - **前端职责**: 点击图标触发 `chooseFile` 拿取实体并使用 `FormData` multipart 推送上来。
    - **后端职责**: 使用 `multer` 将流写入服务器的暂存区或私有 OSS 存储桶，记录返回类似 `file_id` 或者内部预览 `url` 的凭据返回前端。
2.  **携带上下文注入**:
    当请求流发入 `/completions` 时，附加新的 `req.body.attachments[]`。根据 AI 平台的支持力度，将文件进行相应的多模态转译后塞进上下文数组发给大模型的上行链路中。
3.  **文件引用关系落地**:
    当客户端最后调用 `POST /sessions` 时，确保本地 SQLite `chat_sessions` 表或者单独的文件映射表固化这些附着资源的归属，方便刷新和二次点开读取。
