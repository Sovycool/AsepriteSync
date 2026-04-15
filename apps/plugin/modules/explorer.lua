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

  -- Shared mutable state (modified by async callbacks and button handlers)
  local state = {
    projects   = {},  -- array of project objects from the server
    files      = {},  -- array of file objects for the selected project
    dlg        = nil, -- set once Dialog is constructed (before :show)
  }

  -- Forward declarations
  local loadProjects, loadFiles

  -- ------------------------------------------------------------------
  -- Load helpers
  -- ------------------------------------------------------------------

  loadFiles = function(projectIdx)
    local project = state.projects[projectIdx]
    if not project then return end

    state.files = {}
    state.dlg:modify{ id = 'files',   items   = { '(loading…)' } }
    state.dlg:modify{ id = 'status',  text    = 'Loading files for ' .. project.name .. '…' }
    state.dlg:modify{ id = 'open',    enabled = false }
    state.dlg:modify{ id = 'info',    text    = '' }

    self._api:get('/projects/' .. project.id .. '/files', function(data, err)
      if err then
        state.dlg:modify{ id = 'status', text = 'Error: ' .. fmt_err(err) }
        state.dlg:modify{ id = 'files',  items = {} }
        return
      end

      state.files = data or {}

      if #state.files == 0 then
        state.dlg:modify{ id = 'files',  items   = {} }
        state.dlg:modify{ id = 'status', text    = 'No files in this project yet.' }
        return
      end

      local items = {}
      for _, f in ipairs(state.files) do
        items[#items + 1] = file_label(f)
      end

      state.dlg:modify{ id = 'files',   items   = items }
      state.dlg:modify{ id = 'status',  text    = tostring(#state.files) .. ' file(s) — ' .. project.name }
      state.dlg:modify{ id = 'open',    enabled = true }
    end)
  end

  loadProjects = function()
    state.projects = {}
    state.files    = {}
    state.dlg:modify{ id = 'project', options = { '(loading…)' } }
    state.dlg:modify{ id = 'files',   items   = {} }
    state.dlg:modify{ id = 'status',  text    = 'Fetching projects…' }
    state.dlg:modify{ id = 'open',    enabled = false }

    self._api:get('/projects', function(data, err)
      if err then
        state.dlg:modify{ id = 'project', options = { '(error)' } }
        state.dlg:modify{ id = 'status',  text    = 'Error: ' .. fmt_err(err) }
        return
      end

      state.projects = data or {}

      if #state.projects == 0 then
        state.dlg:modify{ id = 'project', options = { '(no projects)' } }
        state.dlg:modify{ id = 'status',  text    = 'You have no projects. Create one on the web.' }
        return
      end

      local names = {}
      for _, p in ipairs(state.projects) do
        names[#names + 1] = p.name .. '  [' .. (p.role or '?') .. ']'
      end

      state.dlg:modify{ id = 'project', options = names }
      -- Automatically load files for the first project
      loadFiles(1)
    end)
  end

  -- ------------------------------------------------------------------
  -- Build the dialog
  -- ------------------------------------------------------------------

  local dlg = Dialog{ title = 'AsepriteSync — File Explorer' }
  state.dlg = dlg

  -- Project selector (populated asynchronously)
  dlg:combobox{
    id       = 'project',
    label    = 'Project:',
    options  = { '(loading…)' },
    onchange = function()
      -- dlg.data.project is the 1-based selected index
      loadFiles(dlg.data.project)
    end,
  }

  -- Refresh button sits on the same logical row as the combobox
  dlg:button{
    id      = 'refresh',
    text    = 'Refresh',
    onclick = function() loadProjects() end,
  }

  dlg:separator()

  -- File list (populated after project selection)
  dlg:listbox{
    id       = 'files',
    items    = {},
    onchange = function()
      -- Update info label when a file is selected
      local idx = dlg.data.files
      local f = state.files[idx]
      if f then
        local info = 'v' .. tostring(f.currentVersionId and '?' or '1')
        if f.lockedBy then
          info = info .. '  •  Locked'
        end
        if f.updatedAt then
          -- Extract date part from ISO string
          info = info .. '  •  ' .. (f.updatedAt:sub(1, 10))
        end
        dlg:modify{ id = 'info', text = info }
      else
        dlg:modify{ id = 'info', text = '' }
      end
    end,
  }

  -- Info line for selected file
  dlg:label{ id = 'info', label = '' }

  dlg:separator()

  -- Status line
  dlg:label{ id = 'status', label = 'Connecting…' }

  dlg:separator()

  -- Action buttons (Open closes the dialog; Cancel closes without action)
  dlg:button{ id = 'open',   text = 'Open in Aseprite', focus = true,  enabled = false }
  dlg:button{ id = 'cancel', text = 'Cancel',            focus = false }

  -- Kick off async project load BEFORE showing the dialog so the request
  -- is in-flight before Aseprite starts blocking on dlg:show.
  loadProjects()

  dlg:show{ wait = true }

  -- ------------------------------------------------------------------
  -- Handle the result after the dialog closes
  -- ------------------------------------------------------------------

  if not dlg.data.open then return end

  local fileIdx = dlg.data.files
  if not fileIdx or fileIdx < 1 then
    return
  end

  local file = state.files[fileIdx]
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
