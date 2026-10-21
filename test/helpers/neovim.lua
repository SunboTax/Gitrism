local function test()
  vim.opt.runtimepath:append(vim.env.GITRISM_PLUGIN_DIR)
  local opened, notifications = {}, {}
  vim.notify = function(message) table.insert(notifications, message) end
  local g = require('gitrism')
  local calls, system = {}, vim.system
  vim.system = function(argv, ...) table.insert(calls, argv); return system(argv, ...) end
  g.setup({ page_size = 2, open_url = function(url) table.insert(opened, url) end, locale = 'zh-CN' })
  vim.cmd('edit ' .. vim.fn.fnameescape(vim.env.GITRISM_TEST_FILE))
  local original = vim.api.nvim_get_current_win()
  local function wait(predicate, message) assert(vim.wait(8000, predicate, 20), message .. ': ' .. vim.inspect(notifications)) end
  vim.wo.number = true; vim.wo.wrap = true
  local original_buf = vim.api.nvim_get_current_buf()
  local function key(value)
    vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(value, true, false, true), 'xt', false)
  end
  local function loaded()
    return vim.b.gitrism_commit_rows and not vim.b.gitrism_loading
  end
  vim.cmd('Gitrism')
  wait(loaded, 'native graph')
  local graph_buf = vim.api.nvim_get_current_buf()
  assert(vim.bo.filetype == 'gitrism' and #vim.b.gitrism_commit_rows == 2)
  assert(vim.b.gitrism_has_more)
  local text = table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), '\n')
  assert(text:find('|\\'), text) -- A real merge connector.
  local selected = vim.b.gitrism_commit_rows[1].hash
  key('L'); wait(function() return loaded() and #vim.b.gitrism_commit_rows == 4 end, 'page 2')
  assert(vim.b.gitrism_commit_rows[1].hash == selected)
  key(']c'); local merge_row = vim.api.nvim_win_get_cursor(0)[1]
  assert(vim.b.gitrism_commit_rows[2].row == merge_row)
  key('y'); assert(vim.fn.getreg('"') == vim.b.gitrism_commit_rows[2].hash)
  key('<CR>')
  wait(function() return vim.b.gitrism_commit ~= nil end, 'on-demand commit summary')
  assert(vim.bo.filetype == 'git' and not vim.b.gitrism_patch)
  key('p'); wait(function() return vim.b.gitrism_patch == true end, 'on-demand patch')
  key('q'); assert(vim.api.nvim_get_current_buf() == graph_buf)
  local input = vim.ui.input
  vim.ui.input = function(_, callback) callback('Write note') end
  key('s'); wait(function() return loaded() and #vim.b.gitrism_commit_rows == 2 end, 'subject filter')
  text = table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), '\n')
  assert(text:find('Write note') and not text:find('Merge feature'))
  vim.ui.input = function(_, callback) callback('no such commit subject') end
  key('s'); wait(function() return loaded() and #vim.b.gitrism_commit_rows == 0 end, 'empty filter')
  assert(table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), '\n'):find('No commits found'))
  vim.ui.input = input
  key('q'); assert(vim.api.nvim_get_current_buf() == original_buf)
  assert(not vim.api.nvim_buf_is_valid(graph_buf))
  assert(vim.wo.number and vim.wo.wrap, 'Restore source window options')
  assert(#opened == 0 and package.loaded['gitrism.web'] == nil)
  for _, argv in ipairs(calls) do assert(argv[1] == 'git', 'Native commands must only start Git') end
  local function float_lines()
    if vim.api.nvim_get_current_win() == original then return nil end
    return table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), '\n')
  end
  vim.cmd('GitrismBlame')
  wait(function() return float_lines() ~= nil end, 'blame float')
  assert(float_lines():find('Local Tester', 1, true), float_lines())
  key('<CR>')
  wait(function() return vim.b.gitrism_commit ~= nil end, 'blame to native commit')
  key('q')
  vim.cmd('GitrismAuthors')
  wait(function() return float_lines() ~= nil end, 'authors without LSP')
  assert(float_lines():find('current retained lines', 1, true), float_lines())
  assert(float_lines():find('Local Tester', 1, true), float_lines())
  vim.api.nvim_win_close(0, true)
  vim.cmd('1,2GitrismAuthors')
  wait(function() return float_lines() ~= nil end, 'range attribution')
  assert(float_lines():find(':1%-2'))
  vim.api.nvim_win_close(0, true)
  local get_clients, request_all = vim.lsp.get_clients, vim.lsp.buf_request_all
  vim.lsp.get_clients = function() return { {} } end
  vim.lsp.buf_request_all = function(_, _, _, callback)
    callback({ [1] = { result = { { kind = 12, range = { start = { line = 0, character = 0 }, ["end"] = { line = 2, character = 3 } }, children = {
      { kind = 6, range = { start = { line = 1, character = 0 }, ["end"] = { line = 1, character = 16 } } },
    } } } } })
  end
  vim.api.nvim_win_set_cursor(0, { 2, 0 })
  vim.cmd('GitrismAuthors')
  wait(function() return float_lines() ~= nil end, 'nested symbol attribution')
  assert(float_lines():find(':2%-2'), float_lines())
  vim.api.nvim_win_close(0, true)
  vim.lsp.get_clients, vim.lsp.buf_request_all = get_clients, request_all
  vim.cmd('GitrismHistory')
  wait(loaded, 'file history')
  assert(#vim.b.gitrism_commit_rows == 2)
  key('L'); wait(function() return loaded() and #vim.b.gitrism_commit_rows == 3 end, 'rename history page 2')
  text = table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), '\n')
  assert(text:find('Initial local workspace', 1, true), 'History must follow the rename')
  key('q')
  local columns = vim.o.columns; vim.o.columns = 80
  vim.cmd('GitrismCommit HEAD')
  wait(function() return vim.b.gitrism_commit ~= nil end, 'commit navigation')
  assert(vim.api.nvim_win_get_width(0) == 80, 'Use a horizontal split in narrow terminals')
  key('p'); wait(function() return vim.b.gitrism_patch end, 'HEAD patch')
  assert(table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), '\n'):find('diff %-%-git'))
  key('q'); vim.o.columns = columns
  vim.cmd('1,2GitrismLineHistory')
  wait(function() return float_lines() ~= nil end, 'line history')
  assert(float_lines():find('Initial local workspace', 1, true), float_lines())
  vim.api.nvim_win_close(0, true)
  local ns = vim.api.nvim_get_namespaces().gitrism
  local function marks() return vim.api.nvim_buf_get_extmarks(original_buf, ns, 0, -1, { details = true }) end
  local function move(line)
    vim.api.nvim_win_set_cursor(0, { line, 0 })
    vim.api.nvim_exec_autocmds('CursorMoved', { buffer = 0 })
  end
  move(1)
  wait(function() return #marks() == 1 end, 'default current-line blame')
  assert(marks()[1][2] == 0 and marks()[1][4].virt_text[1][1]:find('Local Tester'))
  move(2)
  assert(#marks() == 0, 'Clear the previous line immediately')
  wait(function() return #marks() == 1 end, 'second line in the same function')
  assert(marks()[1][2] == 1 and marks()[1][4].virt_text[1][1]:find('Line Reviewer'))
  assert(marks()[1][4].virt_text[1][1]:find('Refine the greeting'))
  assert(not marks()[1][4].virt_text[1][1]:find('Initial local workspace'))
  local reads = #calls
  vim.api.nvim_win_set_cursor(0, { 2, 3 })
  vim.api.nvim_exec_autocmds('CursorMoved', { buffer = 0 })
  vim.wait(230)
  assert(#calls == reads and #marks() == 1, 'Horizontal movement keeps the same annotation without querying Git')
  -- Deliver an obsolete response after moving to another line, even if cancellation is ignored.
  local native, queued = require('gitrism.git'), {}
  local request = native.request
  native.request = function(_, _, values, callback)
    table.insert(queued, { line = values.start, callback = callback })
    return { cancel = function() end }
  end
  move(1); wait(function() return #queued == 1 end, 'first delayed blame')
  move(2); wait(function() return #queued == 2 end, 'second delayed blame')
  local fake = { { author = 'Stale Author', hash = string.rep('a',40), date = '2026-10-01', summary = 'Stale commit' } }
  queued[1].callback(fake); assert(#marks() == 0, 'Discard obsolete attribution')
  native.request = request
  require('gitrism.inline').refresh(true)
  wait(function() return #marks() == 1 end, 'restore real blame')
  assert(marks()[1][4].virt_text[1][1]:find('Line Reviewer'))
  vim.cmd('GitrismToggleBlame'); assert(#marks() == 0)
  move(1); vim.wait(230); assert(#marks() == 0, 'Toggle off keeps annotations hidden')
  vim.cmd('GitrismToggleBlame')
  wait(function() return #marks() == 1 end, 'toggle on')
  vim.api.nvim_buf_set_lines(0, 0, 1, false, { 'unsaved content' })
  vim.api.nvim_exec_autocmds('TextChanged', { buffer = 0 })
  assert(#vim.api.nvim_buf_get_extmarks(0, ns, 0, -1, {}) == 0)
  vim.cmd('GitrismAuthors')
  assert(notifications[#notifications]:find('Save this file', 1, true))
  local errors = vim.v.errmsg
  assert(errors == '', errors)
  vim.cmd('edit! ' .. vim.fn.fnameescape(vim.env.GITRISM_EMPTY_REPO .. '/new.lua'))
  vim.cmd('Gitrism')
  wait(loaded, 'unborn repository')
  assert(#vim.b.gitrism_commit_rows == 0)
  key('r'); key('q') -- Closing a pending refresh must not write into a wiped buffer.
  vim.wait(100)
  -- Cancellation suppresses stale callbacks.
  local callback = false
  local task = require('gitrism.git').run(vim.env.GITRISM_EMPTY_REPO, { 'status' }, function() callback = true end)
  task.cancel(); vim.wait(100); assert(not callback)
  assert(#opened == 0 and package.loaded['gitrism.web'] == nil)
  for _, argv in ipairs(calls) do assert(argv[1] == 'git', 'Native reads must not spawn Node') end
  vim.cmd('GitrismWeb')
  wait(function() return #opened == 1 end, 'explicit browser workspace')
  assert(opened[1]:match('^http://127%.0%.0%.1:%d+/#token='))
  vim.cmd('GitrismStop')
  local url = opened[1]:match('^[^#]+')
  wait(function()
    local result = vim.system({ 'node', '-e', 'fetch(process.argv[1]).then(()=>process.exit(1),()=>process.exit(0))', url }):wait(2000)
    return result.code == 0
  end, 'server exits on editor stop')
  print('GITRISM_NEOVIM_OK')
end
local ok, err = xpcall(test, debug.traceback)
if not ok then io.stderr:write(err .. '\n'); vim.cmd('cquit 1') else vim.cmd('qa!') end
