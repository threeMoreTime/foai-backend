// routes/user.js
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// 模拟数据库中的用户表
const MOCK_USER = {
  id: 'u_1001',
  username: 'admin',
  password: '123456' // 实际业务中这里必须是密文 (如 bcrypt 加密)
};

// 登录接口
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ code: 400, message: '账号或密码不能为空' });
  }

  // 校验账号密码
  if (username === MOCK_USER.username && password === MOCK_USER.password) {
    // 校验通过，签发 JWT Token
    const token = jwt.sign(
      { 
        userId: MOCK_USER.id, 
        username: MOCK_USER.username 
      }, 
      process.env.JWT_SECRET, // 使用 .env 中的机密盐值加密
      { expiresIn: '7d' }     // 设置 Token 有效期为 7 天
    );

    res.json({
      code: 200,
      message: '登录成功',
      data: {
        token,
        userInfo: { id: MOCK_USER.id, username: MOCK_USER.username }
      }
    });
  } else {
    res.status(401).json({ code: 401, message: '账号或密码错误' });
  }
});

module.exports = router;