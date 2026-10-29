import Cocoa
let image=NSImage(size:NSSize(width:1024,height:1024))
image.lockFocus()
NSColor(srgbRed:0.14,green:0.16,blue:0.12,alpha:1).setFill()
NSBezierPath(roundedRect:NSRect(x:0,y:0,width:1024,height:1024),xRadius:220,yRadius:220).fill()
let colors:[NSColor]=[NSColor(srgbRed:0.72,green:0.77,blue:0.58,alpha:1),NSColor(srgbRed:0.52,green:0.59,blue:0.40,alpha:1),NSColor(srgbRed:0.47,green:0.51,blue:0.37,alpha:1)]
for (i,r) in [NSRect(x:196,y:196,width:300,height:632),NSRect(x:528,y:528,width:300,height:300),NSRect(x:528,y:196,width:300,height:300)].enumerated(){colors[i].setFill();NSBezierPath(roundedRect:r,xRadius:48,yRadius:48).fill()}
image.unlockFocus()
let bitmap=NSBitmapImageRep(data:image.tiffRepresentation!)!
try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
