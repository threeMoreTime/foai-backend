// utils/tokenManager.js
/**
 * 用于管理活跃用户的真实 Token 映射
 * 强制执行单点登录 (SSO) 踢出逻辑
 */

// 内存中维护 userId -> currentToken 的映射
// 生产环境建议迁移至 Redis
const activeSessions = new Map();

const tokenManager = {
  /**
   * 设置最新 Token
   * @param {string|number} userId 用户 ID
   * @param {string} token 当前登录生成的最新 JWT
   */
  setToken(userId, token) {
    activeSessions.set(String(userId), token);
  },

  /**
   * 获取当前合法 Token
   * @param {string|number} userId 用户 ID
   * @returns {string|null}
   */
  getToken(userId) {
    return activeSessions.get(String(userId)) || null;
  },

  /**
   * 移除 Session (退出登录时调用)
   * @param {string|number} userId 用户 ID
   */
  removeToken(userId) {
    activeSessions.delete(String(userId));
  }
};

module.exports = tokenManager;
