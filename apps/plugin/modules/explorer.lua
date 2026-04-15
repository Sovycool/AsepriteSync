-- Explorer module — File Explorer dialog for AsepriteSync.
--
-- Flow:
--   1. Verify auth (show hint if not logged in)
--   2. Load project list asynchronously while the dialog is visible
--   3. When the user switches projects, reload the file list
--   4. "Open in Aseprite" downloads the selected file to dataPath and opens it
--   5. "Refresh" reloads the project list in-place

local Explorer = {}
Explorer.__index = Explorer

-- @param api       Api      instance from modules/api
-- @param auth      Auth     instance from modules/auth
-- @param dataPath  string   writable directory for downloaded files
--                           (pass plugin.dataPath from the plugin entry point)
-- @param sync      Sync|nil instance from modules/sync (optional; enables
--                           auto-lock and file registration after open)
function Explorer.new(api, auth, dataPath, sync)
  return setmetatable({
    _api      = api,
    _auth     = auth,
    _dataPath = dataPath,
    _sync     = sync,  -- may be nil during T16/T17; set after T18 init
  }, Explorer)
end

-- Allow the sync instance to be injected after construction (avoids circular
-- dependency: Explorer is created before Sync in plugin.lua init).
function Explorer:setSync(sync)
  self._sync = sync
end

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

local function fmt_err(err)
  if type(err) == 'table' then
    return err.message or err.code or 'Unknown error'
  end
  return tostring(err)
end

local function safe_join(dir, name)
  -- Prefer Aseprite's path helper; fall back to manual join for robustness
  if app and app.fs and app.fs.joinPath then
    return app.fs.joinPath(dir, name)
  end
  local sep = package.config:sub(1, 1) -- '/' on Unix, '\\' on Windows
  if dir:sub(-1) == '/' or dir:sub(-1) == '\\' then
    return dir .. name
  end
  return dir .. sep .. name
end

-- Build the display label shown in the file listbox.
local function file_label(f)
  local label = f.name
  if f.lockedBy then
    label = label .. '  \xF0\x9F\x94\x92'  -- UTF-8 lock emoji (🔒)
  end
  return label
end

-- ---------------------------------------------------------------------------
-- Explorer:open()
-- ---------------------------------------------------------------------------

function Explorer:open()
  -- Auth guard
  if not self._auth:isLoggedIn() then
    local dlg = Dialog('AsepriteSync')
    dlg:label{ label = 'You are not logged in.' }
    dlg:label{ label = 'Run "AsepriteSync: Login / Connect" first.' }
    dlg:separator()
    dlg:button{ id = 'ok', text = 'OK', focus = true }
    dlg:show{ wait = true }
    return
  end

  -- Mutable state
  local state = { projects = {}, files = {}, projectIdx = 1, fileIdx = 1 }

  -- Fetch helpers — work with both synchronous (curl fallback) and
  -- asynchronous (app.http) transports because callbacks are invoked
  -- inline for sync and from the event-loop for async.  We call these
  -- before dlg:show so that data is ready when the dialog first paints.

  local function fetchFiles(projectIdx)
    local project = state.projects[projectIdx]
    if not project then return end
    state.files = {}
    self._api:get('/projects/' .. project.id .. '/files', function(data, err)
      if not err then state.files = data or {} end
    end)
  end

  local fetchProjectsErr = nil
  self._api:get('/projects', function(data, err)
    if err then
      fetchProjectsErr = err
      return
    end
    state.projects = data or {}
  end)

  if fetchProjectsErr then
    local dlg = Dialog('AsepriteSync — Error')
    dlg:label{ label = 'Could not load projects:' }
    dlg:label{ label = fmt_err(fetchProjectsErr) }
    dlg:button{ id = 'ok', text = 'OK', focus = true }
    dlg:show{ wait = true }
    return
  end

  if #state.projects == 0 then
    local dlg = Dialog('AsepriteSync')
    dlg:label{ label = 'You have no projects.' }
    dlg:label{ label = 'Create one on the web dashboard first.' }
    dlg:button{ id = 'ok', text = 'OK', focus = true }
    dlg:show{ wait = true }
    return
  end

  -- Pre-fetch files for the first project
  fetchFiles(1)

  -- ------------------------------------------------------------------
  -- Build project name list
  -- ------------------------------------------------------------------

  local projectNames = {}
  for _, p in ipairs(state.projects) do
    projectNames[#projectNames + 1] = p.name .. '  [' .. (p.role or '?') .. ']'
  end

  local function fileItems()
    local options = {}
    for _, f in ipairs(state.files) do
      options[#options + 1] = file_label(f)
    end
    return options
  end

  local function statusText()
    local proj = state.projects[state.projectIdx]
    if #state.files == 0 then
      return 'No files in ' .. (proj and proj.name or '?')
    end
    return tostring(#state.files) .. ' file(s) — ' .. (proj and proj.name or '?')
  end

  -- ------------------------------------------------------------------
  -- Build the dialog (data is already available from the pre-fetch)
  -- ------------------------------------------------------------------

  local dlg = Dialog{ title = 'AsepriteSync — File Explorer' }

  dlg:combobox{
    id       = 'project',
    label    = 'Project:',
    options  = projectNames,
    onchange = function()
      state.projectIdx = dlg.data.project
      fetchFiles(state.projectIdx)
      local options = fileItems()
      dlg:modify{ id = 'files',  options   = options }
      dlg:modify{ id = 'open',   enabled = #options > 0 }
      dlg:modify{ id = 'status', text    = statusText() }
      dlg:modify{ id = 'info',   text    = '' }
    end,
  }

  dlg:button{
    id      = 'refresh',
    text    = 'Refresh',
    onclick = function()
      fetchFiles(state.projectIdx)
      local options = fileItems()
      dlg:modify{ id = 'files',  options   = options }
      dlg:modify{ id = 'open',   enabled = #options > 0 }
      dlg:modify{ id = 'status', text    = statusText() }
    end,
  }

  dlg:separator()

  local initItems = fileItems()
  dlg:combobox{
    id       = 'files',
    options  = initItems,
    onchange = function()
      -- dlg.data.files may be an integer index or the selected string
      local val = dlg.data.files
      local idx = type(val) == 'number' and val or nil
      if not idx then
        for i, label in ipairs(fileItems()) do
          if label == val then idx = i; break end
        end
      end
      state.fileIdx = idx or 1
      local f = state.files[state.fileIdx]
      if f then
        local info = ''
        if f.lockedBy then info = info .. 'Locked  •  ' end
        if f.updatedAt then info = info .. f.updatedAt:sub(1, 10) end
        dlg:modify{ id = 'info', text = info }
      else
        dlg:modify{ id = 'info', text = '' }
      end
    end,
  }

  dlg:label{ id = 'info',   label = '' }
  dlg:separator()
  dlg:label{ id = 'status', label = statusText() }
  dlg:separator()

  dlg:button{ id = 'open',   text = 'Open in Aseprite', focus = true,  enabled = #initItems > 0 }
  dlg:button{ id = 'cancel', text = 'Cancel',            focus = false }

  dlg:show{ wait = true }

  -- ------------------------------------------------------------------
  -- Handle result after dialog closes
  -- ------------------------------------------------------------------

  if not dlg.data.open then return end

  -- dlg.data.files may be an integer or the selected string after dialog close
  local val = dlg.data.files
  if type(val) == 'number' then
    state.fileIdx = val
  elseif type(val) == 'string' and val ~= '' then
    for i, label in ipairs(fileItems()) do
      if label == val then state.fileIdx = i; break end
    end
  end

  local file = state.files[state.fileIdx]
  if not file then return end

  self:_downloadAndOpen(file)
end

-- ---------------------------------------------------------------------------
-- Download a file and open it in Aseprite
-- ---------------------------------------------------------------------------

function Explorer:_downloadAndOpen(file)
  -- Show non-blocking progress dialog
  local progress = Dialog{ title = 'AsepriteSync' }
  progress:label{ id = 'msg', label = 'Downloading ' .. file.name .. '…' }
  progress:show{ wait = false }

  self._api:downloadBinary('/files/' .. file.id, function(bytes, err)
    progress:close()

    if err then
      local dlg = Dialog('AsepriteSync — Download failed')
      dlg:label{ label = fmt_err(err) }
      dlg:button{ id = 'ok', text = 'OK', focus = true }
      dlg:show{ wait = true }
      return
    end

    if not bytes or #bytes == 0 then
      local dlg = Dialog('AsepriteSync')
      dlg:label{ label = 'Received empty file.' }
      dlg:button{ id = 'ok', text = 'OK', focus = true }
      dlg:show{ wait = true }
      return
    end

    -- Write to the plugin's data directory (writable, persists across sessions)
    local destPath = safe_join(self._dataPath, file.name)
    local f, openErr = io.open(destPath, 'wb')
    if not f then
      local dlg = Dialog('AsepriteSync — Write error')
      dlg:label{ label = 'Cannot write to ' .. destPath }
      dlg:label{ label = tostring(openErr) }
      dlg:button{ id = 'ok', text = 'OK', focus = true }
      dlg:show{ wait = true }
      return
    end
    f:write(bytes)
    f:close()

    -- Register the file with Sync before opening so the path is known
    if self._sync then
      self._sync:registerOpen(destPath, file.id, file.projectId)
    end

    -- Open the file in Aseprite
    app.open(destPath)

    -- Offer auto-lock (only when Sync is available and file is not already locked)
    if self._sync and not file.lockedBy then
      local lockDlg = Dialog('AsepriteSync — Lock for editing?')
      lockDlg:label{ label = file.name .. ' is now open.' }
      lockDlg:label{ label = 'Lock it so teammates know you are editing?' }
      lockDlg:separator()
      lockDlg:button{ id = 'yes', text = 'Lock',      focus = true  }
      lockDlg:button{ id = 'no',  text = 'Skip',      focus = false }
      lockDlg:show{ wait = true }

      if lockDlg.data.yes then
        self._sync:lock(file.id, function(ok, lockErr)
          if not ok then
            local eDlg = Dialog('AsepriteSync')
            eDlg:label{ label = 'Lock failed: ' .. fmt_err(lockErr) }
            eDlg:button{ id = 'ok', text = 'OK', focus = true }
            eDlg:show{ wait = true }
          end
          -- Success is silent — the lock dot shows in the web UI
        end)
      end
    elseif file.lockedBy then
      -- File is locked by someone else — warn the user
      local warnDlg = Dialog('AsepriteSync — File is locked')
      warnDlg:label{ label = file.name .. ' is currently locked by another user.' }
      warnDlg:label{ label = 'You can view it, but uploading changes may be rejected.' }
      warnDlg:button{ id = 'ok', text = 'OK', focus = true }
      warnDlg:show{ wait = true }
    end
  end)
end

return Explorer
