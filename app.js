// State
let mrData = null;
let diffText = '';
let reviewResult = null;
let activeTab = 'gitlab';

// Tabs
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    activeTab = t.dataset.tab;
    document.getElementById('tab-' + activeTab).classList.add('active');
    resetMR();
  });
});

// Chips
document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => c.classList.toggle('on')));

// Helpers
const $ = id => document.getElementById(id);
const getHost = () => ($('gl-host').value || 'https://gitlab.com').replace(/\/$/, '');
const getToken = () => $('gl-token').value.trim();
const getAnthropicKey = () => $('anthropic-key').value.trim();
const getActiveRules = () => [...document.querySelectorAll('.chip.on')].map(c => c.dataset.rule);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function setStatus(type, msg) {
  $('mr-status').classList.remove('hidden');
  $('status-dot').className = 'dot ' + type;
  $('status-txt').textContent = msg;
}

function resetMR() {
  mrData = null; diffText = '';
  $('mr-preview').classList.add('hidden');
  $('mr-status').classList.add('hidden');
  $('output').innerHTML = '';
}

function parseMRUrl(url) {
  const m = url.match(/gitlab\.com\/(.+?)\/-\/merge_requests\/(\d+)/);
  if (!m) return null;
  return { project: encodeURIComponent(m[1]), iid: m[2] };
}

async function glFetch(path) {
  const token = getToken();
  const res = await fetch(`${getHost()}/api/v4${path}`, {
    headers: token ? { 'PRIVATE-TOKEN': token } : {}
  });
  if (!res.ok) throw new Error(`GitLab API ${res.status}: ${await res.text()}`);
  return res.json();
}

// Fetch MR
async function fetchMR() {
  const url = $('mr-url').value.trim();
  if (!url) return;
  const parsed = parseMRUrl(url);
  if (!parsed) { setStatus('err', 'Invalid GitLab MR URL. Expected: gitlab.com/group/project/-/merge_requests/42'); return; }

  $('fetch-btn').disabled = true;
  setStatus('spin', 'Fetching MR from GitLab...');
  $('mr-preview').classList.add('hidden');

  try {
    const [mr, changes] = await Promise.all([
      glFetch(`/projects/${parsed.project}/merge_requests/${parsed.iid}`),
      glFetch(`/projects/${parsed.project}/merge_requests/${parsed.iid}/changes`)
    ]);
    mrData = { ...mr, project: parsed.project, iid: parsed.iid };
    diffText = (changes.changes || []).map(f => `--- ${f.old_path}\n+++ ${f.new_path}\n${f.diff}`).join('\n\n');

    const sc = mr.state === 'opened' ? 'pill-open' : mr.state === 'merged' ? 'pill-merged' : 'pill-closed';
    $('mr-preview').innerHTML = `
      <div class="mr-preview">
        <div class="mr-preview-title">${esc(mr.title)}</div>
        <div class="mr-preview-meta">
          <span class="pill ${sc}">${mr.state}</span>
          <span>by ${esc(mr.author?.name || 'unknown')}</span>
          <span>${esc(mr.source_branch)} → ${esc(mr.target_branch)}</span>
          <span>${(changes.changes || []).length} files changed</span>
        </div>
      </div>`;
    $('mr-preview').classList.remove('hidden');
    setStatus('ok', `Fetched — ${(changes.changes || []).length} files loaded`);
  } catch(e) {
    setStatus('err', e.message);
  } finally {
    $('fetch-btn').disabled = false;
  }
}

// Run Review
async function runReview() {
  const apiKey = getAnthropicKey();
  if (!apiKey) { $('output').innerHTML = '<div class="err-box">Please enter your Anthropic API key in Step 1.</div>'; return; }

  let diff = '';
  let mrTitle = '';
  let mrAuthor = '';
  let mrBranch = '';

  if (activeTab === 'gitlab') {
    if (!diffText) { $('output').innerHTML = '<div class="err-box">Please fetch an MR first.</div>'; return; }
    diff = diffText;
    mrTitle = mrData?.title || '';
    mrAuthor = mrData?.author?.name || '';
    mrBranch = `${mrData?.source_branch || ''} → ${mrData?.target_branch || ''}`;
  } else {
    diff = $('diff-input').value.trim();
    mrTitle = $('manual-title').value.trim();
    if (!diff) { $('output').innerHTML = '<div class="err-box">Please paste the code diff or file contents.</div>'; return; }
  }

  const rules = getActiveRules();
  const customEslint = $('eslint-config').value.trim();
  const eslintBlock = customEslint || `{
  "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-non-null-assertion": "warn"
}`;

  $('review-btn').disabled = true;
  $('output').innerHTML = '<div class="loading"><div class="loading-txt">Analyzing code changes...</div></div>';

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
  "markdownComment": "Formatted markdown suitable to post as a GitLab MR comment. Include a score badge, summary, and findings with code blocks.",
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

Focus areas: ${rules.join(', ')}.
Check: ESLint violations per config above, MongoDB anti-patterns (missing .lean() on reads, missing await, no error handling on DB ops, missing projections, unindexed queries), async/await bugs, unhandled promises, missing try/catch, TypeScript type safety, security issues (hardcoded secrets, NoSQL injection, unvalidated inputs), logic bugs, code style violations.`;

  const userMsg = [
    mrTitle && `MR: ${mrTitle}`,
    mrAuthor && `Author: ${mrAuthor}`,
    mrBranch && `Branch: ${mrBranch}`,
    `\nDiff:\n${truncated}`
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-calls': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system,
        messages: [{ role: 'user', content: userMsg }]
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const raw = data.content?.find(b => b.type === 'text')?.text || '';
    reviewResult = JSON.parse(raw.replace(/```json|```/g, '').trim());
    renderResults(reviewResult);
  } catch(e) {
    $('output').innerHTML = `<div class="err-box">Analysis failed: ${esc(e.message)}</div>`;
  } finally {
    $('review-btn').disabled = false;
  }
}

// Render Results
function renderResults(r) {
  const score = Math.round(r.score || 0);
  const sc = score >= 80 ? 's' : score >= 60 ? 'w' : 'd';
  const canPost = !!getToken() && !!mrData;

  const findingsHTML = (r.findings || []).map(f => `
    <div class="finding ${esc(f.severity)}">
      <div class="fhead">
        <span class="badge ${esc(f.severity)}">${esc(f.severity)}</span>
        <span class="rule-tag">${esc(f.rule || '')}</span>
      </div>
      <div class="fmsg">${esc(f.message)}</div>
      ${f.codeSnippet ? `<div class="fcode">${esc(f.codeSnippet)}</div>` : ''}
      ${f.fix ? `<div class="ffix">Fix: ${esc(f.fix)}</div>` : ''}
    </div>`).join('');

  $('output').innerHTML = `
    <div class="card" style="gap:12px">
      <div class="summary-bar">
        <div class="stat ${sc}"><div class="stat-num">${score}</div><div class="stat-lbl">quality score</div></div>
        <div class="stat d"><div class="stat-num">${r.errors || 0}</div><div class="stat-lbl">errors</div></div>
        <div class="stat w"><div class="stat-num">${r.warnings || 0}</div><div class="stat-lbl">warnings</div></div>
        <div class="stat s"><div class="stat-num">${r.suggestions || 0}</div><div class="stat-lbl">suggestions</div></div>
      </div>

      <div class="overall">
        <div class="overall-lbl">Overall assessment</div>
        <div class="overall-txt">${esc(r.summary || '')}</div>
      </div>

      <div class="sec-lbl">Findings</div>
      ${findingsHTML || '<div class="finding info"><div class="fmsg">No issues found. Looks good to merge!</div></div>'}

      <div class="sec-lbl" style="margin-top:4px">Post to GitLab</div>
      <div class="post-bar">
        <button class="btn btn-primary" id="post-btn" onclick="postComment()" ${canPost ? '' : 'disabled'}>
          ${canPost ? 'Post comment on MR ↗' : 'Fetch a GitLab MR to enable'}
        </button>
        <span class="post-status" id="post-status">
          ${canPost ? 'Will post as a note on MR #' + mrData.iid : ''}
        </span>
      </div>
    </div>`;
}

// Post Comment
async function postComment() {
  if (!reviewResult || !mrData || !getToken()) return;
  const btn = $('post-btn');
  const status = $('post-status');
  btn.disabled = true;
  status.textContent = 'Posting...';

  const body = reviewResult.markdownComment || buildMarkdown(reviewResult);

  try {
    const res = await fetch(`${getHost()}/api/v4/projects/${mrData.project}/merge_requests/${mrData.iid}/notes`, {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body })
    });
    if (!res.ok) throw new Error('GitLab returned ' + res.status);
    const note = await res.json();
    status.innerHTML = `Posted! <a href="${mrData.web_url}#note_${note.id}" target="_blank">View comment →</a>`;
    btn.textContent = 'Posted ✓';
  } catch(e) {
    status.textContent = 'Failed: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'Retry ↗';
  }
}

function buildMarkdown(r) {
  const score = Math.round(r.score || 0);
  const emoji = score >= 80 ? '✅' : score >= 60 ? '⚠️' : '❌';
  let md = `## ${emoji} AI Code Review — Score: **${score}/100**\n\n> ${r.summary || ''}\n\n`;
  if (r.findings?.length) {
    md += `### Findings\n\n`;
    r.findings.forEach(f => {
      const icon = f.severity === 'error' ? '🔴' : f.severity === 'warning' ? '🟡' : f.severity === 'suggestion' ? '🟢' : 'ℹ️';
      md += `**${icon} [${f.rule}]** ${f.message}\n`;
      if (f.codeSnippet) md += `\`\`\`\n${f.codeSnippet}\n\`\`\`\n`;
      if (f.fix) md += `> 💡 ${f.fix}\n`;
      md += '\n';
    });
  }
  md += `---\n*Posted by [MR Review Assistant](https://github.com/krishnendubiswas/mr-review-assistant) · Powered by Claude AI*`;
  return md;
}
