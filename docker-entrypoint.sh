#!/bin/bash
set -e

# Start Inbucket in background if not disabled
if [ "$DISABLE_INBUCKET" != "true" ]; then
    echo "Starting Inbucket..."
    inbucket &
    sleep 2
fi

# Execute the command
exec "$@"
