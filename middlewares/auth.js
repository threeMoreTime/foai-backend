// middlewares/auth.js
const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  // 1. 从请求头获取 Authorization 字段
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // 这里的 401 状态码将精准触发前端 request.js 里的跳回登录页逻辑
    return res.status(401).json({ code: 401, message: '未授权，请先登录' });
  }

  // 2. 提取出纯粹的 Token 字符串
  const token = authHeader.split(' ')[1];

  try {
    // 3. 验证 Token 的合法性及是否过期
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // 🚀 SSO 核心校验：对比当前 Token 是否为该用户的最新活跃 Token
    const tokenManager = require('../utils/tokenManager');
    const latestToken = tokenManager.getToken(decoded.userId);

    // 如果内存中有更晚生成的最新 Token，且与当前请求的 Token 不一致，判定为被挤掉
    if (latestToken && latestToken !== token) {
      return res.status(403).json({ 
        code: 403, 
        message: '您的账号已在其他设备登录，请重新登录' 
      });
    }

    // 4. 将解密出来的用户信息挂载到 req 对象上
    req.user = decoded; 
    
    // 5. 验证通过，放行
    next();
  } catch (error) {
    return res.status(401).json({ code: 401, message: '登录状态已过期或无效' });
  }
};

module.exports = authMiddleware;