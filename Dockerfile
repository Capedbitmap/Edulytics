
FROM node:18-bullseye


RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-base \
    texlive-latex-base \
    texlive-fonts-recommended \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app


COPY package*.json ./
RUN npm install


COPY . .


RUN mkdir -p server/tmp/uploads && chmod -R 777 server/tmp/uploads


EXPOSE 8080


CMD ["node", "server/server.js"]