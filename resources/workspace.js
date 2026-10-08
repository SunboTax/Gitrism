/* Local webview. Repository values only enter markup through escapeHtml. */
(() => {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const saved = vscode.getState() || {};
  let state = { tab: 'graph', draft: '', selected: '', compareFrom: 'HEAD', compareTo: '', ...saved };
  let data, detail, comparison, busy = false, loading = true, detailRequest = 0, compareRequest = 0, serial = 0;
  let detailLoading = false, comparisonLoading = false, toastTimer, timelineCommits = [], timelineLoading = false, timelineRequest = 0, rebasePlan, rebaseLoading = false, rebaseRequest = 0;
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString(); };
  const short = hash => (hash || '').slice(0, 8);
  const send = (type, values = {}) => vscode.postMessage({ type, ...values });
  const persist = () => vscode.setState(state);
  // Original line icons share a single coordinate system and inherit the theme color.
  const paths = {
    prism: 'M12 2 22 19H2Z M12 2v17 M2 19l10-6 10 6',
    graph: 'M6 5v14 M18 5v3c0 6-12 2-12 8 M4 5a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M16 5a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M4 19a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    changes: 'M5 3h14v18H5Z M9 8h6 M9 12h6 M9 16h4',
    branch: 'M6 3v18 M18 3v5c0 6-12 2-12 8 M4 5h4 M16 5h4 M4 19h4',
    tag: 'M3 3h8l10 10-8 8L3 11Z M7 7h.01',
    stash: 'M3 8h18v13H3Z M3 8l3-5h12l3 5 M9 12h6',
    worktree: 'M3 4h7v6H3Z M14 14h7v6h-7Z M7 10v7h7 M14 4h7v6h-7Z',
    compare: 'M3 7h18l-4-4 M21 17H3l4 4',
    timeline: 'M12 3a9 9 0 1 1-9 9a9 9 0 0 1 9-9 M12 7v5l4 2',
    rebase: 'M5 5h14 M5 12h14 M5 19h14 M8 2 5 5l3 3 M16 16l3 3-3 3',
    search: 'M10 3a7 7 0 1 1 0 14a7 7 0 0 1 0-14 M15 15l6 6',
    refresh: 'M20 10a8 8 0 1 0-1 8 M20 3v7h-7',
    down: 'M12 3v14 M7 12l5 5 5-5 M4 21h16',
    up: 'M12 17V3 M7 8l5-5 5 5 M4 21h16',
    external: 'M14 3h7v7 M21 3l-11 11 M10 3H3v18h18v-7',
    plus: 'M12 4v16 M4 12h16',
    minus: 'M4 12h16',
    chevron: 'M7 9l5 5 5-5',
    copy: 'M8 8h13v13H8Z M16 8V3H3v13h5',
    file: 'M5 3h9l5 5v13H5Z M14 3v6h5',
    check: 'M4 12l5 5L20 6',
    close: 'M6 6l12 12 M18 6 6 18',
    folder: 'M3 6V4h7l3 3h8v13H3Z',
    arrowUp: 'M12 20V4 M5 11l7-7 7 7',
    arrowDown: 'M12 4v16 M5 13l7 7 7-7',
    undo: 'M8 4 3 9l5 5 M3 9h11a6 6 0 0 1 0 12',
    commit: 'M3 12h5 M16 12h5 M12 8a4 4 0 1 1 0 8a4 4 0 0 1 0-8',
    trash: 'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7'
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.commit}"/></svg>`;
  const actionIcons = {chooseRepository:'folder',fetch:'down',pull:'down',push:'up',sync:'refresh',refresh:'refresh',openGraph:'external',search:'search',clearSearch:'close',copy:'copy',compareStart:'compare',compareHead:'compare',compareRef:'compare',createBranch:'branch',createTag:'tag',rebasePlan:'rebase',operation:'commit',stage:'plus',unstage:'minus',stageAll:'plus',unstageAll:'minus',commit:'check',stashPush:'stash',createWorktree:'plus',openWorktree:'external',removeWorktree:'trash',deleteBranch:'trash',deleteTag:'trash',focusRef:'graph',checkout:'branch',swapCompare:'compare',compare:'compare',timelineSearch:'timeline',activeHistory:'file',applyRebase:'check',more:'plus'};
  const btn = (label, action, attrs = '', primary = false) => {
    const classes = attrs.match(/class="([^"]*)"/)?.[1] || '';
    attrs = attrs.replace(/class="[^"]*"/g, '');
    const onlyIcon = ['refresh','openGraph','swapCompare','moveRebase'].includes(action);
    const glyph = action === 'moveRebase' ? (attrs.includes('data-direction="-1"') ? 'arrowUp' : 'arrowDown') : actionIcons[action];
    if (!attrs.includes('title=') && !onlyIcon) attrs += ` title="${e(label.replace(/<[^>]*>/g, ''))}"`;
    if (!attrs.includes('aria-label=') && !onlyIcon) attrs += ` aria-label="${e(label.replace(/<[^>]*>/g, ''))}"`;
    return `<button class="${primary ? 'primary ' : ''}${onlyIcon ? 'icon-button ' : ''}${classes}" data-action="${action}" ${attrs}>${glyph ? icon(glyph) : ''}${onlyIcon ? '' : `<span>${label}</span>`}</button>`;
  };
  const empty = (title, hint = '') => `<div class="empty"><span class="empty-mark">${icon('prism')}</span><strong>${e(title)}</strong>${hint ? `<p>${e(hint)}</p>` : ''}</div>`;
  function notice(message, error = false) {
    const toast = document.getElementById('toast'); toast.textContent = message; toast.className = error ? 'error' : ''; toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 15000 : 3500);
  }
  function refOptions(selected = '', all = true) {
    return (all ? '<option value="">全部引用</option>' : '<option value="HEAD">HEAD</option>') +
      data.branches.map(b => `<option value="${e(b.name)}" ${selected === b.name ? 'selected' : ''}>${b.isRemote ? '远程 · ' : ''}${e(b.name)}</option>`).join('') +
      data.tags.map(t => `<option value="refs/tags/${e(t.name)}" ${selected === 'refs/tags/' + t.name ? 'selected' : ''}>标签 · ${e(t.name)}</option>`).join('');
  }
  function graphRows(commits) {
    const graph = layoutGraph(commits), gap = Math.min(18, 142 / graph.width), x = lane => 10 + lane * gap, svgWidth = graph.width <= 3 ? 64 : 160;
    const svg = (row, index) => {
      const edges = row.edges.map(edge => {
        const y1 = edge.half === 'bottom' ? 20 : 0, y2 = edge.half === 'top' ? 20 : 40;
        return `<path class="lane lane-${edge.color % 6}" d="M${x(edge.from)},${y1} C${x(edge.from)},${(y1+y2)/2} ${x(edge.to)},${(y1+y2)/2} ${x(edge.to)},${y2}" ${index === commits.length - 1 && edge.half !== 'top' ? 'stroke-dasharray="3 2"' : ''}/>`;
      }).join('');
      return `<svg class="graph-svg" viewBox="0 0 ${svgWidth} 40" width="${svgWidth}" height="40" preserveAspectRatio="none" aria-hidden="true">${edges}<circle class="node lane-${row.color % 6}" cx="${x(row.lane)}" cy="20" r="${row.merge ? 5 : 4}"/></svg>`;
    };
    return commits.map((c, i) => `<button class="commit-row ${state.selected === c.hash ? 'selected' : ''}" data-action="select" data-hash="${e(c.hash)}" aria-pressed="${state.selected === c.hash}" title="${e(c.subject)}"><span class="graph-cell">${svg(graph.rows[i],i)}</span><span class="commit-subject">${c.refs ? `<span class="refs">${c.refs.split(', ').map(r => `<span class="ref ${r.startsWith('tag:') ? 'tag' : r.startsWith('HEAD') ? 'head' : ''}">${e(r)}</span>`).join('')}</span>` : ''}<span>${e(c.subject)}</span></span><span class="author"><span class="avatar">${e(c.author.slice(0,1).toUpperCase())}</span>${e(c.author)}</span><time title="${e(date(c.date))}">${e(new Date(c.date).toLocaleDateString())}</time><code>${short(c.hash)}</code></button>`).join('');
  }
  function detailPane() {
    if (detailLoading) return empty('正在读取提交…');
    if (!detail) return empty('选择一条提交', '查看变更文件、父提交并打开差异');
    const d = detail;
    return `<div class="detail-header"><span class="eyebrow">提交详情${d.parents.length > 1 ? ' · 合并提交' : ''}</span><h2>${e(d.message.split('\n')[0])}</h2><div class="person"><span class="avatar large">${e(d.author.slice(0,1))}</span><div><strong>${e(d.author)}</strong><small>${e(date(d.date))}</small></div></div>${btn(short(d.hash), 'copy', `data-value="${e(d.hash)}" title="复制完整哈希"`)}<div class="parent-links">${d.parents.map(p => btn('父提交 ' + short(p), 'select', `data-hash="${e(p)}"`)).join('')}</div></div><div class="detail-actions">${btn('与 HEAD 比较','compareHead')}${btn('创建分支','createBranch',`data-ref="${e(d.hash)}"`)}<details class="more-actions"><summary>更多操作 ${icon('chevron')}</summary><div class="action-menu">${btn('作为比较起点','compareStart')}${btn('创建标签','createTag',`data-ref="${e(d.hash)}"`)}${btn('整理后续历史','rebasePlan',`data-ref="${e(d.hash)}"`)}${btn('Cherry-pick','operation',`data-operation="cherry-pick" data-ref="${e(d.hash)}"`)}${btn('Revert','operation',`data-operation="revert" data-ref="${e(d.hash)}"`)}</div></details></div>${d.message.includes('\n') ? `<pre class="commit-body">${e(d.message.slice(d.message.indexOf('\n')+1).trim())}</pre>` : ''}<h3>变更文件 <span class="count">${d.files.length}</span></h3><div class="file-list">${changedFiles(d.files, d.parents[0] || 'EMPTY', d.hash)}</div><details><summary>变更统计 · 相对${d.parents.length > 1 ? '第一个父提交' : '父提交'}</summary><pre>${e(d.stats)}</pre></details>`;
  }
  function changedFiles(files, from, to) {
    return files.map(f => `<button class="file-diff" data-action="diff" data-file="${e(f.path)}" data-old-file="${e(f.oldPath || f.path)}" data-from="${e(f.from || (f.status === 'A' ? 'EMPTY' : from))}" data-to="${e(f.to || (f.status === 'D' ? 'EMPTY' : to))}"><span class="file-status status-${e(f.status)}">${e(f.status)}</span><span title="${e(f.path)}">${f.oldPath ? e(f.oldPath) + ' → ' : ''}${e(f.path)}</span><span class="diff-arrow">${icon('external')}</span></button>`).join('') || empty('没有文件差异');
  }
  function graphView() {
    const opts = data.options || {};
    return `<div class="view-heading"><div><span class="eyebrow">REPOSITORY HISTORY</span><h2>提交图 <span class="count">${data.commits.length}${data.hasMore ? '+' : ''}</span></h2></div><span class="view-caption">每一次更改，都有迹可循。</span></div><div class="filters"><select id="ref" aria-label="历史引用">${refOptions(opts.ref)}</select><div class="search-control">${icon('search')}<select id="search-by" aria-label="搜索字段"><option value="message">消息</option><option value="author" ${opts.searchBy==='author'?'selected':''}>作者</option><option value="hash" ${opts.searchBy==='hash'?'selected':''}>哈希 / 引用</option></select><input id="search" type="search" value="${e(opts.query)}" placeholder="搜索提交，按 Enter" aria-label="搜索提交"></div><input id="file-filter" value="${e(opts.file)}" placeholder="文件路径（可选）" aria-label="文件历史路径">${btn('筛选','search','',true)}${btn('清除','clearSearch')}</div>${opts.query || opts.file ? '<div class="hint">正在显示筛选结果；被过滤的父提交不会出现在图中。</div>' : ''}<div class="graph-layout"><section class="graph-area ${layoutGraph(data.commits).width <= 3 ? 'graph-compact' : ''}" aria-label="提交图"><div class="graph-scroll" id="graph-scroll"><div class="graph-head"><span>分支图</span><span>提交消息与引用</span><span>作者</span><span>日期</span><span>哈希</span></div>${graphRows(data.commits) || empty('没有匹配的提交', '新仓库可先在工作区中创建第一次提交。')}${data.hasMore ? btn('加载更多提交','more','class="load-more"') : ''}<div class="graph-foot">${data.commits.length} 条提交 · 按拓扑排序${data.hasMore ? '' : ' · 当前结果结束'}</div></div></section><aside id="detail-pane" class="detail-pane" aria-label="提交详情">${detailPane()}</aside></div>`;
  }
  function workingFiles(files, staged, label) {
    return `<section class="working-group"><h3>${label} <span class="count">${files.length}</span></h3>${files.map(f => `<div class="working-file"><button class="file-diff" data-action="workingDiff" data-file="${e(f.path)}" data-staged="${staged}"><span class="file-status status-${f.conflict ? 'U' : e(staged ? f.index : f.working)}">${f.conflict ? '!' : e(staged ? f.index : f.working)}</span><span>${e(f.path)}</span></button>${btn(staged ? '取消暂存' : '暂存',staged ? 'unstage' : 'stage',`data-file="${e(f.path)}"`)}</div>`).join('') || '<p class="muted">无文件</p>'}</section>`;
  }
  function changesView() {
    const files = data.status.files;
    return `<div class="changes-layout"><section class="change-files">${files.some(f=>f.conflict) ? workingFiles(files.filter(f=>f.conflict),false,'冲突 · 编辑后暂存解决') : ''}${workingFiles(files.filter(f=>!f.conflict && f.index !== ' ' && f.index !== '?'),true,'已暂存')}${workingFiles(files.filter(f=>!f.conflict && (f.working !== ' ' || f.index === '?')),false,'工作区更改')}</section><aside class="commit-compose"><span class="eyebrow">当前分支</span><h2 class="compose-branch">${icon('branch')} ${e(data.status.branch)}</h2><p class="muted">仅提交已暂存的文件。点击文件查看差异。</p><textarea id="draft" placeholder="提交摘要\n\n描述这次更改…" aria-label="提交消息">${e(state.draft)}</textarea><div class="compose-actions">${btn('暂存全部','stageAll')}${btn('取消暂存全部','unstageAll')}${btn('提交已暂存文件','commit',data.status.staged === 0 || data.status.conflicted ? 'disabled' : '',true)}</div><small class="muted">Ctrl / ⌘ + Enter 提交</small>${btn('保存到 Stash','stashPush')}</aside></div>`;
  }
  function branchesView() {
    return `<div class="section-heading"><div><h2>分支</h2><p>切换、查看完整历史、比较或整合分支</p></div>${btn('新建分支','createBranch')}</div><div class="cards">${data.branches.map(b=>`<article class="card"><div class="card-title"><strong class="entity-title">${icon('branch')}${e(b.name)}</strong>${b.current ? '<span class="ref head">当前</span>' : ''}${b.isRemote ? '<span class="ref">远程</span>' : ''}</div><p>${e(b.remote || (b.isRemote ? '远程跟踪分支' : '未设置上游'))} <code>${short(b.hash)}</code></p><div class="card-actions">${!b.current && !b.isRemote ? btn('切换','checkout',`data-branch="${e(b.name)}"`) : ''}${btn('历史','focusRef',`data-ref="${e(b.name)}"`)}${btn('比较 HEAD','compareRef',`data-ref="${e(b.name)}"`)}${!b.current ? btn('合并到当前','operation',`data-operation="merge" data-ref="${e(b.name)}"`) + btn('当前变基到此','operation',`data-operation="rebase" data-ref="${e(b.name)}"`) : ''}${!b.current && !b.isRemote ? btn('删除','deleteBranch',`data-branch="${e(b.name)}"`) : ''}</div></article>`).join('') || empty('还没有分支')}</div>`;
  }
  function tagsView() {
    return `<div class="section-heading"><div><h2>标签</h2><p>本地版本标记</p></div>${btn('创建标签','createTag')}</div><div class="cards">${data.tags.map(t=>`<article class="card"><strong class="entity-title">${icon('tag')}${e(t.name)}</strong><p>${e(t.subject)}</p><small class="muted">${e(date(t.date))}</small><div class="card-actions">${btn('查看提交','select',`data-hash="refs/tags/${e(t.name)}"`)}${btn('历史','focusRef',`data-ref="refs/tags/${e(t.name)}"`)}${btn('删除','deleteTag',`data-tag="${e(t.name)}"`)}</div></article>`).join('') || empty('没有标签')}</div>`;
  }
  function stashesView() {
    return `<div class="section-heading"><div><h2>Stashes</h2><p>保存尚未提交的工作，稍后恢复</p></div>${btn('保存工作区','stashPush')}</div><div class="cards">${data.stashes.map(s=>`<article class="card"><strong>${e(s.subject)}</strong><p><code>${e(s.ref)}</code> · ${e(date(s.date))}</p><div class="card-actions">${btn('查看变更','select',`data-hash="${e(s.hash)}"`)}${['apply','pop','drop'].map((a,i)=>btn(['应用（保留）','恢复并移除','删除'][i],'stashAction',`data-stash-action="${a}" data-hash="${e(s.hash)}"`)).join('')}</div></article>`).join('') || empty('没有保存的工作')}</div>`;
  }
  function worktreesView() {
    if (data.worktreesError) return `<div class="section-heading"><h2>Worktrees</h2>${btn('重新读取','refresh')}</div>${empty('无法读取 Worktrees',data.worktreesError)}`;
    return `<div class="section-heading"><div><h2>Worktrees</h2><p>用独立目录同时处理多个分支</p></div>${btn('创建 Worktree','createWorktree')}</div><div class="cards">${data.worktrees.map(w=>`<article class="card"><strong class="entity-title">${icon('worktree')}${e(w.branch)}</strong>${w.path===data.root ? '<span class="ref head">当前工作区</span>':''}<p class="path">${e(w.path)}</p><small class="muted">${e(w.locked || w.prunable || short(w.hash))}</small><div class="card-actions">${btn('在新窗口打开','openWorktree',`data-path="${e(w.path)}"`)}${w.path!==data.root && !w.locked ? btn('移除','removeWorktree',`data-path="${e(w.path)}"`) : ''}</div></article>`).join('')}</div>`;
  }
  function compareView() {
    return `<div class="section-heading"><div><h2>比较引用</h2><p>比较两个分支、标签或提交的最终文件内容</p></div></div><div class="compare-form"><label>起点<input id="compare-from" list="refs-list" value="${e(state.compareFrom)}" placeholder="分支 / 标签 / 哈希"></label>${btn('⇄','swapCompare','aria-label="交换比较方向"')}<label>终点<input id="compare-to" list="refs-list" value="${e(state.compareTo)}" placeholder="HEAD"></label><datalist id="refs-list"><option value="HEAD">${data.branches.map(b=>`<option value="${e(b.name)}">`).join('')}${data.tags.map(t=>`<option value="refs/tags/${e(t.name)}">`).join('')}</datalist>${btn('比较','compare','',true)}</div>${comparisonLoading ? empty('正在比较…') : comparison ? `<div class="comparison-result"><div class="comparison-summary"><code>${short(comparison.from)} → ${short(comparison.to)}</code><span>${comparison.files.length} 个文件</span><span>终点独有 ${comparison.ahead} 条提交</span><span>起点独有 ${comparison.behind} 条提交</span></div><div class="comparison-grid"><section><h3>文件差异</h3>${changedFiles(comparison.files,comparison.from,comparison.to)}<details><summary>变更统计</summary><pre>${e(comparison.stats)}</pre></details></section><section><h3>终点独有的提交（最多 200 条）</h3>${comparison.commits.map(c=>`<button class="timeline-commit" data-action="select" data-hash="${e(c.hash)}"><code>${short(c.hash)}</code><span>${e(c.subject)}</span><small>${e(c.author)}</small></button>`).join('') || empty('没有独有提交')}</section></div></div>` : empty('选择两个引用开始比较', '也可在提交详情中设置起点。')}`;
  }
  function timelineView() {
    const commits = timelineCommits;
    const months = new Map();
    commits.forEach(c=>{const month=c.date.slice(0,7);months.set(month,(months.get(month)||0)+1);});
    const buckets=[...months.entries()].reverse().slice(-24), max=Math.max(1,...buckets.map(b=>b[1]));
    const chart=buckets.length ? `<svg class="timeline-chart" viewBox="0 0 ${Math.max(120,buckets.length*24)} 55" role="img" aria-label="最近 24 个有提交月份的提交数量">${buckets.map(([month,count],i)=>`<rect x="${i*24+3}" y="${46-count/max*38}" width="16" height="${count/max*38}"><title>${e(month)} · ${count} 次提交</title></rect>`).join('')}</svg>` : '';
    return `<div class="section-heading"><div><h2>文件时间线</h2><p>按提交浏览文件演变，支持跟踪重命名</p></div>${btn('选择编辑器当前文件','activeHistory')}</div><div class="timeline-form"><input id="timeline-file" value="${e(state.timelineFile)}" placeholder="相对于仓库根目录的文件路径" aria-label="时间线文件路径">${btn('查看历史','timelineSearch','',true)}</div>${timelineLoading ? empty('正在读取文件历史…') : state.timelineFile ? `<div class="timeline-summary"><strong>${e(state.timelineFile)}</strong><span>${commits.length} 条历史记录（最多 500 条）</span></div>${chart}<div class="timeline-layout"><section class="timeline-list">${commits.map(c=>`<button class="timeline-commit ${state.selected===c.hash?'selected':''}" data-action="selectTimeline" data-hash="${e(c.hash)}"><time>${e(date(c.date))}</time><strong>${e(c.subject)}</strong><small>${e(c.author)} · ${short(c.hash)}</small></button>`).join('') || empty('没有文件历史')}</section><aside id="detail-pane" class="detail-pane">${detailPane()}</aside></div>` : empty('打开一个文件的历史', '也可从编辑器右键菜单进入文件时间线。')}`;
  }
  function rebaseView() {
    return `<div class="section-heading"><div><h2>整理提交历史</h2><p>保留基点，重排它之后到 HEAD 的线性提交</p></div></div><div class="timeline-form"><input id="rebase-base" value="${e(state.rebaseBase)}" placeholder="基点，例如 HEAD~3 或提交哈希" aria-label="变基基点">${btn('生成计划','rebasePlan','',true)}</div>${rebaseLoading ? empty('正在生成计划…') : rebasePlan ? `<div class="rebase-plan"><div class="comparison-summary"><strong class="entity-title">${icon('branch')}${e(rebasePlan.branch)}</strong><code>${short(rebasePlan.base)} → ${short(rebasePlan.head)}</code><span>${rebasePlan.commits.length} 条提交 · 从旧到新</span></div><p class="muted">↑ ↓ 调整顺序。squash 合并消息，fixup 丢弃本条消息；drop 移除提交。执行前自动创建备份分支。</p><div class="rebase-steps">${rebasePlan.commits.map((c,i)=>`<div class="rebase-step ${c.action==='drop'?'dropped':''}"><span class="step-number">${i+1}</span><select data-rebase-index="${i}" aria-label="提交 ${i+1} 的操作">${['pick','squash','fixup','drop'].map(a=>`<option value="${a}" ${c.action===a?'selected':''}>${a}</option>`).join('')}</select><code>${short(c.hash)}</code><span class="step-subject" title="${e(c.subject)}">${e(c.subject)}</span>${btn('↑','moveRebase',`data-index="${i}" data-direction="-1" ${i===0?'disabled':''} aria-label="上移提交"`)}${btn('↓','moveRebase',`data-index="${i}" data-direction="1" ${i===rebasePlan.commits.length-1?'disabled':''} aria-label="下移提交"`)}</div>`).join('')}</div><div class="rebase-actions">${btn('执行变基计划','applyRebase',data.status.files.length || data.operation ? 'disabled' : '',true)}${btn('重置顺序','rebasePlan',`data-ref="${e(rebasePlan.base)}"`)}<span class="muted">${data.status.files.length ? '请先提交或 stash 工作区更改。' : '只整理适合重写的历史。'}</span></div></div>` : empty('先生成变基计划', '也可在提交详情中选择“整理后续历史”。')}`;
  }
  function render() {
    const focused = document.activeElement?.id, start = document.activeElement?.selectionStart, end = document.activeElement?.selectionEnd;
    const scroll = document.getElementById('graph-scroll')?.scrollTop || 0;
    if (!data) { app.innerHTML = empty(loading ? '正在读取仓库…' : '打开一个 Git 仓库', 'Gitrism 使用本机 Git，不需要账号或订阅。') + btn('选择仓库','chooseRepository') + btn('重新读取','refresh'); return; }
    const tabs = [['graph','graph','提交图'],['changes','changes','工作区'],['branches','branch','分支'],['tags','tag','标签'],['stashes','stash','Stashes'],['worktrees','worktree','Worktrees'],['compare','compare','比较'],['timeline','timeline','文件时间线'],['rebase','rebase','整理历史']];
    const s = data.status;
    const navigation = tabs.map(([id,glyph,label],i)=>`${i===0 ? '<span class="nav-heading">仓库</span>' : i===6 ? '<span class="nav-heading">探索与整理</span>' : ''}<button class="tab ${state.tab===id?'active':''}" data-action="tab" data-tab="${id}" aria-current="${state.tab===id?'page':'false'}">${icon(glyph)}<span>${label}</span>${id==='changes' && s.files.length ? `<span class="count">${s.files.length}</span>` : ''}</button>`).join('');
    app.innerHTML = `<header class="header"><div class="brand"><span class="brand-mark">${icon('prism')}</span><div><strong>Gitrism</strong><small>See changes. Know history.</small></div></div><div class="repository-context">${btn(`<span class="repo-name">${e(data.name)}</span>` + icon('chevron'),'chooseRepository',`class="repo-picker" title="${e(data.root)}" aria-label="选择仓库：${e(data.name)}"`)}<span class="branch-label" title="${e(s.branch)}">${icon('branch')}<span>${e(s.branch)}</span></span><span class="remote-label">${s.upstream ? '↑ ' + s.ahead + ' · ↓ ' + s.behind : '未设置上游'}</span></div><div class="header-actions"><div class="remote-actions">${btn('获取','fetch')}${btn('拉取','pull')}${btn('推送','push')}${btn('同步','sync','class="sync-button"')}</div>${btn('刷新','refresh','title="刷新" aria-label="刷新"')}${btn('在编辑器打开','openGraph','title="在编辑器打开" aria-label="在编辑器打开"')}</div></header><div class="workspace-shell"><nav class="tabs" aria-label="仓库功能">${navigation}<div class="nav-signature"><span class="signature-spectrum"></span><small>See changes.<br>Know history.</small></div></nav><div class="workspace-main">${data.operation ? `<div class="operation-bar"><span>${e(data.operation)} 正在进行 · ${s.conflicted} 个冲突文件</span>${btn('继续','finishOperation','data-operation-action="continue"')}${btn('中止','finishOperation','data-operation-action="abort"')}</div>` : ''}<div class="content content-${e(state.tab)}">${({graph:graphView,changes:changesView,branches:branchesView,tags:tagsView,stashes:stashesView,worktrees:worktreesView,compare:compareView,timeline:timelineView,rebase:rebaseView}[state.tab] || graphView)()}</div></div></div><footer class="footer"><span class="workspace-status ${s.conflicted ? 'has-conflicts' : ''}"><span class="status-dot"></span>${s.files.length ? s.files.length + ' 个变更 · 已暂存 ' + s.staged : '工作区干净'}${s.conflicted ? ' · 冲突 ' + s.conflicted : ''}</span><span id="loading-label">${busy ? '正在执行 Git 操作…' : loading ? '正在读取…' : '本地仓库'}</span></footer>`;
    app.setAttribute('aria-busy',String(loading || busy));
    if (busy) app.querySelectorAll('button[data-action]').forEach(b=>{ if (!['tab','copy','select','selectTimeline','diff','workingDiff'].includes(b.dataset.action)) b.disabled=true; });
    const scrollNode = document.getElementById('graph-scroll'); if (scrollNode) scrollNode.scrollTop=scroll;
    if (focused && document.getElementById(focused)) { const node=document.getElementById(focused); node.focus(); if (typeof start==='number' && node.setSelectionRange && node.type!=='search') node.setSelectionRange(start,end); }
  }
  function select(hash, timeline = false) {
    state.selected=hash; if (!timeline) state.tab='graph'; detail=undefined; detailLoading=true; persist(); render();
    detailRequest=++serial; send('details',{hash,request:detailRequest});
  }
  function compare(from, to) {
    state.compareFrom=from; state.compareTo=to; state.tab='compare'; comparisonLoading=true; comparison=undefined; persist(); render();
    compareRequest=++serial; send('compare',{from,to:to || 'HEAD',request:compareRequest});
  }
  function search(values) { state.tab='graph'; detail=undefined; state.selected=''; detailLoading=false; detailRequest=++serial; persist(); send('search',values); render(); }
  function loadTimeline(file) {
    state.tab='timeline'; state.timelineFile=file; timelineLoading=true; timelineRequest=++serial; persist(); render();
    send('timelineHistory',{file,request:timelineRequest});
  }
  app.addEventListener('input',event=>{
    if (event.target.id==='draft') state.draft=event.target.value;
    if (event.target.id==='compare-from') state.compareFrom=event.target.value;
    if (event.target.id==='compare-to') state.compareTo=event.target.value;
    persist();
  });
  app.addEventListener('click',event=>{
    const button=event.target.closest('button[data-action]'); if (!button || button.disabled) return;
    const a=button.dataset.action, d=button.dataset, value=id=>document.getElementById(id)?.value || '';
    if (a==='tab') { state.tab=d.tab; persist(); render(); if(d.tab==='timeline' && state.timelineFile && !timelineCommits.length && !timelineLoading)loadTimeline(state.timelineFile); return; }
    if (a==='select' || a==='selectTimeline') { select(d.hash,a==='selectTimeline'); return; }
    if (a==='search') { search({query:value('search'),searchBy:value('search-by'),ref:value('ref'),file:value('file-filter')}); return; }
    if (a==='clearSearch') { search({query:'',ref:'',file:''}); return; }
    if (a==='focusRef') { search({ref:d.ref}); return; }
    if (a==='compareStart' && detail) { state.compareFrom=detail.hash; state.tab='compare'; comparison=undefined; persist(); render(); return; }
    if (a==='compareHead' && detail) { compare(detail.hash,'HEAD'); return; }
    if (a==='compareRef') { compare(d.ref,'HEAD'); return; }
    if (a==='compare') { compare(value('compare-from'),value('compare-to')); return; }
    if (a==='swapCompare') { [state.compareFrom,state.compareTo]=[state.compareTo || 'HEAD',state.compareFrom]; comparison=undefined; persist(); render(); return; }
    if (a==='timelineSearch') { const file=value('timeline-file'); if(file)loadTimeline(file); return; }
    if (a==='rebasePlan') { const ref=d.ref || value('rebase-base'); if(!ref)return;state.tab='rebase';state.rebaseBase=ref;rebaseLoading=true;rebasePlan=undefined;rebaseRequest=++serial;persist();render();send('rebasePlan',{ref,request:rebaseRequest});return; }
    if (a==='moveRebase' && rebasePlan) { const i=Number(d.index),j=i+Number(d.direction);if(j>=0 && j<rebasePlan.commits.length){[rebasePlan.commits[i],rebasePlan.commits[j]]=[rebasePlan.commits[j],rebasePlan.commits[i]];render();}return; }
    if (a==='applyRebase' && rebasePlan) { send('applyRebase',{base:rebasePlan.base,head:rebasePlan.head,branch:rebasePlan.branch,steps:rebasePlan.commits.map(c=>({hash:c.hash,action:c.action}))});return; }
    if (a==='commit') { if (state.draft.trim()) send(a,{message:state.draft}); else notice('请填写提交消息',true); return; }
    if (a==='diff') { send(a,{file:d.file,oldFile:d.oldFile,from:d.from,to:d.to}); return; }
    if (a==='workingDiff') { send(a,{file:d.file,staged:d.staged==='true'}); return; }
    if (a==='copy') { send(a,{value:d.value}); notice('已复制哈希'); return; }
    if (a==='operation') { send(a,{action:d.operation,ref:d.ref}); return; }
    if (a==='finishOperation') { send(a,{action:d.operationAction}); return; }
    if (a==='stashAction') { send(a,{action:d.stashAction,hash:d.hash}); return; }
    send(a,{file:d.file,ref:d.ref,branch:d.branch,tag:d.tag,path:d.path});
  });
  app.addEventListener('change',event=>{ if (event.target.id==='ref') document.querySelector('[data-action="search"]')?.click();if(event.target.dataset.rebaseIndex!==undefined && rebasePlan){rebasePlan.commits[Number(event.target.dataset.rebaseIndex)].action=event.target.value;render();} });
  app.addEventListener('keydown',event=>{
    if (event.key==='Enter' && ['search','file-filter'].includes(event.target.id)) document.querySelector('[data-action="search"]')?.click();
    if (event.key==='Enter' && event.target.id==='timeline-file') document.querySelector('[data-action="timelineSearch"]')?.click();
    if (event.key==='Enter' && (event.ctrlKey || event.metaKey) && event.target.id==='draft') { event.preventDefault(); document.querySelector('[data-action="commit"]')?.click(); }
    if (['ArrowDown','ArrowUp'].includes(event.key) && event.target.classList.contains('commit-row')) {
      event.preventDefault(); const next=event.key==='ArrowDown' ? event.target.nextElementSibling : event.target.previousElementSibling; if (next?.classList.contains('commit-row')) next.focus();
    }
  });
  window.addEventListener('message',event=>{
    const m=event.data;
    if (m.type==='data') {
      if (m.data && state.root && state.root!==m.data.root) { state.selected=''; state.draft=''; detail=undefined; comparison=undefined; }
      data=m.data; state.root=data?.root; loading=false; persist(); render();
      if (state.selected && !detail && !detailLoading && data) select(state.selected,state.tab==='timeline');
    }
    if (m.type==='reset') { data=undefined; detail=undefined; comparison=undefined; timelineCommits=[];rebasePlan=undefined;rebaseLoading=false; state={tab:'graph',draft:'',selected:'',compareFrom:'HEAD',compareTo:''}; detailRequest=++serial; compareRequest=++serial; timelineRequest=++serial;rebaseRequest=++serial; detailLoading=false; comparisonLoading=false; timelineLoading=false; persist(); render(); }
    if (m.type==='loading') { loading=m.value; app.setAttribute('aria-busy',String(loading || busy)); const label=document.getElementById('loading-label'); if(label)label.textContent=loading ? '正在读取…' : '本地仓库'; }
    if (m.type==='busy') { busy=m.value; render(); }
    if (m.type==='details' && m.request===detailRequest) { detail=m.detail; detailLoading=false; render(); }
    if (m.type==='comparison' && m.request===compareRequest) { comparison=m.comparison; comparisonLoading=false; render(); }
    if (m.type==='revealCommit') select(m.hash);
    if (m.type==='timeline') loadTimeline(m.file);
    if (m.type==='timelineHistory' && m.request===timelineRequest) { timelineCommits=m.commits; timelineLoading=false; render(); }
    if (m.type==='rebasePlan' && m.request===rebaseRequest) { rebasePlan={...m.plan,commits:m.plan.commits.map(c=>({...c,action:'pick'}))};rebaseLoading=false;render(); }
    if (m.type==='rebased') { rebasePlan=undefined;state.tab='graph';state.selected='';detail=undefined;persist();render(); }
    if (m.type==='committed') { state.draft=''; persist(); }
    if (m.type==='error') { if(m.request && ![detailRequest,compareRequest,timelineRequest,rebaseRequest].includes(m.request))return; if (m.request===detailRequest) { detailLoading=false; state.selected=''; persist(); } if(m.request===compareRequest)comparisonLoading=false; if(m.request===timelineRequest)timelineLoading=false;if(m.request===rebaseRequest)rebaseLoading=false; loading=false; notice(m.message,true); render(); }
    if (m.type==='notice') notice(m.message);
  });
  send('ready');
})();
