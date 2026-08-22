# zgalaxy-rs client builder — the native Rust replacement for the ZeroTier
# C++ client. One static musl binary provides zerotier-one / zerotier-cli /
# zerotier-idtool / mkmoonworld behavior (argv0 dispatch in zgalaxy-rs).
FROM rust:alpine AS ztclient
RUN apk add --no-cache git musl-dev
ARG ZGRS_REPO=https://github.com/dreamzone-cc/zgalaxy-rs.git
ARG ZGRS_REF=main
RUN git clone --depth 1 "${ZGRS_REPO}" /src \
    && cd /src \
    && (git fetch --depth 1 origin "${ZGRS_REF}" && git checkout FETCH_HEAD || true) \
    && cargo build --release

FROM alpine:3.14 as builder

ENV TZ=Asia/Shanghai

WORKDIR /app
ADD ./entrypoint.sh /app/entrypoint.sh

# init tool
RUN set -x\
    && apk update\
    && apk add --no-cache git python3 npm make g++ linux-headers curl pkgconfig openssl-dev  jq build-base  gcc \
    && echo "env prepare success!"

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
ENV TZ=Asia/Shanghai

# Single Rust binary behind the classic ZeroTier binary names. The entrypoint
# and the engine call zerotier-idtool / mkmoonworld-x86_64 / zerotier-one
# exactly as before — zgalaxy-rs dispatches on argv0 and subcommand.
COPY --from=ztclient /src/target/release/zgalaxy-rs /usr/sbin/zerotier-one
COPY --from=builder /app/entrypoint.sh /app/entrypoint.sh
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
    && ln -sf /usr/sbin/zerotier-one /usr/sbin/zerotier-cli \
    && ln -sf /usr/sbin/zerotier-one /usr/sbin/zerotier-idtool \
    && ln -sf /usr/sbin/zerotier-one /app/mkmoonworld-x86_64 \
    && ln -sf /usr/sbin/zerotier-one /usr/local/bin/zgalaxy-rs \
    && chmod +x /app/entrypoint.sh

# Health check against the engine readiness endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${ENGINE_PORT}/api/v1/ready >/dev/null || exit 1


VOLUME [ "/app/dist","/var/lib/zerotier-one","/app/config"]

CMD ["/bin/sh","/app/entrypoint.sh"]
