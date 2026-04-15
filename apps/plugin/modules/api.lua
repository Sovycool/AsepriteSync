-- API module — thin HTTP wrapper around Aseprite's built-in http.request.
--
-- Every request:
--   • Sets Content-Type: application/json and Accept: application/json
--   • Attaches the Bearer token if one is set
--   • Parses the server's { data, error } envelope
--   • Calls callback(data, nil) on success or callback(nil, err) on failure
--
-- All callbacks are called asynchronously from Aseprite's event loop.

local json = require('modules.json')

local Api = {}
Api.__index = Api

-- Create a new Api client.
-- @param baseUrl  string  e.g. "http://localhost:4000"
function Api.new(baseUrl)
  return setmetatable({
    _baseUrl = baseUrl or 'http://localhost:4000',
    _token   = nil,
  }, Api)
end

function Api:setToken(token)
  self._token = token
end

function Api:clearToken()
  self._token = nil
end

function Api:setBaseUrl(url)
  self._baseUrl = url
end

function Api:getBaseUrl()
  return self._baseUrl
end

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

  http.request{
    url     = self._baseUrl .. path,
    method  = method,
    headers = headers,
    body    = bodyStr,
    callback = function(response)
      -- Network-level error (no response received)
      if response.error then
        callback(nil, {
          code    = 'NETWORK_ERROR',
          message = 'Network error: ' .. tostring(response.error),
        })
        return
      end

      -- Try to parse the JSON envelope
      if not response.body or response.body == '' then
        -- 204 No Content or similar — treat as success with nil data
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

      -- Server-side error inside the envelope
      if result ~= json.null and type(result) == 'table' and result.error then
        callback(nil, result.error)
        return
      end

      -- Success — unwrap .data
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

-- Multipart file upload — sends raw bytes using Aseprite's http.request.
-- @param path      string
-- @param filePath  string              absolute path on disk
-- @param filename  string              filename to use in the multipart disposition
-- @param method    string|function     HTTP method ("POST" or "PUT"); omit for "POST"
--                                      (backward-compatible: if this arg is a function it
--                                      is treated as the callback and method defaults to "POST")
-- @param callback  function(data, err)
function Api:upload(path, filePath, filename, method, callback)
  -- Backward-compat: old callers pass (path, filePath, filename, callback)
  if type(method) == 'function' then
    callback = method
    method   = 'POST'
  end
  method = method or 'POST'
  -- Read the file bytes
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

  http.request{
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
      if type(result) == 'table' and result.error then
        callback(nil, result.error)
        return
      end
      local data = (type(result) == 'table' and result.data ~= nil) and result.data or result
      callback(data, nil)
    end,
  }
end

-- Download a file as raw bytes — bypasses the JSON envelope.
-- Used for .aseprite binary downloads.
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

  http.request{
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
