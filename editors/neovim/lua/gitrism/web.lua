local M = {}
local source = debug.getinfo(1, 'S').source:sub(2)
local root = vim.fn.fnamemodify(source, ':p:h:h:h:h:h')
local options = { command = { 'node', root .. '/bin/gitrism.cjs' }, locale = 'en', theme = 'auto', inline_blame = false }
local instances, serial = {}, 0
local last_file
local function notify(message, level) vim.notify(message, level or vim.log.levels.INFO, { title = 'Gitrism' }) end
local function emit(job, value) vim.fn.chansend(job, vim.json.encode(value) .. '\n') end
local function open_url(url)
  if options.open_url then options.open_url(url); return end
  local _, err = vim.ui.open(url)
  if err then notify('Open this URL in your browser: ' .. url) end
end
local function source_context(buf)
  buf = buf or vim.api.nvim_get_current_buf()
  local file = vim.api.nvim_buf_get_name(buf)
  if vim.bo[buf].buftype ~= '' or file == '' then return nil end
  return { buf = buf, file = file, tick = vim.api.nvim_buf_get_changedtick(buf) }
end
local function relative(file, repo)
  local normalized = vim.fs.normalize(file)
  if normalized:sub(1, #repo + 1) ~= repo .. '/' then return nil end
  return normalized:sub(#repo + 2)
end
local function request(state, method, values, callback)
  serial = serial + 1
  local id = serial
  values = vim.tbl_extend('force', values or {}, { id = id, method = method })
  state.pending[id] = callback or function(_, err) if err then notify(err, vim.log.levels.ERROR) end end
  emit(state.job, values)
  vim.defer_fn(function()
    local pending = state.pending[id]
    if pending then state.pending[id] = nil; pending(nil, 'Editor request timed out') end
  end, 65000)
end
local start
local function receive(state, message)
  if message.type == 'ready' then
    state.url, state.root = message.url, message.root
    for _, callback in ipairs(state.waiters) do callback(state) end
    state.waiters = {}
  elseif message.type == 'response' then
    local callback = state.pending[message.id]
    state.pending[message.id] = nil
    if callback then callback(message.result, message.error) end
  elseif message.type == 'openFile' then
    local ok, err = pcall(vim.cmd, 'edit ' .. vim.fn.fnameescape(message.path))
    if ok then
      local line = math.min(message.line or 1, vim.api.nvim_buf_line_count(0))
      vim.api.nvim_win_set_cursor(0, { math.max(1, line), 0 })
    else notify(tostring(err), vim.log.levels.WARN) end
  elseif message.type == 'openWorktree' then
    start(message.path, function(other) open_url(other.url) end)
  elseif message.type == 'activeHistory' then
    local ctx = source_context() or last_file
    local file = ctx and relative(ctx.file, state.root)
    if file then request(state, 'timeline', { file = file }) else notify('Select a file in this repository first') end
  elseif message.type == 'focusEditor' then
    notify('Continue in Neovim')
  elseif message.type == 'protocolError' then notify(message.error, vim.log.levels.ERROR) end
end
start = function(directory, callback)
  vim.system({ 'git', '-C', directory, 'rev-parse', '--show-toplevel' }, { text = true }, function(result)
    vim.schedule(function()
      if result.code ~= 0 then notify(vim.trim(result.stderr or 'Not a Git repository'), vim.log.levels.ERROR); return end
      local repo = vim.fs.normalize(vim.trim(result.stdout))
      local existing = instances[repo]
      if existing then
        if existing.url then callback(existing) else table.insert(existing.waiters, callback) end
        return
      end
      local state = { root = repo, pending = {}, waiters = { callback }, buffer = '', stderr = '' }
      instances[repo] = state
      local command = vim.list_extend(vim.deepcopy(options.command), { 'serve', '--repo', repo, '--stdio', '--locale', options.locale, '--theme', options.theme })
      state.job = vim.fn.jobstart(command, {
        cwd = repo,
        on_stdout = function(_, data)
          state.buffer = state.buffer .. table.concat(data, '\n')
          while true do
            local pos = state.buffer:find('\n', 1, true)
            if not pos then break end
            local line = state.buffer:sub(1, pos - 1); state.buffer = state.buffer:sub(pos + 1)
            if line ~= '' then
              local ok, message = pcall(vim.json.decode, line)
              if ok then receive(state, message) else notify('Invalid server response', vim.log.levels.ERROR) end
            end
          end
        end,
        on_stderr = function(_, data) state.stderr = (state.stderr .. table.concat(data, '\n')):sub(-4000) end,
        on_exit = function(_, code)
          if instances[repo] == state then instances[repo] = nil end
          for _, cb in pairs(state.pending) do cb(nil, 'Local workspace stopped') end
          if code ~= 0 then notify('Local workspace stopped: ' .. state.stderr, vim.log.levels.ERROR) end
        end,
      })
      if state.job <= 0 then instances[repo] = nil; notify('Cannot start Node.js; check Gitrism command/build', vim.log.levels.ERROR) end
    end)
  end)
end
function M.setup(opts)
  options = vim.tbl_deep_extend('force', options, opts or {})
  last_file = source_context() or last_file
  local group = vim.api.nvim_create_augroup('GitrismWeb', { clear = true })
  vim.api.nvim_create_autocmd('BufEnter', { group = group, callback = function()
    local ctx = source_context(); if ctx then last_file = ctx end
  end })
end
function M.open(directory) start(directory, function(state) open_url(state.url) end) end
function M.refresh()
  for _, state in pairs(instances) do if state.url then request(state, 'refresh') end end
end
function M.stop()
  for _, state in pairs(instances) do if state.job and state.job > 0 then pcall(vim.fn.chanclose, state.job, 'stdin') end end
end
return M
