FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server.js ./
EXPOSE 4091
CMD ["npm", "start"]
