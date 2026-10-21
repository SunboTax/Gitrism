local M = {}
local git = require('gitrism.git')
local ns = vim.api.nvim_create_namespace('gitrism.graph')
local win_options = { 'number', 'relativenumber', 'signcolumn', 'foldcolumn', 'wrap', 'cursorline', 'spell', 'list' }
local states = {}
local function notify(text) vim.notify(text, vim.log.levels.WARN, { title = 'Gitrism' }) end
local function alive(state) return not state.closed and vim.api.nvim_buf_is_valid(state.buf) end
local function replace(buf, lines)
  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
end
local function scratch(name, repo)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_name(buf, name .. ' #' .. buf)
  vim.bo[buf].bufhidden = 'wipe'; vim.bo[buf].swapfile = false
  vim.b[buf].gitrism_repo = repo
  return buf
end
local function window_options(win)
  vim.wo[win].number = false; vim.wo[win].relativenumber = false
  vim.wo[win].signcolumn = 'no'; vim.wo[win].foldcolumn = '0'
  vim.wo[win].wrap = false; vim.wo[win].cursorline = true
  vim.wo[win].spell = false; vim.wo[win].list = false
end
local function close_buffer(buf)
  if vim.api.nvim_buf_is_valid(buf) then vim.api.nvim_buf_delete(buf, { force = true }) end
end
local function details(repo, ref, patch, owner)
  local buf = scratch('Gitrism commit', repo)
  if vim.o.columns >= 120 then vim.cmd('botright vsplit') else vim.cmd('botright 12split') end
  local win = vim.api.nvim_get_current_win()
  vim.api.nvim_win_set_buf(win, buf); window_options(win)
  vim.bo[buf].filetype = 'git'
  if owner then
    if owner.detail then close_buffer(owner.detail) end
    owner.detail = buf
  end
  local task, generation, closed = nil, 0, false
  local function load(full)
    generation = generation + 1; local current = generation
    if task then task.cancel() end
    replace(buf, { 'Loading commit…' })
    task = git.resolve(repo, ref, function(hash, err)
      if closed or generation ~= current then return end
      if err then replace(buf, { err }); return end
      local args = { 'show', '--no-show-signature', '--no-ext-diff', '--no-textconv', '--format=fuller', '--stat' }
      if full then table.insert(args, '--patch') end
      vim.list_extend(args, { hash, '--' })
      task = git.run(repo, args, function(text, error)
        if closed or generation ~= current then return end
        local lines = { full and 'p summary · q close' or 'p load patch · q close', '' }
        for _, line in ipairs(vim.split(text or error, '\n', { plain = true })) do table.insert(lines, git.clean(line)) end
        replace(buf, lines)
        vim.b[buf].gitrism_commit = hash; vim.b[buf].gitrism_patch = full
      end)
    end)
  end
  vim.keymap.set('n', 'p', function() patch = not patch; load(patch) end, { buffer = buf, desc = 'Toggle commit patch' })
  vim.keymap.set('n', 'q', function() close_buffer(buf) end, { buffer = buf, nowait = true })
  vim.api.nvim_create_autocmd('BufWipeout', { buffer = buf, once = true, callback = function()
    closed = true; if task then task.cancel() end
  end })
  load(patch)
end
function M.commit(repo, ref) details(repo, ref, false) end
local function selected(state)
  if not vim.api.nvim_win_is_valid(state.win) then return nil end
  local row = vim.api.nvim_win_get_cursor(state.win)[1]
  return state.by_row[row]
end
local function render(state, text)
  local old = selected(state)
  local lines = {
    'Gitrism  /  ' .. git.clean(vim.fs.basename(state.repo)) .. (state.file and '  /  ' .. git.clean(state.file) or ''),
    '', 'Enter details · p patch · L more · s filter · q back', '',
  }
  local marks, rows, by_row, count = {}, {}, {}, 0
  for _, line in ipairs(vim.split(text, '\n', { plain = true, trimempty = true })) do
    local fields = vim.split(line, '\31', { plain = true })
    if #fields >= 7 and fields[2]:match('^[0-9a-f]+$') then
      count = count + 1
      if count > state.limit then break end
      local prefix, short = git.clean(fields[1]), fields[3]
      local refs, subject = git.clean(fields[6]), git.clean(table.concat(fields, '\31', 7))
      local decoration = refs ~= '' and (' [' .. refs .. ']') or ''
      local summary = prefix .. short .. decoration .. '  ' .. subject
      local tail = '  · ' .. git.clean(fields[4]) .. ' · ' .. git.clean(fields[5])
      table.insert(lines, summary .. tail)
      local row = #lines
      by_row[row] = fields[2]; table.insert(rows, { row = row, hash = fields[2] })
      table.insert(marks, { row, #prefix, #prefix + #short, 'GitrismHash' })
      if refs ~= '' then table.insert(marks, { row, #prefix + #short, #prefix + #short + #decoration, 'GitrismRef' }) end
      table.insert(marks, { row, #summary, #lines[row], 'Comment' })
    else
      table.insert(lines, git.clean(line))
    end
    local prefix = fields[1]
    for col = 1, #prefix do
      if prefix:sub(col, col):find('[*|/\\._-]') then
        table.insert(marks, { #lines, col - 1, col, 'GitrismLane' .. (math.floor((col - 1) / 2) % 6 + 1) })
      end
    end
  end
  state.more = count > state.limit
  lines[2] = math.min(count, state.limit) .. ' commits' .. (state.more and '  · L loads more' or '  · end of history')
    .. (state.filter ~= '' and '  · subject contains: ' .. git.clean(state.filter) or '')
  if count == 0 then table.insert(lines, 'No commits found.') end
  state.by_row, state.rows = by_row, rows
  replace(state.buf, lines)
  vim.api.nvim_buf_clear_namespace(state.buf, ns, 0, -1)
  for _, mark in ipairs(marks) do vim.api.nvim_buf_add_highlight(state.buf, ns, mark[4], mark[1] - 1, mark[2], mark[3]) end
  vim.api.nvim_buf_add_highlight(state.buf, ns, 'Title', 0, 0, -1)
  vim.api.nvim_buf_add_highlight(state.buf, ns, 'Comment', 1, 0, -1)
  vim.api.nvim_buf_add_highlight(state.buf, ns, 'Comment', 2, 0, -1)
  local row = rows[1] and rows[1].row or 1
  for _, entry in ipairs(rows) do if entry.hash == old then row = entry.row; break end end
  if vim.api.nvim_win_is_valid(state.win) and vim.api.nvim_win_get_buf(state.win) == state.buf then
    vim.api.nvim_win_set_cursor(state.win, { row, 0 })
  end
  vim.b[state.buf].gitrism_commit_rows = rows
  vim.b[state.buf].gitrism_has_more = state.more
end
local function load(state)
  state.generation = state.generation + 1; local generation = state.generation
  if state.task then state.task.cancel() end
  vim.b[state.buf].gitrism_loading = true
  local args = { 'log', '--graph', '--topo-order', '--no-show-signature', '--color=never', '--decorate=short', '--date=short',
    '--format=%x1f%H%x1f%h%x1f%an%x1f%ad%x1f%D%x1f%s', '-n' .. (state.limit + 1) }
  -- All refs for the repository; file history follows renames along HEAD.
  if state.file then vim.list_extend(args, { '--follow', 'HEAD' }) else table.insert(args, '--all') end
  if state.filter ~= '' then vim.list_extend(args, { '--fixed-strings', '--regexp-ignore-case', '--grep=' .. state.filter }) end
  table.insert(args, '--'); if state.file then table.insert(args, state.file) end
  state.task = git.run(state.repo, args, function(text, err)
    if not alive(state) or generation ~= state.generation then return end
    vim.b[state.buf].gitrism_loading = false
    if err then
      replace(state.buf, { 'Gitrism', '', err, '', 'r retry · q back' })
      state.by_row, state.rows = {}, {}
      vim.b[state.buf].gitrism_commit_rows = {}
      notify(err); return
    end
    render(state, text)
  end)
end
function M.open(repo, file, opts)
  local previous, win = vim.api.nvim_get_current_buf(), vim.api.nvim_get_current_win()
  local buf = scratch('Gitrism graph', repo)
  local max = math.max(1, math.min(10000, math.floor(tonumber(opts.max_commits) or 5000)))
  local page = math.max(1, math.min(max, math.floor(tonumber(opts.page_size) or 200)))
  local saved = {}; for _, name in ipairs(win_options) do saved[name] = vim.wo[win][name] end
  local state = { buf = buf, win = win, repo = repo, file = file, previous = previous,
    page = page, limit = page, max = max, generation = 0, filter = '', by_row = {}, rows = {} }
  states[buf] = state
  vim.api.nvim_win_set_buf(win, buf); window_options(win)
  vim.bo[buf].filetype = 'gitrism'
  replace(buf, { 'Gitrism  /  ' .. git.clean(vim.fs.basename(repo)), '', 'Loading history…' })
  local function map(key, callback, description) vim.keymap.set('n', key, callback, { buffer = buf, nowait = true, desc = description }) end
  local function show(patch)
    local hash = selected(state)
    if hash then details(repo, hash, patch, state) else notify('Move to a commit row first') end
  end
  map('<CR>', function() show(false) end, 'Inspect commit')
  map('p', function() show(true) end, 'Load commit patch')
  map('r', function() load(state) end, 'Refresh history')
  map('L', function()
    if not state.more then return end
    if state.limit >= max then notify('History limit reached; narrow the subject filter or increase max_commits'); return end
    state.limit = math.min(max, state.limit + page); load(state)
  end, 'Load more commits')
  map('s', function()
    vim.ui.input({ prompt = 'Commit message contains (empty clears): ', default = state.filter }, function(value)
      if value == nil or not alive(state) then return end
      state.filter = value; state.limit = page; load(state)
    end)
  end, 'Filter commit messages')
  for key, direction in pairs({ [']c'] = 1, ['[c'] = -1 }) do
    map(key, function()
      local row = vim.api.nvim_win_get_cursor(win)[1]
      for i = 1, #state.rows do
        local entry = state.rows[direction == 1 and i or (#state.rows - i + 1)]
        if (entry.row - row) * direction > 0 then vim.api.nvim_win_set_cursor(win, { entry.row, 0 }); break end
      end
    end, 'Jump to commit')
  end
  map('y', function()
    local hash = selected(state); if not hash then return end
    vim.fn.setreg('"', hash)
    if vim.fn.has('clipboard') == 1 then pcall(vim.fn.setreg, '+', hash) end
    vim.notify('Copied ' .. hash:sub(1, 12), vim.log.levels.INFO, { title = 'Gitrism' })
  end, 'Copy commit hash')
  map('q', function()
    if state.detail then close_buffer(state.detail) end
    if vim.api.nvim_buf_is_valid(previous) and vim.api.nvim_win_is_valid(win) then vim.api.nvim_win_set_buf(win, previous) end
    close_buffer(buf)
  end, 'Return to editor')
  vim.api.nvim_create_autocmd('BufWipeout', { buffer = buf, once = true, callback = function()
    state.closed = true; states[buf] = nil
    if vim.api.nvim_win_is_valid(win) then
      for name, value in pairs(saved) do vim.wo[win][name] = value end
    end
    if state.task then state.task.cancel() end
    if state.detail then vim.schedule(function() close_buffer(state.detail) end) end
  end })
  load(state)
end
function M.stop()
  for _, state in pairs(states) do
    state.generation = state.generation + 1
    if state.task then state.task.cancel() end
    if alive(state) then vim.b[state.buf].gitrism_loading = false end
  end
end
function M.setup()
  local function highlights()
    vim.api.nvim_set_hl(0, 'GitrismHash', { default = true, link = 'Identifier' })
    vim.api.nvim_set_hl(0, 'GitrismRef', { default = true, link = 'Special' })
    for i, group in ipairs({ 'Function', 'String', 'Special', 'Type', 'Identifier', 'Number' }) do
      vim.api.nvim_set_hl(0, 'GitrismLane' .. i, { default = true, link = group })
    end
  end
  highlights()
  local group = vim.api.nvim_create_augroup('GitrismGraph', { clear = true })
  vim.api.nvim_create_autocmd('ColorScheme', { group = group, callback = highlights })
end
return M
