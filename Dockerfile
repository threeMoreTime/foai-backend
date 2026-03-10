# 1. 使用官方极其轻量级的 Node 18 Alpine 版本作为基础系统
FROM node:18-alpine

# 2. 设置容器内部的工作目录
WORKDIR /app

# 3. 极其关键：先仅仅复制 package.json，利用 Docker 的分层缓存机制，
# 只要你的依赖没变，下次打包就会瞬间完成
COPY package*.json ./

# 4. 在容器内部安装依赖（只安装生产环境需要的包）
RUN npm install --production

# 5. 把你的业务代码全量复制到容器内（此时会被 .dockerignore 过滤掉不需要的）
COPY . .

# 6. 声明容器即将暴露的端口（对应你 index.js 里的 3000）
EXPOSE 3000

# 7. 容器启动时默认执行的命令（Docker 会在后台自动守护这个进程，相当于替代了 PM2）
CMD ["node", "index.js"]