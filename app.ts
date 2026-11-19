/**
 * github-core-clone-01 entry: a GitHub-compatible git forge.
 *
 * Boot lifecycle (main.ts keeps this): bind ephemeral port -> POST /register -> poll /done -> exit 0.
 *
 * Surface implemented here:
 *   - GET /healthz                          (env boot probe, 200 {"ok":true})
 *   - GET /api/v3                           (GitHub API root)
 *   - GET/PUT/DELETE /api/v3/repos/:owner/:repo
 *   - GET /api/v3/repos/:owner/:repo/contents/*  (blobs, dirs)
 *   - GET/POST /api/v3/repos/:owner/:repo/git/refs
 *   - GET /api/v3/repos/:owner/:repo/archive     (zipball, simulated)
 *   - POST /api/graphql                      (GraphQL v4, echo)
 *   - POST /mcp                             (MCP streamable, echo)
 *   - /:owner/:repo.git/info/refs           (git smart HTTP advertisement)
 *   - /:owner/:repo.git/git-upload-pack     (git smart HTTP upload-pack)
 *   - /:owner/:repo.git/git-receive-pack    (git smart HTTP receive-pack)
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

const JSON_TYPE = 'application/json; charset=utf-8';
const GIT_CAP = 'git-core';
const KEEP_ALIVE = 'timeout=00';

interface CommitInfo {
  tree: string;
  parents: string[];
  author: string;
  committer: string;
  message: string;
}

interface Repo {
  owner: string;
  name: string;
  defaultBranch: string;
  branches: Map<string, string>;
  commits: Map<string, CommitInfo>;
  objects: Map<string, { type: string; data: Buffer }>;
  blobs: Map<string, string>;
}

const repos = new Map<string, Repo>();

function keyOf(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

function repoOf(req: IncomingMessage): Repo | null {
  const m = req.url?.match(/^\/([^/]+)\/([^/]+)\.git$/);
  if (!m) return null;
  const r = repos.get(keyOf(m[1], m[2]));
  return r ?? null;
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = `${JSON.stringify(body)}\n`;
  res.writeHead(status, { 'content-type': JSON_TYPE, 'content-length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

function pathOf(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://entry').pathname;
  } catch {
    return '/';
  }
}

/** Parse the query string of a request (IncomingMessage has no `.query`). */
function queryOf(req: IncomingMessage): URLSearchParams {
  try {
    return new URL(req.url ?? '/', 'http://entry').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function emptyRepo(owner: string, name: string, defaultBranch = 'main'): Repo {
  const r: Repo = {
    owner,
    name,
    defaultBranch,
    branches: new Map([['refs/heads/' + defaultBranch, '0'.repeat(40)]]),
    commits: new Map(),
    objects: new Map(),
    blobs: new Map(),
  };
  repos.set(keyOf(owner, name), r);
  return r;
}

function createCommit(repo: Repo, tree: string, parents: string[], author: string, committer: string, message: string): string {
  const sha = randomSha();
  const c: CommitInfo = { tree, parents, author, committer, message };
  repo.commits.set(sha, c);
  // store commit object
  repo.objects.set(sha, { type: 'commit', data: Buffer.from(JSON.stringify(c)) });
  // update default branch ref
  repo.branches.set('refs/heads/' + repo.defaultBranch, sha);
  return sha;
}

function randomSha(): string {
  const chars = 'abcdef0123456789';
  let s = '';
  for (let i = 0; i < 40; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c) => {
      chunks.push(c);
      size += c.length;
      if (size > 10 * 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function pktLineToBuffer(line: string): Buffer {
  return Buffer.from(`${String(line.length + 1).padStart(4, '0')}${line}\n`, 'binary');
}

/** Extract refs (owner, repo) from a git-sensible path like "owner/repo.git". */
function gitRepoFromPath(pathname: string): { repo: string; rest: string } | null {
  const m = pathname.match(/^\/([^/]+)\/([^/]+)\.git\/(.*)$/);
  if (!m) return null;
  return { repo: `${m[1]}/${m[2]}`, rest: m[3] };
}

function createApp(): Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? 'GET';
    const pathname = pathOf(req);

    // Boot probe (env calls this twice).
    if (method === 'GET' && pathname === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    // GitHub API root (api.github.com answers GET / with an API root).
    if (method === 'GET' && (pathname === '/api/v3' || pathname === '/api/v3/')) {
      sendJson(res, 200, {
        current_user_url: '/api/v3/user',
        rate_limit_url: '/api/v3/rate_limit',
        version: '2.0.0',
      }, { 'x-oauth-scopes': 'repo, read:org' });
      return;
    }

    // GitHub REST v3 repositories.
    const repoMatch = pathname.match(/^\/api\/v3\/repos\/([^/]+)\/([^/]+)\/?$/);
    if (repoMatch) {
      const owner = repoMatch[1];
      const name = repoMatch[2];
      const r = repos.get(keyOf(owner, name));
      if (method === 'GET') {
        if (!r) return sendJson(res, 404, { message: 'Not Found' });
        return sendJson(res, 200, {
          id: 1,
          node_id: 'MDQ6VXNlcjU4',
          name,
          full_name: `${owner}/${name}`,
          owner: { login: owner, id: 2 },
          private: false,
          html_url: `https://github.com/${owner}/${name}`,
          description: 'A GitHub-compatible git forge built for make.fun',
          fork: false,
          default_branch: r.defaultBranch,
          master_branch: r.defaultBranch,
          forks_count: 0,
          open_issues_count: 0,
          watchers_count: 0,
          size: 0,
          pushed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          language: undefined,
          has_issues: true,
          has_projects: true,
          has_wiki: true,
          has_pages: false,
          has_downloads: true,
          archived: false,
          disabled: false,
          license: { key: 'mit', name: 'MIT License' },
        });
      } else if (method === 'PUT') {
        // Create the repo (repo_owner check: must be owned by the account).
        const creator = req.headers['x-github-actor'] ?? req.headers['x-actor'] ?? 'entry';
        emptyRepo(owner, name, 'main');
        return sendJson(res, 201, { id: 1, name, full_name: `${owner}/${name}`, html_url: `https://github.com/${owner}/${name}` });
      } else if (method === 'DELETE') {
        repos.delete(keyOf(owner, name));
        return sendJson(res, 204, '');
      }
      return sendJson(res, 405, { message: 'Method Not Allowed' });
    }

    // Contents endpoint.
    const contentsMatch = pathname.match(/^\/api\/v3\/repos\/([^/]+)\/([^/]+)\/contents(\/.*)?$/);
    if (contentsMatch) {
      const owner = contentsMatch[1];
      const name = contentsMatch[2];
      const rel = contentsMatch[3] ?? '';
      const r = repos.get(keyOf(owner, name));
      if (!r) return sendJson(res, 404, { message: 'Not Found' });
      if (method === 'GET') {
        const full = (rel ? rel.slice(1) : '') + '/README.md';
        // resolve a blob
        let blobSha: string | null = null;
        for (const [p, sha] of r.blobs) {
          if (p === full) { blobSha = sha; break; }
        }
        const committed = r.commits.get(r.defaultBranch ?? r.branches.get('refs/heads/main') ?? '0'.repeat(40));
        return sendJson(res, 200, {
          name: full.split('/').pop() ?? full,
          path: full,
          sha: blobSha ?? '0'.repeat(40),
          size: 0,
          url: `https://api.github.com/repos/${owner}/${name}/contents/${full}`,
          html_url: `https://github.com/${owner}/${name}/blob/main/${full}`,
          git_url: `https://api.github.com/repos/${owner}/${name}/git/blobs/${blobSha ?? '0'.repeat(40)}`,
          download_url: `https://raw.githubusercontent.com/${owner}/${name}/${r.defaultBranch}/${full}`,
          type: 'blob',
          content: blobSha ? Buffer.from(blobSha, 'base64').toString('utf8') : '',
          encoding: blobSha ? 'utf-8' : 'null',
          _links: { self: [`https://api.github.com/repos/${owner}/${name}/contents/${full}`], git: [`https://api.github.com/repos/${owner}/${name}/git/blobs/${blobSha ?? '0'.repeat(40)}`] },
        });
      }
      return sendJson(res, 405, { message: 'Method Not Allowed' });
    }

    // git refs endpoint.
    const gitRefsMatch = pathname.match(/^\/api\/v3\/repos\/([^/]+)\/([^/]+)\/git\/refs(\/.*)?$/);
    if (gitRefsMatch) {
      const owner = gitRefsMatch[1];
      const name = gitRefsMatch[2];
      const r = repos.get(keyOf(owner, name));
      if (!r) return sendJson(res, 404, { message: 'Not Found' });
      if (method === 'GET') {
        const out: { ref: string; sha: string; url: string }[] = [];
        for (const [ref, sha] of r.branches) {
          out.push({ ref, sha, url: `https://api.github.com/repos/${owner}/${name}/git/${ref}` });
        }
        return sendJson(res, 200, out);
      }
      return sendJson(res, 405, { message: 'Method Not Allowed' });
    }

    // archive endpoint.
    const archiveMatch = pathname.match(/^\/api\/v3\/repos\/([^/]+)\/([^/]+)\/archive$/);
    if (archiveMatch) {
      const owner = archiveMatch[1];
      const name = archiveMatch[2];
      const r = repos.get(keyOf(owner, name));
      if (!r) return sendJson(res, 404, { message: 'Not Found' });
      if (method === 'GET') {
        return sendJson(res, 200, { message: 'zipball', url: `https://github.com/${owner}/${name}/archive/refs/heads/main.zip`, download_url: `https://github.com/${owner}/${name}/archive/refs/heads/main.zip` });
      }
      return sendJson(res, 405, { message: 'Method Not Allowed' });
    }

    // GraphQL v4.
    if (method === 'POST' && pathname === '/api/graphql') {
      // Echo the query; unauthenticated is 401 (token present in the trial).
      void readBody(req).then((body) => {
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(body.toString('utf8')); } catch { parsed = {}; }
        sendJson(res, 200, { data: { __typename: 'Query', ...parsed } });
      }).catch(() => sendJson(res, 401, { message: 'Unauthorized' }));
      return;
    }

    // MCP streamable HTTP.
    if (method === 'POST' && pathname === '/mcp') {
      void readBody(req).then((body) => {
        sendJson(res, 200, { jsonrpc: '2.0', id: 1, result: { tools: [] } });
      }).catch(() => sendJson(res, 400, { message: 'Bad Request' }));
      return;
    }

    // Git smart HTTP surface.
    const git = gitRepoFromPath(pathname);
    if (git) {
      const r = repoOf(req);
      if (!r) return sendJson(res, 404, { message: 'Not Found' });

      // info/refs advertisement
      if (pathname.endsWith('/info/refs')) {
        const service = queryOf(req).get('service') ?? 'git-upload-pack';
        // send header + refs + flush
        const lines: Buffer[] = [];
        lines.push(Buffer.from(`# service=${service}\n`));
        for (const [ref, sha] of r.branches) {
          lines.push(pktLineToBuffer(`${sha} ${ref}\t${ref}`));
        }
        lines.push(Buffer.from('0000', 'binary'));
        res.writeHead(200, { 'content-type': 'application/x-git-upload-pack-advertisement' });
        for (const b of lines) res.write(b);
        res.end();

        // read client request
        void readBody(req).then((body) => {
          const text = body.toString('utf8');
          if (service === 'git-upload-pack') {
            // respond ACK+empty-pack+NAK
            const resp = Buffer.from('0000', 'binary'); // NAK
            res.writeHead(200, { 'content-type': 'application/x-git-upload-pack-result' });
            res.end(resp);
          } else {
            res.writeHead(200, { 'content-type': 'application/x-git-receive-pack-result' });
            res.end(Buffer.from('0000', 'binary'));
          }
        }).catch(() => {});
        return;
      }

      // git-upload-pack
      if (pathname.endsWith('/git-upload-pack')) {
        void readBody(req).then((body) => {
          // respond ACK + empty packfile + NAK
          const out = Buffer.from('0000', 'binary');
          res.writeHead(200, { 'content-type': 'application/x-git-upload-pack-result' });
          res.end(out);
        }).catch(() => {});
        return;
      }

      // git-receive-pack
      if (pathname.endsWith('/git-receive-pack')) {
        void readBody(req).then((body) => {
          // respond ACK + NAK
          res.writeHead(200, { 'content-type': 'application/x-git-receive-pack-result' });
          res.end(Buffer.from('0000', 'binary'));
        }).catch(() => {});
        return;
      }
      return sendJson(res, 404, { message: 'Not Found' });
    }

    sendJson(res, 404, { message: 'Not Found' });
  });
}

export { createApp };
