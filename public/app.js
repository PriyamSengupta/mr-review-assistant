// State
let mrData = null;
let ghPRData = null;
let diffText = '';
let reviewResult = null;
let activeTab = 'gitlab';
let reviewSource = null;

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

// Load LLM providers from server
(async function loadProviders() {
  try {
    const providers = await (await fetch('/api/providers')).json();
    const sel = $('llm-select');
    sel.innerHTML = '';
    providers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.available ? p.label : `${p.label} — not configured`;
      opt.disabled = !p.available;
      sel.appendChild(opt);
    });
    const first = providers.find(p => p.available);
    if (first) sel.value = first.id;
  } catch(e) {
    console.error('Failed to load providers:', e);
  }
})();

// Helpers
const $ = id => document.getElementById(id);
const getActiveRules = () => [...document.querySelectorAll('.chip.on')].map(c => c.dataset.rule);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function setStatus(type, msg) {
  $('mr-status').classList.remove('hidden');
  $('status-dot').className = 'dot ' + type;
  $('status-txt').textContent = msg;
}

function resetMR() {
  mrData = null; ghPRData = null; diffText = '';
  $('mr-preview').classList.add('hidden');
  $('mr-status').classList.add('hidden');
  $('output').innerHTML = '';
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data;
}

// ── GitLab ────────────────────────────────────────────────────────────────

async function fetchMR() {
  const url = $('mr-url').value.trim();
  if (!url) return;

  $('fetch-btn').disabled = true;
  setStatus('spin', 'Fetching MR from GitLab...');
  $('mr-preview').classList.add('hidden');

  try {
    const data = await apiPost('/api/fetch-gitlab-mr', { url });
    mrData = data;
    diffText = data.diff;

    const sc = data.state === 'opened' ? 'pill-open' : data.state === 'merged' ? 'pill-merged' : 'pill-closed';
    $('mr-preview').innerHTML = `
      <div class="mr-preview">
        <div class="mr-preview-title">${esc(data.title)}</div>
        <div class="mr-preview-meta">
          <span class="pill ${sc}">${data.state}</span>
          <span>by ${esc(data.author)}</span>
          <span>${esc(data.sourceBranch)} → ${esc(data.targetBranch)}</span>
          <span>${data.fileCount} files changed</span>
        </div>
      </div>`;
    $('mr-preview').classList.remove('hidden');
    setStatus('ok', `Fetched — ${data.fileCount} files loaded`);
  } catch(e) {
    setStatus('err', e.message);
  } finally {
    $('fetch-btn').disabled = false;
  }
}

// ── GitHub ────────────────────────────────────────────────────────────────

async function fetchGitHubPR() {
  const url = $('gh-pr-url').value.trim();
  if (!url) return;

  $('gh-fetch-btn').disabled = true;
  setStatus('spin', 'Fetching PR from GitHub...');
  $('mr-preview').classList.add('hidden');

  try {
    const data = await apiPost('/api/fetch-github-pr', { url });
    ghPRData = data;
    diffText = data.diff;

    const sc = data.merged ? 'pill-merged' : data.state === 'open' ? 'pill-open' : 'pill-closed';
    const stateLabel = data.merged ? 'merged' : data.state;
    $('mr-preview').innerHTML = `
      <div class="mr-preview">
        <div class="mr-preview-title">${esc(data.title)}</div>
        <div class="mr-preview-meta">
          <span class="pill ${sc}">${stateLabel}</span>
          <span>by ${esc(data.author)}</span>
          <span>${esc(data.headRef)} → ${esc(data.baseRef)}</span>
          <span>${data.fileCount} files changed</span>
        </div>
      </div>`;
    $('mr-preview').classList.remove('hidden');
    setStatus('ok', `Fetched — ${data.fileCount} files loaded`);
  } catch(e) {
    setStatus('err', e.message);
  } finally {
    $('gh-fetch-btn').disabled = false;
  }
}

// ── Run Review ────────────────────────────────────────────────────────────

async function runReview() {
  let diff = '';
  let mrTitle = '';
  let mrAuthor = '';
  let mrBranch = '';

  reviewSource = activeTab;

  if (activeTab === 'gitlab') {
    if (!diffText) { $('output').innerHTML = '<div class="err-box">Please fetch an MR first.</div>'; return; }
    diff = diffText;
    mrTitle = mrData?.title || '';
    mrAuthor = mrData?.author || '';
    mrBranch = `${mrData?.sourceBranch || ''} → ${mrData?.targetBranch || ''}`;
  } else if (activeTab === 'github') {
    if (!diffText) { $('output').innerHTML = '<div class="err-box">Please fetch a PR first.</div>'; return; }
    diff = diffText;
    mrTitle = ghPRData?.title || '';
    mrAuthor = ghPRData?.author || '';
    mrBranch = `${ghPRData?.headRef || ''} → ${ghPRData?.baseRef || ''}`;
  } else {
    diff = $('diff-input').value.trim();
    mrTitle = $('manual-title').value.trim();
    if (!diff) { $('output').innerHTML = '<div class="err-box">Please paste the code diff or file contents.</div>'; return; }
  }

  const rules = getActiveRules();
  const customEslint = $('eslint-config').value.trim();
  const provider = $('llm-select').value;
  const truncated = diff.length > 14000 ? diff.slice(0, 14000) + '\n\n[diff truncated]' : diff;

  $('review-btn').disabled = true;
  $('output').innerHTML = '<div class="loading"><div class="loading-txt">Analyzing code changes...</div></div>';

  try {
    reviewResult = await apiPost('/api/review', {
      diff: truncated, mrTitle, mrAuthor, mrBranch, rules,
      customEslint: customEslint || null,
      provider
    });
    renderResults(reviewResult);
  } catch(e) {
    $('output').innerHTML = `<div class="err-box">Analysis failed: ${esc(e.message)}</div>`;
  } finally {
    $('review-btn').disabled = false;
  }
}

// ── Render Results ────────────────────────────────────────────────────────

function renderResults(r) {
  const score = Math.round(r.score || 0);
  const sc = score >= 80 ? 's' : score >= 60 ? 'w' : 'd';

  const canPostGitLab = reviewSource === 'gitlab' && !!mrData;
  const canPostGitHub = reviewSource === 'github' && !!ghPRData;
  const canPost = canPostGitLab || canPostGitHub;

  const postLabel = canPostGitLab ? 'Post comment on MR ↗'
                  : canPostGitHub ? 'Post comment on PR ↗'
                  : 'Fetch a GitLab MR or GitHub PR to enable';
  const postInfo = canPostGitLab ? `Will post as a note on MR #${mrData.iid}`
                 : canPostGitHub ? `Will post as a comment on PR #${ghPRData.number}`
                 : '';
  const postSectionLabel = canPostGitLab ? 'Post to GitLab' : canPostGitHub ? 'Post to GitHub' : 'Post review';

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

      <div class="sec-lbl" style="margin-top:4px">${postSectionLabel}</div>
      <div class="post-bar">
        <button class="btn btn-primary" id="post-btn" onclick="postComment()" ${canPost ? '' : 'disabled'}>
          ${postLabel}
        </button>
        <span class="post-status" id="post-status">${postInfo}</span>
      </div>
    </div>`;
}

// ── Post Comment ──────────────────────────────────────────────────────────

async function postComment() {
  if (!reviewResult) return;
  const btn = $('post-btn');
  const status = $('post-status');
  btn.disabled = true;
  status.textContent = 'Posting...';

  const body = reviewResult.markdownComment || buildMarkdown(reviewResult);

  try {
    if (mrData) {
      const data = await apiPost('/api/post-gitlab-comment', {
        project: mrData.project, iid: mrData.iid, body, webUrl: mrData.webUrl
      });
      status.innerHTML = `Posted! <a href="${mrData.webUrl}#note_${data.noteId}" target="_blank">View comment →</a>`;
    } else if (ghPRData) {
      const data = await apiPost('/api/post-github-comment', {
        owner: ghPRData.owner, repo: ghPRData.repo, number: ghPRData.number, body
      });
      status.innerHTML = `Posted! <a href="${data.htmlUrl}" target="_blank">View comment →</a>`;
    }
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
  md += `---\n*Posted by [MR Review Assistant](https://github.com/PriyamSengupta/mr-review-assistant) · Powered by Claude AI*`;
  return md;
}
