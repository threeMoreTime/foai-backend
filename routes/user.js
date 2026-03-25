const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const getDB = require('../config/db');
const tokenManager = require('../utils/tokenManager');
const router = express.Router();

// 注册接口
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ code: 400, message: '用户名和密码不能为空' });
  }

  try {
    const db = await getDB();
    
    // 检查用户是否已存在
    const existingUser = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (existingUser) {
      return res.status(409).json({ code: 409, message: '用户名已存在' });
    }

    // 哈希加密
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const userId = uuidv4();

    // 存储用户
    await db.run(
      'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
      [userId, username, passwordHash, Date.now()]
    );

    res.json({ code: 200, message: '注册成功' });
  } catch (error) {
    console.error('注册失败:', error);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 登录接口
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ code: 400, message: '账号或密码不能为空' });
  }

  try {
    const db = await getDB();
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);

    if (!user) {
      return res.status(401).json({ code: 401, message: '账号或密码错误' });
    }

    // 比对密码
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ code: 401, message: '账号或密码错误' });
    }

    // 签发 JWT Token
    const token = jwt.sign(
      { userId: user.id, username: user.username }, 
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // 🚀 SSO 核心密钥更新
    tokenManager.setToken(user.id, token);

    res.json({
      code: 200,
      message: '登录成功',
      data: {
        token,
        userInfo: { id: user.id, username: user.username }
      }
    });
  } catch (error) {
    console.error('登录失败:', error);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;