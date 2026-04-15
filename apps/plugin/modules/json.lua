-- Minimal JSON encoder/decoder for the AsepriteSync plugin.
-- Handles objects, arrays, strings, numbers, booleans, and null.
-- null is represented as the sentinel value json.null.

local json = {}

json.null = setmetatable({}, { __tostring = function() return "null" end })

-- ---------------------------------------------------------------------------
-- Encoder
-- ---------------------------------------------------------------------------

local escape_map = {
  ['"']  = '\\"',
  ['\\'] = '\\\\',
  ['\b'] = '\\b',
  ['\f'] = '\\f',
  ['\n'] = '\\n',
  ['\r'] = '\\r',
  ['\t'] = '\\t',
}

local function encode_string(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    return escape_map[c] or string.format('\\u%04x', c:byte())
  end) .. '"'
end

local function encode_value(val, seen)
  local t = type(val)

  if val == json.null then
    return 'null'
  elseif t == 'nil' then
    return 'null'
  elseif t == 'boolean' then
    return val and 'true' or 'false'
  elseif t == 'number' then
    if val ~= val then return 'null' end -- NaN → null
    if val == math.huge or val == -math.huge then return 'null' end
    -- Use integer format when safe
    if math.floor(val) == val and math.abs(val) < 1e15 then
      return string.format('%d', val)
    end
    return string.format('%.17g', val)
  elseif t == 'string' then
    return encode_string(val)
  elseif t == 'table' then
    if seen[val] then error('circular reference in JSON encoding') end
    seen[val] = true

    -- Determine if it looks like an array (consecutive integer keys from 1)
    local n = #val
    local is_array = n > 0
    if is_array then
      for i = 1, n do
        if val[i] == nil then is_array = false; break end
      end
    end

    local parts = {}
    if is_array then
      for i = 1, n do
        parts[i] = encode_value(val[i], seen)
      end
      seen[val] = nil
      return '[' .. table.concat(parts, ',') .. ']'
    else
      local i = 0
      for k, v in pairs(val) do
        if type(k) ~= 'string' then
          error('JSON object keys must be strings, got ' .. type(k))
        end
        i = i + 1
        parts[i] = encode_string(k) .. ':' .. encode_value(v, seen)
      end
      seen[val] = nil
      return '{' .. table.concat(parts, ',') .. '}'
    end
  else
    error('cannot JSON-encode value of type ' .. t)
  end
end

function json.encode(val)
  return encode_value(val, {})
end

-- ---------------------------------------------------------------------------
-- Decoder
-- ---------------------------------------------------------------------------

local function skip_ws(s, i)
  while i <= #s do
    local c = s:sub(i, i)
    if c ~= ' ' and c ~= '\t' and c ~= '\n' and c ~= '\r' then break end
    i = i + 1
  end
  return i
end

local decode_value -- forward declaration

local function decode_string(s, i)
  -- i points to the opening "
  i = i + 1 -- skip "
  local parts = {}
  while i <= #s do
    local c = s:sub(i, i)
    if c == '"' then
      return table.concat(parts), i + 1
    elseif c == '\\' then
      i = i + 1
      local esc = s:sub(i, i)
      if     esc == '"'  then parts[#parts+1] = '"'
      elseif esc == '\\' then parts[#parts+1] = '\\'
      elseif esc == '/'  then parts[#parts+1] = '/'
      elseif esc == 'b'  then parts[#parts+1] = '\b'
      elseif esc == 'f'  then parts[#parts+1] = '\f'
      elseif esc == 'n'  then parts[#parts+1] = '\n'
      elseif esc == 'r'  then parts[#parts+1] = '\r'
      elseif esc == 't'  then parts[#parts+1] = '\t'
      elseif esc == 'u'  then
        -- Basic BMP code point: \uXXXX → UTF-8
        local hex = s:sub(i+1, i+4)
        local cp = tonumber(hex, 16)
        if not cp then error('invalid \\u escape: ' .. hex) end
        if cp < 0x80 then
          parts[#parts+1] = string.char(cp)
        elseif cp < 0x800 then
          parts[#parts+1] = string.char(
            0xC0 + math.floor(cp / 64),
            0x80 + (cp % 64)
          )
        else
          parts[#parts+1] = string.char(
            0xE0 + math.floor(cp / 4096),
            0x80 + (math.floor(cp / 64) % 64),
            0x80 + (cp % 64)
          )
        end
        i = i + 4
      else
        error('invalid escape \\' .. esc)
      end
      i = i + 1
    else
      parts[#parts+1] = c
      i = i + 1
    end
  end
  error('unterminated string')
end

local function decode_array(s, i)
  i = i + 1 -- skip [
  local arr = {}
  i = skip_ws(s, i)
  if s:sub(i, i) == ']' then return arr, i + 1 end
  while true do
    local val
    val, i = decode_value(s, i)
    arr[#arr+1] = val
    i = skip_ws(s, i)
    local c = s:sub(i, i)
    if c == ']' then return arr, i + 1 end
    if c ~= ',' then error('expected , or ] in array') end
    i = skip_ws(s, i + 1)
  end
end

local function decode_object(s, i)
  i = i + 1 -- skip {
  local obj = {}
  i = skip_ws(s, i)
  if s:sub(i, i) == '}' then return obj, i + 1 end
  while true do
    i = skip_ws(s, i)
    if s:sub(i, i) ~= '"' then error('expected string key in object') end
    local key
    key, i = decode_string(s, i)
    i = skip_ws(s, i)
    if s:sub(i, i) ~= ':' then error('expected : after object key') end
    i = skip_ws(s, i + 1)
    local val
    val, i = decode_value(s, i)
    obj[key] = val
    i = skip_ws(s, i)
    local c = s:sub(i, i)
    if c == '}' then return obj, i + 1 end
    if c ~= ',' then error('expected , or } in object') end
    i = skip_ws(s, i + 1)
  end
end

decode_value = function(s, i)
  i = skip_ws(s, i)
  local c = s:sub(i, i)
  if c == '"' then
    return decode_string(s, i)
  elseif c == '[' then
    return decode_array(s, i)
  elseif c == '{' then
    return decode_object(s, i)
  elseif s:sub(i, i+3) == 'true' then
    return true, i + 4
  elseif s:sub(i, i+4) == 'false' then
    return false, i + 5
  elseif s:sub(i, i+3) == 'null' then
    return json.null, i + 4
  else
    -- Number
    local num_str = s:match('^-?%d+%.?%d*[eE]?[+-]?%d*', i)
    if not num_str then error('unexpected token at position ' .. i .. ': ' .. s:sub(i, i+10)) end
    return tonumber(num_str), i + #num_str
  end
end

function json.decode(s)
  if type(s) ~= 'string' then error('json.decode expects a string') end
  local val, i = decode_value(s, 1)
  i = skip_ws(s, i)
  if i <= #s then
    error('trailing garbage after JSON value')
  end
  return val
end

return json
