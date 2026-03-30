const express = require('express');
const cors = require('cors');
require('dotenv').config(); // 加载 .env 环境变量

const userRouter = require('./routes/user');
const chatRouter = require('./routes/chat');
const uploadRouter = require('./routes/upload'); // 🚀 新增：文件上传路由
const getDB = require('./config/db');
const authMiddleware = require('./middlewares/auth');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);
// 🚀 配置全局请求限流 (防止多用户并发恶意刷接口)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100, // 每个 IP 限制 100 次
  message: { code: 429, message: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ==========================================
// 1. 全局中间件 (必须放在最前面，大门安检)
// ==========================================
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*'
}));
app.use(limiter); // 🚀 挂载全局限流
app.use(express.json()); // 解析 application/json 格式的请求体

// 🚀 新增：对外直接暴露本地固化的头像目录
const path = require('path');
app.use('/avatars', express.static(path.join(__dirname, 'public/avatars')));

// ==========================================
// 2. 挂载路由 (业务逻辑)
// ==========================================
// 健康检查接口 (供 Docker 或云负载均衡器检测服务是否存活)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// 公开路由（不需要 Token 就能访问）
app.use('/api/user', userRouter);

// 受保护路由（必须经过 authMiddleware 验明正身才能访问）
app.use('/api/chat', authMiddleware, chatRouter);
app.use('/api/chat', authMiddleware, uploadRouter); // 🚀 新增：文件上传

// ==========================================
// 3. 全局拦截器 (必须放在所有路由的后面)
// ==========================================
// 全局 404 处理
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: '请求的接口不存在' });
});

// 全局异常拦截器 (兜底所有未捕获的错误，防止进程崩溃)
app.use((err, req, res, next) => {
  console.error('[Global Error]:', err.message);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : '服务器内部发生错误'
  });
});

// ==========================================
// 4. 启动服务 (等前面所有配置就绪后，最后执行)
// ==========================================
const bootstrap = async () => {
  try {
    // 提前唤醒并初始化 SQLite 数据库
    await getDB();
    
    app.listen(PORT, () => {
      console.log(`🚀 FOAI Backend is running on http://localhost:${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('❌ 服务启动失败:', error);
    process.exit(1);
  }
};

bootstrap();