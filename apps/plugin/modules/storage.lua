-- Storage module — persists auth tokens and settings using Aseprite's
-- plugin.preferences (automatically saved to disk by Aseprite).
--
-- Preference keys:
--   accessToken  string | nil
--   userId       string | nil
--   username     string | nil
--   email        string | nil
--   avatarUrl    string | nil
--   baseUrl      string   (default: "http://localhost:4000")

local Storage = {}
Storage.__index = Storage

-- Create a new Storage instance backed by the plugin preference table.
-- @param prefs  plugin.preferences (the table Aseprite persists automatically)
function Storage.new(prefs)
  return setmetatable({ _prefs = prefs }, Storage)
end

-- Return all stored values as a single snapshot table.
-- Missing optional fields are returned as nil.
function Storage:load()
  local p = self._prefs
  return {
    accessToken = p.accessToken ~= '' and p.accessToken or nil,
    userId      = p.userId      ~= '' and p.userId      or nil,
    username    = p.username    ~= '' and p.username    or nil,
    email       = p.email       ~= '' and p.email       or nil,
    avatarUrl   = p.avatarUrl   ~= '' and p.avatarUrl   or nil,
    baseUrl     = (p.baseUrl and p.baseUrl ~= '')
                  and p.baseUrl
                  or  'http://localhost:4000',
  }
end

-- Persist the access token received from the server.
function Storage:saveToken(accessToken)
  self._prefs.accessToken = accessToken or ''
end

-- Persist the user profile returned by the server after login/refresh.
function Storage:saveUser(user)
  self._prefs.userId    = user.id       or ''
  self._prefs.username  = user.username or ''
  self._prefs.email     = user.email    or ''
  self._prefs.avatarUrl = user.avatarUrl or ''
end

-- Update the base URL (e.g. when the user changes the server address).
function Storage:saveBaseUrl(url)
  self._prefs.baseUrl = url or 'http://localhost:4000'
end

-- Wipe all auth-related preferences.
function Storage:clearAuth()
  self._prefs.accessToken = ''
  self._prefs.userId      = ''
  self._prefs.username    = ''
  self._prefs.email       = ''
  self._prefs.avatarUrl   = ''
end

return Storage
