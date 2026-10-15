FROM node:22-slim

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

# Ensure upload directory and backups directory exist
RUN mkdir -p public/uploads backups

ENV PORT=7860
ENV NODE_ENV=production
EXPOSE 7860

CMD ["node", "server.js"]
