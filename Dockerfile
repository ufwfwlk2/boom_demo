ARG NGINX_IMAGE=docker.m.daocloud.io/library/nginx:alpine
FROM ${NGINX_IMAGE}

WORKDIR /usr/share/nginx/html

RUN rm -rf /usr/share/nginx/html/* && \
    mkdir -p /usr/share/nginx/html/heykool-ops-workbench

# dist 目录通过 podman.yml volume 挂载到：
# /usr/share/nginx/html/heykool-ops-workbench
COPY nginx.conf /etc/nginx/nginx.conf
COPY docker-entrypoint.d/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh

RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 3002

CMD ["nginx", "-g", "daemon off;"]
