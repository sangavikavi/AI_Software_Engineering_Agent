FROM node:20-alpine

WORKDIR /app

# Copy package.json and lock file (if exists)
COPY package.json ./

# Install dependencies
RUN npm install

# Copy application files
COPY . .

# Expose Vite dev server port
EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]
