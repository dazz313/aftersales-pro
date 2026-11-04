echo "=== ldd ==="
ldd /home/dazz/.local/bin/opencode 2>&1 | grep -i 'not found' | head
echo "=== version ==="
/home/dazz/.local/bin/opencode --version
echo "rc=$?"
echo "=== help head ==="
/home/dazz/.local/bin/opencode --help 2>&1 | head -20
