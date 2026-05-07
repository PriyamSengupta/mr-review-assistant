# MR Review Assistant

> AI-powered merge request code reviewer for GitLab — built for Node.js / TypeScript / MongoDB teams.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Powered by](https://img.shields.io/badge/powered%20by-Claude%20AI-orange)

---

## What it does

Paste a GitLab MR URL → get an instant AI-powered code review that checks for:

- **ESLint violations** — based on your TypeScript ESLint config (`no-explicit-any`, `no-unused-vars`, `no-non-null-assertion`, etc.)
- **MongoDB anti-patterns** — missing `.lean()`, missing `await` on queries, no error handling on DB ops, missing field projections
- **Async/await bugs** — unhandled promises, missing `try/catch`, fire-and-forget DB calls
- **Security issues** — hardcoded secrets, NoSQL injection risks, unvalidated inputs
- **Code style violations** — naming conventions, unnecessary complexity, missing return types
- **Logic bugs** — edge cases, incorrect conditions, missing null checks

After reviewing, it can **auto-post the review as a comment** directly on your GitLab MR.

---

## Screenshot

![MR Review Assistant Screenshot](screenshot.png)

---

## Getting started

### Option 1 — Use directly in browser (no setup)

1. Download or clone this repo
2. Open `index.html` in your browser — that's it, no server needed

### Option 2 — Host on GitHub Pages

1. Fork this repo
2. Go to **Settings → Pages → Source → Deploy from branch → main / root**
3. Your tool will be live at `https://yourusername.github.io/mr-review-assistant`

---

## Usage

### Step 1 — API Keys

You need two keys:

| Key | Where to get it | Scope needed |
|-----|----------------|-------------|
| **Anthropic API key** | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) | — |
| **GitLab personal access token** | [gitlab.com/-/user_settings/personal_access_tokens](https://gitlab.com/-/user_settings/personal_access_tokens) | `api` |

> Keys are stored only in your browser session. They are never logged, saved, or sent anywhere except the respective APIs.

### Step 2 — Paste your MR URL

```
https://gitlab.com/your-group/your-project/-/merge_requests/42
```

Click **Fetch MR** — it loads the MR title, author, branch info, and full diff automatically.

Alternatively, switch to **Paste diff / code** tab and paste a raw git diff or file contents directly.

### Step 3 — Toggle focus areas & Review

Toggle which categories you want to focus on, then click **Analyze & Review**.

Once results appear, click **Post comment on MR** to push the review directly to GitLab as a formatted markdown comment.

---

## Sample GitLab comment output

```markdown
## ⚠️ AI Code Review — Score: 61/100

> The MR introduces a user deletion endpoint but has several issues...

### Findings

🔴 [no-explicit-any] Parameter `data` is typed as `any` — loses all type safety.
> 💡 Replace with a proper interface: `data: DeleteUserPayload`

🔴 [error-handling] `User.findByIdAndDelete()` is called without `await` and has no try/catch.
```
async function deleteUser(id) {
  User.findByIdAndDelete(id)   // ← missing await + no error handling
}
```
> 💡 Wrap in try/catch and await the call.

🟡 [mongodb-patterns] `.find()` returns full Mongoose documents. Use `.lean()` for read-only queries.

---
*Posted by MR Review Assistant · Powered by Claude AI*
```

---

## Customizing ESLint rules

In **Step 3**, paste your own ESLint rules JSON to override the defaults:

```json
{
  "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-non-null-assertion": "warn",
  "@typescript-eslint/explicit-function-return-type": "error"
}
```

---

## Self-hosted GitLab

If your team uses a self-hosted GitLab instance, update the **GitLab instance URL** field in Step 1:

```
https://gitlab.yourcompany.com
```

---

## Tech stack

- **Pure HTML/CSS/JS** — zero dependencies, no build step, works offline after first load
- **Claude API** (`claude-sonnet-4-20250514`) — for AI-powered code analysis
- **GitLab REST API v4** — to fetch MR diffs and post review comments

---

## Roadmap

- [ ] GitHub support (PRs)
- [ ] YouTrack integration — auto-update linked task status after review
- [ ] Inline diff comments (line-level review notes on GitLab)
- [ ] Custom rule presets — save and reuse your ESLint config
- [ ] Team dashboard — review history and quality trends

---

## Contributing

PRs welcome! Please open an issue first to discuss what you'd like to change.

---

## License

MIT © [Krishnendu Biswas](https://github.com/krishnendubiswas)
