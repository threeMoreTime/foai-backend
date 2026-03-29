// config/db.js
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

let dbInstance = null;

const getDB = async () => {
  if (!dbInstance) {
    dbInstance = await open({
      filename: path.join(__dirname, '../foai_data.sqlite'),
      driver: sqlite3.Database
    });

    await dbInstance.exec('PRAGMA journal_mode = WAL');

    // 1. 创建表（确保字段在创建阶段就已完整定义）
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

    await dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // 🚀 删除了原来的 ALTER TABLE 逻辑，防止重复操作报错

    const adminUser = await dbInstance.get('SELECT * FROM users WHERE username = ?', ['admin']);
    if (!adminUser) {
      const bcrypt = require('bcryptjs');
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash('admin123', salt);
      await dbInstance.run(
        'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)',
        ['admin-uuid-static', 'admin', hash, Date.now()]
      );
      console.log('✅ 已完成 admin 用户初始化');
    }
    
    console.log('📦 SQLite 数据库已连接并完成表结构初始化');
  }
  return dbInstance;
};

module.exports = getDB;