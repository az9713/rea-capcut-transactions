"""Create bounded source/web archives and hashes. No private research inputs."""
import hashlib,json,shutil,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE=[
"README.md","LICENSE","NOTICE.md",".gitignore","package.json","package-lock.json","electron-app.json",
"src/app.mjs","src/core.mjs","src/fixture.mjs","src/json.mjs",
"scripts/build.mjs","scripts/test.mjs","scripts/browser-test.mjs","scripts/release.py","scripts/package-desktop.py","scripts/electron-main.cjs",
"tests/core.test.mjs","tests/fresh-replay-child.mjs","fixtures/synthetic-draft.json",
"docs/app.html","docs/app.css","docs/app.js","docs/index.html","docs/sources.json","docs/verification.json","docs/browser-verification.json","docs/desktop-verification.json","docs/screenshots/workbench.png","docs/screenshots/mobile.png"
]
def checked(rel):
 p=(ROOT/rel).resolve()
 if not p.is_relative_to(ROOT.resolve()) or not p.is_file() or p.is_symlink(): raise ValueError("Invalid public input: "+rel)
 return p
def archive(name,items,prefix):
 target=ROOT/"releases"/name
 target.parent.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(target,"w",zipfile.ZIP_DEFLATED,compresslevel=6,strict_timestamps=False) as z:
  for rel,arc in items:z.write(checked(rel),prefix+"/"+arc)
 return target
def main():
 desktop=ROOT/"releases/CaptionTransactions-win-x64"
 config=json.loads(checked("electron-app.json").read_text())
 # Refresh exact allowlisted renderer assets after smoke-test evidence is recorded.
 for rel in config["docs_files"]:
  dest=(desktop/"resources/app/docs"/rel).resolve()
  if not dest.is_relative_to(desktop.resolve()):raise ValueError("Destination escaped")
  dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(checked("docs/"+rel),dest)
 win=ROOT/"releases/CaptionTransactions-0.1.0-win-x64.zip"
 with zipfile.ZipFile(win,"w",zipfile.ZIP_DEFLATED,compresslevel=6,strict_timestamps=False) as z:
  for p in sorted(desktop.rglob("*")):
   if p.is_symlink() or not p.resolve().is_relative_to(desktop.resolve()):raise ValueError("Unsafe desktop input")
   if p.is_file() and ".profile" not in p.relative_to(desktop).parts:
    z.write(p,"CaptionTransactions/"+p.relative_to(desktop).as_posix())
 source=archive("CaptionTransactions-0.1.0-source.zip",[(r,r) for r in SOURCE],"CaptionTransactions-source")
 web=archive("CaptionTransactions-0.1.0-web.zip",[("docs/"+r,r) for r in config["docs_files"]],"CaptionTransactions-web")
 assets=[win,source,web];lines=[]
 for p in assets:
  with zipfile.ZipFile(p) as z:
   if z.testzip():raise ValueError("ZIP CRC failure")
  lines.append(hashlib.sha256(p.read_bytes()).hexdigest()+"  "+p.name)
 (ROOT/"releases/SHA256SUMS.txt").write_text("\n".join(lines)+"\n",encoding="utf-8")
 print(json.dumps({"assets":[{"path":"releases/"+p.name,"bytes":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()} for p in assets]}))
if __name__=="__main__":main()
