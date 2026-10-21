-- Cursor-line annotations are independent of LSP symbols and function ranges.
local M = {}
local git = require('gitrism.git')
local ns = vim.api.nvim_create_namespace('gitrism')
local enabled, generation, timer, task, target = false, 0, nil, nil, nil
local function clear()
  local previous = target
  generation = generation + 1; target = nil
  if timer then timer:stop() end
  if task then task.cancel(); task = nil end
  if previous and vim.api.nvim_buf_is_valid(previous.buf) then
    vim.api.nvim_buf_clear_namespace(previous.buf, ns, 0, -1)
  end
end
local function context()
  local buf = vim.api.nvim_get_current_buf()
  if not enabled or vim.bo[buf].buftype ~= '' or vim.bo[buf].modified or vim.fn.mode():match('^[iR]') then return nil end
  local file = vim.api.nvim_buf_get_name(buf)
  if file == '' then return nil end
  return { buf = buf, file = file, line = vim.api.nvim_win_get_cursor(0)[1], tick = vim.api.nvim_buf_get_changedtick(buf) }
end
local function same(a, b)
  return a and b and a.buf == b.buf and a.line == b.line and a.tick == b.tick and a.file == b.file
end
local function draw(ctx, entry)
  local label = entry.hash:match('^0+$') and 'Uncommitted changes'
    or (entry.author .. ' · ' .. entry.date:sub(1, 10) .. ' · ' .. entry.hash:sub(1, 8) .. ' · ' .. entry.summary)
  vim.api.nvim_buf_set_extmark(ctx.buf, ns, ctx.line - 1, 0, {
    virt_text = { { git.clean(label), 'Comment' } }, virt_text_pos = 'eol',
  })
end
function M.refresh(force)
  local ctx = context()
  if not force and same(ctx, target) then return end -- Horizontal motion needs no new query.
  clear()
  if not ctx then return end
  target = ctx
  local current = generation
  if not timer then timer = vim.uv.new_timer() end
  timer:start(180, 0, vim.schedule_wrap(function()
    if current ~= generation or not same(ctx, context()) then return end
    task = git.repo(vim.fs.dirname(ctx.file), function(repo, err)
      if current ~= generation or not same(ctx, context()) then return end
      if err then target = nil; return end
      local file = vim.fs.normalize(ctx.file)
      if file:sub(1, #repo + 1) ~= repo .. '/' then target = nil; return end
      task = git.request(repo, 'blame', { file = file:sub(#repo + 2), start = ctx.line, ['end'] = ctx.line }, function(entries)
        if current ~= generation or not same(ctx, context()) then return end
        task = nil
        if entries and entries[1] then draw(ctx, entries[1]) else target = nil end
      end)
    end)
  end))
end
function M.toggle()
  enabled = not enabled; clear()
  if enabled then M.refresh() end
end
function M.stop()
  clear()
  if timer then timer:close(); timer = nil end
end
function M.setup(active)
  M.stop(); enabled = active
  local group = vim.api.nvim_create_augroup('GitrismInline', { clear = true })
  vim.api.nvim_create_autocmd({ 'CursorMoved', 'CursorHold', 'BufEnter', 'InsertLeave' }, {
    group = group, callback = function() M.refresh() end,
  })
  vim.api.nvim_create_autocmd({ 'TextChanged', 'TextChangedI', 'BufLeave', 'InsertEnter' }, { group = group, callback = clear })
  vim.api.nvim_create_autocmd({ 'BufWritePost', 'FocusGained', 'FileChangedShellPost' }, {
    group = group, callback = function() M.refresh(true) end,
  })
  M.refresh()
end
return M
