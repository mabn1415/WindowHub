import Cocoa
import ApplicationServices

// A persistent, local JSON-lines bridge. AX references never leave this process.
// Keeping the actual AXUIElement prevents an index change from targeting another window.
NSApplication.shared.setActivationPolicy(.prohibited)
var known: [String: AXUIElement] = [:]
var nextID = 0

func attribute(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success else { return nil }
    return value
}
func string(_ element: AXUIElement, _ key: String) -> String { attribute(element, key) as? String ?? "" }
func frame(_ window: AXUIElement) -> CGRect? {
    guard let p = attribute(window, kAXPositionAttribute), let s = attribute(window, kAXSizeAttribute), CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero; var size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
    return CGRect(origin: point, size: size)
}
func rectJSON(_ r: CGRect) -> [String: Double] { ["x":r.minX,"y":r.minY,"width":r.width,"height":r.height] }
func monitors() -> [[String: Any]] {
    let top = NSScreen.screens.first?.frame.maxY ?? 0
    return NSScreen.screens.map { screen in
        let display = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID ?? 0
        let uuid = CGDisplayCreateUUIDFromDisplayID(display).map { CFUUIDCreateString(nil, $0.takeRetainedValue()) as String } ?? String(display)
        let f = screen.visibleFrame
        return ["id":uuid,"name":screen.localizedName,"rect":rectJSON(CGRect(x:f.minX,y:top-f.maxY,width:f.width,height:f.height)),"scale":screen.backingScaleFactor]
    }
}
func snapshot() -> [String: Any] {
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.01))
    let trusted = AXIsProcessTrusted()
    var output: [[String: Any]] = []
    var alive: Set<String> = []
    if trusted {
        for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular && app.processIdentifier != getppid() && app.processIdentifier != getpid() {
            let application = AXUIElementCreateApplication(app.processIdentifier)
            AXUIElementSetMessagingTimeout(application, 0.4)
            guard let windows = attribute(application, kAXWindowsAttribute) as? [AXUIElement] else { continue }
            for window in windows {
                AXUIElementSetMessagingTimeout(window, 0.4)
                guard string(window, kAXSubroleAttribute) == kAXStandardWindowSubrole,
                      (attribute(window, kAXMinimizedAttribute) as? Bool) != true,
                      let f = frame(window), f.width > 40, f.height > 40 else { continue }
                var positionSettable = DarwinBoolean(false), sizeSettable = DarwinBoolean(false)
                AXUIElementIsAttributeSettable(window, kAXPositionAttribute as CFString, &positionSettable)
                AXUIElementIsAttributeSettable(window, kAXSizeAttribute as CFString, &sizeSettable)
                guard positionSettable.boolValue else { continue }
                let id: String
                if let old = known.first(where: { CFEqual($0.value, window) }) { id = old.key }
                else { nextID += 1; id = "\(app.processIdentifier):\(nextID)"; known[id] = window }
                alive.insert(id)
                output.append(["id":id,"pid":app.processIdentifier,"app_id":app.bundleIdentifier ?? app.executableURL?.path ?? "pid:\(app.processIdentifier)","app_name":app.localizedName ?? "Application","title":string(window,kAXTitleAttribute),"rect":rectJSON(f),"resizable":sizeSettable.boolValue])
            }
        }
    }
    known = known.filter { alive.contains($0.key) }
    return ["monitors":monitors(),"windows":output,"trusted":trusted,"platform":"macos"]
}
func sameApplication(_ pid: pid_t, _ item: [String: Any]) -> Bool {
    guard pid == (item["pid"] as? Int32), let app = NSRunningApplication(processIdentifier: pid) else { return false }
    return (app.bundleIdentifier ?? app.executableURL?.path ?? "pid:\(pid)") == (item["app_id"] as? String)
}
func apply(_ payload: [[String: Any]]) -> [[String: Any]] {
    payload.map { item in
        let id = item["id"] as? String ?? ""
        func failure(_ message: String) -> [String: Any] { ["id":id,"ok":false,"message":message] }
        guard AXIsProcessTrusted() else { return failure("アクセシビリティの許可が必要です") }
        guard let window = known[id], let r = item["rect"] as? [String: Double], let x=r["x"], let y=r["y"], let w=r["width"], let h=r["height"] else { return failure("ウィンドウが閉じられたか、再取得が必要です") }
        var pid: pid_t = 0
        guard AXUIElementGetPid(window, &pid) == .success, sameApplication(pid, item) else { return failure("ウィンドウが変わりました。再取得してください") }
        if (attribute(window, "AXFullScreen") as? Bool) == true { return failure("フルスクリーンを解除してから再実行してください") }
        var point = CGPoint(x:x,y:y), size = CGSize(width:w,height:h)
        let p = AXValueCreate(.cgPoint, &point)!, s = AXValueCreate(.cgSize, &size)!
        // AppKit may update its monitor-specific size constraints asynchronously.
        // Verify a short, bounded retry on the destination display before reporting failure.
        _ = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, s)
        var a = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, p)
        var b = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, s)
        _ = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
        var actual: CGRect?
        var exact = false
        for attempt in 0..<4 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.10))
            actual = frame(window)
            if let f=actual { exact = abs(f.minX-x)<6 && abs(f.minY-y)<6 && abs(f.width-w)<6 && abs(f.height-h)<6 }
            if exact || attempt == 3 { break }
            a = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, p)
            b = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, s)
        }
        guard let actual=actual else { return failure("移動後の位置を取得できませんでした") }
        return ["id":id,"ok":a == .success && b == .success && exact,"message":exact ? "反映しました" : "アプリの最小サイズ等により指定位置・サイズと異なります","actual":rectJSON(actual)]
    }
}

func context() -> [String: Any] {
    let front = NSWorkspace.shared.frontmostApplication
    guard let app=front, app.processIdentifier != getppid() else { return ["window":NSNull(),"monitor":NSNull(),"app_pid":NSNull()] }
    let snap=snapshot()
    let ax=AXUIElementCreateApplication(app.processIdentifier)
    var target: [String:Any]?
    if let focused=attribute(ax,kAXFocusedWindowAttribute) {
        if let key=known.first(where:{CFEqual($0.value,focused)})?.key {
            target=(snap["windows"] as? [[String:Any]])?.first(where:{$0["id"] as? String == key})
        }
    }
    var bounds: CGRect?
    if let r=target?["rect"] as? [String:Double], let x=r["x"],let y=r["y"],let w=r["width"],let h=r["height"] { bounds=CGRect(x:x,y:y,width:w,height:h) }
    if bounds == nil, let list=CGWindowListCopyWindowInfo(.optionOnScreenOnly,kCGNullWindowID) as? [[String:Any]], let item=list.first(where:{($0[kCGWindowOwnerPID as String] as? Int32)==app.processIdentifier && ($0[kCGWindowLayer as String] as? Int)==0}), let dictionary=item[kCGWindowBounds as String] as? [String:Any] {
        bounds=CGRect(dictionaryRepresentation:dictionary as CFDictionary)
    }
    let ms=monitors()
    let selected=bounds == nil ? ms.first : ms.max { a,b in
        func area(_ m:[String:Any])->Double { guard let r=m["rect"] as? [String:Double],let f=bounds else{return 0};let i=f.intersection(CGRect(x:r["x"]!,y:r["y"]!,width:r["width"]!,height:r["height"]!));return i.isNull ? 0 : i.width*i.height }
        return area(a)<area(b)
    }
    return ["window":target as Any? ?? NSNull(),"monitor":selected as Any? ?? NSNull(),"app_pid":app.processIdentifier]
}
func activate(_ item:[String:Any])->Bool {
    guard let pid=item["pid"] as? Int32, let app=NSRunningApplication(processIdentifier:pid) else {return false}
    if let id=item["id"] as? String, let w=known[id] { _=AXUIElementPerformAction(w,kAXRaiseAction as CFString) }
    return app.activate(options:[.activateIgnoringOtherApps])
}
func fullscreen(_ item:[String:Any])->[String:Any] {
    let id=item["id"] as? String ?? ""
    func fail(_ text:String)->[String:Any] {["id":id,"ok":false,"message":text]}
    guard AXIsProcessTrusted(), let w=known[id] else{return fail("対象ウィンドウを取得できません")}
    var pid:pid_t=0
    guard AXUIElementGetPid(w,&pid) == .success, sameApplication(pid, item) else{return fail("対象が変わりました。ハブを開き直してください")}
    var settable=DarwinBoolean(false)
    guard AXUIElementIsAttributeSettable(w,"AXFullScreen" as CFString,&settable) == .success, settable.boolValue else{return fail("このアプリはネイティブ全画面を受け付けません")}
    let enabled=item["enabled"] as? Bool ?? true
    guard AXUIElementSetAttributeValue(w,"AXFullScreen" as CFString,enabled ? kCFBooleanTrue : kCFBooleanFalse) == .success else{return fail("全画面を変更できません")}
    let deadline=Date(timeIntervalSinceNow:1.5)
    var ok=false
    while Date()<deadline { if (attribute(w,"AXFullScreen") as? Bool)==enabled {ok=true;break};RunLoop.current.run(until:Date(timeIntervalSinceNow:0.05)) }
    return ["id":id,"ok":ok,"message":ok ? (enabled ? "全画面表示にしました" : "全画面を解除しました") : "要求は送信しましたが全画面状態を確認できませんでした。アプリをご確認ください"]
}

func handle(_ line: String) {
    do {
        guard let data=line.data(using:.utf8), let request=try JSONSerialization.jsonObject(with:data) as? [String:Any], let action=request["action"] as? String else { throw NSError(domain:"Invalid request",code:1) }
        let result: Any
        switch action {
        case "snapshot": result = snapshot()
        case "context": result = context()
        case "hubMonitor":
            let screens=NSScreen.screens
            let index=(request["payload"] as? String)=="primary" ? 0 : (screens.firstIndex(where:{$0.frame.contains(NSEvent.mouseLocation)}) ?? 0)
            let ms=monitors()
            result = index < ms.count ? ms[index] as Any : NSNull()
        case "activate": result = activate(request["payload"] as? [String:Any] ?? [:])
        case "hubFrontmost": result = NSWorkspace.shared.frontmostApplication?.processIdentifier == getppid()
        case "fullscreen": result = fullscreen(request["payload"] as? [String:Any] ?? [:])
        case "apply": result = apply(request["payload"] as? [[String:Any]] ?? [])
        case "permission":
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            let granted = AXIsProcessTrustedWithOptions(options)
            NSWorkspace.shared.open(URL(string:"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
            result = granted
        default: throw NSError(domain:"Unknown action",code:2)
        }
        let response = try JSONSerialization.data(withJSONObject:["ok":true,"data":result], options:[.sortedKeys,.fragmentsAllowed])
        print(String(data:response,encoding:.utf8)!); fflush(stdout)
    } catch {
        let response = try! JSONSerialization.data(withJSONObject:["ok":false,"error":error.localizedDescription])
        print(String(data:response,encoding:.utf8)!); fflush(stdout)
    }
}

// AppKit must own the main event loop to receive screen-configuration changes.
// Read requests off the main thread; process them serially on the AppKit thread.
DispatchQueue(label: "local.windowhub.bridge.input").async {
    while let line = readLine() {
        DispatchQueue.main.sync { handle(line) }
    }
    DispatchQueue.main.async { exit(0) }
}
NSApplication.shared.run()
