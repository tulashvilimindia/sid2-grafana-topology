ARG grafana_version=latest
ARG grafana_image=grafana-enterprise

FROM grafana/${grafana_image}:${grafana_version}

# Make it as simple as possible to access the grafana instance for development purposes
# Do NOT enable these settings in a public facing / production grafana instance
ENV GF_AUTH_ANONYMOUS_ORG_ROLE "Admin"
ENV GF_AUTH_ANONYMOUS_ENABLED "true"
ENV GF_AUTH_BASIC_ENABLED "false"
# Set development mode so plugins can be loaded without signed check
ENV GF_DEFAULT_APP_MODE "development"

USER root

# Install supervisor
RUN if [ -f /sbin/apk ]; then \
      apk add --no-cache supervisor; \
    elif [ -f /usr/bin/apt-get ]; then \
      apt-get update && apt-get install -y supervisor && rm -rf /var/lib/apt/lists/*; \
    fi

COPY supervisord/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
