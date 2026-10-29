import Cocoa
final class Delegate:NSObject,NSApplicationDelegate {
    var windows:[NSWindow]=[]
    func applicationDidFinishLaunching(_ notification:Notification){
        NSWindow.allowsAutomaticWindowTabbing=false
        for i in 0..<2 {
            let w=NSWindow(contentRect:NSRect(x:180+i*90,y:150+i*80,width:520,height:360),styleMask:[.titled,.closable,.resizable,.miniaturizable],backing:.buffered,defer:false)
            w.tabbingMode = .disallowed
            w.title="WindowHub Test \(i+1)";w.minSize=NSSize(width:160,height:120)
            let label=NSTextField(labelWithString:"WindowHub 配置検証専用ウィンドウ \(i+1)")
            label.frame=NSRect(x:30,y:170,width:450,height:30);w.contentView?.addSubview(label);w.makeKeyAndOrderFront(nil);windows.append(w)
        }
        NSApp.activate(ignoringOtherApps:true)
    }
}
let app=NSApplication.shared;let delegate=Delegate();app.delegate=delegate;app.setActivationPolicy(.regular);app.run()
