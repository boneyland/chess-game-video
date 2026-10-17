#!/bin/sh
# Codeberg Pages: builds the site, commits it to the `pages` branch (the page as index.html, next to the two
# Stockfish files) and pushes main and pages to the `codeberg` remote. Pages serves that branch at
# https://<user>.codeberg.page/<repo>/. Usage: ./pages.sh [--no-push]
set -eu
cd "$(dirname "$0")"
[ -z "$(git status --porcelain -- app src vendor openings openings-data.cjs babel build.cjs)" ] || { echo 'pages.sh: commit the page sources first' >&2; exit 1; }
node build.cjs
wt=$(mktemp -d)
trap 'git worktree remove --force "$wt"' EXIT
if git rev-parse -q --verify refs/heads/pages >/dev/null; then git worktree add -q "$wt" pages
else git worktree add -q --orphan -b pages "$wt"; fi
git -C "$wt" rm -rqf --ignore-unmatch .
cp out/site/chess-game-video.html "$wt/index.html"
cp out/site/stockfish-19-lite-single.js out/site/stockfish-19-lite-single.wasm LICENSE "$wt/"
git -C "$wt" add -A
if git -C "$wt" diff --cached --quiet; then echo 'pages.sh: site unchanged'
else git -C "$wt" commit -qm "site built from main $(git rev-parse --short HEAD)"; fi
[ "${1:-}" = --no-push ] || git push codeberg main pages
