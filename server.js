const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GITLAB_TOKEN  = process.env.GITLAB_TOKEN;
const GITLAB_HOST   = (process.env.GITLAB_HOST || 'https://gitlab.com').replace(/\/$/, '');
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const PORT          = parseInt(process.env.PORT || '3000', 10);

// ── GitLab: fetch MR ──────────────────────────────────────────────────────
app.post('/api/fetch-gitlab-mr', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const m = url.match(/\/(.+?)\/-\/merge_requests\/(\d+)/);
  if (!m) return res.status(400).json({ error: 'Invalid GitLab MR URL. Expected: .../group/project/-/merge_requests/42' });

  const project = encodeURIComponent(m[1]);
  const iid = m[2];
  const headers = GITLAB_TOKEN ? { 'PRIVATE-TOKEN': GITLAB_TOKEN } : {};

  try {
    const [mrRes, changesRes] = await Promise.all([
      fetch(`${GITLAB_HOST}/api/v4/projects/${project}/merge_requests/${iid}`, { headers }),
      fetch(`${GITLAB_HOST}/api/v4/projects/${project}/merge_requests/${iid}/changes`, { headers })
    ]);
    if (!mrRes.ok) throw new Error(`GitLab API ${mrRes.status}: ${await mrRes.text()}`);
    if (!changesRes.ok) throw new Error(`GitLab API ${changesRes.status}: ${await changesRes.text()}`);

    const mr = await mrRes.json();
    const changes = await changesRes.json();
    const diff = (changes.changes || [])
      .map(f => `--- ${f.old_path}\n+++ ${f.new_path}\n${f.diff}`)
      .join('\n\n');

    res.json({
      title: mr.title,
      author: mr.author?.name || 'unknown',
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      state: mr.state,
      webUrl: mr.web_url,
      project,
      iid,
      fileCount: (changes.changes || []).length,
      diff
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GitHub: fetch PR ──────────────────────────────────────────────────────
app.post('/api/fetch-github-pr', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return res.status(400).json({ error: 'Invalid GitHub PR URL. Expected: github.com/owner/repo/pull/42' });

  const [, owner, repo, number] = m;
  const headers = {
    'Accept': 'application/vnd.github+json',
    ...(GITHUB_TOKEN ? { 'Authorization': `Bearer ${GITHUB_TOKEN}` } : {})
  };

  try {
    const [prRes, filesRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, { headers }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files`, { headers })
    ]);
    if (!prRes.ok) throw new Error(`GitHub API ${prRes.status}: ${await prRes.text()}`);
    if (!filesRes.ok) throw new Error(`GitHub API ${filesRes.status}: ${await filesRes.text()}`);

    const pr = await prRes.json();
    const files = await filesRes.json();
    const diff = files
      .map(f => `--- ${f.filename}\n+++ ${f.filename}\n${f.patch || ''}`)
      .join('\n\n');

    res.json({
      title: pr.title,
      author: pr.user?.login || 'unknown',
      headRef: pr.head?.ref,
      baseRef: pr.base?.ref,
      state: pr.state,
      merged: pr.merged,
      htmlUrl: pr.html_url,
      owner,
      repo,
      number,
      fileCount: files.length,
      diff
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Anthropic: run review ─────────────────────────────────────────────────
app.post('/api/review', async (req, res) => {
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in .env' });
  }

  const { diff, mrTitle, mrAuthor, mrBranch, rules, customEslint } = req.body;
  if (!diff) return res.status(400).json({ error: 'diff is required' });

  const eslintBlock = customEslint || `{
  "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-non-null-assertion": "warn"
}`;

  const truncated = diff.length > 14000 ? diff.slice(0, 14000) + '\n\n[diff truncated]' : diff;

  const system = `You are a senior code reviewer for a Node.js/TypeScript/MongoDB backend team.

ESLint config:
${eslintBlock}

Return ONLY valid JSON, no markdown fences, no preamble:
{
  "summary": "2-3 sentence overall assessment",
  "score": <number 0-100>,
  "errors": <count>,
  "warnings": <count>,
  "suggestions": <count>,
  "markdownComment": "Formatted markdown suitable to post as a MR/PR comment. Include a score badge, summary, and findings with code blocks.",
  "findings": [
    {
      "severity": "error|warning|info|suggestion",
      "rule": "rule or category name",
      "message": "clear issue description",
      "fix": "specific actionable fix",
      "codeSnippet": "problematic code or empty string"
    }
  ]
}

Focus areas: ${(rules || []).join(', ')}.
Check: ESLint violations per config above, MongoDB anti-patterns (missing .lean() on reads, missing await, no error handling on DB ops, missing projections, unindexed queries), async/await bugs, unhandled promises, missing try/catch, TypeScript type safety, security issues (hardcoded secrets, NoSQL injection, unvalidated inputs), logic bugs, code style violations.`;

  const userMsg = [
    mrTitle  && `MR/PR: ${mrTitle}`,
    mrAuthor && `Author: ${mrAuthor}`,
    mrBranch && `Branch: ${mrBranch}`,
    `\nDiff:\n${truncated}`
  ].filter(Boolean).join('\n');

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system,
        messages: [{ role: 'user', content: userMsg }]
      })
    });

    const data = await apiRes.json();
    if (data.error) throw new Error(data.error.message);
    const raw = data.content?.find(b => b.type === 'text')?.text || '';
    res.json(JSON.parse(raw.replace(/```json|```/g, '').trim()));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GitLab: post comment ──────────────────────────────────────────────────
app.post('/api/post-gitlab-comment', async (req, res) => {
  if (!GITLAB_TOKEN) return res.status(500).json({ error: 'GITLAB_TOKEN is not set in .env' });

  const { project, iid, body, webUrl } = req.body;
  if (!project || !iid || !body) {
    return res.status(400).json({ error: 'project, iid and body are required' });
  }

  try {
    const apiRes = await fetch(
      `${GITLAB_HOST}/api/v4/projects/${project}/merge_requests/${iid}/notes`,
      {
        method: 'POST',
        headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body })
      }
    );
    if (!apiRes.ok) throw new Error('GitLab returned ' + apiRes.status);
    const note = await apiRes.json();
    res.json({ noteId: note.id, webUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GitHub: post comment ──────────────────────────────────────────────────
app.post('/api/post-github-comment', async (req, res) => {
  if (!GITHUB_TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN is not set in .env' });

  const { owner, repo, number, body } = req.body;
  if (!owner || !repo || !number || !body) {
    return res.status(400).json({ error: 'owner, repo, number and body are required' });
  }

  try {
    const apiRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github+json'
        },
        body: JSON.stringify({ body })
      }
    );
    if (!apiRes.ok) throw new Error('GitHub returned ' + apiRes.status);
    const comment = await apiRes.json();
    res.json({ htmlUrl: comment.html_url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`MR Review Assistant → http://localhost:${PORT}`);
  if (!ANTHROPIC_KEY) console.warn('  ⚠  ANTHROPIC_API_KEY not set in .env');
  if (!GITLAB_TOKEN)  console.warn('  ⚠  GITLAB_TOKEN not set in .env (GitLab reviews disabled)');
  if (!GITHUB_TOKEN)  console.warn('  ⚠  GITHUB_TOKEN not set in .env (GitHub reviews disabled)');
});
