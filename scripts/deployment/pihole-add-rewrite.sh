#!/bin/sh
# Add a local DNS rewrite for rustdeskserver.casaredes.cc → 192.168.1.105
# in Pi-hole v6 (pihole.toml format).
#
# Idempotent: checks if an entry already exists and skips if so. Backs up
# the config before editing.
set -eu

CFG=/etc/pihole/pihole.toml
TARGET_NAME="rustdeskserver.casaredes.cc"
TARGET_IP="192.168.1.105"

echo "=== Current dns.hosts section ==="
awk '/^\[dns\]/,/^\[.*\]/' "$CFG" | grep -A 20 'hosts =' | head -30 || true

if grep -q "$TARGET_NAME" "$CFG"; then
  echo ""
  echo "Entry for $TARGET_NAME already present. Nothing to do."
  grep -n "$TARGET_NAME" "$CFG"
  exit 0
fi

TS=$(date +%Y%m%d-%H%M%S)
cp "$CFG" "$CFG.bak-$TS"
echo "Backup: $CFG.bak-$TS"

# Pi-hole v6 stores custom host entries as a TOML array under [dns]:
#   hosts = [ "IP NAME", ... ]
# Either the array is empty `hosts = []` or has entries across lines.
# We want to add "192.168.1.105 rustdeskserver.casaredes.cc".
#
# awk: when we hit `hosts = []` replace with the filled version;
# when we hit `hosts = [` (multi-line form) insert our line after it.

python3 - <<PY
import re, io, sys
path = "$CFG"
entry = '"$TARGET_IP $TARGET_NAME"'
with open(path, "r", encoding="utf-8") as f:
    data = f.read()

# Case 1: hosts = []  → replace with hosts = [<entry>]
new = re.sub(r'hosts\s*=\s*\[\s*\]', f'hosts = [{entry}]', data, count=1)
if new != data:
    with open(path, "w", encoding="utf-8") as f:
        f.write(new)
    print("Inserted into empty hosts = [].")
    sys.exit(0)

# Case 2: hosts = [ \n "a b",\n "c d"\n ] — insert before the closing ]
# We only match inside the [dns] section.
dns_re = re.compile(r'(\[dns\][\s\S]*?)(\n\[)', re.MULTILINE)
m = dns_re.search(data)
if not m:
    print("Could not find [dns] section.", file=sys.stderr)
    sys.exit(1)
dns_block = m.group(1)
if "hosts" not in dns_block:
    print("[dns].hosts not present — adding.")
    new_dns = dns_block.rstrip() + f"\nhosts = [{entry}]\n"
else:
    # Insert inside the multi-line list. Find the matching ']'.
    # Simpler: replace the whole hosts=[ ... ] with a grown array.
    host_re = re.compile(r'hosts\s*=\s*\[([\s\S]*?)\]', re.MULTILINE)
    mh = host_re.search(dns_block)
    if not mh:
        print("Couldn't parse [dns].hosts, bailing.", file=sys.stderr)
        sys.exit(1)
    items_raw = mh.group(1).strip()
    # strip trailing comma if any
    if items_raw.endswith(','):
        items_raw = items_raw[:-1]
    if items_raw:
        new_hosts = f'hosts = [\n  {items_raw},\n  {entry},\n]'
    else:
        new_hosts = f'hosts = [{entry}]'
    new_dns = dns_block[:mh.start()] + new_hosts + dns_block[mh.end():]

new = data[:m.start(1)] + new_dns + data[m.end(1):]
with open(path, "w", encoding="utf-8") as f:
    f.write(new)
print("Added host override to [dns].hosts.")
PY

echo ""
echo "=== New hosts content ==="
grep -A 10 "^\[dns\]" "$CFG" | grep -A 5 "hosts" | head -15

echo ""
echo "Reloading Pi-hole..."
pihole restartdns reload-lists 2>/dev/null || pihole restartdns
echo "Done."
