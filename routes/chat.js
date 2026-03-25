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
    // 支持自定义 model、文件内容注入
    const { messages, model, fileContent } = req.body;

    // 基本参数校验
    if (!messages || !Array.isArray(messages)) {
      res.write(`data: ${JSON.stringify({ error: '无效的 messages 格式' })}\n\n`);
      return res.end();
    }

    // 🚀 核心：若携带了文件内容，将其作为 system 消息注入上下文最前面
    const messagesWithContext = fileContent
      ? [
          {
            role: 'system',
            content: `以下是用户上传的文件内容，请结合这份内容回答用户的问题：\n\n${fileContent}`
          },
          ...messages
        ]
      : messages;

    // 3. 发起流式请求 (stream: true)
    const stream = await openai.chat.completions.create({
      // 兜底逻辑：若前端未传，默认使用 deepseek-chat
      model: model || 'deepseek-chat',
      messages: messagesWithContext,
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
// 🚀 新增：供给前端模型列表下拉选择器的数据端点
router.get('/models', async (req, res) => {
  try {
    // 采用硬编码白名单数组做轻量返回
    const availableModels = [
      { id: 'deepseek-chat', name: 'DeepSeek-V3 (推荐)', type: 'general' },
      { id: 'deepseek-reasoner', name: 'DeepSeek-R1 (推理增强)', type: 'reasoning' }
    ];
    res.json({ code: 200, message: 'success', data: availableModels });
  } catch (error) {
    res.status(500).json({ code: 500, message: '获取模型列表失败' });
  }
});

// 🚀 新增：获取当前用户的所有历史会话
router.get('/sessions', async (req, res) => {
  try {
    const userId = req.user.userId;
    const db = await getDB();
    const rows = await db.all('SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC', [userId]);

    const formattedSessions = rows.map(row => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updated_at,
      isPinned: Boolean(row.is_pinned), // 🚀 关键：转为前端认识的布尔值
      messages: JSON.parse(row.messages)
    }));
    res.json({ code: 200, message: 'success', data: formattedSessions });
  } catch (error) {
    res.status(500).json({ code: 500, message: '获取历史记录失败' });
  }
});

router.post('/sessions', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id, title, messages, updatedAt } = req.body;
    const db = await getDB();

    // --- 🚀 动态标题生成逻辑 ---
    let finalTitle = title;
    // 如果标题是默认值，或者是空的，尝试从消息中提取
    if (!finalTitle || finalTitle === '新对话' || finalTitle === 'New Chat') {
      const firstUserMsg = messages.find(m => m.role === 'user');
      if (firstUserMsg && firstUserMsg.content) {
        // 截取前 15 个字符
        const content = typeof firstUserMsg.content === 'string' 
          ? firstUserMsg.content 
          : (Array.isArray(firstUserMsg.content) ? '附件对话' : '');
          
        finalTitle = content.substring(0, 15);
        if (content.length > 15) finalTitle += '...';
      } else {
        finalTitle = 'New Chat';
      }
    }

    const existing = await db.get('SELECT id FROM chat_sessions WHERE id = ? AND user_id = ?', [id, userId]);

    if (existing) {
      await db.run(
        'UPDATE chat_sessions SET title = ?, messages = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        [finalTitle, JSON.stringify(messages), updatedAt || Date.now(), id, userId]
      );
    } else {
      await db.run(
        'INSERT INTO chat_sessions (id, user_id, title, messages, updated_at, is_pinned) VALUES (?, ?, ?, ?, ?, 0)',
        [id, userId, finalTitle, JSON.stringify(messages), updatedAt || Date.now()]
      );
    }
    res.json({ code: 200, message: '同步成功', data: { title: finalTitle } });
  } catch (error) {
    res.status(500).json({ code: 500, message: '保存记录失败' });
  }
});
router.put('/sessions/:id', async (req, res) => {
  try {
    const userId = req.user.userId;
    const sessionId = req.params.id;
    const { title, isPinned } = req.body; // 两个参数可选传
    const db = await getDB();

    const updates = [];
    const params = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
    }
    if (isPinned !== undefined) {
      updates.push('is_pinned = ?');
      params.push(isPinned ? 1 : 0);
      // 如果是取消置顶，将更新时间设为当前时间，让它按最新时间排序
      if (isPinned === false) {
        updates.push('updated_at = ?');
        params.push(Date.now());
      }
    }

    if (updates.length === 0) return res.status(400).json({ code: 400, message: '无更新字段' });

    params.push(sessionId, userId);
    const result = await db.run(`UPDATE chat_sessions SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`, params);

    if (result.changes === 0) return res.status(404).json({ code: 404, message: '对话不存在' });
    res.json({ code: 200, message: '更新成功' });
  } catch (error) {
    res.status(500).json({ code: 500, message: '更新失败' });
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
