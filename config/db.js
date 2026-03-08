// config/db.js
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

let dbInstance = null;

// 获取数据库连接（单例模式）
const getDB = async () => {
  if (!dbInstance) {
    dbInstance = await open({
      // 数据库文件将自动生成在项目根目录
      filename: path.join(__dirname, '../foai_data.sqlite'),
      driver: sqlite3.Database
    });

    // 自动建表：结构与前端的 chatSessions 对象完美对齐
    await dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        messages TEXT NOT NULL, -- 存储 JSON 格式的对话数组
        updated_at INTEGER NOT NULL
      )
    `);
    console.log('📦 SQLite 数据库已连接并完成建表检查');
  }
  return dbInstance;
};

module.exports = getDB;