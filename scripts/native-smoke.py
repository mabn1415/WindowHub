"""macOS: only move windows of the dedicated test application. Never normal user windows."""
import datetime, json, pathlib, plistlib, subprocess, time
root=pathlib.Path(__file__).resolve().parents[1]
work=root/'work';work.mkdir(exist_ok=True)
bundle=work/'WindowHub Test Target.app';mac=bundle/'Contents/MacOS';mac.mkdir(parents=True,exist_ok=True)
with (bundle/'Contents/Info.plist').open('wb') as f:plistlib.dump({'CFBundleIdentifier':'local.windowhub.testtarget','CFBundleName':'WindowHub Test Target','CFBundleExecutable':'TestTarget','CFBundlePackageType':'APPL'},f)
subprocess.run(['swiftc',str(root/'scripts/TestTarget.swift'),'-o',str(mac/'TestTarget')],check=True)
target=subprocess.Popen([str(mac/'TestTarget')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
bridge=subprocess.Popen([str(root/'src-tauri/binaries/WindowHubBridge')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
def call(action,payload=None):
    bridge.stdin.write(json.dumps({'action':action,'payload':payload})+'\n');bridge.stdin.flush()
    response=json.loads(bridge.stdout.readline());assert response['ok'],response
    return response['data']
def move(window,r):return {k:window[k] for k in ['id','pid','app_id','title']}|{'rect':r}
report=[]
result={'platform':'macos','timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat(),'target':'dedicated test app only','checks':report}
try:
    for _ in range(30):
        snap=call('snapshot');assert snap['trusted'],'Accessibility is not granted to this test process'
        windows=[w for w in snap['windows'] if w['pid']==target.pid and w['app_id']=='local.windowhub.testtarget']
        if len(windows)==2:break
        time.sleep(.2)
    assert len(windows)==2,'検証用ウィンドウを取得できません。Macのロックを解除し、対話デスクトップ上で再実行してください。'
    result['monitor_count']=len(snap['monitors'])
    original=[move(w,w['rect']) for w in windows]
    m=snap['monitors'][0]['rect']
    cases=[('same-monitor split 60:40',[{'x':m['x'],'y':m['y'],'width':round(m['width']*.6),'height':m['height']},{'x':m['x']+round(m['width']*.6),'y':m['y'],'width':m['width']-round(m['width']*.6),'height':m['height']}]),('overlap',[{'x':m['x']+20,'y':m['y']+20,'width':700,'height':600},{'x':m['x']+80,'y':m['y']+80,'width':700,'height':600}])]
    if len(snap['monitors'])>1:cases.append(('two real monitors',[snap['monitors'][0]['rect'],snap['monitors'][1]['rect']]))
    cases.append(('true Stack: identical region',[dict(m),dict(m)]))
    for monitor in snap['monitors'][1:]:
        cases.append(('cross-monitor '+monitor['name'],[m,monitor['rect']]))
    for name,rects in cases:
        results=call('apply',[move(w,r) for w,r in zip(windows,rects)])
        assert all(r['ok'] for r in results),(name,{'monitors':snap['monitors'],'requested':rects,'results':results})
        report.append({'check':name,'passed':True,'actual':[r['actual'] for r in results]})
    call('activate',windows[1]);time.sleep(.3)
    ctx=call('context');assert ctx['window']['pid']==target.pid and ctx['window']['id']==windows[1]['id'],ctx
    assert ctx['monitor']['id']==snap['monitors'][-1]['id'],ctx
    report.append({'check':'captured active window and destination monitor','passed':True})
    full=call('fullscreen',move(windows[1],windows[1]['rect']))
    report.append({'check':'native fullscreen','passed':full['ok'],'message':full['message']})
    if full['ok']:
        time.sleep(.8)
        leave=call('fullscreen',move(windows[1],windows[1]['rect'])|{'enabled':False})
        assert leave['ok'],leave
        time.sleep(.8)
    results=call('apply',original);assert all(r['ok'] for r in results),results
    report.append({'check':'restore original bounds','passed':True})
    renamed=move(windows[0],windows[0]['rect']);renamed['title']='a previous title'
    results=call('apply',[renamed]);assert results[0]['ok'],results;report.append({'check':'accept changed title for same window','passed':True})
    stale=move(windows[0],m);stale['app_id']='wrong.application'
    results=call('apply',[stale]);assert not results[0]['ok'];report.append({'check':'reject different application identity','passed':True})
    result['completed']=True
except Exception as error:
    result['error']=str(error)
    raise
finally:
    (work/'native-smoke.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps(result,ensure_ascii=False,indent=2))
    target.terminate();target.wait(timeout=5);bridge.stdin.close();bridge.wait(timeout=5)
