-- API module — thin HTTP wrapper.
--
-- Uses app.http (Aseprite 1.3+ with libcurl) when available,
-- falls back to the system `curl` binary otherwise.
--
-- Every request:
--   • Sets Content-Type: application/json and Accept: application/json
--   • Attaches the Bearer token if one is set
--   • Parses the server's { data, error } envelope
--   • Calls callback(data, nil) on success or callback(nil, err) on failure

local json = require('modules.json')

local Api = {}
Api.__index = Api

-- tmpname() is blocked in Aseprite's Lua sandbox; generate paths manually.
local function tmpname()
  return '/tmp/asepritesync_' .. tostring(os.time()) .. '_' .. tostring(math.random(100000, 999999))
end

-- ---------------------------------------------------------------------------
-- curl fallback (used when app.http is nil)
-- ---------------------------------------------------------------------------
-- Executes an HTTP request via the system `curl` binary.
-- opts mirrors the app.http.request table: url, method, headers, body, callback.
-- callback receives { statusCode, body } on success or { error } on failure.
local function curlHttpRequest(opts)
  local method  = opts.method or 'GET'
  local url     = opts.url
  local headers = opts.headers or {}
  local body    = opts.body
  local cb      = opts.callback

  -- Write body to a temp file to avoid shell-quoting issues with JSON/binary data
  local bodyPath = nil
  if body and body ~= '' then
    bodyPath = tmpname()
    local f = io.open(bodyPath, 'wb')
    if not f then
      cb({ error = 'Cannot write temp file for request body' })
      return
    end
    f:write(body)
    f:close()
  end

  local outPath = tmpname()

  -- Build the curl command.
  -- We single-quote every substituted value; JWT tokens and server URLs
  -- never contain single quotes, so this is safe for our use-case.
  local parts = {
    'curl', '-s',
    '-o',  "'" .. outPath  .. "'",
    '-w',  "'%{http_code}'",
    '-X',  method,
  }

  for k, v in pairs(headers) do
    parts[#parts + 1] = '-H'
    parts[#parts + 1] = "'" .. k .. ': ' .. v .. "'"
  end

  if bodyPath then
    parts[#parts + 1] = "--data-binary"
    parts[#parts + 1] = "'@" .. bodyPath .. "'"
  end

  parts[#parts + 1] = "'" .. url .. "'"

  -- Prefix with env reset to avoid Steam Linux Runtime hijacking libcurl.so.4
  local cmd  = 'env LD_LIBRARY_PATH="" LD_PRELOAD="" ' .. table.concat(parts, ' ') .. ' 2>/dev/null'

  local pipe = io.popen(cmd)
  local httpCodeStr = pipe and pipe:read('*all') or ''
  if pipe then pipe:close() end

  -- Read response body from temp file
  local rf       = io.open(outPath, 'rb')
  local respBody = rf and rf:read('*all') or ''
  if rf then rf:close() end

  -- Clean up temp files (pcall: Aseprite sandbox may block os.remove)
  pcall(os.remove, outPath)
  if bodyPath then pcall(os.remove, bodyPath) end

  local code = tonumber(httpCodeStr:match('%d+$')) or 0
  if httpCodeStr == '' then
    cb({ error = 'curl is not installed or could not be executed' })
    return
  end
  if code == 0 then
    cb({ error = 'Connection refused — is the server running? (' .. opts.url .. ')' })
    return
  end

  cb({ statusCode = code, body = respBody })
end

-- Dispatch to app.http.request or curlHttpRequest based on availability.
local function httpRequest(opts)
  if app.http then
    app.http.request(opts)
  else
    curlHttpRequest(opts)
  end
end

-- ---------------------------------------------------------------------------
-- Constructor
-- ---------------------------------------------------------------------------

function Api.new(baseUrl)
  return setmetatable({
    _baseUrl = baseUrl or 'http://localhost:4000',
    _token   = nil,
  }, Api)
end

function Api:setToken(token)    self._token = token    end
function Api:clearToken()       self._token = nil      end
function Api:setBaseUrl(url)    self._baseUrl = url    end
function Api:getBaseUrl()       return self._baseUrl   end

-- ---------------------------------------------------------------------------
-- Core request method
-- ---------------------------------------------------------------------------

-- @param method    string   "GET" | "POST" | "PUT" | "DELETE"
-- @param path      string   e.g. "/auth/login"
-- @param body      table|nil  will be JSON-encoded
-- @param callback  function(data, err)
--                    data  — decoded .data field from the envelope (or nil)
--                    err   — table { code, message } (or nil)
function Api:request(method, path, body, callback)
  local headers = {
    ['Content-Type'] = 'application/json',
    ['Accept']       = 'application/json',
  }
  if self._token then
    headers['Authorization'] = 'Bearer ' .. self._token
  end

  local bodyStr = nil
  if body ~= nil then
    local ok, encoded = pcall(json.encode, body)
    if not ok then
      callback(nil, { code = 'ENCODE_ERROR', message = 'Failed to encode request body: ' .. tostring(encoded) })
      return
    end
    bodyStr = encoded
  end

  httpRequest{
    url     = self._baseUrl .. path,
    method  = method,
    headers = headers,
    body    = bodyStr,
    callback = function(response)
      if response.error then
        callback(nil, {
          code    = 'NETWORK_ERROR',
          message = 'Network error: ' .. tostring(response.error),
        })
        return
      end

      if not response.body or response.body == '' then
        callback(nil, nil)
        return
      end

      local ok, result = pcall(json.decode, response.body)
      if not ok then
        callback(nil, {
          code    = 'PARSE_ERROR',
          message = 'Server returned non-JSON response (HTTP ' .. tostring(response.statusCode) .. ')',
        })
        return
      end

      -- result.error may be json.null (JSON null) — treat that as no error
      if result ~= json.null and type(result) == 'table'
         and result.error ~= nil and result.error ~= json.null then
        callback(nil, result.error)
        return
      end

      local data = (type(result) == 'table' and result.data ~= nil)
                   and result.data
                   or  result
      callback(data, nil)
    end,
  }
end

-- ---------------------------------------------------------------------------
-- Convenience wrappers
-- ---------------------------------------------------------------------------

function Api:get(path, callback)
  self:request('GET', path, nil, callback)
end

function Api:post(path, body, callback)
  self:request('POST', path, body, callback)
end

function Api:put(path, body, callback)
  self:request('PUT', path, body, callback)
end

function Api:delete(path, callback)
  self:request('DELETE', path, nil, callback)
end

-- Multipart file upload.
-- @param path      string
-- @param filePath  string              absolute path on disk
-- @param filename  string              filename for the multipart disposition
-- @param method    string|function     "POST" or "PUT" (omit for "POST")
-- @param callback  function(data, err)
function Api:upload(path, filePath, filename, method, callback)
  if type(method) == 'function' then
    callback = method
    method   = 'POST'
  end
  method = method or 'POST'

  local f, openErr = io.open(filePath, 'rb')
  if not f then
    callback(nil, { code = 'FILE_ERROR', message = 'Cannot open file: ' .. tostring(openErr) })
    return
  end
  local bytes = f:read('*all')
  f:close()

  local boundary = 'AsepriteSync' .. tostring(math.random(100000, 999999))
  local body = table.concat({
    '--' .. boundary,
    'Content-Disposition: form-data; name="file"; filename="' .. filename .. '"',
    'Content-Type: application/octet-stream',
    '',
    bytes,
    '--' .. boundary .. '--',
  }, '\r\n')

  local headers = {
    ['Content-Type']   = 'multipart/form-data; boundary=' .. boundary,
    ['Accept']         = 'application/json',
    ['Content-Length'] = tostring(#body),
  }
  if self._token then
    headers['Authorization'] = 'Bearer ' .. self._token
  end

  httpRequest{
    url     = self._baseUrl .. path,
    method  = method,
    headers = headers,
    body    = body,
    callback = function(response)
      if response.error then
        callback(nil, { code = 'NETWORK_ERROR', message = tostring(response.error) })
        return
      end
      local ok, result = pcall(json.decode, response.body or '')
      if not ok then
        callback(nil, { code = 'PARSE_ERROR', message = 'Non-JSON upload response' })
        return
      end
      if type(result) == 'table'
         and result.error ~= nil and result.error ~= json.null then
        callback(nil, result.error)
        return
      end
      local data = (type(result) == 'table' and result.data ~= nil) and result.data or result
      callback(data, nil)
    end,
  }
end

-- Download a file as raw bytes — bypasses the JSON envelope.
-- @param path      string   e.g. "/files/<id>"
-- @param callback  function(bytes: string, err)
function Api:downloadBinary(path, callback)
  local headers = {
    ['Accept']         = 'application/octet-stream',
    ['Content-Length'] = '0',
  }
  if self._token then
    headers['Authorization'] = 'Bearer ' .. self._token
  end

  httpRequest{
    url     = self._baseUrl .. path,
    method  = 'GET',
    headers = headers,
    callback = function(response)
      if response.error then
        callback(nil, { code = 'NETWORK_ERROR', message = tostring(response.error) })
        return
      end
      local code = response.statusCode or 0
      if code >= 400 then
        callback(nil, { code = 'HTTP_' .. tostring(code), message = 'Download failed (HTTP ' .. tostring(code) .. ')' })
        return
      end
      callback(response.body, nil)
    end,
  }
end

return Api
