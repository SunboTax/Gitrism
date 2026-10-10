/* Local webview. Repository values only enter markup through escapeHtml. */
(() => {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const saved = vscode.getState() || {};
  const localization = JSON.parse(document.getElementById('gitrism-localization')?.textContent || '{}');
  const locale = GitrismI18n.resolveLocale(localization.locale);
  const t = GitrismI18n.createTranslator(localization.messages);
  let state = { tab: 'graph', draft: '', selected: '', compareFrom: 'HEAD', compareTo: '', ...saved, searchDraft: undefined };
  let data, detail, comparison, busy = false, loading = true, detailRequest = 0, compareRequest = 0, serial = 0;
  let activity, activityError, activityWidth = 280;
  let detailLoading = false, comparisonLoading = false, toastTimer, timelineCommits = [], timelineLoading = false, timelineRequest = 0, rebasePlan, rebaseLoading = false, rebaseRequest = 0;
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const tr = (...args) => e(t(...args));
  const date = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? value : d.toLocaleString(locale); };
  const short = hash => (hash || '').slice(0, 8);
  const send = (type, values = {}) => vscode.postMessage({ type, ...values });
  const persist = () => { const {searchDraft, ...savedState} = state; vscode.setState(savedState); };
  let renderPending = false;
  const paneResize = GitrismPaneResize.create({
    root: app, getLayout: () => state.layout,
    saveLayout: layout => { state.layout = layout; persist(); },
    sizeText: size => t("{0} pixels", size),
    onEnd: () => { if (renderPending) { renderPending = false; render(); } }
  });
  const divider = kind => `<div id="${kind}-resizer" class="pane-resizer ${kind}-resizer" data-resize="${kind}" role="separator" tabindex="0" aria-orientation="vertical" aria-label="${kind==='navigation'?tr("Resize navigation"):tr("Resize history and details")}" title="${tr("Drag to resize. Use arrow keys; double-click or press Enter to reset.")}"></div>`;
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
    return (all ? `<option value="">${tr("All references")}</option>` : '<option value="HEAD">HEAD</option>') +
      data.branches.map(b => `<option value="${e(b.name)}" ${selected === b.name ? 'selected' : ''}>${b.isRemote ? t("Remote · ") : ''}${e(b.name)}</option>`).join('') +
      data.tags.map(t => `<option value="refs/tags/${e(t.name)}" ${selected === 'refs/tags/' + t.name ? 'selected' : ''}>${tr("Tag · ")}${e(t.name)}</option>`).join('');
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
    return commits.map((c, i) => `<button class="commit-row ${state.selected === c.hash ? 'selected' : ''}" data-action="select" data-hash="${e(c.hash)}" aria-pressed="${state.selected === c.hash}" title="${e(c.subject)}"><span class="graph-cell">${svg(graph.rows[i],i)}</span><span class="commit-subject">${c.refs ? `<span class="refs">${c.refs.split(', ').map(r => `<span class="ref ${r.startsWith('tag:') ? 'tag' : r.startsWith('HEAD') ? 'head' : ''}">${e(r)}</span>`).join('')}</span>` : ''}<span>${e(c.subject)}</span></span><span class="author"><span class="avatar">${e(c.author.slice(0,1).toUpperCase())}</span>${e(c.author)}</span><time title="${e(date(c.date))}">${e(new Date(c.date).toLocaleDateString(locale))}</time><code>${short(c.hash)}</code></button>`).join('');
  }
  function activityPane() {
    return `<section id="personal-activity" class="personal-activity" aria-label="${tr("Your activity")}">${activityContent()}</section>`;
  }
  function activityContent() {
    const heading = `<span class="eyebrow">${tr("Your repository rhythm")}</span><h2>${tr("Your activity")}</h2>`;
    if (activityError) return heading + `<p class="muted">${e(activityError)}</p>${btn(t("Retry"),'refresh')}`;
    if (!activity) return heading + `<p class="muted">${tr("Loading your activity…")}</p>`;
    if (!activity.email) return heading + `<p class="muted">${tr("Set user.email in this repository to see your personal activity.")}</p><code>git config user.email &quot;you@example.com&quot;</code>`;
    const period = [13,26,52].includes(Number(state.activityWeeks)) ? Number(state.activityWeeks) : 0;
    const calendar = GitrismActivity.calendar(activity.timestamps, period || GitrismActivity.autoWeeks(activityWidth));
    const width = calendar.weeks*14+26;
    const svg = `<svg class="activity-svg" viewBox="0 0 ${width} 128" width="${width}" height="128" role="group" aria-label="${tr('Activity over {0} weeks',calendar.weeks)}">${calendar.months.map(month=>`<text class="activity-label" x="${26+month.column*14}" y="12">${e(month.date.toLocaleDateString(locale,{month:'short'}))}</text>`).join('')}${[0,2,4].map(row=>`<text class="activity-label" x="0" y="${34+row*14}">${e(calendar.days[row].date.toLocaleDateString(locale,{weekday:'narrow'}))}</text>`).join('')}${calendar.days.map(day=>day.future ? '' : `<rect class="activity-day activity-level-${day.level}" x="${26+day.column*14}" y="${24+day.row*14}" width="10" height="10" rx="2" data-day="${day.key}" data-count="${day.count}" tabindex="0" role="button" aria-label="${tr('{0}: {1} commits',day.key,day.count)}"><title>${tr('{0}: {1} commits',day.key,day.count)}</title></rect>`).join('')}</svg>`;
    return `${heading}<p class="activity-identity" title="${e(activity.email)}">${e(activity.email)}</p><div class="activity-stats"><div><strong>${calendar.commits}</strong><span>${tr("Commits")}</span></div><div><strong>${calendar.activeDays}</strong><span>${tr("Active days")}</span></div></div><div class="activity-controls"><span>${e(calendar.start.toLocaleDateString(locale,{month:'short',day:'numeric'}))} – ${e(calendar.end.toLocaleDateString(locale,{month:'short',day:'numeric'}))}</span><select id="activity-period" aria-label="${tr("Activity period")}">${[[0,t("Auto")],[13,t("13 weeks")],[26,t("26 weeks")],[52,t("52 weeks")]].map(([value,label])=>`<option value="${value}" ${period===value?'selected':''}>${e(label)}</option>`).join('')}</select></div><div class="activity-grid">${svg}</div><div class="activity-legend"><span>${tr("Less")}</span>${[0,1,2,3,4].map(level=>`<span class="activity-swatch activity-level-${level}"></span>`).join('')}<span>${tr("More")}</span></div><p class="activity-note">${tr("Only your non-merge commits across local references. Days use commit time in your timezone.")}</p><p class="activity-invitation">${icon('search')}${tr("Select a day to explore your commits.")}</p>`;
  }
  function updateActivity() {
    const node = document.getElementById('personal-activity');
    if (node) node.innerHTML = activityContent();
  }
  const activityObserver = new ResizeObserver(entries=>{
    const width = entries[0]?.contentRect.width || 280;
    if (GitrismActivity.autoWeeks(width) !== GitrismActivity.autoWeeks(activityWidth)) { activityWidth=width; if (!Number(state.activityWeeks)) updateActivity(); }
    else activityWidth=width;
  });
  function localInputDate(iso) { return iso ? GitrismActivity.dayKey(new Date(iso)) : ''; }
  function advancedFilters(opts) {
    const active = [opts.since,opts.until,opts.authors?.length,opts.authorEmail,opts.merges && opts.merges!=='all',opts.firstParent].filter(Boolean).length;
    return `<details class="advanced-search" ${state.advancedOpen ? 'open' : ''}><summary>${icon('search')}${tr("Advanced")}${active ? `<span class="count">${active}</span>` : ''}${icon('chevron')}</summary><div class="advanced-panel"><div class="advanced-title">${tr("Advanced search")}</div><div class="advanced-dates"><label>${tr("From date")}<input id="since" type="date" value="${e(localInputDate(opts.since))}"></label><label>${tr("Through date")}<input id="until" type="date" value="${e(localInputDate(opts.until))}"></label></div><label>${tr("Authors (separate with semicolons)")}<input id="authors" value="${e((opts.authors || []).join('; '))}" placeholder="${tr("Name or email; another author")}" ${opts.authorEmail?'disabled':''}></label><label>${tr("Merge commits")}<select id="merges">${[['all',t("Include merges")],['exclude',t("Exclude merges")],['only',t("Only merges")]].map(([value,label])=>`<option value="${value}" ${opts.merges===value?'selected':''}>${e(label)}</option>`).join('')}</select></label><label class="check-option"><input id="first-parent" type="checkbox" ${opts.firstParent?'checked':''}>${tr("Follow first parent only")}</label><label class="check-option"><input id="only-mine" type="checkbox" ${opts.authorEmail?'checked':''} ${!activity?.email?'disabled':''}>${tr("Only my commits")}</label><p class="muted">${tr("Authors are matched literally (any match). Other filters combine. Dates use commit time in your timezone.")}</p><div class="advanced-actions">${btn(t("Last 7 days"),'lastWeek')}${btn(t("Apply filters"),'search','',true)}</div></div></details>`;
  }
  function readSearch() {
    const value=id=>document.getElementById(id)?.value || '';
    const own=document.getElementById('only-mine')?.checked;
    const since=value('since'), until=value('until');
    return {query:value('search'),searchBy:own && value('search-by')==='author'?'message':value('search-by'),ref:value('ref'),file:value('file-filter'),authors:own?[]:value('authors').split(';').map(author=>author.trim()).filter(Boolean),authorEmail:own?activity?.email:undefined,since:since?GitrismActivity.dayBounds(since).since:undefined,until:until?GitrismActivity.dayBounds(until).until:undefined,merges:value('merges')||'all',firstParent:document.getElementById('first-parent')?.checked||false};
  }
  function searchDay(key) {
    if (!activity?.email || busy) return;
    search({authorEmail:activity.email,merges:'exclude',searchBy:'message',...GitrismActivity.dayBounds(key)});
  }
  function detailPane() {
    if (detailLoading) return empty(t("Loading commit…"));
    if (!detail && state.tab==='graph') return activityPane();
    if (!detail) return empty(t("Select a commit"), t("Inspect changed files, navigate parents, and open diffs."));
    const d = detail;
    return `${state.tab==='graph'?btn(t("Back to your activity"),'clearSelection','class="back-activity"'):''}<div class="detail-header"><span class="eyebrow">${tr("Commit details")}${d.parents.length > 1 ? t(" · Merge commit") : ''}</span><h2>${e(d.message.split('\n')[0])}</h2><div class="person"><span class="avatar large">${e(d.author.slice(0,1))}</span><div><strong>${e(d.author)}</strong><small>${e(date(d.date))}</small></div></div>${btn(short(d.hash), 'copy', `data-value="${e(d.hash)}" title="${tr("Copy full hash")}"`)}<div class="parent-links">${d.parents.map(p => btn(t("Parent ") + short(p), 'select', `data-hash="${e(p)}"`)).join('')}</div></div><div class="detail-actions">${btn(t("Compare with HEAD"),'compareHead')}${btn(t("Create branch"),'createBranch',`data-ref="${e(d.hash)}"`)}<details class="more-actions"><summary>${tr("More actions")} ${icon('chevron')}</summary><div class="action-menu">${btn(t("Set comparison start"),'compareStart')}${btn(t("Create tag"),'createTag',`data-ref="${e(d.hash)}"`)}${btn(t("Organize subsequent history"),'rebasePlan',`data-ref="${e(d.hash)}"`)}${btn('Cherry-pick','operation',`data-operation="cherry-pick" data-ref="${e(d.hash)}"`)}${btn('Revert','operation',`data-operation="revert" data-ref="${e(d.hash)}"`)}</div></details></div>${d.message.includes('\n') ? `<pre class="commit-body">${e(d.message.slice(d.message.indexOf('\n')+1).trim())}</pre>` : ''}<h3>${tr("Changed files")} <span class="count">${d.files.length}</span></h3><div class="file-list">${changedFiles(d.files, d.parents[0] || 'EMPTY', d.hash)}</div><details><summary>${tr("Change statistics · Relative to ")}${d.parents.length > 1 ? t("first parent") : t("parent")}</summary><pre>${e(d.stats)}</pre></details>`;
  }
  function changedFiles(files, from, to) {
    return files.map(f => `<button class="file-diff" data-action="diff" data-file="${e(f.path)}" data-old-file="${e(f.oldPath || f.path)}" data-from="${e(f.from || (f.status === 'A' ? 'EMPTY' : from))}" data-to="${e(f.to || (f.status === 'D' ? 'EMPTY' : to))}"><span class="file-status status-${e(f.status)}">${e(f.status)}</span><span title="${e(f.path)}">${f.oldPath ? e(f.oldPath) + ' → ' : ''}${e(f.path)}</span><span class="diff-arrow">${icon('external')}</span></button>`).join('') || empty(t("No file differences"));
  }
  function graphView() {
    const opts = state.searchDraft || data.options || {};
    return `<div class="view-heading"><div><span class="eyebrow">${tr("Repository history")}</span><h2>${tr("Commit graph")} <span class="count">${data.commits.length}${data.hasMore ? '+' : ''}</span></h2></div><span class="view-caption">${tr("Every change leaves a trace.")}</span></div><div class="filters"><select id="ref" aria-label="${tr("History reference")}">${refOptions(opts.ref)}</select><div class="search-control">${icon('search')}<select id="search-by" aria-label="${tr("Search field")}"><option value="message">${tr("Message")}</option><option value="author" ${opts.authorEmail?'disabled':''} ${opts.searchBy==='author'?'selected':''}>${tr("Author")}</option><option value="hash" ${opts.searchBy==='hash'?'selected':''}>${tr("Hash / reference")}</option></select><input id="search" type="search" value="${e(opts.query)}" placeholder="${tr("Search commits, press Enter")}" aria-label="${tr("Search commits")}"></div><input id="file-filter" value="${e(opts.file)}" placeholder="${tr("File path (optional)")}" aria-label="${tr("File history path")}">${advancedFilters(opts)}${btn(t("Filter"),'search','',true)}${btn(t("Clear"),'clearSearch')}</div>${opts.query || opts.file || opts.authors?.length || opts.authorEmail || opts.since || opts.until || opts.firstParent || (opts.merges && opts.merges!=='all') ? `<div class="hint">${tr("Filtered results; excluded parent commits are not shown in the graph.")}</div>` : ''}<div class="graph-layout"><section id="graph-area" class="graph-area ${layoutGraph(data.commits).width <= 3 ? 'graph-compact' : ''}" aria-label="${tr("Commit graph")}"><div class="graph-scroll" id="graph-scroll"><div class="graph-head"><span>${tr("Graph")}</span><span>${tr("Message and references")}</span><span>${tr("Author")}</span><span>${tr("Date")}</span><span>${tr("Hash")}</span></div>${graphRows(data.commits) || empty(t("No matching commits"), t("Create your first commit in Working changes to start a new repository."))}${data.hasMore ? btn(t("Load more commits"),'more','class="load-more"') : ''}<div class="graph-foot">${tr('Commits: {0} · Topological order', data.commits.length)}${data.hasMore ? '' : t(" · End of results")}</div></div></section>${divider('detail')}<aside id="detail-pane" class="detail-pane" aria-label="${tr("Commit details")}">${detailPane()}</aside></div>`;
  }
  function workingFiles(files, staged, label) {
    return `<section class="working-group"><h3>${label} <span class="count">${files.length}</span></h3>${files.map(f => `<div class="working-file"><button class="file-diff" data-action="workingDiff" data-file="${e(f.path)}" data-staged="${staged}"><span class="file-status status-${f.conflict ? 'U' : e(staged ? f.index : f.working)}">${f.conflict ? '!' : e(staged ? f.index : f.working)}</span><span>${e(f.path)}</span></button>${btn(staged ? t("Unstage") : t("Stage"),staged ? 'unstage' : 'stage',`data-file="${e(f.path)}"`)}</div>`).join('') || `<p class="muted">${tr("No files")}</p>`}</section>`;
  }
  function changesView() {
    const files = data.status.files;
    return `<div class="changes-layout"><section class="change-files">${files.some(f=>f.conflict) ? workingFiles(files.filter(f=>f.conflict),false,t("Conflicts · Edit and stage to resolve")) : ''}${workingFiles(files.filter(f=>!f.conflict && f.index !== ' ' && f.index !== '?'),true,t("Staged"))}${workingFiles(files.filter(f=>!f.conflict && (f.working !== ' ' || f.index === '?')),false,t("Working changes"))}</section><aside class="commit-compose"><span class="eyebrow">${tr("Current branch")}</span><h2 class="compose-branch">${icon('branch')} ${e(data.status.branch)}</h2><p class="muted">${tr("Only staged files are committed. Select a file to inspect its diff.")}</p><textarea id="draft" placeholder="${tr('Commit summary\n\nDescribe your changes…')}" aria-label="${tr("Commit message")}">${e(state.draft)}</textarea><div class="compose-actions">${btn(t("Stage all"),'stageAll')}${btn(t("Unstage all"),'unstageAll')}${btn(t("Commit staged files"),'commit',data.status.staged === 0 || data.status.conflicted ? 'disabled' : '',true)}</div><small class="muted">${tr("Ctrl / ⌘ + Enter to commit")}</small>${btn(t("Save to stash"),'stashPush')}</aside></div>`;
  }
  function branchesView() {
    return `<div class="section-heading"><div><h2>${tr("Branches")}</h2><p>${tr("Switch branches, explore history, compare, or integrate changes.")}</p></div>${btn(t("New branch"),'createBranch')}</div><div class="cards">${data.branches.map(b=>`<article class="card"><div class="card-title"><strong class="entity-title">${icon('branch')}${e(b.name)}</strong>${b.current ? `<span class="ref head">${tr("Current")}</span>` : ''}${b.isRemote ? `<span class="ref">${tr("Remote")}</span>` : ''}</div><p>${e(b.remote || (b.isRemote ? t("Remote tracking branch") : t("No upstream")))} <code>${short(b.hash)}</code></p><div class="card-actions">${!b.current && !b.isRemote ? btn(t("Switch"),'checkout',`data-branch="${e(b.name)}"`) : ''}${btn(t("History"),'focusRef',`data-ref="${e(b.name)}"`)}${btn(t("Compare with HEAD"),'compareRef',`data-ref="${e(b.name)}"`)}${!b.current ? btn(t("Merge into current"),'operation',`data-operation="merge" data-ref="${e(b.name)}"`) + btn(t("Rebase current onto this"),'operation',`data-operation="rebase" data-ref="${e(b.name)}"`) : ''}${!b.current && !b.isRemote ? btn(t("Delete"),'deleteBranch',`data-branch="${e(b.name)}"`) : ''}</div></article>`).join('') || empty(t("No branches yet"))}</div>`;
  }
  function tagsView() {
    return `<div class="section-heading"><div><h2>${tr("Tags")}</h2><p>${tr("Local version markers")}</p></div>${btn(t("Create tag"),'createTag')}</div><div class="cards">${data.tags.map(tag=>`<article class="card"><strong class="entity-title">${icon('tag')}${e(tag.name)}</strong><p>${e(tag.subject)}</p><small class="muted">${e(date(tag.date))}</small><div class="card-actions">${btn(t("View commit"),'select',`data-hash="refs/tags/${e(tag.name)}"`)}${btn(t("History"),'focusRef',`data-ref="refs/tags/${e(tag.name)}"`)}${btn(t("Delete"),'deleteTag',`data-tag="${e(tag.name)}"`)}</div></article>`).join('') || empty(t("No tags"))}</div>`;
  }
  function stashesView() {
    return `<div class="section-heading"><div><h2>Stashes</h2><p>${tr("Save uncommitted work to restore later.")}</p></div>${btn(t("Save working changes"),'stashPush')}</div><div class="cards">${data.stashes.map(s=>`<article class="card"><strong>${e(s.subject)}</strong><p><code>${e(s.ref)}</code> · ${e(date(s.date))}</p><div class="card-actions">${btn(t("View changes"),'select',`data-hash="${e(s.hash)}"`)}${['apply','pop','drop'].map((a,i)=>btn([t("Apply and keep"),t("Pop"),t("Delete")][i],'stashAction',`data-stash-action="${a}" data-hash="${e(s.hash)}"`)).join('')}</div></article>`).join('') || empty(t("No saved work"))}</div>`;
  }
  function worktreesView() {
    if (data.worktreesError) return `<div class="section-heading"><h2>Worktrees</h2>${btn(t("Reload"),'refresh')}</div>${empty(t("Unable to read worktrees"),data.worktreesError)}`;
    return `<div class="section-heading"><div><h2>Worktrees</h2><p>${tr("Work on multiple branches in separate directories.")}</p></div>${btn(t("Create worktree"),'createWorktree')}</div><div class="cards">${data.worktrees.map(w=>`<article class="card"><strong class="entity-title">${icon('worktree')}${e(w.branch)}</strong>${w.path===data.root ? `<span class="ref head">${tr("Current workspace")}</span>`:''}<p class="path">${e(w.path)}</p><small class="muted">${e(w.locked || w.prunable || short(w.hash))}</small><div class="card-actions">${btn(t("Open in new window"),'openWorktree',`data-path="${e(w.path)}"`)}${w.path!==data.root && !w.locked ? btn(t("Remove"),'removeWorktree',`data-path="${e(w.path)}"`) : ''}</div></article>`).join('')}</div>`;
  }
  function compareView() {
    return `<div class="section-heading"><div><h2>${tr("Compare references")}</h2><p>${tr("Compare final file contents between branches, tags, or commits.")}</p></div></div><div class="compare-form"><label>${tr("From")}<input id="compare-from" list="refs-list" value="${e(state.compareFrom)}" placeholder="${tr("Branch / tag / hash")}"></label>${btn('⇄','swapCompare',`aria-label="${tr("Swap comparison direction")}"`)}<label>${tr("To")}<input id="compare-to" list="refs-list" value="${e(state.compareTo)}" placeholder="HEAD"></label><datalist id="refs-list"><option value="HEAD">${data.branches.map(b=>`<option value="${e(b.name)}">`).join('')}${data.tags.map(t=>`<option value="refs/tags/${e(t.name)}">`).join('')}</datalist>${btn(t("Compare"),'compare','',true)}</div>${comparisonLoading ? empty(t("Comparing…")) : comparison ? `<div class="comparison-result"><div class="comparison-summary"><code>${short(comparison.from)} → ${short(comparison.to)}</code><span>${tr('Files: {0}', comparison.files.length)}</span><span>${tr('Commits unique to target: {0}', comparison.ahead)}</span><span>${tr('Commits unique to source: {0}', comparison.behind)}</span></div><div class="comparison-grid"><section><h3>${tr("File differences")}</h3>${changedFiles(comparison.files,comparison.from,comparison.to)}<details><summary>${tr("Change statistics")}</summary><pre>${e(comparison.stats)}</pre></details></section><section><h3>${tr("Commits unique to target (up to 200)")}</h3>${comparison.commits.map(c=>`<button class="timeline-commit" data-action="select" data-hash="${e(c.hash)}"><code>${short(c.hash)}</code><span>${e(c.subject)}</span><small>${e(c.author)}</small></button>`).join('') || empty(t("No unique commits"))}</section></div></div>` : empty(t("Choose two references to compare"), t("You can also set the starting point from commit details."))}`;
  }
  function timelineView() {
    const commits = timelineCommits;
    const months = new Map();
    commits.forEach(c=>{const month=c.date.slice(0,7);months.set(month,(months.get(month)||0)+1);});
    const buckets=[...months.entries()].reverse().slice(-24), max=Math.max(1,...buckets.map(b=>b[1]));
    const chart=buckets.length ? `<svg class="timeline-chart" viewBox="0 0 ${Math.max(120,buckets.length*24)} 55" role="img" aria-label="${tr("Commit counts for the latest 24 active months")}">${buckets.map(([month,count],i)=>`<rect x="${i*24+3}" y="${46-count/max*38}" width="16" height="${count/max*38}"><title>${e(month)} · ${tr('{0} commits', count)}</title></rect>`).join('')}</svg>` : '';
    return `<div class="section-heading"><div><h2>${tr("File timeline")}</h2><p>${tr("Explore file history across commits, including renames.")}</p></div>${btn(t("Use active file"),'activeHistory')}</div><div class="timeline-form"><input id="timeline-file" value="${e(state.timelineFile)}" placeholder="${tr("File path relative to the repository root")}" aria-label="${tr("Timeline file path")}">${btn(t("View history"),'timelineSearch','',true)}</div>${timelineLoading ? empty(t("Loading file history…")) : state.timelineFile ? `<div class="timeline-summary"><strong>${e(state.timelineFile)}</strong><span>${tr('History entries: {0} (up to 500)', commits.length)}</span></div>${chart}<div class="timeline-layout"><section id="timeline-list" class="timeline-list">${commits.map(c=>`<button class="timeline-commit ${state.selected===c.hash?'selected':''}" data-action="selectTimeline" data-hash="${e(c.hash)}"><time>${e(date(c.date))}</time><strong>${e(c.subject)}</strong><small>${e(c.author)} · ${short(c.hash)}</small></button>`).join('') || empty(t("No file history"))}</section>${divider('detail')}<aside id="detail-pane" class="detail-pane">${detailPane()}</aside></div>` : empty(t("Open a file's history"), t("You can also open the file timeline from the editor context menu."))}`;
  }
  function rebaseView() {
    return `<div class="section-heading"><div><h2>${tr("Organize commit history")}</h2><p>${tr("Keep the base and reorder subsequent linear commits through HEAD.")}</p></div></div><div class="timeline-form"><input id="rebase-base" value="${e(state.rebaseBase)}" placeholder="${tr("Base, such as HEAD~3 or a commit hash")}" aria-label="${tr("Rebase base")}">${btn(t("Create plan"),'rebasePlan','',true)}</div>${rebaseLoading ? empty(t("Creating plan…")) : rebasePlan ? `<div class="rebase-plan"><div class="comparison-summary"><strong class="entity-title">${icon('branch')}${e(rebasePlan.branch)}</strong><code>${short(rebasePlan.base)} → ${short(rebasePlan.head)}</code><span>${tr('Commits: {0} · Oldest first', rebasePlan.commits.length)}</span></div><p class="muted">${tr("Use the arrows to reorder. squash combines messages, fixup discards this message, and drop removes a commit. A backup branch is created before applying.")}</p><div class="rebase-steps">${rebasePlan.commits.map((c,i)=>`<div class="rebase-step ${c.action==='drop'?'dropped':''}"><span class="step-number">${i+1}</span><select data-rebase-index="${i}" aria-label="${tr('Action for commit {0}', i+1)}">${['pick','squash','fixup','drop'].map(a=>`<option value="${a}" ${c.action===a?'selected':''}>${a}</option>`).join('')}</select><code>${short(c.hash)}</code><span class="step-subject" title="${e(c.subject)}">${e(c.subject)}</span>${btn('↑','moveRebase',`data-index="${i}" data-direction="-1" ${i===0?'disabled':''} aria-label="${tr("Move commit up")}"`)}${btn('↓','moveRebase',`data-index="${i}" data-direction="1" ${i===rebasePlan.commits.length-1?'disabled':''} aria-label="${tr("Move commit down")}"`)}</div>`).join('')}</div><div class="rebase-actions">${btn(t("Apply rebase plan"),'applyRebase',data.status.files.length || data.operation ? 'disabled' : '',true)}${btn(t("Reset order"),'rebasePlan',`data-ref="${e(rebasePlan.base)}"`)}<span class="muted">${data.status.files.length ? t("Commit or stash your working changes first.") : t("Only organize history that is suitable for rewriting.")}</span></div></div>` : empty(t("Create a rebase plan first"), t("You can also choose “Organize subsequent history” from commit details."))}`;
  }
  function render() {
    if (paneResize.isDragging()) { renderPending = true; return; }
    const focused = document.activeElement?.id, start = document.activeElement?.selectionStart, end = document.activeElement?.selectionEnd;
    const scroll = document.getElementById('graph-scroll')?.scrollTop || 0;
    if (!data) { app.innerHTML = empty(loading ? t("Loading repository…") : t("Open a Git repository"), t("Gitrism uses local Git. No account or subscription required.")) + btn(t("Choose repository"),'chooseRepository') + btn(t("Reload"),'refresh'); return; }
    const tabs = [['graph','graph',t("Commit graph")],['changes','changes',t("Working changes")],['branches','branch',t("Branches")],['tags','tag',t("Tags")],['stashes','stash','Stashes'],['worktrees','worktree','Worktrees'],['compare','compare',t("Compare")],['timeline','timeline',t("File timeline")],['rebase','rebase',t("Organize history")]];
    const s = data.status;
    const navigation = tabs.map(([id,glyph,label],i)=>`${i===0 ? `<span class="nav-heading">${tr("Repository")}</span>` : i===6 ? `<span class="nav-heading">${tr("Explore and organize")}</span>` : ''}<button class="tab ${state.tab===id?'active':''}" data-action="tab" data-tab="${id}" aria-current="${state.tab===id?'page':'false'}">${icon(glyph)}<span>${label}</span>${id==='changes' && s.files.length ? `<span class="count">${s.files.length}</span>` : ''}</button>`).join('');
    app.innerHTML = `<header class="header"><div class="brand"><span class="brand-mark">${icon('prism')}</span><div><strong>Gitrism</strong><small>See changes. Know history.</small></div></div><div class="repository-context">${btn(`<span class="repo-name">${e(data.name)}</span>` + icon('chevron'),'chooseRepository',`class="repo-picker" title="${e(data.root)}" aria-label="${tr('Choose repository: {0}', data.name)}"`)}<span class="branch-label" title="${e(s.branch)}">${icon('branch')}<span>${e(s.branch)}</span></span><span class="remote-label">${s.upstream ? '↑ ' + s.ahead + ' · ↓ ' + s.behind : t("No upstream")}</span></div><div class="header-actions"><div class="remote-actions">${btn(t("Fetch"),'fetch')}${btn(t("Pull"),'pull')}${btn(t("Push"),'push')}${btn(t("Sync"),'sync','class="sync-button"')}</div>${btn(t("Refresh"),'refresh',`title="${tr("Refresh")}" aria-label="${tr("Refresh")}"`)}${btn(t("Open in editor"),'openGraph',`title="${tr("Open in editor")}" aria-label="${tr("Open in editor")}"`)}</div></header><div class="workspace-shell"><nav id="repository-nav" class="tabs" aria-label="${tr("Repository navigation")}">${navigation}<div class="nav-signature"><span class="signature-spectrum"></span><small>See changes.<br>Know history.</small></div></nav>${divider('navigation')}<div class="workspace-main">${data.operation ? `<div class="operation-bar"><span>${tr('Operation in progress: {0} · Conflicted files: {1}', data.operation, s.conflicted)}</span>${btn(t("Continue"),'finishOperation','data-operation-action="continue"')}${btn(t("Abort"),'finishOperation','data-operation-action="abort"')}</div>` : ''}<div class="content content-${e(state.tab)}">${({graph:graphView,changes:changesView,branches:branchesView,tags:tagsView,stashes:stashesView,worktrees:worktreesView,compare:compareView,timeline:timelineView,rebase:rebaseView}[state.tab] || graphView)()}</div></div></div><footer class="footer"><span class="workspace-status ${s.conflicted ? 'has-conflicts' : ''}"><span class="status-dot"></span>${s.files.length ? tr('Changes: {0} · Staged: {1}', s.files.length, s.staged) : t("Working tree clean")}${s.conflicted ? tr(' · Conflicts: {0}', s.conflicted) : ''}</span><span id="loading-label">${busy ? t("Running Git operation…") : loading ? t("Loading…") : t("Local repository")}</span></footer>`;
    paneResize.sync();
    activityObserver.disconnect();
    const activityNode=document.getElementById('personal-activity'); if(activityNode) activityObserver.observe(activityNode);
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
  function search(values) { state.searchDraft=values; state.advancedOpen=false; state.tab='graph'; detail=undefined; state.selected=''; detailLoading=false; detailRequest=++serial; persist(); send('search',values); render(); }
  function loadTimeline(file) {
    state.tab='timeline'; state.timelineFile=file; timelineLoading=true; timelineRequest=++serial; persist(); render();
    send('timelineHistory',{file,request:timelineRequest});
  }
  app.addEventListener('input',event=>{
    if (event.target.id==='draft') state.draft=event.target.value;
    if (event.target.id==='compare-from') state.compareFrom=event.target.value;
    if (event.target.id==='compare-to') state.compareTo=event.target.value;
    if (['search','search-by','ref','file-filter','since','until','authors','merges','first-parent','only-mine'].includes(event.target.id)) { try { state.searchDraft=readSearch(); } catch {} }
    persist();
  });
  app.addEventListener('click' ,event=>{
    const day=event.target.closest('[data-day]'); if(day) {searchDay(day.dataset.day);return;}
    if (event.target.closest('.advanced-search summary')) { state.advancedOpen=!event.target.closest('.advanced-search').open;persist(); }
    const button=event.target.closest('button[data-action]'); if (!button || button.disabled) return;
    const a=button.dataset.action, d=button.dataset, value=id=>document.getElementById(id)?.value || '';
    if (a==='tab') { state.tab=d.tab; persist(); render(); if(d.tab==='timeline' && state.timelineFile && !timelineCommits.length && !timelineLoading)loadTimeline(state.timelineFile); return; }
    if (a==='select' || a==='selectTimeline') { select(d.hash,a==='selectTimeline'); return; }
    if (a==='search') { try { search(readSearch()); } catch { notice(t("Invalid search date"),true); } return; }
    if (a==='clearSelection') { state.selected='';detail=undefined;detailLoading=false;detailRequest=++serial;persist();render();return; }
    if (a==='lastWeek') { const now=new Date(),start=new Date(now);start.setDate(start.getDate()-6);document.getElementById('since').value=GitrismActivity.dayKey(start);document.getElementById('until').value=GitrismActivity.dayKey(now);state.searchDraft=readSearch();persist();return; }
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
    if (a==='commit') { if (state.draft.trim()) send(a,{message:state.draft}); else notice(t("Enter a commit message"),true); return; }
    if (a==='diff') { send(a,{file:d.file,oldFile:d.oldFile,from:d.from,to:d.to}); return; }
    if (a==='workingDiff') { send(a,{file:d.file,staged:d.staged==='true'}); return; }
    if (a==='copy') { send(a,{value:d.value}); notice(t("Hash copied")); return; }
    if (a==='operation') { send(a,{action:d.operation,ref:d.ref}); return; }
    if (a==='finishOperation') { send(a,{action:d.operationAction}); return; }
    if (a==='stashAction') { send(a,{action:d.stashAction,hash:d.hash}); return; }
    send(a,{file:d.file,ref:d.ref,branch:d.branch,tag:d.tag,path:d.path});
  });
  app.addEventListener('change',event=>{
    if(event.target.id==='activity-period') {state.activityWeeks=Number(event.target.value);persist();updateActivity();return;}
    if(event.target.id==='only-mine') { const own=event.target.checked;document.getElementById('authors').disabled=own;document.querySelector('#search-by option[value=author]').disabled=own;if(own){document.getElementById('authors').value='';if(document.getElementById('search-by').value==='author')document.getElementById('search-by').value='message';} }
    if(['search-by','ref','merges','first-parent','only-mine'].includes(event.target.id)) {state.searchDraft=readSearch();persist();}
 if (event.target.id==='ref') document.querySelector('[data-action="search"]')?.click();if(event.target.dataset.rebaseIndex!==undefined && rebasePlan){rebasePlan.commits[Number(event.target.dataset.rebaseIndex)].action=event.target.value;render();} });
  app.addEventListener('keydown',event=>{
    if (event.target.matches('[data-day]') && ['Enter',' '].includes(event.key)) {event.preventDefault();searchDay(event.target.dataset.day);return;}
    if (event.key==='Escape') {const advanced=app.querySelector('.advanced-search');if(advanced){advanced.open=false;state.advancedOpen=false;persist();}}
    if (event.key==='Enter' && ['search','file-filter','authors','since','until'].includes(event.target.id)) document.querySelector('[data-action="search"]')?.click();
    if (event.key==='Enter' && event.target.id==='timeline-file') document.querySelector('[data-action="timelineSearch"]')?.click();
    if (event.key==='Enter' && (event.ctrlKey || event.metaKey) && event.target.id==='draft') { event.preventDefault(); document.querySelector('[data-action="commit"]')?.click(); }
    if (['ArrowDown','ArrowUp'].includes(event.key) && event.target.classList.contains('commit-row')) {
      event.preventDefault(); const next=event.key==='ArrowDown' ? event.target.nextElementSibling : event.target.previousElementSibling; if (next?.classList.contains('commit-row')) next.focus();
    }
  });
  window.addEventListener('message',event=>{
    const m=event.data;
    if (m.type==='data') {
      if (m.data && state.root && state.root!==m.data.root) { state.selected=''; state.draft=''; state.searchDraft=undefined;activity=undefined;activityError=undefined;detail=undefined; comparison=undefined; }
      data=m.data; state.root=data?.root; loading=false; persist(); render();
      if (state.selected && !detail && !detailLoading && data) select(state.selected,state.tab==='timeline');
    }
    if (m.type==='reset') { activity=undefined;activityError=undefined;data=undefined; detail=undefined; comparison=undefined; timelineCommits=[];rebasePlan=undefined;rebaseLoading=false; state={tab:'graph',draft:'',selected:'',compareFrom:'HEAD',compareTo:'',layout:state.layout}; detailRequest=++serial; compareRequest=++serial; timelineRequest=++serial;rebaseRequest=++serial; detailLoading=false; comparisonLoading=false; timelineLoading=false; persist(); render(); }
    if (m.type==='activity' && m.root===data?.root) { activity=m.activity;activityError=m.error;updateActivity();const mine=document.getElementById('only-mine');if(mine)mine.disabled=!activity?.email; }
    if (m.type==='loading') { loading=m.value; app.setAttribute('aria-busy',String(loading || busy)); const label=document.getElementById('loading-label'); if(label)label.textContent=loading ? t("Loading…") : t("Local repository"); }
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
