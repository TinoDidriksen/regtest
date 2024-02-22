#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "inspect.pl => regtest.py -v inspect"
exec "$DIR/regtest.py" -v inspect "$@"
