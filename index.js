const express = require('express');
const cors = require('cors');
require('dotenv').config(); // 加载 .env 环境变量
// 👉 新增：引入 chat 路由
const userRouter = require('./routes/user');
const chatRouter = require('./routes/chat');
const authMiddleware = require('./middlewares/auth');
const app = express();
const PORT = process.env.PORT || 3000;

// 1. 全局中间件配置
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*'
}));
app.use(express.json()); // 解析 application/json 格式的请求体
// 🚀 1. 挂载公开路由（不需要 Token 就能访问）
app.use('/api/user', userRouter);

// 🚀 2. 挂载受保护路由（必须经过 authMiddleware 验明正身才能访问）
app.use('/api/chat', authMiddleware, chatRouter);
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});
app.use('/api/chat', chatRouter);
// 2. 健康检查接口 (非常重要：供 Docker 或云负载均衡器检测服务是否存活)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// 3. 预留 AI 对话路由 (下一步我们将在这里接入 DeepSeek)
// app.use('/api/chat', chatRouter);

// 4. 全局 404 处理
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: '请求的接口不存在' });
});

// 5. 全局异常拦截器 (兜底所有未捕获的错误，防止进程崩溃)
app.use((err, req, res, next) => {
  console.error('[Global Error]:', err.message);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : '服务器内部发生错误'
  });
});

// 6. 启动服务
app.listen(PORT, () => {
  console.log(`🚀 FOAI Backend is running on http://localhost:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});