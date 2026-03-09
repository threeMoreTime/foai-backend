// config/db.js
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

let dbInstance = null;

// 获取数据库连接（单例模式）
const getDB = async () => {
  if (!dbInstance) {
    dbInstance = await open({
      filename: path.join(__dirname, '../foai_data.sqlite'),
      driver: sqlite3.Database
    });

    // 1. 创建表（新增了 is_pinned INTEGER DEFAULT 0）
    await dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        messages TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        is_pinned INTEGER DEFAULT 0 
      )
    `);

    // 2. 🚀 无损升级老数据表：尝试为旧表添加 is_pinned 字段
    try {
      await dbInstance.exec('ALTER TABLE chat_sessions ADD COLUMN is_pinned INTEGER DEFAULT 0');
      console.log('🔄 数据库表结构已自动升级：新增 is_pinned 字段');
    } catch (e) {
      // 如果报错，说明字段已经存在，静默忽略即可
    }
    
    console.log('📦 SQLite 数据库已连接并完成建表检查');
  }
  return dbInstance;
};

module.exports = getDB;