#!/usr/bin/env python3
"""Recompute each plugin's shared-markup guard lists from what its sources actually render.

Run after moving a component into this package: the class names it used to render locally
leave the plugin's allowlist, so the guard test keeps failing until they are gone for real.

    python3 scripts/refresh-markup-guards.py [path/to/plugins-parent-dir]
"""
import json, os, re, subprocess, sys

LIBRARY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(LIBRARY)

# Each plugin and the class prefix it renders with.
PLUGINS = [
    ("obsidian-llm-hub", "llm-hub"),
    ("obsidian-gemini-helper", "gemini-helper"),
    ("obsidian-local-llm-hub", "llm-hub"),
]

for name, prefix in PLUGINS:
    plugin_dir = os.path.join(ROOT, name)
    if not os.path.isdir(plugin_dir):
        print(f"{name}: not found under {ROOT}, skipped")
        continue
    out = subprocess.run(["node", "-e", f"""
import({json.dumps(os.path.join(LIBRARY, 'scripts/check-markup.mjs'))}).then(async m => {{
  const findings = await m.findSharedMarkup({{ dir: {json.dumps(os.path.join(plugin_dir, 'src'))}, classPrefix: '{prefix}' }});
  console.log(JSON.stringify([...new Set(findings.map(f => f.className.replace('{prefix}-', '')))].sort()));
}});"""], capture_output=True, text=True, check=True)
    found = set(json.loads(out.stdout))
    path = os.path.join(plugin_dir, "src/ui/components/sharedMarkup.test.ts")
    s = open(path).read()

    host_start = s.index("const HOST_OWNED = [")
    host_block = s[host_start:s.index("];", host_start)]
    # Keep a host-owned entry only while the plugin still renders it.
    host_owned = [c for c in re.findall(r'^  "([^"]+)",$', host_block, re.M) if c in found]
    migrating = sorted(found - set(host_owned))

    lines = []
    for c in host_owned:
        comment = re.search(r'^  // ([^\n]+)\n  "' + re.escape(c) + r'",$', host_block, re.M)
        lines.append((f"  // {comment.group(1)}\n" if comment else "") + f'  "{c}",')
    new_host = "const HOST_OWNED = [\n" + "\n".join(lines) + "\n];"
    new_migrating = (
        "const STILL_HOST_RENDERED: string[] = [\n" + "\n".join(f'  "{c}",' for c in migrating) + "\n];"
        if migrating else "const STILL_HOST_RENDERED: string[] = [];"
    )

    s = s[:host_start] + new_host + s[s.index("];", host_start) + 2:]
    start = s.index("const STILL_HOST_RENDERED")
    end = (s.index("];", start) + 2) if "[\n" in s[start:start + 60] else (s.index(";", start) + 1)
    open(path, "w").write(s[:start] + new_migrating + s[end:])
    print(f"{name}: host-owned {len(host_owned)}, still host-rendered {len(migrating)} {migrating[:6]}")
