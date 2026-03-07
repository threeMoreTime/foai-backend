# 使用轻量级的 Node Alpine 镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /usr/src/app

# 复制依赖清单并安装生产依赖
COPY package*.json ./
RUN npm install --only=production

# 复制源代码
COPY . .

# 暴露端口
EXPOSE 3000

# 启动服务
CMD ["node", "index.js"]