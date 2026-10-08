// A stand-in for the GitHub CLI: answers the `gh` calls VibeFlow makes with
// fixed Issues and PRs, so the Issues & PRs view can be driven without the
// network. Repos are matched by name (`<anything>/VibeFlow`,
// `<anything>/clcom-frontend`); any other repo has nothing open.
//
//   gh auth status …                → signed in as kw-yeh
//   gh issue list -R <repo> …        → open issues (assignee / author filters)
//   gh pr list -R <repo> --state open → open PRs (assignee / author / review-requested / reviewed-by)
//   gh pr list -R <repo> --state all  → the PR index cards are linked through
const args = process.argv.slice(2)
const DAY = 24 * 60 * 60 * 1000
const ago = (days) => new Date(Date.now() - days * DAY).toISOString()
const arg = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

const me = { login: 'kw-yeh', name: '' }
const amy = { login: 'dev-amy', name: '' }
const ben = { login: 'dev-ben', name: '' }

const ISSUES = {
  VibeFlow: [
    {
      number: 112,
      title: '側邊欄搜尋在中文輸入法組字時會閃爍',
      body: '在側邊欄搜尋框輸入注音時，組字中的每次按鍵都會觸發篩選，列表會跳動。\n\n**重現步驟**\n\n1. 切換到注音輸入法\n2. 在搜尋框輸入「側邊」\n3. 組字期間列表反覆展開收合',
      author: me,
      assignees: [me],
      labels: [{ name: 'bug', color: 'e5484d' }, { name: 'ui', color: '4c9bf5' }],
      milestone: { title: 'v4.7' },
      issueType: { name: 'Bug' },
      createdAt: ago(2),
    },
    {
      number: 108,
      title: 'Codex CLI 任務支援 effort 參數',
      body: 'Codex 的 `model_reasoning_effort` 應該跟著卡片的 effort。',
      author: amy,
      assignees: [me],
      labels: [{ name: 'enhancement', color: '4ec98a' }],
      milestone: null,
      issueType: { name: 'Feature' },
      createdAt: ago(5),
    },
  ],
  'clcom-frontend': [
    {
      number: 431,
      title: 'Blog 未發佈文章應導回列表頁',
      body: '',
      author: ben,
      assignees: [me],
      labels: [{ name: 'bug', color: 'e5484d' }],
      milestone: null,
      issueType: null,
      createdAt: ago(8),
    },
  ],
}

const PRS = {
  VibeFlow: [
    {
      number: 103,
      title: 'fix(progress): resolve symlinked worktree paths',
      body: 'Resolve the real path before matching transcripts.',
      author: amy,
      assignees: [me],
      labels: [],
      milestone: null,
      createdAt: ago(1),
      state: 'OPEN',
      isDraft: false,
      reviewDecision: 'REVIEW_REQUIRED',
      headRefName: 'fix/progress-symlink-worktree',
      baseRefName: 'main',
    },
    {
      number: 105,
      title: 'docs: add lazy provisioning spec',
      body: '',
      author: me,
      assignees: [me],
      labels: [],
      milestone: null,
      createdAt: ago(3),
      state: 'OPEN',
      isDraft: true,
      reviewDecision: '',
      headRefName: 'docs/lazy-provisioning',
      baseRefName: 'main',
    },
    {
      // Approved by me: no longer awaiting my review, not mine, nobody assigned.
      number: 107,
      title: 'feat(github): list PRs I have reviewed',
      body: '',
      author: ben,
      assignees: [],
      labels: [],
      milestone: null,
      createdAt: ago(4),
      state: 'OPEN',
      isDraft: false,
      reviewDecision: 'APPROVED',
      headRefName: 'feat/reviewed-prs',
      baseRefName: 'main',
      reviewedByMe: true,
    },
  ],
}

const INDEX = {
  VibeFlow: [
    { number: 106, state: 'OPEN', isDraft: true, headRefName: 'feat/codex-effort', closing: [108] },
    { number: 103, state: 'OPEN', isDraft: false, headRefName: 'fix/progress-symlink-worktree', closing: [] },
    { number: 101, state: 'MERGED', isDraft: false, headRefName: 'feat/fixed-host-port', closing: [] },
  ],
}

function out(value) {
  process.stdout.write(JSON.stringify(value))
}

const repo = arg('-R') ?? ''
const [owner, name] = repo.split('/')
const withUrl = (kind) => (item) => ({
  ...item,
  url: `https://github.com/${repo}/${kind === 'issue' ? 'issues' : 'pull'}/${item.number}`,
})

if (args[0] === 'auth' && args[1] === 'status') {
  out({ hosts: { 'github.com': [{ active: true, login: me.login, state: 'success', gitProtocol: 'https' }] } })
} else if (args[0] === 'search') {
  const kind = args[1]
  const filter = arg('--assignee') ? 'assignee' : arg('--author') ? 'author'
    : arg('--review-requested') ? 'review-requested' : 'reviewed-by'
  const names = kind === 'issues' ? Object.keys(ISSUES) : Object.keys(PRS)
  out(names.filter((name) => {
    const items = kind === 'issues' ? ISSUES[name] : PRS[name]
    return items.some((item) => filter === 'assignee' ? item.assignees.some((user) => user.login === me.login)
      : filter === 'author' ? item.author.login === me.login
      : filter === 'review-requested' ? item.reviewDecision === 'REVIEW_REQUIRED'
      : item.reviewedByMe === true)
  }).map((name) => ({ repository: { nameWithOwner: `e2e/${name}` } })))
} else if (args[0] === 'issue' && args[1] === 'list') {
  const issues = (ISSUES[name] ?? []).map(withUrl('issue'))
  const assignee = arg('--assignee')
  const author = arg('--author')
  out(
    issues.filter((i) =>
      assignee ? i.assignees.some((a) => a.login === me.login) : author ? i.author.login === me.login : true
    )
  )
} else if (args[0] === 'pr' && args[1] === 'list' && arg('--state') === 'all') {
  out(
    (INDEX[name] ?? []).map((pr) => ({
      number: pr.number,
      url: `https://github.com/${repo}/pull/${pr.number}`,
      state: pr.state,
      isDraft: pr.isDraft,
      headRefName: pr.headRefName,
      closingIssuesReferences: pr.closing.map((n) => ({
        number: n,
        url: `https://github.com/${repo}/issues/${n}`,
        repository: { name, owner: { login: owner } },
      })),
    }))
  )
} else if (args[0] === 'pr' && args[1] === 'list') {
  const prs = (PRS[name] ?? []).map(withUrl('pr'))
  const assignee = arg('--assignee')
  const author = arg('--author')
  const search = arg('--search')
  out(
    prs.filter((p) =>
      assignee
        ? p.assignees.some((a) => a.login === me.login)
        : author
          ? p.author.login === me.login
          : search === 'review-requested:@me'
            ? p.reviewDecision === 'REVIEW_REQUIRED'
            : search === 'reviewed-by:@me'
              ? p.reviewedByMe === true
              : true
    )
  )
} else {
  process.stderr.write(`fake gh: unsupported command: ${args.join(' ')}\n`)
  process.exit(1)
}
