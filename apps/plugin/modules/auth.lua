-- Auth module — manages login state, token lifecycle, and session restore.
--
-- On construction, Auth reads any previously stored token from Storage and
-- configures the Api with it so that calls made immediately after plugin
-- startup are authenticated.
--
-- Important: Aseprite's http.request relies on libcurl. The server's
-- refresh endpoint uses an httpOnly cookie, which libcurl does NOT persist
-- automatically between plugin sessions. Refresh therefore only works within
-- the current Aseprite session (same libcurl handle / cookie jar). On a cold
-- start, the user must re-login if the stored access token has expired.

local Auth = {}
Auth.__index = Auth

-- @param api      Api       instance from modules/api
-- @param storage  Storage   instance from modules/storage
function Auth.new(api, storage)
  local self = setmetatable({
    _api     = api,
    _storage = storage,
    _user    = nil,
    _loggedIn = false,
  }, Auth)

  -- Restore session from persisted preferences
  local saved = storage:load()
  api:setBaseUrl(saved.baseUrl)

  if saved.accessToken then
    api:setToken(saved.accessToken)
    -- Rebuild user from saved fields (may be partially populated)
    if saved.userId then
      self._user = {
        id        = saved.userId,
        username  = saved.username  or '',
        email     = saved.email     or '',
        avatarUrl = saved.avatarUrl or nil,
      }
      self._loggedIn = true
    end
  end

  return self
end

-- Returns true if the plugin currently holds a token (may still be expired).
function Auth:isLoggedIn()
  return self._loggedIn
end

-- Returns the cached user table, or nil if not logged in.
function Auth:getUser()
  return self._user
end

-- ---------------------------------------------------------------------------
-- Login
-- ---------------------------------------------------------------------------

-- @param email     string
-- @param password  string
-- @param callback  function(user, err)
function Auth:login(email, password, callback)
  self._api:post('/auth/login', { email = email, password = password }, function(data, err)
    if err then
      callback(nil, err)
      return
    end

    -- data = { accessToken, user: { id, username, email, avatarUrl } }
    self._api:setToken(data.accessToken)
    self._storage:saveToken(data.accessToken)
    self._storage:saveUser(data.user)

    self._user    = data.user
    self._loggedIn = true

    callback(data.user, nil)
  end)
end

-- ---------------------------------------------------------------------------
-- Logout
-- ---------------------------------------------------------------------------

-- @param callback  function()  called after local state is cleared
--                              (even if the server request fails)
function Auth:logout(callback)
  -- Fire-and-forget: clear local state regardless of server response
  local function clearLocal()
    self._api:clearToken()
    self._storage:clearAuth()
    self._user    = nil
    self._loggedIn = false
    if callback then callback() end
  end

  if self._loggedIn then
    self._api:post('/auth/logout', {}, function(_, _) clearLocal() end)
  else
    clearLocal()
  end
end

-- ---------------------------------------------------------------------------
-- Token refresh
-- ---------------------------------------------------------------------------

-- Attempts to exchange the httpOnly refresh cookie (set during login in the
-- same Aseprite session) for a new access token. Clears local state if the
-- server rejects the request (expired or missing cookie).
--
-- @param callback  function(user, err)
function Auth:refresh(callback)
  self._api:post('/auth/refresh', {}, function(data, err)
    if err then
      -- Refresh failed — token is truly expired; force re-login
      self._api:clearToken()
      self._storage:clearAuth()
      self._loggedIn = false
      self._user = nil
      if callback then callback(nil, err) end
      return
    end

    self._api:setToken(data.accessToken)
    self._storage:saveToken(data.accessToken)

    if data.user then
      self._storage:saveUser(data.user)
      self._user = data.user
    end
    self._loggedIn = true

    if callback then callback(self._user, nil) end
  end)
end

-- ---------------------------------------------------------------------------
-- Token verification
-- ---------------------------------------------------------------------------

-- Makes a lightweight authenticated request to check whether the stored
-- access token is still valid. Calls callback(true) or callback(false).
-- On 401, clears local auth state so the user is prompted to re-login.
--
-- @param callback  function(valid: boolean)
function Auth:verifyToken(callback)
  if not self._loggedIn then
    callback(false)
    return
  end

  -- /projects is a cheap authenticated endpoint available to any member
  self._api:get('/projects', function(_, err)
    if err and (err.code == 'UNAUTHORIZED' or err.code == 'FORBIDDEN') then
      self._loggedIn = false
      self._api:clearToken()
      self._storage:clearAuth()
      callback(false)
    else
      callback(true)
    end
  end)
end

return Auth
