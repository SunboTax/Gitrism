local M = {}
local options = { inline_blame = true, page_size = 200, max_commits = 5000 }
local native = require('gitrism.git')
local graph = require('gitrism.graph')
local annotation = require('gitrism.inline')
local function notify(message, level) vim.notify(message, level or vim.log.levels.INFO, { title = 'Gitrism' }) end
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
local function valid(ctx)
  return vim.api.nvim_buf_is_valid(ctx.buf) and vim.api.nvim_get_current_buf() == ctx.buf and not vim.bo[ctx.buf].modified
    and vim.api.nvim_buf_get_changedtick(ctx.buf) == ctx.tick
end
local function start(directory, callback)
  native.repo(directory, function(repo, err)
    if err then notify(err, vim.log.levels.ERROR) else callback({ root = repo }) end
  end)
end
local function request(state, method, values, callback)
  native.request(state.root, method, values, callback)
end
local function directory()
  local repo = vim.b.gitrism_repo
  local ctx = source_context()
  return repo or (ctx and vim.fs.dirname(ctx.file)) or vim.fn.getcwd()
end
local function with_context(callback, allow_dirty)
  local ctx = source_context()
  if not ctx then notify('Open a repository file first'); return end
  if not allow_dirty and vim.bo[ctx.buf].modified then notify('Save this file before querying Git attribution'); return end
  start(vim.fs.dirname(ctx.file), function(state)
    if not vim.api.nvim_buf_is_valid(ctx.buf) or vim.api.nvim_get_current_buf() ~= ctx.buf then return end
    local file = relative(ctx.file, state.root)
    if not file then notify('File is outside the repository'); return end
    callback(ctx, state, file)
  end)
end
local function float(title, lines)
  local buf = vim.api.nvim_create_buf(false, true)
  lines = vim.tbl_map(native.clean, lines)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false; vim.bo[buf].bufhidden = 'wipe'
  local width = math.max(1, math.min(100, vim.o.columns - 4))
  local height = math.max(1, math.min(#lines, vim.o.lines - 6))
  local win = vim.api.nvim_open_win(buf, true, { relative = 'editor', style = 'minimal', border = 'rounded', title = ' ' .. title .. ' ', width = width, height = height, row = math.max(0, math.floor((vim.o.lines - height) / 2) - 1), col = math.max(0, math.floor((vim.o.columns - width) / 2)) })
  vim.keymap.set('n', 'q', function() if vim.api.nvim_win_is_valid(win) then vim.api.nvim_win_close(win, true) end end, { buffer = buf, nowait = true })
  return buf
end
function M.open()
  start(directory(), function(state) graph.open(state.root, nil, options) end)
end
function M.web()
  local web = require('gitrism.web'); web.setup(options); web.open(directory())
end
function M.commit(ref)
  start(directory(), function(state) graph.commit(state.root, ref or 'HEAD') end)
end
function M.history()
  with_context(function(_, state, file) graph.open(state.root, file, options) end, true)
end
function M.stop()
  annotation.stop()
  graph.stop()
  native.stop()
  if package.loaded['gitrism.web'] then require('gitrism.web').stop() end
end
function M.blame(silent)
  if silent then annotation.refresh(); return end
  local ctx = source_context()
  if not ctx or vim.bo[ctx.buf].modified then return end
  local line = vim.api.nvim_win_get_cursor(0)[1]
  with_context(function(current, state, file)
    request(state, 'blame', { file = file, start = line, ['end'] = line }, function(lines, err)
      if not valid(current) or vim.api.nvim_win_get_cursor(0)[1] ~= line then return end
      if err then notify(err, vim.log.levels.ERROR); return end
      local entry = lines and lines[1]; if not entry then return end
      local buf = float('Line attribution', { entry.author .. ' <' .. (entry.email or '') .. '>', entry.date, entry.hash, '', entry.summary, '', '<Enter> open commit · q close' })
      vim.keymap.set('n', '<CR>', function()
        if entry.hash:match('^0+$') then notify('This line is uncommitted'); return end
        vim.api.nvim_buf_delete(buf, { force = true })
        graph.commit(state.root, entry.hash)
      end, { buffer = buf })
    end)
  end)
end
function M.toggle_blame() annotation.toggle() end
function M.line_history(first, last)
  with_context(function(ctx, state, file)
    request(state, 'lineHistory', { file = file, start = first, ['end'] = last }, function(text, err)
      if not valid(ctx) then return end
      if err then notify(err, vim.log.levels.ERROR); return end
      local buf = float('Line history', vim.split(text, '\n', { plain = true })); vim.bo[buf].filetype = 'git'
    end)
  end)
end
function M.authors(first, last)
  local cursor = vim.api.nvim_win_get_cursor(0)[1] - 1
  with_context(function(ctx, state, file)
    local function show(start_line, end_line)
      request(state, 'attribution', { file = file, start = start_line, ['end'] = end_line }, function(result, err)
        if not valid(ctx) then return end
        if err then notify(err, vim.log.levels.ERROR); return end
        local lines = { file .. ':' .. start_line .. '-' .. end_line, 'Attribution of current retained lines', '' }
        for _, author in ipairs(result.authors) do table.insert(lines, author.name .. ' <' .. (author.email or '') .. '> · ' .. author.lines .. ' lines') end
        table.insert(lines, ''); table.insert(lines, 'Uncommitted lines: ' .. result.uncommitted)
        float('Code authors', lines)
      end)
    end
    if first then show(first, last); return end
    local finished = false
    local function symbols_ready(results)
      if finished or not valid(ctx) then return end
      finished = true
      local best
      local kinds = { [5] = true, [6] = true, [9] = true, [10] = true, [11] = true, [12] = true, [23] = true }
      local function visit(items)
        for _, symbol in ipairs(items or {}) do
          local range = symbol.range or (symbol.location and symbol.location.range)
          local same = not symbol.location or symbol.location.uri == vim.uri_from_bufnr(ctx.buf)
          if same and range and kinds[symbol.kind] and cursor >= range.start.line and cursor <= range['end'].line then
            if not best or range['end'].line - range.start.line < best['end'].line - best.start.line then best = range end
          end
          visit(symbol.children)
        end
      end
      for _, response in pairs(results) do if response.result then visit(response.result) end end
      local end_line = best and (best['end'].line + (best['end'].character == 0 and best['end'].line > best.start.line and 0 or 1)) or vim.api.nvim_buf_line_count(ctx.buf)
      show(best and best.start.line + 1 or 1, end_line)
    end
    local clients = vim.lsp.get_clients({ bufnr = ctx.buf, method = 'textDocument/documentSymbol' })
    if #clients == 0 then symbols_ready({}); return end
    vim.lsp.buf_request_all(ctx.buf, 'textDocument/documentSymbol', { textDocument = vim.lsp.util.make_text_document_params(ctx.buf) }, symbols_ready)
    vim.defer_fn(function() symbols_ready({}) end, 2000)
  end)
end
function M.setup(opts)
  if vim.fn.has('nvim-0.10') ~= 1 then notify('Neovim 0.10+ is required', vim.log.levels.ERROR); return end
  options = vim.tbl_deep_extend('force', options, opts or {})
  graph.setup()
  annotation.setup(options.inline_blame)
  local command = vim.api.nvim_create_user_command
  command('Gitrism', M.open, {})
  command('GitrismHistory', M.history, {})
  command('GitrismWeb', M.web, {})
  command('GitrismCommit', function(a) M.commit(a.args ~= '' and a.args or 'HEAD') end, { nargs = '?' })
  command('GitrismBlame', function() M.blame(false) end, {})
  command('GitrismToggleBlame', M.toggle_blame, {})
  command('GitrismAuthors', function(a) M.authors(a.range > 0 and a.line1 or nil, a.line2) end, { range = true })
  command('GitrismLineHistory', function(a) M.line_history(a.line1, a.line2) end, { range = true })
  command('GitrismStop', M.stop, {})
  local group = vim.api.nvim_create_augroup('Gitrism', { clear = true })
  vim.api.nvim_create_autocmd('BufWritePost', { group = group, callback = function() if package.loaded['gitrism.web'] then require('gitrism.web').refresh() end end })
  vim.api.nvim_create_autocmd('VimLeavePre', { group = group, callback = M.stop })
end
return M
