export HERMES_LOG_LEVEL=DEBUG
hermes chat -q "Balas hanya: OK" 2>&1 | grep -iE 'error|fail|connect|base_url|401|404|timeout|refused' | head -30
