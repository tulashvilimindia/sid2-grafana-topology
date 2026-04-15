#!/bin/sh

# Start supervisord which manages grafana
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
