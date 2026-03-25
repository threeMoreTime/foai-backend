const express = require('express');
const multer = require('multer');
const path = require('path');
const { OpenAI } = require('openai'); // 🚀 引入 OpenAI 客户端
const router = express.Router();

// 初始化 OpenAI 客户端 (对接 DeepSeek)
const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY
});

// 使用内存存储，文件不落磁盘
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 单文件最大 50MB
});

// 根据扩展名判断文件类别
const getFileCategory = (filename, mimetype) => {
  const ext = path.extname(filename).toLowerCase();
  if (['.jpg', '.jpeg', '.png'].includes(ext) || mimetype.startsWith('image/')) return 'image';
  if (ext === '.pdf' || mimetype === 'application/pdf') return 'pdf';
  if (['.docx'].includes(ext)) return 'docx';
  if (['.xlsx'].includes(ext)) return 'xlsx';
  if (['.csv'].includes(ext) || mimetype === 'text/csv') return 'csv';
  // txt / md / 各类代码文件统一当纯文本处理
  return 'text';
};

// PDF 解析
const parsePdf = async (buffer) => {
  const pdfParse = require('pdf-parse');
  const result = await pdfParse(buffer);
  return result.text;
};

// DOCX 解析
const parseDocx = async (buffer) => {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
};

// Excel 解析
const parseXlsx = (buffer) => {
  const XLSX = require('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  let allText = '';
  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    allText += `\n--- Sheet: ${sheetName} ---\n`;
    allText += XLSX.utils.sheet_to_csv(sheet);
  });
  return allText;
};

// 图片 OCR 解析
const parseImage = async (buffer, mimetype) => {
  const { createWorker } = require('tesseract.js');
  const worker = await createWorker('chi_sim+eng'); // 中英文双语识别
  // 将 buffer 转为 base64 Data URL 传给 Tesseract
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mimetype};base64,${base64}`;
  const { data: { text } } = await worker.recognize(dataUrl);
  await worker.terminate();
  return text;
};

// 🚀 新增：利用 AI 进行语义纠错与格式优化
const aiRefineText = async (rawText, category) => {
  if (!rawText || rawText.length < 5) return rawText; // 太短就没必要纠错

  try {
    const response = await openai.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: '你是一个文本修复专家。用户会给你一段由 OCR 或文档解析工具提取的原始文本，其中可能包含由于识别错误导致的错别字、多余空格或排版混乱。请在不修改原意的前提下，修复错别字并自动重排版。如果文本本身已经很清晰，则原样返回。直接返回修复后的纯文本，不要包含任何解释。'
        },
        {
          role: 'user',
          content: rawText
        }
      ],
      temperature: 0.3, // 低随机性确保严谨
      stream: false
    });

    return response.choices[0].message.content.trim() || rawText;
  } catch (err) {
    console.error('⚠️ [AI Refine] 纠错失败:', err.message);
    return rawText; // 失败则降级返回原始文本，不阻塞流程
  }
};

// 🚀 核心接口：POST /api/chat/upload
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ code: 400, message: '未检测到上传文件' });
    }

    const { originalname, mimetype, buffer } = req.file;
    const category = getFileCategory(originalname, mimetype);
    let extractedText = '';

    console.log(`📎 [Upload] 处理文件: ${originalname} (${category})`);

    switch (category) {
      case 'pdf':
        extractedText = await parsePdf(buffer);
        break;
      case 'docx':
        extractedText = await parseDocx(buffer);
        break;
      case 'xlsx':
        extractedText = parseXlsx(buffer);
        break;
      case 'image':
        extractedText = await parseImage(buffer, mimetype);
        break;
      case 'csv':
      case 'text':
      default:
        // 纯文本类直接转 UTF-8 字符串
        extractedText = buffer.toString('utf-8');
        break;
    }

    // 截断防止超长上下文（最多取前 8000 字）
    if (extractedText.length > 8000) {
      extractedText = extractedText.slice(0, 8000) + '\n\n...[内容过长，已截断至前 8000 字]';
    }

    // 🚀 核心逻辑落地：如果是图片 OCR 或 PDF，执行 AI 语义纠错
    if (category === 'image' || category === 'pdf') {
      console.log(`🤖 [AI Refine] 正在对 ${category} 内容进行语义优化...`);
      extractedText = await aiRefineText(extractedText, category);
    }

    res.json({
      code: 200,
      message: '文件解析成功',
      data: {
        fileName: originalname,
        category,
        text: extractedText.trim()
      }
    });

  } catch (error) {
    console.error('❌ [Upload] 文件解析失败:', error.message);
    res.status(500).json({ code: 500, message: `文件解析失败: ${error.message}` });
  }
});

module.exports = router;
