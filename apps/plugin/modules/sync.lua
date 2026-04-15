-- Sync module — upload, push, lock/unlock for the AsepriteSync plugin.
--
-- Concepts:
--   "Registered file" — a sprite that was opened from the server via the
--     Explorer.  Its path is stored in _openFiles so we know its fileId and
--     projectId and whether we hold the lock.
--
--   "Push" — save the current sprite to a temp copy, then PUT it to the server
--     as a new version of the same file (requires a registered file).
--
--   "Upload new" — POST the current sprite to a project for the first time,
--     then register the result so subsequent pushes work.
--
--   "Auto-lock" — called by Explorer after download; locks the file on the
--     server so team-mates see it as in-use.

local Sync = {}
Sync.__index = Sync

-- ---------------------------------------------------------------------------
-- Construction
-- ---------------------------------------------------------------------------

-- @param api       Api      from modules/api
-- @param auth      Auth     from modules/auth
-- @param dataPath  string   writable directory for temp files (plugin.dataPath)
function Sync.new(api, auth, dataPath)
  return setmetatable({
    _api       = api,
    _auth      = auth,
    _dataPath  = dataPath,
    -- path → { fileId, projectId, lockedByMe }
    _openFiles = {},
  }, Sync)
end

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

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

local function basename(path)
  return path:match('[^/\\]+$') or path
end

local function fmt_err(err)
  if type(err) == 'table' then
    return err.message or err.code or 'Unknown error'
  end
  return tostring(err)
end

-- Save a copy of the given sprite to destPath synchronously.
-- Returns true on success, false + message on failure.
local function save_copy(sprite, destPath)
  local ok, err = pcall(function()
    sprite:saveCopyAs(destPath)
  end)
  if not ok then
    return false, tostring(err)
  end
  return true, nil
end

-- ---------------------------------------------------------------------------
-- File registration (used by Explorer after download)
-- ---------------------------------------------------------------------------

-- Remember that filePath came from the server as fileId in projectId.
function Sync:registerOpen(filePath, fileId, projectId)
  self._openFiles[filePath] = {
    fileId     = fileId,
    projectId  = projectId,
    lockedByMe = false,
  }
end

-- Return the server info for filePath, or nil if not registered.
function Sync:getFileInfo(filePath)
  return self._openFiles[filePath]
end

-- Mark the in-memory lock state (does NOT call the server).
function Sync:setLockedByMe(fileId, locked)
  for _, info in pairs(self._openFiles) do
    if info.fileId == fileId then
      info.lockedByMe = locked
    end
  end
end

-- ---------------------------------------------------------------------------
-- Lock / Unlock
-- ---------------------------------------------------------------------------

-- Lock a server file. Updates local tracking on success.
-- @param fileId    string
-- @param callback  function(ok: boolean, err)
function Sync:lock(fileId, callback)
  self._api:post('/files/' .. fileId .. '/lock', {}, function(_, err)
    if err then
      if callback then callback(false, err) end
      return
    end
    self:setLockedByMe(fileId, true)
    if callback then callback(true, nil) end
  end)
end

-- Unlock a server file. Updates local tracking on success.
-- @param fileId    string
-- @param callback  function(ok: boolean, err)
function Sync:unlock(fileId, callback)
  self._api:delete('/files/' .. fileId .. '/lock', function(_, err)
    if err then
      if callback then callback(false, err) end
      return
    end
    self:setLockedByMe(fileId, false)
    if callback then callback(true, nil) end
  end)
end

-- ---------------------------------------------------------------------------
-- Push (update existing file)
-- ---------------------------------------------------------------------------

-- Upload the current Aseprite sprite as a new version of its server file.
-- The sprite must have been opened via Explorer (i.e. registered).
--
-- @param callback  function(ok: boolean, data, err)
--                    data — UploadResult from server on success
function Sync:push(callback)
  local sprite = app.activeSprite
  if not sprite then
    callback(false, nil, { message = 'No active sprite open.' })
    return
  end

  local info = self:getFileInfo(sprite.filename)
  if not info then
    callback(false, nil, {
      message = 'This file is not linked to a server file.\n'
             .. 'Use "Upload New File" to push it for the first time.',
    })
    return
  end

  -- Save a copy to a temp path so we don't alter the sprite's filename
  local fname    = basename(sprite.filename)
  local tempPath = safe_join(self._dataPath, '_push_' .. info.fileId .. '_' .. fname)

  local ok, saveErr = save_copy(sprite, tempPath)
  if not ok then
    callback(false, nil, { message = 'Failed to save sprite copy: ' .. saveErr })
    return
  end

  self._api:upload(
    '/files/' .. info.fileId,
    tempPath,
    fname,
    'PUT',
    function(data, err)
      os.remove(tempPath)
      if err then
        callback(false, nil, err)
        return
      end
      callback(true, data, nil)
    end
  )
end

-- ---------------------------------------------------------------------------
-- Upload new file to a project
-- ---------------------------------------------------------------------------

-- Upload the current sprite as a brand-new file to projectId.
-- On success the file is registered so future :push() calls work.
--
-- @param projectId  string
-- @param callback   function(ok: boolean, data, err)
function Sync:uploadNew(projectId, callback)
  local sprite = app.activeSprite
  if not sprite then
    callback(false, nil, { message = 'No active sprite open.' })
    return
  end

  -- The sprite might not have a filename if it was never saved; fall back
  local fname
  if sprite.filename and sprite.filename ~= '' then
    fname = basename(sprite.filename)
  else
    -- Derive a name from the first layer or fall back to a timestamp
    local ts = os.time and os.time() or 0
    fname = 'untitled_' .. tostring(ts) .. '.aseprite'
  end

  local tempPath = safe_join(self._dataPath, '_upload_' .. fname)

  local ok, saveErr = save_copy(sprite, tempPath)
  if not ok then
    callback(false, nil, { message = 'Failed to save sprite copy: ' .. saveErr })
    return
  end

  self._api:upload(
    '/projects/' .. projectId .. '/files',
    tempPath,
    fname,
    'POST',
    function(data, err)
      os.remove(tempPath)
      if err then
        callback(false, nil, err)
        return
      end
      -- Register the new file so future pushes work
      if data and data.id then
        -- sprite.filename may be empty for unsaved sprites; use tempPath key
        -- as a fallback (the user will need to save the sprite for pushes to work)
        local spritePath = (sprite.filename and sprite.filename ~= '')
                           and sprite.filename
                           or  tempPath
        self:registerOpen(spritePath, data.id, projectId)
      end
      callback(true, data, nil)
    end
  )
end

return Sync
