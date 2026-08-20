// 启动前检查 Electron 可执行文件；依赖处于半安装状态时自动运行官方安装脚本修复。
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const electronPackageRoot = path.join(projectRoot, "node_modules", "electron");
const electronPathRecord = path.join(electronPackageRoot, "path.txt");
const electronInstaller = path.join(electronPackageRoot, "install.js");

function resolveElectronExecutable() {
  if (!fs.existsSync(electronPathRecord)) {
    return null;
  }

  const relativeExecutablePath = fs.readFileSync(electronPathRecord, "utf8").trim();
  return relativeExecutablePath
    ? path.join(electronPackageRoot, "dist", relativeExecutablePath)
    : null;
}

function electronIsComplete() {
  const executablePath = resolveElectronExecutable();
  return Boolean(executablePath && fs.existsSync(executablePath));
}

if (!fs.existsSync(electronInstaller)) {
  console.error("未找到 Electron 依赖，请先运行 npm install。");
  process.exit(1);
}

if (!electronIsComplete()) {
  console.log("检测到 Electron 程序缺失，正在自动修复……");
  const result = spawnSync(process.execPath, [electronInstaller], {
    cwd: electronPackageRoot,
    env: process.env,
    stdio: "inherit"
  });

  if (result.error) {
    console.error("Electron 自动修复无法启动：", result.error.message);
    process.exit(1);
  }

  if (result.status !== 0 || !electronIsComplete()) {
    console.error("Electron 自动修复失败，请检查网络后运行 npm rebuild electron。");
    process.exit(result.status || 1);
  }

  console.log("Electron 程序已修复。");
}
