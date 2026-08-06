FROM alpine:3.14 as builder

ENV TZ=Asia/Shanghai
ARG TAG=main
ENV TAG=${TAG}

WORKDIR /app
ADD ./entrypoint.sh /app/entrypoint.sh
ADD ./http_server.js /app/http_server.js
ADD ./mkmoonworld-x86_64 /app/mkmoonworld-x86_64

# init tool
RUN set -x\
    && apk update\
    && apk add --no-cache git python3 npm make g++ linux-headers curl pkgconfig openssl-dev  jq build-base  gcc \
    && echo "env prepare success!"

# make zerotier-one
RUN set -x\
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y\
    && source "$HOME/.cargo/env"\
    && git clone https://github.com/zerotier/ZeroTierOne.git\
    && cd ZeroTierOne\
    && git checkout ${TAG}\
    && echo "切换到tag:${TAG}"\
    && make ZT_SYMLINK=1 \
    && make\
    && make install\
    && echo "make success!"\
    ; zerotier-one -d  \
    ; sleep 5s && ps -ef |grep zerotier-one |grep -v grep |awk '{print $1}' |xargs kill -9\
    && echo "zerotier-one init success!"


# make zerotier-planet-moon-engine
ADD ./package.json /app/package.json
ADD ./tsconfig.json /app/tsconfig.json
ADD ./src /app/src
ADD ./docs /app/docs
RUN cd /app && npm install && npm run build

# build the ZGALAXY web console (SvelteKit adapter-node)
ADD ./web-console/package.json /app/web-console/package.json
ADD ./web-console/svelte.config.js /app/web-console/svelte.config.js
ADD ./web-console/vite.config.ts /app/web-console/vite.config.ts
ADD ./web-console/tsconfig.json /app/web-console/tsconfig.json
ADD ./web-console/src /app/web-console/src
ADD ./web-console/static /app/web-console/static
RUN cd /app/web-console && npm install && npm run build

FROM alpine:3.14

WORKDIR /app

ENV IP_ADDR4=''
ENV IP_ADDR6=''

ENV ZT_PORT=9994
ENV ENGINE_PORT=3000
ENV CONSOLE_PORT=5173
ENV FILE_SERVER_PORT=3000
ENV TZ=Asia/Shanghai

COPY --from=builder /var/lib/zerotier-one /bak/zerotier-one

COPY --from=builder /app/ZeroTierOne/zerotier-one /usr/sbin/zerotier-one
COPY --from=builder /app/ZeroTierOne/zerotier-idtool /usr/sbin/zerotier-idtool
COPY --from=builder /app/ZeroTierOne/zerotier-cli /usr/sbin/zerotier-cli
COPY --from=builder /app/entrypoint.sh /app/entrypoint.sh
COPY --from=builder /app/mkmoonworld-x86_64 /app/mkmoonworld-x86_64
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/src /app/src
COPY --from=builder /app/dist_engine /app/dist_engine
COPY --from=builder /app/docs /app/docs
COPY --from=builder /app/web-console/build /app/web-console/build
COPY --from=builder /app/web-console/package.json /app/web-console/package.json

# Install Bun (default runtime for ZGALAXY)
RUN set -x ;sed -i 's/dl-cdn.alpinelinux.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apk/repositories \
    && apk update \
    && apk add --no-cache curl jq openssl ca-certificates\
    && curl -fsSL https://bun.sh/install | bash \
    && mkdir -p /app/config /app/web-console \
    && ln -sf ~/.bun/bin/bun /usr/local/bin/bun \
    && chmod +x /app/entrypoint.sh

# Health check against the engine readiness endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${ENGINE_PORT}/api/v1/ready >/dev/null || exit 1


VOLUME [ "/app/dist","/var/lib/zerotier-one","/app/config"]

CMD ["/bin/sh","/app/entrypoint.sh"]
