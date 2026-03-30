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

    // 🚀 安全动态升级现存表结构
    const tableInfo = await dbInstance.all("PRAGMA table_info(users)");
    const columns = tableInfo.map(col => col.name);
    
    if (!columns.includes('openid')) {
      await dbInstance.exec('ALTER TABLE users ADD COLUMN openid TEXT');
      // 可选：为 openid 单独建索引以替代 UNIQUE 约束（SQLite 允许分开建索引）
      await dbInstance.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_openid ON users(openid) WHERE openid IS NOT NULL');
      console.log('✅ 已补充 openid 字段及索引');
    }
    if (!columns.includes('avatar')) {
      await dbInstance.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
      console.log('✅ 已补充 avatar 字段');
    }
    if (!columns.includes('is_profile_completed')) {
      await dbInstance.exec('ALTER TABLE users ADD COLUMN is_profile_completed INTEGER DEFAULT 1');
      console.log('✅ 已补充 is_profile_completed 字段');
    }
    // 🚀 独立 nickname 字段：与 username（登录凭据）解耦，避免补录时覆盖登录账号
    if (!columns.includes('nickname')) {
      await dbInstance.exec('ALTER TABLE users ADD COLUMN nickname TEXT');
      console.log('✅ 已补充 nickname 字段');
    }
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