module.exports = {
  apps: [
    {
      name: 'foai-backend',
      script: './index.js',
      instances: 'max', // 根据服务器 CPU 核心数启动多个实例 (集群模式)
      exec_mode: 'cluster',
      watch: false, // 生产环境关闭文件监听
      max_memory_restart: '500M', // 内存占用超过 500M 自动重启，防止内存泄漏
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};