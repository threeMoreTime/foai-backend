const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const getDB = require('../config/db');
const tokenManager = require('../utils/tokenManager');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const authMiddleware = require('../middlewares/auth');
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
        userInfo: { id: user.id, username: user.username, nickname: user.nickname || user.username, avatar: user.avatar, is_profile_completed: user.is_profile_completed }
      }
    });
  } catch (error) {
    console.error('登录失败:', error);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 🚀 微信一键登录/静默注册
router.post('/wechat-login', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ code: 400, message: '缺少登录 code' });
  }

  try {
    const { WX_APP_ID, WX_APP_SECRET, JWT_SECRET } = process.env;
    
    // 1. 调用微信接口换取 OpenID
    const wxApiUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${WX_APP_ID}&secret=${WX_APP_SECRET}&js_code=${code}&grant_type=authorization_code`;
    const wxRes = await fetch(wxApiUrl);
    const wxData = await wxRes.json();

    if (wxData.errcode || !wxData.openid) {
      console.error('微信接口调用失败:', wxData);
      return res.status(401).json({ code: 401, message: '微信登录验证失败' });
    }

    const openid = wxData.openid;
    const db = await getDB();

    // 2. 查找是否存在该 openid 的用户
    let user = await db.get('SELECT * FROM users WHERE openid = ?', [openid]);

    if (!user) {
      // 3. 不存在则进行静默注册
      const userId = uuidv4();
      // 使用随机用户名，并给一个空的 password_hash
      const username = `wx_${Math.random().toString(36).substr(2, 8)}`;
      
      await db.run(
        'INSERT INTO users (id, username, password_hash, created_at, openid, is_profile_completed) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, username, '', Date.now(), openid, 0]
      );
      
      // 注册后立即查询取回完整记录
      user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    }

    // 4. 发放 Token (与普通登录一致)
    const token = jwt.sign(
      { userId: user.id, username: user.username }, 
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // 核心单点记录
    tokenManager.setToken(user.id, token);

    res.json({
      code: 200,
      message: '微信登录成功',
      data: {
        token,
        userInfo: { 
          id: user.id, 
          username: user.username, 
          nickname: user.nickname || user.username, 
          avatar: user.avatar, 
          is_profile_completed: user.is_profile_completed 
        }
      }
    });

  } catch (error) {
    console.error('微信登录异常:', error);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

// 🚀 配置头像上传：基于内存暂存，处理后再落盘
const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 } // 限制 2MB 最大体积
});

// 🚀 头像图像压缩与落地接口
router.post('/upload-avatar', authMiddleware, uploadAvatar.single('avatar'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ code: 400, message: '请选择头像图片' });
  }

  const allowedMime = ['image/jpeg', 'image/png'];
  if (!allowedMime.includes(req.file.mimetype)) {
    return res.status(400).json({ code: 400, message: '只允许上传 JPG 或 PNG' });
  }

  try {
    const userId = req.user.userId;
    // 使用 userId 硬绑定命名，确保用户不论重传多少次都只覆盖同一个物理文件，防止产生孤儿文件占盘
    const fileName = `avatar-${userId}.png`;
    const avatarPath = path.join(__dirname, '../public/avatars', fileName);

    // 用 Sharp 将图转至规整 256x256 和 png 格式，写进物理磁盘
    await sharp(req.file.buffer)
      .resize(256, 256, { fit: 'cover' })
      .png()
      .toFile(avatarPath);

    const publicUrl = `/avatars/${fileName}`;

    res.json({
      code: 200, // 或者按标准传 0，为贴合项目习惯我们使用 HTTP 的 200 code
      message: '头像上传成功',
      data: { url: publicUrl }
    });
  } catch (error) {
    console.error('头压缩处理失败:', error);
    res.status(400).json({ code: 400, message: '无效的图像格式，解析失败' });
  }
});

// 🚀 补填用户信息 (Nickname & Avatar) 
router.put('/profile', authMiddleware, async (req, res) => {
  const { nickname, avatar } = req.body;
  const userId = req.user.userId;

  if (!nickname || !avatar) {
    return res.status(400).json({ code: 400, message: '昵称与头像不得为空' });
  }

  try {
    const db = await getDB();
    const oldUser = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    
    // 如果存在老的不同头像文件（确保是我们在管理的本地 /avatars 路径，同时不能包含防跨域 ..）
    const oldAvatarUrl = oldUser.avatar;
    if (oldAvatarUrl && oldAvatarUrl !== avatar && oldAvatarUrl.startsWith('/avatars/') && !oldAvatarUrl.includes('..')) {
      const oldFilePath = path.join(__dirname, '../public', oldAvatarUrl);
      if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
    }

    // 执行落库：将 nickname 存入独立字段，不覆盖 username（登录凭据）
    await db.run(
      'UPDATE users SET nickname = ?, avatar = ?, is_profile_completed = 1 WHERE id = ?',
      [nickname, avatar, userId]
    );

    const updatedUser = await db.get('SELECT * FROM users WHERE id = ?', [userId]);

    res.json({
      code: 200,
      message: '资料设置成功',
      data: {
        id: updatedUser.id,
        username: updatedUser.username,
        nickname: updatedUser.nickname,
        avatar: updatedUser.avatar,
        is_profile_completed: updatedUser.is_profile_completed
      }
    });

  } catch (err) {
    console.error('更新用户信息失败:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
  }
});

module.exports = router;