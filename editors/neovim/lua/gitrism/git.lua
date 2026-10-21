-- Native reads use argv directly: no shell, server, Node.js, or browser.
local M = {}
local jobs = {}
function M.clean(value) return (value:gsub('[%z\1-\31\127]', ' ')) end
function M.run(repo, args, callback)
  local task = { cancelled = false }
  local output, size, overflow = {}, 0, false
  local command = { 'git', '--no-pager', '--literal-pathspecs', '-c', 'color.ui=false', '-C', repo }
  vim.list_extend(command, args)
  local ok, process = pcall(vim.system, command, {
    text = true, timeout = 15000, env = { GIT_OPTIONAL_LOCKS = '0' },
    stdout = function(_, data)
      if not data or overflow then return end
      size = size + #data
      if size > 4 * 1024 * 1024 then
        overflow = true
        if task.process then task.process:kill(15) end
      else table.insert(output, data) end
    end,
  }, function(result)
    vim.schedule(function()
      jobs[task] = nil
      if task.cancelled then return end
      local err
      if overflow then err = 'Git output exceeds 4 MiB; narrow the query or inspect this patch with Git'
      elseif result.code == 124 then err = 'Git query timed out (15 seconds)'
      elseif result.code ~= 0 then err = vim.trim(M.clean(result.stderr or 'Git query failed')) end
      if err then callback(nil, err) else callback(table.concat(output)) end
    end)
  end)
  function task.cancel()
    task.cancelled = true; jobs[task] = nil
    if task.process then pcall(task.process.kill, task.process, 15) end
  end
  if ok then task.process = process; jobs[task] = true
  else vim.schedule(function() if not task.cancelled then callback(nil, tostring(process)) end end) end
  return task
end
function M.stop()
  local pending = {}; for task in pairs(jobs) do table.insert(pending, task) end
  for _, task in ipairs(pending) do task.cancel() end
end
function M.repo(directory, callback)
  return M.run(directory, { 'rev-parse', '--show-toplevel' }, function(text, err)
    callback(text and vim.fs.normalize((text:gsub('\n$', ''))), err)
  end)
end
function M.resolve(repo, ref, callback)
  return M.run(repo, { 'rev-parse', '--verify', '--end-of-options', ref .. '^{commit}' }, function(text, err)
    local hash = text and vim.trim(text)
    if hash and not hash:match('^[0-9a-f]+$') then hash, err = nil, 'Invalid commit object' end
    callback(hash, err)
  end)
end
local function blame(text)
  local entries, current = {}, nil
  for line in text:gmatch('[^\n]+') do
    local hash = line:match('^([0-9a-f]+) %d+ %d+')
    if hash then current = { hash = hash, author = 'Unknown', date = '', summary = '' }; table.insert(entries, current)
    elseif current then
      if line:sub(1, 7) == 'author ' then current.author = M.clean(line:sub(8))
      elseif line:sub(1, 12) == 'author-mail ' then current.email = M.clean(line:sub(13):gsub('^<', ''):gsub('>$', ''))
      elseif line:sub(1, 12) == 'author-time ' then current.date = os.date('!%Y-%m-%dT%H:%M:%SZ', tonumber(line:sub(13)) or 0)
      elseif line:sub(1, 8) == 'summary ' then current.summary = M.clean(line:sub(9)) end
    end
  end
  return entries
end
function M.request(repo, method, values, callback)
  local first, last = values.start, values['end']
  if type(first) ~= 'number' or type(last) ~= 'number' or first % 1 ~= 0 or last % 1 ~= 0
    or first < 1 or last < first or last - first >= 5000 then
    callback(nil, 'Select a valid range of at most 5,000 lines'); return
  end
  local args = method == 'lineHistory'
    and { 'log', '--no-show-signature', '--no-ext-diff', '--no-textconv', '-n50', '--format=medium', '-L', first .. ',' .. last .. ':' .. values.file }
    or { 'blame', '--line-porcelain', '-L', first .. ',' .. last, '--', values.file }
  return M.run(repo, args, function(text, err)
    if err then callback(nil, err); return end
    if method == 'lineHistory' then callback(text); return end
    local entries = blame(text)
    if method == 'blame' then callback(entries); return end
    local groups, authors, uncommitted = {}, {}, 0
    for _, entry in ipairs(entries) do
      if entry.hash:match('^0+$') then uncommitted = uncommitted + 1
      else
        local identity = (entry.email or entry.author):lower()
        if not groups[identity] then
          groups[identity] = { name = entry.author, email = entry.email, lines = 0 }
          table.insert(authors, groups[identity])
        end
        groups[identity].lines = groups[identity].lines + 1
      end
    end
    table.sort(authors, function(a, b) if a.lines == b.lines then return a.name < b.name end; return a.lines > b.lines end)
    callback({ authors = authors, uncommitted = uncommitted })
  end)
end
return M
