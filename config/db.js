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

    // 🚀 开启高性能 WAL (Write-Ahead Logging) 模式
    // 支持并发读写，防止多用户同时操作时数据库锁定 (SQLITE_BUSY)
    await dbInstance.exec('PRAGMA journal_mode = WAL');

    // 1. 创建表
    // 聊天会话表
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

    // 用户表
    await dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // 2. 🚀 数据库升级与数据迁移
    try {
      // 升级会话表增加字段
      await dbInstance.exec('ALTER TABLE chat_sessions ADD COLUMN is_pinned INTEGER DEFAULT 0');
    } catch (e) {}

    // 3. 迁移并保留原有的 admin 用户 (如果不存在)
    const adminUser = await dbInstance.get('SELECT * FROM users WHERE username = ?', ['admin']);
    if (!adminUser) {
      const bcrypt = require('bcryptjs');
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash('admin123', salt); // 默认原始密码 admin123
      await dbInstance.run(
        'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
        ['admin-uuid-static', 'admin', hash, Date.now()]
      );
      console.log('✅ 已将原始 admin 用户迁移至数据库（默认密码：admin123）');
    }
    
    console.log('📦 SQLite 数据库已连接并完成表结构初始化');
  }
  return dbInstance;
};

module.exports = getDB;