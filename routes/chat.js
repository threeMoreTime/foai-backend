// routes/chat.js
const express = require('express');
const { OpenAI } = require('openai');
const router = express.Router();
const getDB = require('../config/db');
// 1. 初始化 OpenAI 客户端，劫持 Base URL 指向 DeepSeek
const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com/v1', // DeepSeek 完全兼容 OpenAI 的接口规范
  apiKey: process.env.DEEPSEEK_API_KEY
});

router.post('/completions', async (req, res) => {
  // 2. 核心：设置 SSE (Server-Sent Events) 响应头，告诉前端这是一条流式数据
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const { messages } = req.body;

    // 基本参数校验
    if (!messages || !Array.isArray(messages)) {
      res.write(`data: ${JSON.stringify({ error: '无效的 messages 格式' })}\n\n`);
      return res.end();
    }

    // 3. 发起流式请求 (stream: true)
    const stream = await openai.chat.completions.create({
      model: 'deepseek-chat', // 使用 DeepSeek 的通用对话模型
      messages: messages,
      stream: true,
      temperature: 0.7 // 控制回答的创造性，0.7 是通用场景的推荐值
    });

    // 4. 异常监听：如果前端用户突然关闭页面或切换对话，立刻中止请求，节省服务器开销
    req.on('close', () => {
      console.log('⚠️ 客户端已断开连接，主动终止大模型请求');
      stream.controller.abort(); 
    });

    // 5. 将大模型吐出来的碎片 (chunk) 实时管道化推给前端
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        // 严格按照 SSE 规范拼装数据报文并推流
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    // 6. 数据流传输完毕，发送结束信号
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    console.error('❌ 大模型 API 请求异常:', error.message);
    // 发生错误时也要遵循 SSE 格式告诉前端
    res.write(`data: ${JSON.stringify({ error: 'AI 服务网络繁忙，请稍后再试' })}\n\n`);
    res.end();
  }
});
// 🚀 新增：获取当前用户的所有历史会话
router.get('/sessions', async (req, res) => {
  try {
    // req.user.userId 是我们之前在 authMiddleware 中解析出来的
    const userId = req.user.userId;
    const db = await getDB();
    
    // 按更新时间倒序查询
    const rows = await db.all(
      'SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC',
      [userId]
    );

    // 将查出来的 JSON 字符串还原成前端认识的数组结构
    const formattedSessions = rows.map(row => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updated_at,
      messages: JSON.parse(row.messages)
    }));

    res.json({ code: 200, message: 'success', data: formattedSessions });
  } catch (error) {
    console.error('查询历史记录失败:', error);
    res.status(500).json({ code: 500, message: '获取历史记录失败' });
  }
});

// 🚀 新增：保存或更新单个会话
router.post('/sessions', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id, title, messages, updatedAt } = req.body;

    if (!id || !messages) {
      return res.status(400).json({ code: 400, message: '参数不完整' });
    }

    const db = await getDB();
    
    // 使用 SQLite 的 INSERT OR REPLACE 语法实现“有则更新，无则插入” (Upsert)
    await db.run(
      `INSERT OR REPLACE INTO chat_sessions (id, user_id, title, messages, updated_at) 
       VALUES (?, ?, ?, ?, ?)`,
      [id, userId, title || '新对话', JSON.stringify(messages), updatedAt || Date.now()]
    );

    res.json({ code: 200, message: '同步成功' });
  } catch (error) {
    console.error('保存历史记录失败:', error);
    res.status(500).json({ code: 500, message: '保存记录失败' });
  }
});
router.delete('/sessions/:id', async (req, res) => {
  try {
    const userId = req.user.userId;
    const sessionId = req.params.id; // 从 URL 路径中提取要删除的对话 ID
    
    const db = await getDB();
    
    // 执行 SQL 删除：必须同时匹配 id 和 user_id，防止越权删除别人的对话
    await db.run(
      'DELETE FROM chat_sessions WHERE id = ? AND user_id = ?',
      [sessionId, userId]
    );

    res.json({ code: 200, message: '删除成功' });
  } catch (error) {
    console.error('删除历史记录失败:', error);
    res.status(500).json({ code: 500, message: '删除记录失败' });
  }
});

module.exports = router;
