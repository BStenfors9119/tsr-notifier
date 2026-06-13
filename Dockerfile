FROM node:16-alpine3.18
COPY package.json /tmp
WORKDIR /tmp
RUN npm i -g npm
RUN npm install --legacy-peer-deps

COPY . /tmp
WORKDIR /tmp

ENV NODE_ENV='production'
ENTRYPOINT ["npm", "start"]
