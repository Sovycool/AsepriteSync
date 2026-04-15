-- AsepriteSync plugin — entry point
--
-- Loaded automatically by Aseprite when the extension is installed.
-- Wires together Storage → Api → Auth and registers plugin commands.
--
-- Module dependencies are resolved relative to this directory via Lua's
-- standard require() which Aseprite maps to the extension root.

local json     = require('modules.json')
local Storage  = require('modules.storage')
local Api      = require('modules.api')
local Auth     = require('modules.auth')
local Explorer = require('modules.explorer')
local Sync     = require('modules.sync')

-- Module-level references shared across commands registered in init().
local storage  = nil
local api      = nil
local auth     = nil
local explorer = nil
local sync     = nil

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

local function alert(title, message)
  local dlg = Dialog(title)
  dlg:label{ label = message }
  dlg:separator()
  dlg:button{ id = 'ok', text = 'OK', focus = true }
  dlg:show{ wait = true }
end

local function fmt_err(err)
  if type(err) == 'table' then
    return err.message or err.code or 'Unknown error'
  end
  return tostring(err)
end

-- ---------------------------------------------------------------------------
-- Command: Login / Connect
-- ---------------------------------------------------------------------------

local function cmd_login()
  -- If already logged in, show current user and offer logout
  if auth:isLoggedIn() then
    local user = auth:getUser()
    local dlg = Dialog('AsepriteSync — Connected')
    dlg:label{ label = 'Logged in as:  ' .. (user and user.username or '?') }
    dlg:label{ label = 'Server:  ' .. api:getBaseUrl() }
    dlg:separator()
    dlg:button{ id = 'logout', text = 'Logout', focus = false }
    dlg:button{ id = 'cancel', text = 'Close',  focus = true  }
    dlg:show{ wait = true }

    if dlg.data.logout then
      auth:logout(function()
        alert('AsepriteSync', 'Logged out successfully.')
      end)
    end
    return
  end

  -- ---- Login dialog ----
  local saved = storage:load()

  local dlg = Dialog('AsepriteSync — Login')
  dlg:label{ label = 'Connect to your AsepriteSync server.' }
  dlg:separator()
  dlg:entry{ id = 'baseUrl',  label = 'Server URL:', text = saved.baseUrl }
  dlg:entry{ id = 'email',    label = 'Email:',      text = saved.email or '' }
  dlg:entry{ id = 'password', label = 'Password:',   text = '' }
  dlg:separator()
  dlg:button{ id = 'login',  text = 'Login',  focus = true  }
  dlg:button{ id = 'cancel', text = 'Cancel', focus = false }
  dlg:show{ wait = true }

  if not dlg.data.login then return end

  local baseUrl  = dlg.data.baseUrl  or saved.baseUrl
  local email    = dlg.data.email    or ''
  local password = dlg.data.password or ''

  if email == '' or password == '' then
    alert('AsepriteSync', 'Email and password are required.')
    return
  end

  -- Persist the server URL immediately so it survives a failed login
  storage:saveBaseUrl(baseUrl)
  api:setBaseUrl(baseUrl)

  -- HTTP request is async; the callback fires from Aseprite's event loop
  auth:login(email, password, function(user, err)
    if err then
      alert('AsepriteSync — Login failed', fmt_err(err))
      return
    end
    alert('AsepriteSync', 'Welcome, ' .. (user.username or user.email) .. '!')
  end)
end

-- ---------------------------------------------------------------------------
-- Command: File Explorer
-- ---------------------------------------------------------------------------

local function cmd_explorer()
  explorer:open()
end

-- ---------------------------------------------------------------------------
-- Command: Push Changes (upload current sprite as new version)
-- ---------------------------------------------------------------------------

local function cmd_push()
  if not auth:isLoggedIn() then
    alert('AsepriteSync', 'You are not logged in.\nRun "AsepriteSync: Login / Connect" first.')
    return
  end

  local sprite = app.activeSprite
  if not sprite then
    alert('AsepriteSync', 'No sprite is currently open.')
    return
  end

  local info = sync:getFileInfo(sprite.filename)
  if not info then
    alert(
      'AsepriteSync — Not linked',
      'This sprite is not linked to a server file.\n'
      .. 'Use "AsepriteSync: Upload New File" to push it for the first time.'
    )
    return
  end

  -- ---- Check real lock state from the server ----
  local myId = auth:getUser() and auth:getUser().id or nil
  local serverFile, fetchErr = nil, nil
  sync:fetchFileState(info.fileId, function(f, e) serverFile = f; fetchErr = e end)

  if fetchErr then
    alert('AsepriteSync — Push failed', 'Could not check lock state:\n' .. fmt_err(fetchErr))
    return
  end

  local function is_locked_by_other(f)
    return f.lockedBy ~= nil and f.lockedBy ~= json.null and f.lockedBy ~= myId
  end
  local function is_locked_by_me(f)
    return f.lockedBy ~= nil and f.lockedBy ~= json.null and f.lockedBy == myId
  end

  if serverFile and is_locked_by_other(serverFile) then
    local warnDlg = Dialog('AsepriteSync — File is locked')
    warnDlg:label{ label = 'This file is currently locked by another user.' }
    warnDlg:label{ label = 'Pushing may be rejected by the server.' }
    warnDlg:separator()
    warnDlg:button{ id = 'push',   text = 'Push anyway', focus = false }
    warnDlg:button{ id = 'cancel', text = 'Cancel',      focus = true  }
    warnDlg:show{ wait = true }
    if not warnDlg.data.push then return end
  end

  -- ---- Conflict detection: server has a newer version ----
  local hasConflict = serverFile
                      and serverFile.currentVersionId ~= nil
                      and serverFile.currentVersionId ~= json.null
                      and info.versionId ~= nil
                      and serverFile.currentVersionId ~= info.versionId

  if hasConflict then
    local conflictDlg = Dialog('AsepriteSync — Conflict detected')
    conflictDlg:label{ label = 'The server has a newer version of this file.' }
    conflictDlg:label{ label = 'Your local copy may be out of date.' }
    conflictDlg:separator()
    conflictDlg:button{ id = 'push',   text = 'Push anyway (overwrite)', focus = false }
    conflictDlg:button{ id = 'pull',   text = 'Pull latest version',     focus = false }
    conflictDlg:button{ id = 'cancel', text = 'Cancel',                  focus = true  }
    conflictDlg:show{ wait = true }

    if conflictDlg.data.pull then
      -- Pull the latest version: warn about unsaved changes, then overwrite
      if sprite.isModified then
        local saveDlg = Dialog('AsepriteSync — Unsaved changes')
        saveDlg:label{ label = 'You have unsaved changes that will be lost.' }
        saveDlg:label{ label = 'Pull and discard local changes?' }
        saveDlg:separator()
        saveDlg:button{ id = 'yes',    text = 'Pull anyway', focus = false }
        saveDlg:button{ id = 'cancel', text = 'Cancel',      focus = true  }
        saveDlg:show{ wait = true }
        if not saveDlg.data.yes then return end
      end

      local pullPath = sprite.filename
      local pullProgress = Dialog{ title = 'AsepriteSync' }
      pullProgress:label{ id = 'msg', label = 'Downloading latest version\xE2\x80\xA6' }
      pullProgress:show{ wait = false }

      sync:pull(info.fileId, pullPath, function(pullOk, pullErr)
        pullProgress:close()
        if not pullOk then
          alert('AsepriteSync — Pull failed', fmt_err(pullErr))
        else
          app.open(pullPath)
          alert('AsepriteSync', 'Pulled latest version successfully.')
        end
      end)
      return

    elseif not conflictDlg.data.push then
      return
    end
    -- else: user chose "Push anyway" — fall through to the normal push flow
  end

  -- Update local tracking to match the real server state
  local lockedByMe = serverFile and is_locked_by_me(serverFile)
  if lockedByMe then
    sync:setLockedByMe(info.fileId, true)
  end

  -- Confirm push
  local confirmDlg = Dialog('AsepriteSync — Push Changes')
  confirmDlg:label{ label = 'Upload current sprite as a new version?' }
  confirmDlg:label{ label = sprite.filename:match('[^/\\]+$') or 'sprite' }
  confirmDlg:separator()

  if lockedByMe then
    confirmDlg:check{ id = 'unlock', label = 'Unlock after push', selected = true }
  end

  confirmDlg:button{ id = 'push',   text = 'Push',   focus = true  }
  confirmDlg:button{ id = 'cancel', text = 'Cancel', focus = false }
  confirmDlg:show{ wait = true }

  if not confirmDlg.data.push then return end

  local doUnlock = lockedByMe and confirmDlg.data.unlock

  local progressDlg = Dialog{ title = 'AsepriteSync' }
  progressDlg:label{ id = 'msg', label = 'Uploading\xE2\x80\xA6' }
  progressDlg:show{ wait = false }

  sync:push(function(pushOk, _, pushErr)
    progressDlg:close()

    if not pushOk then
      alert('AsepriteSync — Push failed', fmt_err(pushErr))
      return
    end

    if doUnlock then
      sync:unlock(info.fileId, function(unlockOk, unlockErr)
        if not unlockOk then
          alert('AsepriteSync', 'Pushed successfully, but unlock failed:\n' .. fmt_err(unlockErr))
        else
          alert('AsepriteSync', 'Pushed and unlocked successfully.')
        end
      end)
    else
      alert('AsepriteSync', 'Pushed successfully.')
    end
  end)
end

-- ---------------------------------------------------------------------------
-- Command: Upload New File (first-time upload)
-- ---------------------------------------------------------------------------

local function cmd_upload_new()
  if not auth:isLoggedIn() then
    alert('AsepriteSync', 'You are not logged in.\nRun "AsepriteSync: Login / Connect" first.')
    return
  end

  local sprite = app.activeSprite
  if not sprite then
    alert('AsepriteSync', 'No sprite is currently open.')
    return
  end

  -- Mutable state for async project load
  local state = { projects = {}, dlg = nil }

  local dlg = Dialog{ title = 'AsepriteSync — Upload New File' }
  state.dlg = dlg

  dlg:label{ label = 'Upload to project:' }
  dlg:combobox{
    id      = 'project',
    label   = 'Project:',
    options = { '(loading…)' },
  }
  dlg:separator()
  dlg:button{ id = 'upload', text = 'Upload', focus = true,  enabled = false }
  dlg:button{ id = 'cancel', text = 'Cancel', focus = false }

  -- Load projects asynchronously
  api:get('/projects', function(data, err)
    if err then
      dlg:modify{ id = 'project', options = { '(error: ' .. fmt_err(err) .. ')' } }
      return
    end
    state.projects = data or {}
    if #state.projects == 0 then
      dlg:modify{ id = 'project', options = { '(no projects)' } }
      return
    end
    local names = {}
    for _, p in ipairs(state.projects) do
      names[#names + 1] = p.name .. '  [' .. (p.role or '?') .. ']'
    end
    dlg:modify{ id = 'project', options = names }
    dlg:modify{ id = 'upload',  enabled = true }
  end)

  dlg:show{ wait = true }

  if not dlg.data.upload then return end

  local projectIdx = dlg.data.project
  local project    = state.projects[projectIdx]
  if not project then return end

  local progressDlg = Dialog{ title = 'AsepriteSync' }
  progressDlg:label{ id = 'msg', label = 'Uploading to ' .. project.name .. '…' }
  progressDlg:show{ wait = false }

  sync:uploadNew(project.id, function(ok, data, err)
    progressDlg:close()
    if not ok then
      alert('AsepriteSync — Upload failed', fmt_err(err))
      return
    end
    local name = data and data.name or '?'
    alert('AsepriteSync', '"' .. name .. '" uploaded successfully to ' .. project.name .. '.')
  end)
end

-- ---------------------------------------------------------------------------
-- Command: Pull latest version
-- ---------------------------------------------------------------------------

local function cmd_pull()
  if not auth:isLoggedIn() then
    alert('AsepriteSync', 'You are not logged in.\nRun "AsepriteSync: Login / Connect" first.')
    return
  end

  local sprite = app.activeSprite
  if not sprite then
    alert('AsepriteSync', 'No sprite is currently open.')
    return
  end

  local info = sync:getFileInfo(sprite.filename)
  if not info then
    alert(
      'AsepriteSync — Not linked',
      'This sprite is not linked to a server file.\n'
      .. 'Use "AsepriteSync: Open File\xE2\x80\xA6" to open a server file first.'
    )
    return
  end

  -- Check the server version
  local serverFile, fetchErr = nil, nil
  sync:fetchFileState(info.fileId, function(f, e) serverFile = f; fetchErr = e end)

  if fetchErr then
    alert('AsepriteSync — Pull failed', 'Could not check server version:\n' .. fmt_err(fetchErr))
    return
  end

  -- Determine whether there is actually a newer version
  local serverVersionId = serverFile and serverFile.currentVersionId ~= json.null
                          and serverFile.currentVersionId or nil
  local alreadyLatest = serverVersionId ~= nil
                        and info.versionId ~= nil
                        and serverVersionId == info.versionId

  if alreadyLatest then
    alert('AsepriteSync', 'You already have the latest version.')
    return
  end

  -- Warn about unsaved changes
  if sprite.isModified then
    local saveDlg = Dialog('AsepriteSync — Unsaved changes')
    saveDlg:label{ label = 'You have unsaved changes that will be lost.' }
    saveDlg:label{ label = 'Pull the latest version and discard them?' }
    saveDlg:separator()
    saveDlg:button{ id = 'yes',    text = 'Pull anyway', focus = false }
    saveDlg:button{ id = 'cancel', text = 'Cancel',      focus = true  }
    saveDlg:show{ wait = true }
    if not saveDlg.data.yes then return end
  else
    local confirmDlg = Dialog('AsepriteSync — Pull latest version')
    confirmDlg:label{ label = 'Download and overwrite with the latest server version?' }
    confirmDlg:label{ label = sprite.filename:match('[^/\\]+$') or 'sprite' }
    confirmDlg:separator()
    confirmDlg:button{ id = 'yes',    text = 'Pull',   focus = true  }
    confirmDlg:button{ id = 'cancel', text = 'Cancel', focus = false }
    confirmDlg:show{ wait = true }
    if not confirmDlg.data.yes then return end
  end

  local pullPath = sprite.filename
  local progressDlg = Dialog{ title = 'AsepriteSync' }
  progressDlg:label{ id = 'msg', label = 'Downloading latest version\xE2\x80\xA6' }
  progressDlg:show{ wait = false }

  sync:pull(info.fileId, pullPath, function(pullOk, pullErr)
    progressDlg:close()
    if not pullOk then
      alert('AsepriteSync — Pull failed', fmt_err(pullErr))
    else
      app.open(pullPath)
      alert('AsepriteSync', 'Pulled latest version successfully.')
    end
  end)
end

-- ---------------------------------------------------------------------------
-- Command: Lock / Unlock current file
-- ---------------------------------------------------------------------------

local function cmd_lock_toggle()
  if not auth:isLoggedIn() then
    alert('AsepriteSync', 'You are not logged in.')
    return
  end

  local sprite = app.activeSprite
  if not sprite then
    alert('AsepriteSync', 'No sprite is currently open.')
    return
  end

  local info = sync:getFileInfo(sprite.filename)
  if not info then
    alert(
      'AsepriteSync',
      'This sprite is not linked to a server file.\nOpen a file via "AsepriteSync: Open File\xE2\x80\xA6" first.'
    )
    return
  end

  -- ---- Fetch real lock state from the server before showing any dialog ----
  local serverFile, fetchErr = nil, nil
  sync:fetchFileState(info.fileId, function(f, e) serverFile = f; fetchErr = e end)

  if fetchErr then
    alert('AsepriteSync — Error', 'Could not check lock state:\n' .. fmt_err(fetchErr))
    return
  end

  local myId = auth:getUser() and auth:getUser().id or nil
  local fname = sprite.filename:match('[^/\\]+$') or 'this file'

  local realLockedBy = (serverFile and serverFile.lockedBy ~= nil and serverFile.lockedBy ~= json.null)
                       and serverFile.lockedBy or nil

  -- Sync local tracking with the real server state
  sync:setLockedByMe(info.fileId, realLockedBy == myId)

  if realLockedBy == nil then
    -- File is free — offer to lock
    local dlg = Dialog('AsepriteSync — Lock')
    dlg:label{ label = 'Lock "' .. fname .. '" for editing?' }
    dlg:button{ id = 'yes',    text = 'Lock',   focus = true  }
    dlg:button{ id = 'cancel', text = 'Cancel', focus = false }
    dlg:show{ wait = true }
    if not dlg.data.yes then return end

    sync:lock(info.fileId, function(lockOk, lockErr)
      if lockOk then
        alert('AsepriteSync', '"' .. fname .. '" is now locked by you.')
      else
        alert('AsepriteSync — Lock failed', fmt_err(lockErr))
      end
    end)

  elseif realLockedBy == myId then
    -- Locked by me — offer to unlock
    local dlg = Dialog('AsepriteSync — Unlock')
    dlg:label{ label = 'Release your lock on "' .. fname .. '"?' }
    dlg:button{ id = 'yes',    text = 'Unlock', focus = true  }
    dlg:button{ id = 'cancel', text = 'Cancel', focus = false }
    dlg:show{ wait = true }
    if not dlg.data.yes then return end

    sync:unlock(info.fileId, function(unlockOk, unlockErr)
      if unlockOk then
        alert('AsepriteSync', '"' .. fname .. '" has been unlocked.')
      else
        alert('AsepriteSync — Unlock failed', fmt_err(unlockErr))
      end
    end)

  else
    -- Locked by someone else — inform, no action available
    alert(
      'AsepriteSync — File is locked',
      '"' .. fname .. '" is currently locked by another user.\n'
      .. 'You cannot lock or unlock it until they release it.'
    )
  end
end

-- ---------------------------------------------------------------------------
-- Command: Server settings
-- ---------------------------------------------------------------------------

local function cmd_settings()
  local saved = storage:load()

  local dlg = Dialog('AsepriteSync — Settings')
  dlg:entry{ id = 'baseUrl', label = 'Server URL:', text = saved.baseUrl }
  dlg:separator()
  dlg:button{ id = 'save',   text = 'Save',   focus = true  }
  dlg:button{ id = 'cancel', text = 'Cancel', focus = false }
  dlg:show{ wait = true }

  if dlg.data.save then
    local url = dlg.data.baseUrl or saved.baseUrl
    storage:saveBaseUrl(url)
    api:setBaseUrl(url)
    alert('AsepriteSync', 'Server URL updated.')
  end
end

-- ---------------------------------------------------------------------------
-- Plugin lifecycle
-- ---------------------------------------------------------------------------

function init(plugin)

  print('[AsepriteSync] v1.0.3 — Initializing plugin…')

  -- Initialise modules in dependency order
  storage  = Storage.new(plugin.preferences)
  api      = Api.new('http://localhost:4000')  -- base URL overwritten by Auth.new via storage
  auth     = Auth.new(api, storage)
  sync     = Sync.new(api, auth, plugin.path)
  explorer = Explorer.new(api, auth, plugin.path)
  explorer:setSync(sync)  -- inject after both are created (avoids circular dep)

  print('[AsepriteSync] v1.0.3 — Plugin initialized.')

  -- Create the "AsepriteSync" submenu inside File > Scripts
  plugin:newMenuGroup{
    id    = 'asepritesync',
    title = 'AsepriteSync',
    group = 'file_scripts',
  }

  -- Register commands inside the submenu
  plugin:newCommand{
    id      = 'asepritesync-login',
    title   = 'Login / Connect',
    group   = 'asepritesync',
    onclick = cmd_login,
  }

  plugin:newCommand{
    id      = 'asepritesync-explorer',
    title   = 'Open File\xE2\x80\xA6',
    group   = 'asepritesync',
    onclick = cmd_explorer,
  }

  plugin:newCommand{
    id      = 'asepritesync-push',
    title   = 'Push Changes',
    group   = 'asepritesync',
    onclick = cmd_push,
  }

  plugin:newCommand{
    id      = 'asepritesync-upload-new',
    title   = 'Upload New File',
    group   = 'asepritesync',
    onclick = cmd_upload_new,
  }

  plugin:newCommand{
    id      = 'asepritesync-pull',
    title   = 'Pull Latest Version',
    group   = 'asepritesync',
    onclick = cmd_pull,
  }

  plugin:newCommand{
    id      = 'asepritesync-lock',
    title   = 'Lock / Unlock File',
    group   = 'asepritesync',
    onclick = cmd_lock_toggle,
  }

  plugin:newCommand{
    id      = 'asepritesync-settings',
    title   = 'Server Settings',
    group   = 'asepritesync',
    onclick = cmd_settings,
  }

  print('[AsepriteSync] v1.0.3 — Commands registered.')

  -- Optionally verify the stored token in the background on startup
  if auth:isLoggedIn() then
    auth:verifyToken(function(valid)
      if not valid then
        -- Token expired silently — user will be re-prompted next time they
        -- try to use a feature that requires auth
        print('[AsepriteSync] Stored token has expired. Please log in again.')
      else
        local user = auth:getUser()
        print('[AsepriteSync] Session restored for ' .. (user and user.username or '?'))
      end
    end)
  end
end

function exit(plugin)
  -- Nothing to tear down; preferences are flushed automatically by Aseprite
  plugin._asepritesync = nil
end
