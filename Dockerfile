# Node-RED server with Keeper plugin.
#
# VERSION 0.1

FROM node:5-onbuild

MAINTAINER Nicolas Carlier <https://github.com/ncarlier>

RUN npm install -g --unsafe-perm node-red && \
    mkdir ~/.node-red && \
    npm link

RUN cd ~/.node-red && npm link node-red-contrib-keeper

# Ports
EXPOSE 1880

ENTRYPOINT ["node-red"]

