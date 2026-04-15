-- Explorer module — File Explorer dialog for AsepriteSync.
--
-- Flow:
--   1. Verify auth (show hint if not logged in)
--   2. Fetch projects + first project's files synchronously before showing dialog
--   3. When the user switches projects, reload the file list
--   4. "Open in Aseprite" downloads the selected file to dataPath and opens it
--   5. "Refresh" reloads the current file list in-place

local json = require('modules.json')

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
    _sync     = sync,
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
  if app and app.fs and app.fs.joinPath then
    return app.fs.joinPath(dir, name)
  end
  local sep = package.config:sub(1, 1)
  if dir:sub(-1) == '/' or dir:sub(-1) == '\\' then
    return dir .. name
  end
  return dir .. sep .. name
end

-- True only when lockedBy is a real user-ID string (not nil, not json.null).
local function is_locked(f)
  return f.lockedBy ~= nil and f.lockedBy ~= json.null
end

-- Build the display label shown in the file combobox.
local function file_label(f, currentUserId)
  local label = f.name
  if is_locked(f) then
    if f.lockedBy == currentUserId then
      label = label .. '  \xF0\x9F\x94\x92 (you)'  -- 🔒 (you)
    else
      label = label .. '  \xF0\x9F\x94\x92'        -- 🔒
    end
  end
  return label
end

-- Build the one-line info text shown below the file combobox.
local function file_info_text(f, currentUserId)
  if not f then return '' end
  local info = ''
  if is_locked(f) then
    if f.lockedBy == currentUserId then
      info = 'Locked by you  \xE2\x80\x94  '   -- — (em-dash)
    else
      info = 'Locked by another user  \xE2\x80\x94  '
    end
  end
  if f.updatedAt and type(f.updatedAt) == 'string' then
    info = info .. f.updatedAt:sub(1, 10)
  end
  return info
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

  -- Fetch helpers (synchronous via curl; callbacks fire inline before dialog opens)

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
    if err then fetchProjectsErr = err; return end
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

  -- Pre-fetch files for the first project so the dialog opens with data
  fetchFiles(1)

  -- ------------------------------------------------------------------
  -- Derived lists (recomputed whenever files/project changes)
  -- ------------------------------------------------------------------

  local currentUserId = self._auth:getUser() and self._auth:getUser().id or nil

  local function fileItems()
    local options = {}
    for _, f in ipairs(state.files) do
      options[#options + 1] = file_label(f, currentUserId)
    end
    return options
  end

  local function statusText()
    local proj = state.projects[state.projectIdx]
    if #state.files == 0 then
      return 'No files in ' .. (proj and proj.name or '?')
    end
    return tostring(#state.files) .. ' file(s)  —  ' .. (proj and proj.name or '?')
  end

  -- ------------------------------------------------------------------
  -- Build the dialog
  -- ------------------------------------------------------------------

  local dlg = Dialog{ title = 'AsepriteSync — File Explorer' }

  dlg:combobox{
    id       = 'project',
    label    = 'Project:',
    options  = (function()
      local names = {}
      for _, p in ipairs(state.projects) do
        names[#names + 1] = p.name .. '  [' .. (p.role or '?') .. ']'
      end
      return names
    end)(),
    onchange = function()
      state.projectIdx = dlg.data.project
      fetchFiles(state.projectIdx)
      state.fileIdx = 1
      local options = fileItems()
      dlg:modify{ id = 'files',  options = options }
      dlg:modify{ id = 'open',   enabled = #options > 0 }
      dlg:modify{ id = 'status', text    = statusText() }
      dlg:modify{ id = 'info',   text    = file_info_text(state.files[1], currentUserId) }
    end,
  }

  dlg:button{
    id      = 'refresh',
    text    = 'Refresh',
    onclick = function()
      fetchFiles(state.projectIdx)
      state.fileIdx = 1
      local options = fileItems()
      dlg:modify{ id = 'files',  options = options }
      dlg:modify{ id = 'open',   enabled = #options > 0 }
      dlg:modify{ id = 'status', text    = statusText() }
      dlg:modify{ id = 'info',   text    = file_info_text(state.files[1], currentUserId) }
    end,
  }

  dlg:separator()

  local initItems = fileItems()

  dlg:combobox{
    id       = 'files',
    options  = initItems,
    onchange = function()
      local val = dlg.data.files
      local idx = type(val) == 'number' and val or nil
      if not idx then
        for i, label in ipairs(fileItems()) do
          if label == val then idx = i; break end
        end
      end
      state.fileIdx = idx or 1
      dlg:modify{ id = 'info', text = file_info_text(state.files[state.fileIdx], currentUserId) }
    end,
  }

  -- Info label: populated immediately for the first file, updated on selection change
  dlg:label{ id = 'info', label = file_info_text(state.files[1], currentUserId) }

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
  local progress = Dialog{ title = 'AsepriteSync' }
  progress:label{ id = 'msg', label = 'Downloading ' .. file.name .. '\xE2\x80\xA6' }
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

    if self._sync then
      self._sync:registerOpen(destPath, file.id, file.projectId, file.currentVersionId)
    end

    app.open(destPath)

    -- Determine lock ownership using the same json.null-aware check
    local myId         = self._auth:getUser() and self._auth:getUser().id or nil
    local lockedByMe   = is_locked(file) and file.lockedBy == myId
    local lockedByOther = is_locked(file) and not lockedByMe

    if lockedByMe then
      local d = Dialog('AsepriteSync')
      d:label{ label = file.name .. ' is open.' }
      d:label{ label = 'You already hold the lock on this file.' }
      d:button{ id = 'ok', text = 'OK', focus = true }
      d:show{ wait = true }

    elseif lockedByOther then
      local d = Dialog('AsepriteSync — File is locked')
      d:label{ label = file.name .. ' is locked by another user.' }
      d:label{ label = 'You can view it, but uploads may be rejected.' }
      d:button{ id = 'ok', text = 'OK', focus = true }
      d:show{ wait = true }

    elseif self._sync then
      local d = Dialog('AsepriteSync — Lock for editing?')
      d:label{ label = file.name .. ' is now open.' }
      d:label{ label = 'Lock it so teammates know you are editing?' }
      d:separator()
      d:button{ id = 'yes', text = 'Lock',  focus = true  }
      d:button{ id = 'no',  text = 'Skip',  focus = false }
      d:show{ wait = true }

      if d.data.yes then
        self._sync:lock(file.id, function(ok, lockErr)
          if not ok then
            local e = Dialog('AsepriteSync')
            e:label{ label = 'Lock failed: ' .. fmt_err(lockErr) }
            e:button{ id = 'ok', text = 'OK', focus = true }
            e:show{ wait = true }
          end
        end)
      end
    end
  end)
end

return Explorer
