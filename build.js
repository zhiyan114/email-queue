const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const cProcess = require('child_process');

const basePath = "src";

function getAllFilesInFolder(folderPath) {
  const memDirs = [folderPath];
  const finalPaths = [];
  while(memDirs.length > 0) {
    const curPath = memDirs.pop();
    const files = fs.readdirSync(curPath);
    for(const file of files) {
      const filePath = path.join(curPath, file).replace(/\\/g, '/');
      const fileStat = fs.statSync(filePath);
      if(fileStat.isDirectory())
        memDirs.push(filePath)
      if(fileStat.isFile())
        if(filePath.endsWith('.ts') || filePath.endsWith('.js'))
          finalPaths.push(filePath)
    }
  }
  return finalPaths;
}

// Get Commit Hash (using git)
const commitHash = cProcess
  .execSync('git rev-parse HEAD')
  .toString()
  .trim();

// Run Build
const start = new Date();
const out = esbuild.buildSync({
  entryPoints: getAllFilesInFolder(basePath),
  minify: true,
  minifyIdentifiers: true,
  minifySyntax: true,
  minifyWhitespace: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  sourcemap: true,
  metafile: true,
  banner: { js: `/* 2022-${start.getFullYear()} © zhiyan114 GPLv3 OwO | Build: ${process.env["ENVIRONMENT"] ?? "????"}-${commitHash.substring(0,7)} */` },
  outdir: "dist",
});

if(out.errors.length > 0)
  console.error(`Build Failed: ${JSON.stringify(out.errors)}`);

// // Copy over minified config.json
// const origin_config = fs.readFileSync(path.join(basePath, "config.json"));
// const minify_config = JSON.stringify(JSON.parse(origin_config));
// fs.writeFileSync(path.join("dist", "config.json"), minify_config);

const end = Date.now();

// Compute build size
let buildSize = 0;
const sizeUnits = ["bytes", "KB", "MB", "GB", "TB", "Yeah Not gonna happen"];
let sizeUnitIndex = 0;
if(out.metafile?.outputs)
  for (const file of Object.keys(out.metafile.outputs))
    buildSize += out.metafile.outputs[file].bytes;
// buildSize += minify_config.length;
while (buildSize > 1024) {
  buildSize /= 1024;
  sizeUnitIndex++;
}

console.log(`Build Success! Took ${end-start.getTime()}ms with size: ${(buildSize).toFixed(2)} ${sizeUnits[sizeUnitIndex]}`);