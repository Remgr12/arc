-- Sample arc CAD plugin. Logs sentry messages and re-centers geometry on open.
arc.log("sample plugin loaded")

arc.on("start", function()
  arc.log("arc started; hooking events")
end)

arc.on("open", function(args)
  local doc = arc.active_document()
  if doc then
    local list = arc.entities()
    arc.log(("document '%s' has %d entities"):format(doc, #list))
  end
end)

arc.on("save", function(args)
  arc.log("saved to " .. tostring(args.path))
end)
