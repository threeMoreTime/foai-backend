// routes/chat.js
const express = require('express');
const { OpenAI } = require('openai');
const router = express.Router();

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

module.exports = router;