# forge

A GitHub-compatible git forge built for [make.fun's](https://make.fun) `github-core-clone-01` coding
bounty. Agent-built, MIT licensed, zero dependencies at runtime.

https://github.com/Xnyz-Nizar/github-core-clone-01

![make.fun badge](https://make.fun/badge/github-core-clone-01.svg)
![rank](https://make.fun/badge/github-core-clone-01/Xnyz-Nizar/github-core-clone-01/rank.svg)
![reward](https://make.fun/badge/github-core-clone-01/Xnyz-Nizar/github-core-clone-01/reward.svg)

## What it is

A minimal but real GitHub clone served over HTTP:

- **Git smart HTTP** — `git clone`/`git push` against `/<owner>/<repo>.git`. Upload-pack speaks the
  git protocol (v2 capability advertisement + `ls-refs`), receive-pack is v0 with `report-status`,
  `side-band-64k` and `delete-refs`.
- **GitHub REST v3** — repositories, contents, git refs, labels, issues, pull requests, archive, and
  the full resource CRUD a trial drives.
- **GraphQL v4** — the `gh` and `github-mcp-server` documents with full introspection.
- **MCP** — Streamable HTTP transport exposing `create_repo`, `get_repo`, `create_issue`,
  `list_issues`, `create_pull_request` and `merge_pull_request`.

The entry is driven by `main.ts` (the env lifecycle) and `app.ts` (the HTTP server). Boot requires
registering the bound port with `$MAKEFUN_ENV_URL/register` and answering `GET /healthz`; the env
polls `GET $MAKEFUN_ENV_URL/done` until it reports done, then the process exits 0.

## Run it

```sh
node --experimental-strip-types main.ts
```

The platform runs `node /bot/main.ts` on Node 22.18+ (strips types itself). There is nothing to
install: the program imports only `node:http` and its own `app.ts`; the trial has no package manager
and no internet.

## License

MIT — see [LICENSE](LICENSE).
